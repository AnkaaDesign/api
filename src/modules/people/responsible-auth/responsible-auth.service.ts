// api/src/modules/people/responsible-auth/responsible-auth.service.ts
//
// Login do contato de cliente no portal. Dois passos, sem senha:
//   1. POST /cliente/auth/codigo   — informa e-mail ou telefone, recebe o código
//   2. POST /cliente/auth/entrar   — devolve o código, ganha uma sessão
//
// POR QUE SEM SENHA
//   Não é preferência estética, são três fatos do cadastro:
//
//   • `Responsible.email` é OPCIONAL e `Responsible.phone` é NOT NULL e único.
//     Um fluxo de senha precisa de canal para recuperação — ou seja, precisa do
//     OTP de qualquer jeito. A senha só acrescenta um segredo a guardar.
//   • O contato entra raramente (algumas vezes por orçamento). Senha usada uma
//     vez por trimestre é senha esquecida: vira suporte, não segurança.
//   • O sistema JÁ PROVA a posse do canal toda vez que esse mesmo contato assina
//     um orçamento. O login por OTP é o mesmo ato, promovido de "um envelope"
//     para "uma sessão".
//
//   E o histórico fecha o argumento: o login de senha que existia aqui nunca
//   funcionou — produção tinha 183 contatos e ZERO com senha.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  AuthOtpDeliveryService,
  type AuthOtpChannel,
} from '@/modules/common/auth-otp/auth-otp-delivery.service';
import { maskEmail, maskPhone, onlyDigits } from '@/modules/common/signature/utils/identity';
import {
  ResponsibleAuthChallengeService,
  RESPONSIBLE_CODE_TTL_MINUTES,
} from './responsible-auth-challenge.service';

/**
 * A sessão do portal é DESLIZANTE, com teto absoluto. São dois prazos, e cada
 * um responde a uma pergunta diferente.
 *
 * POR QUE NÃO UM PRAZO FIXO
 *   Um prazo fixo mede a IDADE da sessão, e idade não é o que importa aqui.
 *   Com 7 dias fixos, o contato que abre o portal toda semana era deslogado
 *   mesmo assim — e o aparelho abandonado num escritório continuava com sessão
 *   viva até o prazo vencer. O pior dos dois lados: atrito para quem usa, e
 *   janela aberta para quem não usa.
 *
 * OCIOSIDADE (`IDLE_DAYS`) — "quanto tempo sem aparecer até eu esquecer você?"
 *   Renovado a cada uso. Na prática: quem usa o portal com alguma regularidade
 *   NUNCA mais faz login. Quem sumiu por três meses entra de novo, o que custa
 *   um código que chega em segundos.
 *
 * TETO ABSOLUTO (`MAX_DAYS`) — "por quanto tempo esta sessão pode existir?"
 *   Nunca é estendido. Sem ele, uma sessão deslizante é eterna: um token
 *   copiado de um aparelho emprestado se renovaria para sempre, sozinho. É a
 *   diferença entre "não incomodar quem usa" e "nunca mais conferir quem é".
 *
 * O resultado para o cliente: quem usa com alguma regularidade re-autentica UMA
 * vez por ano, quando o teto absoluto vence — e mais nada. Quem some por três
 * meses entra de novo.
 *
 * E há uma segunda tranca, que é a que torna um prazo longo aceitável: trocar o
 * telefone ou o e-mail do contato, ou desativá-lo, REVOGA as sessões na hora
 * (`ResponsibleService.revokePortalSessions`). O prazo longo vale para a mesma
 * pessoa no mesmo canal; no instante em que o canal muda de dono, o prazo deixa
 * de valer.
 */
const SESSION_IDLE_DAYS = Number(process.env.RESPONSIBLE_SESSION_IDLE_DAYS ?? 90);
const SESSION_MAX_DAYS = Number(process.env.RESPONSIBLE_SESSION_MAX_DAYS ?? 365);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Só renova se o último uso foi há mais de uma hora.
 *
 * Sem isto, abrir uma tela que faz dez requisições geraria dez UPDATEs na mesma
 * linha. A precisão perdida é irrelevante (a janela é de 60 dias); a escrita
 * economizada, não.
 */
const TOUCH_THROTTLE_MS = 60 * 60 * 1000;

export interface CodeRequestResult {
  challengeId: string;
  /** Para onde foi, já mascarado. */
  destinationMask: string;
  channel: AuthOtpChannel | 'NONE';
  expiresInMinutes: number;
}

export interface ResponsibleSessionResult {
  token: string;
  expiresAt: Date;
  responsible: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    roles: string[];
    companyId: string | null;
    companyName: string | null;
  };
}

@Injectable()
export class ResponsibleAuthService {
  private readonly logger = new Logger(ResponsibleAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: ResponsibleAuthChallengeService,
    private readonly delivery: AuthOtpDeliveryService,
  ) {}

  /**
   * Passo 1 — pede o código.
   *
   * ANTI-ENUMERAÇÃO: a resposta é a MESMA para contato que existe e contato que
   * não existe. Sem isso, a rota vira um oráculo que responde "este telefone é
   * contato de algum cliente da Ankaa?" — e quem pergunta em lote é justamente
   * quem não deveria saber. Por isso o `destinationMask` devolvido é o do que a
   * PESSOA DIGITOU (que ela já conhece), e o `challengeId` de um contato
   * inexistente é um UUID de enfeite que jamais confere.
   *
   * Contato inativo é tratado como inexistente, pela mesma razão.
   */
  async requestCode(args: {
    contact: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<CodeRequestResult> {
    const contact = args.contact.trim();
    const looksLikeEmail = contact.includes('@');

    const responsible = await this.findByContact(contact, looksLikeEmail);

    if (!responsible || !responsible.isActive) {
      // Caminho de enfeite. Não emite desafio, não envia nada, não registra o
      // contato — e é indistinguível do caminho real para quem está de fora.
      this.logger.log('Código solicitado para contato sem cadastro ativo (resposta genérica).');
      return {
        challengeId: randomBytes(16).toString('hex'),
        destinationMask: looksLikeEmail ? maskEmail(contact) : maskPhone(contact),
        channel: looksLikeEmail ? 'EMAIL' : 'WHATSAPP',
        expiresInMinutes: RESPONSIBLE_CODE_TTL_MINUTES,
      };
    }

    // O canal segue o que a pessoa DIGITOU. Quem entrou com o telefone espera o
    // código naquele telefone — mandar por e-mail "porque o cadastro tem" é a
    // forma mais rápida de fazê-la achar que nada foi enviado.
    const preferred: AuthOtpChannel = looksLikeEmail ? 'EMAIL' : 'WHATSAPP';

    const issued = await this.challenges.issue({
      responsibleId: responsible.id,
      channel: preferred,
      destinationMask: looksLikeEmail
        ? maskEmail(responsible.email)
        : maskPhone(responsible.phone),
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });

    // Modo de desenvolvimento: ecoa o código no log em vez de enviar.
    //
    // DUAS TRAVAS, exatamente como a cerimônia de assinatura
    // (`signature-envelope.service.ts`): só fora de produção E com a flag
    // explícita. Em produção esta condição é inalcançável mesmo que alguém
    // ligue a flag por engano.
    //
    // Existe porque o código é guardado como HMAC — ele é IRRECUPERÁVEL do
    // banco, por desenho. Sem este eco, testar o portal numa máquina sem SMTP e
    // sem credencial do WhatsApp seria impossível, e a alternativa (afrouxar o
    // armazenamento para "poder ver o código em dev") é justamente o defeito
    // que derrubou o `VerificationService`.
    const devEcho =
      process.env.NODE_ENV !== 'production' &&
      process.env.RESPONSIBLE_DEV_ECHO_OTP === 'true';

    if (devEcho) {
      this.logger.warn(
        `[DEV] Código de acesso de ${responsible.name} ` +
          `(${issued.destinationMask}): ${issued.code} — NENHUMA mensagem foi enviada.`,
      );
      await this.challenges.markDelivered(issued.challengeId, null, 'dev-echo');
      return {
        challengeId: issued.challengeId,
        destinationMask: issued.destinationMask,
        channel: preferred,
        expiresInMinutes: RESPONSIBLE_CODE_TTL_MINUTES,
      };
    }

    const result = await this.delivery.deliver(
      { name: responsible.name, email: responsible.email, phone: responsible.phone },
      issued.code,
      preferred,
    );

    await this.challenges.markDelivered(
      issued.challengeId,
      result.providerMessageId ?? null,
      result.ok ? (result.channel ?? 'unknown') : 'failed',
    );

    if (!result.ok) {
      // Aqui SIM dizemos que falhou: a pessoa existe, pediu, e não conseguimos
      // entregar. Esconder isso a deixaria esperando um código que não vem. O
      // cooldown já foi instruído a não punir esta falha.
      //
      // O MOTIVO, porém, fica no log. `result.reason` vem da Meta ou do SMTP e
      // descreve a NOSSA infraestrutura — "canal oficial desligado", "sem
      // telefone no cadastro", códigos de erro da Cloud API. Para quem está do
      // lado de fora não é acionável, e "sem telefone no cadastro" ainda conta
      // que aquele contato existe, desfazendo a resposta genérica que o caminho
      // de enfeite acabou de construir. Quem precisa do motivo é o operador.
      this.logger.error(
        `Falha ao entregar código de acesso ao responsável ${responsible.id} ` +
          `(canal ${preferred}): ${result.reason}`,
      );
      throw new BadRequestException(
        'Não foi possível enviar o código agora. Tente novamente em alguns minutos ' +
          'ou fale com o comercial.',
      );
    }

    return {
      challengeId: issued.challengeId,
      destinationMask: result.destinationMask ?? issued.destinationMask,
      channel: result.channel ?? preferred,
      expiresInMinutes: RESPONSIBLE_CODE_TTL_MINUTES,
    };
  }

  /**
   * Passo 2 — devolve o código e ganha a sessão.
   *
   * O token entregue é opaco (256 bits), não JWT. O portador não precisa ler
   * nada dele, e um segredo compartilhado a menos é um caminho de escalada a
   * menos: foi exatamente assinar o token do responsável com o `JWT_SECRET` da
   * casa que abriu o furo de destravar orçamento vencido de qualquer cliente.
   */
  async verifyCode(args: {
    contact: string;
    challengeId: string;
    code: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<ResponsibleSessionResult> {
    const contact = args.contact.trim();
    const responsible = await this.findByContact(contact, contact.includes('@'));

    // Mesma mensagem genérica do desafio inexistente — não distinguir "contato
    // errado" de "código errado" é o que impede a rota de virar oráculo.
    const generic = new BadRequestException('Código inválido ou expirado.');

    if (!responsible || !responsible.isActive) throw generic;

    const verdict = await this.challenges.verify({
      responsibleId: responsible.id,
      challengeId: args.challengeId,
      code: onlyDigits(args.code),
    });

    if (!verdict.ok) {
      if (verdict.reason === 'LOCKED') {
        throw new BadRequestException(
          'Código bloqueado por tentativas demais. Peça um novo código.',
        );
      }
      if (verdict.reason === 'WRONG_CODE' && typeof verdict.attemptsLeft === 'number') {
        throw new BadRequestException(
          `Código inválido. ${verdict.attemptsLeft} tentativa(s) restante(s).`,
        );
      }
      throw generic;
    }

    return this.openSession(responsible.id, args.ipAddress, args.userAgent);
  }

  private async openSession(
    responsibleId: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<ResponsibleSessionResult> {
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = ResponsibleAuthChallengeService.hashSessionToken(raw);
    // Nasce com a janela de ociosidade. `touchSession` a empurra a cada uso,
    // até o teto de `createdAt + SESSION_MAX_DAYS`.
    const expiresAt = new Date(Date.now() + SESSION_IDLE_DAYS * DAY_MS);

    const [, responsible] = await this.prisma.$transaction([
      this.prisma.responsibleSession.create({
        data: {
          responsibleId,
          tokenHash,
          expiresAt,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent?.slice(0, 255) ?? null,
        },
        select: { id: true },
      }),
      this.prisma.responsible.update({
        where: { id: responsibleId },
        // `verified` deixou de ser pré-requisito e virou registro: este contato
        // já concluiu um acesso pelo canal que o cadastro diz ser dele.
        data: { lastLoginAt: new Date(), verified: true },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          roles: true,
          companyId: true,
          company: { select: { fantasyName: true } },
        },
      }),
    ]);

    return {
      token: raw,
      expiresAt,
      responsible: {
        id: responsible.id,
        name: responsible.name,
        email: responsible.email,
        phone: responsible.phone,
        roles: responsible.roles,
        companyId: responsible.companyId,
        companyName: responsible.company?.fantasyName ?? null,
      },
    };
  }

  /**
   * Resolve o portador de um token. É o ponto ÚNICO que a guarda chama.
   *
   * Confere três coisas a cada requisição, e não só no login: sessão viva,
   * sessão não revogada, e contato ainda ativo. A última é o equivalente do
   * `isUserEmployed` do funcionário — sem ela, desativar um contato não o tira
   * de dentro até a sessão vencer.
   */
  async resolveSession(rawToken: string): Promise<{
    sessionId: string;
    createdAt: Date;
    lastSeenAt: Date | null;
    responsible: {
      id: string;
      name: string;
      email: string | null;
      phone: string;
      roles: string[];
      companyId: string | null;
      companyName: string | null;
    };
  } | null> {
    const tokenHash = ResponsibleAuthChallengeService.hashSessionToken(rawToken);

    const session = await this.prisma.responsibleSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        responsible: {
          // O recorte é o do CADASTRO INTEIRO que a tela usa, e não só o
          // identificador, porque `GET /cliente/auth/eu` é a única fonte da
          // sessão depois de um F5. Com um recorte menor, o portal voltava do
          // recarregamento sem o nome da empresa no cabeçalho e só um login novo
          // o trazia de volta. É uma linha a mais no `select` de uma consulta que
          // já acontece, por índice único, uma vez por requisição.
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            roles: true,
            companyId: true,
            isActive: true,
            company: { select: { fantasyName: true } },
          },
        },
      },
    });

    const now = Date.now();

    if (!session) return null;
    if (session.revokedAt) return null;
    // Ociosidade: passou tempo demais sem aparecer.
    if (session.expiresAt.getTime() <= now) return null;
    // Teto absoluto: existe há tempo demais, por mais que tenha sido usada. Sem
    // esta linha a sessão deslizante seria eterna.
    if (session.createdAt.getTime() + SESSION_MAX_DAYS * DAY_MS <= now) return null;
    if (!session.responsible.isActive) return null;

    return {
      sessionId: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      responsible: {
        id: session.responsible.id,
        name: session.responsible.name,
        email: session.responsible.email,
        phone: session.responsible.phone,
        roles: session.responsible.roles,
        companyId: session.responsible.companyId,
        companyName: session.responsible.company?.fantasyName ?? null,
      },
    };
  }

  /**
   * Carimba o uso e EMPURRA a janela de ociosidade — é o que faz quem usa o
   * portal não precisar entrar de novo.
   *
   * Três cuidados:
   *  • só escreve se o último uso foi há mais de uma hora, senão uma tela com
   *    dez requisições geraria dez UPDATEs na mesma linha;
   *  • nunca empurra além de `createdAt + SESSION_MAX_DAYS` — o teto absoluto é
   *    o que impede a sessão deslizante de virar eterna;
   *  • best-effort: um erro aqui jamais derruba a requisição do cliente, porque
   *    renovar a sessão é conveniência, não autorização.
   */
  async touchSession(
    sessionId: string,
    ipAddress?: string | null,
    session?: { createdAt: Date; lastSeenAt: Date | null },
  ): Promise<void> {
    const now = Date.now();

    if (session?.lastSeenAt && now - session.lastSeenAt.getTime() < TOUCH_THROTTLE_MS) {
      return;
    }

    try {
      const data: { lastSeenAt: Date; ipAddress?: string; expiresAt?: Date } = {
        lastSeenAt: new Date(now),
      };
      if (ipAddress) data.ipAddress = ipAddress;

      if (session) {
        const teto = session.createdAt.getTime() + SESSION_MAX_DAYS * DAY_MS;
        const desejado = now + SESSION_IDLE_DAYS * DAY_MS;
        data.expiresAt = new Date(Math.min(desejado, teto));
      }

      await this.prisma.responsibleSession.update({
        where: { id: sessionId },
        data,
      });
    } catch (error) {
      this.logger.warn(`Falha ao carimbar sessão ${sessionId}: ${(error as Error).message}`);
    }
  }

  /**
   * Revoga. Ao contrário do `logout` antigo — que zerava uma coluna que nenhuma
   * guarda lia, deixando o JWT válido por 7 dias —, aqui a revogação é imediata:
   * a guarda relê a sessão a cada requisição.
   */
  async logout(rawToken: string): Promise<void> {
    const tokenHash = ResponsibleAuthChallengeService.hashSessionToken(rawToken);
    await this.prisma.responsibleSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Derruba todas as sessões de um contato. Usado ao desativar o cadastro. */
  async revokeAll(responsibleId: string): Promise<void> {
    await this.prisma.responsibleSession.updateMany({
      where: { responsibleId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async findByContact(contact: string, byEmail: boolean) {
    if (byEmail) {
      return this.prisma.responsible.findUnique({
        where: { email: contact.toLowerCase() },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
        },
      });
    }

    // O telefone é gravado em formatos variados ao longo dos anos; comparar por
    // dígitos é o que faz "(43) 98863-5657" e "43988635657" serem a mesma
    // pessoa. Casamos pelos ÚLTIMOS 10 dígitos para que quem digita com código
    // de país ("5543988635657") encontre o cadastro que o guarda sem ele.
    //
    // ERA UM `findFirst` SEM `orderBy`, E ISSO É UM DEFEITO LATENTE, NÃO
    // COSMÉTICO. O sufixo de 10 dígitos descarta o primeiro dígito do DDD, então
    // duas pessoas PODEM colidir (DDD 43 e DDD 13 com o mesmo número). O Postgres
    // não garante ordem sem `ORDER BY`, e este método é chamado DUAS VEZES em
    // instantes diferentes: uma ao pedir o código e outra ao resgatá-lo. Se as
    // duas chamadas resolvessem pessoas diferentes, o desafio seria emitido para
    // uma e conferido contra a outra — login impossível, com a mensagem genérica
    // "código inválido" e nada no log explicando.
    //
    // Medi a produção antes de mexer: 181 contatos ativos, ZERO colisões de
    // sufixo hoje. Isto é blindagem, e o `warn` abaixo é para a colisão aparecer
    // no dia em que nascer, em vez de virar um chamado de "não consigo entrar".
    const digits = onlyDigits(contact);
    if (digits.length < 10) return null;

    const candidates = await this.prisma.responsible.findMany({
      where: { phoneNormalized: { endsWith: digits.slice(-10) } },
      // Ordem estável: as duas chamadas do fluxo enxergam a mesma lista.
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
      },
    });

    if (candidates.length <= 1) return candidates[0] ?? null;

    // Houve colisão de sufixo. Quem casar EXATO no que foi digitado ganha — é a
    // resposta certa e determinística para o caso comum de alguém ter digitado o
    // número inteiro.
    const exact = candidates.filter(c => onlyDigits(c.phone) === digits);
    if (exact.length === 1) return exact[0];

    // Ambíguo de verdade: não dá para escolher, e ESCOLHER ERRADO mandaria o
    // código para o telefone de outra pessoa. Recusa — e grita no log, sem o
    // número em claro.
    this.logger.warn(
      `Contato por telefone ambíguo: ${candidates.length} cadastros casam o mesmo ` +
        `sufixo de 10 dígitos e nenhum casa exato. Login recusado; ` +
        `ids: ${candidates.map(c => c.id).join(', ')}`,
    );
    return null;
  }
}
