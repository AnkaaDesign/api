/**
 * Orquestração da cerimônia de assinatura do orçamento.
 *
 * Ciclo de vida:
 *
 *   DRAFT ──create──▶ RUNNING ──todos assinam──▶ COMPLETED ──▶ budgetApprove()
 *                        │
 *                        ├── recusa ─────────▶ REFUSED   (congela os demais)
 *                        ├── deadlineAt ─────▶ EXPIRED
 *                        ├── alteração material ▶ INVALIDATED (assinaturas VOIDED)
 *                        └── cancelamento ───▶ CANCELLED
 *
 * Invariantes:
 *  · `original.pdf` é imutável. Nunca re-renderize o que foi assinado.
 *  · `COMPLETED` ⇒ existe `finalFileId`. A reivindicação de conclusão escreve
 *    COMPLETED antes de o artefato existir; se a montagem falha, o estado é
 *    devolvido para RUNNING (`releaseFinalizationClaim`). Nada no sistema pode
 *    ver "concluído" sem documento — o portal público chega a atestá-lo.
 *  · Todo ato probatório grava evento encadeado ANTES de responder ao cliente.
 *  · O telefone de destino do OTP vem do cadastro e o signatário não o edita —
 *    é isso que dá peso probatório ao código.
 */

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { EnvelopeSignerStatus, EnvelopeStatus, Prisma, SignatureAuthMethod } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { COMPANY } from '@/config/company';
import { formatResponsibleRoles } from '@constants/enums';
import { SignatureAuditService } from './signature-audit.service';
import { SigningChallengeService, SIGNING_CODE_TTL_MINUTES } from './signing-challenge.service';
import {
  QuoteSnapshot,
  QuoteSnapshotService,
  QuoteWithSnapshotGraph,
} from './quote-snapshot.service';
import type { QuoteChange } from './quote-diff';
import { QuoteRendererService } from '../document/quote-renderer.service';
import { QuoteAssemblerService, AssemblerSigner } from '../document/quote-assembler.service';
import { PadesSignerService } from '../pades/pades-signer.service';
import {
  ACCEPTANCE_CLAUSE,
  AUTH_METHOD_LABELS,
  DECLARATIONS,
  DECLARATIONS_VERSION,
  EVENT_DESCRIPTIONS,
  LEGAL_BASIS,
  renderDeclaration,
} from '../signature.constants';
import {
  formatCnpj,
  formatVerificationCode,
  maskCpf,
  isCpfWellFormed,
  maskEmail,
  maskPhone,
  emailMaskParts,
  onlyDigits,
  cpfMaskParts,
} from '../utils/identity';
import {
  generateSignatureInvitationEmail,
  generateSignatureOtpEmail,
  generateAnkaaCountersignEmail,
  generateEnvelopeVoidedEmail,
} from '../../../../templates/signature-emails';
import { sha256Hex } from '../utils/canonical';
import { describeSignatureSecretProblems, inspectSignatureSecrets } from '../utils/secrets';
import {
  formatCurrencyBRL,
  generateGuaranteeText,
  generatePaymentText,
} from '../document/quote-text';

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface EmailSender {
  /** Devolve `false` em qualquer falha; nunca lança. */
  sendEmail(to: string, subject: string, html: string): Promise<boolean>;
}

@Injectable()
export class SignatureEnvelopeService {
  private readonly logger = new Logger(SignatureEnvelopeService.name);

  /**
   * Problemas de configuração dos segredos, apurados uma vez na construção.
   *
   * O `SignatureModule` já derruba o boot quando há algum — isto aqui é a
   * segunda barreira, para o caso de o módulo ser instanciado por um caminho que
   * não passe pelo `onModuleInit` (teste, script, `app.get()` fora do ciclo).
   * Nenhum ato da cerimônia acontece com a lista não-vazia.
   */
  private readonly secretProblems: ReturnType<typeof inspectSignatureSecrets>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: SignatureAuditService,
    private readonly challenges: SigningChallengeService,
    private readonly snapshots: QuoteSnapshotService,
    private readonly renderer: QuoteRendererService,
    private readonly assembler: QuoteAssemblerService,
    private readonly pades: PadesSignerService,
  ) {
    this.secretProblems = inspectSignatureSecrets(key => this.config.get<string>(key));
    if (this.secretProblems.length) {
      this.logger.error(describeSignatureSecretProblems(this.secretProblems));
    }
  }

  /**
   * Recusa qualquer ato da cerimônia enquanto os segredos não estiverem sãos.
   *
   * Chamado ANTES de qualquer efeito colateral — antes de emitir código, antes
   * de consumir OTP, antes de congelar documento. O texto devolvido ao público é
   * genérico de propósito: qual variável falta é assunto do log do servidor, não
   * de um endpoint sem autenticação.
   */
  private assertCeremonyConfigured(): void {
    if (!this.secretProblems.length) return;
    this.logger.error(describeSignatureSecretProblems(this.secretProblems));
    throw new ServiceUnavailableException(
      'Assinatura eletrônica temporariamente indisponível (configuração do servidor). ' +
        'Entre em contato com a Ankaa.',
    );
  }

  /** Injetado tardiamente para não acoplar o módulo ao transporte de e-mail. */
  private mailer: EmailSender | null = null;
  setEmailSender(sender: EmailSender): void {
    this.mailer = sender;
  }

  /**
   * Registrado pelo TaskQuoteModule. Evita que o módulo de assinatura conheça o
   * domínio de orçamento: a conclusão do envelope apenas avisa, e quem decide o
   * que isso significa para o status da quote é o dono daquele domínio.
   */
  private onCompleted:
    | ((quoteId: string, envelopeId: string, actorUserId: string | null) => Promise<void>)
    | null = null;
  setOnEnvelopeCompleted(
    cb: (quoteId: string, envelopeId: string, actorUserId: string | null) => Promise<void>,
  ): void {
    this.onCompleted = cb;
  }

  // ===========================================================================
  // CRIAÇÃO
  // ===========================================================================

  /**
   * Congela o documento e cria o envelope.
   *
   * Recusa-se a congelar quando o render sinaliza transbordo da página de
   * assinaturas: seria assinar um documento com uma linha de assinatura clipada.
   */
  async createEnvelope(args: {
    quoteId: string;
    actorUserId: string;
    ctx: RequestContext;
  }): Promise<{ envelopeId: string; verificationCode: string }> {
    this.assertCeremonyConfigured();

    const loaded = await this.snapshots.buildForQuote(args.quoteId);
    if (!loaded) throw new NotFoundException('Orçamento não encontrado.');
    const { quote, snapshot, hash, materialHash } = loaded;

    const existing = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId: args.quoteId, status: EnvelopeStatus.RUNNING },
    });
    if (existing) {
      throw new BadRequestException(
        'Já existe uma coleta de assinaturas em andamento para este orçamento. ' +
          'Cancele-a antes de emitir outra.',
      );
    }

    // O prazo do envelope é a validade do orçamento. Criar uma coleta sobre um
    // orçamento já vencido produzia um envelope nascido expirado: a página abria
    // com "esta coleta não está mais ativa" e o operador não entendia por quê.
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        `A validade deste orçamento venceu em ${quote.expiresAt.toLocaleDateString('pt-BR')}. ` +
          'Atualize a data de validade antes de enviar para assinatura.',
      );
    }

    const responsibles = quote.task?.responsibles ?? [];
    if (responsibles.length === 0) {
      throw new BadRequestException(
        'Selecione ao menos um responsável na tarefa antes de enviar o orçamento para assinatura.',
      );
    }

    // O e-mail é o canal do convite E do código. Sem ele o responsável entra
    // numa coleta que nunca vai conseguir concluir, e a falha só apareceria
    // lá na frente como INVITATION_FAILED. Barrar aqui é o que mantém o erro
    // perto da causa: falta cadastro.
    const missingEmail = responsibles.filter(r => !r.email?.includes('@'));
    if (missingEmail.length) {
      throw new BadRequestException(
        `Responsáveis sem e-mail válido no cadastro: ${missingEmail
          .map(r => r.name)
          .join(', ')}. O convite e o código de assinatura são enviados ao e-mail cadastrado.`,
      );
    }

    const ankaaUser = await this.resolveAnkaaSigner(quote);

    // O signatário da Ankaa cai no mesmo critério. Não existe fallback para um
    // e-mail institucional aqui de propósito: uma caixa compartilhada enfraquece
    // o argumento de posse do canal que sustenta o valor probatório do código.
    if (!ankaaUser.email?.includes('@')) {
      throw new BadRequestException(
        `O representante da Ankaa (${ankaaUser.name}) está sem e-mail no cadastro. ` +
          'Cadastre o e-mail antes de enviar o orçamento para assinatura.',
      );
    }

    const previous = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId: args.quoteId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });

    const verificationCode = formatVerificationCode(randomBytes(24));

    // Ids dos signatários são necessários ANTES do render (viram os
    // `data-signature-slot`), então são gerados aqui e reusados na persistência.
    const signerSeeds = [
      ...responsibles.map(r => ({
        id: randomUUID(),
        responsibleId: r.id,
        // Âncora de identidade: quando o contato já tem CPF no cadastro, o
        // signatário completa só os dígitos ocultos, e completar certo é o que
        // vale como conferência. Sem CPF cadastrado ele digita o número inteiro
        // — e a primeira assinatura o grava (ver `persistCpfToResponsible`).
        cpf: r.cpf ?? null,
        userId: null as string | null,
        name: r.name,
        phone: onlyDigits(r.phone),
        email: r.email,
        orderGroup: 0,
        side: 'CUSTOMER' as const,
        subtitle: quote.task?.customer?.corporateName ?? quote.task?.customer?.fantasyName ?? '',
      })),
      {
        id: randomUUID(),
        responsibleId: null as string | null,
        // O signatário da Ankaa é um User, que tem CPF próprio — mesma âncora.
        // Não há write-back aqui: o CPF do colaborador é gerido no DP, não numa
        // cerimônia de assinatura.
        cpf: ankaaUser.cpf ?? null,
        userId: ankaaUser.id,
        name: ankaaUser.name,
        phone: onlyDigits(ankaaUser.phone ?? COMPANY.phoneClean),
        email: ankaaUser.email,
        orderGroup: 1,
        side: 'ANKAA' as const,
        subtitle: `${COMPANY.directorTitle} — ${COMPANY.name}`,
      },
    ];

    const rendered = await this.renderQuoteDocument(quote, signerSeeds, verificationCode);

    if (rendered.overflowed) {
      throw new BadRequestException(
        'A página de assinaturas não comporta todos os signatários selecionados. ' +
          'Reduza o número de responsáveis ou fale com o suporte.',
      );
    }

    const supersededIds: Array<{ id: string; version: number }> = [];
    const originalSha256 = sha256Hex(rendered.pdf);
    const fileId = await this.persistPdf(quote, rendered.pdf, 'original', verificationCode);

    const deadlineAt = quote.expiresAt;

    const envelope = await this.prisma.$transaction(async tx => {
      // Reemissão sobre um orçamento JÁ ASSINADO: o anterior passa a
      // `SUPERSEDED`. Sem isto ficavam dois envelopes selados vivos para o mesmo
      // número de orçamento, e `getPublicQuoteSummary` — que ordena por versão —
      // passava a dizer "aguardando assinatura" ao cliente que já tinha
      // assinado, convidando-o a assinar de novo. Se a v2 concluísse, existiriam
      // DOIS artefatos selados com conteúdo diferente para o mesmo orçamento, e
      // `budgetApprove` dispararia duas vezes.
      //
      // Nada é perdido: o artefato do superado continua no disco e todas as
      // leituras de documento chaveiam por `finalFileId`, não por status.
      const supersedable = await tx.signatureEnvelope.findMany({
        where: { quoteId: args.quoteId, status: EnvelopeStatus.COMPLETED },
        select: { id: true, version: true },
      });
      if (supersedable.length) {
        await tx.signatureEnvelope.updateMany({
          where: { id: { in: supersedable.map(e => e.id) } },
          data: { status: EnvelopeStatus.SUPERSEDED },
        });
        supersededIds.push(...supersedable);
      }

      const created = await tx.signatureEnvelope.create({
        data: {
          quoteId: args.quoteId,
          status: EnvelopeStatus.RUNNING,
          version: (previous?.version ?? 0) + 1,
          previousEnvelopeId: previous?.id ?? null,
          sequential: true,
          deadlineAt,
          originalFileId: fileId,
          originalSha256,
          anchors: rendered.anchors as unknown as Prisma.InputJsonValue,
          quoteSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          quoteSnapshotSha256: hash,
          quoteTermsSha256: materialHash,
          verificationCode,
          legalBasis: LEGAL_BASIS,
          acceptanceClause: ACCEPTANCE_CLAUSE,
          createdById: args.actorUserId,
          sentAt: new Date(),
        },
      });

      for (const seed of signerSeeds) {
        await tx.envelopeSigner.create({
          data: {
            id: seed.id,
            envelopeId: created.id,
            responsibleId: seed.responsibleId,
            declaredCpf: seed.cpf ?? null,
            userId: seed.userId,
            orderGroup: seed.orderGroup,
            declaredName: seed.name,
            declaredPhone: seed.phone || null,
            declaredEmail: seed.email ?? null,
            contactSource: 'customer_registry',
            // Também o signatário Ankaa assina pelo link com código no e-mail.
            // Um OTP na caixa do diretor é evidência melhor do que "estava
            // logado no sistema", e mantém uma única cerimônia para todos.
            authMethod: SignatureAuthMethod.EMAIL_OTP,
            accessToken: randomBytes(32).toString('base64url'),
            tokenExpiresAt: deadlineAt,
          },
        });
      }

      return created;
    });

    // Trilha do envelope SUPERADO, fora da transação: `SignatureAuditEvent` é
    // append-only com trigger, e a cadeia de hash é encadeada por envelope — o
    // registro pertence ao antigo, não ao novo. Best-effort: a substituição já
    // está persistida, e falhar aqui não pode desfazer a emissão.
    for (const old of supersededIds) {
      try {
        await this.audit.record(old.id, {
          eventType: 'ENVELOPE_INVALIDATED',
          actorType: 'SYSTEM',
          payload: {
            reason: 'superseded',
            supersededBy: envelope.id,
            supersededByVersion: envelope.version,
            note: 'Nova coleta emitida para o mesmo orçamento. O artefato assinado deste envelope permanece íntegro e verificável.',
          },
        });
      } catch (error) {
        this.logger.warn(
          `Envelope ${old.id} marcado SUPERSEDED, mas o evento de trilha falhou: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    await this.audit.record(envelope.id, {
      eventType: 'ENVELOPE_CREATED',
      actorType: 'OPERATOR',
      actorId: args.actorUserId,
      documentHash: originalSha256,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: {
        version: envelope.version,
        signers: signerSeeds.length,
        contentPages: rendered.contentPages,
        snapshotHash: hash,
      },
    });
    await this.audit.record(envelope.id, {
      eventType: 'DOCUMENT_FROZEN',
      actorType: 'SYSTEM',
      documentHash: originalSha256,
    });

    await this.dispatchInvitations(envelope.id);

    return { envelopeId: envelope.id, verificationCode };
  }

  private async resolveAnkaaSigner(quote: QuoteWithSnapshotGraph) {
    if (quote.commercialUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: quote.commercialUserId },
        select: { id: true, name: true, phone: true, email: true, cpf: true },
      });
      if (user) return user;
    }
    // Sem representante comercial atribuído, cai no diretor configurado. Não há
    // hoje nenhum campo de vendedor responsável em Task/TaskQuote além deste.
    const director = await this.prisma.user.findFirst({
      where: { name: { contains: COMPANY.directorName, mode: 'insensitive' } },
      select: { id: true, name: true, phone: true, email: true, cpf: true },
    });
    if (!director) {
      throw new BadRequestException(
        'Não foi possível determinar o representante comercial da Ankaa para assinar. ' +
          'Defina o responsável comercial no orçamento.',
      );
    }
    return director;
  }

  private async renderQuoteDocument(
    quote: QuoteWithSnapshotGraph,
    signers: Array<{ id: string; name: string; subtitle: string; side: 'ANKAA' | 'CUSTOMER' }>,
    verificationCode: string,
  ) {
    const firstConfig = quote.customerConfigs[0] ?? null;
    const total = Number(quote.total);
    const subtotal = Number(quote.subtotal);

    const discountValue =
      firstConfig?.discountValue != null ? Number(firstConfig.discountValue) : null;
    const discountType = firstConfig?.discountType ?? 'NONE';
    let discountAmount = 0;
    let discountLabel: string | null = null;
    if (discountType === 'PERCENTAGE' && discountValue) {
      discountAmount = Math.round(subtotal * discountValue) / 100;
      discountLabel = `${discountValue}%`;
    } else if (discountType === 'FIXED_VALUE' && discountValue) {
      discountAmount = Math.min(discountValue, subtotal);
      discountLabel = firstConfig?.discountReference ?? null;
    }

    const layoutImages = quote.layoutFiles
      .map(f => this.renderer.resolveLayoutImageDataUri(f))
      .filter((v): v is string => Boolean(v));

    const customer = quote.task?.customer ?? null;

    return this.renderer.render({
      budgetNumber: quote.budgetNumber,
      issuedAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      corporateName: customer?.corporateName ?? customer?.fantasyName ?? null,
      customerDocumentFormatted: customer?.cnpj
        ? formatCnpj(customer.cnpj)
        : (customer?.cpf ?? null),
      contactName: quote.task?.responsibles?.[0]?.name ?? null,
      serialNumber: quote.task?.serialNumber ?? null,
      plate: quote.task?.truck?.plate ?? null,
      chassisNumber: quote.task?.truck?.chassisNumber ?? null,
      truckCategoryLabel: quote.task?.truck?.category ?? null,
      truckImplementLabel: quote.task?.truck?.implementType ?? null,
      services: quote.services.map(s => ({
        description: s.description,
        amount: Number(s.amount),
        observation: s.observation ?? null,
      })),
      subtotal,
      total,
      discountLabel,
      // O builder prefere estes dois e só cai no `discountLabel` legado se faltarem.
      // Sem eles, um desconto PERCENTAGE saía como `Desconto (5%)`, perdendo a
      // referência (`— ESPECIAL`) que o FIXED_VALUE já exibia.
      discountPercent: discountType === 'PERCENTAGE' ? discountValue : null,
      discountReference: firstConfig?.discountReference ?? null,
      discountAmount,
      deliveryDays: quote.customForecastDays ?? null,
      simultaneousTasks: quote.simultaneousTasks ?? null,
      paymentText: generatePaymentText({
        customPaymentText: firstConfig?.customPaymentText ?? null,
        paymentConfig: (firstConfig?.paymentConfig as any) ?? null,
        paymentCondition: firstConfig?.paymentCondition ?? null,
        total,
      }),
      guaranteeText: generateGuaranteeText({
        customGuaranteeText: quote.customGuaranteeText ?? null,
        guaranteeYears: quote.guaranteeYears ?? null,
      }),
      layoutImages,
      signers: signers.map(s => ({
        id: s.id,
        name: s.name,
        subtitle: s.subtitle,
        side: s.side,
      })),
      acceptanceClause: ACCEPTANCE_CLAUSE,
      verificationCode,
      verificationUrl: this.verificationUrl(verificationCode),
    });
  }

  // ===========================================================================
  // CONVITES
  // ===========================================================================

  private async dispatchInvitations(envelopeId: string): Promise<void> {
    const envelope = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: { signers: true, quote: true },
    });
    if (!envelope) return;

    // Sequencial: só o grupo 0 é convidado agora. A Ankaa (grupo 1) assina depois
    // de ver quem assinou do outro lado.
    for (const signer of envelope.signers.filter(s => s.orderGroup === 0)) {
      const { subject, html } = generateSignatureInvitationEmail({
        signerName: signer.declaredName,
        budgetNumber: envelope.quote.budgetNumber,
        signingUrl: this.signingUrl(signer.accessToken),
        deadlineDate: envelope.deadlineAt.toLocaleDateString('pt-BR'),
      });

      const ok = await this.sendEmail(signer.declaredEmail, subject, html, 'SIGNATURE_INVITATION');
      await this.audit.recordBestEffort(envelopeId, {
        eventType: ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
        actorType: 'SYSTEM',
        actorId: signer.id,
        actorLabel: signer.declaredName,
        payload: { channel: 'email', destination: maskEmail(signer.declaredEmail) },
      });
    }
  }

  /**
   * Único ponto de saída de mensagem do fluxo.
   *
   * Devolve boolean e nunca lança: cada chamador decide entre gravar
   * INVITATION_SENT ou INVITATION_FAILED a partir daqui.
   *
   * Atenção ao que `true` significa: o servidor de e-mail ACEITOU a mensagem.
   * Não há webhook de bounce, então uma devolução assíncrona (DSN) é invisível
   * para o sistema. Só rejeição síncrona no SMTP vira `false`.
   */
  private async sendEmail(
    to: string | null | undefined,
    subject: string,
    html: string,
    kind: string,
  ): Promise<boolean> {
    // Guarda explícita: sem ela um destinatário vazio seguiria para o
    // transporte e poderia render um INVITATION_SENT para mensagem que não foi
    // a lugar nenhum.
    if (!to || !to.includes('@')) {
      this.logger.error('Signatário sem e-mail válido — mensagem não enviada.');
      return false;
    }
    if (!this.mailer) {
      this.logger.error('Transporte de e-mail não configurado — mensagem não enviada.');
      return false;
    }
    try {
      return await this.mailer.sendEmail(to, subject, html);
    } catch (error) {
      this.logger.error(
        `Falha ao enviar e-mail (${kind}): ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  // ===========================================================================
  // VISÃO PÚBLICA / ASSINATURA
  // ===========================================================================

  /**
   * Resolve o signatário pelo token do link — o ponto único por onde passam TODAS
   * as rotas públicas por token (estado, PDF, código, assinatura e recusa).
   *
   * É aqui que o prazo do token é conferido, e é de propósito que seja aqui: a
   * validação estava escrita no banco (`tokenExpiresAt`) e nunca era lida em
   * lugar nenhum, o que fazia do link uma capability de leitura PERMANENTE. Um
   * link vazado (encaminhado num grupo de WhatsApp, indexado num histórico de
   * navegador, colado num chamado) continuava servindo o orçamento com preço
   * anos depois de a coleta acabar.
   */
  async getByToken(token: string) {
    const signer = await this.prisma.envelopeSigner.findUnique({
      where: { accessToken: token },
      include: {
        responsible: { select: { roles: true } },
        // O signatário da Ankaa é um User, não um Responsible: sem isto ele não
        // tem cargo de cadastro nenhum e a cerimônia obriga o diretor a digitar
        // o próprio cargo, que o sistema já sabe.
        user: { select: { position: { select: { name: true } }, sector: { select: { name: true } } } },
        envelope: { include: { quote: { include: { task: { include: { customer: true } } } } } },
      },
    });
    if (!signer) throw new NotFoundException('Link de assinatura inválido.');
    this.assertTokenFresh(signer);
    return signer;
  }

  /**
   * Prazo do TOKEN — distinto do prazo do ENVELOPE.
   *
   * Hoje os dois nascem com o mesmo valor (a validade do orçamento), mas são
   * coisas diferentes e a mensagem precisa dizer qual delas venceu:
   *  · envelope vencido  → a coleta acabou para todo mundo;
   *  · token vencido     → este link específico morreu (e é o que acontece
   *    quando um link é revogado individualmente, encurtando `tokenExpiresAt`).
   *
   * Sem a distinção, o operador que revoga um link e o cliente que perdeu o
   * prazo recebem a mesma frase e ninguém sabe o que fazer a seguir.
   */
  private assertTokenFresh(signer: { tokenExpiresAt: Date | null }): void {
    const expiresAt = signer.tokenExpiresAt;
    if (!expiresAt) return;
    if (expiresAt.getTime() >= Date.now()) return;
    throw new ForbiddenException(
      `Este link de assinatura expirou em ${expiresAt.toLocaleDateString('pt-BR')}. ` +
        'Solicite um novo link à Ankaa.',
    );
  }

  /**
   * Estado que a página pública precisa. Devolve apenas o necessário — o link é
   * a credencial, então nada além do próprio documento e da identificação do
   * signatário é exposto.
   */
  async getPublicState(token: string, ctx: RequestContext) {
    const signer = await this.getByToken(token);
    const env = signer.envelope;

    await this.prisma.envelopeSigner.update({
      where: { id: signer.id },
      data: {
        timesViewed: { increment: 1 },
        lastViewedAt: new Date(),
        firstViewedAt: signer.firstViewedAt ?? new Date(),
        status:
          signer.status === EnvelopeSignerStatus.PENDING
            ? EnvelopeSignerStatus.VIEWED
            : signer.status,
      },
    });

    await this.audit.recordBestEffort(env.id, {
      eventType: 'DOCUMENT_VIEWED',
      actorType: 'SIGNER',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      documentHash: env.originalSha256,
    });

    const customer = env.quote.task?.customer ?? null;

    // O signatário que abre um link morto precisa saber POR QUE ele morreu. Sem
    // isto a página dizia apenas "esta coleta não está mais ativa", e quem tinha
    // assinado — e recebeu o e-mail de anulação — não tinha onde conferir o que
    // exatamente havia mudado no orçamento que já lera.
    //
    // Só fora de RUNNING: enquanto a coleta está viva a página mostra o
    // formulário e nunca esta lista (uma divergência MATERIAL já teria tirado o
    // envelope de RUNNING; o que sobra é deriva cosmética, que não é assunto do
    // signatário). Calcular assim mesmo custaria uma leitura do grafo inteiro do
    // orçamento em cada abertura do link — o caminho mais quente da cerimônia.
    const changes =
      env.status === EnvelopeStatus.RUNNING
        ? []
        : (await this.changesSinceFrozen(env.quoteId, [env])).get(env.id) ?? [];

    return {
      envelope: {
        id: env.id,
        status: env.status,
        budgetNumber: env.quote.budgetNumber,
        total: formatCurrencyBRL(Number(env.quote.total)),
        deadlineAt: env.deadlineAt,
        verificationCode: env.verificationCode,
        acceptanceClause: env.acceptanceClause,
        invalidatedReason: env.invalidatedReason,
        changes,
      },
      signer: {
        id: signer.id,
        name: signer.declaredName,
        emailMasked: maskEmail(signer.declaredEmail),
        emailParts: emailMaskParts(signer.declaredEmail),
        cpfParts: signer.declaredCpf ? cpfMaskParts(signer.declaredCpf) : null,
        status: signer.status,
        cargo: signer.informedCargo,
        // Cargo vem do CADASTRO (Responsible.roles), como nome e telefone. O
        // signatário confirma, não digita — mesma lógica que dá peso ao OTP:
        // o que a Ankaa afirma fica registrado ao lado do que ele aceita.
        // Cliente: as funções do contato no cadastro. Ankaa: o cargo do
        // colaborador (posição, ou o setor quando a posição está vazia). Sem o
        // ramo do User, o signatário da Ankaa caía no campo livre e digitava um
        // cargo que o próprio sistema já conhece — e que, digitado à mão, entra
        // na declaração de poderes de representação.
        registryCargo:
          formatResponsibleRoles(signer.responsible?.roles ?? []) ||
          signer.user?.position?.name?.trim() ||
          signer.user?.sector?.name?.trim() ||
          null,
        signedAt: signer.signedAt,
      },
      company: {
        name: customer?.corporateName ?? customer?.fantasyName ?? '',
        cnpj: customer?.cnpj ? formatCnpj(customer.cnpj) : null,
      },
      declarations: DECLARATIONS.map(d => ({
        key: d.key,
        text: renderDeclaration(d.template, {
          budgetNumber: env.quote.budgetNumber,
          total: formatCurrencyBRL(Number(env.quote.total)),
          cargo: signer.informedCargo ?? '{cargo}',
          company: customer?.corporateName ?? customer?.fantasyName ?? '',
        }),
      })),
      canSign: this.canSignNow(env.status, signer.status, env.deadlineAt),
    };
  }

  private canSignNow(
    envStatus: EnvelopeStatus,
    signerStatus: EnvelopeSignerStatus,
    deadlineAt?: Date,
  ): boolean {
    // Inclui o prazo: sem isso a página oferecia o formulário inteiro e só
    // recusava depois de o signatário digitar CPF e cargo.
    if (deadlineAt && deadlineAt.getTime() < Date.now()) return false;
    return (
      envStatus === EnvelopeStatus.RUNNING &&
      (signerStatus === EnvelopeSignerStatus.PENDING ||
        signerStatus === EnvelopeSignerStatus.VIEWED ||
        signerStatus === EnvelopeSignerStatus.AUTHENTICATED)
    );
  }

  /** Etapa 1: identificação + emissão do código. */
  async requestOtp(args: {
    token: string;
    cpf: string;
    cargo: string;
    /** Caracteres ocultos do e-mail, digitados pelo signatário para confirmação. */
    emailConfirm?: string | null;
    ctx: RequestContext;
  }): Promise<{ challengeId: string; destinationMask: string; expiresAt: Date }> {
    this.assertCeremonyConfigured();

    const signer = await this.getByToken(args.token);
    const env = signer.envelope;

    await this.assertSignable(env, signer);

    const cpfDigits = onlyDigits(args.cpf);
    if (!isCpfWellFormed(cpfDigits)) {
      throw new BadRequestException('CPF inválido.');
    }
    if (!args.cargo?.trim()) {
      throw new BadRequestException('Informe seu cargo na empresa.');
    }

    // Confirmação do e-mail ANTES de disparar o código.
    //
    // O endereço é do cadastro e o signatário não pode alterá-lo — é isso que dá
    // peso probatório ao OTP. Mas ele pode CONFIRMAR que o conhece, digitando os
    // caracteres que a máscara esconde. Isso detecta cedo um cadastro errado (o
    // código iria para a caixa de outra pessoa) e é mais um dado ligando o
    // signatário ao canal.
    //
    // Diferente da versão que checava telefone, aqui NÃO se faz fail-open: se o
    // endereço não for mascarável, o pedido é recusado. A checagem anterior era
    // pulada em silêncio quando o telefone era curto ou vazio, e o segundo fator
    // desaparecia sem log nem evento de auditoria.
    const parts = emailMaskParts(signer.declaredEmail);
    if (!parts.domain) {
      this.logger.error(
        `Signatário ${signer.id} sem e-mail mascarável — confirmação impossível.`,
      );
      throw new BadRequestException(
        'O e-mail cadastrado para este signatário é inválido. Fale com a Ankaa.',
      );
    }
    if (parts.hiddenLength > 0) {
      const local = (signer.declaredEmail ?? '').trim().toLowerCase().split('@')[0];
      const hidden = local.slice(parts.prefix.length, local.length - parts.suffix.length);
      const typed = (args.emailConfirm ?? '').trim().toLowerCase();
      if (typed !== hidden) {
        throw new BadRequestException(
          'Os caracteres do e-mail não conferem. Confirme o endereço cadastrado ou fale com a Ankaa.',
        );
      }
    }

    const declaredCpf = signer.declaredCpf ? onlyDigits(signer.declaredCpf) : null;
    const cpfMatch = declaredCpf ? declaredCpf === cpfDigits : null;
    if (declaredCpf && !cpfMatch) {
      throw new BadRequestException(
        'Os dígitos do CPF não conferem com o cadastro. Confira ou fale com a Ankaa.',
      );
    }

    // ORDEM IMPORTA: emitir o desafio ANTES de gravar a identidade.
    //
    // Era o contrário, e isso abria dois furos de uma vez. O primeiro é o M3: a
    // gravação de `informedCpf` acontecia antes de `issue()` recusar por
    // cooldown, então, com um código já em trânsito, uma segunda chamada com
    // OUTRO CPF trocava a identidade sob o código vivo. O segundo é mais
    // prosaico: cada chamada barrada pelo limite ainda assim escrevia no banco e
    // gravava um evento na trilha — que é APPEND-ONLY, ou seja, marteladas no
    // endpoint inchavam a cadeia de auditoria para sempre.
    //
    // Com `issue()` primeiro, cooldown e teto horário barram tudo antes de
    // qualquer escrita, e a identidade só é persistida quando existe um código
    // atado a ela.
    const challenge = await this.challenges.issue({
      signerId: signer.id,
      channel: 'email',
      destinationMask: maskEmail(signer.declaredEmail),
      documentSha256: env.originalSha256,
      identity: cpfDigits,
    });

    await this.prisma.envelopeSigner.update({
      where: { id: signer.id },
      data: {
        informedCpf: cpfDigits,
        informedCargo: args.cargo.trim(),
        cpfMatch,
        // Primeira vez: o cadastro não tinha CPF, então o que ele digitou passa
        // a SER o declarado deste envelope. Sem isto o gate continuaria aceitando
        // qualquer CPF válido nas próximas tentativas do mesmo link.
        ...(declaredCpf ? {} : { declaredCpf: cpfDigits }),
      },
    });

    if (!declaredCpf) await this.persistCpfToResponsible(signer, cpfDigits);

    await this.audit.record(env.id, {
      eventType: 'CPF_SUBMITTED',
      actorType: 'SIGNER',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: {
        cargo: args.cargo.trim(),
        cpfMatch: cpfMatch === null ? 'unknown' : String(cpfMatch),
      },
    });

    if (cpfMatch === false) {
      // Divergência é FATO AUDITÁVEL, não bloqueio: a Ankaa pode ter cadastrado o
      // CPF errado, e barrar aqui destruiria conversão sem ganho probatório.
      await this.audit.record(env.id, {
        eventType: 'CPF_MISMATCH',
        actorType: 'SYSTEM',
        actorId: signer.id,
        payload: { informed: cpfDigits.slice(-4) },
      });
    }

    const otpEmail = generateSignatureOtpEmail({
      signerName: signer.declaredName,
      budgetNumber: env.quote.budgetNumber,
      code: challenge.code,
      expiryMinutes: SIGNING_CODE_TTL_MINUTES,
    });

    // Modo de desenvolvimento: ecoa o código no log em vez de enviar.
    // DUAS travas: só fora de produção E com a flag explícita. Existe para
    // permitir testar a cerimônia inteira sem disparar mensagem para o e-mail
    // real de um cliente. Em produção esta condição é inalcançável.
    const devEcho =
      process.env.NODE_ENV !== 'production' &&
      this.config.get<string>('SIGNATURE_DEV_ECHO_OTP') === 'true';

    let ok: boolean;
    if (devEcho) {
      this.logger.warn(
        `[DEV] Código de assinatura de ${signer.declaredName} (${maskEmail(signer.declaredEmail)}): ` +
          `${challenge.code} — NENHUMA mensagem foi enviada.`,
      );
      ok = true;
    } else {
      ok = await this.sendEmail(
        signer.declaredEmail,
        otpEmail.subject,
        otpEmail.html,
        'SIGNATURE_OTP',
      );
    }
    await this.challenges.markDelivered(challenge.challengeId, null, ok ? 'sent' : 'failed');

    await this.audit.record(env.id, {
      eventType: ok ? 'OTP_SENT' : 'OTP_DELIVERY_FAILED',
      actorType: 'SYSTEM',
      actorId: signer.id,
      payload: { channel: 'email', destination: maskEmail(signer.declaredEmail) },
    });

    if (!ok) {
      // O código não chegou a ninguém: invalida-o em vez de deixá-lo PENDENTE.
      // Um desafio vivo que o signatário nunca viu só serve para confundir a
      // verificação e para bloquear a próxima emissão.
      await this.challenges.supersedeAllForSigner(signer.id);
      throw new BadRequestException(
        'Não foi possível enviar o código para o seu e-mail. Tente novamente em instantes ou fale com a Ankaa.',
      );
    }

    return {
      challengeId: challenge.challengeId,
      destinationMask: maskPhone(signer.declaredPhone),
      expiresAt: challenge.expiresAt,
    };
  }

  /** Etapa 2: validação do código + aplicação da assinatura. */
  async signWithOtp(args: {
    token: string;
    challengeId: string;
    code: string;
    acceptedDeclarationKeys: string[];
    clientTimestamp?: string | null;
    /**
     * Tipo frouxo de propósito: `strictNullChecks` está desligado no projeto, o
     * que faz `z.infer` marcar TODA chave como opcional, e este método também é
     * chamado por script. `normalizeGeo` é quem impõe a forma.
     */
    geo?: { lat?: number; lon?: number; accuracy?: number | null } | null;
    ctx: RequestContext;
  }): Promise<{ status: EnvelopeSignerStatus; envelopeStatus: EnvelopeStatus }> {
    this.assertCeremonyConfigured();

    const signer = await this.getByToken(args.token);
    const env = signer.envelope;

    await this.assertSignable(env, signer);

    const required = DECLARATIONS.map(d => d.key);
    const missing = required.filter(k => !args.acceptedDeclarationKeys.includes(k));
    if (missing.length) {
      throw new BadRequestException('É necessário aceitar todas as declarações para assinar.');
    }
    if (!signer.informedCpf || !signer.informedCargo) {
      throw new BadRequestException('Informe CPF e cargo antes de assinar.');
    }

    // GUARANTIA DE FRESCOR — verificada no momento do ato, não confiando na
    // cobertura dos hooks de escrita.
    //
    // `onQuoteContentChanged` é chamado de UM ponto (TaskQuoteService.update),
    // mas dezenas de caminhos alteram o que o documento exibe: escrita aninhada
    // via PUT /tasks/:id, service-order renomeando serviços, rollback de campo,
    // truck.service, customer.service, responsible.service (que pode até TROCAR
    // O TELEFONE que recebe o OTP), e o backfill automático de CNPJ da
    // conciliação bancária. Perseguir call site por call site não se sustenta.
    //
    // Aqui a pergunta é feita uma vez, no único instante em que a resposta é
    // juridicamente decisiva: as CONDIÇÕES ainda são as que foram congeladas?
    //
    // A pergunta era "o snapshot inteiro ainda é o mesmo?", e por isso qualquer
    // correção de cadastro barrava a assinatura. Quem decide agora é
    // `onQuoteContentChanged`, que só devolve `true` quando de fato invalidou —
    // deriva cosmética é registrada lá dentro e a cerimônia continua.
    const fresh = await this.snapshots.buildForQuote(env.quoteId);
    if (fresh && fresh.hash !== env.quoteSnapshotSha256) {
      const invalidated = await this.onQuoteContentChanged(env.quoteId, null);
      if (invalidated) {
        throw new BadRequestException(
          'O orçamento foi alterado desde o envio. Uma nova versão será enviada para sua revisão.',
        );
      }
    }

    const verdict = await this.challenges.verify({
      signerId: signer.id,
      challengeId: args.challengeId,
      code: args.code,
      expectedDocumentSha256: env.originalSha256,
      // O código só vale para a identidade que o pediu (ver `codeHashFor`).
      identity: signer.informedCpf,
    });

    if (!verdict.ok) {
      const eventType =
        verdict.reason === 'LOCKED'
          ? 'OTP_LOCKED'
          : verdict.reason === 'DOCUMENT_CHANGED'
            ? 'ENVELOPE_INVALIDATED'
            : 'OTP_FAILED';
      await this.audit.record(env.id, {
        eventType: eventType as any,
        actorType: 'SIGNER',
        actorId: signer.id,
        ipAddress: args.ctx.ipAddress,
        userAgent: args.ctx.userAgent,
        payload: { reason: verdict.reason },
      });

      if (verdict.reason === 'LOCKED') {
        throw new BadRequestException(
          'Código bloqueado por excesso de tentativas. Solicite um novo código.',
        );
      }
      if (verdict.reason === 'DOCUMENT_CHANGED') {
        throw new BadRequestException(
          'O orçamento foi alterado. Uma nova versão será enviada para sua revisão.',
        );
      }
      const left = verdict.attemptsLeft ?? 0;
      throw new BadRequestException(
        left > 0
          ? `Código inválido. Tentativas restantes: ${left}.`
          : 'Código inválido ou expirado.',
      );
    }

    await this.audit.record(env.id, {
      eventType: 'OTP_VERIFIED',
      actorType: 'SIGNER',
      actorId: signer.id,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
    });

    const customer = env.quote.task?.customer ?? null;
    const declarations = DECLARATIONS.map(d => ({
      key: d.key,
      // Texto EXATO exibido, nunca um booleano: o que importa em juízo é o que
      // aquela pessoa leu, e o template pode mudar entre versões.
      text: renderDeclaration(d.template, {
        budgetNumber: env.quote.budgetNumber,
        total: formatCurrencyBRL(Number(env.quote.total)),
        cargo: signer.informedCargo,
        company: customer?.corporateName ?? customer?.fantasyName ?? '',
      }),
      acceptedAt: new Date().toISOString(),
      version: DECLARATIONS_VERSION,
    }));

    await this.audit.record(env.id, {
      eventType: 'DECLARATIONS_ACCEPTED',
      actorType: 'SIGNER',
      actorId: signer.id,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: { version: DECLARATIONS_VERSION, count: declarations.length },
    });

    const serverTimestamp = new Date();
    // O carimbo do dispositivo é evidência de skew, não fonte de verdade — e uma
    // string que o `Date` não parseia vira `Invalid Date`, que o driver do Prisma
    // rejeita no meio da gravação da assinatura (500 DEPOIS de o OTP ter sido
    // consumido). O Zod da rota já barra isso; aqui é a rede de baixo, porque
    // este método também é chamado por script e por teste.
    const clientSignedAt = this.parseClientTimestamp(args.clientTimestamp);
    const geo = this.normalizeGeo(args.geo);
    const evidence = {
      envelopeId: env.id,
      signerId: signer.id,
      documentSha256: env.originalSha256,
      declaredName: signer.declaredName,
      declaredPhone: signer.declaredPhone,
      informedCpf: signer.informedCpf,
      informedCargo: signer.informedCargo,
      authMethod: signer.authMethod,
      challengeId: args.challengeId,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      clientTimestamp: clientSignedAt ? clientSignedAt.toISOString() : null,
      serverTimestamp: serverTimestamp.toISOString(),
      // Arredondado a 4 casas (~11m) por minimização — LGPD art. 6º, III.
      geoLat: geo ? Number(geo.lat.toFixed(4)) : null,
      geoLon: geo ? Number(geo.lon.toFixed(4)) : null,
      declarations,
    };

    const evidenceHash = sha256Hex(evidence);
    // Sem `?? ''` e sem ternário: a ausência do segredo NÃO pode virar
    // `hmacSignature = null` em silêncio. `assertCeremonyConfigured()` no topo
    // deste método já garantiu que ele existe; se alguém remover aquela guarda,
    // isto aqui estoura em vez de gravar evidência sem prova de origem.
    const pepper = this.config.get<string>('SIGNATURE_HMAC_SECRET');
    if (!pepper) {
      throw new ServiceUnavailableException(
        'Assinatura eletrônica temporariamente indisponível (configuração do servidor). ' +
          'Entre em contato com a Ankaa.',
      );
    }
    const hmacSignature = createHmac('sha256', pepper).update(evidenceHash).digest('hex');

    await this.prisma.envelopeSigner.update({
      where: { id: signer.id },
      data: {
        status: EnvelopeSignerStatus.SIGNED,
        signedAt: serverTimestamp,
        clientSignedAt,
        ipAddress: args.ctx.ipAddress,
        userAgent: args.ctx.userAgent,
        geoLat: geo ? new Prisma.Decimal(geo.lat.toFixed(6)) : null,
        geoLon: geo ? new Prisma.Decimal(geo.lon.toFixed(6)) : null,
        geoAccuracyM: geo?.accuracy ? Math.round(geo.accuracy) : null,
        geoSource: geo ? 'gps' : 'denied',
        declarations: declarations as unknown as Prisma.InputJsonValue,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        evidenceHash,
        hmacSignature,
      },
    });

    await this.audit.record(env.id, {
      eventType: 'SIGNATURE_APPLIED',
      actorType: 'SIGNER',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      documentHash: env.originalSha256,
      payload: { evidenceHash, cargo: signer.informedCargo },
    });

    const envelopeStatus = await this.advanceEnvelope(env.id);

    return { status: EnvelopeSignerStatus.SIGNED, envelopeStatus };
  }

  /**
   * Recusa explícita — mesma cerimônia da assinatura, sentido oposto.
   *
   * **Exige OTP verificado.** Antes não exigia nada além do link: um POST com
   * `{reason:"x"}` levava o envelope a estado TERMINAL, e como o envelope
   * terminal bloqueia toda assinatura (`assertSignable`) e a criação de uma nova
   * coleta exige cancelar a anterior, qualquer pessoa que recebesse o link
   * encaminhado matava o negócio — anonimamente, e sem que ninguém pudesse
   * depois dizer quem foi.
   *
   * A recusa é um ato jurídico do mesmo peso que a aceitação (CC art. 431: a
   * aceitação fora do prazo ou com modificações importa nova proposta), e a
   * evidência que ela produz precisa ser da mesma qualidade: quem recusou, com
   * qual CPF, de qual IP, com qual motivo, provando posse do telefone cadastrado.
   *
   * O que NÃO é feito de propósito: mexer no status dos demais signatários. O
   * PENDING/VIEWED de quem não fez nada é registro verdadeiro do que aquela
   * pessoa fez, e sobrescrevê-lo com VOIDED apagaria isso. O congelamento vem do
   * envelope em estado terminal, que `assertSignable` já impõe a todos.
   */
  async refuse(args: {
    token: string;
    challengeId: string;
    code: string;
    reason: string;
    ctx: RequestContext;
  }): Promise<void> {
    this.assertCeremonyConfigured();

    const signer = await this.getByToken(args.token);
    const env = signer.envelope;
    await this.assertSignable(env, signer);

    const reason = (args.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('Informe o motivo da recusa.');
    }
    if (!signer.informedCpf || !signer.informedCargo) {
      throw new BadRequestException('Informe CPF e cargo, e solicite o código, antes de recusar.');
    }

    const verdict = await this.challenges.verify({
      signerId: signer.id,
      challengeId: args.challengeId,
      code: args.code,
      expectedDocumentSha256: env.originalSha256,
      identity: signer.informedCpf,
    });

    if (!verdict.ok) {
      await this.audit.record(env.id, {
        eventType: verdict.reason === 'LOCKED' ? 'OTP_LOCKED' : 'OTP_FAILED',
        actorType: 'SIGNER',
        actorId: signer.id,
        ipAddress: args.ctx.ipAddress,
        userAgent: args.ctx.userAgent,
        payload: { reason: verdict.reason, stage: 'refusal' },
      });

      if (verdict.reason === 'LOCKED') {
        throw new BadRequestException(
          'Código bloqueado por excesso de tentativas. Solicite um novo código.',
        );
      }
      if (verdict.reason === 'DOCUMENT_CHANGED') {
        throw new BadRequestException(
          'O orçamento foi alterado. Uma nova versão será enviada para sua revisão.',
        );
      }
      const left = verdict.attemptsLeft ?? 0;
      throw new BadRequestException(
        left > 0
          ? `Código inválido. Tentativas restantes: ${left}.`
          : 'Código inválido ou expirado.',
      );
    }

    await this.audit.record(env.id, {
      eventType: 'OTP_VERIFIED',
      actorType: 'SIGNER',
      actorId: signer.id,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: { stage: 'refusal' },
    });

    // A recusa é atribuída ao SIGNATÁRIO e registrada na trilha encadeada ANTES
    // de o envelope ir para o estado terminal: se a gravação da prova falhar
    // (`record` lança, ao contrário de `recordBestEffort`), o negócio não é
    // morto por um ato que não conseguimos documentar.
    await this.audit.record(env.id, {
      eventType: 'SIGNATURE_REFUSED',
      actorType: 'SIGNER',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      documentHash: env.originalSha256,
      payload: {
        reason,
        cpf: maskCpf(signer.informedCpf),
        cargo: signer.informedCargo,
        challengeId: args.challengeId,
      },
    });

    await this.prisma.$transaction(async tx => {
      await tx.envelopeSigner.update({
        where: { id: signer.id },
        data: {
          status: EnvelopeSignerStatus.REFUSED,
          refusedAt: new Date(),
          refusalReason: reason,
          ipAddress: args.ctx.ipAddress,
          userAgent: args.ctx.userAgent,
        },
      });
      // Reivindicação condicionada ao estado atual, como em `advanceEnvelope`:
      // duas recusas simultâneas (ou uma recusa concorrente com a conclusão) não
      // podem sobrescrever um envelope que já saiu de RUNNING.
      await tx.signatureEnvelope.updateMany({
        where: { id: env.id, status: EnvelopeStatus.RUNNING },
        data: { status: EnvelopeStatus.REFUSED },
      });
    });

    await this.challenges.supersedeAllForEnvelope(env.id);
  }

  /**
   * Geolocalização utilizável ou nada.
   *
   * Meia coordenada não é evidência: `geoSource: 'gps'` com latitude nula
   * afirmaria no dossiê que houve captura de posição quando não houve. Ou os
   * dois números são finitos e estão na faixa, ou o ato é registrado como
   * `denied`, que é o que de fato aconteceu.
   */
  private normalizeGeo(
    geo: { lat?: number; lon?: number; accuracy?: number | null } | null | undefined,
  ): { lat: number; lon: number; accuracy: number | null } | null {
    if (!geo) return null;
    const lat = typeof geo.lat === 'number' && Number.isFinite(geo.lat) ? geo.lat : null;
    const lon = typeof geo.lon === 'number' && Number.isFinite(geo.lon) ? geo.lon : null;
    if (lat === null || lon === null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const accuracy =
      typeof geo.accuracy === 'number' && Number.isFinite(geo.accuracy) && geo.accuracy >= 0
        ? geo.accuracy
        : null;
    return { lat, lon, accuracy };
  }

  /**
   * Carimbo do relógio do dispositivo. Devolve `null` para qualquer coisa que o
   * `Date` não parseie — nunca um `Invalid Date`, que o Prisma rejeita.
   */
  private parseClientTimestamp(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn('clientTimestamp inválido recebido na assinatura — ignorado.');
      return null;
    }
    return parsed;
  }

  private async assertSignable(
    env: { status: EnvelopeStatus; deadlineAt: Date; sequential?: boolean },
    signer: { status: EnvelopeSignerStatus; orderGroup: number; envelopeId: string },
  ): Promise<void> {
    if (env.status !== EnvelopeStatus.RUNNING) {
      throw new ForbiddenException('Esta coleta de assinaturas não está mais ativa.');
    }
    if (env.deadlineAt.getTime() < Date.now()) {
      throw new ForbiddenException('O prazo para assinatura deste orçamento expirou.');
    }
    if (signer.status === EnvelopeSignerStatus.SIGNED) {
      throw new BadRequestException('Você já assinou este orçamento.');
    }
    if (
      signer.status === EnvelopeSignerStatus.REFUSED ||
      signer.status === EnvelopeSignerStatus.VOIDED ||
      signer.status === EnvelopeSignerStatus.EXPIRED
    ) {
      throw new ForbiddenException('Este link de assinatura não está mais válido.');
    }

    // `sequential` era gravado e nunca verificado: o signatário Ankaa (grupo 1)
    // conseguia assinar antes do cliente, justamente o contrário da intenção
    // documentada de assinar por último tendo visto quem assinou do outro lado.
    if (env.sequential !== false && signer.orderGroup > 0) {
      const blocking = await this.prisma.envelopeSigner.count({
        where: {
          envelopeId: signer.envelopeId,
          orderGroup: { lt: signer.orderGroup },
          status: { not: EnvelopeSignerStatus.SIGNED },
        },
      });
      if (blocking > 0) {
        throw new ForbiddenException(
          'Aguarde os responsáveis do cliente assinarem antes de prosseguir.',
        );
      }
    }
  }

  // ===========================================================================
  // AVANÇO / FINALIZAÇÃO
  // ===========================================================================

  /** Libera o grupo seguinte ou finaliza quando todos assinaram. */
  private async advanceEnvelope(envelopeId: string): Promise<EnvelopeStatus> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: { signers: true },
    });
    if (!env) return EnvelopeStatus.CANCELLED;

    const pending = env.signers.filter(s => s.status !== EnvelopeSignerStatus.SIGNED);
    if (pending.length === 0) {
      const outcome = await this.claimAndFinalize(envelopeId);
      if (!outcome.error) return outcome.status;

      // Falha TÉCNICA com a assinatura intacta (o envelope voltou para RUNNING):
      // o ato do signatário está registrado e não deve ser refeito. Dizer-lhe
      // "erro" sem mais nada o faria tentar assinar de novo e receber
      // "Você já assinou este orçamento" — a pior sequência possível.
      if (outcome.status === EnvelopeStatus.RUNNING) {
        throw new ServiceUnavailableException(
          'Sua assinatura foi registrada, mas a emissão do documento final falhou. ' +
            'NÃO é necessário assinar novamente — entre em contato com a Ankaa para concluir a emissão.',
        );
      }
      // Estado terminal (invalidação por alteração material, por exemplo): a
      // mensagem original é a que o signatário precisa ler.
      throw outcome.error;
    }

    // Grupo 0 completo → convida o grupo 1 (Ankaa assina por último, vendo quem
    // assinou do outro lado).
    const group0Pending = pending.filter(s => s.orderGroup === 0);
    if (group0Pending.length === 0) {
      const ankaa = pending.find(s => s.orderGroup === 1);
      if (ankaa && !ankaa.firstViewedAt) {
        await this.notifyAnkaaSigner(env.id, ankaa.id);
      }
    }

    return EnvelopeStatus.RUNNING;
  }

  /**
   * Reivindica a conclusão e monta o artefato.
   *
   * A reivindicação é ATÔMICA (`updateMany` condicionado a `RUNNING`): dois
   * signatários concluindo ao mesmo tempo liam `pending.length === 0` os dois e
   * chamavam `finalize()` em paralelo — dois selos PAdES, duas linhas `File` no
   * MESMO caminho em disco e `budgetApprove` disparado duas vezes.
   *
   * Mas a reivindicação escreve `COMPLETED` ANTES de o documento existir, e é
   * isso que precisa ser desfeito quando a montagem falha. Sem a liberação
   * abaixo, um `finalize()` que estoura (bytes congelados sumidos do disco,
   * pdf-lib recusando um glifo, disco cheio) deixava o envelope **COMPLETED sem
   * artefato nenhum**, para sempre: `cancel()` recusa (só aceita RUNNING),
   * nenhuma rota reexecuta o `finalize()`, `budgetApprove` nunca roda, o
   * orçamento fica inapagável pela política de exclusão — e o portal público
   * `/v/<código>` passa a afirmar "concluído" com `finalSha256` nulo, ou seja,
   * a plataforma atesta um documento selado que não existe.
   *
   * Devolve o erro em vez de propagá-lo para que cada chamador escolha a
   * mensagem: o signatário precisa saber que a assinatura DELE valeu; o
   * operador precisa da causa técnica.
   */
  private async claimAndFinalize(
    envelopeId: string,
  ): Promise<{ status: EnvelopeStatus; error: unknown | null }> {
    const claim = await this.prisma.signatureEnvelope.updateMany({
      where: { id: envelopeId, status: EnvelopeStatus.RUNNING },
      data: { status: EnvelopeStatus.COMPLETED, completedAt: new Date() },
    });
    if (claim.count === 0) {
      // Alguém já reivindicou (ou o envelope saiu de RUNNING por recusa/
      // invalidação). Devolve o estado REAL, não um COMPLETED presumido.
      const current = await this.prisma.signatureEnvelope.findUnique({
        where: { id: envelopeId },
        select: { status: true },
      });
      return { status: current?.status ?? EnvelopeStatus.CANCELLED, error: null };
    }

    try {
      await this.finalize(envelopeId);
      return { status: EnvelopeStatus.COMPLETED, error: null };
    } catch (error) {
      this.logger.error(
        `Falha ao concluir o envelope ${envelopeId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      const status = await this.releaseFinalizationClaim(envelopeId);
      if (status === EnvelopeStatus.RUNNING) {
        // Só registra quando a causa é técnica: a invalidação por alteração
        // material já gravou o seu próprio PADES_FAILED dentro do `finalize()`.
        await this.audit.recordBestEffort(envelopeId, {
          eventType: 'PADES_FAILED',
          actorType: 'SYSTEM',
          payload: {
            stage: 'finalize',
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return { status: status ?? EnvelopeStatus.CANCELLED, error };
    }
  }

  /**
   * Desfaz a reivindicação de conclusão quando não há artefato para sustentá-la.
   *
   * Idempotente e conservadora por construção: se o `finalize()` chegou a gravar
   * `finalFileId`, a conclusão é REAL e nada é tocado; se o envelope já saiu de
   * COMPLETED (invalidado no meio do caminho), o estado atual é respeitado.
   */
  private async releaseFinalizationClaim(envelopeId: string): Promise<EnvelopeStatus | null> {
    const current = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      select: { status: true, finalFileId: true },
    });
    if (!current) return null;
    if (current.finalFileId) return current.status;
    if (current.status !== EnvelopeStatus.COMPLETED) return current.status;

    const released = await this.prisma.signatureEnvelope.updateMany({
      where: { id: envelopeId, status: EnvelopeStatus.COMPLETED, finalFileId: null },
      data: { status: EnvelopeStatus.RUNNING, completedAt: null },
    });
    return released.count ? EnvelopeStatus.RUNNING : current.status;
  }

  /**
   * Retentativa da montagem/selagem, para o operador.
   *
   * Existe porque `finalize()` não tinha NENHUM caminho de reexecução: era
   * chamado de um único ponto, dentro da assinatura do último signatário. Uma
   * falha ali (ou o processo morrendo no meio da selagem) era definitiva.
   *
   * Também REPARA o estado deixado por um processo interrompido: a reivindicação
   * fica `COMPLETED` sem artefato e ninguém a devolve para `RUNNING`.
   */
  async retryFinalize(
    envelopeId: string,
    actorUserId: string,
  ): Promise<{ status: EnvelopeStatus; padesLevel: string | null }> {
    this.assertCeremonyConfigured();

    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: { signers: { select: { status: true } } },
    });
    if (!env) throw new NotFoundException('Envelope não encontrado.');
    if (env.finalFileId) {
      throw new BadRequestException(
        'Este envelope já tem o documento final emitido. Nada a reprocessar.',
      );
    }

    const pending = env.signers.filter(s => s.status !== EnvelopeSignerStatus.SIGNED);
    if (pending.length) {
      throw new BadRequestException(
        `Ainda há ${pending.length} signatário(s) sem assinar — a emissão do documento ` +
          'final só acontece depois que todos assinarem.',
      );
    }
    if (env.status !== EnvelopeStatus.RUNNING && env.status !== EnvelopeStatus.COMPLETED) {
      throw new BadRequestException(
        `Esta coleta está em ${env.status} e não pode ser concluída. Emita uma nova.`,
      );
    }

    await this.releaseFinalizationClaim(envelopeId);

    const outcome = await this.claimAndFinalize(envelopeId);
    if (outcome.error) {
      if (outcome.error instanceof HttpException) throw outcome.error;
      throw new ServiceUnavailableException(
        `Não foi possível emitir o documento final: ${
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
        }`,
      );
    }

    const after = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      select: { status: true, padesLevel: true },
    });
    this.logger.log(`Envelope ${envelopeId} concluído em retentativa por ${actorUserId}.`);
    return { status: after?.status ?? outcome.status, padesLevel: after?.padesLevel ?? null };
  }

  private async notifyAnkaaSigner(envelopeId: string, signerId: string): Promise<void> {
    const signer = await this.prisma.envelopeSigner.findUnique({
      where: { id: signerId },
      include: { envelope: { include: { quote: true } } },
    });
    if (!signer) return;
    const { subject, html } = generateAnkaaCountersignEmail({
      signerName: signer.declaredName,
      budgetNumber: signer.envelope.quote.budgetNumber,
      signingUrl: this.signingUrl(signer.accessToken),
    });
    const ok = await this.sendEmail(
      signer.declaredEmail,
      subject,
      html,
      'SIGNATURE_ANKAA_NOTICE',
    );
    await this.audit.recordBestEffort(envelopeId, {
      eventType: ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
      actorType: 'SYSTEM',
      actorId: signerId,
      actorLabel: signer.declaredName,
      payload: { stage: 'ankaa', channel: 'email', destination: maskEmail(signer.declaredEmail) },
    });
  }

  /**
   * Monta o artefato final e aplica o selo PAdES.
   *
   * O selo é o ÚLTIMO passo. Falha na selagem não perde a assinatura: o documento
   * montado é persistido mesmo assim, com evento PADES_FAILED, para retentativa.
   */
  async finalize(envelopeId: string): Promise<void> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: {
        signers: { orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }] },
        quote: { include: { task: { include: { customer: true } } } },
        originalFile: true,
      },
    });
    if (!env) throw new NotFoundException('Envelope não encontrado.');

    const { readFileSync } = await import('fs');
    const originalPdf = readFileSync(env.originalFile.path);

    // Confere que os bytes em disco continuam sendo os que foram assinados.
    const onDiskHash = sha256Hex(originalPdf);
    if (onDiskHash !== env.originalSha256) {
      await this.audit.record(envelopeId, {
        eventType: 'PADES_FAILED',
        actorType: 'SYSTEM',
        payload: { reason: 'original_hash_mismatch', onDisk: onDiskHash },
      });
      throw new BadRequestException(
        'O documento original em disco não confere com o hash registrado. Selagem abortada.',
      );
    }

    // Mesma guarda antes de SELAR: um selo PAdES sobre condições obsoletas seria
    // uma afirmação criptográfica falsa sobre o conteúdo do contrato.
    //
    // Aqui NÃO dá para delegar a `onQuoteContentChanged`: `claimAndFinalize` já
    // tirou o envelope de `RUNNING`, e aquele método só enxerga `RUNNING`. Então
    // o nível é decidido no local, com o mesmo recorte material.
    const freshAtSeal = await this.snapshots.buildForQuote(env.quoteId);
    const frozenTermsAtSeal =
      env.quoteTermsSha256 ??
      this.snapshots.materialHash(env.quoteSnapshot as unknown as QuoteSnapshot);

    // Mesma razão do `checkAndInvalidate`: aceitar qualquer versão conhecida,
    // senão um envelope pré-v2 se recusaria a selar com TODAS as assinaturas já
    // colhidas — o pior desfecho possível deste fluxo.
    const sealTermsUnchanged =
      !!freshAtSeal &&
      this.snapshots.matchesFrozenTerms(freshAtSeal.snapshot, frozenTermsAtSeal) !== null;

    if (freshAtSeal && freshAtSeal.hash !== env.quoteSnapshotSha256 && sealTermsUnchanged) {
      // Deriva cosmética às vésperas do selo: o PDF em disco é o mesmo, o hash
      // do arquivo confere (a guarda acima já verificou) e as condições não se
      // moveram. Registra e SELA — abortar aqui deixaria um envelope com todas
      // as assinaturas colhidas e nenhum artefato, por causa de um typo.
      const cosmetic = this.snapshots.classify(
        env.quoteSnapshot as unknown as QuoteSnapshot,
        freshAtSeal.snapshot,
      ).cosmetic;
      await this.recordDriftOnce(envelopeId, freshAtSeal.hash, cosmetic, null);
    } else if (freshAtSeal && !sealTermsUnchanged) {
      await this.audit.record(envelopeId, {
        eventType: 'PADES_FAILED',
        actorType: 'SYSTEM',
        payload: { reason: 'snapshot_stale_at_seal' },
      });
      // A liberação vem ANTES da invalidação, e não é opcional:
      // `onQuoteContentChanged` só enxerga envelopes `RUNNING`, e a
      // reivindicação de `claimAndFinalize` já tirou este daqui desse estado.
      // Sem esta linha a invalidação era um no-op silencioso — o envelope ficava
      // COMPLETED, sem artefato, com as assinaturas ainda válidas sobre um
      // conteúdo que mudou, e a mensagem abaixo ("a coleta foi invalidada")
      // simplesmente mentia.
      await this.releaseFinalizationClaim(envelopeId);
      await this.onQuoteContentChanged(env.quoteId, null);
      throw new BadRequestException(
        'O orçamento foi alterado antes da conclusão. A coleta foi invalidada.',
      );
    }

    const customer = env.quote.task?.customer ?? null;
    const companyLabel = customer?.corporateName ?? customer?.fantasyName ?? null;

    const assemblerSigners: AssemblerSigner[] = env.signers.map(s => ({
      id: s.id,
      name: s.declaredName,
      cargo: s.informedCargo,
      companyLabel: s.orderGroup === 1 ? COMPANY.name : companyLabel,
      cpf: s.informedCpf,
      phone: s.declaredPhone,
      signedAt: s.signedAt,
      status: s.status,
      authMethodLabel: AUTH_METHOD_LABELS[s.authMethod] ?? s.authMethod,
      ipAddress: s.ipAddress,
      side: s.orderGroup === 1 ? 'ANKAA' : 'CUSTOMER',
    }));

    const anchors = env.anchors as any;
    const verificationUrl = this.verificationUrl(env.verificationCode);

    const stamped = await this.assembler.stampSeals({
      originalPdf,
      anchors,
      signers: assemblerSigners,
      budgetNumber: env.quote.budgetNumber,
      verificationCode: env.verificationCode,
      verificationUrl,
      originalSha256: env.originalSha256,
    });

    const events = await this.audit.getTrail(envelopeId);
    const chainTip = await this.audit.getChainTip(envelopeId);

    const auditPages = await this.assembler.buildAuditPages({
      originalPdf,
      anchors,
      signers: assemblerSigners,
      events: events.map(e => ({
        sequence: e.sequence,
        occurredAt: e.occurredAt,
        description: EVENT_DESCRIPTIONS[e.eventType] ?? e.eventType,
        ipAddress: e.ipAddress,
        hash: e.hash,
      })),
      budgetNumber: env.quote.budgetNumber,
      envelopeId: env.id,
      verificationCode: env.verificationCode,
      verificationUrl,
      originalSha256: env.originalSha256,
      chainTip,
      acceptanceClause: env.acceptanceClause,
    });

    let finalPdf = await this.assembler.mergeWithAudit(stamped, auditPages);

    await this.audit.record(envelopeId, {
      eventType: 'DOCUMENT_ASSEMBLED',
      actorType: 'SYSTEM',
      payload: { bytes: finalPdf.length },
    });

    // ---- Selo PAdES (último passo) ----
    let padesLevel: string | null = null;
    let certMeta: Record<string, unknown> = {};
    if (this.pades.isEnabled()) {
      try {
        const sealed = await this.pades.sealPdf(finalPdf, {
          reason: `Orçamento nº ${env.quote.budgetNumber} — envelope ${env.verificationCode}`,
          location: COMPANY.signatureLocation,
          signerName: this.pades.getCertMetadata()?.subjectCommonName ?? COMPANY.corporateName,
          contactInfo: COMPANY.email,
        });
        finalPdf = sealed.signedPdf;
        padesLevel = sealed.level;
        certMeta = {
          certSubject: sealed.cert.subject,
          certIssuer: sealed.cert.issuer,
          certSerialNumber: sealed.cert.serialNumber,
          certCnpj: sealed.cert.cnpj,
          certNotAfter: sealed.cert.notAfter,
          tsaUrl: sealed.tsaUrl,
          tsaGenTime: sealed.tsaGenTime,
        };
        await this.audit.record(envelopeId, {
          eventType: 'PADES_SEALED',
          actorType: 'SYSTEM',
          payload: { level: sealed.level, serial: sealed.cert.serialNumber },
        });
        if (sealed.level === 'B-T') {
          await this.audit.record(envelopeId, {
            eventType: 'TSA_STAMPED',
            actorType: 'SYSTEM',
            payload: { tsa: sealed.tsaUrl ?? '', genTime: sealed.tsaGenTime?.toISOString() ?? '' },
          });
        } else if (sealed.tsaError) {
          await this.audit.record(envelopeId, {
            eventType: 'TSA_FAILED',
            actorType: 'SYSTEM',
            payload: { error: sealed.tsaError },
          });
        }
      } catch (error) {
        this.logger.error(
          `Falha ao selar o envelope ${envelopeId}: ${error instanceof Error ? error.message : error}`,
        );
        await this.audit.record(envelopeId, {
          eventType: 'PADES_FAILED',
          actorType: 'SYSTEM',
          payload: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    const finalSha256 = sha256Hex(finalPdf);
    const finalFileId = await this.persistPdf(
      env.quote as any,
      finalPdf,
      'assinado',
      env.verificationCode,
    );

    await this.prisma.signatureEnvelope.update({
      where: { id: envelopeId },
      data: {
        status: EnvelopeStatus.COMPLETED,
        completedAt: new Date(),
        finalFileId,
        finalSha256,
        sealedAt: padesLevel ? new Date() : null,
        padesLevel,
        ...certMeta,
      },
    });

    await this.audit.record(envelopeId, {
      eventType: 'DOCUMENT_FINALIZED',
      actorType: 'SYSTEM',
      documentHash: finalSha256,
      payload: { padesLevel: padesLevel ?? 'none' },
    });

    // A assinatura do cliente É a aprovação do orçamento. Roteia pelo
    // `budgetApprove()` do domínio, e não por uma escrita direta de status, para
    // que o gate de layout, o dispatch de `task_quote.budget_approved` e o
    // `syncEmNegociacaoForTask` continuem valendo. Best-effort: um erro aqui não
    // pode desfazer assinaturas já coletadas e seladas.
    if (this.onCompleted) {
      try {
        await this.onCompleted(env.quoteId, envelopeId, env.createdById);
      } catch (error) {
        this.logger.error(
          `Envelope ${envelopeId} concluído, mas a aprovação do orçamento falhou: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
  }

  // ===========================================================================
  // INVALIDAÇÃO POR ALTERAÇÃO MATERIAL
  // ===========================================================================

  /**
   * O que mudou no orçamento desde que cada envelope foi congelado.
   *
   * CALCULADO NA LEITURA, NÃO GUARDADO. Poderia ser uma coluna gravada no
   * momento da invalidação, e a primeira versão disto era — mas essa lista
   * envelhece errado em três situações que acontecem toda semana:
   *
   *  · o operador invalida, corrige mais três coisas e só então reemite: a
   *    coluna contaria a primeira alteração e esconderia as outras três;
   *  · o envelope já está CONCLUÍDO e o orçamento muda depois: nada invalida
   *    (e está certo, o PDF assinado é imutável), mas ninguém ficava sabendo
   *    que o registro atual não é mais o que foi assinado;
   *  · envelopes anteriores ao recurso não teriam coluna nenhuma.
   *
   * Sempre comparando contra o snapshot ATUAL, as três se resolvem sozinhas e
   * não há migração. O custo é uma leitura do grafo do orçamento por chamada —
   * a mesma que a cerimônia já faz a cada assinatura.
   *
   * Best-effort por construção: esta lista é informativa. Se o snapshot
   * congelado for de um formato que o diff não entende, a resposta sai sem ela
   * em vez de derrubar a página.
   */
  private async changesSinceFrozen(
    quoteId: string,
    envelopes: Array<{ id: string; quoteSnapshot: unknown; quoteSnapshotSha256: string }>,
  ): Promise<Map<string, QuoteChange[]>> {
    const out = new Map<string, QuoteChange[]>();
    if (!envelopes.length) return out;

    let fresh: Awaited<ReturnType<QuoteSnapshotService['buildForQuote']>> = null;
    try {
      fresh = await this.snapshots.buildForQuote(quoteId);
    } catch (error) {
      this.logger.warn(
        `Não foi possível recalcular o snapshot do orçamento ${quoteId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
    if (!fresh) return out;

    for (const env of envelopes) {
      // Atalho: hash igual ⇒ nada no documento mudou, nem cosmético.
      if (env.quoteSnapshotSha256 === fresh.hash) {
        out.set(env.id, []);
        continue;
      }
      try {
        out.set(
          env.id,
          this.snapshots.changes(env.quoteSnapshot as QuoteSnapshot, fresh.snapshot),
        );
      } catch (error) {
        this.logger.warn(
          `Diff do envelope ${env.id} falhou: ${error instanceof Error ? error.message : error}`,
        );
        out.set(env.id, []);
      }
    }
    return out;
  }

  /**
   * Chamado após qualquer escrita no orçamento.
   *
   * Compara o hash do recorte canônico atual com o congelado. Divergiu ⇒ o
   * documento que os signatários viram não é mais o que o sistema guarda, então o
   * envelope é invalidado, as assinaturas coletadas viram VOIDED (mas continuam
   * registradas — alguém DE FATO assinou a v1, e isso é um fato que importa) e
   * quem já havia assinado é avisado.
   *
   * Base: OWASP Transaction Authorization §2.6 e CC art. 431 (aceitação com
   * modificações importa nova proposta).
   */
  async onQuoteContentChanged(quoteId: string, actorUserId: string | null): Promise<boolean> {
    const running = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId, status: EnvelopeStatus.RUNNING },
      // `quote` entra aqui porque o aviso de invalidação identifica o orçamento
      // pelo número; sem o include ele sairia com um travessão no lugar.
      include: { signers: true, quote: true },
    });
    if (!running) return false;

    const loaded = await this.snapshots.buildForQuote(quoteId);
    if (!loaded) return false;

    // Atalho barato: nada no documento mudou, nem cosmético nem material.
    if (loaded.hash === running.quoteSnapshotSha256) return false;

    const before = running.quoteSnapshot as any;
    const changes = this.snapshots.classify(before, loaded.snapshot);

    // O baseline material dos envelopes criados antes desta coluna existir é
    // derivado do snapshot congelado — o mesmo cálculo que a migração faz. Sem
    // este fallback um envelope pré-migração cairia no ramo cosmético e NUNCA
    // invalidaria, que é o erro perigoso desta mudança (o outro só irrita).
    const frozenTermsHash =
      running.quoteTermsSha256 ?? this.snapshots.materialHash(before as QuoteSnapshot);

    // Casa em QUALQUER versão conhecida do recorte material, não só na atual.
    //
    // A v2 trocou o canal do OTP de telefone para e-mail. Comparar um envelope
    // congelado sob a v1 contra a projeção v2 daria diferença sempre — e todos
    // os envelopes vivos seriam invalidados no deploy por uma mudança que, para
    // eles, nunca foi material.
    const matchedVersion = this.snapshots.matchesFrozenTerms(loaded.snapshot, frozenTermsHash);

    if (matchedVersion !== null) {
      // DERIVA COSMÉTICA — o documento congelado em disco não mudou uma vírgula,
      // e as condições aceitas continuam as mesmas. Registra e segue.
      //
      // Este é exatamente o caminho do nº 590: "Paulo Cvarvalho" → "Paulo
      // Carvalho" derrubava uma assinatura válida. Corrigir cadastro não pode
      // custar assinatura.
      if (changes.cosmetic.length) {
        await this.recordDriftOnce(running.id, loaded.hash, changes.cosmetic, actorUserId);
      }
      return false;
    }

    const materialEntries = changes.entries.filter(c => c.severity === 'MATERIAL');
    // Uma frase, com no máximo quatro itens — cabe no aviso de uma linha da tela
    // e no parágrafo do e-mail. A lista inteira e detalhada é servida pelas
    // rotas de leitura (`changes`), que é onde há espaço para ela.
    const reason = this.snapshots.describeMaterial(changes.entries);

    await this.prisma.$transaction(async tx => {
      await tx.envelopeSigner.updateMany({
        where: { envelopeId: running.id, status: { not: EnvelopeSignerStatus.REFUSED } },
        data: { status: EnvelopeSignerStatus.VOIDED },
      });
      await tx.signatureEnvelope.update({
        where: { id: running.id },
        data: { status: EnvelopeStatus.INVALIDATED, invalidatedReason: reason },
      });
    });

    await this.challenges.supersedeAllForEnvelope(running.id);

    await this.audit.record(running.id, {
      eventType: 'ENVELOPE_INVALIDATED',
      actorType: actorUserId ? 'OPERATOR' : 'SYSTEM',
      actorId: actorUserId,
      payload: {
        reason,
        newSnapshotHash: loaded.hash,
        newTermsHash: loaded.materialHash,
        // Uma linha por alteração, com assunto e antes → depois — o mesmo texto
        // que o e-mail e a tela mostram, agora que `describeQuoteChange` o
        // produz. Antes daqui saía "serviços", e a trilha, que é append-only,
        // ficava para sempre sem dizer QUAL serviço nem o quê nele mudou.
        //
        // Continua sendo TEXTO, não o objeto estruturado: o payload da trilha é
        // escalar por construção (é ele que entra no hash encadeado), e a lista
        // estruturada as rotas de leitura recalculam quando alguém pergunta.
        changes: changes.material.join(' | '),
        // Cosméticas viajam junto para que a trilha explique a mudança INTEIRA,
        // e não só a parte que puxou o gatilho.
        cosmeticChanges: changes.cosmetic.join(' | ') || undefined,
      },
    });

    // Avisa TODOS os signatários ainda ativos, não só quem já tinha assinado.
    //
    // Quem estava pendente recebeu um convite e continua com um link na caixa de
    // entrada — link que acabou de morrer. Sem aviso, essa pessoa volta ao
    // endereço mais tarde e encontra "esta coleta não está mais ativa", sem
    // nenhuma explicação e sem saber que uma nova versão está a caminho.
    //
    // REFUSED fica de fora: quem recusou já encerrou a participação, e é o mesmo
    // recorte que o `updateMany` acima usa para não sobrescrever a recusa.
    const toNotify = running.signers.filter(s => s.status !== EnvelopeSignerStatus.REFUSED);
    for (const s of toNotify) {
      const { subject, html } = generateEnvelopeVoidedEmail({
        signerName: s.declaredName,
        budgetNumber: running.quote?.budgetNumber ?? '—',
        reason,
        hadSigned: !!s.signedAt,
        // O e-mail leva a lista item a item. Quem assinou e teve a assinatura
        // anulada não deveria precisar abrir um link para descobrir qual preço
        // mudou — a informação vai junto com a notícia.
        changes: materialEntries.map(c => ({
          label: c.label,
          subject: c.subject,
          before: c.before,
          after: c.after,
        })),
      });
      const notified = await this.sendEmail(
        s.declaredEmail,
        subject,
        html,
        'SIGNATURE_VOIDED',
      );
      // SIGNER_VOIDED só para quem tinha assinatura a perder: é esse o fato
      // probatório. Para os pendentes o aviso é cortesia, e o ENVELOPE_INVALIDATED
      // já registra a mudança de estado da coleta inteira.
      if (s.signedAt) {
        await this.audit.recordBestEffort(running.id, {
          eventType: 'SIGNER_VOIDED',
          actorType: 'SYSTEM',
          actorId: s.id,
          actorLabel: s.declaredName,
          // Antes o resultado do envio era descartado e o evento gravado de
          // qualquer forma: a trilha afirmava que o signatário foi avisado sem
          // que nada garantisse isso.
          payload: { channel: 'email', notified },
        });
      } else if (!notified) {
        this.logger.warn(
          `Signatário pendente ${s.id} não pôde ser avisado da invalidação do envelope ${running.id}.`,
        );
      }
    }

    this.logger.warn(`Envelope ${running.id} invalidado — ${reason}`);
    return true;
  }

  /**
   * Registra deriva cosmética UMA vez por hash.
   *
   * A checagem de frescor roda a cada visualização, submissão de CPF e tentativa
   * de assinatura. Sem esta deduplicação, um nome corrigido gravaria um evento a
   * cada abertura do link — e a trilha é APPEND-ONLY, com hash encadeado: lixo
   * ali fica para sempre e ainda encarece toda verificação futura da cadeia.
   */
  private async recordDriftOnce(
    envelopeId: string,
    newSnapshotHash: string,
    cosmeticChanges: string[],
    actorUserId: string | null,
  ): Promise<void> {
    const already = await this.prisma.signatureAuditEvent.findFirst({
      where: {
        envelopeId,
        eventType: 'SNAPSHOT_DRIFTED',
        payload: { path: ['newSnapshotHash'], equals: newSnapshotHash },
      },
      select: { id: true },
    });
    if (already) return;

    await this.audit.recordBestEffort(envelopeId, {
      eventType: 'SNAPSHOT_DRIFTED',
      actorType: actorUserId ? 'OPERATOR' : 'SYSTEM',
      actorId: actorUserId,
      payload: { newSnapshotHash, changes: cosmeticChanges.join(' | ') },
    });

    this.logger.log(
      `Envelope ${envelopeId}: deriva cosmética registrada, coleta preservada — ${cosmeticChanges.join(' | ')}`,
    );
  }

  /** Cancelamento manual pelo operador. */
  async cancel(envelopeId: string, actorUserId: string, ctx: RequestContext): Promise<void> {
    const env = await this.prisma.signatureEnvelope.findUnique({ where: { id: envelopeId } });
    if (!env) throw new NotFoundException('Envelope não encontrado.');
    if (env.status !== EnvelopeStatus.RUNNING) {
      throw new BadRequestException('Somente uma coleta em andamento pode ser cancelada.');
    }
    await this.prisma.$transaction(async tx => {
      await tx.envelopeSigner.updateMany({
        where: { envelopeId, status: { not: EnvelopeSignerStatus.SIGNED } },
        data: { status: EnvelopeSignerStatus.VOIDED },
      });
      await tx.signatureEnvelope.update({
        where: { id: envelopeId },
        data: { status: EnvelopeStatus.CANCELLED },
      });
    });
    await this.challenges.supersedeAllForEnvelope(envelopeId);
    await this.audit.record(envelopeId, {
      eventType: 'ENVELOPE_CANCELLED',
      actorType: 'OPERATOR',
      actorId: actorUserId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ===========================================================================
  // DOCUMENTO SERVIDO
  // ===========================================================================

  /**
   * PDF servido "ao vivo": os bytes congelados + os selos de quem já assinou.
   *
   * Os slots pendentes continuam em branco, então o documento sempre mostra o
   * estado real da coleta — que é o que o cliente precisa ver. O original nunca
   * muda; a sobreposição é recalculada a cada requisição.
   */
  async renderServedDocument(envelopeId: string): Promise<{ pdf: Buffer; etag: string }> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: {
        signers: { orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }] },
        quote: { include: { task: { include: { customer: true } } } },
        originalFile: true,
        finalFile: true,
      },
    });
    if (!env) throw new NotFoundException('Envelope não encontrado.');

    const { readFileSync, existsSync } = await import('fs');

    if (!existsSync(env.originalFile.path)) {
      throw new NotFoundException(
        'O documento congelado deste envelope não está mais disponível em disco. ' +
          'Reemita a coleta de assinaturas.',
      );
    }

    // Concluído: serve o artefato selado, nunca uma remontagem.
    if (env.status === EnvelopeStatus.COMPLETED && env.finalFile) {
      const pdf = readFileSync(env.finalFile.path);
      return { pdf, etag: `"${env.finalSha256}"` };
    }

    const originalPdf = readFileSync(env.originalFile.path);
    const customer = env.quote.task?.customer ?? null;
    const companyLabel = customer?.corporateName ?? customer?.fantasyName ?? null;

    const pdf = await this.assembler.stampSeals({
      originalPdf,
      anchors: env.anchors as any,
      signers: env.signers.map(s => ({
        id: s.id,
        name: s.declaredName,
        cargo: s.informedCargo,
        companyLabel: s.orderGroup === 1 ? COMPANY.name : companyLabel,
        cpf: s.informedCpf,
        phone: s.declaredPhone,
        signedAt: s.signedAt,
        status: s.status,
        authMethodLabel: AUTH_METHOD_LABELS[s.authMethod] ?? s.authMethod,
        ipAddress: s.ipAddress,
        side: s.orderGroup === 1 ? 'ANKAA' : 'CUSTOMER',
      })),
      budgetNumber: env.quote.budgetNumber,
      verificationCode: env.verificationCode,
      verificationUrl: this.verificationUrl(env.verificationCode),
      originalSha256: env.originalSha256,
    });

    // ETag deriva do original + do estado de assinatura, então muda exatamente
    // quando o documento servido muda.
    const stateKey = env.signers.map(s => `${s.id}:${s.signedAt?.toISOString() ?? ''}`).join('|');
    return { pdf, etag: `"${sha256Hex(env.originalSha256 + stateKey).slice(0, 32)}"` };
  }

  // ===========================================================================
  // VERIFICAÇÃO PÚBLICA
  // ===========================================================================

  async getVerificationByCode(code: string, ctx: RequestContext) {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { verificationCode: code },
      include: {
        signers: { orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }] },
        quote: { include: { task: { include: { customer: true } } } },
      },
    });
    if (!env) throw new NotFoundException('Código de verificação não encontrado.');

    await this.audit.recordBestEffort(env.id, {
      eventType: 'VERIFICATION_VIEWED',
      actorType: 'SYSTEM',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const chain = await this.audit.verifyChain(env.id);
    const customer = env.quote.task?.customer ?? null;

    return {
      verificationCode: env.verificationCode,
      status: env.status,
      budgetNumber: env.quote.budgetNumber,
      issuer: { name: COMPANY.corporateName, cnpj: COMPANY.cnpjFormatted },
      customer: {
        name: customer?.corporateName ?? customer?.fantasyName ?? null,
        cnpj: customer?.cnpj ? formatCnpj(customer.cnpj) : null,
      },
      originalSha256: env.originalSha256,
      finalSha256: env.finalSha256,
      sealedAt: env.sealedAt,
      padesLevel: env.padesLevel,
      certSerialNumber: env.certSerialNumber,
      auditChain: { valid: chain.valid, events: chain.eventCount, reason: chain.reason },
      // CPF sempre MASCARADO aqui: esta página é pública e o orçamento contém preço.
      signers: env.signers.map(s => ({
        name: s.declaredName,
        cargo: s.informedCargo,
        cpfMasked: s.informedCpf ? maskCpf(s.informedCpf) : null,
        // O CPF do CADASTRO, separado do informado. O painel só lia
        // `informedCpf` — que só existe DEPOIS da cerimônia —, então um
        // signatário que ainda não assinou aparecia como "CPF não informado"
        // mesmo com o documento gravado no cadastro desde a emissão. São dois
        // fatos diferentes e a tela precisa distinguir: o que a Ankaa afirma, e
        // o que o signatário confirmou.
        declaredCpfMasked: s.declaredCpf ? maskCpf(s.declaredCpf) : null,
        status: s.status,
        signedAt: s.signedAt,
        authMethod: AUTH_METHOD_LABELS[s.authMethod] ?? s.authMethod,
      })),
    };
  }

  /**
   * Resumo público da coleta, chaveado pelo id do orçamento.
   *
   * Alimenta a página `/cliente/orcamento/:id`, cuja capability já é o próprio
   * UUID do orçamento — e que já exibe preço. Por isso este resumo é servido no
   * mesmo escopo, e NÃO pelo código de verificação: aquele código é impresso em
   * todas as páginas do PDF e circula muito mais longe.
   *
   * Devolve apenas nome e estado de cada signatário. Nada de CPF, telefone ou
   * token de acesso.
   */
  async getPublicQuoteSummary(quoteId: string) {
    const env = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId },
      orderBy: { version: 'desc' },
      include: { signers: { orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!env) return { hasEnvelope: false as const };

    const changes = (await this.changesSinceFrozen(quoteId, [env])).get(env.id) ?? [];

    return {
      hasEnvelope: true as const,
      status: env.status,
      version: env.version,
      verificationCode: env.verificationCode,
      deadlineAt: env.deadlineAt,
      completedAt: env.completedAt,
      sealedAt: env.sealedAt,
      padesLevel: env.padesLevel,
      invalidatedReason: env.invalidatedReason,
      /**
       * O cliente vê a MESMA lista que o operador vê. Não há versão suavizada:
       * quem teve a assinatura anulada tem direito de saber exatamente qual
       * preço mudou, e esconder o detalhe é o oposto da boa-fé que sustenta a
       * cerimônia inteira.
       */
      changes,
      signers: env.signers.map(s => ({
        name: s.declaredName,
        cargo: s.informedCargo,
        side: s.orderGroup === 1 ? 'ANKAA' : 'CUSTOMER',
        status: s.status,
        signedAt: s.signedAt,
      })),
    };
  }

  /**
   * Documento da coleta corrente do orçamento (selado quando concluída).
   *
   * SEM envelope nenhum, cai no orçamento renderizado sob demanda — mesma
   * decisão já tomada no dossiê. Um 404 aqui deixava sem download justamente os
   * orçamentos antigos, que nunca passaram pela assinatura eletrônica e são a
   * maioria; nenhum deles vai ganhar envelope retroativamente.
   */
  async renderPublicQuoteDocument(quoteId: string): Promise<{ pdf: Buffer; etag: string }> {
    // Prefere a coleta CONCLUÍDA: uma reemissão invalidada não pode fazer o
    // artefato assinado sumir da vista do cliente. E, para coletas em
    // andamento, o prazo é respeitado — o `GET /task-quotes/public/:id`
    // pré-existente recusa orçamento expirado, e esta rota tem a MESMA
    // capability, então não pode ser mais permissiva.
    // Chave: EXISTE ARTEFATO (`finalFileId`), não `status COMPLETED`. Só o
    // `finalize()` grava esse campo, junto do selo e do `finalSha256`. O status
    // segue se movendo depois — um envelope selado vira `SUPERSEDED` quando uma
    // reemissão é aberta —, e chavear por ele faria o documento assinado sumir
    // da vista do cliente no momento em que uma v2 fosse emitida.
    const completed = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId, finalFileId: { not: null } },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (completed) return this.renderServedDocument(completed.id);

    // Sem filtro de estado aqui. A página que consome isto já exibe o estado da
    // coleta (aguardando / invalidada / expirada), e recusar o documento só
    // porque a coleta não está ativa deixava o cliente sem NADA para ver — o
    // orçamento em si continua visível na mesma página, com a mesma capability.
    const env = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!env) {
      // Orçamento que nunca foi para assinatura: entrega o documento impresso,
      // com as linhas de assinatura em branco. `renderUnsignedQuoteDocument` já
      // devolve 404 quando o orçamento em si não existe.
      const pdf = await this.renderUnsignedQuoteDocument(quoteId);
      // ETag sobre os bytes servidos: a renderização é feita a partir dos dados
      // ATUAIS, então não há hash congelado de onde derivar.
      return { pdf, etag: `"${sha256Hex(pdf).slice(0, 32)}"` };
    }
    return this.renderServedDocument(env.id);
  }

  /**
   * Orçamento renderizado a partir dos dados ATUAIS, SEM envelope.
   *
   * Existe para o histórico: tarefa cujo orçamento nunca passou pela assinatura
   * eletrônica não tem artefato assinado, e recusar o dossiê nesse caso deixaria
   * sem documento justamente as tarefas antigas — que são a maioria hoje.
   *
   * O que sai daqui é o orçamento com as LINHAS DE ASSINATURA EM BRANCO, como um
   * orçamento impresso: nenhum selo é estampado (não há assinatura), não há
   * código de verificação e nada é congelado. Quem consome precisa dizer ao
   * leitor que este documento não está assinado — ver o rótulo do componente no
   * `DossierAssemblerService`.
   */
  async renderUnsignedQuoteDocument(quoteId: string): Promise<Buffer> {
    // `buildForQuote` devolve null para orçamento inexistente; desestruturar
    // direto virava `TypeError` — 500 opaco onde cabe um 404 honesto.
    const loaded = await this.snapshots.buildForQuote(quoteId);
    if (!loaded?.quote) throw new NotFoundException('Orçamento não encontrado.');
    const { quote } = loaded;

    const responsibles = quote.task?.responsibles ?? [];
    const seeds: Array<{
      id: string;
      name: string;
      subtitle: string;
      side: 'ANKAA' | 'CUSTOMER';
    }> = responsibles.map(r => ({
      id: `unsigned-${r.id}`,
      name: r.name,
      subtitle: quote.task?.customer?.corporateName ?? quote.task?.customer?.fantasyName ?? '',
      side: 'CUSTOMER' as const,
    }));

    // Best-effort: orçamento antigo pode não ter representante comercial nem
    // diretor cadastrado, e isso não pode impedir a renderização.
    try {
      const ankaa = await this.resolveAnkaaSigner(quote);
      seeds.push({
        id: 'unsigned-ankaa',
        name: ankaa.name,
        subtitle: `${COMPANY.directorTitle} — ${COMPANY.name}`,
        side: 'ANKAA',
      });
    } catch {
      /* segue sem a linha da Ankaa */
    }

    // Código vazio: sem envelope não há o que verificar, e imprimir um código
    // inexistente no rodapé convidaria o cliente a consultar algo que não existe.
    const rendered = await this.renderQuoteDocument(quote, seeds, '');
    return rendered.pdf;
  }

  /**
   * Grava no cadastro o CPF que o signatário informou, quando ele ainda não
   * tinha um.
   *
   * É o que faz a segunda assinatura ser mais curta que a primeira: com o CPF no
   * `Responsible`, todo envelope seguinte nasce com `declaredCpf` preenchido e o
   * signatário completa apenas os dígitos que a máscara esconde.
   *
   * BEST-EFFORT de propósito. Isto roda no meio da cerimônia, e nada aqui pode
   * derrubar o envio do código: se o contato foi apagado, se outro cadastro já
   * tem aquele CPF, se o banco recusar por qualquer motivo, o envelope segue —
   * ele já tem o CPF em `declaredCpf` e em `informedCpf`, que é o que a prova
   * exige. O cadastro é conveniência para a próxima vez, não requisito desta.
   */
  private async persistCpfToResponsible(
    signer: { responsibleId: string | null },
    cpfDigits: string,
  ): Promise<void> {
    if (!signer.responsibleId) return;
    try {
      // `updateMany` com `cpf: null` no where, não `update` por id: assim um
      // cadastro que ganhou CPF entre a emissão do envelope e este momento NÃO é
      // sobrescrito. (O comentário anterior descrevia esta guarda, mas o `where`
      // era só `{ id }` — o código não fazia o que dizia.)
      await this.prisma.responsible.updateMany({
        where: { id: signer.responsibleId, cpf: null },
        data: { cpf: cpfDigits },
      });
    } catch (error) {
      this.logger.warn(
        `Não foi possível gravar o CPF no contato ${signer.responsibleId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /** Envelopes de um orçamento, do mais recente para o mais antigo. */
  async listForQuote(quoteId: string) {
    const envelopes = await this.prisma.signatureEnvelope.findMany({
      where: { quoteId },
      orderBy: { version: 'desc' },
      include: {
        signers: { orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }] },
      },
    });

    const inviteEvents = await this.prisma.signatureAuditEvent.findMany({
      where: {
        envelopeId: { in: envelopes.map(e => e.id) },
        eventType: { in: ['INVITATION_SENT', 'INVITATION_FAILED'] },
      },
      orderBy: { sequence: 'asc' },
      select: { envelopeId: true, eventType: true, actorId: true },
    });
    const inviteBySigner = new Map<string, string>();
    for (const ev of inviteEvents) {
      if (ev.actorId) inviteBySigner.set(ev.actorId, ev.eventType);
    }

    const changesByEnvelope = await this.changesSinceFrozen(quoteId, envelopes);

    return envelopes.map(env => ({
      id: env.id,
      version: env.version,
      status: env.status,
      verificationCode: env.verificationCode,
      deadlineAt: env.deadlineAt,
      sentAt: env.sentAt,
      completedAt: env.completedAt,
      invalidatedReason: env.invalidatedReason,
      /**
       * Diferenças entre o documento congelado neste envelope e o orçamento
       * como ele está AGORA. Vazio quando nada mudou.
       *
       * Num envelope INVALIDATED explica a invalidação; num COMPLETED avisa que
       * o registro se moveu depois da assinatura — que não invalida nada, mas o
       * operador precisa saber antes de mandar o dossiê ao cliente.
       */
      changes: changesByEnvelope.get(env.id) ?? [],
      originalSha256: env.originalSha256,
      finalSha256: env.finalSha256,
      padesLevel: env.padesLevel,
      sealedAt: env.sealedAt,
      signers: env.signers.map(s => ({
        id: s.id,
        name: s.declaredName,
        emailMasked: maskEmail(s.declaredEmail),
        email: s.declaredEmail,
        phoneMasked: maskPhone(s.declaredPhone),
        phone: s.declaredPhone,
        // Link pessoal, exposto SOMENTE na rota interna (ADMIN/COMMERCIAL/FINANCIAL).
        // Sem isto o operador não tinha como entregar o convite quando o envio
        // automático falha — e ele falha sempre que o endereço cadastrado está
        // errado ou o servidor de e-mail recusa a entrega.
        signingUrl: this.signingUrl(s.accessToken),
        cpfMasked: s.informedCpf ? maskCpf(s.informedCpf) : null,
        cargo: s.informedCargo,
        cpfMatch: s.cpfMatch,
        side: s.orderGroup === 1 ? 'ANKAA' : 'CUSTOMER',
        status: s.status,
        signedAt: s.signedAt,
        refusedAt: s.refusedAt,
        refusalReason: s.refusalReason,
        timesViewed: s.timesViewed,
        lastViewedAt: s.lastViewedAt,
        ipAddress: s.ipAddress,
        inviteState: inviteBySigner.get(s.id) ?? null,
      })),
    }));
  }

  /**
   * Reenvia o convite de um signatário.
   *
   * O envio automático depende do servidor de e-mail aceitar a mensagem; quando
   * ele recusa, `sendEmail` devolve false e o evento fica INVITATION_FAILED. Sem
   * uma ação de reenvio o operador ficava sem saída a não ser cancelar e reemitir.
   */
  async resendInvitation(
    signerId: string,
    actorUserId: string,
    ctx: RequestContext,
  ): Promise<boolean> {
    const signer = await this.prisma.envelopeSigner.findUnique({
      where: { id: signerId },
      include: { envelope: { include: { quote: true } } },
    });
    if (!signer) throw new NotFoundException('Signatário não encontrado.');
    if (signer.envelope.status !== EnvelopeStatus.RUNNING) {
      throw new BadRequestException('Esta coleta não está mais ativa.');
    }

    const { subject, html } = generateSignatureInvitationEmail({
      signerName: signer.declaredName,
      budgetNumber: signer.envelope.quote.budgetNumber,
      signingUrl: this.signingUrl(signer.accessToken),
      deadlineDate: signer.envelope.deadlineAt.toLocaleDateString('pt-BR'),
      isResend: true,
    });

    const ok = await this.sendEmail(
      signer.declaredEmail,
      subject,
      html,
      'SIGNATURE_INVITATION_RESEND',
    );
    await this.audit.record(signer.envelopeId, {
      eventType: ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
      actorType: 'OPERATOR',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      payload: { channel: 'email', destination: maskEmail(signer.declaredEmail), resentBy: actorUserId },
    });
    return ok;
  }

  // ===========================================================================
  // AUXILIARES
  // ===========================================================================

  /**
   * Base das URLs públicas de assinatura.
   *
   * `SIGNATURE_WEB_URL` existe separada de `WEB_APP_URL` porque esta última
   * aponta para produção mesmo em desenvolvimento (o DeepLinkService e as
   * notificações dependem disso). Sem a separação, todo link gerado localmente
   * apontava para ankaadesign.com.br e dava 404, já que o código ainda não está
   * publicado lá.
   */
  private webBase(): string {
    const base =
      this.config.get<string>('SIGNATURE_WEB_URL') ||
      this.config.get<string>('WEB_APP_URL') ||
      COMPANY.websiteUrl;
    return base.replace(/\/$/, '');
  }

  private verificationUrl(code: string): string {
    return `${this.webBase()}/v/${code}`;
  }

  private signingUrl(token: string): string {
    // Namespace /cliente é obrigatório: o MobileUsageGuard do web redireciona
    // qualquer outra rota para /install em dispositivos móveis — que é justamente
    // onde o cliente vai assinar.
    return `${this.webBase()}/cliente/assinar/${token}`;
  }

  /**
   * Persiste o PDF e cria o registro `File`.
   *
   * Segue o padrão do fluxo de admissão (hasheia e sela os bytes que estão em
   * disco), não o de EPI — cujo `documentSha256` é o hash de um render que foi
   * descartado e nunca pode ser recomputado.
   */
  private async persistPdf(
    quote: { budgetNumber: number; task?: { customer?: { fantasyName?: string } | null } | null },
    pdf: Buffer,
    kind: 'original' | 'assinado',
    verificationCode: string,
  ): Promise<string> {
    // ABSOLUTO. `FILES_ROOT` é `./files` em dev, então `join()` produzia um
    // caminho relativo ao cwd: qualquer processo iniciado de outro diretório
    // (cron, script, worker) lia o File.path e estourava ENOENT.
    const filesRoot = resolvePath(
      process.cwd(),
      this.config.get<string>('FILES_ROOT') ?? './files',
    );
    const customerName = quote.task?.customer?.fantasyName ?? 'Sem Cliente';
    const sanitized = customerName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const dir = join(filesRoot, 'Clientes', sanitized, 'Orcamentos', 'Assinaturas');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filename = `orcamento_${quote.budgetNumber}_${verificationCode}_${kind}.pdf`;
    const path = join(dir, filename);
    writeFileSync(path, pdf);

    const file = await this.prisma.file.create({
      data: {
        filename,
        originalName: `Orçamento ${quote.budgetNumber} — ${kind}.pdf`,
        mimetype: 'application/pdf',
        path,
        size: pdf.length,
      },
    });
    return file.id;
  }
}
