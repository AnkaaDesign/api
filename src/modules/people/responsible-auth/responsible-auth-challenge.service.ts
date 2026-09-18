// api/src/modules/people/responsible-auth/responsible-auth-challenge.service.ts
//
// O desafio de OTP que autentica um contato de cliente no portal.
//
// É irmão de `SigningChallengeService`, e deliberadamente NÃO é o mesmo objeto.
// Aquela tabela sustenta prova jurídica: seu dono é FK dura para
// `EnvelopeSigner`, ela carrega `documentSha256`, e o dossiê e a trilha
// encadeada por hash dependem dela. Torná-la polimórfica para caber um login
// seria migration de risco desproporcional sobre a evidência — e o modo de
// falha (degradação silenciosa em prova) é o pior que aquele módulo admite: ele
// derruba o boot quando falta pepper, exatamente por isso.
//
// O que se compartilha é o ALGORITMO, pelos helpers de `utils/canonical.ts`.
// A tabela, não.
//
// NÃO REUSAR O `VerificationService` DO FUNCIONÁRIO — ele tem quatro defeitos
// que o desqualificam para autenticação, todos já documentados no cabeçalho do
// `signing-challenge.service.ts` e confirmados em auditoria:
//   1. grava o código EM TEXTO CLARO em `User.verificationCode` — e a coluna é
//      indexada;
//   2. IMPRIME o código esperado no log, inclusive em `warn`, que sobrevive ao
//      nível de log de produção;
//   3. conta tentativas CHAVEADAS NO PALPITE (`verification_attempt:{contato}:{codigo}`),
//      então enumerar 000000, 000001, … cria uma chave nova a cada tentativa e
//      nunca passa de 1 — o limite real nunca dispara;
//   4. o throttler FALHA ABERTO em erro de Redis.
//
// E o fluxo antigo do próprio `Responsible` era pior: gerava o código com
// `Math.floor(100000 + Math.random()*900000)` — PRNG não criptográfico e com
// viés de módulo — e nunca o enviava.
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt, createHash } from 'crypto';
import { ResponsibleAuthChallengeStatus } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { hmacSha256Hex, safeEqualHex } from '@/modules/common/signature/utils/canonical';

/** NIST SP 800-63B §5.1.3.2: ≥20 bits. 6 dígitos ≈ 19,93 bits — é o piso. */
const CODE_DIGITS = 6;

/**
 * NIST impõe teto de 10 min; usamos o teto, pela mesma razão que a assinatura:
 * e-mail passa por fila de MTA, antispam e greylisting (RFC 6647, retry de 5 a
 * 15 min). Com 5 min o código expirava antes de chegar, em silêncio.
 *
 * Dobrar a janela não afrouxa nada de verdade: `issue` supersede os PENDING
 * (existe UM código vivo por pessoa) e o orçamento de tentativas é POR DESAFIO,
 * não por tempo. A probabilidade de acerto online não muda.
 */
const TTL_MS = 10 * 60 * 1000;

/** Para o texto da tela e do e-mail saírem daqui, e não de um número digitado. */
export const RESPONSIBLE_CODE_TTL_MINUTES = TTL_MS / 60_000;

const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 120 * 1000;
const MAX_CHALLENGES_PER_HOUR = 5;

const PEPPER_MIN_LENGTH = 32;

export interface IssuedResponsibleChallenge {
  challengeId: string;
  channel: string;
  destinationMask: string;
  expiresAt: Date;
  /** O código em claro. Existe SÓ em memória, para ser entregue e esquecido. */
  code: string;
}

export type ResponsibleChallengeFailure =
  | 'NOT_FOUND'
  | 'WRONG_CODE'
  | 'LOCKED'
  | 'COOLDOWN'
  | 'RATE_LIMITED';

export interface ResponsibleChallengeVerdict {
  ok: boolean;
  reason?: ResponsibleChallengeFailure;
  attemptsLeft?: number;
}

@Injectable()
export class ResponsibleAuthChallengeService implements OnModuleInit {
  private readonly logger = new Logger(ResponsibleAuthChallengeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Falha no BOOT se o pepper faltar ou for curto.
   *
   * É o mesmo padrão de `signature/utils/secrets.ts`, e pela mesma razão: sem
   * pepper, `codeHashFor` viraria um hash sem segredo, e 10^6 possibilidades são
   * força bruta instantânea contra um dump. Um sistema de autenticação que sobe
   * degradado e não avisa é pior do que um que não sobe.
   */
  onModuleInit(): void {
    const pepper = process.env.RESPONSIBLE_OTP_PEPPER ?? '';
    if (pepper.length < PEPPER_MIN_LENGTH) {
      throw new Error(
        `RESPONSIBLE_OTP_PEPPER ausente ou curto (mínimo ${PEPPER_MIN_LENGTH} caracteres). ` +
          'O portal do cliente não sobe sem ele — um OTP sem pepper é força bruta instantânea.',
      );
    }
    if (pepper === process.env.SIGNATURE_OTP_PEPPER) {
      throw new Error(
        'RESPONSIBLE_OTP_PEPPER não pode ser igual a SIGNATURE_OTP_PEPPER. ' +
          'Segredos separados mantêm o comprometimento de um fora do outro.',
      );
    }
  }

  private get pepper(): string {
    return process.env.RESPONSIBLE_OTP_PEPPER ?? '';
  }

  /**
   * O código é hasheado JUNTO com o id de quem o pediu.
   *
   * Isso é o que fecha o furo que a cerimônia de assinatura descobriu (M3): com
   * o hash só do código, um código em trânsito continuava válido se a identidade
   * associada mudasse no meio. Atando os dois, trocar o sujeito invalida o
   * material — e a falha aparece como "código inválido", nunca como pista.
   *
   * bcrypt/argon2 aqui seria teatro: 10^6 possibilidades caem em milissegundos
   * com qualquer custo. O que protege é o pepper estar FORA do banco.
   */
  private codeHashFor(code: string, responsibleId: string): string {
    return hmacSha256Hex(`${code}|${responsibleId}`, this.pepper);
  }

  /**
   * Emite um código. Supersede qualquer PENDING do mesmo contato, na mesma
   * transação: existe no máximo UM código vivo por pessoa.
   */
  async issue(args: {
    responsibleId: string;
    channel: string;
    destinationMask: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<IssuedResponsibleChallenge> {
    const now = new Date();

    // Cooldown — ignora desafios cuja ENTREGA falhou. Punir a pessoa por uma
    // falha de transporte nossa é a forma mais rápida de travar quem já está
    // com dificuldade de entrar.
    const recent = await this.prisma.responsibleAuthChallenge.findFirst({
      where: {
        responsibleId: args.responsibleId,
        providerStatus: { not: 'failed' },
        createdAt: { gte: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (recent) {
      throw new BadRequestException(
        `Aguarde ${RESEND_COOLDOWN_MS / 1000} segundos para pedir um novo código.`,
      );
    }

    // Teto horário — este conta TUDO, inclusive o que falhou na entrega. O
    // cooldown protege a pessoa; o teto protege o canal (e a nota de qualidade
    // do template na Meta, que é medida por template).
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const issuedThisHour = await this.prisma.responsibleAuthChallenge.count({
      where: { responsibleId: args.responsibleId, createdAt: { gte: hourAgo } },
    });
    if (issuedThisHour >= MAX_CHALLENGES_PER_HOUR) {
      throw new BadRequestException(
        'Muitas tentativas de acesso nesta hora. Tente novamente mais tarde.',
      );
    }

    // `randomInt` usa rejection sampling: sem viés de módulo, ao contrário de
    // `Math.floor(Math.random() * 900000) + 100000`.
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
    const codeHash = this.codeHashFor(code, args.responsibleId);
    const expiresAt = new Date(now.getTime() + TTL_MS);

    const challenge = await this.prisma.$transaction(async tx => {
      await tx.responsibleAuthChallenge.updateMany({
        where: {
          responsibleId: args.responsibleId,
          status: ResponsibleAuthChallengeStatus.PENDING,
        },
        data: { status: ResponsibleAuthChallengeStatus.SUPERSEDED },
      });

      return tx.responsibleAuthChallenge.create({
        data: {
          responsibleId: args.responsibleId,
          channel: args.channel,
          destinationMask: args.destinationMask,
          codeHash,
          expiresAt,
          maxAttempts: MAX_ATTEMPTS,
          ipAddress: args.ipAddress ?? null,
          userAgent: args.userAgent ?? null,
        },
        select: { id: true },
      });
    });

    return {
      challengeId: challenge.id,
      channel: args.channel,
      destinationMask: args.destinationMask,
      expiresAt,
      code,
    };
  }

  /**
   * Confere o código.
   *
   * O incremento de tentativas é UM `UPDATE ... RETURNING` atômico, com todas as
   * condições no `WHERE`. Isso fecha duas coisas de uma vez:
   *
   *   • TOCTOU — ler, decidir e escrever em passos separados deixa janela para
   *     duas requisições simultâneas gastarem a mesma tentativa;
   *   • orçamento renovável — que é o defeito do `VerificationService`, onde a
   *     chave do contador inclui o palpite e cada chute ganha o próprio orçamento.
   *
   * Zero linhas de volta significa expirado OU esgotado OU já consumido OU
   * inexistente, e todos devolvem o MESMO erro genérico: distingui-los
   * transformaria a rota num oráculo.
   */
  async verify(args: {
    responsibleId: string;
    challengeId: string;
    code: string;
  }): Promise<ResponsibleChallengeVerdict> {
    const rows = await this.prisma.$queryRaw<
      Array<{ attempts: number; codeHash: string; maxAttempts: number }>
    >`
      UPDATE "ResponsibleAuthChallenge"
         SET attempts = attempts + 1
       WHERE id = ${args.challengeId}
         AND "responsibleId" = ${args.responsibleId}
         AND status = 'PENDING'
         AND "expiresAt" > now()
         AND attempts < "maxAttempts"
      RETURNING attempts, "codeHash", "maxAttempts"
    `;

    if (rows.length === 0) {
      await this.expireIfStale(args.challengeId);
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const row = rows[0];
    const expected = this.codeHashFor(args.code, args.responsibleId);

    if (!safeEqualHex(expected, row.codeHash)) {
      const attemptsLeft = row.maxAttempts - row.attempts;
      if (attemptsLeft <= 0) {
        await this.prisma.responsibleAuthChallenge.update({
          where: { id: args.challengeId },
          data: { status: ResponsibleAuthChallengeStatus.LOCKED },
        });
        return { ok: false, reason: 'LOCKED', attemptsLeft: 0 };
      }
      return { ok: false, reason: 'WRONG_CODE', attemptsLeft };
    }

    // Uso único: consumir é parte do acerto, não um passo posterior.
    await this.prisma.responsibleAuthChallenge.update({
      where: { id: args.challengeId },
      data: {
        status: ResponsibleAuthChallengeStatus.CONSUMED,
        consumedAt: new Date(),
      },
    });

    return { ok: true };
  }

  /** Marca a entrega, para que o cooldown saiba não punir falha de transporte. */
  async markDelivered(
    challengeId: string,
    providerMessageId: string | null,
    providerStatus: string,
  ): Promise<void> {
    await this.prisma.responsibleAuthChallenge.update({
      where: { id: challengeId },
      data: {
        providerMessageId,
        providerStatus,
        deliveredAt: providerStatus === 'failed' ? null : new Date(),
      },
    });
  }

  private async expireIfStale(challengeId: string): Promise<void> {
    await this.prisma.responsibleAuthChallenge.updateMany({
      where: {
        id: challengeId,
        status: ResponsibleAuthChallengeStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: ResponsibleAuthChallengeStatus.EXPIRED },
    });
  }

  /** SHA-256 do token de sessão. Usado pelo serviço de sessão; mora aqui porque
   *  é a mesma doutrina: o banco nunca guarda o segredo que o portador carrega. */
  static hashSessionToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
