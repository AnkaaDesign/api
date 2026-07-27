/**
 * Desafio OTP da cerimônia de assinatura.
 *
 * NÃO reutiliza `VerificationService`. Aquele serviço tem quatro defeitos que o
 * desqualificam para prova de autoria:
 *   1. grava o código em TEXTO CLARO em `User.verificationCode` — coluna indexada;
 *   2. loga o código em texto claro (inclusive em nível `warn`, que sobrevive ao
 *      nível de log de produção);
 *   3. chaveia o contador de tentativas em `verification_attempt:{contato}:{codigo}`
 *      — ou seja, **no palpite**: cada código chutado ganha seu próprio orçamento
 *      de 3 tentativas, e o único limite real é por IP;
 *   4. o throttler falha ABERTO em erro de Redis.
 *
 * Aqui: código nunca persistido nem logado (só HMAC com pepper), contador
 * chaveado no DESAFIO e incrementado atomicamente, uso único, vínculo ao hash
 * do documento (ASVS 6.6.2) para que uma alteração do orçamento mate os desafios
 * pendentes, e vínculo à IDENTIDADE que pediu o código (ver `codeHashFor`).
 *
 * Parâmetros conforme OWASP ASVS v5.0 §6.5/6.6 e NIST SP 800-63B §5.1.3.2.
 *
 * Nota sobre SMS pumping: o destino do código vem do cadastro do cliente e é
 * imutável pelo signatário, então o ataque clássico (injetar números arbitrários
 * no campo de telefone para gerar tráfego pago) é estruturalmente impossível.
 * Ainda assim há limite de emissões por signatário.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { SigningChallengeStatus } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { hmacSha256Hex, safeEqualHex } from '../utils/canonical';

/** NIST §5.1.3.2: ≥20 bits de entropia. 6 dígitos ≈ 19,93 bits — é o piso. */
const CODE_DIGITS = 6;
/** NIST §5.1.3.2 impõe teto de 10 min; 5 equilibra latência do WhatsApp e exposição. */
const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CHALLENGES_PER_HOUR = 5;

export interface IssuedChallenge {
  challengeId: string;
  /** Código em claro. Existe apenas em memória, o tempo de ser despachado. */
  code: string;
  expiresAt: Date;
}

export type ChallengeFailureReason =
  | 'INVALID'
  | 'LOCKED'
  | 'EXPIRED'
  | 'NOT_FOUND'
  | 'DOCUMENT_CHANGED';

/**
 * Forma única em vez de união discriminada: com `strictNullChecks` desligado
 * neste projeto, o estreitamento por `!verdict.ok` não expõe `reason` de forma
 * confiável. Campos opcionais evitam depender do narrowing.
 */
export interface ChallengeVerdict {
  ok: boolean;
  challengeId?: string;
  reason?: ChallengeFailureReason;
  attemptsLeft?: number;
}

@Injectable()
export class SigningChallengeService {
  private readonly logger = new Logger(SigningChallengeService.name);
  private readonly pepper: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.pepper = this.configService.get<string>('SIGNATURE_OTP_PEPPER') ?? null;
    if (!this.pepper) {
      this.logger.error(
        'SIGNATURE_OTP_PEPPER não configurado — a emissão de códigos de assinatura irá recusar. ' +
          'Defina um segredo aleatório de 32+ bytes, distinto de PPE_SIGNATURE_HMAC_SECRET.',
      );
    }
  }

  isEnabled(): boolean {
    return this.pepper !== null && this.pepper.length >= 16;
  }

  /**
   * Emite um desafio, invalidando qualquer outro pendente do mesmo signatário.
   *
   * Nunca deixe dois códigos vivos ao mesmo tempo: duplicar a superfície de
   * adivinhação sem nenhum ganho de usabilidade (OWASP MFA — "on resend, generate
   * a new OTP and overwrite the old record").
   */
  async issue(args: {
    signerId: string;
    channel: 'whatsapp' | 'sms';
    destinationMask: string;
    documentSha256: string;
    /**
     * Identidade declarada por quem pediu o código (o CPF informado). O desafio
     * fica atado a ela — ver `codeHashFor`.
     */
    identity: string | null;
  }): Promise<IssuedChallenge> {
    if (!this.isEnabled() || !this.pepper) {
      throw new BadRequestException(
        'Assinatura eletrônica indisponível: segredo de OTP não configurado no servidor.',
      );
    }

    const now = new Date();

    const recent = await this.prisma.signingChallenge.findFirst({
      where: { signerId: args.signerId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent && now.getTime() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil(
        (RESEND_COOLDOWN_MS - (now.getTime() - recent.createdAt.getTime())) / 1000,
      );
      throw new BadRequestException(`Aguarde ${wait}s para solicitar um novo código.`);
    }

    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const issuedLastHour = await this.prisma.signingChallenge.count({
      where: { signerId: args.signerId, createdAt: { gte: hourAgo } },
    });
    if (issuedLastHour >= MAX_CHALLENGES_PER_HOUR) {
      throw new BadRequestException(
        'Limite de envios atingido. Tente novamente em uma hora ou fale com a Ankaa.',
      );
    }

    // randomInt usa rejection sampling — sem viés de módulo, ao contrário de
    // `Math.floor(Math.random()*900000)+100000`, que é o que o cadastro de
    // Responsible faz hoje.
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
    const codeHash = this.codeHashFor(code, args.identity);
    const expiresAt = new Date(now.getTime() + TTL_MS);

    const challenge = await this.prisma.$transaction(async tx => {
      await tx.signingChallenge.updateMany({
        where: { signerId: args.signerId, status: SigningChallengeStatus.PENDING },
        data: { status: SigningChallengeStatus.SUPERSEDED },
      });

      return tx.signingChallenge.create({
        data: {
          signerId: args.signerId,
          channel: args.channel,
          destinationMask: args.destinationMask,
          codeHash,
          documentSha256: args.documentSha256,
          expiresAt,
          maxAttempts: MAX_ATTEMPTS,
        },
        select: { id: true },
      });
    });

    return { challengeId: challenge.id, code, expiresAt };
  }

  /**
   * Verifica um código.
   *
   * O incremento acontece numa ÚNICA instrução atômica, condicionada a
   * `attempts < maxAttempts`. Isso fecha dois furos clássicos:
   *  · TOCTOU — ler, comparar e escrever em passos separados deixa palpites
   *    paralelos lerem `attempts=4` antes de qualquer commit;
   *  · orçamento renovável — se o contador vivesse no telefone ou na sessão em vez
   *    de no desafio, pedir reenvio zeraria o limite e transformaria o "5
   *    tentativas" num oráculo ilimitado.
   */
  async verify(args: {
    signerId: string;
    challengeId: string;
    code: string;
    expectedDocumentSha256: string;
    /** A identidade em vigor no momento do ato. Precisa ser a mesma da emissão. */
    identity: string | null;
  }): Promise<ChallengeVerdict> {
    if (!this.isEnabled() || !this.pepper) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const submitted = (args.code ?? '').replace(/\D+/g, '');
    if (submitted.length !== CODE_DIGITS) {
      return { ok: false, reason: 'INVALID', attemptsLeft: MAX_ATTEMPTS };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ attempts: number; codeHash: string; maxAttempts: number; documentSha256: string }>
    >`
      UPDATE "SigningChallenge"
         SET "attempts" = "attempts" + 1
       WHERE "id" = ${args.challengeId}
         AND "signerId" = ${args.signerId}
         AND "status" = 'PENDING'
         AND "expiresAt" > now()
         AND "attempts" < "maxAttempts"
      RETURNING "attempts", "codeHash", "maxAttempts", "documentSha256"
    `;

    if (rows.length === 0) {
      // Expirado, esgotado, já consumido ou inexistente — a resposta é
      // deliberadamente indistinguível para não virar oráculo de enumeração.
      await this.expireIfStale(args.challengeId);
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const row = rows[0];

    // O código foi emitido contra uma versão específica do documento. Se o
    // orçamento mudou no intervalo, o ato de vontade não corresponde mais ao que
    // será assinado (OWASP Transaction Authorization §2.6).
    if (row.documentSha256 !== args.expectedDocumentSha256) {
      await this.prisma.signingChallenge.update({
        where: { id: args.challengeId },
        data: { status: SigningChallengeStatus.SUPERSEDED },
      });
      return { ok: false, reason: 'DOCUMENT_CHANGED' };
    }

    // Confere código E identidade de uma vez: o hash guardado só reproduz se o
    // CPF do ato for o mesmo da emissão.
    const matches = safeEqualHex(this.codeHashFor(submitted, args.identity), row.codeHash);

    if (matches) {
      await this.prisma.signingChallenge.update({
        where: { id: args.challengeId },
        data: { status: SigningChallengeStatus.CONSUMED, consumedAt: new Date() },
      });
      return { ok: true, challengeId: args.challengeId };
    }

    if (row.attempts >= row.maxAttempts) {
      await this.prisma.signingChallenge.update({
        where: { id: args.challengeId },
        data: { status: SigningChallengeStatus.LOCKED },
      });
      return { ok: false, reason: 'LOCKED' };
    }

    return { ok: false, reason: 'INVALID', attemptsLeft: row.maxAttempts - row.attempts };
  }

  /** Registra a confirmação de entrega devolvida pelo transporte. */
  async markDelivered(
    challengeId: string,
    providerMessageId: string | null,
    providerStatus: string,
  ): Promise<void> {
    try {
      await this.prisma.signingChallenge.update({
        where: { id: challengeId },
        data: {
          providerMessageId,
          providerStatus,
          deliveredAt: providerStatus === 'delivered' || providerStatus === 'sent' ? new Date() : null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Não foi possível registrar a entrega do desafio ${challengeId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /** Invalida todos os desafios pendentes de um signatário (troca de contato, invalidação do envelope). */
  async supersedeAllForSigner(signerId: string): Promise<void> {
    await this.prisma.signingChallenge.updateMany({
      where: { signerId, status: SigningChallengeStatus.PENDING },
      data: { status: SigningChallengeStatus.SUPERSEDED },
    });
  }

  /** Invalida desafios pendentes de todos os signatários de um envelope. */
  async supersedeAllForEnvelope(envelopeId: string): Promise<void> {
    const signers = await this.prisma.envelopeSigner.findMany({
      where: { envelopeId },
      select: { id: true },
    });
    if (signers.length === 0) return;
    await this.prisma.signingChallenge.updateMany({
      where: {
        signerId: { in: signers.map(s => s.id) },
        status: SigningChallengeStatus.PENDING,
      },
      data: { status: SigningChallengeStatus.SUPERSEDED },
    });
  }

  /**
   * Hash do código ATADO à identidade que o pediu.
   *
   * O furo que isto fecha: o desafio era `HMAC(código)` e nada mais, e o CPF do
   * ato era lido de `EnvelopeSigner.informedCpf` — uma coluna que a própria rota
   * pública reescreve. Com um código já emitido e vivo, bastava chamar
   * `/codigo` de novo com OUTRO CPF: a gravação do CPF acontecia antes do
   * cooldown de 60s recusar a emissão, então o código em trânsito (emitido para
   * o CPF A) passava a valer com o CPF B, e era o CPF B que ia para a evidência,
   * para o selo e para a página de auditoria.
   *
   * Amarrar a identidade dentro do próprio HMAC resolve sem coluna nova e sem
   * migration: trocar o CPF invalida o material criptográfico do código. E a
   * falha se apresenta como "código inválido", indistinguível de um erro de
   * digitação — de propósito, para não virar oráculo de CPF.
   *
   * Normaliza para dígitos porque `123.456.789-01` e `12345678901` são a mesma
   * pessoa, e a rota aceita as duas grafias.
   */
  private codeHashFor(code: string, identity: string | null): string {
    const key = (identity ?? '').replace(/\D+/g, '');
    // Separador que não pode aparecer em nenhum dos lados (ambos são dígitos),
    // então não há colisão por concatenação ambígua.
    return hmacSha256Hex(`${code}|${key}`, this.pepper as string);
  }

  private async expireIfStale(challengeId: string): Promise<void> {
    try {
      await this.prisma.signingChallenge.updateMany({
        where: {
          id: challengeId,
          status: SigningChallengeStatus.PENDING,
          expiresAt: { lte: new Date() },
        },
        data: { status: SigningChallengeStatus.EXPIRED },
      });
    } catch {
      // best-effort — a condição de expiração já é aplicada no UPDATE atômico
    }
  }
}
