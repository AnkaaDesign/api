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

import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { FilesStorageService } from '@modules/common/file/services/files-storage.service';
import { DossierAssemblerService } from '../dossier/dossier-assembler.service';
import { join, resolve as resolvePath, dirname, basename } from 'path';
import { EnvelopeSignerStatus, EnvelopeStatus, Prisma, SignatureAuthMethod } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { COMPANY, receivingAccountFor } from '@/config/company';
import {
  formatResponsibleRoles,
  pickPrimaryResponsible,
  RESPONSIBLE_ROLE_LABELS,
  RESPONSIBLE_ROLE,
} from '@constants/enums';
import { SignatureAuditService } from './signature-audit.service';
import { SigningChallengeService, SIGNING_CODE_TTL_MINUTES } from './signing-challenge.service';
import {
  QuoteSnapshot,
  QuoteSnapshotService,
  QuoteWithSnapshotGraph,
} from './quote-snapshot.service';
import { type QuoteChange } from './quote-diff';
import { QuoteRendererService, RenderInput } from '../document/quote-renderer.service';
import {
  buildLateValueMap,
  coverageSummary,
  coveredTaskCount,
  coveredTaskIds,
  lateSlotKey,
  parseLateSlotKey,
  primaryTask,
  quoteTasks,
  sortQuoteTasks,
  taskCount as countQuoteTasks,
  orderNumberLabel,
} from '@utils/quote-tasks';
import { computeQuoteMoney } from '@utils/quote-money';
import { EMPLOYED_USER_WHERE } from '@utils/contract';
import { snapshotVehicles } from './quote-snapshot.service';
import { QuoteAssemblerService, AssemblerSigner } from '../document/quote-assembler.service';
import {
  canonicalSections,
  describeSections,
  FULL_SECTIONS,
  hasSection,
  isFullSections,
  QUOTE_SECTION_DESCRIPTIONS,
  QUOTE_SECTION_LABELS,
  sectionsForRoles,
  TOGGLEABLE_SECTIONS,
  withAlwaysSections,
  variantFilenameSuffix,
  variantKeyOf,
  type QuoteSection,
} from '../quote-sections';
import { budgetPdfFilename } from '../document/document-filename';
import { ceremonyKindOfAuthMethod, isSessionCeremony } from '../ceremony-kind';
import {
  isSolePurchasingContact,
  purchaseOrderGateVerdict,
  PURCHASE_ORDER_REQUIRED_MESSAGE,
} from '../purchase-order-gate';
import { commercialTaskLink } from '@modules/people/portal/portal-scope.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  TASK_QUOTE_STATUS,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
} from '@/constants/enums';
import { TASK_QUOTE_STATUS_ORDER } from '@/constants/sortOrders';
import { PadesSignerService } from '../pades/pades-signer.service';
import {
  acceptanceClauseFor,
  AUTH_METHOD_LABELS,
  VOID_WATERMARK_LABELS,
  declarationsFor,
  declarationKeysFor,
  DECLARATIONS_VERSION,
  EVENT_DESCRIPTIONS,
  LEGAL_BASIS,
  renderDeclaration,
  type CeremonyKind,
} from '../signature.constants';
import {
  formatCnpj,
  formatCpf,
  formatVerificationCode,
  maskCpf,
  isCpfWellFormed,
  maskEmail,
  maskPhone,
  emailMaskParts,
  phoneMaskParts,
  onlyDigits,
  cpfMaskParts,
  fitCargo,
} from '../utils/identity';
import {
  generateSignatureInvitationEmail,
  generateSignatureOtpEmail,
  generateAnkaaCountersignEmail,
  generateAnkaaCountersignReminderEmail,
  generateCollectionPausedEmail,
  generateRefusalNoticeEmail,
  generateEnvelopeVoidedEmail,
  generateSignatureReminderEmail,
  generateSignatureExpiredEmail,
} from '../../../../templates/signature-emails';
import {
  generateSignatureInvitationWhatsApp,
  generateSignatureOtpWhatsApp,
  generateAnkaaCountersignWhatsApp,
  generateAnkaaCountersignReminderWhatsApp,
  generateCollectionPausedWhatsApp,
  generateRefusalNoticeWhatsApp,
  generateEnvelopeVoidedWhatsApp,
  generateSignatureReminderWhatsApp,
  generateSignatureExpiredWhatsApp,
} from '../../../../templates/signature-whatsapp';
import {
  auditChannelOf,
  authMethodForChannel,
  channelForAuthMethod,
  channelsForMode,
  defaultChannelForMode,
  parseSignatureDeliveryMode,
  resolveSignatureDeliveryChannel,
  SIGNATURE_DELIVERY_CHANNEL_LABELS,
  type SignatureDeliveryChannel,
  type SignatureDeliveryMode,
} from '../signature-delivery';
import { sha256Hex } from '../utils/canonical';
import { describeSignatureSecretProblems, inspectSignatureSecrets } from '../utils/secrets';
import {
  formatBillingLocalityLine,
  formatBillingStreetLine,
  formatCurrencyBRL,
  formatDateBR,
  generateGuaranteeText,
  generatePaymentText,
} from '../document/quote-text';
import {
  customerSideCompletedAt,
  dueCustomerReminder,
  civilDayKey,
  isInternalReminderDue,
  spDayDiff,
} from '../signature-reminder-cadence';
import {
  ankaaCountersignTemplate,
  collectionPausedTemplate,
  expiredTemplate,
  invitationTemplate,
  refusedTemplate,
  otpTemplate,
  reminderTemplate,
  resendTemplate,
  voidedInternalTemplate,
  voidedTemplate,
  type SignatureWhatsAppTemplate,
} from '../signature-whatsapp-templates';

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface EmailSender {
  /** Devolve `false` em qualquer falha; nunca lança. */
  sendEmail(to: string, subject: string, html: string): Promise<boolean>;
}

/**
 * Transporte de WhatsApp, no mesmo contrato booleano do e-mail.
 *
 * Injetado tardiamente como o e-mail, mas por um motivo mais forte: o módulo que
 * exporta o cliente (`WhatsAppModule`) importa `forwardRef(() => NotificationModule)`,
 * então importá-lo aqui arrastaria o módulo de notificações inteiro para dentro
 * da cerimônia de assinatura — exatamente o acoplamento que o comentário no topo
 * de `signature.module.ts` registra ter sido removido. Quem faz a ponte é o
 * `SignatureWhatsAppBridgeModule`, que importa os dois e não é importado por
 * nenhum dos dois.
 */
interface WhatsAppSender {
  /**
   * Devolve `{ ok: false, reason }` em qualquer falha; nunca lança.
   *
   * O MOTIVO faz parte do contrato porque as recusas deixaram de ser todas
   * iguais: a guarda de saída do transporte barra por teto de primeiro contato,
   * por disjuntor aberto depois de um nack 463, por horário. "Falhou" faria o
   * operador tentar de novo — que é exatamente a conduta que a guarda existe
   * para impedir. O texto vem pronto em português, do transporte.
   *
   * `priority: 'CRITICAL'` é o código de uso único: vai na frente da fila e não
   * consome o teto de primeiro contato, porque foi o próprio signatário quem o
   * pediu tocando no link.
   */
  sendMessage(
    phone: string,
    message: string,
    priority?: 'CRITICAL' | 'NORMAL',
    /**
     * Cartão de prévia do link. Só as mensagens que CARREGAM link mandam um.
     *
     * Sem ele a mensagem sai como uma URL crua — a forma canônica de um link de
     * phishing, e a que faz o WhatsApp avisar o destinatário para desconfiar. O
     * cartão é montado pelo transporte a partir daqui; ver `WhatsAppLinkPreview`.
     */
    preview?: { url: string; title: string; description?: string } | null,
  ): Promise<{ ok: boolean; reason: string | null }>;

  /**
   * Envio pelo canal OFICIAL (Cloud API), por template aprovado.
   *
   * OPCIONAL no contrato porque o Baileys não tem template — e não é omissão a
   * corrigir: são dois canais com regras diferentes convivendo de propósito. O
   * Baileys atende o tráfego INTERNO, onde texto livre é a forma certa; a Cloud
   * API atende o CLIENTE, onde, fora da janela de 24 h, texto livre é recusado
   * pela plataforma. Quem chama pergunta se o método existe antes de usá-lo.
   *
   * Não recebe `priority` nem `preview`: a fila e a guarda de saída são do
   * Baileys, e o cartão de link vira BOTÃO, declarado no template.
   */
  sendTemplate?(
    phone: string,
    template: SignatureWhatsAppTemplate,
  ): Promise<{ ok: boolean; reason?: string; code?: string }>;
}

/**
 * A linha de detalhe de um evento da trilha, quando ele tem conteúdo a mostrar.
 *
 * Hoje só `SNAPSHOT_DRIFTED` tem: é o evento que registra cadastro alterado
 * DEPOIS do congelamento — tipicamente placa e chassi de implemento 0 km, que
 * não existiam quando o documento foi congelado e por isso não estão no corpo
 * dele. Ver `AssemblerAuditEvent.detail`.
 *
 * Truncado: a trilha é uma lista compacta, e uma alteração de dez campos viraria
 * um parágrafo no meio dela. O que não couber continua inteiro no payload do
 * evento, que é o que a rota de trilha serve.
 */
/**
 * "Ana", "Ana e Beatriz", "Ana, Beatriz e mais 2" — o vocativo do documento.
 *
 * Corta em três nomes porque isto abre um parágrafo: um recorte com oito
 * contatos comerciais (existem) viraria três linhas de nomes antes da primeira
 * palavra da proposta. Devolve `null` na lista vazia para que o `??` do chamador
 * possa cair no degrau seguinte — string vazia passaria como valor.
 */
function formatContactList(names: readonly string[]): string | null {
  const clean = names.map(n => n?.trim()).filter((n): n is string => !!n);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} e ${clean[1]}`;
  if (clean.length === 3) return `${clean[0]}, ${clean[1]} e ${clean[2]}`;
  return `${clean.slice(0, 2).join(', ')} e mais ${clean.length - 2}`;
}

function eventDetailOf(eventType: string, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;

  if (eventType === 'SNAPSHOT_DRIFTED') {
    const changes = data.changes;
    if (typeof changes !== 'string' || !changes.trim()) return null;
    return changes.length > 240 ? `${changes.slice(0, 237)}...` : changes;
  }

  // REDESIGNAÇÃO DO CONTRA-ASSINANTE. O documento está congelado e a linha de
  // assinatura impressa continua nomeando o designado original; sem esta linha,
  // quem abrisse o artefato leria "Contato do signatário alterado" e não teria
  // como saber que o selo diz um nome porque o papel diz outro.
  if (eventType === 'CONTACT_CHANGED' && data.kind === 'ankaa_signer_reassigned') {
    const de = (data.de as { nome?: unknown } | null)?.nome;
    const para = (data.para as { nome?: unknown } | null)?.nome;
    if (typeof de !== 'string' || typeof para !== 'string') return null;
    return (
      `Representante da Ankaa: ${de} → ${para}. A linha de assinatura impressa neste ` +
      `documento foi congelada em nome de ${de}.`
    );
  }

  return null;
}

/** Como cada lacuna de cadastro tardio é chamada para o operador. */
const LATE_SLOT_LABELS: Record<string, string> = {
  serialNumber: 'número de série',
  plate: 'placa',
  chassis: 'chassi',
  orderNumber: 'nº do pedido',
};

/** Resultado de um envio da cerimônia, com o motivo quando não saiu. */
export interface SignatureDeliveryResult {
  ok: boolean;
  reason: string | null;
  /**
   * Código estável da GUARDA DE SAÍDA do WhatsApp (`RECIPIENT_DAILY_CAP`,
   * `BREAKER_ALL`, `COLD_OUTSIDE_WINDOW`, …), quando foi ela que recusou.
   *
   * Ausente numa falha de transporte. É essa diferença — política contra
   * transporte — que decide o que se diz ao signatário: teto de guarda é por
   * DIA ou por hora, e mandá-lo "tentar novamente em instantes" o punha a
   * reapertar o botão contra uma parede que só cai amanhã.
   */
  code?: string | null;
}

/** Deduplica responsáveis por id, preservando a primeira ocorrência. */
function dedupeResponsibles<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
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
    // A EMISSÃO move o orçamento para "Aguardando Assinatura" e registra a
    // troca — no mesmo commit do envelope. Ver a nota em `createEnvelope`.
    private readonly changeLogs: ChangeLogService,
    private readonly audit: SignatureAuditService,
    private readonly challenges: SigningChallengeService,
    private readonly snapshots: QuoteSnapshotService,
    private readonly renderer: QuoteRendererService,
    private readonly assembler: QuoteAssemblerService,
    private readonly pades: PadesSignerService,
    private readonly filesStorage: FilesStorageService,
    // forwardRef: o DossierAssemblerService injeta ESTE serviço, então o par é cíclico
    // por construção. Mesmo padrão que o módulo já usa para Nfse e Sicredi.
    @Inject(forwardRef(() => DossierAssemblerService))
    private readonly dossiers: DossierAssemblerService,
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

  /** Idem para o WhatsApp — ver a nota no `WhatsAppSender`. */
  private whatsapp: WhatsAppSender | null = null;
  setWhatsAppSender(sender: WhatsAppSender): void {
    this.whatsapp = sender;
  }

  /**
   * Modo de entrega configurado (`SIGNATURE_DELIVERY_CHANNEL`).
   *
   * Lido a cada chamada em vez de memoizado no construtor: o `ConfigService` já
   * resolve de `process.env`, o custo é nulo, e memoizar significaria que mudar a
   * variável exigiria restart mesmo onde o resto do sistema não exige.
   *
   * Um valor ilegível NÃO derruba a cerimônia — cai no padrão e loga. Derrubar
   * seria pior: uma variável mal digitada deixaria de emitir orçamento para
   * assinatura, e o operador veria um 503 sem relação com o que ele fez.
   */
  private deliveryMode(): SignatureDeliveryMode {
    const raw = this.config.get<string>('SIGNATURE_DELIVERY_CHANNEL');
    const { mode, invalid } = parseSignatureDeliveryMode(raw);
    if (invalid) {
      this.logger.error(
        `SIGNATURE_DELIVERY_CHANNEL="${raw}" não é um modo válido ` +
          `(whatsapp | email | both). Usando "${mode}".`,
      );
    }
    return mode;
  }

  /** Modo + canais permitidos, para a tela decidir se mostra o seletor. */
  getDeliverySettings(): {
    mode: SignatureDeliveryMode;
    channels: SignatureDeliveryChannel[];
    defaultChannel: SignatureDeliveryChannel;
  } {
    const mode = this.deliveryMode();
    return {
      mode,
      channels: channelsForMode(mode),
      defaultChannel: defaultChannelForMode(mode),
    };
  }

  /**
   * O que a tela precisa saber ANTES de abrir o modal de envio.
   *
   * POR QUE ISTO EXISTE, SE `createEnvelope` JÁ VALIDA
   *   Porque validar no POST significa descobrir o problema DEPOIS do ato. O
   *   operador escolhia o canal, confirmava, e só então tomava um 400 com uma
   *   lista de nomes — sem nenhuma forma de saber, antes de clicar, que o outro
   *   canal funcionaria. Com 9 de 170 responsáveis tendo e-mail cadastrado, esse
   *   400 é o caso COMUM do canal e-mail, não a exceção.
   *
   *   Aqui a mesma regra é avaliada para os DOIS canais de uma vez, então o
   *   modal desenha "WhatsApp — 3 responsáveis prontos" ao lado de "E-mail — 2
   *   sem e-mail cadastrado" e a escolha é informada. As duas checagens moram na
   *   mesma função (`contactMissingFor`) que o POST usa, para não divergirem: um
   *   preflight que diz "pode" e um POST que responde 400 é pior que não ter
   *   preflight nenhum.
   *
   * NÃO CONGELA NADA e não tem efeito colateral: é um GET.
   */
  async getDeliveryPreflight(quoteId: string): Promise<{
    mode: SignatureDeliveryMode;
    channels: SignatureDeliveryChannel[];
    defaultChannel: SignatureDeliveryChannel;
    /** Impedem QUALQUER canal — a tela desabilita o envio inteiro. */
    blockers: string[];
    recipients: Array<{
      id: string;
      name: string;
      phoneMasked: string;
      emailMasked: string;
      hasPhone: boolean;
      hasEmail: boolean;
      /** Funções do cadastro — é delas que sai o recorte padrão. */
      roles: string[];
      rolesLabel: string;
      /**
       * O que este contato recebe se o operador não mexer em nada. Vazio
       * significa que ele NÃO entra na coleta — o padrão do gestor de frota e do
       * motorista.
       */
      sections: QuoteSection[];
      sectionsLabel: string;
    }>;
    /** Todas as seções recortáveis, com rótulo — a tela desenha as caixas daqui. */
    sectionCatalog: Array<{ key: QuoteSection; label: string; description: string }>;
    ankaa: {
      name: string;
      /**
       * O cargo que vai ser IMPRESSO na linha de assinatura e gravado no selo —
       * o mesmo valor nos dois, congelado na emissão. Ver `ankaaCargoOf`.
       */
      cargo: string;
      hasPhone: boolean;
      hasEmail: boolean;
      /**
       * CPF do representante no cadastro do DP. Não impede nada — a identidade
       * do ato vem da sessão —, mas sem ele o selo da contra-assinatura sai sem
       * documento do signatário, para sempre, e o operador tem direito de saber
       * disso enquanto ainda dá para pedir ao DP que preencha.
       */
      hasCpf: boolean;
      /**
       * A Ankaa contra-assina no sistema, em sessão autenticada. O contato serve
       * só para o AVISO de que o cliente terminou, e por isso a falta dele deixou
       * de impedir a emissão — vira este aviso na tela.
       */
      reachable: boolean;
    } | null;
    channelStatus: Record<
      SignatureDeliveryChannel,
      { ready: boolean; missing: string[]; ankaaMissing: string | null }
    >;
    /**
     * Identificação do veículo NO MOMENTO do envio.
     *
     * Não impede nada — é aviso, e desde as lacunas de cadastro tardio ele deixou
     * de ser um aviso de perda. O caso comum é o implemento 0 km, orçado antes de
     * emplacar: o documento reserva o retângulo, imprime "a registrar", e o dado
     * é CARIMBADO na lacuna quando chega, sem tocar num byte do que foi assinado
     * (ver `LateSlotKey` no builder e `stampLateValues` no montador). Na
     * conclusão da tarefa, `SignatureAddendumScheduler` emite ainda o aditivo de
     * identificação, selado com o mesmo certificado.
     *
     * O que se ganha preenchendo antes é a frase inteira no corpo do documento,
     * sem carimbo e sem folha extra. Por isso o aviso continua existindo — mas
     * ele não descreve mais uma porta que se fecha.
     */
    vehicle: { plate: string | null; chassisNumber: string | null; missing: string[] } | null;
    /** Um por veículo do orçamento, na ordem do documento. */
    vehicles: Array<{
      taskId: string;
      serialNumber: string | null;
      plate: string | null;
      chassisNumber: string | null;
      missing: string[];
    }>;
  }> {
    const settings = this.getDeliverySettings();

    const quote = await this.prisma.budget.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        expiresAt: true,
        commercialUserId: true,
        // O portão de layout passou a valer na EMISSÃO (ver `createEnvelope`).
        // O preflight existe justamente para dizer isso ANTES do clique: sem
        // esta linha o operador escolheria canal, marcaria recortes, confirmaria
        // e só então tomaria o 400.
        layoutFiles: { select: { id: true }, take: 1 },
        // Os PAGADORES, pelo mesmo motivo do layout: `createEnvelope` recusa dois
        // (o documento congelado descreveria um só) e o preflight existe para
        // dizer isso ANTES do clique. Sem esta linha o operador escolhia canal,
        // marcava recortes, confirmava — e só então tomava o 400.
        customerConfigs: { select: { customerId: true } },
        tasks: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            createdAt: true,
            serialNumber: true,
            responsibles: {
              // `roles` entra porque é delas que sai o recorte padrão de cada
              // contato — o preflight existe justamente para mostrar isso ANTES
              // de o operador confirmar.
              select: { id: true, name: true, phone: true, email: true, roles: true },
              orderBy: { createdAt: 'asc' },
            },
            truck: { select: { plate: true, chassisNumber: true } },
          },
        },
      },
    });

    if (!quote) throw new NotFoundException('Orçamento não encontrado.');

    const blockers: string[] = [];

    // Os MESMOS dois estados que `createEnvelope` recusa — viva e concluída. Um
    // preflight que diz "pode" e um POST que responde 400 é pior que não ter
    // preflight nenhum.
    const previousLive = await this.prisma.signatureEnvelope.findFirst({
      where: {
        quoteId,
        status: { in: [EnvelopeStatus.RUNNING, EnvelopeStatus.COMPLETED] },
      },
      select: { id: true, status: true, version: true },
    });
    if (previousLive?.status === EnvelopeStatus.RUNNING) {
      blockers.push(
        'Já existe uma coleta de assinaturas em andamento para este orçamento. ' +
          'Cancele-a antes de emitir outra.',
      );
    } else if (previousLive) {
      blockers.push(
        `Este orçamento já tem uma coleta CONCLUÍDA e assinada (versão ${previousLive.version}). ` +
          'Reemitir criaria um segundo contrato selado para o mesmo número.',
      );
    }

    // O MESMO recorte que `createEnvelope` recusa: um documento só não descreve
    // dois pagadores. Ver a nota longa lá.
    const pagadoresPreflight = new Set(
      (quote.customerConfigs ?? []).map((c: { customerId: string }) => c.customerId),
    );
    if (pagadoresPreflight.size > 1) {
      blockers.push(
        `Este orçamento fatura para ${pagadoresPreflight.size} clientes, e a cerimônia de ` +
          'assinatura ainda não recorta o documento por pagador — todos assinariam um instrumento ' +
          'com os serviços, o desconto e as cláusulas de apenas um deles. Separe em um orçamento ' +
          'por cliente antes de enviar para assinatura.',
      );
    }

    if (!quote.layoutFiles?.length) {
      blockers.push(
        'Selecione um layout aprovado antes de enviar o orçamento para assinatura. ' +
          'Sem ele o orçamento não poderá ser aprovado depois que o cliente assinar.',
      );
    }

    if (quote.expiresAt.getTime() <= Date.now()) {
      blockers.push(
        `A validade deste orçamento venceu em ${this.deadlineLabel(quote.expiresAt)}. ` +
          'Atualize a data de validade antes de enviar para assinatura.',
      );
    }

    // União dos responsáveis de TODAS as tarefas, deduplicada — mesma regra do
    // snapshot. Ler só a primeira esconderia do preflight um contato
    // acrescentado a outra tarefa do mesmo orçamento, e ele apareceria como
    // signatário surpresa na emissão.
    const quoteTaskRows = sortQuoteTasks(quote.tasks ?? []);
    const seenResponsibleIds = new Set<string>();
    const responsibles = quoteTaskRows
      .flatMap(t => t.responsibles ?? [])
      .filter(r => {
        if (seenResponsibleIds.has(r.id)) return false;
        seenResponsibleIds.add(r.id);
        return true;
      });
    if (responsibles.length === 0) {
      blockers.push(
        'Selecione ao menos um responsável na tarefa antes de enviar o orçamento para assinatura.',
      );
    }

    // Best-effort: um orçamento sem representante comercial nem diretor
    // cadastrado é um problema real, mas ele já vira 400 no POST com a mensagem
    // certa. Aqui a ausência vira `ankaa: null`, e a tela não afirma nada sobre
    // um signatário que não conseguiu resolver.
    let ankaa: {
      name: string;
      cargo: string;
      hasPhone: boolean;
      hasEmail: boolean;
      hasCpf: boolean;
      reachable: boolean;
    } | null = null;
    try {
      const user = await this.resolveAnkaaSigner(quote as never);
      const hasPhone = onlyDigits(user.phone).length >= 10;
      const hasEmail = !!user.email?.includes('@');
      ankaa = {
        name: user.name,
        cargo: this.ankaaCargoOf(user),
        hasPhone,
        hasEmail,
        hasCpf: !!onlyDigits(user.cpf ?? ''),
        reachable: hasPhone || hasEmail,
      };
    } catch {
      blockers.push(
        'Nenhum representante da Ankaa pôde ser resolvido para este orçamento. ' +
          'Defina o representante comercial ou cadastre o diretor.',
      );
    }

    const recipients = responsibles.map(r => {
      const sections = sectionsForRoles(r.roles);
      return {
        id: r.id,
        name: r.name,
        phoneMasked: maskPhone(r.phone),
        emailMasked: maskEmail(r.email),
        hasPhone: onlyDigits(r.phone).length >= 10,
        hasEmail: !!r.email?.includes('@'),
        roles: (r.roles ?? []) as string[],
        rolesLabel: formatResponsibleRoles(r.roles),
        sections,
        sectionsLabel: sections.length ? describeSections(sections) : 'Não assina',
      };
    });

    // Ninguém com campo de interesse = ninguém a quem enviar. É bloqueio, e não
    // aviso, porque a emissão recusaria de qualquer forma — e descobrir isso
    // depois de confirmar é o defeito que este preflight inteiro existe para
    // corrigir. O operador ainda pode desfazer marcando seções à mão, e a
    // mensagem diz isso.
    if (responsibles.length > 0 && recipients.every(r => r.sections.length === 0)) {
      blockers.push(
        'Nenhum responsável desta tarefa assina por padrão (gestor de frota e motorista não ' +
          'assinam). Marque as seções que cada um deve receber, ou acrescente um responsável ' +
          'comercial à tarefa.',
      );
    }

    const statusFor = (channel: SignatureDeliveryChannel) => {
      // Só quem VAI assinar entra na conta: um motorista sem e-mail cadastrado
      // não pode mais reprovar o canal, porque ele nem recebe convite.
      const signing = recipients.filter(r => r.sections.length > 0);
      const missing = signing
        .filter(r => (channel === 'WHATSAPP' ? !r.hasPhone : !r.hasEmail))
        .map(r => r.name);
      // A Ankaa não entra mais em `ready`: ela contra-assina no sistema, e o
      // contato dela serve só para o aviso. Continua REPORTADO — a tela avisa que
      // o representante não será notificado —, mas não desabilita mais o canal.
      const ankaaMissing =
        ankaa && (channel === 'WHATSAPP' ? !ankaa.hasPhone : !ankaa.hasEmail)
          ? ankaa.name
          : null;
      return {
        ready: signing.length > 0 && missing.length === 0,
        missing,
        ankaaMissing,
      };
    };

    // UM POR VEÍCULO. O que a tela faz com isto é avisar que a placa e o chassi
    // vão congelar como "a registrar" — e num orçamento de sessenta caminhões
    // essa lacuna existe em graus diferentes por caminhão: alguns já chegaram
    // emplacados, outros não. Reportar só o primeiro diria "falta a placa" num
    // orçamento em que faltam cinquenta e nove, ou nada num em que falta uma.
    const vehicleRows = quoteTaskRows.map(t => {
      const missing: string[] = [];
      if (!t.truck?.plate?.trim()) missing.push('placa');
      if (!t.truck?.chassisNumber?.trim()) missing.push('chassi');
      return {
        taskId: t.id,
        serialNumber: t.serialNumber ?? null,
        plate: t.truck?.plate ?? null,
        chassisNumber: t.truck?.chassisNumber ?? null,
        missing,
      };
    });
    const truck = quoteTaskRows[0]?.truck ?? null;
    const missingVehicle = vehicleRows[0]?.missing ?? [];

    return {
      ...settings,
      blockers,
      recipients,
      // Só as RECORTÁVEIS. A identificação do veículo sai em todo recorte e não
      // é uma escolha — oferecer a caixa convidaria a desmarcá-la, e o servidor
      // a reporia em silêncio, que é a pior combinação possível numa tela.
      sectionCatalog: TOGGLEABLE_SECTIONS.map(key => ({
        key,
        label: QUOTE_SECTION_LABELS[key],
        description: QUOTE_SECTION_DESCRIPTIONS[key],
      })),
      ankaa,
      channelStatus: {
        WHATSAPP: statusFor('WHATSAPP'),
        EMAIL: statusFor('EMAIL'),
      },
      vehicles: vehicleRows,
      // ⚠️ MANTIDO DE PROPÓSITO, apontando para o PRIMEIRO veículo.
      //
      // O app Flutter está instalado nos aparelhos e não é atualizado no mesmo
      // instante que a API. Uma versão anterior a esta feature lê `vehicle` e
      // quebraria a tela de envio se o campo sumisse. Ele é redundante com
      // `vehicles[0]` e deve sair quando não houver mais cliente antigo em
      // circulação.
      vehicle: {
        plate: truck?.plate ?? null,
        chassisNumber: truck?.chassisNumber ?? null,
        missing: missingVehicle,
      },
    };
  }

  /**
   * Registrado pelo BudgetModule. Evita que o módulo de assinatura conheça o
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

  /**
   * Todos os responsáveis do CLIENTE assinaram; falta a contra-assinatura da
   * Ankaa. Mesma inversão de dependência do `onCompleted`: a cerimônia sabe que
   * o grupo 0 fechou, e só o dono do orçamento sabe que isso significa SIGNED.
   *
   * Por que é um gancho SEPARADO e não um parâmetro do `onCompleted`: os dois
   * momentos são distintos e podem estar a dias de distância — o cliente assina
   * na sexta, a Ankaa contra-assina na segunda. Entre um e outro há um estado
   * em que a lista precisa dizer que a bola está do nosso lado.
   */
  private onCustomerSideSigned: ((quoteId: string, envelopeId: string) => Promise<void>) | null =
    null;
  setOnCustomerSideSigned(cb: (quoteId: string, envelopeId: string) => Promise<void>): void {
    this.onCustomerSideSigned = cb;
  }

  /** A validade venceu com assinatura de cliente faltando. Ver `SignatureExpiryScheduler`. */
  private onEnvelopeExpired: ((quoteId: string, envelopeId: string) => Promise<void>) | null = null;
  setOnEnvelopeExpired(cb: (quoteId: string, envelopeId: string) => Promise<void>): void {
    this.onEnvelopeExpired = cb;
  }

  /**
   * O CLIENTE RECUSOU e não sobrou ninguém do lado dele para assinar.
   *
   * ⚠️ ESTE GANCHO NÃO EXISTIA, e a falta dele deixava o orçamento parado num
   * estado que não descrevia mais a realidade: o envelope ia para `REFUSED` e o
   * `Budget` continuava `PENDING`, indistinguível de um criado naquela manhã.
   * Em toda lista, filtro e relatório do comercial, um negócio que o cliente
   * recusou aparecia como um negócio à espera de resposta. Medido no acervo:
   * NOVE envelopes `REFUSED` com o orçamento em `PENDING`.
   *
   * É exatamente o buraco que `markExpiredBySignature` fechou no ramo do
   * vencimento, e pelo mesmo raciocínio: a cerimônia sabe que a coleta morreu, e
   * só o dono do orçamento sabe o que isso significa para o estado dele.
   *
   * O MOTIVO VAI JUNTO porque é a única informação que a recusa acrescenta — sem
   * ele, quem recebe a notificação sabe que parou e não sabe o que negociar.
   */
  private onEnvelopeInvalidated:
    | ((quoteId: string, envelopeId: string, reason: string) => Promise<void>)
    | null = null;

  private onEnvelopeRefused:
    | ((quoteId: string, envelopeId: string, reason: string) => Promise<void>)
    | null = null;
  setOnEnvelopeRefused(
    cb: (quoteId: string, envelopeId: string, reason: string) => Promise<void>,
  ): void {
    this.onEnvelopeRefused = cb;
  }

  /**
   * A COLETA CAIU PORQUE O ORÇAMENTO MUDOU — e o orçamento não pode continuar
   * aprovado.
   *
   * Um orçamento APROVADO ou ASSINADO afirma que alguém concordou com AQUELE
   * documento. Quando uma alteração material derruba a coleta, o documento que
   * foi aceito deixou de existir — mas o status ficava de pé, e a tela seguia
   * dizendo "Aprovado" ao lado do aviso de que as assinaturas foram anuladas.
   * Duas frases contraditórias no mesmo cartão.
   *
   * ⚠️ O gancho é DAQUI e o ouvinte é do orçamento, como os outros quatro: é o
   * domínio do `Budget` que sabe o que "voltar para pendente" implica (a O.S.
   * "Em Negociação", a trilha, a trava do dinheiro). O motor de assinatura sabe
   * apenas que o documento aceito morreu.
   */
  setOnEnvelopeInvalidated(
    cb: (quoteId: string, envelopeId: string, reason: string) => Promise<void>,
  ): void {
    this.onEnvelopeInvalidated = cb;
  }

  /**
   * Dispara o gancho de vencimento. Existe como método público para que a
   * varredura não precise alcançar o campo privado — e para que a ausência do
   * gancho (API subindo sem o módulo de orçamento, o que acontece em teste) seja
   * um log e não um `undefined is not a function` dentro do cron.
   */
  async notifyQuoteExpired(quoteId: string, envelopeId: string): Promise<void> {
    if (!this.onEnvelopeExpired) {
      this.logger.warn(
        `Envelope ${envelopeId} venceu, mas nenhum ouvinte de vencimento está registrado — ` +
          'o orçamento NÃO foi movido para "Aguardando Reanálise".',
      );
      return;
    }
    await this.onEnvelopeExpired(quoteId, envelopeId);
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
    /**
     * Canal escolhido pelo operador. Só é honrado quando
     * `SIGNATURE_DELIVERY_CHANNEL=both`.
     *
     * Nos modos fixos um canal divergente é RECUSADO com 400, não ignorado em
     * silêncio: a tela esconde o seletor, mas esconder não é impedir, e aceitar
     * calado um `channel` que a configuração desligou faria o operador acreditar
     * que mandou por um canal enquanto o código saiu por outro. Ausente é o caso
     * normal e cai no canal configurado.
     */
    channel?: string | null;
    /**
     * Sobrescrita do RECORTE, contato a contato. Ausente = todo mundo recebe o
     * padrão das funções que tem no cadastro.
     *
     * É um MAPA DE EXCEÇÕES, não o roster completo, e a diferença importa: se
     * fosse o roster, uma tela aberta antes de alguém acrescentar um responsável
     * à tarefa emitiria a coleta sem ele — em silêncio, porque a lista teria
     * chegado "completa". Como exceção, quem não vem na lista cai no padrão, e
     * acrescentar responsável nunca some.
     *
     * `sections: []` é uma decisão, não uma omissão: significa "este contato não
     * assina esta coleta". É assim que o gestor de frota que assinaria por padrão
     * é tirado, e é o mesmo estado em que ele já nasce quando ninguém mexe.
     */
    /**
     * Tipo frouxo de propósito, como o `geo` de `signWithOtp`: `strictNullChecks`
     * está desligado no projeto, o que faz `z.infer` marcar TODA chave como
     * opcional. A forma real é imposta aqui dentro, onde há contexto para a
     * mensagem certa.
     */
    signers?: Array<{ responsibleId?: string; sections?: string[] }> | null;
    /**
     * O CONTRATANTE assina dentro do PORTAL DO CLIENTE, em sessão autenticada,
     * sem código de uso único (`SignatureAuthMethod.RESPONSIBLE_SESSION`).
     *
     * ⚠️ ESTA ESCOLHA É DA EMISSÃO, E SÓ DELA. Ela governa a CLÁUSULA DE
     * ACEITAÇÃO, que é impressa no corpo do orçamento e congelada com os bytes
     * nesta mesma transação: uma coleta emitida por código diz, dentro do
     * instrumento assinado, que o CONTRATANTE se autentica "por código de uso
     * único enviado…", e assinar aquele documento por sessão tornaria a frase
     * falsa no próprio papel que ela existe para sustentar. Converter um
     * signatário depois da emissão exigiria re-renderizar bytes já assinados.
     *
     * É a mesma razão pela qual `countersign` recusa envelope pré-reforma
     * (`ankaa.authMethod !== INTERNAL_SESSION`), e o caminho do portal aplica a
     * simétrica: `signByPortalSession` recusa signatário que não nasceu
     * `RESPONSIBLE_SESSION`, mandando-o para o link com código.
     *
     * DECISÃO DE ENVELOPE, não de signatário. A cláusula é UMA por envelope
     * (`SignatureEnvelope.acceptanceClause`, e o mesmo texto impresso em todos
     * os recortes), então uma coleta metade-código metade-portal precisaria de
     * uma frase que descrevesse as duas — e cada signatário leria, no seu
     * próprio documento, a descrição de uma cerimônia que não é a dele. As
     * DECLARAÇÕES, essas sim, são por signatário, e já seguem
     * `ceremonyKindOf(authMethod)`.
     */
    portalSession?: boolean | null;
  }): Promise<{
    envelopeId: string;
    verificationCode: string;
    channel: SignatureDeliveryChannel;
    /** Um por recorte congelado. Na coleta comum é um só. */
    documents: Array<{ id: string; sections: QuoteSection[]; signers: number }>;
  }> {
    this.assertCeremonyConfigured();

    const mode = this.deliveryMode();
    const { channel, rejected } = resolveSignatureDeliveryChannel(mode, args.channel);
    if (rejected) {
      throw new BadRequestException(
        `Canal de envio "${rejected}" indisponível. ` +
          `Configuração atual: ${channelsForMode(mode)
            .map(c => SIGNATURE_DELIVERY_CHANNEL_LABELS[c])
            .join(' ou ')}.`,
      );
    }

    // A CERIMÔNIA DO CONTRATANTE, decidida aqui e congelada com os bytes.
    // Ver a nota em `args.portalSession`: governa a cláusula de aceitação
    // impressa no documento e o `authMethod` dos signatários do cliente.
    const customerCeremony: Exclude<CeremonyKind, 'INTERNAL'> = args.portalSession
      ? 'PORTAL'
      : 'OTP';

    const loaded = await this.snapshots.buildForQuote(args.quoteId);
    if (!loaded) throw new NotFoundException('Orçamento não encontrado.');
    const { quote, snapshot, hash, materialHash } = loaded;

    // ── UM DOCUMENTO SÓ NÃO DESCREVE DOIS PAGADORES ──────────────────────────
    //
    // O recorte deste envelope é por FUNÇÃO (proprietário, veículo, compras), e
    // nunca por CLIENTE: `buildRenderInput` é chamado com `customerId = null` na
    // emissão, de propósito — o parâmetro só tem uso no caminho não-assinado. Com
    // dois pagadores, o documento congelado sai com:
    //
    //   · a lista de serviços dos DOIS, pelo valor cheio (o filtro por
    //     `invoiceToCustomerId` só roda quando há `segment`);
    //   · o desconto e a condição de pagamento do PRIMEIRO pagador;
    //   · as cláusulas do primeiro, e só dele — as do segundo não aparecem em
    //     lugar nenhum do instrumento;
    //   · o quadro do tomador do primeiro.
    //
    // E todos assinam isso, enquanto a `Billing` de cada um cobra outra coisa. O
    // hash não protege: `quoteSnapshot` também lê `customerConfigs[0]`, então
    // mudar o desconto do segundo produz snapshot idêntico.
    //
    // ⚠️ Medido em produção (17/09/2026): 12 orçamentos têm dois pagadores e
    // NENHUM deles tem envelope — esta recusa não fecha porta que alguém use,
    // fecha porta por onde ninguém passou ainda. Emitir é que seria novidade.
    //
    // A correção definitiva é o recorte por `sections × customerId` (um plano de
    // variante por pagador, cada um com os seus serviços, o seu desconto e as
    // suas cláusulas). Enquanto ela não existe, recusar é a única resposta
    // honesta: assinatura eletrônica sobre documento errado não se conserta
    // depois.
    const pagadores = new Set(
      (quote.customerConfigs ?? []).map((c: { customerId: string }) => c.customerId),
    );
    if (pagadores.size > 1) {
      throw new BadRequestException(
        `Este orçamento fatura para ${pagadores.size} clientes, e a cerimônia de assinatura ainda ` +
          'não recorta o documento por pagador — todos assinariam um instrumento com os serviços, ' +
          'o desconto e as cláusulas de apenas um deles. Separe em um orçamento por cliente antes ' +
          'de enviar para assinatura.',
      );
    }

    // ── COLETA VIVA, OU COLETA JÁ CONCLUÍDA ──────────────────────────────────
    //
    // `RUNNING` sempre foi barrado. `COMPLETED` não era, e a rota aceitava
    // reemitir por cima de um contrato JÁ ASSINADO E SELADO — a tela e o app
    // escondem o botão, mas esconder não é impedir. O acervo mostra o resultado:
    // o orçamento nº 591 tem TRÊS envelopes concluídos e selados, um por cima do
    // outro, cada um com bytes diferentes e todos válidos aos olhos do PAdES.
    // "Qual é o contrato?" deixa de ter resposta.
    //
    // O que existia no lugar da recusa era a SUBSTITUIÇÃO (o anterior virava
    // `SUPERSEDED`). Ela resolvia o sintoma da lista — dois envelopes vivos —
    // sem resolver o fato: o documento superado continua selado, continua
    // verificável no portal público e continua sendo um instrumento assinado
    // pelas duas partes. Um contrato não se revoga emitindo outro.
    //
    // Depois de selado, o caminho é o ADITIVO (identificação do veículo) ou um
    // orçamento novo. Nunca uma segunda coleta sobre o mesmo número.
    const existing = await this.prisma.signatureEnvelope.findFirst({
      where: {
        quoteId: args.quoteId,
        status: { in: [EnvelopeStatus.RUNNING, EnvelopeStatus.COMPLETED] },
      },
      select: { id: true, status: true, version: true },
    });
    if (existing?.status === EnvelopeStatus.RUNNING) {
      throw new BadRequestException(
        'Já existe uma coleta de assinaturas em andamento para este orçamento. ' +
          'Cancele-a antes de emitir outra.',
      );
    }
    if (existing) {
      throw new BadRequestException(
        `Este orçamento já tem uma coleta CONCLUÍDA e assinada (versão ${existing.version}). ` +
          'Reemitir criaria um segundo contrato selado para o mesmo número. Para acrescentar a ' +
          'identificação do veículo use o aditivo; para mudar as condições, abra um orçamento novo.',
      );
    }

    // ── O LAYOUT APROVADO É CONDIÇÃO PARA EMITIR, NÃO PARA APROVAR ───────────
    //
    // O portão de layout mora em `BudgetService.budgetApprove`, que é
    // chamado DEPOIS de tudo: cliente assinou, Ankaa contra-assinou, PAdES
    // aplicado, dossiê congelado. Ele estoura dentro do `try/catch`
    // best-effort de `finalize`, que só loga — e o orçamento fica PENDING com um
    // contrato assinado e selado em cima dele. `retryFinalize` recusa ("já tem o
    // documento final emitido") e nenhuma outra rota reexecutava o gancho.
    //
    // Medido: o orçamento nº 591 tem três envelopes concluídos e selados, o
    // orçamento em PENDING e ZERO layouts. Ninguém conseguiu aprová-lo, e a
    // tentativa de contornar foi justamente reemitir — três vezes.
    //
    // O portão passa para cá porque é AQUI que corrigir ainda é barato: nada foi
    // congelado, ninguém assinou, e o operador está na tela em que escolhe o
    // layout. Depois do selo, o mesmo "não" custa um contrato.
    //
    // ⚠️ `budgetApprove` CONTINUA com o portão dele. São dois pontos porque há
    // dois caminhos até a aprovação (a coleta e a aprovação manual do comercial),
    // e o layout pode ser desvinculado entre a emissão e a conclusão.
    const gate = await this.prisma.budget.findUnique({
      where: { id: args.quoteId },
      select: { layoutFiles: { select: { id: true }, take: 1 } },
    });
    if (!gate?.layoutFiles?.length) {
      throw new BadRequestException(
        'Selecione um layout aprovado antes de enviar o orçamento para assinatura. ' +
          'Sem ele o orçamento não pode ser aprovado depois que o cliente assinar, e a coleta ' +
          'ficaria concluída com o orçamento parado.',
      );
    }

    // O prazo do envelope é a validade do orçamento. Criar uma coleta sobre um
    // orçamento já vencido produzia um envelope nascido expirado: a página abria
    // com "esta coleta não está mais ativa" e o operador não entendia por quê.
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        `A validade deste orçamento venceu em ${this.deadlineLabel(quote.expiresAt)}. ` +
          'Atualize a data de validade antes de enviar para assinatura.',
      );
    }

    // UNIÃO dos responsáveis das N tarefas, deduplicada por `Responsible.id` —
    // a mesma regra do snapshot, e tem de ser a mesma: o elenco impresso no
    // documento e o elenco que entra no hash material precisam ser o mesmo
    // conjunto, senão a coleta nasce com um signatário que o recorte material
    // não protege.
    const responsibles = dedupeResponsibles(
      sortQuoteTasks(quote.tasks ?? []).flatMap(t => t.responsibles ?? []),
    );
    if (responsibles.length === 0) {
      throw new BadRequestException(
        'Selecione ao menos um responsável na tarefa antes de enviar o orçamento para assinatura.',
      );
    }

    // ---- Quem assina, e o que cada um recebe ---------------------------------
    //
    // O recorte sai das funções do contato e o operador sobrescreve na emissão.
    // Recorte vazio significa não assinar — é o estado padrão do gestor de frota
    // e do motorista, e é também o que o operador escolhe para tirar alguém da
    // coleta sem mexer no cadastro da tarefa.
    const overrides = new Map<string, QuoteSection[]>();
    for (const entry of args.signers ?? []) {
      if (entry?.responsibleId) {
        // `withAlwaysSections`, não `canonicalSections`: a identificação do
        // veículo entra em todo recorte que assina, marcada ou não. A tela nem
        // oferece a caixa; forçar aqui é o que garante a regra mesmo para um
        // corpo montado à mão ou por um app antigo.
        overrides.set(entry.responsibleId, withAlwaysSections(entry.sections ?? []));
      }
    }
    // Sobrescrita para um contato que não está na tarefa é RECUSADA, não
    // ignorada: significa que a tela e a tarefa discordam sobre quem participa, e
    // seguir em silêncio emitiria uma coleta diferente da que o operador viu.
    const unknownOverride = [...overrides.keys()].filter(
      id => !responsibles.some(r => r.id === id),
    );
    if (unknownOverride.length) {
      throw new BadRequestException(
        'A tela está desatualizada: um ou mais responsáveis selecionados não fazem mais parte ' +
          'desta tarefa. Recarregue a página e envie novamente.',
      );
    }

    const roster = responsibles.map(r => ({
      responsible: r,
      sections: overrides.has(r.id) ? overrides.get(r.id)! : sectionsForRoles(r.roles),
    }));
    const signing = roster.filter(entry => entry.sections.length > 0);

    if (signing.length === 0) {
      const semInteresse = roster
        .map(e => `${e.responsible.name} (${formatResponsibleRoles(e.responsible.roles) || 'sem função'})`)
        .join(', ');
      throw new BadRequestException(
        'Nenhum responsável desta tarefa tem campos de interesse definidos, então não há a ' +
          `quem enviar o orçamento para assinatura: ${semInteresse}. ` +
          'Gestor de frota e motorista não assinam por padrão — marque as seções que cada um ' +
          'deve receber na tela de envio, ou acrescente um responsável comercial à tarefa.',
      );
    }

    // O contato do canal escolhido é o endereço do convite E do código. Sem ele
    // o responsável entra numa coleta que nunca vai conseguir concluir, e a
    // falha só apareceria lá na frente como INVITATION_FAILED. Barrar aqui é o
    // que mantém o erro perto da causa: falta cadastro.
    //
    // A conferência segue o CANAL, não o cadastro inteiro: `Responsible.email` é
    // opcional (e `@unique`, por isso "" vira null) enquanto `Responsible.phone`
    // é NOT NULL, então exigir e-mail numa coleta por WhatsApp barraria
    // responsável perfeitamente alcançável.
    //
    // E só de QUEM VAI ASSINAR: um motorista sem e-mail cadastrado não pode mais
    // barrar a coleta inteira, porque ele nem recebe convite.
    const missingContact = signing
      .map(e => e.responsible)
      .filter(r => (channel === 'WHATSAPP' ? onlyDigits(r.phone).length < 10 : !r.email?.includes('@')));
    // ── NO PORTAL, O CONTATO DEIXA DE SER CONDIÇÃO PARA ASSINAR ──────────────
    //
    // Mesma decisão, e pelo mesmo motivo, que tirou o signatário da Ankaa desta
    // guarda: quem assina por sessão não recebe código nenhum, então o e-mail
    // ou o telefone aqui é endereço de AVISO, não segundo fator. Barrar uma
    // coleta inteira por um canal que a cerimônia não usa seria cobrar do
    // negócio um problema de cadastro.
    //
    // O que se perde é o aviso, e isso fica registrado — não em silêncio. Entrar
    // no portal continua possível (o telefone do responsável é NOT NULL e o OTP
    // de login segue o canal do portal, que é outra configuração).
    if (missingContact.length && customerCeremony === 'PORTAL') {
      this.logger.warn(
        `Coleta por PORTAL do orçamento ${args.quoteId}: ` +
          `${missingContact.map(r => r.name).join(', ')} não tem contato válido para ` +
          `${SIGNATURE_DELIVERY_CHANNEL_LABELS[channel]} — o convite não sai para essa(s) ` +
          'pessoa(s). A assinatura pelo portal continua disponível.',
      );
    } else if (missingContact.length) {
      throw new BadRequestException(
        channel === 'WHATSAPP'
          ? `Responsáveis sem telefone válido no cadastro: ${missingContact
              .map(r => r.name)
              .join(', ')}. O convite e o código de assinatura são enviados por WhatsApp ` +
            'para o telefone cadastrado (com DDD).'
          : `Responsáveis sem e-mail válido no cadastro: ${missingContact
              .map(r => r.name)
              .join(', ')}. O convite e o código de assinatura são enviados ao e-mail cadastrado.`,
      );
    }

    const ankaaUser = await this.resolveAnkaaSigner(quote);

    // O signatário da Ankaa NÃO é mais barrado por falta de contato.
    //
    // Ele deixou de assinar por link com código e passou a contra-assinar dentro
    // do sistema, em sessão autenticada (`SignatureAuthMethod.INTERNAL_SESSION`).
    // O e-mail/WhatsApp que ele recebe quando o cliente termina virou AVISO — a
    // ação está no painel do orçamento, atrás do login, e existe com ou sem
    // aviso. Continuar exigindo o cadastro dele impediria uma coleta inteira por
    // causa de um canal que a cerimônia não usa mais para autenticar ninguém.
    // A ausência aparece no preflight, para o operador saber que o aviso não sai.
    if (!ankaaUser.email?.includes('@') && onlyDigits(ankaaUser.phone).length < 10) {
      this.logger.warn(
        `O representante da Ankaa (${ankaaUser.name}) não tem e-mail nem telefone no cadastro: ` +
          'ele não será avisado quando o cliente terminar de assinar. A contra-assinatura ' +
          'continua disponível no painel do orçamento.',
      );
    }

    const previous = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId: args.quoteId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });

    const verificationCode = formatVerificationCode(randomBytes(24));

    // ---- Os RECORTES -------------------------------------------------------
    //
    // Contatos com o mesmo recorte compartilham o mesmo PDF. É essa deduplicação
    // que faz a coleta comum — todo mundo COMERCIAL, todo mundo recebendo tudo —
    // continuar congelando UM arquivo, exatamente como antes deste recurso.
    const ankaaSignerId = randomUUID();
    // ⚠️ RESOLVIDO UMA VEZ, aqui, e usado nos dois lugares que precisam dele: o
    // subtítulo IMPRESSO na linha de assinatura do PDF que está prestes a ser
    // congelado, e o `informedCargo` que a contra-assinatura vai gravar no selo.
    // Enquanto eram duas expressões, o mesmo documento dizia dois cargos. Ver
    // `ankaaCargoOf` e o uso do valor congelado em `countersign`.
    const ankaaCargo = this.ankaaCargoOf(ankaaUser);
    const ankaaSeed = {
      id: ankaaSignerId,
      responsibleId: null as string | null,
      // O signatário da Ankaa é um User, que tem CPF próprio. Não há write-back
      // aqui: o CPF do colaborador é gerido no DP, não numa cerimônia de
      // assinatura.
      cpf: ankaaUser.cpf ?? null,
      cargo: ankaaCargo as string | null,
      userId: ankaaUser.id,
      name: ankaaUser.name,
      phone: onlyDigits(ankaaUser.phone ?? COMPANY.phoneClean),
      email: ankaaUser.email,
      orderGroup: 1,
      side: 'ANKAA' as const,
      subtitle: `${ankaaCargo} — ${COMPANY.name}`,
    };

    // ⚠️ SEM CPF, O SELO DA ANKAA SAI SEM DOCUMENTO DO SIGNATÁRIO.
    //
    // Não barra: a identidade deste ato vem da sessão e do `userId` congelado, e
    // travar o fechamento de um negócio por um campo vazio no cadastro do DP
    // seria cobrar do cliente um problema nosso. Mas era um `logger.warn` no
    // instante do clique e mais nada — o operador nunca via. Hoje o acervo
    // INTEIRO de contra-assinaturas recentes sai sem CPF, porque o cadastro do
    // representante está sem ele e ninguém foi avisado. O preflight passa a
    // dizer isso na tela de envio, que é onde ainda dá para corrigir antes de
    // congelar o documento.
    if (!onlyDigits(ankaaUser.cpf ?? '')) {
      this.logger.warn(
        `O representante da Ankaa (${ankaaUser.name}) não tem CPF no cadastro: o selo da ` +
          `contra-assinatura do orçamento ${args.quoteId} sairá sem o documento do signatário.`,
      );
    }

    const customerCompany =
      primaryTask(quote)?.customer?.corporateName ?? primaryTask(quote)?.customer?.fantasyName ?? '';

    interface VariantPlan {
      sections: QuoteSection[];
      variantKey: string;
      isFull: boolean;
      seeds: Array<{
        id: string;
        responsibleId: string | null;
        cpf: string | null;
        /**
         * O cargo CONGELADO, e só do lado da Ankaa. O do cliente é digitado no
         * ato (`informedCargo`, via `requestOtp`) e por isso nasce nulo aqui.
         */
        cargo: string | null;
        userId: string | null;
        name: string;
        phone: string;
        email: string | null;
        orderGroup: number;
        side: 'ANKAA' | 'CUSTOMER';
        subtitle: string;
      }>;
    }

    const variants = new Map<string, VariantPlan>();
    for (const entry of signing) {
      const key = variantKeyOf(entry.sections);
      let plan = variants.get(key);
      if (!plan) {
        plan = {
          sections: entry.sections,
          variantKey: key,
          isFull: isFullSections(entry.sections),
          seeds: [],
        };
        variants.set(key, plan);
      }
      plan.seeds.push({
        id: randomUUID(),
        responsibleId: entry.responsible.id,
        // Âncora de identidade: quando o contato já tem CPF no cadastro, o
        // signatário completa só os dígitos ocultos, e completar certo é o que
        // vale como conferência. Sem CPF cadastrado ele digita o número inteiro
        // — e a primeira assinatura o grava (ver `persistCpfToResponsible`).
        cpf: entry.responsible.cpf ?? null,
        // O cliente declara o cargo dele no ato, na tela pública.
        cargo: null,
        userId: null,
        name: entry.responsible.name,
        phone: onlyDigits(entry.responsible.phone),
        email: entry.responsible.email,
        orderGroup: 0,
        side: 'CUSTOMER',
        subtitle: customerCompany,
      });
    }

    // O recorte COMPLETO existe SEMPRE, mesmo que nenhum contato do cliente o
    // receba. É ele que a Ankaa assina, e é ele o instrumento: sem ele, uma
    // coleta em que só o marketing e o financeiro assinam produziria dois
    // pedaços do contrato e nenhum contrato. Também é ele que o dossiê copia, que
    // o portal de verificação descreve e que as colunas do próprio envelope
    // espelham.
    const fullKey = variantKeyOf([...FULL_SECTIONS]);
    if (!variants.has(fullKey)) {
      variants.set(fullKey, {
        sections: [...FULL_SECTIONS],
        variantKey: fullKey,
        isFull: true,
        seeds: [],
      });
    }

    // Ordem determinística: o completo primeiro, depois os recortes por chave.
    // Sem ela a ordem viria do `Map`, que segue a ordem de inserção do roster —
    // e o mesmo orçamento emitido duas vezes produziria arquivos com sufixos
    // trocados, o que só apareceria como confusão no painel.
    const plans = [...variants.values()].sort((a, b) =>
      a.isFull === b.isFull ? a.variantKey.localeCompare(b.variantKey) : a.isFull ? -1 : 1,
    );

    // A Ankaa aparece — e assina — em TODOS os recortes. Cada recorte é um
    // documento bilateral: sem a linha dela, o financeiro assinaria sozinho um
    // papel que ninguém contra-assinou. O ato é UM só (ver `countersign`), e é
    // legítimo que valha para todos porque cada recorte é um subconjunto estrito
    // do documento completo que ela leu — assinar o todo é, a fortiori, assinar
    // cada parte.
    const rendered = await this.renderer.renderAll(
      plans.map(plan =>
        this.buildRenderInput(
          quote,
          [...plan.seeds, ankaaSeed],
          verificationCode,
          null,
          channel,
          plan.sections,
          false,
          customerCeremony,
        ),
      ),
    );

    // Não há mais teto de signatários: o bloco de assinaturas se parte em quantas
    // folhas precisar (`renderSignatureSheets`), e a arte que não caberia
    // conferível migra para o corpo do orçamento. Esta guarda deixou de ser a
    // regra "gente demais" e virou o que sempre deveria ter sido — a última
    // verificação de que nada foi clipado antes de congelar os bytes. Se ela
    // disparar, o defeito é do documento, não da coleta, e mandar o operador
    // tirar responsáveis seria pedir que ele pagasse por um bug.
    const overflowedPlan = plans.find((_, i) => rendered[i].overflowed);
    if (overflowedPlan) {
      throw new BadRequestException(
        'Não foi possível montar a folha de assinaturas deste orçamento ' +
          `(recorte "${describeSections(overflowedPlan.sections)}") — o documento não foi ` +
          'congelado e nada foi enviado. Fale com o suporte: é uma falha na geração do ' +
          'documento, não na sua seleção de responsáveis.',
      );
    }

    // Persistir os PDFs antes da transação: gravar arquivo em disco não é
    // transacional, e segurar uma transação aberta durante N escritas de ~700KB
    // é o tipo de coisa que estoura o pool sob concorrência.
    const persisted = await Promise.all(
      plans.map(async (plan, i) => ({
        plan,
        render: rendered[i],
        sha256: sha256Hex(rendered[i].pdf),
        fileId: await this.persistPdf(
          quote,
          rendered[i].pdf,
          `original${variantFilenameSuffix(plan.sections)}`,
          verificationCode,
        ),
      })),
    );

    const full = persisted.find(p => p.plan.isFull)!;
    const originalSha256 = full.sha256;
    const deadlineAt = quote.expiresAt;

    const envelope = await this.prisma.$transaction(async tx => {
      // A MESMA PERGUNTA DO PORTÃO, AGORA DENTRO DA TRANSAÇÃO.
      //
      // O portão lá em cima roda antes do render e da escrita dos PDFs — dezenas
      // de segundos antes desta linha. Nesse intervalo o último signatário do
      // cliente pode assinar e a coleta anterior concluir, e aí a leitura do
      // portão estaria obsoleta. Repetir aqui é o que impede que a corrida
      // produza exatamente o que o portão existe para impedir: dois envelopes
      // concluídos para o mesmo orçamento.
      const live = await tx.signatureEnvelope.findFirst({
        where: {
          quoteId: args.quoteId,
          status: { in: [EnvelopeStatus.RUNNING, EnvelopeStatus.COMPLETED] },
        },
        select: { version: true, status: true },
      });
      if (live) {
        throw new BadRequestException(
          `Outra coleta deste orçamento (versão ${live.version}) mudou de estado durante a ` +
            'emissão. Recarregue a tela e confira antes de emitir novamente.',
        );
      }

      // NOVA COLETA, NOVO DIREITO A UM AVISO DE VENCIMENTO.
      //
      // `Budget.expiryNoticeSentAt` impede que a varredura horária avise duas
      // vezes pelo MESMO vencimento. Mas um orçamento reformulado — preço
      // revisto, validade nova — que vença outra vez é outra proposta, e o
      // cliente precisa saber dela também. Sem esta limpeza, o segundo
      // vencimento passaria em silêncio: o carimbo do primeiro continuaria lá, a
      // varredura leria "já avisei" e ninguém receberia nada.
      await tx.budget.update({
        where: { id: args.quoteId },
        data: { expiryNoticeSentAt: null },
      });

      const created = await tx.signatureEnvelope.create({
        data: {
          quoteId: args.quoteId,
          status: EnvelopeStatus.RUNNING,
          version: (previous?.version ?? 0) + 1,
          previousEnvelopeId: previous?.id ?? null,
          sequential: true,
          deadlineAt,
          // ESPELHO do recorte completo — ver a nota no schema. Escrito aqui e no
          // `finalize`, sempre a partir de `full`, nunca de forma independente.
          originalFileId: full.fileId,
          originalSha256,
          anchors: full.render.anchors as unknown as Prisma.InputJsonValue,
          // Onde carimbar a identidade que ainda não existe. Vazio quando o
          // cadastro já estava completo — aí não há lacuna no documento.
          lateSlots: full.render.lateSlots as unknown as Prisma.InputJsonValue,
          quoteSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          quoteSnapshotSha256: hash,
          quoteTermsSha256: materialHash,
          verificationCode,
          legalBasis: LEGAL_BASIS,
          // A MESMA frase que `buildRenderInput` acabou de IMPRIMIR nos PDFs
          // congelados logo acima. As duas leem `customerCeremony`; divergirem
          // faria a coluna afirmar uma cerimônia e o papel assinado, outra.
          acceptanceClause: acceptanceClauseFor(channel, customerCeremony),
          createdById: args.actorUserId,
          sentAt: new Date(),
        },
      });

      // ═══════════════════════════════════════════════════════════════════
      // O ORÇAMENTO PASSA A "AGUARDANDO ASSINATURA" — no MESMO commit
      // ═══════════════════════════════════════════════════════════════════
      //
      // ⛔ POR QUE AQUI DENTRO, E NÃO NUM SEGUNDO ATO DO OPERADOR.
      //
      // A emissão congela o documento e dispara os convites: a partir deste
      // instante o orçamento ESTÁ aguardando assinatura, quer alguém se lembre
      // de mudar o estado, quer não. Enquanto isso dependeu de uma segunda
      // ação, o estado derivou — e derivou em silêncio: no acervo do dono havia
      // NOVE orçamentos em `REQUESTED` com coleta `RUNNING` e assinaturas já
      // colhidas. A tela do comercial, lendo só o estado, continuava
      // oferecendo "Enviar para pré-aprovação" para um documento que o cliente
      // já tinha assinado.
      //
      // ⛔ E a deriva tinha um FIM SEM SAÍDA, não só feiura: quando a coleta
      // conclui, o fluxo chama `budgetApprove()` — e `REQUESTED → APPROVED` NÃO
      // é aresta do grafo (`budget.service.ts`, `ALLOWED`). O documento
      // assinado não teria como virar orçamento aprovado; nenhuma tela ofereceu
      // saída porque nenhuma sabia que havia problema.
      //
      // ⚠️ `CANCELLED` fica de fora: `CANCELLED → ∅` é terminal de propósito, e
      // forçá-lo a PENDING aqui contrabandearia uma ressurreição por uma porta
      // que não é a dela.
      const antes = await tx.budget.findUnique({
        where: { id: args.quoteId },
        select: { status: true },
      });
      const estadoAnterior = antes?.status as TASK_QUOTE_STATUS | undefined;
      if (
        estadoAnterior &&
        estadoAnterior !== TASK_QUOTE_STATUS.PENDING &&
        estadoAnterior !== TASK_QUOTE_STATUS.CANCELLED
      ) {
        await tx.budget.update({
          where: { id: args.quoteId },
          data: {
            status: TASK_QUOTE_STATUS.PENDING,
            // ⚠️ Pela TABELA, nunca `MAP[status] || 1`: aquela forma transforma
            // ordem 0 em 1 em silêncio, e o mesmo status passa a ter ordem
            // diferente conforme o caminho que o escreveu.
            statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.PENDING],
          },
        });
        await this.changeLogs.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: args.quoteId,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: estadoAnterior,
          newValue: TASK_QUOTE_STATUS.PENDING,
          reason: 'Documento emitido para assinatura — o orçamento passa a aguardar as assinaturas.',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: args.actorUserId ?? null,
          userId: args.actorUserId ?? null,
          // MESMA transação: um estado que só mude se o envelope existir, e um
          // envelope que só exista se o estado mudar.
          transaction: tx,
        });
      }

      for (const { plan, render, sha256, fileId } of persisted) {
        const document = await tx.envelopeDocument.create({
          data: {
            envelopeId: created.id,
            sections: plan.sections,
            variantKey: plan.variantKey,
            isFull: plan.isFull,
            originalFileId: fileId,
            originalSha256: sha256,
            anchors: render.anchors as unknown as Prisma.InputJsonValue,
            lateSlots: render.lateSlots as unknown as Prisma.InputJsonValue,
            contentPages: render.contentPages,
          },
        });

        // O signatário da Ankaa entra UMA vez, no recorte completo — ele tem
        // âncora em todos, mas um registro só, porque o ato é um só.
        const seeds = plan.isFull ? [...plan.seeds, ankaaSeed] : plan.seeds;
        for (const seed of seeds) {
          await tx.envelopeSigner.create({
            data: {
              id: seed.id,
              envelopeId: created.id,
              documentId: document.id,
              responsibleId: seed.responsibleId,
              declaredCpf: seed.cpf ?? null,
              // ⚠️ CARGO CONGELADO na emissão, só para a Ankaa — é o MESMO valor
              // impresso na linha de assinatura do PDF congelado nesta mesma
              // transação. A contra-assinatura o lê de volta em vez de recalcular
              // do cadastro, que é o que fazia selo e papel divergirem.
              informedCargo: seed.cargo ?? null,
              userId: seed.userId,
              orderGroup: seed.orderGroup,
              declaredName: seed.name,
              declaredPhone: seed.phone || null,
              declaredEmail: seed.email ?? null,
              contactSource: 'customer_registry',
              // O CLIENTE assina por código no contato dele: um OTP na caixa (ou
              // no celular) do signatário é a prova de posse do canal que sustenta
              // a autoria. O canal fica GRAVADO no signatário, não lido da
              // configuração na hora de usar — um envelope emitido sob `whatsapp`
              // continua sendo um envelope de WhatsApp depois que a variável mudar.
              //
              // A ANKAA assina em sessão autenticada. Mandar um código para o
              // próprio diretor provaria que ele tem acesso à caixa dele, o que
              // ninguém contesta; o que dá segurança do nosso lado é a sessão, que
              // o servidor emitiu. E um link público sem código seria pior que
              // inútil: quem recebesse a mensagem encaminhada obrigaria a empresa.
              //
              // ⚠️ E O CLIENTE PODE ASSINAR POR SESSÃO TAMBÉM — pelo PORTAL,
              // quando a emissão assim o decidiu. `RESPONSIBLE_SESSION`, nunca
              // `INTERNAL_SESSION`: os dois dispensam o código e é só isso que
              // têm em comum. Marcar um contato do cliente como
              // `INTERNAL_SESSION` faria `assertOtpCeremony`, `resendInvitation`,
              // `noticeChannelOf` e `getPublicState` tratarem-no como lado
              // Ankaa, em silêncio — e a cláusula impressa, que é por envelope,
              // continuaria dizendo "por código de uso único".
              authMethod:
                seed.side === 'ANKAA'
                  ? SignatureAuthMethod.INTERNAL_SESSION
                  : customerCeremony === 'PORTAL'
                    ? SignatureAuthMethod.RESPONSIBLE_SESSION
                    : authMethodForChannel(channel),
              accessToken: randomBytes(32).toString('base64url'),
              tokenExpiresAt: deadlineAt,
            },
          });
        }
      }

      return created;
    });

    await this.audit.record(envelope.id, {
      eventType: 'ENVELOPE_CREATED',
      actorType: 'OPERATOR',
      actorId: args.actorUserId,
      documentHash: originalSha256,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: {
        version: envelope.version,
        signers: signing.length + 1,
        contentPages: full.render.contentPages,
        snapshotHash: hash,
        // O canal entra na trilha na CRIAÇÃO, não só nos eventos de envio: é o
        // que permite responder "por onde esta coleta foi conduzida" sem
        // depender de os eventos de entrega terem sido gravados.
        channel: auditChannelOf(channel),
        deliveryMode: mode,
        // COMO O CONTRATANTE SE AUTENTICA NESTA COLETA. Entra na trilha na
        // criação porque é a decisão que a cláusula congelada descreve, e é a
        // única prova, anos depois, de que o texto impresso e o `authMethod` dos
        // signatários nasceram da mesma escolha.
        customerCeremony,
        // QUEM recebeu O QUÊ. É a única prova de que a Ankaa não escolheu o
        // recorte depois do fato: a trilha é append-only e encadeada, e esta
        // linha é gravada no mesmo instante em que os bytes são congelados.
        documents: persisted.map(p => ({
          variant: p.plan.variantKey,
          sections: p.plan.sections,
          sha256: p.sha256,
          signers: p.plan.seeds.map(s => s.name),
        })),
        // Quem ficou de fora e por quê — o registro do que o operador decidiu
        // NÃO enviar, que é tão auditável quanto o que ele enviou.
        excluded: roster
          .filter(e => e.sections.length === 0)
          .map(e => ({
            name: e.responsible.name,
            roles: e.responsible.roles,
            overridden: overrides.has(e.responsible.id),
          })),
      },
    });
    await this.audit.record(envelope.id, {
      eventType: 'DOCUMENT_FROZEN',
      actorType: 'SYSTEM',
      documentHash: originalSha256,
    });

    // SEM `await`, de propósito — e a razão mudou de "é lento" para "não cabe".
    //
    // O envio passou a ter ritmo humano: a guarda de saída espaça mensagens
    // consecutivas (ver `WhatsAppOutboundGuard`), e uma tarefa com 5 responsáveis
    // — que existe, e há tarefas com 8, 16 e 22 — levaria mais de um minuto só
    // de espera deliberada, dentro de um POST. Nginx corta antes, e o operador
    // veria "erro ao emitir" para uma coleta que foi criada com sucesso e cujos
    // convites estavam saindo.
    //
    // Nada de prova se perde: cada convite grava INVITATION_SENT ou
    // INVITATION_FAILED na trilha quando o servidor do WhatsApp responde, e o
    // card da tarefa lê o estado por signatário. O que muda é que o resultado
    // aparece em segundos na tela em vez de segurar a resposta do POST.
    void this.dispatchInvitations(envelope.id).catch(error =>
      this.logger.error(
        `Falha ao despachar os convites do envelope ${envelope.id}: ${
          error instanceof Error ? error.message : error
        }`,
      ),
    );

    return {
      envelopeId: envelope.id,
      verificationCode,
      channel,
      documents: persisted.map(p => ({
        id: p.fileId,
        sections: p.plan.sections,
        signers: p.plan.seeds.length,
      })),
    };
  }

  // ===========================================================================
  // RECORTES — resolução comum a todos os caminhos da cerimônia
  // ===========================================================================

  /**
   * Como aquele signatário é autenticado.
   *
   * `INTERNAL_SESSION` é o lado da Ankaa, que contra-assina dentro do sistema.
   * `RESPONSIBLE_SESSION` é o contato do CLIENTE que assina de dentro do Portal
   * do Cliente, também sem código. Todo o resto é OTP, inclusive os métodos
   * legados (`SMS_OTP`) que continuam no enum porque envelopes já selados os
   * carregam na evidência.
   *
   * ⚠️ ERA UM TERNÁRIO DE UMA LINHA, e o ternário é que era o perigo.
   *
   *   Ele dizia "INTERNAL_SESSION → INTERNAL, tudo o mais → OTP". Um valor novo
   *   de sessão — que não é OTP coisa nenhuma — cairia no `else` e seria tratado
   *   como coleta por código pelos QUATRO dependentes desta função:
   *   `assertOtpCeremony` (deixaria o signatário de sessão assinar pelo link
   *   público, sem código, que é uma capability de obrigar a empresa viajando
   *   por e-mail), `resendInvitation`, `noticeChannelOf` e `getPublicState`.
   *   O atalho inverso — reusar `INTERNAL_SESSION` para o cliente — é pior
   *   ainda: os quatro passariam a tratar um contato do CLIENTE como lado
   *   ANKAA, em silêncio.
   *
   *   Por isso agora é um `switch` sobre valores NOMEADOS, com `default`
   *   explícito: todo valor do enum aparece aqui, e acrescentar um sem decidir o
   *   que ele é passa a ser uma escolha visível.
   */
  private ceremonyKindOf(authMethod: SignatureAuthMethod | string): CeremonyKind {
    // A tabela-verdade mora em `ceremony-kind.ts`, sem dependência nenhuma, para
    // que ela possa ser percorrida por teste puro — era um ternário privado
    // dentro deste arquivo de 7.900 linhas e não havia como verificá-la.
    // O método fica, porque são sete chamadas e o `this.` é o que as mantém
    // legíveis.
    return ceremonyKindOfAuthMethod(authMethod);
  }

  /**
   * Esta cerimônia dispensa o código de uso único?
   *
   * `INTERNAL` e `PORTAL` são as duas sessões. O que as une é só isto — o resto
   * (quem convida, por onde avisa, onde fica o botão) é oposto entre as duas, e
   * é por isso que esta pergunta existe separada em vez de virar um
   * `!== 'OTP'` solto em sete lugares.
   */
  private isSessionCeremony(authMethod: SignatureAuthMethod | string): boolean {
    return isSessionCeremony(authMethod);
  }

  /**
   * O canal em que ESTA coleta fala com as pessoas.
   *
   * Lido dos signatários do CLIENTE, e não da configuração de agora nem do
   * signatário da Ankaa: o lado do cliente é quem carrega o canal no `authMethod`
   * (é lá que ele é a própria autenticação), enquanto o lado da Ankaa passou a
   * gravar `INTERNAL_SESSION`, que não é canal nenhum. Sem isto o aviso de
   * contra-assinatura de uma coleta de WhatsApp sairia por e-mail — e a trilha
   * registraria "email" numa cerimônia conduzida por WhatsApp.
   *
   * ⚠️ O FILTRO É `isSessionCeremony`, não `!== INTERNAL_SESSION`.
   *   `RESPONSIBLE_SESSION` também não descreve canal nenhum, e numa coleta de
   *   WhatsApp assinada pelo portal ele seria o primeiro `orderGroup === 0`
   *   encontrado — `channelForAuthMethod` devolveria EMAIL (o padrão dela) e o
   *   aviso sairia pelo canal errado, com "email" gravado na trilha
   *   append-only. Numa coleta 100% de portal não há canal a descobrir e o
   *   padrão vale; o que não pode é um signatário de sessão MASCARAR o canal de
   *   uma coleta mista.
   */
  private noticeChannelOf(
    signers: ReadonlyArray<{ orderGroup: number; authMethod: SignatureAuthMethod }>,
  ): SignatureDeliveryChannel {
    const customer = signers.find(
      s => s.orderGroup === 0 && !this.isSessionCeremony(s.authMethod),
    );
    return channelForAuthMethod(customer?.authMethod);
  }

  /**
   * O canal em que se FALA com um signatário — convite, lembrete, aviso.
   *
   * ⚠️ `channelForAuthMethod` SOZINHA NÃO SERVE para signatário de sessão.
   *   Ela lê o canal do `authMethod`, e `INTERNAL_SESSION`/`RESPONSIBLE_SESSION`
   *   não descrevem canal nenhum — caem no padrão dela, que é EMAIL. Numa coleta
   *   de WhatsApp isso manda a mensagem pelo canal errado E grava "email" numa
   *   trilha append-only de um envelope de WhatsApp.
   *
   *   Para eles o canal é o da COLETA (`noticeChannelOf`), que é lido dos
   *   signatários que de fato carregam um.
   *
   * UM SÓ LUGAR, e é o ponto: a regra vale em SEIS caminhos de mensagem
   * (convite, reenvio, lembrete, vencimento, anulação, recusa de um colega) e
   * repeti-la em seis ternários era garantia de que um deles envelheceria — foi
   * exatamente assim que o e-mail acabou hardcoded em seis pontos em 07/2026.
   */
  private deliveryChannelFor(
    signer: { authMethod: SignatureAuthMethod },
    siblings: ReadonlyArray<{ orderGroup: number; authMethod: SignatureAuthMethod }>,
  ): SignatureDeliveryChannel {
    return this.isSessionCeremony(signer.authMethod)
      ? this.noticeChannelOf(siblings)
      : channelForAuthMethod(signer.authMethod);
  }

  /**
   * As lacunas de cadastro tardio que AINDA estão vazias.
   *
   * POR QUE ISTO EXISTE
   *   O selo PAdES é disparado pela contra-assinatura da Ankaa, no mesmo
   *   segundo. A partir dali os bytes são imutáveis: uma lacuna que ainda diga
   *   "a registrar" vai dizer isso para sempre, e o dado que chegar depois
   *   existirá só na trilha. Medido no orçamento nº 81ZR-79SY-6EN5: o chassi foi
   *   cadastrado 14 MINUTOS depois do selo, pela mesma pessoa, na mesma sessão —
   *   e ficou fora do documento assinado por catorze minutos.
   *
   *   O sistema sabia disso no instante do clique e não dizia nada. Esta função
   *   é o que permite dizer.
   *
   * Lê as lacunas dos RECORTES (todos têm as mesmas desde que a identificação do
   * veículo virou obrigatória) e as confronta com o cadastro de agora.
   */
  private pendingLateSlots(env: {
    lateSlots?: unknown;
    documents?: Array<{ lateSlots?: unknown }>;
    quote: {
      tasks?: Array<{
        id: string;
        createdAt?: Date | null;
        serialNumber?: string | null;
        customerOrderNumber?: string | null;
        truck?: { plate?: string | null; chassisNumber?: string | null } | null;
      }> | null;
    };
  }): Array<{ key: string; label: string }> {
    const reserved = new Set<string>();
    const collect = (raw: unknown) => {
      if (raw && typeof raw === 'object') for (const key of Object.keys(raw)) reserved.add(key);
    };
    collect(env.lateSlots);
    for (const doc of env.documents ?? []) collect(doc.lateSlots);
    if (reserved.size === 0) return [];

    const tasks = sortQuoteTasks(env.quote.tasks ?? []);
    const multi = tasks.length > 1;

    // O registro responde às DUAS formas de chave — `plate#<taskId>` (envelopes
    // desta feature em diante) e `plate` cru (os anteriores, que têm uma tarefa
    // só). Ver `buildLateValueMap`, que produz o mesmo par pelo mesmo motivo:
    // um envelope congelado não pode ser reescrito, então quem o lê é que se
    // adapta.
    const registry: Record<string, string | null | undefined> = {};
    const labelSuffix: Record<string, string> = {};
    tasks.forEach((t, index) => {
      const values: Record<string, string | null | undefined> = {
        serialNumber: t.serialNumber,
        plate: t.truck?.plate,
        chassis: t.truck?.chassisNumber,
        orderNumber: t.customerOrderNumber,
      };
      const suffix = multi
        ? ` — ${t.serialNumber ? `nº ${t.serialNumber}` : (t.truck?.plate ?? t.id.slice(0, 8))}`
        : '';
      for (const [field, value] of Object.entries(values)) {
        registry[lateSlotKey(field, t.id)] = value;
        labelSuffix[lateSlotKey(field, t.id)] = suffix;
        if (index === 0) {
          registry[field] = value;
          labelSuffix[field] = '';
        }
      }
    });

    return [...reserved]
      .filter(key => !(registry[key] ?? '').trim())
      .map(key => {
        const { field } = parseLateSlotKey(key);
        return {
          key,
          label: `${LATE_SLOT_LABELS[field] ?? field}${labelSuffix[key] ?? ''}`,
        };
      })
      // Ordem estável para a mensagem e para a tela.
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * As seções do recorte de um signatário, em ordem canônica.
   *
   * Envelope anterior a este recurso não tem recorte gravado; ali a resposta é o
   * documento inteiro, que é exatamente o que aquelas coletas de fato entregaram.
   */
  private sectionsOf(document: { sections?: string[] | null } | null | undefined): QuoteSection[] {
    const stored = canonicalSections(document?.sections ?? null);
    return stored.length ? stored : [...FULL_SECTIONS];
  }

  /**
   * As declarações que ESTE signatário lê, já renderizadas.
   *
   * Um só lugar para as três chamadas (tela pública, ato de assinar, ato de
   * contra-assinar): o texto persistido em `EnvelopeSigner.declarations` tem de
   * ser byte a byte o que foi exibido, e montá-lo em três pontos era garantia de
   * que um deles envelheceria.
   */
  private renderDeclarationsFor(args: {
    kind: CeremonyKind;
    channel: SignatureDeliveryChannel;
    sections: QuoteSection[];
    budgetNumber: number;
    total: number;
    cargo: string | null;
    company: string;
  }): Array<{ key: string; text: string }> {
    const showsTotal = hasSection(args.sections, 'PRICING');
    return declarationsFor({ channel: args.channel, kind: args.kind, showsTotal }).map(d => ({
      key: d.key,
      text: renderDeclaration(d.template, {
        budgetNumber: args.budgetNumber,
        total: formatCurrencyBRL(args.total),
        cargo: args.cargo ?? '{cargo}',
        company: args.company,
        ankaaCompany: COMPANY.corporateName,
        sections: args.sections.map(x => QUOTE_SECTION_LABELS[x]).join(', ') || 'texto básico',
      }),
    }));
  }

  /**
   * O cargo que a Ankaa AFIRMA sobre o próprio representante.
   *
   * ⚠️ FONTE ÚNICA — é daqui que saem o SUBTÍTULO impresso na linha de
   * assinatura do documento congelado e o `informedCargo` do selo. Eram duas
   * expressões diferentes até 17/09: o PDF congelava
   * `"${COMPANY.directorTitle} — ${COMPANY.name}"` e o selo gravava
   * `position || sector || directorTitle`. Um comentário afirmava que o recuo
   * impedia a divergência — e era falso sempre que a pessoa tinha posição ou
   * setor preenchidos. Medido no acervo: a contra-assinatura mais recente tem
   * `informedCargo = 'Comercial'` sobre um documento que diz "Diretor
   * Comercial". Dois cargos, mesma pessoa, mesmo papel, no mesmo PDF.
   *
   * O SETOR SAIU DA CADEIA, e é ele o culpado do caso acima. Setor é o
   * DEPARTAMENTO em que a pessoa trabalha ("Comercial", "Financeiro"), não o
   * cargo que ela ocupa — e o que a linha de assinatura de um contrato declara é
   * um cargo. Com a cadeia reduzida a posição → título institucional, o usuário
   * do acervo (sem posição cadastrada) volta a render exatamente "Diretor
   * Comercial", que é o que todos os documentos já impressos dizem.
   */
  private ankaaCargoOf(user: { position?: { name?: string | null } | null } | null): string {
    return fitCargo(user?.position?.name ?? '') || COMPANY.directorTitle;
  }

  /**
   * O cargo que as TELAS mostram para um signatário — painel, portal público de
   * verificação e página pública do orçamento.
   *
   * ⚠️ A CASCATA DO LADO DA ANKAA MUDOU. Era `posição || setor`, lida do cadastro
   * de AGORA, sobre um documento que imprimiu `COMPANY.directorTitle` no
   * congelamento. A tela dizia um cargo, o papel dizia outro, e o portal público
   * de verificação — cuja única razão de existir é confirmar o que o documento
   * diz — dizia o da tela.
   *
   * Hoje a emissão congela o cargo em `informedCargo` (ver `ankaaCargoOf`), então
   * o primeiro degrau responde por toda coleta nova. O recuo é o título
   * institucional LITERAL, que é o que os documentos anteriores imprimem sem
   * exceção. O lado do CLIENTE não muda: lá o recuo são as funções do contato,
   * que é o que o documento dele imprime.
   */
  private displayCargoOf(s: {
    orderGroup: number;
    informedCargo?: string | null;
    responsible?: { roles?: string[] | null } | null;
    user?: {
      position?: { name?: string | null } | null;
      sector?: { name?: string | null } | null;
    } | null;
  }): string | null {
    if (s.informedCargo?.trim()) return s.informedCargo.trim();
    if (s.orderGroup === 1) return COMPANY.directorTitle;
    return (
      formatResponsibleRoles(s.responsible?.roles ?? []) ||
      s.user?.position?.name?.trim() ||
      s.user?.sector?.name?.trim() ||
      null
    );
  }

  /**
   * Quem contra-assina pela Ankaa.
   *
   * ⚠️ SÓ VÍNCULO ATIVO, nas DUAS pontas. Nenhuma delas filtrava, e o
   * `auth.guard` recusa quem não está `ACTIVE` (`isUserEmployed`): uma coleta
   * nova congelava um usuário desligado como contra-assinante, imprimia o nome
   * dele na linha de assinatura do documento e depois não deixava ninguém
   * concluir — com o cliente já tendo assinado. A liberação para ADMIN (17/09)
   * faz existir quem aperte o botão, mas não conserta a raiz: o documento
   * continuaria nomeando um ex-colaborador como representante da empresa.
   *
   * Representante comercial desligado NÃO é erro: cai no diretor, como um
   * orçamento sem representante nenhum. Fica o aviso no log, que é o que permite
   * corrigir o cadastro do orçamento.
   */
  private async resolveAnkaaSigner(quote: QuoteWithSnapshotGraph) {
    const select = {
      id: true,
      name: true,
      phone: true,
      email: true,
      cpf: true,
      // Entram por causa do cargo: ele é resolvido AQUI, uma vez, e vale para o
      // documento e para o selo. Ver `ankaaCargoOf`.
      position: { select: { name: true } },
    } as const;

    if (quote.commercialUserId) {
      const user = await this.prisma.user.findFirst({
        where: { id: quote.commercialUserId, ...EMPLOYED_USER_WHERE },
        select,
      });
      if (user) return user;
      this.logger.warn(
        `O representante comercial do orçamento ${quote.id} (usuário ${quote.commercialUserId}) ` +
          'não tem vínculo ativo — a coleta será emitida em nome do diretor.',
      );
    }
    // Sem representante comercial atribuído, cai no diretor configurado. Não há
    // hoje nenhum campo de vendedor responsável em Task/Budget além deste.
    const director = await this.prisma.user.findFirst({
      where: { name: { contains: COMPANY.directorName, mode: 'insensitive' }, ...EMPLOYED_USER_WHERE },
      select,
    });
    if (!director) {
      throw new BadRequestException(
        'Não foi possível determinar o representante comercial da Ankaa para assinar. ' +
          'Defina um responsável comercial COM VÍNCULO ATIVO no orçamento.',
      );
    }
    return director;
  }

  /**
   * @param customerId  Renderiza a FATIA de um cliente do faturamento: só os
   *   serviços faturados para ele, o subtotal/desconto/total da configuração
   *   dele e a condição de pagamento dele.
   *
   *   Só tem uso no caminho NÃO ASSINADO (ver `renderUnsignedQuoteDocument`).
   *   Onde existe artefato assinado, o dossiê copia os bytes selados e não passa
   *   por aqui — recortar um documento assinado é impossível por construção, e
   *   re-renderizá-lo entregaria uma reconstrução no lugar do que foi assinado.
   */
  private async renderQuoteDocument(
    quote: QuoteWithSnapshotGraph,
    signers: Array<{ id: string; name: string; subtitle: string; side: 'ANKAA' | 'CUSTOMER' }>,
    verificationCode: string,
    customerId?: string | null,
    channel?: SignatureDeliveryChannel,
    sections?: readonly QuoteSection[],
    withPaymentSchedule = false,
    /**
     * OMITE as linhas de assinatura em branco (a folha e a arte continuam).
     * Ver `QuoteHtmlInput.hideSignatureBlock`: vale só para a cópia legível do
     * dossiê de um orçamento JÁ assinado, onde o documento assinado viaja no
     * mesmo PDF.
     */
    hideSignatureBlock = false,
  ) {
    // ── A TARJA DE DOCUMENTO SEM VALOR ───────────────────────────────────────
    //
    // Esta função tem UM chamador — `renderUnsignedQuoteDocument` —, e é por
    // isso que o carimbo mora aqui: o caminho que CONGELA bytes
    // (`createEnvelope` → `renderer.renderAll`) não passa por ela. Carimbar um
    // documento já selado mudaria bytes assinados, e um contrato assinado não
    // deixa de ter sido assinado porque a proposta que o originou foi cancelada
    // depois.
    //
    // "Vencido" é lido do RELÓGIO, não do status: `BudgetStatus.EXPIRED` existe
    // no enum e tem ZERO linhas em produção — a proposta vencida fica PENDING e
    // o `expiresAt` é quem sabe. São 74 assim hoje, 73 delas vencidas há mais de
    // trinta dias, e todas imprimiam como proposta viva.
    const voidLabel =
      (quote as { status?: string }).status === 'CANCELLED'
        ? 'CANCELADO'
        : (quote as { status?: string }).status === 'PENDING' &&
            quote.expiresAt &&
            new Date(quote.expiresAt).getTime() < Date.now()
          ? 'FORA DE VALIDADE'
          : null;

    return this.renderer.render({
      ...this.buildRenderInput(
        quote,
        signers,
        verificationCode,
        customerId,
        channel,
        sections,
        withPaymentSchedule,
      ),
      voidLabel,
      hideSignatureBlock,
    });
  }

  /**
   * Os dados do documento, prontos para o renderizador — SEM renderizar.
   *
   * Separado de `renderQuoteDocument` porque a emissão congela vários recortes de
   * uma vez e precisa entregá-los todos ao mesmo navegador (`renderer.renderAll`):
   * lançar um Chromium por recorte dentro do POST de emissão era o caminho certo
   * para o timeout do nginx.
   *
   * @param sections  O recorte. Omitido = documento inteiro, que é o que os
   *   caminhos avulsos (prévia não assinada, corpo legível do dossiê) querem.
   */
  private buildRenderInput(
    quote: QuoteWithSnapshotGraph,
    signers: Array<{ id: string; name: string; subtitle: string; side: 'ANKAA' | 'CUSTOMER' }>,
    verificationCode: string,
    customerId?: string | null,
    // O canal só governa o texto da cláusula de aceitação impressa no corpo. O
    // padrão é o canal preferencial do modo configurado, que é o que o
    // documento AVULSO (sem envelope) vai de fato usar se virar uma coleta.
    channel: SignatureDeliveryChannel = defaultChannelForMode(
      parseSignatureDeliveryMode(process.env.SIGNATURE_DELIVERY_CHANNEL).mode,
    ),
    sections: readonly QuoteSection[] = FULL_SECTIONS,
    /**
     * IMPRIMIR AS PARCELAS EMITIDAS e a chave Pix que as recebe.
     *
     * `false` em todo caminho que CONGELA bytes, e é aí que está a razão: as
     * parcelas não entram no hash do snapshot, então elas podem mudar depois da
     * assinatura sem que nada perceba. Pôr no papel selado um número que se move
     * por baixo dele é o oposto do que o selo promete.
     *
     * `true` só no corpo legível do dossiê, que é montado AGORA, a partir dos
     * dados de agora — e onde as datas são a única informação verdadeira que o
     * cliente tem quando o pagamento é por Pix (com boleto ele as recebe nos
     * PDFs anexados; com Pix não há anexo nenhum, e o dossiê saía sem data).
     */
    withPaymentSchedule = false,
    /**
     * Como o CONTRATANTE se autentica — governa a CLÁUSULA DE ACEITAÇÃO
     * impressa no corpo do documento.
     *
     * `OTP` é o padrão e é o que todo caminho avulso quer (prévia não assinada,
     * corpo legível do dossiê): eles descrevem a coleta comum. Só a emissão por
     * PORTAL passa outra coisa — e passa nos dois lugares, aqui e na coluna
     * `SignatureEnvelope.acceptanceClause`, a partir da MESMA variável.
     */
    customerCeremony: Exclude<CeremonyKind, 'INTERNAL'> = 'OTP',
  ): RenderInput {
    const segment = customerId
      ? (quote.customerConfigs.find(c => c.customerId === customerId) ?? null)
      : null;
    const firstConfig = quote.customerConfigs[0] ?? null;
    // A configuração que governa desconto, pagamento e totais: a do cliente
    // pedido quando há recorte, senão a primeira (a regra de sempre).
    const config = segment ?? firstConfig;

    // ── AS FATIAS QUE ESTE DOCUMENTO DESCREVE ────────────────────────────────
    //
    // O recorte do documento é por CLIENTE. Com lotes, um cliente tem K
    // faturamentos no MESMO orçamento — "os vinte primeiros no pedido 8842, os
    // quarenta no 9013" —, cada um com a sua cobertura, o seu total e o seu
    // plano de parcelas. Enquanto isto era `config` sozinho, o documento
    // descrevia o PRIMEIRO lote e calava sobre os outros: o cliente assinava um
    // instrumento que prometia quatro parcelas sobre vinte caminhões e nada
    // sobre os quarenta restantes.
    //
    // A lista vem na ordem de `createdAt` (a do include compartilhado), que é a
    // mesma ordem em que a tela compôs os lotes.
    const billingCustomerId = config?.customerId ?? null;
    const slices = billingCustomerId
      ? quote.customerConfigs.filter(c => c.customerId === billingCustomerId)
      : config
        ? [config]
        : [];

    // Quais serviços são deste cliente.
    //
    // O corte é `invoiceToCustomerId`, mas há um faturamento de dois clientes em
    // que NENHUM serviço carrega essa marca e as duas configurações levam o
    // valor cheio do orçamento (nº 262: 8 serviços sem cliente, subtotal 30.010
    // nas duas). Ali não existe divisão por serviço — as configurações só
    // guardam condições diferentes para o mesmo escopo —, e filtrar produziria
    // um documento com ZERO linhas e subtotal de 30 mil. Então: só se filtra
    // quando o orçamento de fato marcou serviços por cliente.
    const splitByService = quote.services.some(s => s.invoiceToCustomerId);
    const services =
      segment && splitByService
        ? // Serviço sem cliente não entra em nenhum total de configuração
          // (conferido: nos orçamentos divididos, a soma dos serviços marcados
          // bate exatamente com o `subtotal` da configuração), então listá-lo
          // aqui mostraria uma linha que o Total abaixo não contém.
          quote.services.filter(s => s.invoiceToCustomerId === segment.customerId)
        : quote.services;

    // ── DINHEIRO ──────────────────────────────────────────────────────────────
    //
    // O documento imprime o preço POR VEÍCULO e multiplica; `config.total` é o
    // que a FATURA cobra, que em `JOINT` já vem multiplicado. Ler `config.total`
    // aqui faria a lista de serviços (unitária) não fechar com o total logo
    // abaixo dela — num orçamento de sessenta caminhões, por um fator de
    // sessenta.
    //
    // Por isso a conta é refeita a partir dos serviços, com a MESMA fórmula que
    // `recalcQuoteTotals` usa para gravar `config.total`: é o que garante que o
    // documento assinado e o boleto fechem no centavo.
    const vehicleTasks = sortQuoteTasks(quote.tasks ?? []);
    // OS VEÍCULOS DESTA FATURA — subconjunto de `vehicleTasks`.
    //
    // A tabela de identificação lista o orçamento INTEIRO: o documento é o
    // contrato, e o contrato é dos sessenta. O quadro do tomador é outra coisa —
    // ali entra o nº do pedido de compra, e o pedido é do veículo. Numa fatia de
    // um caminhão o quadro cita o pedido DELE; num lote, os do lote.
    //
    // Era `config.taskId`, coluna removida em `20260913120000_billing_coverage`.
    // A leitura passava por `as any`, então o `tsc` não viu, e a condição virou
    // sempre-falsa: todo documento recortado passou a citar os pedidos dos
    // sessenta.
    //
    // É a união das fatias do cliente, não a da primeira: o quadro é um só para
    // o documento inteiro, e num cliente com dois lotes citar só os pedidos do
    // primeiro deixaria de fora metade dos caminhões que ele está comprando.
    const coveredIds = new Set(slices.flatMap(c => coveredTaskIds(c as any)));
    const coveredVehicleTasks =
      coveredIds.size > 0 ? vehicleTasks.filter(t => coveredIds.has(t.id)) : [];
    // Acervo sem linha de cobertura (ou fatia ainda sem veículo): o orçamento
    // inteiro, que é o que este trecho fazia antes de existir cobertura.
    const billedVehicleTasks =
      coveredVehicleTasks.length > 0 ? coveredVehicleTasks : vehicleTasks;
    const discountValue = config?.discountValue != null ? Number(config.discountValue) : null;
    const discountType = config?.discountType ?? 'NONE';
    const money = computeQuoteMoney({
      serviceAmounts: services.map(sv => Number(sv.amount)),
      discountType,
      discountValue,
      taskCount: vehicleTasks.length,
      // A COBERTURA DESTA FATURA. Os três números lidos logo abaixo são por
      // VEÍCULO e não dependem dela, mas `configTotal` — que a cláusula de
      // pagamento imprime — depende: é `por veículo × cobertos`.
      coveredTaskCount: coveredTaskCount(config as any) || undefined,
    });
    const subtotal = money.perVehicleSubtotal;
    const total = money.perVehicleTotal;
    const discountAmount = money.perVehicleDiscount;

    let discountLabel: string | null = null;
    if (discountType === 'PERCENTAGE' && discountValue) {
      discountLabel = `${discountValue}%`;
    } else if (discountType === 'FIXED_VALUE' && discountValue) {
      discountLabel = config?.discountReference ?? null;
    }

    // ── A CLÁUSULA DE PAGAMENTO ──────────────────────────────────────────────
    //
    // Uma frase por PLANO, não por fatura e não por documento.
    //
    // Por que não por fatura: `PER_TASK` com sessenta caminhões são SESSENTA
    // faturas do mesmo cliente, todas com os mesmos termos. Sessenta parágrafos
    // rotulados diriam sessenta vezes a mesma coisa; a frase única — "em 4
    // parcelas de R$ 3.042,60, para cada um dos 60 veículos" — diz tudo numa
    // linha, e é o que o documento sempre disse.
    //
    // Por que não por documento: com LOTES DESIGUAIS — vinte no pedido 8842 e
    // quarenta no 9013 — não existe uma frase só que seja verdadeira. Enquanto
    // havia, o documento descrevia o PRIMEIRO lote e calava sobre o resto: o
    // cliente assinava um instrumento que prometia parcelas sobre vinte
    // caminhões e nada sobre os outros quarenta.
    //
    // Então: agrupa as fatias por TERMOS + TAMANHO DA COBERTURA. Um grupo só —
    // o acervo inteiro, todo `JOINT`, todo `PER_TASK` e os lotes IGUAIS — produz
    // exatamente a frase de antes, sem rótulo, e o documento sai byte a byte o
    // mesmo. Mais de um grupo produz uma frase por grupo, cada uma dizendo de
    // quais caminhões fala.
    type QuoteSlice = (typeof quote.customerConfigs)[number];
    const sliceKey = (c: QuoteSlice): string =>
      JSON.stringify([
        c.discountType ?? 'NONE',
        c.discountValue != null ? Number(c.discountValue) : null,
        c.paymentCondition ?? null,
        c.customPaymentText ?? null,
        // O vencimento da 1ª parcela fica DE FORA de propósito: em `PER_TASK` o
        // financeiro aprova veículo a veículo e cada fatia ganha a sua data, o
        // que quebraria a frase única em sessenta por uma diferença que a
        // cláusula já resolve citando a data da primeira.
        (c.paymentConfig as unknown) ?? null,
        coveredTaskCount(c as any),
      ]);

    const clauseGroups: QuoteSlice[][] = [];
    const groupByKey = new Map<string, QuoteSlice[]>();
    for (const c of slices) {
      const key = sliceKey(c);
      let group = groupByKey.get(key);
      if (!group) {
        group = [];
        groupByKey.set(key, group);
        clauseGroups.push(group);
      }
      group.push(c);
    }

    const clauseForGroup = (group: QuoteSlice[], alone: boolean): string => {
      const head = group[0];
      const groupMoney = computeQuoteMoney({
        serviceAmounts: services.map(sv => Number(sv.amount)),
        discountType: head.discountType ?? 'NONE',
        discountValue: head.discountValue != null ? Number(head.discountValue) : null,
        taskCount: vehicleTasks.length,
        // A COBERTURA DE UMA FATURA DESTE GRUPO — todas têm o mesmo tamanho, é o
        // que define o grupo. É ela que multiplica: `por veículo × cobertos`.
        coveredTaskCount: coveredTaskCount(head as any) || undefined,
      });
      return generatePaymentText({
        customPaymentText: head.customPaymentText ?? null,
        paymentConfig: (head.paymentConfig as any) ?? null,
        paymentCondition: head.paymentCondition ?? null,
        // `configTotal`, não o unitário: a cláusula descreve o que a FATURA
        // cobra — o total geral em `JOINT`, o de um veículo em `PER_TASK`, o do
        // lote num lote —, enquanto o `total` da lista de serviços é sempre por
        // veículo. Confundir os dois faz a frase prometer parcelas de
        // R$ 3.042,60 num boleto de R$ 182.556,00.
        total: groupMoney.configTotal,
        // SOBRE QUANTOS VEÍCULOS ESTA FRASE FALA. Grupo único: o orçamento
        // inteiro, e a frase diz "para cada um dos 60". Um grupo entre vários: só
        // os veículos DELE — senão a frase do lote de vinte anunciaria cobranças
        // dos quarenta que estão na outra.
        vehicleCount: alone
          ? groupMoney.vehicleCount
          : Math.max(
              1,
              group.reduce((sum, c) => sum + coveredTaskCount(c as any), 0),
            ),
        // QUANTOS VEÍCULOS CADA FATURA DESTE GRUPO COBRE — o que decide se a
        // frase diz "R$ 730.224,00", "para cada um dos 60 veículos" ou "para cada
        // grupo de 20". Sai da cobertura, não do modo: com lotes o modo não sabe
        // o tamanho, e era o tamanho que a frase precisava.
        coveredVehicleCount: groupMoney.coveredVehicleCount,
        // Quando o faturamento já emitiu as parcelas, a cláusula cita o
        // vencimento da 1ª parcela — a MESMA data do boleto anexado ao dossiê.
        // Antes da assinatura não há parcela e cai no `specificDate`.
        firstDueDate:
          head.installments?.find(i => i.number === 1)?.dueDate ??
          head.installments?.[0]?.dueDate ??
          null,
        // ⚠️ A FORMA SAI DA PARCELA, pela mesma razão da data logo acima: o
        // `paymentConfig` guarda o que foi COMBINADO e a parcela guarda o que
        // está sendo COBRADO, e os dois divergem em massa — em produção,
        // 17/09/2026, há 8 orçamentos com config `BANK_SLIP` cobrando em `PIX`,
        // 6 com config `PIX` cobrando na conta do Sergio, 4 na do Genivaldo, e
        // 277 sem método nenhum no config cobrando em boleto.
        //
        // O defeito que isto conserta é o documento SE CONTRADIZENDO: o dossiê
        // do orçamento nº 0915 saiu com a frase "4 parcelas de R$ 6.075,30 via
        // boleto" e, três linhas abaixo, o bloco "Pagamento via Pix" com a chave
        // — porque a frase lia o config e o bloco lia a parcela. Quem recebe não
        // tem como saber em qual acreditar.
        //
        // Sem parcela (antes da assinatura) fica `undefined` e a frase continua
        // saindo do config, byte a byte como antes.
        paymentMethod:
          head.installments?.find(i => i.paymentMethod)?.paymentMethod ?? undefined,
      });
    };

    // ── AS PARCELAS EMITIDAS, com data e valor ───────────────────────────────
    //
    // A frase acima descreve o ACORDO ("em 4 parcelas de R$ 5.374,60, com entrada
    // em 21/09"); esta tabela descreve a DÍVIDA ("1/4 vence em 21/09, 2/4 em
    // 13/10"). Não são a mesma coisa, e a diferença é a que o cliente precisa:
    // o gerador rola cada vencimento para o próximo dia útil e põe o resto dos
    // centavos na última parcela, então as datas e o último valor NÃO saem da
    // aritmética da frase.
    //
    // Por que faltava: com boleto o cliente recebia as datas nos PDFs dos boletos
    // anexados ao dossiê. Com Pix não há anexo nenhum — e o documento saía sem
    // uma única data de vencimento.
    //
    // ⚠️ NADA É PROJETADO AQUI. A tabela sai das parcelas que EXISTEM; sem
    // faturamento aprovado ela simplesmente não aparece, e a frase do acordo
    // continua sozinha, como sempre esteve. Projetar seria reimplementar
    // `generateInstallmentsFromPaymentConfig` — que ancora no dia da aprovação —
    // e publicar datas que a aprovação depois mudaria.
    //
    // UM BLOCO POR FATIA, não por grupo de cláusula: os grupos existem para não
    // repetir a mesma FRASE sessenta vezes, mas cada fatia tem as SUAS parcelas,
    // com as suas datas (em `PER_TASK` o financeiro aprova veículo a veículo e
    // cada uma ganha o seu calendário). Uma fatia só — 722 dos 722 orçamentos em
    // produção — sai sem rótulo, exatamente como o documento de referência.
    const paymentSchedule = !withPaymentSchedule
      ? []
      : slices
          .map(slice => {
            const installments = (slice.installments ?? [])
              .filter((i: any) => i.status !== 'CANCELLED')
              .sort((a: any, b: any) => a.number - b.number);
            if (!installments.length) return null;
            // A FORMA REAL vem da parcela, não do combinado: o `paymentConfig`
            // diz o que foi acertado, a parcela diz como está sendo cobrada — e
            // é a segunda que determina para qual conta o cliente vai pagar.
            const method =
              installments.find((i: any) => i.paymentMethod)?.paymentMethod ??
              ((slice.paymentConfig as any)?.method ?? null);
            return {
              label:
                slices.length > 1
                  ? coverageSummary(
                      { tasks: (slice as any).billing?.tasks ?? [] } as any,
                      vehicleTasks.length,
                      vehicleTasks as any,
                    )
                  : null,
              installments: installments.map((i: any) => ({
                number: i.number,
                dueDate: formatDateBR(i.dueDate),
                amount: formatCurrencyBRL(Number(i.amount)),
                paid: i.status === 'PAID',
              })),
              pix: receivingAccountFor(method),
            };
          })
          .filter((b): b is NonNullable<typeof b> => b !== null);

    const paymentText = clauseGroups
      .map(group => {
        const text = clauseForGroup(group, clauseGroups.length === 1);
        if (!text) return null;
        if (clauseGroups.length === 1) return text;
        // O rótulo é a união dos veículos do GRUPO — as vinte séries do lote,
        // não a fatia que calhou de vir primeiro.
        const label = coverageSummary(
          { tasks: group.flatMap(c => (c as any).billing?.tasks ?? []) } as any,
          vehicleTasks.length,
          vehicleTasks as any,
        );
        return `${label}: ${text}`;
      })
      .filter((v): v is string => Boolean(v))
      // O builder quebra em um parágrafo por linha. Com uma linha só, o HTML é
      // idêntico ao de antes desta mudança.
      .join('\n');

    const layoutImages = quote.layoutFiles
      .map(f => this.renderer.resolveLayoutImageDataUri(f))
      .filter((v): v is string => Boolean(v));

    // Quem o documento identifica como cliente: no recorte é o cliente da
    // configuração, e não o da tarefa — são diferentes justamente no faturamento
    // dividido, que é o único caso em que isto roda.
    const customer = segment?.customer ?? primaryTask(quote)?.customer ?? null;

    return {
      sections,
      budgetNumber: quote.budgetNumber,
      issuedAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      corporateName: customer?.corporateName ?? customer?.fantasyName ?? null,
      customerDocumentFormatted: customer?.cnpj
        ? formatCnpj(customer.cnpj)
        : (customer?.cpf ?? null),
      // A QUEM ESTE DOCUMENTO É ENDEREÇADO.
      //
      // Ordem: os SIGNATÁRIOS DESTE RECORTE > o responsável principal da tarefa.
      //
      // O primeiro degrau é o conserto de um defeito medido: cada recorte é um
      // documento diferente, com signatários diferentes, e o "À <fulano>" saía de
      // `responsibles[0]` em todos eles. No orçamento nº 956 o PDF do Kennedy
      // abria com "À Beatriz" — o documento cumprimentava outra pessoa que não
      // quem ia assiná-lo. Endereçar a quem tem a caneta na mão é o mínimo.
      //
      // O segundo degrau cobre o recorte completo que existe só para a
      // contra-assinatura da Ankaa, sem nenhum contato do cliente nele.
      //
      // O degrau que SAIU era o contato eleito no pagador (`responsibleId`).
      // Ele vinha ANTES dos signatários, então um recorte endereçava o documento
      // a quem a tela de faturamento tinha escolhido em vez de a quem ia
      // assiná-lo — exatamente o defeito que o degrau seguinte existe para
      // corrigir, reintroduzido por outra porta.
      contactName:
        formatContactList(signers.filter(x => x.side === 'CUSTOMER').map(x => x.name)) ??
        pickPrimaryResponsible(
          // O responsável PRINCIPAL sai da união das tarefas, não da primeira:
          // é o mesmo conjunto que assina o documento.
          dedupeResponsibles(vehicleTasks.flatMap(t => t.responsibles ?? [])),
        )?.name ??
        null,
      // A TABELA DE IDENTIFICAÇÃO. Uma linha por tarefa, na ordem canônica — a
      // mesma ordem que entra no hash do snapshot.
      vehicles: vehicleTasks.map(t => ({
        taskId: t.id,
        serialNumber: t.serialNumber ?? null,
        plate: t.truck?.plate ?? null,
        chassisNumber: t.truck?.chassisNumber ?? null,
        categoryLabel: t.truck?.category ?? null,
        implementLabel: t.truck?.implementType ?? null,
        // O pedido de compra DESTE veículo — vira coluna da tabela. Era linha do
        // quadro do tomador, onde só cabia um número: quatro caminhões comprados
        // em pedidos diferentes não cabiam ali.
        orderNumber: (t as { customerOrderNumber?: string | null }).customerOrderNumber ?? null,
      })),
      services: services.map(s => ({
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
      discountReference: config?.discountReference ?? null,
      discountAmount,
      deliveryDays: quote.customForecastDays ?? null,
      simultaneousTasks: quote.simultaneousTasks ?? null,
      paymentText,
      paymentSchedule,
      // O QUADRO DO TOMADOR — o cadastro que a prefeitura vai exigir na NFS-e,
      // posto no documento para o cliente conferir na aprovação. Sai do cliente
      // do RECORTE (a configuração), não do cliente da tarefa: no faturamento
      // dividido eles são diferentes, e é a nota do cliente da configuração que
      // será emitida.
      billing: customer
        ? {
            corporateName: customer.corporateName ?? customer.fantasyName ?? null,
            documentFormatted: customer.cnpj
              ? formatCnpj(customer.cnpj)
              : customer.cpf
                ? formatCpf(customer.cpf)
                : null,
            stateRegistration: (customer as any).stateRegistration ?? null,
            municipalRegistration: (customer as any).municipalRegistration ?? null,
            addressLine: formatBillingStreetLine(customer as any),
            addressLocality: formatBillingLocalityLine(customer as any),
            // O pedido é do VEÍCULO. Numa fatia conjunta o documento cita os
            // números dos veículos que ela cobre; numa fatia de um caminhão, o
            // dele. Ver `orderNumberLabel`.
            orderNumber: orderNumberLabel(billedVehicleTasks),
          }
        : null,
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
      acceptanceClause: acceptanceClauseFor(channel, customerCeremony),
      verificationCode,
      verificationUrl: this.verificationUrl(verificationCode),
    };
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
      // Canal do SIGNATÁRIO, não da configuração: ver `channelForAuthMethod`.
      //
      // ⚠️ Menos para quem assina pelo PORTAL: `RESPONSIBLE_SESSION` não
      // descreve canal, e o padrão de `channelForAuthMethod` (EMAIL) mandaria o
      // convite de uma coleta de WhatsApp por e-mail. Ele segue o canal de aviso
      // da coleta. O convite CONTINUA saindo — para quem assina pelo portal a
      // página do link é onde se confere o documento, e o convite é o que avisa
      // que há orçamento esperando; o ato mora no portal (ver `portalNotice` em
      // `getPublicState`).
      const channel = this.deliveryChannelFor(signer, envelope.signers);
      const signingUrl = this.signingUrl(signer.accessToken);
      const deadlineDate = this.deadlineLabel(envelope.deadlineAt);

      const delivery = await this.deliverToSigner({
        signer,
        channel,
        email: generateSignatureInvitationEmail({
          signerName: signer.declaredName,
          budgetNumber: envelope.quote.budgetNumber,
          signingUrl,
          deadlineDate,
        }),
        whatsapp: generateSignatureInvitationWhatsApp({
          signerName: signer.declaredName,
          budgetNumber: envelope.quote.budgetNumber,
          signingUrl,
          deadlineDate,
        }),
        whatsappPreview: this.signingLinkPreview(
          envelope.quote.budgetNumber,
          signingUrl,
          'invite',
        ),
        whatsappTemplate: invitationTemplate({
          signerName: signer.declaredName,
          budgetNumber: envelope.quote.budgetNumber,
          deadlineDate,
          // O TOKEN, não a URL: o template guarda o prefixo do link.
          accessToken: signer.accessToken,
        }),
        kind: 'SIGNATURE_INVITATION',
      });

      await this.audit.recordBestEffort(envelopeId, {
        eventType: delivery.ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
        actorType: 'SYSTEM',
        actorId: signer.id,
        actorLabel: signer.declaredName,
        payload: {
          channel: auditChannelOf(channel),
          destination: this.maskContactFor(signer, channel),
          // O MOTIVO entra na trilha. "Convite falhou" sem causa obrigava a ler
          // o journal do servidor para saber se foi teto de primeiro contato,
          // disjuntor aberto ou telefone errado — três problemas com três
          // condutas diferentes.
          ...(delivery.reason ? { failureReason: delivery.reason } : {}),
        // O código da guarda de saída, quando foi ela que recusou. A trilha é
        // o único lugar onde o motivo EXATO fica: o texto da guarda é escrito
        // para o operador e não é repassado ao signatário.
        ...(delivery.code ? { failureCode: delivery.code } : {}),
        },
      });
    }
  }

  // ===========================================================================
  // LEMBRETES E AVISO DE VENCIMENTO
  // ===========================================================================

  /**
   * A data de validade como o CLIENTE a lê.
   *
   * ⚠️ O `timeZone` não é preciosismo. `Budget.expiresAt` é gravado às
   * 23:59:59.999 de São Paulo — que em UTC já é 02:59 do DIA SEGUINTE. Num
   * servidor que roda em UTC (o normal em Linux, e o caso de produção), um
   * `toLocaleDateString('pt-BR')` sem fuso imprimia o dia seguinte: o convite
   * prometia um dia a mais do que o documento, e o link morria na véspera do que
   * a mensagem dizia. Como a máquina de desenvolvimento roda em
   * America/Sao_Paulo, a diferença é invisível localmente.
   */
  private deadlineLabel(date: Date): string {
    return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  /**
   * Varre os envelopes vivos e manda o lembrete de quem está na hora.
   *
   * Roda pelo `SignatureReminderScheduler`. Devolve a contagem para o log — o
   * agendador não decide nada, só chama.
   *
   * ⚠️ OS DOIS GRUPOS, desde 17/09. O grupo 1 — a nossa caneta — estava fora,
   * com o argumento de que "a cobrança interna é uma notificação do sistema, não
   * um WhatsApp para quem já está na frente da tela". O argumento supunha que o
   * aviso tivesse chegado: ele sai UMA vez, sem `await`, best-effort, de dentro
   * do POST de assinatura do cliente (`advanceEnvelope` → `notifyAnkaaSigner`).
   * Se falhar — telefone errado, disjuntor do WhatsApp aberto, servidor de
   * e-mail recusando —, ninguém cobra de novo e ninguém fica sabendo: a coleta
   * para com o CLIENTE JÁ TENDO ASSINADO, que é o pior momento possível.
   *
   * A cadência do grupo 1 é a mesma do cliente, com outra ÂNCORA: conta do
   * instante em que o último responsável do cliente assinou, e não da emissão.
   * Ver `customerSideCompletedAt`.
   */
  async dispatchDueReminders(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const envelopes = await this.prisma.signatureEnvelope.findMany({
      where: {
        status: EnvelopeStatus.RUNNING,
        // Vencido não se lembra: quem passou do prazo recebe o aviso de
        // vencimento, que é outra mensagem e sai da varredura de expiração.
        deadlineAt: { gt: now },
        // COLETA TRAVADA POR RECUSA também não se lembra. Depois que a recusa
        // deixou de matar o envelope, ele continua `RUNNING` — e cobrar os
        // outros responsáveis para assinarem algo que não pode ser concluído
        // enquanto o comercial não resolve é pedir um ato inútil, por uma
        // mensagem que a Meta mede. Reabrir o recusante (`resendInvitation`)
        // devolve o envelope à cobrança sozinho.
        signers: { none: { status: EnvelopeSignerStatus.REFUSED } },
      },
      select: {
        id: true,
        createdAt: true,
        deadlineAt: true,
        // Recuo do botão dos avisos internos quando o orçamento não tem tarefa.
        quoteId: true,
        quote: {
          select: {
            budgetNumber: true,
            // O link da tela interna do aviso de contra-assinatura é chaveado
            // pela tarefa. Ver `internalQuoteUrl`.
            tasks: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { id: true, createdAt: true },
            },
          },
        },
        // TODOS os signatários, sem filtro no banco. O recorte deixou de ser
        // "grupo 0 pendente": para decidir se o grupo 1 já pode ser cobrado é
        // preciso saber se o grupo 0 INTEIRO assinou — e quando. Um `where` que
        // some com quem já assinou apagaria justamente essa informação.
        signers: {
          select: {
            id: true,
            orderGroup: true,
            status: true,
            signedAt: true,
            declaredName: true,
            declaredEmail: true,
            declaredPhone: true,
            accessToken: true,
            authMethod: true,
            lastReminderAt: true,
            reminderCount: true,
          },
        },
      },
    });

    // Quem já assinou, recusou, foi anulado ou perdeu o prazo não é cobrado.
    // Escrito como exclusão e não como `status: PENDING`: um estado
    // intermediário novo no enum deve continuar recebendo lembrete, que é a
    // direção segura para uma cobrança.
    const aindaCobravel = (status: EnvelopeSignerStatus) =>
      status !== EnvelopeSignerStatus.SIGNED &&
      status !== EnvelopeSignerStatus.REFUSED &&
      status !== EnvelopeSignerStatus.VOIDED &&
      status !== EnvelopeSignerStatus.EXPIRED;

    let sent = 0;
    let failed = 0;

    for (const envelope of envelopes) {
      for (const signer of envelope.signers.filter(
        sig => sig.orderGroup === 0 && aindaCobravel(sig.status),
      )) {
        const due = dueCustomerReminder(
          {
            lastReminderAt: signer.lastReminderAt,
            reminderCount: signer.reminderCount,
            // O convite sai de dentro de `createEnvelope`, então a emissão É a
            // data do convite. Não há coluna `invitedAt` — e uma seria um
            // segundo lugar para a mesma verdade divergir.
            invitedAt: envelope.createdAt,
            // O PRAZO entra na cadência: os dois últimos toques miram nele.
            deadlineAt: envelope.deadlineAt,
          },
          now,
        );
        if (!due) continue;

        // Ver `deliveryChannelFor`: quem assina por SESSÃO não carrega canal no
        // `authMethod` e segue o canal da coleta.
        const channel = this.deliveryChannelFor(signer, envelope.signers);
        const signingUrl = this.signingUrl(signer.accessToken);
        const deadlineDate = this.deadlineLabel(envelope.deadlineAt);
        // Nunca negativo: o `deadlineAt > now` da consulta garante pelo menos o
        // dia corrente, e `Math.max` protege o texto de um fuso na virada.
        const daysLeft = Math.max(0, spDayDiff(now, envelope.deadlineAt));

        const payload = {
          signerName: signer.declaredName,
          budgetNumber: envelope.quote.budgetNumber,
          signingUrl,
          deadlineDate,
          daysLeft,
        };

        const delivery = await this.deliverToSigner({
          signer,
          channel,
          email: generateSignatureReminderEmail(payload),
          whatsapp: generateSignatureReminderWhatsApp(payload),
          whatsappPreview: this.signingLinkPreview(
            envelope.quote.budgetNumber,
            signingUrl,
            'invite',
          ),
          whatsappTemplate: reminderTemplate({
            signerName: signer.declaredName,
            budgetNumber: envelope.quote.budgetNumber,
            deadlineDate,
            accessToken: signer.accessToken,
          }),
          kind: 'SIGNATURE_REMINDER',
        });

        // O CARIMBO É GRAVADO MESMO QUANDO A ENTREGA FALHA.
        //
        // Sem isto, um signatário com telefone errado no cadastro voltaria à
        // fila todo dia útil até o orçamento vencer: trinta tentativas, trinta
        // recusas da guarda de saída, trinta linhas de erro no journal — e
        // nenhuma delas conserta o número. Falhou entra na cadência como se
        // tivesse saído; o que registra o problema é a trilha, abaixo.
        // `set`, e não `increment`: o contador marca ATÉ ONDE o calendário foi
        // consumido, não quantas mensagens saíram. Depois de uma queda de dois
        // dias, sai o toque mais recente e os pulados ficam para trás — um
        // `increment` os traria de volta na fila dos dias seguintes, que é
        // exatamente o efeito que `dueCustomerReminder` existe para evitar.
        await this.prisma.envelopeSigner.update({
          where: { id: signer.id },
          data: { lastReminderAt: now, reminderCount: due.index + 1 },
        });

        await this.audit.recordBestEffort(envelope.id, {
          eventType: delivery.ok ? 'REMINDER_SENT' : 'REMINDER_FAILED',
          actorType: 'SYSTEM',
          actorId: signer.id,
          actorLabel: signer.declaredName,
          payload: {
            channel: auditChannelOf(channel),
            destination: this.maskContactFor(signer, channel),
            reminderNumber: due.index + 1,
            reminderTotal: due.total,
            // O dia PREVISTO, ao lado do dia real: numa queda do agendador os
            // dois divergem, e a trilha é o único lugar onde isso aparece.
            scheduledFor: civilDayKey(due.scheduledFor),
            daysLeft,
            ...(delivery.reason ? { failureReason: delivery.reason } : {}),
            ...(delivery.code ? { failureCode: delivery.code } : {}),
          },
        });

        if (delivery.ok) sent++;
        else failed++;
      }

      // ── GRUPO 1: A NOSSA CANETA ────────────────────────────────────────────
      //
      // Cobrado só depois que o lado do cliente fechou INTEIRO — antes disso a
      // ordem sequencial do envelope nem deixaria assinar (`assertSignable`), e
      // cobrar seria pedir um ato impossível.
      const fechouEm = customerSideCompletedAt(envelope.signers);
      const ankaaSigner = envelope.signers.find(
        sig => sig.orderGroup === 1 && aindaCobravel(sig.status),
      );
      if (!fechouEm || !ankaaSigner) continue;

      const ankaaDue = isInternalReminderDue(
        {
          lastReminderAt: ankaaSigner.lastReminderAt,
          reminderCount: ankaaSigner.reminderCount,
          // A ÂNCORA É O FECHAMENTO DO CLIENTE, não a emissão. Ver
          // `customerSideCompletedAt`: numa coleta que levou doze dias, ancorar
          // na emissão despejaria três cobranças de enfiada no dia seguinte ao
          // aviso.
          invitedAt: fechouEm,
        },
        now,
      );
      if (!ankaaDue) continue;

      // O canal da COLETA, lido do lado do cliente — o `authMethod` da Ankaa é
      // `INTERNAL_SESSION` e não descreve canal nenhum. Ver `noticeChannelOf`.
      const ankaaChannel = this.noticeChannelOf(envelope.signers);
      const quoteUrl = this.internalQuoteUrl(primaryTask(envelope.quote)?.id ?? null);
      const daysPending = Math.max(0, spDayDiff(fechouEm, now));
      const ankaaPayload = {
        signerName: ankaaSigner.declaredName,
        budgetNumber: envelope.quote.budgetNumber,
        quoteUrl,
        daysPending,
      };

      const ankaaDelivery = await this.deliverToSigner({
        signer: ankaaSigner,
        channel: ankaaChannel,
        email: generateAnkaaCountersignReminderEmail(ankaaPayload),
        whatsapp: generateAnkaaCountersignReminderWhatsApp(ankaaPayload),
        whatsappPreview: this.signingLinkPreview(
          envelope.quote.budgetNumber,
          quoteUrl,
          'countersign',
        ),
        // O MESMO template do aviso: o corpo aprovado diz "aguarda a
        // contra-assinatura", que é verdade no primeiro dia e no décimo. O que
        // distingue os dois momentos é o texto livre acima, que sai por e-mail e
        // pelo Baileys e ali diz há quantos dias está parado.
        whatsappTemplate: ankaaCountersignTemplate({
          signerName: ankaaSigner.declaredName,
          budgetNumber: envelope.quote.budgetNumber,
          quoteTaskId: this.internalQuoteButtonParam(
            primaryTask(envelope.quote)?.id ?? null,
            envelope.quoteId,
          ),
        }),
        kind: 'SIGNATURE_ANKAA_REMINDER',
      });

      // Mesmo carimbo-mesmo-falhando do lado do cliente, e pelo mesmo motivo:
      // sem ele um representante com contato errado volta à fila todo dia útil
      // até o orçamento vencer.
      await this.prisma.envelopeSigner.update({
        where: { id: ankaaSigner.id },
        data: { lastReminderAt: now, reminderCount: { increment: 1 } },
      });

      await this.audit.recordBestEffort(envelope.id, {
        eventType: ankaaDelivery.ok ? 'REMINDER_SENT' : 'REMINDER_FAILED',
        actorType: 'SYSTEM',
        actorId: ankaaSigner.id,
        actorLabel: ankaaSigner.declaredName,
        payload: {
          stage: 'ankaa',
          // Como o aviso: isto NÃO é cobrança de assinatura por link, e a trilha
          // precisa dizê-lo para não ser lida como tal.
          kind: 'countersign_reminder',
          channel: auditChannelOf(ankaaChannel),
          destination: this.maskContactFor(ankaaSigner, ankaaChannel),
          reminderNumber: ankaaSigner.reminderCount + 1,
          daysPending,
          ...(ankaaDelivery.reason ? { failureReason: ankaaDelivery.reason } : {}),
          ...(ankaaDelivery.code ? { failureCode: ankaaDelivery.code } : {}),
        },
      });

      if (ankaaDelivery.ok) sent++;
      else failed++;
    }

    return { sent, failed };
  }

  /**
   * Avisa os responsáveis de que a validade venceu e o valor será reanalisado.
   *
   * VAI PARA TODOS DO GRUPO 0, inclusive quem já assinou (decisão dele,
   * 11/09/2026). Quem assinou e vê a coleta simplesmente sumir conclui que
   * perdemos a assinatura dele; a mensagem diz, em uma frase, que o ato ficou
   * registrado e que o que venceu foi o prazo.
   *
   * O signatário da Ankaa fica de fora: o aviso interno é a notificação de
   * sistema que o comercial recebe, com link para a tela.
   *
   * Devolve quantos foram efetivamente avisados — o chamador decide se carimba
   * o orçamento como avisado.
   */
  async notifyExpiry(envelopeId: string): Promise<{ notified: number; failed: number }> {
    const envelope = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      select: {
        id: true,
        deadlineAt: true,
        quote: { select: { budgetNumber: true } },
        signers: {
          where: { orderGroup: 0 },
          select: {
            id: true,
            // `orderGroup` é redundante com o `where` acima e entra mesmo
            // assim: `deliveryChannelFor` precisa da LISTA para descobrir o
            // canal da coleta quando o signatário assina por sessão, e é por
            // `orderGroup === 0` que ela acha o signatário que carrega canal.
            // Sem a coluna, a lista não serve de referência e o canal do
            // signatário de portal cairia no padrão (e-mail).
            orderGroup: true,
            declaredName: true,
            declaredEmail: true,
            declaredPhone: true,
            authMethod: true,
            signedAt: true,
          },
        },
      },
    });
    if (!envelope) return { notified: 0, failed: 0 };

    const expiredOn = this.deadlineLabel(envelope.deadlineAt);

    let notified = 0;
    let failed = 0;

    for (const signer of envelope.signers) {
      const channel = this.deliveryChannelFor(signer, envelope.signers);
      const payload = {
        signerName: signer.declaredName,
        budgetNumber: envelope.quote.budgetNumber,
        hadSigned: signer.signedAt !== null,
        expiredOn,
      };

      const delivery = await this.deliverToSigner({
        signer,
        channel,
        email: generateSignatureExpiredEmail(payload),
        whatsapp: generateSignatureExpiredWhatsApp(payload),
        // SEM cartão de prévia: a mensagem não carrega link nenhum. O link de
        // assinatura não vale mais, e mandar um cartão sem destino é convite a
        // tocar em algo que vai dar erro.
        whatsappPreview: null,
        whatsappTemplate: expiredTemplate({
          signerName: signer.declaredName,
          budgetNumber: envelope.quote.budgetNumber,
        }),
        kind: 'SIGNATURE_EXPIRED',
      });

      await this.audit.recordBestEffort(envelope.id, {
        eventType: 'EXPIRY_NOTICE_SENT',
        actorType: 'SYSTEM',
        actorId: signer.id,
        actorLabel: signer.declaredName,
        payload: {
          channel: auditChannelOf(channel),
          destination: this.maskContactFor(signer, channel),
          delivered: delivery.ok,
          hadSigned: payload.hadSigned,
          ...(delivery.reason ? { failureReason: delivery.reason } : {}),
          ...(delivery.code ? { failureCode: delivery.code } : {}),
        },
      });

      if (delivery.ok) notified++;
      else failed++;
    }

    return { notified, failed };
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

  /**
   * Gêmeo de `sendEmail` para o WhatsApp. Mesmo contrato: boolean, nunca lança.
   *
   * NÃO existe queda para e-mail quando isto devolve `false`. É decisão de
   * negócio, não esquecimento: o canal é o que dá peso probatório ao código, e
   * trocá-lo em silêncio no meio da cerimônia mandaria a prova de autoria para
   * outra caixa sem que ninguém — nem o operador, nem a trilha, nem o hash
   * material — registrasse a troca. Falhar em voz alta e deixar o operador
   * decidir é o comportamento correto aqui.
   */
  private async sendWhatsApp(
    to: string | null | undefined,
    message: string,
    kind: string,
    priority: 'CRITICAL' | 'NORMAL',
    preview?: { url: string; title: string; description?: string } | null,
    /**
     * Template aprovado, quando a mensagem tem um. Ausente = texto livre pelo
     * Baileys, que é o caso dos avisos INTERNOS.
     */
    template?: SignatureWhatsAppTemplate | null,
  ): Promise<SignatureDeliveryResult> {
    const phone = onlyDigits(to);
    // Mesma guarda do e-mail: destinatário vazio não pode virar INVITATION_SENT.
    // 10 dígitos = DDD + 8 (fixo); abaixo disso não há número discável.
    if (phone.length < 10) {
      this.logger.error('Signatário sem telefone válido — mensagem não enviada.');
      return { ok: false, reason: 'Signatário sem telefone válido no cadastro.' };
    }
    if (!this.whatsapp) {
      this.logger.error('Transporte de WhatsApp não configurado — mensagem não enviada.');
      return { ok: false, reason: 'Transporte de WhatsApp indisponível no servidor.' };
    }
    // Canal oficial primeiro. Quando existe template E o transporte sabe
    // enviá-lo, o texto livre montado acima é descartado — ele permanece no
    // código como a versão do Baileys, que segue valendo se a Cloud API for
    // desligada por configuração.
    if (template && this.whatsapp.sendTemplate) {
      const sent = await this.whatsapp.sendTemplate(phone, template);
      if (!sent.ok) {
        this.logger.error(
          `Falha ao enviar template ${template.name} (${kind}): ${sent.reason ?? 'sem motivo'}`,
        );
      }
      return { ok: sent.ok, reason: sent.reason ?? null, code: sent.code ?? null };
    }

    const result = await this.whatsapp.sendMessage(phone, message, priority, preview);
    if (!result.ok) {
      this.logger.error(`Falha ao enviar WhatsApp (${kind}): ${result.reason ?? 'sem motivo'}`);
    }
    return result;
  }

  /**
   * O cartão que acompanha o link de assinatura no WhatsApp.
   *
   * Um só lugar para os três fluxos que mandam link (convite, reenvio e aviso de
   * contra-assinatura): o cartão é o que diz ao destinatário, ANTES de ele tocar
   * em nada, que aquele link é de quem diz ser. Espalhar o texto por três
   * chamadas garantiria que um deles envelhecesse.
   *
   * SEM VALOR FINANCEIRO aqui, de propósito. O corpo da mensagem já traz o
   * total; a prévia é o pedaço que aparece em notificação de tela bloqueada e em
   * captura de tela encaminhada, e o número do orçamento basta para a pessoa se
   * situar.
   */
  private signingLinkPreview(
    budgetNumber: string | number,
    signingUrl: string,
    kind: 'invite' | 'countersign',
  ): { url: string; title: string; description: string } {
    return {
      url: signingUrl,
      title:
        kind === 'countersign'
          ? `Orçamento nº ${budgetNumber} · Contra-assinatura`
          : `Orçamento nº ${budgetNumber} · Assinatura eletrônica`,
      // O texto do cartão segue o que o link DE FATO é. No convite ele é a
      // capability pessoal do signatário; no aviso de contra-assinatura ele é a
      // tela interna, que não assina nada sozinha e exige login — dizer
      // "intransferível" ali sugeriria justamente o que a mudança de fluxo
      // eliminou, que era um link capaz de obrigar a empresa.
      description:
        kind === 'countersign'
          ? `${COMPANY.name} — abra o orçamento no sistema para contra-assinar. Exige login.`
          : `${COMPANY.name} — revise o documento e assine pelo celular. ` +
            'Link pessoal e intransferível.',
    };
  }

  /** Contato do signatário no canal — o destino real da mensagem. */
  private contactFor(
    signer: { declaredEmail?: string | null; declaredPhone?: string | null },
    channel: SignatureDeliveryChannel,
  ): string | null {
    return channel === 'WHATSAPP' ? (signer.declaredPhone ?? null) : (signer.declaredEmail ?? null);
  }

  /** Máscara do contato no canal — o que vai para a trilha e para a tela. */
  private maskContactFor(
    signer: { declaredEmail?: string | null; declaredPhone?: string | null },
    channel: SignatureDeliveryChannel,
  ): string {
    return channel === 'WHATSAPP'
      ? maskPhone(signer.declaredPhone)
      : maskEmail(signer.declaredEmail);
  }

  /**
   * Ponto ÚNICO de saída de mensagem da cerimônia.
   *
   * Os cinco fluxos que falam com o signatário (convite, reenvio, aviso de
   * contra-assinatura, OTP e aviso de anulação) passam por aqui. Antes cada um
   * chamava `sendEmail` direto com `channel: 'email'` escrito à mão no evento de
   * auditoria — foi assim que o canal ficou hardcoded em seis pontos e que a
   * máscara do OTP continuou mostrando telefone depois da migração para e-mail.
   *
   * Recebe as DUAS mensagens já montadas em vez de um template genérico: o corpo
   * de e-mail é HTML com assunto e o de WhatsApp é texto puro sem assunto, e
   * espremer os dois num formato só produziria e-mail feio ou WhatsApp ilegível.
   */
  private async deliverToSigner(args: {
    signer: { declaredEmail?: string | null; declaredPhone?: string | null };
    channel: SignatureDeliveryChannel;
    email: { subject: string; html: string };
    whatsapp: string;
    /** Cartão de prévia, quando a mensagem de WhatsApp carrega um link. */
    whatsappPreview?: { url: string; title: string; description?: string } | null;
    /**
     * Template do canal oficial.
     *
     * OBRIGATÓRIO NA PRÁTICA desde 17/09: TODA mensagem da cerimônia sai por
     * template, inclusive os avisos internos. Continua opcional no tipo só para
     * o ambiente sem Cloud API, onde `sendTemplate` não existe e o texto livre
     * do Baileys volta a ser o caminho.
     *
     * ⚠️ Deixar de passar um template aqui NÃO é um detalhe de estilo: o envio
     * cai no Baileys, que é o número interno da empresa, e uma mensagem de
     * cliente saindo por ele fora da janela de 24 h é exatamente o tráfego que
     * derruba número.
     */
    whatsappTemplate?: SignatureWhatsAppTemplate | null;
    kind: string;
  }): Promise<SignatureDeliveryResult> {
    if (args.channel === 'WHATSAPP') {
      return this.sendWhatsApp(
        args.signer.declaredPhone,
        args.whatsapp,
        args.kind,
        // Só o código de uso único é crítico. Convite, reenvio, aviso de
        // contra-assinatura e aviso de anulação são iniciativa NOSSA e entram na
        // fila normal, com teto de primeiro contato.
        args.kind === 'SIGNATURE_OTP' ? 'CRITICAL' : 'NORMAL',
        args.whatsappPreview ?? null,
        args.whatsappTemplate ?? null,
      );
    }
    const ok = await this.sendEmail(
      args.signer.declaredEmail,
      args.email.subject,
      args.email.html,
      args.kind,
    );
    return { ok, reason: ok ? null : 'O servidor de e-mail recusou a mensagem.' };
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
        // O RECORTE deste signatário. É o hash DELE que vincula o código de uso
        // único e é ele que o link serve — não o do envelope, que é sempre o
        // documento completo e pode conter seções que esta pessoa não recebeu.
        document: true,
        responsible: { select: { roles: true } },
        // O signatário da Ankaa é um User, não um Responsible: sem isto ele não
        // tem cargo de cadastro nenhum e a cerimônia obriga o diretor a digitar
        // o próprio cargo, que o sistema já sabe.
        user: {
          select: { position: { select: { name: true } }, sector: { select: { name: true } } },
        },
        envelope: { include: { quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { customer: true } } } } } },
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
      `Este link de assinatura expirou em ${this.deadlineLabel(expiresAt)}. ` +
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

    const customer = primaryTask(env.quote)?.customer ?? null;
    const sections = this.sectionsOf(signer.document);
    const kind = this.ceremonyKindOf(signer.authMethod);
    const showsTotal = hasSection(sections, 'PRICING');

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
        : ((await this.changesSinceFrozen(env.quoteId, [env])).get(env.id) ?? []);

    return {
      envelope: {
        id: env.id,
        status: env.status,
        budgetNumber: env.quote.budgetNumber,
        // O TOTAL SEGUE O RECORTE. A página imprime este valor no cabeçalho, e
        // mandá-lo a quem recebeu um documento sem a seção de preços desfaria,
        // numa linha de HTML, a decisão inteira de não lhe mostrar o valor — o
        // PDF viria sem preço e a tela em volta dele o anunciaria.
        total: showsTotal ? formatCurrencyBRL(Number(env.quote.total)) : null,
        deadlineAt: env.deadlineAt,
        verificationCode: env.verificationCode,
        acceptanceClause: env.acceptanceClause,
        invalidatedReason: env.invalidatedReason,
        changes,
      },
      /**
       * O que ESTE documento traz — a tela usa para explicar ao signatário que
       * ele recebeu um recorte, e qual.
       *
       * Dizer isso em voz alta é parte do desenho, não enfeite: a declaração que
       * ele aceita afirma ter revisado "as seções pertinentes à minha função", e
       * uma pessoa não pode declarar isso sobre um documento que a plataforma
       * apresentou como se fosse o orçamento inteiro.
       */
      document: {
        sections,
        label: describeSections(sections),
        isFull: isFullSections(sections),
        sha256: signer.document?.originalSha256 ?? env.originalSha256,
      },
      signer: {
        id: signer.id,
        name: signer.declaredName,
        /**
         * Como esta pessoa é autenticada. `INTERNAL` é o lado da Ankaa, que
         * contra-assina no sistema — a página pública dele não pede CPF, cargo
         * nem código, e o botão de assinar mora no painel do orçamento.
         */
        ceremony: kind,
        emailMasked: maskEmail(signer.declaredEmail),
        emailParts: emailMaskParts(signer.declaredEmail),
        // Canal desta coleta + a máscara do contato correspondente. A tela monta
        // as caixinhas de conferência a partir daqui: `emailParts` continua
        // exposto para não quebrar uma página já carregada, mas quem manda é
        // `contactParts` — numa coleta por WhatsApp o responsável pode nem ter
        // e-mail cadastrado, e pedir os caracteres de um endereço inexistente
        // travaria a assinatura.
        channel: channelForAuthMethod(signer.authMethod),
        contactMasked: this.maskContactFor(
          signer,
          channelForAuthMethod(signer.authMethod),
        ),
        contactParts:
          channelForAuthMethod(signer.authMethod) === 'WHATSAPP'
            ? { ...phoneMaskParts(signer.declaredPhone), domain: '' }
            : emailMaskParts(signer.declaredEmail),
        cpfParts: signer.declaredCpf ? cpfMaskParts(signer.declaredCpf) : null,
        // CPF do CADASTRO, já mascarado. A página só tinha `cpfParts` (que serve
        // para montar as caixas de conferência) e caía no placeholder
        // `***.***.***-**` até o signatário digitar — mostrando um documento
        // vazio para alguém que tem CPF cadastrado desde a emissão. Máscara CGU:
        // os seis do meio aparecem, que é o bastante para a pessoa se reconhecer.
        cpfMasked: signer.declaredCpf ? maskCpf(signer.declaredCpf) : null,
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
        // `fitCargo`: as funções vêm juntas por ", " e um contato com as nove
        // do cadastro passa de 113 caracteres — acima do teto que o PRÓPRIO
        // `signatureRequestCodeSchema` impõe ao devolver esse valor no envio.
        // O cliente mandava de volta o que recebeu e levava 400 sem ter o que
        // corrigir: nada na tela era digitado por ele.
        registryCargo:
          fitCargo(formatResponsibleRoles(signer.responsible?.roles ?? [])) ||
          fitCargo(signer.user?.position?.name ?? '') ||
          fitCargo(signer.user?.sector?.name ?? '') ||
          null,
        signedAt: signer.signedAt,
      },
      company: {
        name: customer?.corporateName ?? customer?.fantasyName ?? '',
        cnpj: customer?.cnpj ? formatCnpj(customer.cnpj) : null,
      },
      declarations: this.renderDeclarationsFor({
        kind,
        channel: channelForAuthMethod(signer.authMethod),
        sections,
        budgetNumber: env.quote.budgetNumber,
        total: Number(env.quote.total),
        cargo: signer.informedCargo,
        company: customer?.corporateName ?? customer?.fantasyName ?? '',
      }),
      // NENHUMA DAS DUAS SESSÕES assina por esta página. `canSign: false` aqui
      // não é uma restrição a mais — é a verdade sobre onde o ato acontece, e
      // sem ela a página desenharia o formulário de CPF e código para alguém
      // que o servidor recusaria em seguida, sem dizer por quê.
      //
      // ⚠️ A comparação é `kind === 'OTP'`, e não `kind !== 'INTERNAL'`. Escrita
      // pela negativa, ela abriria o formulário de código para o signatário de
      // PORTAL — que não tem desafio para pedir — e o ato só falharia depois,
      // em `assertOtpCeremony`.
      canSign:
        kind === 'OTP' ? this.canSignNow(env.status, signer.status, env.deadlineAt) : false,
      ...(kind === 'INTERNAL'
        ? {
            internalNotice:
              'A contra-assinatura da Ankaa é feita dentro do sistema, na tela do orçamento. ' +
              'Entre com sua conta e conclua por lá.',
          }
        : {}),
      // Campo PRÓPRIO, não o `internalNotice` reaproveitado: a tela pública
      // decide o que desenhar por ele, e as duas sessões mandam o leitor a
      // lugares diferentes. Um só campo faria a página oferecer ao cliente o
      // caminho do funcionário.
      ...(kind === 'PORTAL'
        ? {
            portalNotice:
              'Este orçamento é assinado dentro do Portal do Cliente, com a sua sessão — ' +
              'não há código a digitar aqui. Entre no portal, abra o orçamento e conclua ' +
              'por lá. Esta página serve para conferir o documento.',
          }
        : {}),
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
    /**
     * Caracteres ocultos do CONTATO, digitados pelo signatário para confirmação
     * — da parte local do e-mail, ou dos dígitos do meio do telefone, conforme o
     * canal em que a coleta foi emitida.
     */
    contactConfirm?: string | null;
    /** @deprecated Nome antigo de `contactConfirm`, mantido para páginas em cache. */
    emailConfirm?: string | null;
    ctx: RequestContext;
  }): Promise<{
    challengeId: string;
    destinationMask: string;
    channel: SignatureDeliveryChannel;
    expiresAt: Date;
  }> {
    this.assertCeremonyConfigured();

    const signer = await this.getByToken(args.token);
    const env = signer.envelope;

    this.assertOtpCeremony(signer);
    await this.assertSignable(env, signer);

    const cpfDigits = onlyDigits(args.cpf);
    if (!isCpfWellFormed(cpfDigits)) {
      throw new BadRequestException('CPF inválido.');
    }
    if (!args.cargo?.trim()) {
      throw new BadRequestException('Informe seu cargo na empresa.');
    }

    // Confirmação do CONTATO ANTES de disparar o código.
    //
    // O contato é do cadastro e o signatário não pode alterá-lo — é isso que dá
    // peso probatório ao OTP. Mas ele pode CONFIRMAR que o conhece, digitando os
    // caracteres que a máscara esconde. Isso detecta cedo um cadastro errado (o
    // código iria para a caixa/celular de outra pessoa) e é mais um dado ligando
    // o signatário ao canal.
    //
    // NÃO se faz fail-open em nenhum dos canais: contato não mascarável recusa o
    // pedido. Uma versão anterior pulava a checagem em silêncio quando o telefone
    // era curto ou vazio, e o segundo fator desaparecia sem log nem evento de
    // auditoria — o oposto do que a cerimônia promete.
    const otpChannel = channelForAuthMethod(signer.authMethod);
    // `||` e não `??`: o schema normaliza ausência para STRING VAZIA, que não é
    // nullish — com `??` o campo novo (vazio) venceria o legado preenchido e a
    // conferência falharia para qualquer página carregada antes do deploy.
    const confirmTyped = (args.contactConfirm || args.emailConfirm || '').trim().toLowerCase();

    if (otpChannel === 'WHATSAPP') {
      const parts = phoneMaskParts(signer.declaredPhone);
      if (!parts.suffix) {
        this.logger.error(
          `Signatário ${signer.id} sem telefone mascarável — confirmação impossível.`,
        );
        throw new BadRequestException(
          'O telefone cadastrado para este signatário é inválido. Fale com a Ankaa.',
        );
      }
      if (parts.hiddenLength > 0) {
        // Dígitos ocultos ficam ENTRE o prefixo (DDD + 1º dígito) e os 4 finais.
        const national = (() => {
          const d = onlyDigits(signer.declaredPhone);
          return d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
        })();
        const rest = national.slice(2);
        const hidden = rest.slice(1, rest.length - 4);
        if (onlyDigits(confirmTyped) !== hidden) {
          throw new BadRequestException(
            'Os dígitos do telefone não conferem. Confirme o número cadastrado ou fale com a Ankaa.',
          );
        }
      }
    } else {
      const parts = emailMaskParts(signer.declaredEmail);
      if (!parts.domain) {
        this.logger.error(`Signatário ${signer.id} sem e-mail mascarável — confirmação impossível.`);
        throw new BadRequestException(
          'O e-mail cadastrado para este signatário é inválido. Fale com a Ankaa.',
        );
      }
      if (parts.hiddenLength > 0) {
        const local = (signer.declaredEmail ?? '').trim().toLowerCase().split('@')[0];
        const hidden = local.slice(parts.prefix.length, local.length - parts.suffix.length);
        if (confirmTyped !== hidden) {
          throw new BadRequestException(
            'Os caracteres do e-mail não conferem. Confirme o endereço cadastrado ou fale com a Ankaa.',
          );
        }
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
      channel: auditChannelOf(otpChannel),
      destinationMask: this.maskContactFor(signer, otpChannel),
      // O hash do RECORTE deste signatário, não o do envelope. É este documento
      // que ele está lendo, e é a ele que o código tem de estar preso: se o
      // recorte for invalidado, o hash muda e o desafio morre junto (ASVS 6.6.2).
      documentSha256: signer.document?.originalSha256 ?? env.originalSha256,
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

    const otpPayload = {
      signerName: signer.declaredName,
      budgetNumber: env.quote.budgetNumber,
      code: challenge.code,
      expiryMinutes: SIGNING_CODE_TTL_MINUTES,
    };

    // Modo de desenvolvimento: ecoa o código no log em vez de enviar.
    // DUAS travas: só fora de produção E com a flag explícita. Existe para
    // permitir testar a cerimônia inteira sem disparar mensagem para o e-mail
    // real de um cliente. Em produção esta condição é inalcançável.
    const devEcho =
      process.env.NODE_ENV !== 'production' &&
      this.config.get<string>('SIGNATURE_DEV_ECHO_OTP') === 'true';

    let delivery: SignatureDeliveryResult;
    if (devEcho) {
      this.logger.warn(
        `[DEV] Código de assinatura de ${signer.declaredName} ` +
          `(${this.maskContactFor(signer, otpChannel)}): ` +
          `${challenge.code} — NENHUMA mensagem foi enviada.`,
      );
      delivery = { ok: true, reason: null };
    } else {
      delivery = await this.deliverToSigner({
        signer,
        channel: otpChannel,
        email: generateSignatureOtpEmail(otpPayload),
        whatsapp: generateSignatureOtpWhatsApp(otpPayload),
        whatsappTemplate: otpTemplate({ code: challenge.code }),
        kind: 'SIGNATURE_OTP',
      });
    }
    await this.challenges.markDelivered(
      challenge.challengeId,
      null,
      delivery.ok ? 'sent' : 'failed',
    );

    await this.audit.record(env.id, {
      eventType: delivery.ok ? 'OTP_SENT' : 'OTP_DELIVERY_FAILED',
      actorType: 'SYSTEM',
      actorId: signer.id,
      payload: {
        channel: auditChannelOf(otpChannel),
        destination: this.maskContactFor(signer, otpChannel),
        ...(delivery.reason ? { failureReason: delivery.reason } : {}),
      },
    });

    if (!delivery.ok) {
      // O código não chegou a ninguém: invalida-o em vez de deixá-lo PENDENTE.
      // Um desafio vivo que o signatário nunca viu só serve para confundir a
      // verificação e para bloquear a próxima emissão.
      await this.challenges.supersedeAllForSigner(signer.id);
      throw new BadRequestException(
        this.otpDeliveryFailureMessage(otpChannel, delivery.code),
      );
    }

    return {
      challengeId: challenge.challengeId,
      // CORREÇÃO: isto devolvia `maskPhone(declaredPhone)` mesmo quando o código
      // saía por e-mail — resquício da migração de 2026-07-29. A tela mostra
      // este texto literalmente ("Código enviado para …"), então o signatário
      // era mandado conferir um telefone que não recebeu nada.
      destinationMask: this.maskContactFor(signer, otpChannel),
      channel: otpChannel,
      expiresAt: challenge.expiresAt,
    };
  }

  /**
   * O que o SIGNATÁRIO lê quando o código não sai.
   *
   * "Tente novamente em instantes" era mentira para toda recusa da guarda de
   * saída: os tetos dela são por DIA e por hora, e o disjuntor segura por
   * horas. O signatário reapertava o botão contra uma parede que só cai no dia
   * seguinte, e a frase ainda o convencia de que era ele que estava com
   * pressa.
   *
   * O TEXTO DA GUARDA NÃO É REPASSADO. Ele é escrito para o operador ("use
   * e-mail nesta coleta", "peça ao cliente que mande uma mensagem para o
   * número da Ankaa") e vira instrução sem sentido lida por quem está do outro
   * lado — que não tem acesso a nenhuma das duas coisas. O motivo exato fica na
   * trilha (`OTP_DELIVERY_FAILED`) e no log, que é onde o operador olha.
   *
   * A distinção é pela PRESENÇA do código, e não por uma lista de códigos:
   * falha de transporte não tem código, e uma regra nova na guarda não pode
   * ficar de fora por esquecimento de atualizar uma lista aqui.
   */
  private otpDeliveryFailureMessage(
    channel: SignatureDeliveryChannel,
    code?: string | null,
  ): string {
    const destino = channel === 'WHATSAPP' ? 'pelo WhatsApp' : 'para o seu e-mail';
    if (code) {
      return (
        `Não foi possível enviar o código ${destino} agora. Tentar de novo em ` +
        'seguida não resolve — fale com a Ankaa para concluir a assinatura.'
      );
    }
    return `Não foi possível enviar o código ${destino}. Tente novamente em instantes ou fale com a Ankaa.`;
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

    this.assertOtpCeremony(signer);
    await this.assertSignable(env, signer);

    const required = [...declarationKeysFor('OTP')];
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
    // `onQuoteContentChanged` é chamado de UM ponto (BudgetService.update),
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
      // O mesmo hash que `requestOtp` prendeu ao desafio: o do RECORTE dele.
      expectedDocumentSha256: signer.document?.originalSha256 ?? env.originalSha256,
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

    const customer = primaryTask(env.quote)?.customer ?? null;
    const signerSections = this.sectionsOf(signer.document);
    // Texto EXATO exibido, nunca um booleano: o que importa em juízo é o que
    // aquela pessoa leu, e o template pode mudar entre versões — e agora também
    // muda com o RECORTE, porque quem não recebeu preço não declara valor.
    const declarations = this.renderDeclarationsFor({
      kind: 'OTP',
      channel: channelForAuthMethod(signer.authMethod),
      sections: signerSections,
      budgetNumber: env.quote.budgetNumber,
      total: Number(env.quote.total),
      cargo: signer.informedCargo,
      company: customer?.corporateName ?? customer?.fantasyName ?? '',
    }).map(d => ({
      ...d,
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
      // O documento que ELE assinou. Gravar aqui o hash do envelope — que é o do
      // recorte completo — faria a evidência apontar para bytes que esta pessoa
      // nunca viu, e é exatamente essa amarração que sustenta a autoria.
      documentId: signer.documentId,
      documentSections: signerSections,
      documentSha256: signer.document?.originalSha256 ?? env.originalSha256,
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
      documentHash: signer.document?.originalSha256 ?? env.originalSha256,
      payload: {
        evidenceHash,
        cargo: signer.informedCargo,
        variant: signer.document?.variantKey ?? null,
        sections: signerSections,
      },
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
    this.assertOtpCeremony(signer);
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
      expectedDocumentSha256: signer.document?.originalSha256 ?? env.originalSha256,
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

    // ── O ATO, no caminho COMUM às duas cerimônias ───────────────────────────
    //
    // Ver `applyRefusal`: a recusa é de quem recusou e só, o envelope só morre
    // quando não sobra mais ninguém do lado do cliente, e os avisos saem fora da
    // transação. A prova deste caminho é o desafio que acabou de ser verificado.
    await this.applyRefusal({
      env,
      signer,
      reason,
      ctx: args.ctx,
      proof: { challengeId: args.challengeId },
    });
  }

  /**
   * O ATO DA RECUSA — comum às DUAS cerimônias (código de uso único e sessão do
   * portal).
   *
   * Extraído de `refuse` quando a recusa pelo Portal do Cliente nasceu. O que
   * muda entre as duas é só COMO a pessoa foi autenticada — e isso já foi
   * decidido, e provado, antes de chegar aqui: `refuse` verifica um
   * `SigningChallenge`, `refuseByPortalSession` confere o par
   * `{ id, responsibleId }` da sessão. Deste ponto em diante o ato é o mesmo, e
   * tem de continuar sendo: são as transições de estado e a trilha encadeada de
   * um ato jurídico, e duas cópias delas divergiriam no primeiro conserto.
   *
   * O CHAMADOR É QUEM GARANTE, ANTES: `assertCeremonyConfigured`, a cerimônia
   * certa, `assertSignable` e um `reason` já aparado e não vazio.
   *
   * Devolve se a coleta INTEIRA morreu — é o que distingue "um recusou, os
   * outros ainda podem assinar" de "não sobrou ninguém do lado do cliente".
   */
  private async applyRefusal(input: {
    env: {
      id: string;
      quoteId: string;
      originalSha256: string | null;
      status: EnvelopeStatus;
    };
    signer: {
      id: string;
      declaredName: string | null;
      declaredCpf?: string | null;
      informedCpf: string | null;
      informedCargo: string | null;
    };
    /** Já aparado e não vazio — a borda de quem chamou. */
    reason: string;
    ctx: RequestContext;
    /** A prova do ato NESTA cerimônia. Entra na trilha, dentro do payload. */
    proof: Record<string, unknown>;
  }): Promise<{ envelopeRefused: boolean }> {
    const { env, signer, reason, ctx, proof } = input;

    // A recusa é atribuída ao SIGNATÁRIO e registrada na trilha encadeada ANTES
    // de o envelope ir para o estado terminal: se a gravação da prova falhar
    // (`record` lança, ao contrário de `recordBestEffort`), o negócio não é
    // morto por um ato que não conseguimos documentar.
    await this.audit.record(env.id, {
      eventType: 'SIGNATURE_REFUSED',
      actorType: 'SIGNER',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      documentHash: env.originalSha256,
      payload: {
        reason,
        cpf: maskCpf(signer.informedCpf ?? signer.declaredCpf),
        cargo: signer.informedCargo,
        // O QUE PROVA O ATO NESTA CERIMÔNIA: o desafio verificado, no caminho
        // do código; a sessão do portal, no caminho da sessão. É o único campo
        // em que as duas recusas divergem — e por isso é parâmetro, e não um
        // segundo método.
        ...proof,
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // A RECUSA É DE QUEM RECUSOU — E SÓ
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Até aqui uma recusa derrubava o envelope inteiro, e com ele TODA assinatura
    // já colhida: as outras continuavam `SIGNED` no banco, mas o envelope nunca
    // mais chegava a `COMPLETED`, nenhum recorte era selado e nenhum dos atos
    // produzia documento. Na prática, quem assinou de manhã perdia a assinatura
    // porque um colega recusou à tarde.
    //
    // O QUE DE FATO INVALIDA UMA ASSINATURA é uma MUDANÇA MATERIAL no documento
    // — e para isso já existe máquina inteira (`checkMaterialChange`, o hash do
    // recorte material, `INVALIDATED` + signatários `VOIDED`). Recusar não muda
    // byte nenhum do que os outros assinaram: o PDF congelado deles continua
    // idêntico, e a declaração que leram continua verdadeira.
    //
    // Se a recusa levar a um reajuste — e é o caso comum: recusou porque o preço
    // estava alto, o comercial reajusta —, é o REAJUSTE que invalida, pelo
    // caminho que já existe. A recusa em si só informa e trava a conclusão.
    //
    // O envelope só morre quando não sobra NINGUÉM do lado do cliente para
    // assinar: aí não há mais o que esperar, e mantê-lo vivo seria mentir na
    // lista do comercial.
    let envelopeRefused = false;
    await this.prisma.$transaction(async tx => {
      await tx.envelopeSigner.update({
        where: { id: signer.id },
        data: {
          status: EnvelopeSignerStatus.REFUSED,
          refusedAt: new Date(),
          refusalReason: reason,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      // Escrito como EXCLUSÃO e não como `status: PENDING`, pela mesma razão do
      // filtro dos lembretes: um estado intermediário novo no enum tem de contar
      // como "ainda pode assinar", que é a direção segura aqui — a errada mata
      // uma coleta viva.
      const aindaPodemAssinar = await tx.envelopeSigner.count({
        where: {
          envelopeId: env.id,
          orderGroup: 0,
          status: {
            notIn: [
              EnvelopeSignerStatus.REFUSED,
              EnvelopeSignerStatus.VOIDED,
              EnvelopeSignerStatus.EXPIRED,
            ],
          },
        },
      });

      if (aindaPodemAssinar === 0) {
        envelopeRefused = true;
        // Reivindicação condicionada ao estado atual, como em `advanceEnvelope`:
        // duas recusas simultâneas (ou uma recusa concorrente com a conclusão)
        // não podem sobrescrever um envelope que já saiu de RUNNING.
        await tx.signatureEnvelope.updateMany({
          where: { id: env.id, status: EnvelopeStatus.RUNNING },
          data: { status: EnvelopeStatus.REFUSED },
        });
      }
    });

    // Só os desafios de QUEM RECUSOU. Anular os do envelope inteiro derrubaria o
    // código que outro responsável tem na mão neste exato momento — ele pediu,
    // recebeu, e a mensagem deixaria de funcionar sem explicação.
    if (envelopeRefused) {
      await this.challenges.supersedeAllForEnvelope(env.id);
    } else {
      await this.challenges.supersedeAllForSigner(signer.id);
    }

    // ── O ORÇAMENTO SAI DE "PENDENTE" ────────────────────────────────────────
    //
    // Só quando a coleta INTEIRA morreu. Uma recusa isolada, com colegas ainda
    // podendo assinar, não move o orçamento: a bola continua com o cliente, e
    // reabrir o recusante (`resendInvitation`) devolve a coleta ao curso normal.
    //
    // SEM `await`, como os dois avisos abaixo e pela mesma razão: isto roda
    // dentro do POST do CLIENTE, que está com a tela do celular aberta. A recusa
    // dele já está persistida e gravada na trilha encadeada; o rótulo da nossa
    // lista interna não é motivo para segurar a resposta dele — nem para
    // devolver erro se o domínio de orçamento recusar a transição.
    if (envelopeRefused) {
      if (this.onEnvelopeRefused) {
        void this.onEnvelopeRefused(env.quoteId, env.id, reason).catch(error =>
          this.logger.error(
            `Envelope ${env.id} recusado, mas o orçamento ${env.quoteId} não pôde ser movido: ${
              error instanceof Error ? error.message : error
            }`,
          ),
        );
      } else {
        this.logger.warn(
          `Envelope ${env.id} foi RECUSADO, mas nenhum ouvinte de recusa está registrado — ` +
            `o orçamento ${env.quoteId} continua no estado em que estava.`,
        );
      }
    }

    // O AVISO AO COMERCIAL — fora da transação e sem `await` que derrube o ato.
    //
    // A recusa é do CLIENTE e já está gravada; se o WhatsApp estiver fora do ar
    // ou a Meta recusar o template, a recusa continua tendo acontecido. Deixar o
    // envio dentro da transação faria uma falha de mensageria desfazer o
    // registro de um ato jurídico — exatamente ao contrário do que interessa.
    void this.notifyRefusalToAnkaa(env.id, signer.id, reason).catch(error =>
      this.logger.error(
        `Falha ao avisar o comercial da recusa no envelope ${env.id}: ${
          error instanceof Error ? error.message : error
        }`,
      ),
    );

    // E OS COLEGAS DELE. Sem isto, os outros responsáveis ficam com um link que
    // ainda abre, numa coleta que ninguém vai concluir, e sem saber por quê — é
    // a mesma cortesia que o caminho de alteração material já faz há tempo.
    void this.notifyRefusalToPeers(env.id, signer.id).catch(error =>
      this.logger.error(
        `Falha ao avisar os demais responsáveis da recusa no envelope ${env.id}: ${
          error instanceof Error ? error.message : error
        }`,
      ),
    );

    return { envelopeRefused };
  }

  /**
   * Avisa os DEMAIS responsáveis do cliente de que um colega recusou.
   *
   * Só quem ainda pode agir e quem já agiu — pendentes e quem já assinou. Quem
   * já assinou precisa saber MAIS do que os pendentes, não menos: ele deu um ato
   * e tem direito a saber que ele não vai virar contrato agora, e que continua
   * valendo (é essa a parte que a versão anterior desta cerimônia destruía).
   *
   * Fora: o próprio recusante, o lado da Ankaa (que recebe o aviso COM o motivo,
   * por `notifyRefusalToAnkaa`) e quem foi anulado ou perdeu o prazo.
   */
  private async notifyRefusalToPeers(envelopeId: string, refusedBySignerId: string): Promise<void> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: { quote: { select: { budgetNumber: true } }, signers: true },
    });
    if (!env) return;

    const refusedBy = env.signers.find(s => s.id === refusedBySignerId);
    const peers = env.signers.filter(
      s =>
        s.id !== refusedBySignerId &&
        s.orderGroup === 0 &&
        (s.status === EnvelopeSignerStatus.SIGNED ||
          !(
            [
              EnvelopeSignerStatus.REFUSED,
              EnvelopeSignerStatus.VOIDED,
              EnvelopeSignerStatus.EXPIRED,
            ] as EnvelopeSignerStatus[]
          ).includes(s.status)),
    );
    if (peers.length === 0) return;

    const payload = {
      budgetNumber: env.quote.budgetNumber,
      refusedByName: refusedBy?.declaredName ?? 'Um responsável',
    };

    for (const peer of peers) {
      // O canal de CADA UM, do `authMethod` dele — não o da coleta. Num envelope
      // misto, ler o canal da coleta mandaria e-mail para quem entrou por
      // WhatsApp e gravaria o canal errado na trilha.
      const channel = this.deliveryChannelFor(peer, env.signers);
      const delivery = await this.deliverToSigner({
        signer: peer,
        channel,
        email: generateCollectionPausedEmail({ ...payload, signerName: peer.declaredName }),
        whatsapp: generateCollectionPausedWhatsApp({ ...payload, signerName: peer.declaredName }),
        // ⚠️ ERA O ÚNICO AVISO A CLIENTE QUE SAÍA EM TEXTO LIVRE.
        //
        // Sem template, `sendWhatsApp` caía no Baileys — para o número de um
        // responsável do CLIENTE, fora da janela de 24 h. É exatamente o envio
        // que a Cloud API recusa por política e o que, pelo canal não oficial,
        // derruba número. O template existe desde 17/09
        // (`orcamento_assinatura_pausada`) e este é o caminho dele.
        whatsappTemplate: collectionPausedTemplate({
          signerName: peer.declaredName,
          budgetNumber: payload.budgetNumber,
          refusedByName: payload.refusedByName,
        }),
        kind: 'SIGNATURE_COLLECTION_PAUSED',
      });

      await this.audit.recordBestEffort(envelopeId, {
        eventType: delivery.ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
        actorType: 'SYSTEM',
        actorId: peer.id,
        actorLabel: peer.declaredName,
        payload: {
          stage: 'customer',
          kind: 'collection_paused_notice',
          channel: auditChannelOf(channel),
          destination: this.maskContactFor(peer, channel),
          ...(delivery.reason ? { failureReason: delivery.reason } : {}),
        },
      });
    }
  }

  /**
   * Avisa o comercial da Ankaa de que o cliente RECUSOU, e por quê.
   *
   * POR QUE O DESTINATÁRIO É O SIGNATÁRIO DA ANKAA
   *   Ele já está no envelope, com nome, telefone e e-mail congelados no momento
   *   da emissão, e é a pessoa que o documento nomeia como representante do
   *   negócio. Buscar "o comercial" por setor devolveria uma lista e obrigaria a
   *   escolher — e quem responde por ESTE orçamento é quem ia contra-assiná-lo.
   *
   *   Consequência: uma coleta antiga, emitida antes de a contra-assinatura
   *   existir, pode não ter esse signatário. Nesse caso não há a quem avisar por
   *   este caminho, e o método sai em silêncio em vez de inventar um
   *   destinatário.
   *
   * O CANAL é o da COLETA (`noticeChannelOf`), o mesmo do aviso de
   * contra-assinatura: um orçamento conduzido por e-mail não deve produzir um
   * WhatsApp inesperado, e vice-versa.
   */
  private async notifyRefusalToAnkaa(
    envelopeId: string,
    refusedBySignerId: string,
    reason: string,
  ): Promise<void> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: {
        quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true } } } },
        signers: true,
      },
    });
    if (!env) return;

    const ankaa = env.signers.find(
      s => s.authMethod === SignatureAuthMethod.INTERNAL_SESSION || s.orderGroup === 1,
    );
    if (!ankaa) {
      this.logger.warn(
        `Envelope ${envelopeId} recusado, mas sem signatário da Ankaa a quem avisar.`,
      );
      return;
    }

    const refusedBy = env.signers.find(s => s.id === refusedBySignerId);
    const payload = {
      signerName: ankaa.declaredName,
      refusedByName: refusedBy?.declaredName ?? 'Um responsável do cliente',
      budgetNumber: env.quote.budgetNumber,
      reason,
      quoteUrl: this.internalQuoteUrl(primaryTask(env.quote)?.id ?? null),
    };

    const channel = this.noticeChannelOf(env.signers);
    const delivery = await this.deliverToSigner({
      signer: ankaa,
      channel,
      email: generateRefusalNoticeEmail(payload),
      whatsapp: generateRefusalNoticeWhatsApp(payload),
      // O template sai pelo número OFICIAL quando a Cloud API está ligada; sem
      // ela, `sendWhatsApp` cai no texto livre acima, pelo Baileys.
      whatsappTemplate: refusedTemplate({
        refusedByName: payload.refusedByName,
        budgetNumber: payload.budgetNumber,
        reason,
        quoteTaskId: this.internalQuoteButtonParam(
          primaryTask(env.quote)?.id ?? null,
          env.quoteId,
        ),
      }),
      kind: 'SIGNATURE_REFUSAL_NOTICE',
    });

    await this.audit.recordBestEffort(envelopeId, {
      eventType: delivery.ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
      actorType: 'SYSTEM',
      actorId: ankaa.id,
      actorLabel: ankaa.declaredName,
      payload: {
        stage: 'ankaa',
        // Como no aviso de contra-assinatura: isto NÃO é um convite de
        // assinatura, e a trilha precisa dizê-lo para não ser lida como tal.
        kind: 'refusal_notice',
        channel: auditChannelOf(channel),
        destination: this.maskContactFor(ankaa, channel),
        ...(delivery.reason ? { failureReason: delivery.reason } : {}),
      },
    });
  }

  /**
   * Geolocalização utilizável ou nada.
   *
   * Meia coordenada não é evidência: `geoSource: 'gps'` com latitude nula
   * afirmaria no dossiê que houve captura de posição quando não houve. Ou os
   * dois números são finitos e estão na faixa, ou o ato é registrado como
   * `denied`, que é o que de fato aconteceu.
   */
  // ===========================================================================
  // CONTRA-ASSINATURA DA ANKAA (sessão autenticada, um único ato)
  // ===========================================================================

  /**
   * O lado da Ankaa fecha a coleta — UM botão, sem código.
   *
   * POR QUE ESTE CAMINHO NÃO TEM OTP
   *   O código de uso único existe para provar POSSE DE UM CANAL por alguém que
   *   a plataforma não conhece. Do lado da Ankaa não há essa lacuna: quem aperta
   *   o botão chegou aqui por uma sessão que o próprio servidor emitiu, contra
   *   uma senha que o próprio servidor guarda, e o `userId` do signatário foi
   *   fixado no congelamento do documento. Mandar um código para a caixa do
   *   diretor provaria que ele tem acesso à caixa dele — coisa que ninguém
   *   contesta, e que é precisamente o elo mais fraco desta ponta.
   *
   *   O risco que a cerimônia elaborada endereça é o do OUTRO lado: é o cliente
   *   que pode alegar que não foi ele, e é contra ele que a prova precisa se
   *   sustentar. Contra nós mesmos não há o que provar — a Ankaa não vai alegar
   *   que não quis assinar o próprio orçamento.
   *
   * UM ATO, N RECORTES
   *   O signatário da Ankaa tem âncora em TODOS os recortes e um único registro.
   *   Este ato aplica o selo dele em todos, e isso é legítimo porque cada recorte
   *   é subconjunto estrito do documento completo — que é o que ele leu e o que a
   *   declaração dele nomeia. Assinar o todo é, a fortiori, assinar cada parte.
   *   A evidência lista, um a um, os hashes que o ato contra-assina.
   */
  async countersign(args: {
    envelopeId: string;
    actorUserId: string;
    ctx: RequestContext;
  }): Promise<{ status: EnvelopeSignerStatus; envelopeStatus: EnvelopeStatus }> {
    this.assertCeremonyConfigured();

    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: args.envelopeId },
      include: {
        signers: { include: { document: true } },
        documents: {
          select: {
            id: true,
            variantKey: true,
            sections: true,
            originalSha256: true,
            lateSlots: true,
          },
        },
        quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { customer: true, truck: true } } } },
      },
    });
    if (!env) throw new NotFoundException('Coleta de assinaturas não encontrada.');

    const ankaa = env.signers.find(
      s => s.authMethod === SignatureAuthMethod.INTERNAL_SESSION || s.orderGroup === 1,
    );
    if (!ankaa) {
      throw new BadRequestException(
        'Esta coleta não tem signatário da Ankaa. Emita uma nova coleta para o orçamento.',
      );
    }

    // COLETAS ANTIGAS ficam de fora, e não é rigor: nelas o signatário da Ankaa
    // foi congelado com `EMAIL_OTP`/`WHATSAPP_OTP`, o documento imprime uma
    // cláusula de aceitação que descreve autenticação por código, e a declaração
    // que ele leu afirma posse do canal. Fechar por sessão um documento que diz
    // outra coisa criaria justamente a contradição interna que a v3 destas
    // constantes existiu para consertar. O link com código daquelas coletas
    // continua valendo.
    if (ankaa.authMethod !== SignatureAuthMethod.INTERNAL_SESSION) {
      throw new BadRequestException(
        'Esta coleta foi emitida antes da contra-assinatura pelo sistema. Conclua pelo link ' +
          'de assinatura enviado, ou cancele e emita uma nova coleta.',
      );
    }

    // A PESSOA DESIGNADA — OU UM ADMINISTRADOR EM NOME DELA.
    //
    // A trava era "só a pessoa designada", e o argumento contra o administrador
    // era bom: assinar no lugar de alguém gravaria o nome dela num ato que ela não
    // praticou. O que o argumento não via é que o contra-assinante é UMA PESSOA em
    // todo o sistema — `Budget.commercialUserId` é nulo em todo o acervo, e
    // `resolveAnkaaSigner` cai sempre no diretor. Com um contra-assinante único, a
    // trava não protegia a verdade do documento: ela transformava férias, doença ou
    // desligamento em coleta impossível de concluir, com o cliente já tendo
    // assinado e o contrato parado.
    //
    // A decisão do dono (17/09) é que o administrador PODE contra-assinar sem
    // trocar o responsável. A falsidade que o argumento temia é evitada de outro
    // jeito, e melhor: o documento continua dizendo o que sempre disse — a
    // identidade congelada no envelope —, e a TRILHA registra quem de fato
    // executou. Ver `executadoPor` na evidência e no evento de auditoria.
    const atorEhODesignado = !!ankaa.userId && ankaa.userId === args.actorUserId;
    let executor: { id: string; name: string | null } | null = null;
    if (!atorEhODesignado) {
      const ator = await this.prisma.user.findUnique({
        where: { id: args.actorUserId },
        select: { id: true, name: true, sector: { select: { privileges: true } } },
      });
      if (ator?.sector?.privileges !== 'ADMIN') {
        throw new ForbiddenException(
          `A contra-assinatura deste orçamento cabe a ${ankaa.declaredName}. ` +
            'Apenas ela ou um administrador podem assiná-la.',
        );
      }
      executor = { id: ator.id, name: ator.name };
    }

    // Mesma porta de todos os atos: status, prazo, já-assinou, e a ordem —
    // o grupo 1 só libera quando todo o grupo 0 assinou. É ela que dá sentido ao
    // aviso "todos já assinaram e aguardam você".
    await this.assertSignable(env, ankaa);

    // O QUE FICA DE FORA DO SELO — registrado, NUNCA bloqueado.
    //
    // Houve uma versão disto que recusava a contra-assinatura enquanto o chassi
    // estivesse vazio, na ideia de que este clique é a última janela antes do
    // selo. A ideia estava certa sobre a mecânica e errada sobre a OFICINA: a
    // assinatura do orçamento É a aprovação, o caminhão só vem para a empresa
    // depois de aprovado, e o chassi só se lê com o caminhão no pátio. Pedir o
    // chassi antes de assinar é pedir um dado que ainda não pode existir — o
    // aviso apareceria em toda coleta de implemento 0 km e seria clicado sempre,
    // que é como se ensina um operador a ignorar avisos.
    //
    // Então a lacuna vazia é o estado NORMAL, e o que se faz com ela é registrar:
    // a trilha guarda quais campos o selo congelou em branco, e é dela que sai
    // a prova de que a ausência é da natureza do negócio, não de um descuido.
    const pending = this.pendingLateSlots(env);

    // GARANTIA DE FRESCOR, idêntica à do caminho do cliente e pelo mesmo motivo:
    // a pergunta é feita no único instante em que a resposta é juridicamente
    // decisiva. Selar por cima de condições que mudaram seria afirmar, com o
    // certificado da empresa, algo que deixou de ser verdade.
    const fresh = await this.snapshots.buildForQuote(env.quoteId);
    if (fresh && fresh.hash !== env.quoteSnapshotSha256) {
      const invalidated = await this.onQuoteContentChanged(env.quoteId, args.actorUserId);
      if (invalidated) {
        throw new BadRequestException(
          'O orçamento foi alterado desde o envio e a coleta foi invalidada. ' +
            'Reemita a coleta para o cliente.',
        );
      }
    }

    // ⚠️ A IDENTIDADE DO DOCUMENTO É A DO DESIGNADO, não a de quem clicou.
    //
    // Quando um administrador contra-assina em nome do responsável, o cargo, o CPF
    // e as declarações têm de continuar sendo os DELE — é o nome dele que está
    // congelado no envelope e impresso na linha de assinatura do PDF. Puxar o
    // cargo de quem clicou faria o selo dizer "Sergio Rodrigues" com o cargo do
    // administrador, que é exatamente a mistura que se quer evitar.
    //
    // Quem clicou é registrado à parte, em `executadoPor`.
    const user = await this.prisma.user.findUnique({
      where: { id: ankaa.userId ?? args.actorUserId },
      select: { id: true, name: true, cpf: true },
    });

    // ⚠️ O CARGO VEM DO DOCUMENTO, NÃO DO CADASTRO DE AGORA.
    //
    // Era `position || sector || directorTitle`, lido do cadastro no instante do
    // clique, enquanto o PDF congelava `"${COMPANY.directorTitle} — ${COMPANY.name}"`.
    // Um comentário aqui afirmava que o recuo impedia a divergência; ele só a
    // impedia para quem NÃO tivesse posição nem setor. Quem tem — todo mundo —
    // recebia um selo com um cargo e um papel com outro. Está no acervo.
    //
    // Agora a emissão resolve o cargo UMA vez (`ankaaCargoOf`), imprime-o no
    // documento e o congela em `informedCargo` na mesma transação; aqui ele é
    // lido de volta. O recuo é o `COMPANY.directorTitle` LITERAL, e não a cadeia
    // do cadastro: nos envelopes anteriores a esta correção é exatamente isso
    // que o papel diz, invariavelmente.
    const cargo = fitCargo(ankaa.informedCargo ?? '') || COMPANY.directorTitle;

    // CPF ausente não barra. Ele reforça a evidência e sai no selo, mas a
    // identidade deste ato vem da sessão e do `userId` congelado no documento —
    // travar o fechamento de um negócio por um campo vazio no cadastro do DP
    // seria cobrar do cliente um problema que é nosso. Fica registrado que
    // faltou, que é o que permite corrigir.
    //
    // ⚠️ E fica registrado NA TRILHA, não só no log. Enquanto isto era um
    // `logger.warn` solitário, o acervo inteiro de contra-assinaturas recentes
    // saiu sem CPF sem que ninguém percebesse: o dado não existia em nenhuma
    // tela, em nenhum evento e em nenhum relatório. Ver `semCpf` no payload do
    // `SIGNATURE_APPLIED`, o aviso do preflight (`ankaa.hasCpf`) e o
    // `cpfPendente` da listagem do painel.
    const cpf = onlyDigits(user?.cpf ?? '') || null;
    if (!cpf) {
      this.logger.warn(
        `Contra-assinatura do envelope ${env.id} SEM CPF: o representante ` +
          `${user?.name ?? ankaa.declaredName} (usuário ${ankaa.userId ?? args.actorUserId}) não ` +
          'tem CPF no cadastro do DP. O selo deste documento sai sem o documento do signatário, ' +
          'e isso é definitivo — os bytes são congelados neste ato.',
      );
    }

    const customer = primaryTask(env.quote)?.customer ?? null;
    const sections = this.sectionsOf(ankaa.document);
    const declarations = this.renderDeclarationsFor({
      kind: 'INTERNAL',
      channel: this.noticeChannelOf(env.signers),
      sections,
      budgetNumber: env.quote.budgetNumber,
      total: Number(env.quote.total),
      cargo,
      company: customer?.corporateName ?? customer?.fantasyName ?? '',
    }).map(d => ({
      ...d,
      acceptedAt: new Date().toISOString(),
      version: DECLARATIONS_VERSION,
    }));

    await this.audit.record(env.id, {
      eventType: 'DECLARATIONS_ACCEPTED',
      actorType: 'SIGNER',
      actorId: ankaa.id,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: {
        version: DECLARATIONS_VERSION,
        count: declarations.length,
        ceremony: 'internal_session',
      },
    });

    const serverTimestamp = new Date();
    const evidence = {
      envelopeId: env.id,
      signerId: ankaa.id,
      documentId: ankaa.documentId,
      documentSections: sections,
      documentSha256: ankaa.document?.originalSha256 ?? env.originalSha256,
      // O que ESTE ato contra-assina. Cada recorte é um subconjunto do documento
      // acima; listar os hashes é o que permite, anos depois, apontar qual PDF
      // recebeu este selo sem depender de reconstruir o raciocínio.
      countersignedDocuments: env.documents.map(d => ({
        variantKey: d.variantKey,
        sections: d.sections,
        sha256: d.originalSha256,
      })),
      declaredName: ankaa.declaredName,
      informedCpf: cpf,
      informedCargo: cargo,
      authMethod: SignatureAuthMethod.INTERNAL_SESSION,
      // A prova de identidade DESTE ato: a sessão autenticada, e não um código.
      sessionUserId: args.actorUserId,
      // ⚠️ QUANDO PRESENTE, O ATO NÃO FOI PRATICADO PELO DESIGNADO.
      //
      // A contra-assinatura é da EMPRESA, e o nome que ela leva é o do
      // representante congelado no envelope. Um administrador pode executá-la em
      // nome dele (decisão do dono, 17/09) — mas quem executou fica gravado aqui,
      // no mesmo objeto que entra no hash e no HMAC. Sem este campo o selo diria
      // que o designado assinou, e não haveria como saber que não foi ele.
      ...(executor ? { executadoPor: executor } : {}),
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      serverTimestamp: serverTimestamp.toISOString(),
      declarations,
    };

    const evidenceHash = sha256Hex(evidence);
    const pepper = this.config.get<string>('SIGNATURE_HMAC_SECRET');
    if (!pepper) {
      throw new ServiceUnavailableException(
        'Assinatura eletrônica temporariamente indisponível (configuração do servidor).',
      );
    }
    const hmacSignature = createHmac('sha256', pepper).update(evidenceHash).digest('hex');

    await this.prisma.envelopeSigner.update({
      where: { id: ankaa.id },
      data: {
        status: EnvelopeSignerStatus.SIGNED,
        signedAt: serverTimestamp,
        informedCpf: cpf,
        informedCargo: cargo,
        // `cpfMatch` compara o informado com o declarado. Aqui os dois saem da
        // MESMA linha do banco, então a comparação não prova nada e afirmar
        // `true` seria fabricar uma conferência que não houve.
        cpfMatch: null,
        ipAddress: args.ctx.ipAddress,
        userAgent: args.ctx.userAgent,
        // Sem geolocalização: o navegador do escritório não é pedido a informá-la
        // e `geoSource: 'denied'` descreveria uma recusa que ninguém fez.
        geoSource: 'internal_session',
        declarations: declarations as unknown as Prisma.InputJsonValue,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        evidenceHash,
        hmacSignature,
      },
    });

    await this.audit.record(env.id, {
      eventType: 'SIGNATURE_APPLIED',
      actorType: 'SIGNER',
      actorId: ankaa.id,
      // Quem o ato ATRIBUI, e — quando diferente — quem o EXECUTOU. Um rótulo só
      // com o nome do designado esconderia que outra pessoa apertou o botão.
      actorLabel: executor
        ? `${ankaa.declaredName} (executado por ${executor.name ?? executor.id})`
        : ankaa.declaredName,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      documentHash: ankaa.document?.originalSha256 ?? env.originalSha256,
      payload: {
        evidenceHash,
        cargo,
        // O que o selo NÃO pôde afirmar. Um documento selado sem o CPF do
        // representante precisa carregar, na própria trilha, que a ausência foi
        // do cadastro e não do ato — é o que separa "não tínhamos o dado" de
        // "alguém omitiu o dado".
        ...(cpf ? {} : { semCpf: true }),
        ...(executor ? { executadoPor: executor } : {}),
        ceremony: 'internal_session',
        countersigned: env.documents.map(d => d.variantKey),
        // O QUE O SELO CONGELOU EM BRANCO. Um documento que diz "a registrar"
        // para sempre precisa carregar, na própria trilha, quais campos eram
        // esses e desde quando — é o que liga o documento assinado ao dado que
        // chega depois, quando o caminhão entra no pátio.
        ...(pending.length ? { lateSlotsPending: pending.map(p => p.key) } : {}),
      },
    });

    const envelopeStatus = await this.advanceEnvelope(env.id);
    return { status: EnvelopeSignerStatus.SIGNED, envelopeStatus };
  }

  // ===========================================================================
  // O PORTAL DO CLIENTE — assinar por SESSÃO, sem código
  // ===========================================================================

  /**
   * O que espera por ESTE contato, do lado dele.
   *
   * ⚠️ A PRIMEIRA CONSULTA DO SISTEMA A BUSCAR `EnvelopeSigner` POR
   * `responsibleId`. A coluna é FK real desde a primeira migration e tem
   * `@@unique([envelopeId, responsibleId])` — o signatário do cliente nunca foi
   * "contato copiado" —, mas até aqui tudo o que a abria era o `accessToken` do
   * link. É essa troca de chave que muda a natureza do acesso: o link é uma
   * capability que se encaminha, a sessão é uma identidade que o servidor
   * emitiu.
   *
   * DEVOLVE TAMBÉM O QUE ELE NÃO ASSINA AQUI. Um contato pode ter uma coleta
   * antiga, emitida por código, ainda pendente: escondê-la faria o portal dizer
   * "nada esperando por você" enquanto um orçamento espera. Cada linha diz a
   * CERIMÔNIA dela e se o ato cabe no portal (`podeAssinarAqui`); quem não cabe
   * é mandado para o link.
   */
  async listPendingForResponsible(responsibleId: string): Promise<
    Array<{
      signerId: string;
      status: EnvelopeSignerStatus;
      ceremony: CeremonyKind;
      podeAssinarAqui: boolean;
      envelope: {
        id: string;
        /**
         * `Budget.id` — o endereço do orçamento, para o link "ver o orçamento".
         *
         * Sai daqui e não de uma segunda consulta: o `web` o usava para casar o
         * envelope com a frota lida à parte, e agora o usa para NAVEGAR.
         */
        budgetId: string;
        status: EnvelopeStatus;
        budgetNumber: number;
        deadlineAt: Date;
        acceptanceClause: string | null;
      };
      documento: {
        id: string | null;
        sections: QuoteSection[];
        label: string;
        isFull: boolean;
        sha256: string | null;
      };
      /** Segue o RECORTE: quem não recebeu PRICING não vê total em lugar nenhum. */
      total: string | null;
      /**
       * OS VEÍCULOS COBERTOS, COM A IDENTIDADE QUE A TELA PRECISA — e não só um
       * rótulo.
       *
       * ⛔ ELES VÊM DAQUI PORQUE A PERGUNTA É DESTE ENVELOPE. A tela de
       * assinaturas precisa saber, por envelope, quais veículos estão sem número
       * de pedido (o ⛔ PORTÃO DO COMPRAS) e em quais o campo de conserto vai
       * gravar. Enquanto esta rota mandava só `{ id, label }`, o `web` só
       * conseguia responder isso lendo a FROTA INTEIRA (`GET
       * /cliente/me/veiculos?take=500`) e filtrando no navegador por
       * `vehicle.budget.id` — uma segunda requisição, com o teto de 100 do
       * schema estourado, para responder uma pergunta que já estava respondida
       * aqui dentro. Um cliente com 358 veículos pagava 358 linhas para saber de
       * 4.
       *
       * ⚠️ SEGUE O RECORTE, como `total` segue `PRICING`. Série, placa e número
       * do pedido são seção `VEHICLE` (contrato §2); sem ela a lista vem VAZIA,
       * e não com os campos nulos — vazio é "você não vê isto", campo nulo é
       * "isto existe e está em branco", e as duas desenham telas diferentes.
       *
       * ⚠️ HOJE `VEHICLE` É `ALWAYS_SECTION` (`quote-sections.ts`): ela entra em
       * TODO recorte que assina, inclusive o do Marketing — o PDF dele imprime o
       * veículo, porque aprovar arte sem saber em qual caminhão ela vai não é
       * aprovar nada. Ou seja: o piso abaixo não recorta ninguém no dado atual, e
       * existe para que, no dia em que `ALWAYS_SECTIONS` mudar, esta rota mude
       * junto — em vez de continuar mandando placa a quem o documento parou de
       * mostrar, que é a classe de vazamento que este módulo inteiro persegue.
       */
      veiculos: Array<{
        /** `Task.id` — é ele que vai em `taskIds` de `POST /cliente/me/pedidos`. */
        taskId: string;
        name: string | null;
        /** Série, placa ou nome — o identificador humano, já resolvido. */
        label: string;
        serialNumber: string | null;
        plate: string | null;
        /** A coluna legada, que é a que a NFS-e e o boleto leem. */
        customerOrderNumber: string | null;
        /** A ENTIDADE do pedido. O portão aceita os dois lados da escrita dupla. */
        purchaseOrder: { id: string; number: string; issuedAt: Date | null } | null;
      }>;
      /** O portão do pedido de compra, já resolvido para a tela. */
      pedidoDeCompra: { exigido: boolean; pendente: boolean; mensagem: string | null };
      declaracoes: Array<{ key: string; text: string }>;
    }>
  > {
    const signers = await this.prisma.envelopeSigner.findMany({
      where: {
            responsibleId,
        // SÓ O QUE DE FATO ESPERA POR ELE. `SIGNED`/`REFUSED`/`VOIDED` não são
        // pendência, e um envelope fora de RUNNING não aceita ato nenhum
        // (`assertSignable`) — listá-lo ofereceria um botão que o servidor
        // recusaria em seguida.
        status: {
          in: [
            EnvelopeSignerStatus.PENDING,
            EnvelopeSignerStatus.VIEWED,
            EnvelopeSignerStatus.AUTHENTICATED,
          ],
        },
        envelope: { status: EnvelopeStatus.RUNNING },
      },
      include: {
        document: true,
        responsible: { select: { id: true, roles: true, companyId: true } },
        envelope: {
          include: {
            signers: { select: { orderGroup: true, authMethod: true } },
            quote: {
              include: {
                tasks: {
                  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                  include: {
                    customer: true,
                    truck: true,
                    // ⚠️ A ENTIDADE, além da coluna legada. `taskHasPurchaseOrder`
                    // aceita os DOIS lados da escrita dupla, e a tela precisa
                    // poder dizer "já no pedido 8842" — o que o `purchaseOrderId`
                    // sozinho não escreve.
                    purchaseOrder: { select: { id: true, number: true, issuedAt: true } },
                    // ⛔ O CAMINHO DO PAGADOR, para o portão do pedido de compra
                    // saber se ESTE contato pode emitir o pedido DESTE veículo.
                    // `commercialTaskLink` FALHA FECHADO quando o `select` não
                    // traz isto — e aqui falhar fechado no vínculo significaria
                    // relaxar o portão justamente para quem PAGA, que é o caso
                    // principal da feature (a Furgões emite o pedido e não é
                    // dona do caminhão).
                    billingEntry: {
                      select: {
                        billing: {
                          select: { customerConfigs: { select: { customerId: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return signers.map(signer => {
      const env = signer.envelope;
      const sections = this.sectionsOf(signer.document);
      const kind = this.ceremonyKindOf(signer.authMethod);
      const tasks = sortQuoteTasks(env.quote?.tasks ?? []);
      const customer = primaryTask(env.quote)?.customer ?? null;

      // ⚠️ O RECORTE, antes de copiar campo nenhum. Ver a nota do tipo acima:
      // série, placa e número do pedido são `VEHICLE`, e quem não a recebeu
      // recebe lista vazia — nunca campos nulos, que seriam a afirmação de que
      // o veículo não tem placa.
      const veVeiculo = hasSection(sections, 'VEHICLE');
      const veiculos = veVeiculo
        ? tasks.map(t => ({
            taskId: t.id,
            name: t.name ?? null,
            label:
              (t.serialNumber || undefined) ??
              (t.truck?.plate || undefined) ??
              (t.name || undefined) ??
              t.id.slice(0, 8),
            serialNumber: t.serialNumber ?? null,
            plate: t.truck?.plate ?? null,
            customerOrderNumber: (t.customerOrderNumber ?? '').trim() || null,
            purchaseOrder: t.purchaseOrder
              ? {
                  id: t.purchaseOrder.id,
                  number: t.purchaseOrder.number,
                  issuedAt: t.purchaseOrder.issuedAt ?? null,
                }
              : null,
          }))
        : [];

      // ⛔ O VEREDITO OLHA `tasks`, NUNCA `veiculos`. O recorte acima esvazia a
      // lista para quem não tem `VEHICLE`, e um portão alimentado pela lista
      // recortada diria "nenhum veículo, nada a cobrar" — liberando por falta de
      // visão o que o servidor recusaria com 403 no ato.
      const gate = purchaseOrderGateVerdict({
        roles: signer.responsible?.roles ?? [],
        vehicles: tasks.map(t => ({
          ...t,
          // (a) PAGADOR ∨ (b) DONO — o MESMO predicado que
          // `POST /cliente/me/pedidos` usa no `where`. Se as duas portas não
          // lessem a mesma regra, o portão cobraria o que a outra recusa.
          canIssuePurchaseOrder:
            commercialTaskLink(t as any, signer.responsible?.companyId ?? null) !== null,
        })),
      });

      return {
        signerId: signer.id,
        status: signer.status,
        ceremony: kind,
        podeAssinarAqui: kind === 'PORTAL',
        envelope: {
          id: env.id,
          budgetId: env.quote.id,
          status: env.status,
          budgetNumber: env.quote.budgetNumber,
          deadlineAt: env.deadlineAt,
          acceptanceClause: env.acceptanceClause,
        },
        documento: {
          id: signer.documentId ?? null,
          sections,
          label: describeSections(sections),
          isFull: isFullSections(sections),
          sha256: signer.document?.originalSha256 ?? env.originalSha256 ?? null,
        },
        // MESMA REGRA DA PÁGINA PÚBLICA: o total segue o recorte. Mandá-lo a
        // quem não recebeu a seção de preços desfaria, numa linha de JSON, a
        // decisão inteira de não lhe mostrar o valor.
        total: hasSection(sections, 'PRICING')
          ? formatCurrencyBRL(Number(env.quote.total))
          : null,
        veiculos,
        pedidoDeCompra: {
          exigido: isSolePurchasingContact(signer.responsible?.roles ?? []),
          pendente: gate.blocked,
          mensagem: gate.message,
        },
        // O TEXTO EXATO que ele vai aceitar, renderizado aqui e não na tela: é
        // ele que será persistido byte a byte em `declarations`, e montá-lo no
        // navegador faria o que foi exibido e o que foi guardado poderem
        // divergir — que é justamente o que este módulo existe para impedir.
        declaracoes:
          kind === 'PORTAL'
            ? this.renderDeclarationsFor({
                kind,
                channel: this.noticeChannelOf(env.signers ?? []),
                sections,
                budgetNumber: env.quote.budgetNumber,
                total: Number(env.quote.total),
                cargo:
                  signer.informedCargo ||
                  fitCargo(formatResponsibleRoles(signer.responsible?.roles ?? [])) ||
                  null,
                company: customer?.corporateName ?? customer?.fantasyName ?? '',
              })
            : [],
      };
    });
  }

  /**
   * O ato: o contato do cliente assina de dentro do Portal do Cliente.
   *
   * É `countersign` do lado do CLIENTE — mesma `assertSignable`, mesma
   * reconferência de frescor no instante do ato, mesma evidência + HMAC —, com
   * três diferenças que valem a leitura:
   *
   *   1. **NENHUM `SigningChallenge` é emitido nem consumido.** A prova de
   *      identidade deste ato é a sessão do portal, que o servidor emitiu e que
   *      não se encaminha. `SigningChallenge.signerId` continua sendo FK dura
   *      para `EnvelopeSigner`, e isso não atrapalha: assinatura por sessão não
   *      cria desafio nenhum.
   *
   *   2. **O signatário é resolvido por `{ id, responsibleId }`**, nunca por
   *      token. Um `findUnique({ id })` seguido de um `if` de conferência daria
   *      o mesmo resultado e abriria um oráculo: "este id existe" e "este id é
   *      meu" responderiam diferente. Com o par no `where`, o signatário de
   *      outra pessoa simplesmente não existe.
   *
   *   3. **O PORTÃO DO PEDIDO DE COMPRA** (§7 do contrato) roda aqui, e só aqui
   *      ele pode rodar: é o único ponto em que se sabe quem assina, o que ele
   *      assina e o que já existe de pedido para cada veículo.
   */
  async signByPortalSession(args: {
    signerId: string;
    /** O principal da sessão do portal. NUNCA um `User`. */
    responsible: {
      id: string;
      sessionId?: string | null;
      name?: string | null;
      roles?: readonly string[] | null;
      companyId?: string | null;
    };
    /** Opcional: cai no CPF do cadastro quando já existe. */
    cpf?: string | null;
    /** Opcional: cai no cargo congelado, e depois nas funções do cadastro. */
    cargo?: string | null;
    acceptedDeclarationKeys: string[];
    clientTimestamp?: string | null;
    geo?: { lat?: number; lon?: number; accuracy?: number | null } | null;
    ctx: RequestContext;
  }): Promise<{ status: EnvelopeSignerStatus; envelopeStatus: EnvelopeStatus }> {
    this.assertCeremonyConfigured();

    // ⚠️ O PAR NO `where`, e não um `findUnique` + `if`. Ver a nota (2) acima.
    const signer = await this.prisma.envelopeSigner.findFirst({
      where: { id: args.signerId, responsibleId: args.responsible.id },
      include: {
        document: true,
        responsible: { select: { id: true, name: true, roles: true, cpf: true, companyId: true } },
        envelope: {
          include: {
            signers: { select: { id: true, orderGroup: true, authMethod: true, status: true } },
            documents: {
              select: { id: true, variantKey: true, sections: true, originalSha256: true },
            },
            quote: {
              include: {
                tasks: {
                  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                  include: {
                    customer: true,
                    truck: true,
                    // O caminho do pagador — mesma razão do `select` da
                    // listagem: sem ele o portão relaxaria para quem PAGA.
                    billingEntry: {
                      select: {
                        billing: {
                          select: { customerConfigs: { select: { customerId: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!signer) {
      throw new NotFoundException(
        'Esta assinatura não existe ou não é sua. Confira a lista de pendências do portal.',
      );
    }
    const env = signer.envelope;

    // ── COLETAS EMITIDAS POR CÓDIGO FICAM DE FORA ────────────────────────────
    //
    // Espelho exato de `countersign`, e pelo MESMO motivo — só que do outro
    // lado. Naquela coleta o documento imprime, no corpo, que o CONTRATANTE se
    // autentica "por código de uso único enviado…", e a declaração que o
    // signatário vai ler afirma posse do canal. Fechá-la por sessão criaria a
    // contradição interna que a v3 destas constantes existiu para consertar: o
    // instrumento descreveria um método que não foi o usado, entregando ao
    // adversário a primeira linha de defesa de graça (MP 2.200-2, art. 10 §2º).
    //
    // A cerimônia é escolhida NA EMISSÃO, antes de os bytes congelarem. Não há
    // conversão depois — o link com código daquela coleta continua valendo, e é
    // para ele que a mensagem manda.
    if (this.ceremonyKindOf(signer.authMethod) !== 'PORTAL') {
      throw new BadRequestException(
        'Esta coleta foi emitida para assinatura por código de uso único. ' +
          'Conclua pelo link que você recebeu — o documento assinado descreve aquele método, ' +
          'e ele não pode ser trocado depois de emitido.',
      );
    }

    // Mesma porta de todos os atos: status, prazo, já-assinou e a ordem.
    await this.assertSignable(env, signer);

    const tasks = sortQuoteTasks(env.quote?.tasks ?? []);
    const roles = signer.responsible?.roles ?? [];

    // ═══════════════════════════════════════════════════════════════════════
    // O PORTÃO DO PEDIDO DE COMPRA — exigência explícita do dono
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Quem tem Compras como ÚNICA função só assina com o número do pedido no
    // veículo. Quem acumula Compras com Comercial/Vendedor/Representante/
    // Coordenador NÃO é barrado — essas quatro recebem o documento inteiro e
    // aprovam o negócio. A regra e a razão moram em `purchase-order-gate.ts`.
    //
    // ⚠️ AQUI, E NÃO NA EMISSÃO. Na emissão o número pode legitimamente não
    // existir ainda (é o próprio Compras que vai emiti-lo, muitas vezes depois
    // de ver o orçamento); no instante do clique ele ou existe ou não existe, e
    // é aí que a cobrança é barata. É a mesma escolha que `countersign` faz com
    // as lacunas de cadastro tardio, com o sinal trocado: lá a ausência é
    // normal e se REGISTRA; aqui ela é o que o dono mandou BARRAR.
    const gate = purchaseOrderGateVerdict({
      roles,
      vehicles: tasks.map(t => ({
        ...t,
        canIssuePurchaseOrder:
          commercialTaskLink(t as any, signer.responsible?.companyId ?? null) !== null,
      })),
    });
    if (gate.blocked) {
      // A mensagem é LITERAL e vem da constante — a tela do portal a reconhece
      // para desenhar o atalho de "informar o pedido" em vez de um toast cru.
      throw new ForbiddenException(gate.message ?? PURCHASE_ORDER_REQUIRED_MESSAGE);
    }

    // As declarações do PORTAL: `reviewed`, `authority`, `method`. `identity`
    // não entra — não há canal a declarar nesta cerimônia —, e `authority` é
    // justamente a que não pode sair (CC art. 118). Ver `declarationsFor`.
    const required = [...declarationKeysFor('PORTAL')];
    const missing = required.filter(k => !args.acceptedDeclarationKeys.includes(k));
    if (missing.length) {
      throw new BadRequestException('É necessário aceitar todas as declarações para assinar.');
    }

    // ── CARGO ────────────────────────────────────────────────────────────────
    //
    // Ordem: o que ele digitou → o congelado no envelope → as funções do
    // cadastro. A terceira fonte é a mesma que a página pública já oferece como
    // `registryCargo`, e `fitCargo` existe porque as nove funções do cadastro
    // passam de 113 caracteres — acima do teto que o próprio schema impõe.
    //
    // Vazio BARRA: `authority` diz "exerço o cargo de {cargo}", e um `{cargo}`
    // que renderiza "—" é uma declaração de poderes sem sujeito.
    const cargo =
      fitCargo((args.cargo ?? '').trim()) ||
      fitCargo(signer.informedCargo ?? '') ||
      fitCargo(formatResponsibleRoles(roles));
    if (!cargo) {
      throw new BadRequestException('Informe seu cargo na empresa antes de assinar.');
    }

    // ── CPF ──────────────────────────────────────────────────────────────────
    //
    // Diferente de `countersign`, aqui o CPF NÃO é dispensável. Lá a identidade
    // do ato é um `User` com vínculo empregatício e a ausência é problema nosso;
    // aqui é o CONTRATANTE que assina, o CPF sai no selo e é ele que amarra a
    // pessoa ao ato (e, com sorte, ao QSA do CNPJ — ver §4.4 do desenho).
    // Aceita-se o do cadastro quando já existe; digitado, tem de CONFERIR.
    const declaredCpf = signer.declaredCpf ? onlyDigits(signer.declaredCpf) : null;
    const informed = onlyDigits(args.cpf ?? '') || declaredCpf || '';
    if (!isCpfWellFormed(informed)) {
      throw new BadRequestException('CPF inválido.');
    }
    const cpfMatch = declaredCpf ? declaredCpf === informed : null;
    if (declaredCpf && !cpfMatch) {
      throw new BadRequestException(
        'Os dígitos do CPF não conferem com o cadastro. Confira ou fale com a Ankaa.',
      );
    }

    // ── GARANTIA DE FRESCOR, no instante do ato ──────────────────────────────
    //
    // Idêntica à dos outros dois caminhos e pelo mesmo motivo: a pergunta "as
    // CONDIÇÕES ainda são as que foram congeladas?" só é juridicamente decisiva
    // agora. Dezenas de caminhos alteram o que o documento exibe e perseguir
    // call site por call site não se sustenta.
    //
    // `actorUserId: null` — não há `User` neste ato, e inventar um gravaria um
    // id de contato numa coluna FK de `User`. É a regra do portal inteiro.
    const fresh = await this.snapshots.buildForQuote(env.quoteId);
    if (fresh && fresh.hash !== env.quoteSnapshotSha256) {
      const invalidated = await this.onQuoteContentChanged(env.quoteId, null);
      if (invalidated) {
        throw new BadRequestException(
          'O orçamento foi alterado desde o envio. Uma nova versão será enviada para sua revisão.',
        );
      }
    }

    const customer = primaryTask(env.quote)?.customer ?? null;
    const sections = this.sectionsOf(signer.document);
    const declarations = this.renderDeclarationsFor({
      kind: 'PORTAL',
      // Irrelevante para o texto do portal (nenhuma declaração dele cita canal),
      // mas passado de verdade e não chutado: `renderDeclarationsFor` é um só
      // lugar para os quatro caminhos, e um valor inventado aqui viraria o
      // primeiro ponto onde os textos podem divergir.
      channel: this.noticeChannelOf(env.signers),
      sections,
      budgetNumber: env.quote.budgetNumber,
      total: Number(env.quote.total),
      cargo,
      company: customer?.corporateName ?? customer?.fantasyName ?? '',
    }).map(d => ({
      ...d,
      acceptedAt: new Date().toISOString(),
      version: DECLARATIONS_VERSION,
    }));

    await this.audit.record(env.id, {
      eventType: 'DECLARATIONS_ACCEPTED',
      actorType: 'SIGNER',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: {
        version: DECLARATIONS_VERSION,
        count: declarations.length,
        ceremony: 'responsible_session',
      },
    });

    const serverTimestamp = new Date();
    const clientSignedAt = this.parseClientTimestamp(args.clientTimestamp);
    const geo = this.normalizeGeo(args.geo);
    const evidence = {
      envelopeId: env.id,
      signerId: signer.id,
      // O documento que ELE assinou — o recorte dele, nunca o do envelope.
      documentId: signer.documentId,
      documentSections: sections,
      documentSha256: signer.document?.originalSha256 ?? env.originalSha256,
      declaredName: signer.declaredName,
      declaredPhone: signer.declaredPhone,
      declaredEmail: signer.declaredEmail,
      informedCpf: informed,
      informedCargo: cargo,
      cpfMatch,
      authMethod: SignatureAuthMethod.RESPONSIBLE_SESSION,
      // ⚠️ A PROVA DE IDENTIDADE DESTE ATO: a sessão do Portal do Cliente — que
      // o servidor emitiu, que é relida do banco a cada requisição e que não se
      // encaminha —, e o contato a que ela pertence. Onde o caminho do código
      // grava `challengeId`, este grava a sessão. Sem um dos dois a evidência
      // não diria COMO a pessoa foi autenticada.
      responsibleId: args.responsible.id,
      portalSessionId: args.responsible.sessionId ?? null,
      responsibleRoles: [...roles],
      // ⚠️ O PORTÃO DO PEDIDO DE COMPRA, quando ele se aplicou.
      //
      // Só quando Compras é a ÚNICA função: é o caso em que a assinatura
      // depende de uma condição externa ao documento, e a prova de que ela
      // estava satisfeita NO INSTANTE DO ATO tem de viajar dentro da evidência
      // — o número pode ser editado depois, e a trilha é o que fixa o que o
      // servidor viu.
      ...(isSolePurchasingContact(roles)
        ? {
            comprasGate: {
              aplicado: true,
              veiculos: tasks.map(t => ({
                taskId: t.id,
                purchaseOrderId: t.purchaseOrderId ?? null,
                numeroDoPedido: (t.customerOrderNumber ?? '').trim() || null,
              })),
            },
          }
        : {}),
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
        informedCpf: informed,
        informedCargo: cargo,
        cpfMatch,
        // Primeira vez: o cadastro não tinha CPF, então o que ele informou passa
        // a SER o declarado deste envelope — a mesma regra de `requestOtp`, sem
        // a qual a conferência acima aceitaria qualquer CPF válido na próxima
        // tentativa.
        ...(declaredCpf ? {} : { declaredCpf: informed }),
        ipAddress: args.ctx.ipAddress,
        userAgent: args.ctx.userAgent,
        geoLat: geo ? new Prisma.Decimal(geo.lat.toFixed(6)) : null,
        geoLon: geo ? new Prisma.Decimal(geo.lon.toFixed(6)) : null,
        geoAccuracyM: geo?.accuracy ? Math.round(geo.accuracy) : null,
        // `responsible_session` e não `gps`/`denied` sozinhos: o campo descreve
        // a PROCEDÊNCIA do ato, e aqui ela é a sessão do portal.
        geoSource: geo ? 'gps' : 'responsible_session',
        declarations: declarations as unknown as Prisma.InputJsonValue,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        evidenceHash,
        hmacSignature,
      },
    });

    if (!declaredCpf) await this.persistCpfToResponsible(signer, informed);

    await this.audit.record(env.id, {
      eventType: 'SIGNATURE_APPLIED',
      actorType: 'SIGNER',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      documentHash: signer.document?.originalSha256 ?? env.originalSha256,
      payload: {
        evidenceHash,
        cargo,
        variant: signer.document?.variantKey ?? null,
        sections,
        ceremony: 'responsible_session',
        portalSessionId: args.responsible.sessionId ?? null,
        ...(isSolePurchasingContact(roles) ? { comprasGate: 'aprovado' } : {}),
      },
    });

    const envelopeStatus = await this.advanceEnvelope(env.id);
    return { status: EnvelopeSignerStatus.SIGNED, envelopeStatus };
  }

  /**
   * A RECUSA PELO PORTAL — o mesmo ato de `refuse`, com a credencial trocada.
   *
   * ⛔ POR QUE ESTA ROTA TEM DE EXISTIR. A cerimônia pública tem
   * `POST /assinatura/publico/:token/recusar`; a do portal não tinha equivalente,
   * e o contato do cliente entrava no Portal e encontrava só o botão de ACEITAR.
   * Num instrumento isso não é simplificação de tela: a recusa é ato jurídico do
   * mesmo peso que a aceitação (CC art. 431 — aceitação fora do prazo ou com
   * modificações importa nova proposta), e quem não pode dizer "não" pelo canal
   * em que foi chamado a dizer "sim" é empurrado para fora do registro. O "não"
   * vira telefonema, e telefonema não entra na trilha encadeada.
   *
   * ⚠️ E CONTINUA VALENDO O QUE `tests/signature-refusal.test.ts` FIXA: recusar
   * NÃO derruba a assinatura de ninguém. Quem já assinou continua `SIGNED`, com o
   * PDF congelado idêntico; a coleta só morre quando não sobra mais ninguém do
   * lado do cliente. Isso mora em `applyRefusal`, que os dois caminhos chamam —
   * é essa partilha que impede as duas recusas de divergirem no primeiro
   * conserto.
   *
   * ⚠️ NÃO EXIGE CPF NEM CARGO, ao contrário do ato de ASSINAR. Lá o CPF entra no
   * SELO e é ele que amarra a pessoa à obrigação que ela assumiu (§4.4 do
   * desenho); aqui não se assume obrigação nenhuma, não se sela documento nenhum,
   * e quem age já está nomeado pela sessão — `responsibleId` e `portalSessionId`
   * vão para a trilha. Cobrar mais para recusar do que para aceitar recriaria, em
   * forma de formulário, a assimetria que esta rota existe para desfazer.
   *
   * ⚠️ RECUSAR A ASSINATURA ≠ RECUSAR O ORÇAMENTO. `PUT /cliente/me/orcamentos/
   * :id/recusar` devolve um orçamento EM NEGOCIAÇÃO ao comercial, antes de
   * existir coleta. Esta aqui é o ato dentro de uma coleta já lançada, e é a
   * única das duas que produz evidência no envelope.
   */
  async refuseByPortalSession(args: {
    signerId: string;
    /** O principal da sessão do portal. NUNCA um `User`. */
    responsible: {
      id: string;
      sessionId?: string | null;
      name?: string | null;
      roles?: readonly string[] | null;
      companyId?: string | null;
    };
    reason: string;
    ctx: RequestContext;
  }): Promise<{ status: EnvelopeSignerStatus; envelopeStatus: EnvelopeStatus }> {
    this.assertCeremonyConfigured();

    // O motivo é OBRIGATÓRIO e aparado aqui TAMBÉM. O zod da borda já o exige; a
    // repetição é a mesma de `refuse`, e existe porque um serviço chamado de
    // outro lugar não pode gravar recusa sem causa — é o motivo que o comercial
    // vai ler para decidir o que fazer com o orçamento.
    const reason = (args.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException('Informe o motivo da recusa.');
    }

    // ⚠️ O PAR NO `where`, exatamente como em `signByPortalSession`: a assinatura
    // de outra pessoa não EXISTE, em vez de existir e ser negada. Um
    // `findUnique({ id })` seguido de `if (signer.responsibleId !== …)` daria o
    // mesmo veredito e abriria um oráculo de ids.
    const signer = await this.prisma.envelopeSigner.findFirst({
      where: { id: args.signerId, responsibleId: args.responsible.id },
      include: { envelope: true },
    });
    if (!signer) {
      throw new NotFoundException(
        'Esta assinatura não existe ou não é sua. Confira a lista de pendências do portal.',
      );
    }
    const env = signer.envelope;

    // ── COLETA EMITIDA POR CÓDIGO FICA DE FORA, como no ato de assinar ───────
    //
    // Mesmo espelho de `signByPortalSession`, e pela mesma razão: a cerimônia é
    // escolhida na EMISSÃO e não se converte depois. Se a coleta daquele
    // signatário se autentica por código, é lá que o ato — aceitar ou recusar —
    // fica provado; registrar aqui uma recusa sem o desafio que aquela cerimônia
    // promete produziria evidência de qualidade menor do que o instrumento
    // descreve.
    if (this.ceremonyKindOf(signer.authMethod) !== 'PORTAL') {
      throw new BadRequestException(
        'Esta coleta foi emitida para assinatura por código de uso único. ' +
          'Registre a recusa pelo link que você recebeu — é lá que ela fica provada.',
      );
    }

    // A MESMA PORTA DE TODOS OS ATOS. Recusar é ato da mesma coleta: envelope
    // terminal, prazo vencido, já ter assinado ou já ter recusado barram os dois
    // sentidos. Um "recusar" que funcionasse onde "assinar" não funciona seria
    // uma segunda régua discordando da primeira.
    await this.assertSignable(env, signer);

    const { envelopeRefused } = await this.applyRefusal({
      env,
      signer,
      reason,
      ctx: args.ctx,
      proof: {
        ceremony: 'responsible_session',
        // A PROVA DE IDENTIDADE DESTE ATO — a mesma que a evidência da
        // assinatura por sessão grava: o contato e a sessão que o servidor
        // emitiu. Onde o caminho do código escreve `challengeId`, este escreve a
        // sessão; sem um dos dois a trilha não diria COMO a pessoa foi
        // autenticada para recusar.
        responsibleId: args.responsible.id,
        portalSessionId: args.responsible.sessionId ?? null,
        responsibleRoles: [...(args.responsible.roles ?? [])],
      },
    });

    // Sem reler o envelope: `applyRefusal` acabou de decidir entre os dois casos,
    // e uma releitura só acrescentaria a janela em que o que se devolve discorda
    // do que se gravou.
    //
    // ⚠️ `RUNNING` aqui é a verdade DESCONFORTÁVEL, e é de propósito que ela
    // apareça: com colegas ainda pendentes, a coleta continua viva e TRAVADA —
    // `advanceEnvelope` conta o `REFUSED` como pendente e a conclusão nunca
    // chega. Quem destrava é o operador, reabrindo o recusante por
    // `resendInvitation` (que exige justamente `RUNNING`). Devolver outra coisa
    // aqui faria a tela do cliente afirmar um desfecho que não houve.
    return {
      status: EnvelopeSignerStatus.REFUSED,
      envelopeStatus: envelopeRefused ? EnvelopeStatus.REFUSED : EnvelopeStatus.RUNNING,
    };
  }

  /**
   * Troca QUEM contra-assina numa coleta ainda em andamento.
   *
   * ⚠️ POR QUE PRECISA EXISTIR
   *   O contra-assinante é congelado na EMISSÃO e a coleta vive semanas. Nesse
   *   intervalo a pessoa sai de férias, adoece ou é desligada — e, desligada,
   *   nem entra no sistema (`auth.guard` recusa quem não está `ACTIVE`). O filtro
   *   de vínculo em `resolveAnkaaSigner` impede que uma coleta NOVA nasça assim;
   *   ele não faz nada pelas que já estão de pé. A liberação para ADMIN (17/09)
   *   garante que alguém consiga apertar o botão, mas o documento continuaria
   *   nomeando o ex-colaborador como representante da empresa.
   *
   * ⚠️ O QUE ESTE MÉTODO NÃO PODE FAZER: reescrever o documento. Os bytes estão
   *   congelados e assinados pelo cliente — a linha de assinatura impressa
   *   continua com o nome de quem foi designado na emissão, e re-renderizar
   *   invalidaria tudo o que já foi colhido.
   *
   *   Então o artefato final vai mostrar as duas coisas, e é assim que fica
   *   honesto: a linha IMPRESSA nomeia o designado original, o SELO nomeia quem
   *   de fato assinou, e a trilha — que viaja dentro do próprio PDF — registra a
   *   substituição com data, ator e hash encadeado. É a mesma solução que o
   *   `executadoPor` da contra-assinatura por administrador adota, e pelo mesmo
   *   motivo: o problema não é alguém assinar no lugar de outro, é isso não
   *   aparecer em lugar nenhum.
   *
   * SÓ ANTES DE ASSINAR. Depois do ato não há o que redesignar — o que existe é
   * uma assinatura aplicada, e ela não se transfere.
   */
  async reassignAnkaaSigner(args: {
    envelopeId: string;
    newUserId: string;
    actorUserId: string;
    ctx: RequestContext;
  }): Promise<{ signerId: string; de: string; para: string; cargo: string }> {
    this.assertCeremonyConfigured();

    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: args.envelopeId },
      select: {
        id: true,
        status: true,
        signers: {
          select: {
            id: true,
            userId: true,
            orderGroup: true,
            status: true,
            authMethod: true,
            declaredName: true,
            informedCargo: true,
          },
        },
      },
    });
    if (!env) throw new NotFoundException('Coleta de assinaturas não encontrada.');
    if (env.status !== EnvelopeStatus.RUNNING) {
      throw new BadRequestException(
        `Esta coleta está em ${env.status}. Só uma coleta em andamento pode ter o ` +
          'contra-assinante redesignado.',
      );
    }

    const ankaa = env.signers.find(
      sig => sig.authMethod === SignatureAuthMethod.INTERNAL_SESSION || sig.orderGroup === 1,
    );
    if (!ankaa) {
      throw new BadRequestException('Esta coleta não tem signatário da Ankaa a redesignar.');
    }
    if (ankaa.status === EnvelopeSignerStatus.SIGNED) {
      throw new BadRequestException(
        `${ankaa.declaredName} já contra-assinou esta coleta. Uma assinatura aplicada não se ` +
          'transfere.',
      );
    }
    if (ankaa.userId === args.newUserId) {
      throw new BadRequestException(`${ankaa.declaredName} já é o contra-assinante desta coleta.`);
    }

    // Vínculo ATIVO, a mesma regra de `resolveAnkaaSigner` — redesignar para
    // alguém desligado só trocaria um impedimento por outro.
    const novo = await this.prisma.user.findFirst({
      where: { id: args.newUserId, ...EMPLOYED_USER_WHERE },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        cpf: true,
        position: { select: { name: true } },
      },
    });
    if (!novo) {
      throw new BadRequestException(
        'O colaborador escolhido não existe ou não tem vínculo ativo — ele não conseguiria ' +
          'sequer entrar no sistema para assinar.',
      );
    }

    const cargo = this.ankaaCargoOf(novo);
    const de = ankaa.declaredName;

    // A TRILHA PRIMEIRO, como em todo ato probatório desta cerimônia: se a prova
    // não puder ser gravada, a troca não acontece. `record` lança (ao contrário
    // de `recordBestEffort`) exatamente para isso.
    await this.audit.record(env.id, {
      eventType: 'CONTACT_CHANGED',
      actorType: 'OPERATOR',
      actorId: args.actorUserId,
      actorLabel: `${de} → ${novo.name}`,
      ipAddress: args.ctx.ipAddress,
      userAgent: args.ctx.userAgent,
      payload: {
        kind: 'ankaa_signer_reassigned',
        de: { userId: ankaa.userId, nome: de, cargo: ankaa.informedCargo ?? null },
        para: { userId: novo.id, nome: novo.name, cargo },
        // ⚠️ O QUE O PAPEL CONTINUA DIZENDO. O documento está congelado e nomeia
        // o designado original na linha de assinatura; quem ler o artefato tem de
        // encontrar, na própria trilha impressa nele, por que o selo diz outro
        // nome.
        nomeImpressoNoDocumento: de,
      },
    });

    await this.prisma.envelopeSigner.update({
      where: { id: ankaa.id },
      data: {
        userId: novo.id,
        declaredName: novo.name,
        declaredPhone: onlyDigits(novo.phone ?? COMPANY.phoneClean) || null,
        declaredEmail: novo.email ?? null,
        declaredCpf: novo.cpf ?? null,
        // O cargo congela junto com a pessoa — é ele que o selo vai imprimir.
        informedCargo: cargo,
      },
    });

    this.logger.log(
      `Contra-assinante do envelope ${env.id} redesignado de ${de} para ${novo.name} por ` +
        `${args.actorUserId}.`,
    );

    return { signerId: ankaa.id, de, para: novo.name, cargo };
  }

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

  /**
   * Recusa o caminho público a quem assina por SESSÃO.
   *
   * O signatário da Ankaa tem token e página como qualquer outro — é assim que
   * ele confere o documento —, mas o ATO dele não pode acontecer ali. Um link
   * pessoal que assinasse sem código seria uma capability de obrigar a empresa
   * viajando por e-mail e por WhatsApp: quem recebesse a mensagem encaminhada, ou
   * qualquer um com acesso à caixa, fecharia o negócio. A segurança do nosso lado
   * é a sessão autenticada — que o servidor emitiu, e que não se encaminha.
   *
   * A mensagem diz ONDE assinar. Um 403 mudo mandaria o diretor abrir um chamado
   * para descobrir que o botão estava na tela ao lado.
   */
  private assertOtpCeremony(signer: { authMethod: SignatureAuthMethod }): void {
    const kind = this.ceremonyKindOf(signer.authMethod);
    if (kind === 'OTP') return;

    // ⚠️ RAMO PRÓPRIO PARA O PORTAL, e não uma mensagem genérica de "não é
    // aqui". O texto diz ONDE assinar, e as duas sessões assinam em lugares
    // diferentes: o diretor, no painel interno; o contato do cliente, no Portal
    // do Cliente. Mandar o cliente "entrar com a sua conta na tela do
    // orçamento" seria mandá-lo a uma tela que ele não pode abrir.
    if (kind === 'PORTAL') {
      throw new ForbiddenException(
        'Esta coleta é assinada dentro do Portal do Cliente, com a sua sessão. ' +
          'Entre no portal, abra o orçamento e conclua por lá. ' +
          'Este link serve apenas para conferir o documento.',
      );
    }

    throw new ForbiddenException(
      'A contra-assinatura da Ankaa é feita dentro do sistema, na tela do orçamento, ' +
        'com a sua conta. Este link serve apenas para conferir o documento.',
    );
  }

  private async assertSignable(
    env: { status: EnvelopeStatus; deadlineAt: Date; sequential?: boolean },
    signer: { status: EnvelopeSignerStatus; orderGroup: number; envelopeId: string },
  ): Promise<void> {
    if (env.status !== EnvelopeStatus.RUNNING) {
      throw new ForbiddenException('Esta coleta de assinaturas não está mais ativa.');
    }
    // ── O PRAZO É O RELÓGIO DO CLIENTE, E SÓ DELE ────────────────────────────
    //
    // `SignatureExpiryScheduler` já afirma isto e age de acordo: um envelope em
    // que TODOS os responsáveis do cliente assinaram continua vivo depois do
    // prazo, "à espera da contra-assinatura da Ankaa". Aqui, porém, o prazo
    // recusava QUALQUER assinatura — inclusive a nossa, que é a única que ainda
    // falta. O resultado era uma trava morta: o cliente aceita no último dia, a
    // Ankaa contra-assina na manhã seguinte e toma 403 para sempre, e a única
    // saída (cancelar e reemitir) joga fora uma aceitação válida.
    //
    // `orderGroup > 0` é o nosso lado. A validade limita a janela em que a
    // PROPOSTA pode ser aceita; aceita ela, o relógio parou e o que falta é
    // burocracia nossa. A ordem sequencial logo abaixo garante que este desvio
    // não abre nada: o grupo 1 só assina depois do grupo 0, e o grupo 0 continua
    // preso ao prazo.
    if (signer.orderGroup === 0 && env.deadlineAt.getTime() < Date.now()) {
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
      // O ORÇAMENTO PASSA A "ASSINADO".
      //
      // Este ramo só é alcançado com `pending.length > 0` — ou seja, sempre há
      // alguém do grupo 1 faltando. Quando NÃO há signatário da Ankaa, o bloco
      // acima já finalizou e o orçamento vai direto a APROVADO, que é o certo:
      // ASSINADO quer dizer "espera por nós", e sem contraparte nossa não há
      // espera nenhuma.
      //
      // SEM `await`, e best-effort, pela mesma razão do aviso à Ankaa logo
      // abaixo: isto roda dentro do POST do CLIENTE, que está com a tela do
      // celular aberta. A assinatura dele já está persistida; o rótulo da nossa
      // lista interna não é motivo para segurar a resposta.
      if (this.onCustomerSideSigned) {
        void this.onCustomerSideSigned(env.quoteId, env.id).catch(error =>
          this.logger.error(
            `Falha ao marcar o orçamento ${env.quoteId} como assinado: ${
              error instanceof Error ? error.message : error
            }`,
          ),
        );
      }

      const ankaa = pending.find(s => s.orderGroup === 1);
      // A guarda é `!signedAt`, e NÃO `!firstViewedAt`.
      //
      // Com `firstViewedAt` o aviso era pulado em silêncio sempre que o
      // signatário da Ankaa tivesse aberto o link ANTES de o cliente assinar —
      // o que é justamente o caso comum, porque o comercial abre o envelope
      // para conferir o documento na hora de emitir. O envelope então ficava
      // parado esperando um clique que ninguém pediu, sem evento de trilha
      // registrando que o convite deixou de ser enviado.
      //
      // Já aconteceu: no envelope 741 o signatário da Ankaa marcou
      // `firstViewedAt` em 29/07, minutos depois da emissão.
      if (ankaa && !ankaa.signedAt) {
        // SEM `await`: isto roda DENTRO do POST de assinatura, com o CLIENTE
        // esperando na tela do celular. O aviso vai para a Ankaa, não para ele —
        // e o transporte de WhatsApp tem ritmo humano (fila com intervalo, mais
        // o ack do servidor), então segurar a resposta dele por causa da nossa
        // mensagem interna é cobrar do cliente um tempo que não é dele.
        //
        // A mudança de estado que importa (assinatura aplicada, grupo 0
        // completo) já está persistida quando este ponto é alcançado; o aviso
        // grava INVITATION_SENT/FAILED na trilha quando o servidor responder.
        void this.notifyAnkaaSigner(env.id, ankaa.id).catch(error =>
          this.logger.error(
            `Falha ao avisar o signatário da Ankaa do envelope ${env.id}: ${
              error instanceof Error ? error.message : error
            }`,
          ),
        );
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

  /**
   * Reexecuta o gancho de CONCLUSÃO de um envelope já concluído e selado.
   *
   * ⚠️ O BURACO QUE ISTO FECHA
   *   `finalize()` chama `onCompleted` dentro de um `try/catch` best-effort que
   *   só LOGA — e tem de ser best-effort mesmo: assinaturas já coletadas e
   *   seladas não podem ser desfeitas porque a aprovação do orçamento falhou.
   *   Só que, falhando, não havia NENHUM caminho de volta. `retryFinalize`
   *   recusa ("já tem o documento final emitido"), `cancel` recusa (só aceita
   *   RUNNING), e nenhuma outra rota tocava no gancho. O orçamento ficava
   *   PENDING com um contrato assinado e selado em cima dele, para sempre.
   *
   *   Medido: o orçamento nº 591 tem três envelopes concluídos e selados, todos
   *   com o orçamento em PENDING. A causa foi o portão de layout — que agora
   *   mora na EMISSÃO (ver `createEnvelope`) —, mas a causa é o de menos: o
   *   gancho depende de rede, de outro domínio e de regras que mudam, e um
   *   caminho de reexecução tem de existir independentemente de qual delas
   *   falhou.
   *
   * IDEMPOTENTE. O gancho pode ser chamado quantas vezes for preciso: quando o
   * orçamento já está aprovado, o método sai dizendo que não havia o que fazer,
   * sem disparar notificação nem escrever changelog de novo.
   *
   * NÃO TOCA NO DOCUMENTO. Nada é re-selado, re-montado ou re-hasheado — o
   * artefato já existe e é imutável. O que roda é só o efeito de DOMÍNIO que
   * deveria ter rodado no momento da conclusão.
   */
  async replayCompletion(
    envelopeId: string,
    actorUserId: string,
  ): Promise<{ executado: boolean; motivo: string | null }> {
    this.assertCeremonyConfigured();

    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      select: {
        id: true,
        status: true,
        finalFileId: true,
        quoteId: true,
        createdById: true,
        quote: { select: { status: true, budgetNumber: true } },
      },
    });
    if (!env) throw new NotFoundException('Envelope não encontrado.');

    if (env.status !== EnvelopeStatus.COMPLETED) {
      throw new BadRequestException(
        `Esta coleta está em ${env.status}. A aprovação do orçamento só é disparada por uma ` +
          'coleta CONCLUÍDA.',
      );
    }
    // Conclusão sem artefato é a reivindicação interrompida que
    // `releaseFinalizationClaim` desfaz — ali o caminho é `retry-finalize`, que
    // MONTA o documento, e não este, que só reexecuta o efeito posterior.
    if (!env.finalFileId) {
      throw new BadRequestException(
        'Esta coleta está marcada como concluída mas não tem documento final emitido. ' +
          'Use "Reprocessar emissão" antes.',
      );
    }
    if (!this.onCompleted) {
      throw new ServiceUnavailableException(
        'O módulo de orçamento não está registrado nesta instância — não há gancho de ' +
          'conclusão a reexecutar.',
      );
    }

    // A ÚNICA pergunta que este método faz ao domínio de orçamento, e ela existe
    // para distinguir "não havia o que fazer" de "falhou". Sem ela, reexecutar
    // um gancho já executado devolveria o 400 de transição inválida ("O status
    // já é Aprovado") — tecnicamente inofensivo, e ilegível para quem apertou um
    // botão chamado "Reexecutar aprovação".
    if (env.quote?.status === 'APPROVED') {
      return {
        executado: false,
        motivo: `O orçamento nº ${env.quote.budgetNumber} já está aprovado. Nada a reexecutar.`,
      };
    }

    // O ATOR ORIGINAL, não quem apertou o botão agora: a aprovação pertence a
    // quem emitiu a coleta, e é o nome dele que o changelog do orçamento tem de
    // registrar — do mesmo modo que `finalize` passa `env.createdById`. Quem
    // reexecutou fica no log, que é onde a operação de recuperação pertence.
    await this.onCompleted(env.quoteId, env.id, env.createdById ?? actorUserId);

    this.logger.log(
      `Gancho de conclusão do envelope ${envelopeId} (orçamento nº ${env.quote?.budgetNumber}) ` +
        `reexecutado por ${actorUserId}.`,
    );
    return { executado: true, motivo: null };
  }

  /**
   * Avisa o lado da Ankaa de que o cliente terminou.
   *
   * É AVISO, e não convite: a ação vive no painel do orçamento, atrás do login, e
   * acontece com ou sem esta mensagem. Por isso o link aponta para a tela interna
   * e não para o token do signatário — ver `AnkaaNoticeEmailData.quoteUrl`.
   *
   * Best-effort de ponta a ponta: um representante sem e-mail nem telefone no
   * cadastro não impede mais nada, porque não há nada que dependa da mensagem
   * chegar. A trilha registra que não saiu, que é o que permite corrigir.
   */
  private async notifyAnkaaSigner(envelopeId: string, signerId: string): Promise<void> {
    const signer = await this.prisma.envelopeSigner.findUnique({
      where: { id: signerId },
      include: {
        envelope: {
          include: {
            quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true } } } },
            signers: { select: { orderGroup: true, authMethod: true, status: true } },
          },
        },
      },
    });
    if (!signer) return;
    // O canal da COLETA, lido do lado do cliente: o `authMethod` da Ankaa virou
    // `INTERNAL_SESSION` e não descreve canal nenhum. Ver `noticeChannelOf`.
    const channel = this.noticeChannelOf(signer.envelope.signers);
    const quoteUrl = this.internalQuoteUrl(primaryTask(signer.envelope.quote)?.id ?? null);
    const signedCount = signer.envelope.signers.filter(
      s => s.orderGroup === 0 && s.status === EnvelopeSignerStatus.SIGNED,
    ).length;

    const payload = {
      signerName: signer.declaredName,
      budgetNumber: signer.envelope.quote.budgetNumber,
      quoteUrl,
      signedCount,
    };

    const delivery = await this.deliverToSigner({
      signer,
      channel,
      email: generateAnkaaCountersignEmail(payload),
      whatsapp: generateAnkaaCountersignWhatsApp(payload),
      whatsappPreview: this.signingLinkPreview(
        signer.envelope.quote.budgetNumber,
        quoteUrl,
        'countersign',
      ),
      // Pelo número OFICIAL quando a Cloud API está ligada. O aviso é INTERNO e
      // por isso vivia no Baileys — mas a decisão do dono (17/09) é que TUDO sai
      // pela Meta, e um aviso que depende de uma sessão não oficial de pé é um
      // aviso que some justamente no dia em que ela cai. Sem a Cloud API,
      // `sendWhatsApp` continua caindo no texto livre acima.
      whatsappTemplate: ankaaCountersignTemplate({
        signerName: signer.declaredName,
        budgetNumber: signer.envelope.quote.budgetNumber,
        quoteTaskId: this.internalQuoteButtonParam(
          primaryTask(signer.envelope.quote)?.id ?? null,
          signer.envelope.quoteId,
        ),
      }),
      kind: 'SIGNATURE_ANKAA_NOTICE',
    });

    await this.audit.recordBestEffort(envelopeId, {
      eventType: delivery.ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
      actorType: 'SYSTEM',
      actorId: signerId,
      actorLabel: signer.declaredName,
      payload: {
        stage: 'ankaa',
        // O aviso não autentica ninguém — quem autentica é a sessão. A trilha
        // diz isso explicitamente para que ninguém leia este INVITATION_SENT
        // como "foi enviado um convite de assinatura".
        kind: 'countersign_notice',
        channel: auditChannelOf(channel),
        destination: this.maskContactFor(signer, channel),
        ...(delivery.reason ? { failureReason: delivery.reason } : {}),
      },
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
        // Um artefato por RECORTE. `originalFile` de cada um é o que foi
        // assinado por quem está amarrado a ele — nunca o do envelope, que é
        // sempre o documento completo.
        documents: {
          orderBy: [{ isFull: 'desc' }, { variantKey: 'asc' }],
          include: { originalFile: true },
        },
        // (documents já traz finalFileId/finalSha256/padesLevel por ser include
        // de modelo inteiro — é o que a guarda de reentrância abaixo lê.)
        // `truck` entra por causa das lacunas de cadastro tardio: é na selagem
        // que se pergunta ao cadastro o que já chegou desde a emissão.
        quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { customer: true, truck: true } } } },
        originalFile: true,
      },
    });
    if (!env) throw new NotFoundException('Envelope não encontrado.');

    const { readFileSync } = await import('fs');

    // Envelope anterior a este recurso não tem `documents`. Trata-se o próprio
    // envelope como o recorte completo: são exatamente os bytes que aquelas
    // coletas congelaram, e a migração já criou a linha — este recuo existe para
    // o caso de um envelope escapar dela (restauração parcial de backup,
    // ambiente de teste), e não para operação normal.
    const documents = env.documents.length
      ? env.documents
      : [
          {
            id: null as string | null,
            isFull: true,
            variantKey: variantKeyOf([...FULL_SECTIONS]),
            sections: [...FULL_SECTIONS] as string[],
            originalFileId: env.originalFileId,
            originalSha256: env.originalSha256,
            anchors: env.anchors,
            lateSlots: env.lateSlots,
            originalFile: env.originalFile,
            // Sempre nulo aqui: este ramo só existe quando NÃO há linha em
            // `EnvelopeDocument`, e a guarda de reentrância abaixo tem de ler
            // "ainda não selado" para que a selagem aconteça.
            finalFileId: null as string | null,
            finalSha256: null as string | null,
            padesLevel: null as string | null,
          },
        ];

    // ---- Guardas que valem para a SELAGEM INTEIRA, antes de tocar em bytes ---
    //
    // Elas decidem se este envelope pode virar artefato. Rodá-las por recorte
    // seria pior de duas formas: repetiria a leitura do grafo do orçamento N
    // vezes, e — pior — permitiria selar três recortes e abortar no quarto,
    // deixando um envelope metade selado que nenhum estado do sistema descreve.
    for (const doc of documents) {
      const onDiskHash = sha256Hex(readFileSync(doc.originalFile.path));
      if (onDiskHash !== doc.originalSha256) {
        await this.audit.record(envelopeId, {
          eventType: 'PADES_FAILED',
          actorType: 'SYSTEM',
          payload: {
            reason: 'original_hash_mismatch',
            variant: doc.variantKey,
            onDisk: onDiskHash,
          },
        });
        throw new BadRequestException(
          'O documento original em disco não confere com o hash registrado ' +
            `(recorte "${describeSections(this.sectionsOf(doc))}"). Selagem abortada.`,
        );
      }
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
    // Na selagem, por construção, todo mundo já assinou — a lista sai vazia e
    // qualquer mexida no elenco é tolerada. É o resultado certo: o documento
    // está prestes a ser selado com as assinaturas que tem, e nenhuma alteração
    // de cadastro pode acrescentar ou tirar uma linha dele.
    const pendingSignerIds = env.signers
      .filter(sig => !sig.signedAt)
      .map(sig => sig.responsibleId)
      .filter((id): id is string => !!id);

    const sealTermsUnchanged =
      !!freshAtSeal &&
      this.snapshots.matchesFrozenTerms(
        freshAtSeal.snapshot,
        frozenTermsAtSeal,
        env.quoteSnapshot as unknown as QuoteSnapshot,
        pendingSignerIds,
      ) !== null;

    if (freshAtSeal && freshAtSeal.hash !== env.quoteSnapshotSha256 && sealTermsUnchanged) {
      // Deriva cosmética às vésperas do selo: o PDF em disco é o mesmo, o hash
      // do arquivo confere (a guarda acima já verificou) e as condições não se
      // moveram. Registra e SELA — abortar aqui deixaria um envelope com todas
      // as assinaturas colhidas e nenhum artefato, por causa de um typo.
      const cosmetic = this.snapshots.classify(
        env.quoteSnapshot as unknown as QuoteSnapshot,
        freshAtSeal.snapshot,
        { pendingSignerIds },
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

    const customer = primaryTask(env.quote)?.customer ?? null;
    const companyLabel = customer?.corporateName ?? customer?.fantasyName ?? null;
    const verificationUrl = this.verificationUrl(env.verificationCode);

    // A trilha é do ENVELOPE, não do recorte: ela narra a cerimônia inteira, e
    // recortá-la por documento produziria artefatos que contam meia história e
    // cuja cadeia de hash pareceria ter buracos. O que É por recorte é o ROSTER
    // impresso: cada artefato lista as partes DAQUELE documento, porque afirmar
    // que alguém assinou um papel que ele nunca viu é o único erro que este
    // recurso poderia introduzir na peça probatória.
    const events = await this.audit.getTrail(envelopeId);
    const chainTip = await this.audit.getChainTip(envelopeId);

    // Os valores que carimbam as lacunas, veículo a veículo — nas duas formas de
    // chave, para que envelopes anteriores a esta feature continuem sendo
    // carimbados. Ver `buildLateValueMap`.
    const lateValues = buildLateValueMap(
      sortQuoteTasks(env.quote.tasks ?? []).map(t => ({
        taskId: t.id,
        serialNumber: t.serialNumber ?? null,
        plate: t.truck?.plate ?? null,
        chassis: t.truck?.chassisNumber ?? null,
      })),
    );

    const sealed: Array<{
      documentId: string | null;
      isFull: boolean;
      variantKey: string;
      sections: QuoteSection[];
      finalFileId: string;
      finalSha256: string;
      padesLevel: string | null;
      certMeta: Record<string, unknown>;
    }> = [];

    for (const doc of documents) {
      const docSections = this.sectionsOf(doc);

      // RECORTE JÁ SELADO fica como está. Uma falha no meio do laço (rede da TSA
      // no terceiro recorte, disco cheio) deixa os anteriores prontos, e o
      // `retryFinalize` reentra aqui: re-selar produziria um SEGUNDO artefato,
      // com hash diferente, para um documento que já tem o seu — e a evidência
      // passaria a ter duas respostas para "qual PDF o financeiro assinou".
      if (doc.id && (doc as { finalFileId?: string | null }).finalFileId) {
        const already = doc as {
          finalFileId: string;
          finalSha256: string | null;
          padesLevel: string | null;
        };
        this.logger.log(
          `Recorte ${doc.variantKey} do envelope ${envelopeId} já estava selado; preservado.`,
        );
        sealed.push({
          documentId: doc.id,
          isFull: doc.isFull,
          variantKey: doc.variantKey,
          sections: docSections,
          finalFileId: already.finalFileId,
          finalSha256: already.finalSha256 ?? '',
          padesLevel: already.padesLevel,
          certMeta: {},
        });
        continue;
      }

      const originalPdf = readFileSync(doc.originalFile.path);
      const anchors = (doc.anchors ?? {}) as Record<string, unknown>;

      // QUEM tem selo NESTE pdf: quem tem âncora nele. A âncora é o retângulo
      // medido no render, então esta é a definição operacional exata de "esta
      // pessoa tem uma linha de assinatura nesta folha" — e é o que faz o
      // signatário da Ankaa, que tem um registro só e âncora em todos os
      // recortes, receber o selo em cada um deles a partir de um único ato.
      const docSigners = env.signers.filter(s => Object.prototype.hasOwnProperty.call(anchors, s.id));

      const assemblerSigners: AssemblerSigner[] = docSigners.map(s => ({
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

      const stamped = await this.assembler.stampSeals({
        originalPdf,
        anchors: anchors as any,
        signers: assemblerSigners,
        budgetNumber: env.quote.budgetNumber,
        verificationCode: env.verificationCode,
        verificationUrl,
        originalSha256: doc.originalSha256,
        // O que o cadastro tem AGORA, contra o espaço reservado na emissão. O
        // montador só preenche lacuna vazia, então um valor que já estava impresso
        // no documento congelado não é tocado. Recorte sem a seção do veículo não
        // tem lacuna nenhuma medida, e aí não há o que carimbar.
        lateSlots: (doc.lateSlots as any) ?? null,
        lateValues,
      });

      const auditPages = await this.assembler.buildAuditPages({
        originalPdf,
        anchors: anchors as any,
        signers: assemblerSigners,
        events: events.map(e => ({
          sequence: e.sequence,
          occurredAt: e.occurredAt,
          description: EVENT_DESCRIPTIONS[e.eventType] ?? e.eventType,
          ipAddress: e.ipAddress,
          hash: e.hash,
          // O QUE mudou, e não só que mudou. Ver `AssemblerAuditEvent.detail`:
          // é aqui que "Placa do veículo: — → ABB8468" entra no artefato, já que
          // o corpo do documento está congelado desde antes de a placa existir.
          //
          detail: eventDetailOf(e.eventType, e.payload),
        })),
        budgetNumber: env.quote.budgetNumber,
        envelopeId: env.id,
        verificationCode: env.verificationCode,
        verificationUrl,
        originalSha256: doc.originalSha256,
        chainTip,
        acceptanceClause: env.acceptanceClause,
        // O que ESTE artefato reproduz. Num envelope de recorte único isto some
        // da página — não há recorte a explicar, e anunciá-lo faria o documento
        // de sempre parecer parcial.
        variantLabel: documents.length > 1 ? describeSections(docSections) : null,
      });

      let finalPdf = await this.assembler.mergeWithAudit(stamped, auditPages);

      await this.audit.record(envelopeId, {
        eventType: 'DOCUMENT_ASSEMBLED',
        actorType: 'SYSTEM',
        payload: { bytes: finalPdf.length, variant: doc.variantKey },
      });

      // ---- Selo PAdES (último passo de cada recorte) ----
      //
      // Um selo por artefato, e não um para todos: a assinatura PAdES cobre os
      // bytes de UM arquivo. Cada recorte é um arquivo diferente, então cada um
      // precisa do seu — é o mesmo motivo pelo qual o dossiê anexa o assinado em
      // vez de remontá-lo.
      let padesLevel: string | null = null;
      let certMeta: Record<string, unknown> = {};
      if (this.pades.isEnabled()) {
        try {
          const sealedPdf = await this.pades.sealPdf(finalPdf, {
            reason:
              `Orçamento nº ${env.quote.budgetNumber} — envelope ${env.verificationCode}` +
              (documents.length > 1 ? ` — ${describeSections(docSections)}` : ''),
            location: COMPANY.signatureLocation,
            signerName: this.pades.getCertMetadata()?.subjectCommonName ?? COMPANY.corporateName,
            contactInfo: COMPANY.email,
          });
          finalPdf = sealedPdf.signedPdf;
          padesLevel = sealedPdf.level;
          certMeta = {
            certSubject: sealedPdf.cert.subject,
            certIssuer: sealedPdf.cert.issuer,
            certSerialNumber: sealedPdf.cert.serialNumber,
            certCnpj: sealedPdf.cert.cnpj,
            certNotAfter: sealedPdf.cert.notAfter,
            tsaUrl: sealedPdf.tsaUrl,
            tsaGenTime: sealedPdf.tsaGenTime,
          };
          await this.audit.record(envelopeId, {
            eventType: 'PADES_SEALED',
            actorType: 'SYSTEM',
            payload: {
              level: sealedPdf.level,
              serial: sealedPdf.cert.serialNumber,
              variant: doc.variantKey,
            },
          });
          if (sealedPdf.level === 'B-T') {
            await this.audit.record(envelopeId, {
              eventType: 'TSA_STAMPED',
              actorType: 'SYSTEM',
              payload: {
                tsa: sealedPdf.tsaUrl ?? '',
                genTime: sealedPdf.tsaGenTime?.toISOString() ?? '',
                variant: doc.variantKey,
              },
            });
          } else if (sealedPdf.tsaError) {
            await this.audit.record(envelopeId, {
              eventType: 'TSA_FAILED',
              actorType: 'SYSTEM',
              payload: { error: sealedPdf.tsaError, variant: doc.variantKey },
            });
          }
        } catch (error) {
          this.logger.error(
            `Falha ao selar o recorte ${doc.variantKey} do envelope ${envelopeId}: ${
              error instanceof Error ? error.message : error
            }`,
          );
          await this.audit.record(envelopeId, {
            eventType: 'PADES_FAILED',
            actorType: 'SYSTEM',
            payload: {
              error: error instanceof Error ? error.message : String(error),
              variant: doc.variantKey,
            },
          });
        }
      }

      const finalSha256 = sha256Hex(finalPdf);
      const finalFileId = await this.persistPdf(
        env.quote as any,
        finalPdf,
        `assinado${variantFilenameSuffix(docSections)}`,
        env.verificationCode,
      );

      if (doc.id) {
        await this.prisma.envelopeDocument.update({
          where: { id: doc.id },
          data: {
            finalFileId,
            finalSha256,
            sealedAt: padesLevel ? new Date() : null,
            padesLevel,
            ...certMeta,
          },
        });
      }

      sealed.push({
        documentId: doc.id,
        isFull: doc.isFull,
        variantKey: doc.variantKey,
        sections: docSections,
        finalFileId,
        finalSha256,
        padesLevel,
        certMeta,
      });
    }

    // As colunas do envelope ESPELHAM o recorte completo. Ver a nota no schema:
    // "o documento do envelope" tem uma resposta certa para todo leitor de fora
    // da cerimônia, e é o instrumento inteiro.
    const fullSealed = sealed.find(x => x.isFull) ?? sealed[0];
    await this.prisma.signatureEnvelope.update({
      where: { id: envelopeId },
      data: {
        status: EnvelopeStatus.COMPLETED,
        completedAt: new Date(),
        finalFileId: fullSealed.finalFileId,
        finalSha256: fullSealed.finalSha256,
        sealedAt: fullSealed.padesLevel ? new Date() : null,
        padesLevel: fullSealed.padesLevel,
        ...fullSealed.certMeta,
      },
    });

    await this.audit.record(envelopeId, {
      eventType: 'DOCUMENT_FINALIZED',
      actorType: 'SYSTEM',
      documentHash: fullSealed.finalSha256,
      payload: {
        padesLevel: fullSealed.padesLevel ?? 'none',
        documents: sealed.map(x => ({
          variant: x.variantKey,
          sections: x.sections,
          sha256: x.finalSha256,
          padesLevel: x.padesLevel ?? 'none',
        })),
      },
    });

    // Congela o dossiê AGORA, ao lado dos PDFs selados.
    //
    // Enquanto o envelope está aberto o dossiê é montado sob demanda, e tem de continuar
    // sendo: ele muda a cada assinatura coletada, e um arquivo salvo no meio do caminho
    // seria uma foto desatualizada. No selamento o conteúdo para de mudar — é aí que ele
    // vira artefato.
    //
    // Best-effort, igual ao `onCompleted` abaixo: assinaturas já coletadas e seladas não
    // podem ser desfeitas porque a montagem do dossiê falhou (ele depende de NFS-e na
    // Elotech e de boleto no Sicredi, que são rede). Se falhar, o endpoint sob demanda
    // continua entregando — não se perde capacidade, só o congelamento.
    try {
      const dossier = await this.dossiers.build(env.quoteId, { attachSigned: true });
      const dossierFileId = await this.persistPdf(
        env.quote as any,
        dossier.pdf,
        'dossie',
        env.verificationCode,
      );
      await this.prisma.signatureEnvelope.update({
        where: { id: envelopeId },
        data: { dossierFileId },
      });
      // Mesmo critério do header X-Dossie-Incompleto no controller.
      const faltando = dossier.components.filter(c => !c.included).length;
      if (faltando) {
        this.logger.warn(
          `Dossiê do envelope ${envelopeId} congelado INCOMPLETO (${faltando} componente(s) ` +
            `ausente(s)). O endpoint sob demanda remonta com o que existir depois.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Envelope ${envelopeId} concluído, mas o dossiê não pôde ser congelado: ${
          error instanceof Error ? error.message : error
        }. Segue disponível sob demanda.`,
      );
    }

    // A assinatura do cliente É a aprovação do orçamento. Roteia pelo
    // `budgetApprove()` do domínio, e não por uma escrita direta de status, para
    // que o gate de layout, o dispatch de `task_quote.budget_approved` e o
    // `syncEmNegociacaoForTask` continuem valendo. Best-effort: um erro aqui não
    // pode desfazer assinaturas já coletadas e seladas.
    if (this.onCompleted) {
      try {
        await this.onCompleted(env.quoteId, envelopeId, env.createdById);
      } catch (error) {
        // ⚠️ AQUI O ORÇAMENTO FICA PARA TRÁS DO DOCUMENTO — e agora há saída.
        //
        // Até 17/09 esta linha era o fim: o contrato ficava assinado e selado
        // com o orçamento em PENDING, e nenhuma rota reexecutava o gancho. A
        // saída é `replayCompletion` (POST :id/reexecutar-conclusao), e a
        // mensagem tem de dizê-lo — um erro que descreve o problema sem dizer o
        // que fazer produz um chamado, não um conserto.
        this.logger.error(
          `Envelope ${envelopeId} (orçamento nº ${env.quote.budgetNumber}) foi CONCLUÍDO e ` +
            `SELADO, mas a aprovação do orçamento falhou: ${
              error instanceof Error ? error.message : error
            }. O documento está íntegro; corrija a causa e reexecute a aprovação em ` +
            `POST /signature-envelopes/${envelopeId}/reexecutar-conclusao.`,
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
  /**
   * Diferenças entre o snapshot congelado de cada envelope e o orçamento de hoje.
   *
   * TAMBÉM GRAVA A DERIVA, e isso é o conserto de um buraco real.
   *
   *   `onQuoteContentChanged` — o gancho que registra `SNAPSHOT_DRIFTED` — é
   *   chamado de UM lugar: `BudgetService.update`. Mas placa e chassi são
   *   escritos por `PUT /tasks/:id` (escrita aninhada em `truck`), que não passa
   *   por ali. Resultado medido no orçamento nº 945: a tela mostrava as duas
   *   alterações porque as calcula ao vivo, e a trilha do documento não tinha
   *   uma linha sequer sobre elas. O dado existia na memória de quem estava
   *   olhando a tela, e em lugar nenhum do artefato.
   *
   *   Gravar aqui fecha o buraco por CÁLCULO em vez de por cobertura de ganchos:
   *   qualquer caminho de escrita que mude o documento é notado na primeira vez
   *   que alguém observa o envelope. `recordDriftOnce` deduplica por hash do
   *   snapshot, então um estado gera no máximo uma linha, por mais que a tela
   *   recarregue.
   *
   * Só deriva COSMÉTICA. A material tem caminho próprio (invalidação, com evento
   * próprio) e registrá-la aqui duplicaria a mesma notícia com outro nome.
   */
  private async changesSinceFrozen(
    quoteId: string,
    envelopes: Array<{
      id: string;
      quoteSnapshot: unknown;
      quoteSnapshotSha256: string;
      status?: EnvelopeStatus | string;
    }>,
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

    // Quem, em cada envelope, ainda não assinou. É esta lista que decide a
    // GRAVIDADE das mudanças de elenco (ver `QuoteDiffOptions.pendingSignerIds`),
    // e sem ela a tela mostraria "responsável incluído" como alteração material
    // — alarme de invalidação sobre algo que não invalida nada.
    //
    // Uma consulta só para todos os envelopes: esta função roda no caminho de
    // leitura do painel, que já paga uma releitura do grafo do orçamento.
    const pendingByEnvelope = new Map<string, string[]>();
    try {
      const pendingRows = await this.prisma.envelopeSigner.findMany({
        where: {
          envelopeId: { in: envelopes.map(e => e.id) },
          signedAt: null,
          responsibleId: { not: null },
        },
        select: { envelopeId: true, responsibleId: true },
      });
      for (const row of pendingRows) {
        const list = pendingByEnvelope.get(row.envelopeId) ?? [];
        list.push(row.responsibleId!);
        pendingByEnvelope.set(row.envelopeId, list);
      }
    } catch (error) {
      this.logger.warn(
        `Não foi possível ler os signatários pendentes: ${
          error instanceof Error ? error.message : error
        }. O diff sai com a gravidade estrita.`,
      );
    }

    for (const env of envelopes) {
      // Atalho: hash igual ⇒ nada no documento mudou, nem cosmético.
      if (env.quoteSnapshotSha256 === fresh.hash) {
        out.set(env.id, []);
        continue;
      }
      try {
        const changes = this.snapshots.changes(
          env.quoteSnapshot as QuoteSnapshot,
          fresh.snapshot,
          // `?? []` e não `undefined`: um envelope sem NENHUM signatário
          // pendente é o caso concluído, e ali a resposta certa é "nada no
          // elenco pode mais estragar coisa alguma". `undefined` significaria
          // "não sei", que cairia na gravidade estrita e voltaria a alarmar.
          { pendingSignerIds: pendingByEnvelope.get(env.id) ?? [] },
        );
        out.set(env.id, changes);

        // Só onde o registro vale alguma coisa: coleta viva ou documento já
        // selado. Numa coleta cancelada ou substituída a deriva não tem
        // consequência, e a linha só engordaria a trilha.
        const worthRecording =
          env.status === EnvelopeStatus.RUNNING || env.status === EnvelopeStatus.COMPLETED;

        if (worthRecording && changes.length && changes.every(c => c.severity !== 'MATERIAL')) {
          // `void`: isto é o caminho de LEITURA de uma tela. Uma falha ao gravar
          // a trilha não pode derrubar a listagem do envelope.
          void this.recordDriftOnce(
            env.id,
            fresh.hash,
            changes.map(c => `${c.label}: ${c.before || '—'} → ${c.after || '—'}`),
            null,
          ).catch(() => undefined);
        }
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
    // ⚠️ COLETA CONCLUÍDA TAMBÉM ENTRA AQUI, e essa é a correção de 17/09/2026.
    //
    // O `where` era `status: RUNNING` e só. Uma alteração MATERIAL num orçamento
    // já assinado e selado não produzia nada: nem invalidação, nem sequer linha
    // de deriva — `diffEnvelopes` só registra deriva quando NENHUMA mudança é
    // material, então justamente a mudança que importa saía sem rastro.
    //
    // O incidente: 17/09/2026 12:47, o comercial trocou o layout do orçamento
    // nº 973, assinado e selado em 08/09. A imagem que o cliente aprovou deixou
    // de ser a que o sistema guarda, o envelope continuou CONCLUÍDO — e, porque
    // `createEnvelope` recusa emitir sobre uma coleta concluída, não havia como
    // recolher a assinatura do layout novo. O documento e o cadastro divergiam,
    // em silêncio e sem saída.
    //
    // Concluída é o SEGUNDO lugar procurado, não o primeiro: com uma coleta viva
    // é ela que governa, e tratar as duas juntas faria uma reemissão pendente
    // derrubar o contrato anterior por tabela. Só existe uma de cada por
    // orçamento (`createEnvelope` recusa a segunda), então a busca é determinada.
    //
    // As TOLERÂNCIAS seguem valendo sem uma linha de mudança, e são elas que
    // tornam isto seguro: `matchesFrozenTerms` continua aceitando o cadastro
    // tardio do veículo (chassi e placa que chegam depois — é para isso que
    // existe o aditivo) e o elenco de signatários já resolvido. Só a divergência
    // MATERIAL chega ao ponto de invalidar.
    const running =
      (await this.prisma.signatureEnvelope.findFirst({
        where: { quoteId, status: EnvelopeStatus.RUNNING },
        // `quote` entra aqui porque o aviso de invalidação identifica o orçamento
        // pelo número; sem o include ele sairia com um travessão no lugar.
        include: { signers: true, quote: true },
      })) ??
      (await this.prisma.signatureEnvelope.findFirst({
        where: { quoteId, status: EnvelopeStatus.COMPLETED },
        orderBy: { version: 'desc' },
        include: { signers: true, quote: true },
      }));
    if (!running) return false;

    const loaded = await this.snapshots.buildForQuote(quoteId);
    if (!loaded) return false;

    // Atalho barato: nada no documento mudou, nem cosmético nem material.
    if (loaded.hash === running.quoteSnapshotSha256) return false;

    const before = running.quoteSnapshot as any;
    // Quem AINDA NÃO assinou. É esta lista que decide o que derruba a coleta:
    // só uma mexida em quem tem assinatura pendente pode estragar um ato que
    // ainda não foi colhido. Ver `tolerateSettledRoster`.
    const pendingSignerIds = running.signers
      .filter(sig => !sig.signedAt)
      .map(sig => sig.responsibleId)
      .filter((id): id is string => !!id);
    const changes = this.snapshots.classify(before, loaded.snapshot, { pendingSignerIds });

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
    const matchedVersion = this.snapshots.matchesFrozenTerms(
      loaded.snapshot,
      frozenTermsHash,
      // O congelado entra por causa do cadastro tardio do veículo: chassi e
      // placa preenchidos DEPOIS da emissão não podem derrubar a coleta. Ver
      // `tolerateLateRegistration`.
      before as QuoteSnapshot,
      // E o elenco PENDENTE, por causa de quem já resolveu: acrescentar um
      // responsável à tarefa não pode anular a assinatura que o comercial do
      // cliente já deu. Ver `tolerateSettledRoster`.
      pendingSignerIds,
    );

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
      // E se o que mudou foi a VALIDADE para mais longe, o envelope tem de
      // aprender a data nova — senão o gesto de dar mais prazo não daria prazo
      // nenhum: o relógio que barra a assinatura é `deadlineAt`, e ele continuaria
      // no dia de ontem. Ver `tolerateExtendedValidity`.
      await this.propagateExtendedDeadline(running, loaded.snapshot.expiresAt, actorUserId);
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

    // ── O ORÇAMENTO VOLTA PARA PENDENTE ─────────────────────────────────────
    //
    // AWAIT, ao contrário do aviso logo abaixo. O status é ESTADO do orçamento,
    // e quem acabou de salvar precisa receber a resposta já com ele — um
    // `void` aqui devolveria "Aprovado" para a tela e a corrigiria no próximo
    // refresh, que é como se descobre um bug em vez de uma regra.
    //
    // Envolvido porque não pode desfazer o que já está gravado: quando esta
    // linha começa, o envelope JÁ é INVALIDATED e a trilha já registrou. Falhar
    // aqui deixa o status desatualizado — ruim, e ainda assim melhor do que
    // derrubar a invalidação, que é a parte que protege o documento.
    if (this.onEnvelopeInvalidated) {
      try {
        await this.onEnvelopeInvalidated(quoteId, running.id, reason);
      } catch (error) {
        this.logger.error(
          `Envelope ${running.id} invalidado, mas o orçamento ${quoteId} não voltou para ` +
            `pendente: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    // Avisa TODOS os signatários ainda ativos, não só quem já tinha assinado.
    //
    // Quem estava pendente recebeu um convite e continua com um link na caixa de
    // entrada — link que acabou de morrer. Sem aviso, essa pessoa volta ao
    // endereço mais tarde e encontra "esta coleta não está mais ativa", sem
    // nenhuma explicação e sem saber que uma nova versão está a caminho.
    //
    // REFUSED fica de fora: quem recusou já encerrou a participação, e é o mesmo
    // recorte que o `updateMany` acima usa para não sobrescrever a recusa.
    // SEM `await` — e isto é o conserto de uma lentidão medida, não zelo.
    //
    // O aviso de anulação sai pelo MESMO transporte com ritmo humano que os
    // convites usam: a guarda de saída espaça mensagens consecutivas (ver
    // `WhatsAppOutboundGuard`). Com dois signatários isso somava ~32 s de espera
    // DELIBERADA dentro do `PUT /task-quotes/:id` — medido em 24/08/2026,
    // 16:20:22→16:20:54, com um intervalo de 15.394 ms entre os dois envios. O
    // operador via "Salvando" esse tempo todo por causa de uma mensagem que não
    // tem nada a ver com o salvamento.
    //
    // O que PRECISA ser síncrono já aconteceu acima: os signatários viraram
    // VOIDED, o envelope virou INVALIDATED e o evento entrou na trilha. Isso é
    // o estado do documento, e a resposta do PUT não pode sair antes dele. O
    // aviso é comunicação, e cada resultado entra na trilha quando o servidor
    // responde — exatamente como os convites (ver `dispatchInvitations`).
    void this.notifyVoidedSigners(running, materialEntries, reason).catch(error =>
      this.logger.error(
        `Falha ao avisar os signatários da invalidação de ${running.id}: ${
          error instanceof Error ? error.message : error
        }`,
      ),
    );

    this.logger.warn(`Envelope ${running.id} invalidado — ${reason}`);
    return true;
  }

  /**
   * PRORROGAR A VALIDADE MOVE O PRAZO DO ENVELOPE JUNTO.
   *
   * `Budget.expiresAt` é copiado para `SignatureEnvelope.deadlineAt` numa linha
   * só — em `createEnvelope` — e nunca mais. Enquanto prorrogar era MATERIAL isso
   * não aparecia, porque a coleta morria antes de a data nova valer para alguma
   * coisa. Agora que prorrogar é cosmético (ver `tolerateExtendedValidity`), não
   * propagar seria pior que o defeito antigo: a coleta continuaria viva, o
   * operador teria dito ao cliente "tem até sexta", e `assertSignable` recusaria
   * pelo prazo de terça.
   *
   * O TOKEN DE CADA LINK anda junto — `assertTokenFresh` lê `tokenExpiresAt`, que
   * nasce igual ao prazo. Só sobem os que ainda estão EXATAMENTE no prazo antigo:
   * um link revogado individualmente teve o `tokenExpiresAt` ENCURTADO de
   * propósito, e reerguê-lo aqui seria desfazer a revogação por tabela.
   *
   * Só para coleta VIVA. Num envelope concluído o prazo já não decide nada, e
   * mexer nele reescreveria um dado do contrato selado.
   */
  private async propagateExtendedDeadline(
    env: { id: string; status: EnvelopeStatus; deadlineAt: Date },
    newExpiresAtIso: string,
    actorUserId: string | null,
  ): Promise<void> {
    if (env.status !== EnvelopeStatus.RUNNING) return;
    const nova = new Date(newExpiresAtIso);
    if (Number.isNaN(nova.getTime())) return;
    const antiga = env.deadlineAt;
    if (nova.getTime() <= antiga.getTime()) return;

    await this.prisma.$transaction(async tx => {
      await tx.signatureEnvelope.update({
        where: { id: env.id },
        data: { deadlineAt: nova },
      });
      await tx.envelopeSigner.updateMany({
        where: { envelopeId: env.id, tokenExpiresAt: antiga },
        data: { tokenExpiresAt: nova },
      });
    });

    this.logger.log(
      `Envelope ${env.id}: prazo prorrogado de ${antiga.toISOString()} para ` +
        `${nova.toISOString()}${actorUserId ? ` por ${actorUserId}` : ''} — ` +
        'assinaturas coletadas preservadas.',
    );
  }

  /**
   * Avisa os signatários de que a coleta caiu. Roda FORA do request — ver a
   * chamada em `onQuoteContentChanged`.
   *
   * Erro aqui não desfaz nada: a invalidação já está persistida e registrada
   * quando este método começa. O que se perde, no pior caso, é o aviso — e a
   * trilha diz que ele não saiu.
   */
  private async notifyVoidedSigners(
    running: {
      id: string;
      signers: Array<{
        id: string;
        status: EnvelopeSignerStatus;
        declaredName: string;
        declaredEmail: string | null;
        declaredPhone: string | null;
        authMethod: SignatureAuthMethod;
        orderGroup: number;
        signedAt: Date | null;
      }>;
      quoteId: string;
      quote?: { budgetNumber: number } | null;
    },
    materialEntries: QuoteChange[],
    reason: string,
  ): Promise<void> {
    const toNotify = running.signers.filter(s => s.status !== EnvelopeSignerStatus.REFUSED);

    // O botão do template interno é endereçado pela TAREFA, e este método só
    // recebe o orçamento. Uma consulta, fora do laço: o alvo é o mesmo para
    // todos os signatários, e o laço fala com dois transportes de rede.
    const task = await this.prisma.task.findFirst({
      where: { quoteId: running.quoteId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const quoteButtonParam = this.internalQuoteButtonParam(task?.id ?? null, running.quoteId);
    for (const s of toNotify) {
      // O e-mail leva a lista item a item. Quem assinou e teve a assinatura
      // anulada não deveria precisar abrir um link para descobrir qual preço
      // mudou — a informação vai junto com a notícia.
      //
      // Os dois canais recebem a MESMA lista em formatos diferentes, porque
      // renderizam diferente: o e-mail monta uma tabela (rótulo numa coluna,
      // valor na outra, sem seta quando um dos lados não existe) e o WhatsApp é
      // texto corrido, onde a linha tem de vir pronta. Ver a nota em
      // `WhatsAppVoidedData.changes` para o que quebrava quando o template de
      // texto tentava montá-la sozinho.
      const voidedPayload = {
        signerName: s.declaredName,
        budgetNumber: running.quote?.budgetNumber ?? '—',
        reason,
        hadSigned: !!s.signedAt,
        changes: materialEntries.map(c => ({
          label: c.label,
          subject: c.subject,
          before: c.before,
          after: c.after,
        })),
      };
      // O lado da Ankaa não tem canal no `authMethod` (é `INTERNAL_SESSION`), e
      // `channelForAuthMethod` devolveria e-mail para ele numa coleta de
      // WhatsApp — mandando o aviso por um canal que a cerimônia não usou e
      // gravando "email" na trilha append-only de um envelope de WhatsApp.
      //
      // `isSessionCeremony` e não `=== 'INTERNAL'`: `RESPONSIBLE_SESSION`
      // também não é canal, e cairia no padrão EMAIL de `channelForAuthMethod`.
      const channel = this.deliveryChannelFor(s, running.signers);
      const voidNotice = await this.deliverToSigner({
        signer: s,
        channel,
        email: generateEnvelopeVoidedEmail(voidedPayload),
        whatsapp: generateEnvelopeVoidedWhatsApp(voidedPayload),
        // DOIS TEMPLATES, um por destinatário. O do cliente diz que vem outro
        // link; o nosso diz POR QUE a coleta caiu, que é a única informação
        // acionável para quem trabalha aqui — e é por isso que o interno tem a
        // variável do motivo e o do cliente não.
        //
        // O lado da Ankaa saía em texto livre pelo Baileys até 17/09, com o
        // argumento de que "a lista de mudanças não cabe num corpo aprovado".
        // Não cabe mesmo — e continua não cabendo: a lista item a item vai no
        // E-MAIL, que não tem limite de formato. O que cabe no template é o
        // motivo, que é o que se lê no celular.
        whatsappTemplate:
          this.ceremonyKindOf(s.authMethod) === 'INTERNAL'
            ? voidedInternalTemplate({
                signerName: voidedPayload.signerName,
                budgetNumber: voidedPayload.budgetNumber,
                reason: voidedPayload.reason,
                quoteTaskId: quoteButtonParam,
              })
            : voidedTemplate({
                signerName: voidedPayload.signerName,
                budgetNumber: voidedPayload.budgetNumber,
              }),
        kind: 'SIGNATURE_VOIDED',
      });
      const notified = voidNotice.ok;
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
          //
          // O canal sai de `channelForAuthMethod` acima, nunca de um literal: a
          // trilha é append-only e encadeada por hash, então um "email" fixo aqui
          // gravaria uma afirmação falsa sobre um envelope de WhatsApp que nenhuma
          // correção posterior conseguiria desfazer.
          payload: {
            channel: auditChannelOf(channel),
            notified,
            ...(voidNotice.reason ? { failureReason: voidNotice.reason } : {}),
          },
        });
      } else if (!notified) {
        this.logger.warn(
          `Signatário pendente ${s.id} não pôde ser avisado da invalidação do envelope ` +
            `${running.id}: ${voidNotice.reason ?? 'sem motivo'}.`,
        );
      }
    }
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
   * O PDF DO RECORTE DESTE SIGNATÁRIO, pela SESSÃO DO PORTAL.
   *
   * ⛔ A ROTA PÚBLICA DO ORÇAMENTO NÃO SUBSTITUI ESTA. Ela serve o documento
   * COMPLETO — a capability dela é o UUID do orçamento —, e um signatário do
   * portal pode ter recebido um RECORTE: o Marketing do cliente assina a fatia
   * de `LAYOUT` e não recebeu `PRICING`. Servir-lhe o instrumento inteiro
   * mostraria o preço que a emissão decidiu não lhe mostrar, que é a mesma
   * classe de vazamento de `GET /budgets/public/:id`. O que se serve é
   * `EnvelopeSigner.documentId` — o recorte DELE —, exatamente como a rota
   * pública do signatário já faz com o token.
   *
   * ⚠️ O PAR NO `where`, nunca `findUnique` + `if`. Mesma doutrina de
   * `signByPortalSession`: com `{ id, responsibleId }` o signatário de outra
   * pessoa não EXISTE, em vez de existir e ser negado — que é a diferença entre
   * um `where` e um oráculo de ids válidos.
   */
  async renderDocumentForResponsible(
    signerId: string,
    responsibleId: string,
  ): Promise<{ pdf: Buffer; etag: string; filename: string }> {
    const signer = await this.prisma.envelopeSigner.findFirst({
      where: { id: signerId, responsibleId },
      select: { envelopeId: true, documentId: true },
    });
    if (!signer) {
      throw new NotFoundException(
        'Esta assinatura não existe ou não é sua. Confira a lista de pendências do portal.',
      );
    }
    return this.renderServedDocument(signer.envelopeId, signer.documentId);
  }

  /**
   * PDF servido "ao vivo": os bytes congelados + os selos de quem já assinou.
   *
   * Os slots pendentes continuam em branco, então o documento sempre mostra o
   * estado real da coleta — que é o que o cliente precisa ver. O original nunca
   * muda; a sobreposição é recalculada a cada requisição.
   *
   * `filename` sai daqui, e não de quem chama: as três rotas que servem este PDF
   * (interna, do signatário e pública do orçamento) precisam do MESMO nome, e
   * cada uma delas montá-lo por conta própria era o que fazia o mesmo documento
   * chegar com quatro nomes diferentes. Ver `document/document-filename.ts`.
   */
  async renderServedDocument(
    envelopeId: string,
    /**
     * O RECORTE a servir. Omitido = o documento completo, que é o que a rota
     * interna e a página pública do orçamento querem: o instrumento, não a fatia
     * de um signatário.
     */
    documentId?: string | null,
  ): Promise<{ pdf: Buffer; etag: string; filename: string }> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: {
        signers: { orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }] },
        documents: {
          orderBy: [{ isFull: 'desc' }, { variantKey: 'asc' }],
          include: { originalFile: true, finalFile: true },
        },
        // `truck`: a remontagem ao vivo também carimba a identidade que chegou
        // depois — o cliente que abre o link durante a coleta vê o cadastro de
        // hoje, não o de quando o documento foi congelado.
        quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { customer: true, truck: true } } } },
        originalFile: true,
        finalFile: true,
      },
    });
    if (!env) throw new NotFoundException('Envelope não encontrado.');

    // Qual recorte servir. Um `documentId` que não pertence a este envelope é
    // RECUSADO, não ignorado: cair no completo em silêncio entregaria a quem
    // pediu a fatia do marketing um documento com preço, que é exatamente o que
    // o recurso existe para impedir.
    const requested = documentId
      ? (env.documents.find(d => d.id === documentId) ?? null)
      : (env.documents.find(d => d.isFull) ?? env.documents[0] ?? null);
    if (documentId && !requested) {
      throw new NotFoundException('Este recorte não pertence a esta coleta de assinaturas.');
    }

    // Envelope anterior a este recurso: as colunas do próprio envelope são o
    // documento. Ver a mesma nota em `finalize`.
    const doc = requested ?? {
      id: null as string | null,
      isFull: true,
      variantKey: variantKeyOf([...FULL_SECTIONS]),
      sections: [...FULL_SECTIONS] as string[],
      originalSha256: env.originalSha256,
      anchors: env.anchors,
      lateSlots: env.lateSlots,
      originalFile: env.originalFile,
      finalFile: env.finalFile,
      finalSha256: env.finalSha256,
    };

    const { readFileSync, existsSync } = await import('fs');

    if (!existsSync(doc.originalFile.path)) {
      throw new NotFoundException(
        'O documento congelado deste envelope não está mais disponível em disco. ' +
          'Reemita a coleta de assinaturas.',
      );
    }

    const docSections = this.sectionsOf(doc);
    const filename = budgetPdfFilename(
      primaryTask(env.quote)?.customer,
      env.quote.budgetNumber,
      // Sufixo só quando há mais de um recorte: o documento único da coleta comum
      // continua chegando com o nome que sempre teve.
      env.documents.length > 1 ? variantFilenameSuffix(docSections) : '',
    );

    // Há artefato selado: serve os BYTES, nunca uma remontagem.
    //
    // ⚠️ A condição era `status === COMPLETED && doc.finalFile`. Desde que uma
    // alteração material passou a invalidar também a coleta CONCLUÍDA, o status
    // deixou de ser o teste certo: o envelope invalidado continua tendo o PDF
    // assinado em disco, e remontá-lo entregaria uma reconstrução no lugar do
    // que foi de fato assinado — perdendo o selo PAdES e a trilha que ele cobre.
    // Quem decide é a EXISTÊNCIA do arquivo final, que é o mesmo critério que o
    // montador do dossiê já usava (`assinado = Boolean(envelope?.finalFile)`).
    if (doc.finalFile) {
      const pdf = readFileSync(doc.finalFile.path);
      return { pdf, etag: `"${doc.finalSha256}"`, filename };
    }

    const originalPdf = readFileSync(doc.originalFile.path);
    const customer = primaryTask(env.quote)?.customer ?? null;
    const companyLabel = customer?.corporateName ?? customer?.fantasyName ?? null;
    const anchors = (doc.anchors ?? {}) as Record<string, unknown>;

    // Os valores que carimbam as lacunas, veículo a veículo — nas duas formas de
    // chave, para que envelopes anteriores a esta feature continuem sendo
    // carimbados. Ver `buildLateValueMap`.
    const lateValues = buildLateValueMap(
      sortQuoteTasks(env.quote.tasks ?? []).map(t => ({
        taskId: t.id,
        serialNumber: t.serialNumber ?? null,
        plate: t.truck?.plate ?? null,
        chassis: t.truck?.chassisNumber ?? null,
      })),
    );

    // Só quem tem âncora NESTE pdf — a mesma regra do `finalize`, pelo mesmo
    // motivo: carimbar o selo de alguém numa folha em que ele não tem linha de
    // assinatura afirmaria que ele assinou um documento que nunca viu.
    const docSigners = env.signers.filter(s =>
      Object.prototype.hasOwnProperty.call(anchors, s.id),
    );

    const pdf = await this.assembler.stampSeals({
      originalPdf,
      anchors: anchors as any,
      signers: docSigners.map(s => ({
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
      originalSha256: doc.originalSha256,
      voidedLabel: VOID_WATERMARK_LABELS[env.status] ?? null,
      lateSlots: (doc.lateSlots as any) ?? null,
      lateValues: lateValues,
    });

    // ETag deriva do original + do estado de assinatura E DO STATUS do envelope.
    //
    // O status entrava de fora: invalidar preserva `signedAt` (é fato
    // histórico) e só muda o status, então a chave anterior não se movia e o
    // cliente seguia recebendo do cache a versão SEM marca d'água — exatamente
    // o PDF que a marca existe para não deixar circular.
    //
    // E dos VALORES TARDIOS: registrar o chassi muda o documento servido (ele é
    // carimbado na lacuna), e sem isto o cliente continuaria recebendo do cache
    // a versão com "a registrar" depois de o dado existir.
    const stateKey = docSigners
      .map(s => `${s.id}:${s.signedAt?.toISOString() ?? ''}:${s.status}`)
      .join('|');
    const lateKey = Object.entries(lateValues)
      .map(([k, v]) => `${k}:${v ?? ''}`)
      .join('|');
    return {
      pdf,
      // O hash do RECORTE entra na chave: dois recortes do mesmo envelope têm o
      // mesmo status e o mesmo conjunto de valores tardios, e uma ETag comum
      // faria o navegador servir o documento de um signatário para outro.
      etag: `"${sha256Hex(doc.originalSha256 + env.status + stateKey + lateKey).slice(0, 32)}"`,
      filename,
    };
  }

  /**
   * TODOS os recortes num arquivo só — a visão do operador.
   *
   * O botão "PDF" do painel abria o recorte completo, e num orçamento com três
   * recortes isso mostra as assinaturas de um subconjunto das pessoas. Quem
   * conduz a coleta precisa da resposta oposta: "está tudo assinado?" — e essa
   * resposta está espalhada por N arquivos.
   *
   * NENHUM RECORTE PERDE VALIDADE POR CAUSA DISTO, e a garantia tem três partes:
   *
   *  · este arquivo é montado sob demanda e NUNCA é gravado como `finalFileId`
   *    de coisa nenhuma — os artefatos selados continuam intocados no disco;
   *  · as páginas copiadas entram sem o widget de assinatura (ver
   *    `mergeDocuments`), então o visualizador não anuncia uma assinatura
   *    digital que este arquivo não tem;
   *  · cada recorte selado viaja ANEXO, byte a byte, de modo que a prova
   *    completa acompanha a visualização.
   *
   * Enquanto a coleta corre não há selo nenhum: aí ele junta as remontagens ao
   * vivo, que é exatamente o que o operador quer ver — quem já assinou e quem
   * não.
   */
  async renderCombinedDocument(
    envelopeId: string,
  ): Promise<{ pdf: Buffer; etag: string; filename: string }> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      include: {
        documents: {
          orderBy: [{ isFull: 'desc' }, { variantKey: 'asc' }],
          include: { finalFile: true },
        },
        quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { customer: true } } } },
      },
    });
    if (!env) throw new NotFoundException('Envelope não encontrado.');

    // Um recorte só: não há o que juntar, e montar um invólucro em volta de um
    // arquivo único só tiraria dele a assinatura PAdES que ele tem.
    if (env.documents.length <= 1) {
      return this.renderServedDocument(envelopeId, env.documents[0]?.id ?? null);
    }

    const { readFileSync, existsSync } = await import('fs');
    const parts: Buffer[] = [];
    const attachments: Array<{ name: string; bytes: Buffer; description: string }> = [];
    const etagParts: string[] = [];

    for (const doc of env.documents) {
      const served = await this.renderServedDocument(envelopeId, doc.id);
      parts.push(served.pdf);
      etagParts.push(served.etag);

      // O anexo é o SELADO, não o que acabou de ser remontado: é ele que carrega
      // a assinatura ICP-Brasil. Sem selo (coleta em andamento) não há o que
      // anexar, e a visualização vale por si.
      if (doc.finalFile?.path && existsSync(doc.finalFile.path)) {
        attachments.push({
          name: `orcamento-${env.quote.budgetNumber}-assinado${variantFilenameSuffix(
            this.sectionsOf(doc),
          )}.pdf`,
          bytes: readFileSync(doc.finalFile.path),
          description:
            `Orçamento nº ${env.quote.budgetNumber} — ${describeSections(this.sectionsOf(doc))} ` +
            `— envelope ${env.verificationCode}. Este é o documento com validade ` +
            'jurídica deste recorte: extraia-o para validar a assinatura ICP-Brasil.',
        });
      }
    }

    const pdf = await this.assembler.mergeDocuments(
      parts,
      attachments,
      `Orçamento nº ${env.quote.budgetNumber} — todos os recortes`,
    );

    return {
      pdf,
      // Deriva das ETags das partes: qualquer assinatura nova em qualquer
      // recorte muda a chave, e o navegador não serve a versão de antes.
      etag: `"${sha256Hex(etagParts.join('|')).slice(0, 32)}"`,
      filename: budgetPdfFilename(
        primaryTask(env.quote)?.customer,
        env.quote.budgetNumber,
        '-todos-os-recortes',
      ),
    };
  }

  // ===========================================================================
  // ADITIVO DE IDENTIFICAÇÃO DO VEÍCULO
  // ===========================================================================

  /**
   * Emite e sela o aditivo de identificação do veículo de um orçamento.
   *
   * QUANDO: na FINALIZAÇÃO DO SERVIÇO. Não quando o chassi é cadastrado —
   * naquele momento a placa pode ainda não ter chegado, e sairiam dois aditivos
   * contando metade da história cada. Na entrega tudo o que ia chegar já chegou,
   * e o cliente recebe a folha junto com o resto.
   *
   * IDEMPOTENTE: um aditivo por envelope. Reexecutar não emite outro — o
   * artefato é selado e reemiti-lo criaria dois documentos com o mesmo assunto e
   * hashes diferentes, que é o problema que o aditivo existe para não criar.
   *
   * Devolve `null` (sem erro) quando não há o que aditar. Os quatro casos:
   * orçamento sem coleta selada, coleta sem lacuna reservada (o documento já
   * nasceu com a identificação impressa), nenhuma lacuna preenchida até agora, e
   * aditivo já emitido. Nenhum deles é falha — são a maioria dos orçamentos.
   */
  async issueVehicleAddendum(
    quoteId: string,
    actorUserId: string | null = null,
  ): Promise<{ envelopeId: string; fileId: string; padesLevel: string | null } | null> {
    const envelope = await this.prisma.signatureEnvelope.findFirst({
      // A chave é `finalFileId`, não o status: é o artefato SELADO que o aditivo
      // referencia, e ele sobrevive ao envelope virar SUPERSEDED numa reemissão.
      where: { quoteId, finalFileId: { not: null } },
      orderBy: { version: 'desc' },
      include: {
        documents: { select: { lateSlots: true } },
        signers: { orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }] },
        quote: {
          include: {
            tasks: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              include: { customer: true, truck: true },
            },
          },
        },
      },
    });
    if (!envelope) return null;
    if (envelope.addendumFileId) return null;

    // ═════════════════════════════════════════════════════════════════════════
    // O QUE ADITAR SAI DO SNAPSHOT CONGELADO, NÃO DAS LACUNAS RESERVADAS
    // ═════════════════════════════════════════════════════════════════════════
    //
    // Antes a lista vinha de `lateSlots` — as lacunas que o renderizador
    // conseguiu MEDIR. Isso funcionava porque o documento tinha um veículo e a
    // frase dele abria a primeira folha, então toda lacuna era medível.
    //
    // Com sessenta veículos deixa de funcionar, e falha do lado errado:
    // `resolveLateSlots` descarta tudo que cai fora da primeira folha, e a
    // tabela de sessenta caminhões ocupa quase três. Da linha ~35 em diante não
    // há lacuna registrada — e o aditivo, guiado por elas, simplesmente NÃO
    // declararia o chassi daqueles vinte e cinco caminhões. O dado existiria no
    // cadastro, o cliente teria assinado um documento que diz "a registrar", e
    // nada no artefato fecharia a lacuna.
    //
    // A pergunta certa não é "esta lacuna foi medida?" e sim "este campo estava
    // EM BRANCO quando o cliente assinou, e está preenchido agora?". Quem
    // responde é o snapshot congelado — que é, por definição, o que o
    // signatário viu.
    const frozen = envelope.quoteSnapshot as unknown as QuoteSnapshot;
    const frozenByTask = new Map(snapshotVehicles(frozen).map(v => [v.taskId, v]));
    const currentVehicles = sortQuoteTasks(envelope.quote.tasks ?? []);
    const multiVehicle = currentVehicles.length > 1;

    interface AddendumField {
      key: string;
      label: string;
      value: string;
      taskId: string;
      truckId: string | null;
    }
    const pending: AddendumField[] = [];
    for (const task of currentVehicles) {
      const was = frozenByTask.get(task.id);
      // Veículo que NÃO estava no documento assinado não se adita: ele é uma
      // alteração material do orçamento, e alteração material invalida a coleta
      // (ou marca o assinado como alterado). Aditar seria fingir que o
      // documento sempre falou dele.
      if (!was) continue;
      const now: Record<string, string | null> = {
        serialNumber: task.serialNumber ?? null,
        plate: task.truck?.plate ?? null,
        chassis: task.truck?.chassisNumber ?? null,
        orderNumber: task.customerOrderNumber ?? null,
      };
      const before: Record<string, string | null> = {
        serialNumber: was.serialNumber ?? null,
        plate: was.plate ?? null,
        chassis: was.chassisNumber ?? null,
        orderNumber: was.orderNumber ?? null,
      };
      // O PEDIDO só se o congelado o REGISTRA. Snapshot anterior a esta feature
      // não tem a chave — e o documento dele sequer trazia a coluna, que só saía
      // quando algum veículo já tinha número. Aditar ali declararia uma lacuna
      // que a folha assinada nunca mostrou, que é o oposto do que o aditivo faz.
      const fields = [
        'serialNumber',
        'plate',
        'chassis',
        ...(was && 'orderNumber' in was ? (['orderNumber'] as const) : []),
      ] as const;
      for (const field of fields) {
        const value = (now[field] ?? '').trim();
        // Só o que estava em branco E chegou depois. Um campo que já constava do
        // assinado não é cadastro tardio; um que continua vazio não tem o que
        // declarar — uma folha selada dizendo "chassi: não registrado" não
        // acrescenta nada a um documento que já diz "a registrar".
        if (!value) continue;
        if ((before[field] ?? '').trim()) continue;
        pending.push({
          key: lateSlotKey(field, task.id),
          // Com um veículo o rótulo é o de sempre ("Chassi"); com sessenta ele
          // precisa dizer DE QUAL — senão a folha lista vinte e cinco linhas
          // chamadas "Chassi" e nenhuma diz a que caminhão pertence.
          label: multiVehicle
            ? `${LATE_SLOT_LABELS[field] ?? field} — ${
                task.serialNumber ? `nº ${task.serialNumber}` : (task.truck?.plate ?? task.id.slice(0, 8))
              }`
            : (LATE_SLOT_LABELS[field] ?? field),
          value,
          taskId: task.id,
          truckId: task.truck?.id ?? null,
        });
      }
    }
    if (pending.length === 0) return null;

    const filled = pending.map(f => f.key);

    // As datas de registro saem do changelog, veículo a veículo: `updatedAt` do
    // caminhão se move a cada toque na linha (uma troca de vaga no pátio) e
    // dataria o chassi pelo último desses toques.
    const registeredAtByTask = new Map<string, Record<string, Date | null>>();
    for (const task of currentVehicles) {
      if (!pending.some(f => f.taskId === task.id)) continue;
      registeredAtByTask.set(
        task.id,
        await this.lateSlotRegistrationDates(task.id, task.truck?.id ?? null),
      );
    }

    const customer = currentVehicles[0]?.customer ?? null;
    const addendumPdf = await this.assembler.buildVehicleAddendum({
      budgetNumber: envelope.quote.budgetNumber,
      verificationCode: envelope.verificationCode,
      verificationUrl: this.verificationUrl(envelope.verificationCode),
      signedSha256: envelope.finalSha256,
      sealedAt: envelope.sealedAt,
      customerLabel: customer?.corporateName ?? customer?.fantasyName ?? null,
      signers: envelope.signers
        .filter(sig => sig.signedAt)
        .map(sig => ({
          name: sig.declaredName,
          cargo: sig.informedCargo,
          signedAt: sig.signedAt,
        })),
      // Na ordem dos VEÍCULOS (a do documento), e dentro de cada um na ordem
      // série → placa → chassi. Ordenar por chave alfabética espalharia os três
      // campos do mesmo caminhão por toda a folha.
      fields: pending.map(f => ({
        label: f.label,
        value: f.value,
        registeredAt:
          registeredAtByTask.get(f.taskId)?.[parseLateSlotKey(f.key).field] ?? null,
      })),
    });

    // ---- Selo PAdES ----
    //
    // É ele que faz do aditivo um documento, e não uma folha impressa. Falha na
    // selagem NÃO grava nada: sem selo o aditivo não atesta coisa alguma, e um
    // arquivo persistido sem selo bloquearia a reemissão pelo guard de
    // idempotência acima. Melhor não existir e ser tentado de novo.
    let sealed = addendumPdf;
    let padesLevel: string | null = null;
    if (this.pades.isEnabled()) {
      try {
        const result = await this.pades.sealPdf(addendumPdf, {
          reason:
            `Aditivo de identificação do veículo — orçamento nº ${envelope.quote.budgetNumber} ` +
            `— envelope ${envelope.verificationCode}`,
          location: COMPANY.signatureLocation,
          signerName: this.pades.getCertMetadata()?.subjectCommonName ?? COMPANY.corporateName,
          contactInfo: COMPANY.email,
        });
        sealed = result.signedPdf;
        padesLevel = result.level;
      } catch (error) {
        this.logger.error(
          `Falha ao selar o aditivo do envelope ${envelope.id}: ${
            error instanceof Error ? error.message : error
          }. Nada foi gravado; será tentado de novo.`,
        );
        return null;
      }
    }

    const sha256 = sha256Hex(sealed);
    const fileId = await this.persistPdf(
      envelope.quote as never,
      sealed,
      'aditivo',
      envelope.verificationCode,
    );

    await this.prisma.signatureEnvelope.update({
      where: { id: envelope.id },
      data: {
        addendumFileId: fileId,
        addendumSha256: sha256,
        addendumSealedAt: padesLevel ? new Date() : null,
        addendumPadesLevel: padesLevel,
      },
    });

    await this.audit.recordBestEffort(envelope.id, {
      eventType: 'ADDENDUM_ISSUED',
      actorType: actorUserId ? 'OPERATOR' : 'SYSTEM',
      actorId: actorUserId,
      documentHash: sha256,
      payload: {
        padesLevel: padesLevel ?? 'none',
        fields: filled,
        signedSha256: envelope.finalSha256 ?? '',
      },
    });

    this.logger.log(
      `Aditivo de identificação emitido para o orçamento nº ${envelope.quote.budgetNumber} ` +
        `(${filled.join(', ')})${padesLevel ? ` — selo ${padesLevel}` : ' — SEM selo'}.`,
    );

    return { envelopeId: envelope.id, fileId, padesLevel };
  }

  /** Os bytes selados do aditivo. */
  async readAddendum(envelopeId: string): Promise<{ pdf: Buffer; filename: string }> {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { id: envelopeId },
      select: {
        addendumFile: { select: { path: true } },
        quote: {
          select: {
            budgetNumber: true,
            tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true, customer: { select: { corporateName: true, fantasyName: true } } } },
          },
        },
      },
    });
    if (!env?.addendumFile) {
      throw new NotFoundException('Este orçamento ainda não tem aditivo de identificação.');
    }
    const { readFileSync, existsSync } = await import('fs');
    if (!existsSync(env.addendumFile.path)) {
      throw new NotFoundException('O aditivo não está mais disponível em disco.');
    }
    return {
      pdf: readFileSync(env.addendumFile.path),
      filename: budgetPdfFilename(
        primaryTask(env.quote)?.customer,
        env.quote.budgetNumber,
        '-aditivo',
      ),
    };
  }

  /**
   * Quando cada campo de identificação foi de fato registrado.
   *
   * Sai do CHANGELOG, e não do `updatedAt` do veículo: `updatedAt` se move a cada
   * toque na linha (uma troca de vaga no pátio, uma medida de implemento) e
   * dataria o chassi pelo último desses toques. O aditivo declara uma data ao
   * lado de um valor — ela precisa ser a data daquele valor.
   *
   * Best-effort: sem a linha do changelog o aditivo sai sem a data, o que é
   * menos do que se quer e continua sendo verdade.
   */
  private async lateSlotRegistrationDates(
    taskId: string | null,
    truckId: string | null,
  ): Promise<Record<string, Date | null>> {
    const out: Record<string, Date | null> = {};
    const fieldOf: Record<string, string> = {
      plate: 'plate',
      chassis: 'chassisNumber',
      serialNumber: 'serialNumber',
      orderNumber: 'customerOrderNumber',
    };
    try {
      const rows = await this.prisma.changeLog.findMany({
        where: {
          OR: [
            ...(truckId ? [{ entityId: truckId, field: { in: ['plate', 'chassisNumber'] } }] : []),
            ...(taskId
              ? [{ entityId: taskId, field: { in: ['serialNumber', 'customerOrderNumber'] } }]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { field: true, createdAt: true, newValue: true },
      });
      for (const [key, field] of Object.entries(fieldOf)) {
        // A ÚLTIMA escrita com valor não-vazio: um campo corrigido depois de
        // preenchido tem a data da correção, que é a data do valor que o aditivo
        // declara.
        const row = rows.find(
          r => r.field === field && !!String(r.newValue ?? '').replace(/["\s]/g, ''),
        );
        out[key] = row?.createdAt ?? null;
      }
    } catch (error) {
      this.logger.warn(
        `Não foi possível datar o cadastro tardio: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
    return out;
  }

  // ===========================================================================
  // VERIFICAÇÃO PÚBLICA
  // ===========================================================================

  async getVerificationByCode(code: string, ctx: RequestContext) {
    const env = await this.prisma.signatureEnvelope.findUnique({
      where: { verificationCode: code },
      include: {
        signers: {
          orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }],
          include: {
            responsible: { select: { roles: true } },
            user: {
              select: {
                position: { select: { name: true } },
                sector: { select: { name: true } },
              },
            },
          },
        },
        documents: {
          orderBy: [{ isFull: 'desc' }, { variantKey: 'asc' }],
          select: {
            isFull: true,
            sections: true,
            originalSha256: true,
            finalSha256: true,
            padesLevel: true,
            sealedAt: true,
          },
        },
        quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { customer: true } } } },
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
    const customer = primaryTask(env.quote)?.customer ?? null;

    return {
      verificationCode: env.verificationCode,
      status: env.status,
      /**
       * Os recortes desta coleta, com os hashes de cada um.
       *
       * É o que permite a quem tem UM dos PDFs em mãos conferir que aquele
       * arquivo pertence a esta cerimônia: sem a lista, o portal só conheceria o
       * hash do documento completo e diria "não confere" para o artefato
       * legítimo de um signatário — o pior resultado possível numa página cuja
       * única função é dizer se um documento é verdadeiro.
       *
       * NÃO sai o conteúdo, nem que seções cada um tem em detalhe além do
       * rótulo: a página é pública e o código dela é impresso em todas as folhas
       * do PDF, que circula por e-mail.
       */
      documents: env.documents.map(d => ({
        label: describeSections(this.sectionsOf(d)),
        isFull: d.isFull,
        originalSha256: d.originalSha256,
        finalSha256: d.finalSha256,
        padesLevel: d.padesLevel,
        sealedAt: d.sealedAt,
      })),
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
      /**
       * O aditivo de identificação, quando existe.
       *
       * Entra no portal porque ele É parte do instrumento: quem confere o
       * orçamento assinado de um implemento 0 km encontra "a registrar" no lugar
       * do chassi, e precisa saber que existe uma folha selada declarando qual é
       * — com hash próprio, conferível aqui.
       */
      addendum: env.addendumFileId
        ? {
            sha256: env.addendumSha256,
            sealedAt: env.addendumSealedAt,
            padesLevel: env.addendumPadesLevel,
          }
        : null,
      auditChain: { valid: chain.valid, events: chain.eventCount, reason: chain.reason },
      // CPF sempre MASCARADO aqui: esta página é pública e o orçamento contém preço.
      signers: env.signers.map(s => ({
        name: s.declaredName,
        cargo: this.displayCargoOf(s),
        cpfMasked: s.informedCpf ? maskCpf(s.informedCpf) : null,
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
   * O que sai por signatário é EXATAMENTE o que o selo carimbado no PDF já
   * imprime (`drawSeal` em `quote-assembler.service.ts`): nome, cargo, empresa,
   * CPF e telefone MASCARADOS, data/hora, método de autenticação, IP e código do
   * envelope. Não é uma ampliação de escopo — é o mesmo conjunto de dados que
   * esta mesma página entrega em PDF pela rota irmã
   * `GET /assinatura/publico/orcamento/:id/documento.pdf`, sob a MESMA
   * capability (o UUID do orçamento). O que mudou é só o painel na tela deixar
   * de mostrar menos do que o documento que ele descreve.
   *
   * Continua de fora: CPF completo, telefone completo, e-mail e token de acesso.
   * E os campos que só existem por causa do ATO (CPF, telefone, IP) só saem para
   * quem de fato assinou — num slot pendente não há ato a descrever.
   */
  async getPublicQuoteSummary(quoteId: string) {
    const env = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId },
      orderBy: { version: 'desc' },
      include: {
        signers: {
          orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }],
          // Mesmas relações que `getVerificationByCode` carrega, pela mesma
          // razão: o cargo do selo tem três fontes em cascata.
          include: {
            responsible: { select: { roles: true } },
            user: {
              select: {
                position: { select: { name: true } },
                sector: { select: { name: true } },
              },
            },
          },
        },
        quote: {
          select: {
            tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true, customer: { select: { corporateName: true, fantasyName: true } } } },
          },
        },
      },
    });
    if (!env) return { hasEnvelope: false as const };

    // A linha "empresa" do selo: razão social do cliente do lado CUSTOMER, a
    // Ankaa do lado ANKAA. Idêntico ao que `renderServedDocument` monta.
    const customer = primaryTask(env.quote)?.customer ?? null;
    const customerLabel = customer?.corporateName ?? customer?.fantasyName ?? null;

    const changes = (await this.changesSinceFrozen(quoteId, [env])).get(env.id) ?? [];

    // Em que FOLHA do documento congelado está o bloco de assinaturas (0-based).
    //
    // A página pública precisa disto para se paginar como o PDF: quando o
    // orçamento inteiro cabe numa folha, as assinaturas ficam na PRIMEIRA
    // (`tryFusedRender`), e quando não cabe elas ganham folha própria. Sem o
    // campo, a tela tinha de escolher um dos dois e errava no outro — e nenhuma
    // regra local acerta, porque a paginação de um envelope já congelado é um
    // FATO gravado nas âncoras, não algo que se recalcule a partir do orçamento
    // de hoje (que pode ter mudado desde então).
    const anchorPages = Object.values(
      (env.anchors as Record<string, { page?: number }> | null) ?? {},
    )
      .map(a => (typeof a?.page === 'number' ? a.page : null))
      .filter((p): p is number => p !== null);
    const signaturesPage = anchorPages.length ? Math.min(...anchorPages) : null;

    return {
      hasEnvelope: true as const,
      status: env.status,
      version: env.version,
      signaturesPage,
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
      signers: env.signers.map(s => {
        // Os dados do ATO só existem depois dele. Antes disso o slot está em
        // branco no PDF, e descrevê-lo na tela seria descrever o que não houve.
        const acted = !!s.signedAt;
        return {
          name: s.declaredName,
          cargo: this.displayCargoOf(s),
          companyLabel: s.orderGroup === 1 ? COMPANY.name : customerLabel,
          cpfMasked: acted && s.informedCpf ? maskCpf(s.informedCpf) : null,
          phoneMasked: acted && s.declaredPhone ? maskPhone(s.declaredPhone) : null,
          authMethodLabel: AUTH_METHOD_LABELS[s.authMethod] ?? s.authMethod,
          ipAddress: acted ? s.ipAddress : null,
          side: s.orderGroup === 1 ? 'ANKAA' : 'CUSTOMER',
          status: s.status,
          signedAt: s.signedAt,
        };
      }),
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
  async renderPublicQuoteDocument(
    quoteId: string,
  ): Promise<{ pdf: Buffer; etag: string; filename: string }> {
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
    if (completed) return this.renderServedDocument(completed.id, null);

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
      // O nome do arquivo é o MESMO do orçamento assinado — quem baixa não
      // deveria conseguir distinguir pela pasta de Downloads se o documento
      // passou ou não pela assinatura eletrônica; isso é conteúdo do PDF, não do
      // nome. Consulta própria porque `renderUnsignedQuoteDocument` devolve só
      // os bytes e é compartilhada com o dossiê.
      const quote = await this.prisma.budget.findUnique({
        where: { id: quoteId },
        select: {
          budgetNumber: true,
          tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true, customer: { select: { corporateName: true, fantasyName: true } } } },
        },
      });
      // ETag sobre os bytes servidos: a renderização é feita a partir dos dados
      // ATUAIS, então não há hash congelado de onde derivar.
      return {
        pdf,
        etag: `"${sha256Hex(pdf).slice(0, 32)}"`,
        filename: budgetPdfFilename(primaryTask(quote)?.customer, quote?.budgetNumber),
      };
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
   *
   * @param customerId  Recorta o documento para um cliente do faturamento
   *   dividido: os serviços dele, o total dele, a condição de pagamento dele.
   *   É AQUI que o recorte por cliente é possível, e só aqui — não há bytes
   *   assinados a preservar, o documento é montado agora a partir dos dados.
   */
  async renderUnsignedQuoteDocument(
    quoteId: string,
    customerId?: string | null,
    /**
     * `true` troca os traços em branco por um aviso de que o orçamento foi
     * assinado eletronicamente. Só o dossiê de um orçamento assinado pede isso —
     * ver `DossierAssemblerService`. O avulso, impresso para assinar à mão,
     * mantém o bloco: ali ele é o ponto do documento.
     */
    hideSignatureBlock = false,
  ): Promise<Buffer> {
    // `buildForQuote` devolve null para orçamento inexistente; desestruturar
    // direto virava `TypeError` — 500 opaco onde cabe um 404 honesto.
    const loaded = await this.snapshots.buildForQuote(quoteId);
    if (!loaded?.quote) throw new NotFoundException('Orçamento não encontrado.');
    const { quote } = loaded;

    const segment = customerId
      ? (quote.customerConfigs.find(c => c.customerId === customerId) ?? null)
      : null;
    // No recorte, a linha de assinatura é subtitulada com o cliente DAQUELA
    // fatia. Manter o cliente da tarefa poria o nome do outro pagador embaixo da
    // assinatura de um documento que não é dele.
    const signatureSubtitle =
      (segment?.customer ?? primaryTask(quote)?.customer)?.corporateName ??
      (segment?.customer ?? primaryTask(quote)?.customer)?.fantasyName ??
      '';

    // No recorte, quem assina pelo cliente são os contatos DAQUELE cliente —
    // não todos os responsáveis da tarefa. Repetir a lista inteira poria o
    // contato de um cliente assinando embaixo da razão social do outro.
    //
    // O vínculo sai de `Responsible.companyId`, e não mais de um contato eleito
    // no pagador: o eleito era UM, então o recorte de um cliente com dois
    // contatos mostrava uma linha de assinatura onde deveria haver duas — e
    // mantê-lo em dia era trabalho manual que ninguém fazia.
    //
    // Sem nenhum contato vinculado àquele cliente, segue a regra de sempre (a
    // lista inteira): é o que já acontecia quando o campo eleito estava vazio, e
    // um documento sem linha de assinatura nenhuma seria pior.
    const todosOsContatos = dedupeResponsibles(
      quoteTasks(quote as any).flatMap((t: any) => t.responsibles ?? []),
    );
    const contatosDoSegmento = segment
      ? todosOsContatos.filter((r: any) => r.companyId === segment.customerId)
      : [];
    const responsibles = contatosDoSegmento.length ? contatosDoSegmento : todosOsContatos;
    const seeds: Array<{
      id: string;
      name: string;
      subtitle: string;
      side: 'ANKAA' | 'CUSTOMER';
    }> = responsibles.map(r => ({
      id: `unsigned-${r.id}`,
      name: r.name,
      subtitle: signatureSubtitle,
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
    // `withPaymentSchedule: true` — este é o CORPO LEGÍVEL, montado agora e
    // nunca selado. É o único caminho que imprime as parcelas e a chave Pix.
    const rendered = await this.renderQuoteDocument(
      quote,
      seeds,
      '',
      customerId,
      undefined,
      undefined,
      true,
      hideSignatureBlock,
    );
    // SEM faixa de rodapé. Ela existia para dar número de página ao orçamento
    // entregue solto, mas o documento já termina no rodapé da Ankaa (endereço,
    // telefone, site) — e uma linha de paginação DEPOIS dele fazia o último
    // elemento da folha ser um número, não a assinatura visual da empresa.
    // Sem coleta também não há envelope nem hash, que é o que dava à faixa do
    // assinado a sua razão de ser. Ver `stampSeals`, onde ela continua.
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
  /**
   * @param viewerUserId  Quem está OLHANDO. Opcional só para não quebrar
   *   chamadas internas sem contexto de sessão — vindo da rota, vem sempre.
   *
   *   Existe por causa de `podeContraAssinar`: a permissão de contra-assinar não
   *   é uma propriedade do envelope, é uma relação entre o envelope e QUEM
   *   pergunta. Sem o viewer, a resposta seria a mesma para todo mundo e a tela
   *   voltaria a oferecer o botão a quem leva 403.
   */
  async listForQuote(quoteId: string, viewerUserId?: string | null) {
    // O cadastro do veículo AGORA — é contra ele que as lacunas reservadas são
    // conferidas, para o painel poder avisar antes da contra-assinatura.
    const vehicle = await this.prisma.budget.findUnique({
      where: { id: quoteId },
      select: {
        // O estado do ORÇAMENTO, para o painel poder dizer que uma coleta
        // concluída e selada não virou aprovação. Ver `aprovacaoPendente`.
        status: true,
        tasks: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            createdAt: true,
            serialNumber: true,
            customerOrderNumber: true,
            truck: { select: { plate: true, chassisNumber: true } },
          },
        },
      },
    });

    const envelopes = await this.prisma.signatureEnvelope.findMany({
      where: { quoteId },
      orderBy: { version: 'desc' },
      include: {
        documents: {
          orderBy: [{ isFull: 'desc' }, { variantKey: 'asc' }],
          select: {
            id: true,
            variantKey: true,
            sections: true,
            isFull: true,
            originalSha256: true,
            finalSha256: true,
            padesLevel: true,
            sealedAt: true,
            contentPages: true,
            // Para o painel avisar, ANTES do clique, que a contra-assinatura vai
            // congelar uma lacuna vazia. Ver `pendingLateSlots`.
            lateSlots: true,
          },
        },
        signers: {
          orderBy: [{ orderGroup: 'asc' }, { createdAt: 'asc' }],
          // O cargo de CADASTRO. `informedCargo` só existe depois que a pessoa
          // assina, então sem estes includes o painel dizia "Cargo não
          // informado" para todo signatário pendente — inclusive o da Ankaa,
          // cujo cargo o sistema conhece desde sempre.
          include: {
            responsible: { select: { roles: true } },
            user: {
              select: {
                position: { select: { name: true } },
                sector: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const inviteEvents = await this.prisma.signatureAuditEvent.findMany({
      where: {
        envelopeId: { in: envelopes.map(e => e.id) },
        eventType: { in: ['INVITATION_SENT', 'INVITATION_FAILED'] },
      },
      orderBy: { sequence: 'asc' },
      select: { envelopeId: true, eventType: true, actorId: true, payload: true },
    });
    const inviteBySigner = new Map<string, string>();
    for (const ev of inviteEvents) {
      if (!ev.actorId) continue;
      // ─── SÓ CONVITE DE VERDADE ────────────────────────────────────────────
      //
      // `INVITATION_SENT` é o tipo de evento que registra TODO envio da
      // cerimônia, inclusive os que não são convite nenhum: o aviso de recusa ao
      // comercial, o de coleta pausada aos demais, o de contra-assinatura. Eles
      // se distinguem pelo `kind` do payload — que é justamente por isso que ele
      // existe —, e aqui ninguém o lia.
      //
      // Como o mapa guarda o ÚLTIMO evento de cada signatário, um aviso
      // posterior sobrescrevia o convite verdadeiro. O caso que dói é o
      // contrário do cosmético: um `INVITATION_FAILED` real — o painel dizendo
      // "Convite não entregue, envie o link manualmente" — era apagado pelo
      // aviso de pausa que saiu logo depois e que, esse sim, foi entregue. O
      // operador parava de ser avisado de que o link nunca chegou.
      //
      // E do lado da Ankaa era pior: o contra-assinante não assina por link e
      // nunca recebe convite, mas passava a exibir "Convite enviado · ainda não
      // abriu" assim que o aviso de recusa lhe era mandado.
      // Um convite de verdade não carrega `kind` (são os 27 do acervo); os
      // avisos carregam, e todos terminam em `_notice`. A regra é o SUFIXO mais
      // a lista explícita, para que um aviso novo que siga a convenção já entre
      // aqui sem ninguém lembrar de vir atualizar esta linha.
      const kind = (ev.payload as { kind?: unknown } | null)?.kind;
      const isNotice =
        typeof kind === 'string' &&
        (kind.endsWith('_notice') ||
          kind === 'collection_paused_notice' ||
          kind === 'refusal_notice' ||
          kind === 'countersign_notice');
      if (isNotice) continue;
      inviteBySigner.set(ev.actorId, ev.eventType);
    }

    const changesByEnvelope = await this.changesSinceFrozen(quoteId, envelopes);

    // ── QUEM PODE CONTRA-ASSINAR ────────────────────────────────────────────
    //
    // A regra é a MESMA de `countersign`, e tem de ser: a pessoa designada, ou
    // um administrador em nome dela (decisão do dono, 17/09). Duas escritas da
    // mesma regra divergiriam — e foi a ausência de qualquer resposta aqui que
    // fazia a tela oferecer o botão a um COMMERCIAL qualquer, que então tomava
    // 403 num orçamento que não é dele.
    //
    // Resolvida no SERVIDOR e não devolvida como matéria-prima ("aqui está o
    // userId, compare aí") porque o cliente não tem como saber se quem está
    // logado é ADMIN sem uma segunda chamada — e porque a regra vai mudar de
    // novo, e não deve mudar em três lugares.
    const viewer = viewerUserId
      ? await this.prisma.user.findUnique({
          where: { id: viewerUserId },
          select: { id: true, sector: { select: { privileges: true } } },
        })
      : null;
    const viewerEhAdmin = viewer?.sector?.privileges === 'ADMIN';

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
      /**
       * A COLETA CONCLUIU E O ORÇAMENTO NÃO APROVOU.
       *
       * O gancho de conclusão (`onCompleted` → `budgetApprove`) roda
       * best-effort dentro de `finalize`: falhando, ele só logava, e o
       * orçamento ficava PENDING com um contrato assinado e selado em cima.
       * Aconteceu três vezes no orçamento nº 591 e ninguém viu, porque o fato
       * não existia em nenhuma tela.
       *
       * CALCULADO NA LEITURA, como `changes`: é a comparação entre dois estados
       * que já existem, e uma coluna gravada envelheceria errado no minuto em
       * que alguém aprovasse o orçamento por outro caminho.
       *
       * A saída é `POST :id/reexecutar-conclusao` (`replayCompletion`).
       */
      aprovacaoPendente:
        env.status === EnvelopeStatus.COMPLETED &&
        !!env.finalFileId &&
        !!vehicle &&
        vehicle.status !== 'APPROVED' &&
        vehicle.status !== 'CANCELLED',
      originalSha256: env.originalSha256,
      finalSha256: env.finalSha256,
      padesLevel: env.padesLevel,
      sealedAt: env.sealedAt,
      /**
       * O ADITIVO de identificação do veículo, quando já emitido.
       *
       * Documento à parte, selado com o mesmo certificado, que declara o chassi e
       * a placa que só existiram depois da assinatura. Ver `issueVehicleAddendum`.
       */
      addendum: env.addendumFileId
        ? {
            sha256: env.addendumSha256,
            sealedAt: env.addendumSealedAt,
            padesLevel: env.addendumPadesLevel,
          }
        : null,
      /**
       * Lacunas de cadastro tardio ainda VAZIAS.
       *
       * Sai em DOIS estados, e a tela diz coisas diferentes em cada um:
       *
       *  · RUNNING — a contra-assinatura dispara o selo no mesmo segundo, e o
       *    que estiver vazio vai dizer "a registrar" no documento para sempre;
       *  · COMPLETED — a janela fechou, e o que falta sairá no ADITIVO quando o
       *    serviço for finalizado. Sem isto o painel ficava mudo entre o selo e
       *    a entrega, e o operador não tinha como saber que o sistema ainda ia
       *    resolver aquilo sozinho.
       *
       * Nos demais estados (cancelada, invalidada, substituída) não há artefato
       * a completar e a lista não significa nada.
       */
      pendingLateSlots:
        // `vehicle` só é nulo se o orçamento sumiu entre as duas consultas — o
        // que não deveria acontecer e, se acontecer, não pode derrubar a
        // listagem do painel com um TypeError. Sem cadastro para conferir, não
        // há pendência a afirmar.
        vehicle &&
        (env.status === EnvelopeStatus.RUNNING || env.status === EnvelopeStatus.COMPLETED)
          ? this.pendingLateSlots({ ...env, quote: vehicle as never })
          : [],
      /**
       * Os RECORTES congelados nesta coleta — um PDF cada.
       *
       * Vem sempre, mesmo quando é um só: a tela decide sozinha se vale desenhar
       * a lista, e devolver o campo só às vezes obrigaria o cliente a distinguir
       * "coleta antiga" de "coleta de um recorte", que são a mesma coisa aqui.
       */
      documents: env.documents.map(d => ({
        id: d.id,
        variantKey: d.variantKey,
        sections: this.sectionsOf(d),
        label: describeSections(this.sectionsOf(d)),
        isFull: d.isFull,
        originalSha256: d.originalSha256,
        finalSha256: d.finalSha256,
        padesLevel: d.padesLevel,
        sealedAt: d.sealedAt,
        signers: env.signers.filter(s => s.documentId === d.id).map(s => s.declaredName),
      })),
      signers: env.signers.map(s => ({
        id: s.id,
        name: s.declaredName,
        emailMasked: maskEmail(s.declaredEmail),
        email: s.declaredEmail,
        phoneMasked: maskPhone(s.declaredPhone),
        phone: s.declaredPhone,
        // Canal em que ESTA coleta foi emitida. A tela usa para rotular o botão
        // de reenvio e para escolher o fallback manual certo (mailto: vs wa.me)
        // — antes ela dizia "reenviar por e-mail" fosse qual fosse o canal.
        channel: channelForAuthMethod(s.authMethod),
        // Link pessoal, exposto SOMENTE na rota interna (ADMIN/COMMERCIAL/FINANCIAL).
        // Sem isto o operador não tinha como entregar o convite quando o envio
        // automático falha — e ele falha sempre que o endereço cadastrado está
        // errado ou o servidor de e-mail recusa a entrega.
        signingUrl: this.signingUrl(s.accessToken),
        cpfMasked: s.informedCpf ? maskCpf(s.informedCpf) : null,
        // Sem o recuo o painel dizia "Cargo não informado" para todo signatário
        // que ainda não assinou — inclusive o da Ankaa, cujo cargo o sistema
        // conhece desde sempre. Ver `displayCargoOf`.
        cargo: this.displayCargoOf(s),
        // A MESMA informação em lista, para o painel mostrar os dois primeiros
        // e um "+N". Um contato pode acumular nove funções, e a string pronta
        // não dá para cortar sem risco: o cargo informado no ato é texto livre
        // e pode conter vírgula ("Diretor, comercial e financeiro"), então
        // quebrá-la no cliente inventaria papéis que não existem.
        cargoList: s.informedCargo
          ? [s.informedCargo]
          : (s.responsible?.roles ?? []).length
            ? (s.responsible?.roles ?? []).map(
                r => RESPONSIBLE_ROLE_LABELS[r as RESPONSIBLE_ROLE] ?? r,
              )
            : // Mesma regra de `displayCargoOf`: do lado da Ankaa o recuo é o
              // título institucional, que é o que o documento congelado imprime.
              [this.displayCargoOf(s) ?? ''].filter(Boolean),
        cpfMatch: s.cpfMatch,
        side: s.orderGroup === 1 ? 'ANKAA' : 'CUSTOMER',
        /**
         * O usuário Ankaa por trás deste signatário. Nulo do lado do cliente,
         * que é `Responsible` e não `User`.
         *
         * Exposto para a tela poder DIZER de quem é a contra-assinatura ("cabe a
         * Sergio Rodrigues") — não para decidir o botão. Essa decisão é
         * `podeContraAssinar`, resolvida no servidor.
         */
        userId: s.userId,
        /**
         * ⚠️ O CAMPO QUE DECIDE O BOTÃO "Contra-assinar".
         *
         * `true` quando QUEM ESTÁ OLHANDO pode praticar o ato — a pessoa
         * designada, ou um administrador em nome dela. Antes disto a tela não
         * tinha como saber, oferecia o botão a todo mundo com acesso à página, e
         * quem não fosse o designado tomava 403 depois de clicar.
         *
         * É só a dimensão de PERMISSÃO. Se o momento é oportuno — coleta em
         * andamento, cliente já assinou, este signatário ainda pendente — a tela
         * lê de `status` do envelope e dos signatários, que já vêm aqui.
         */
        podeContraAssinar:
          s.orderGroup === 1 &&
          this.ceremonyKindOf(s.authMethod) === 'INTERNAL' &&
          !!viewer &&
          (viewerEhAdmin || (!!s.userId && s.userId === viewer.id)),
        /**
         * O selo desta contra-assinatura vai sair (ou saiu) SEM CPF.
         *
         * Só do lado da Ankaa: o do cliente é digitado no ato e conferido contra
         * o declarado. Aqui o CPF vem do cadastro do DP, e quando ele está vazio
         * o selo sai sem o documento do signatário — em silêncio, até 17/09.
         * Pendente, dá para corrigir o cadastro antes do clique; já assinado, é
         * definitivo e o que resta é não repetir.
         */
        cpfPendente: s.orderGroup === 1 && !s.informedCpf && !s.declaredCpf,
        /**
         * Como esta pessoa assina. `INTERNAL` é o lado da Ankaa, que
         * contra-assina no painel — a tela usa para desenhar o botão em vez do
         * "reenviar convite", que ali não faz sentido nenhum.
         */
        ceremony: this.ceremonyKindOf(s.authMethod),
        /** O recorte que ela recebeu, para o painel dizer quem viu o quê. */
        documentId: s.documentId,
        sections: this.sectionsOf(
          env.documents.find(d => d.id === s.documentId) ?? null,
        ),
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
  ): Promise<SignatureDeliveryResult> {
    const signer = await this.prisma.envelopeSigner.findUnique({
      where: { id: signerId },
      include: {
        envelope: {
          include: {
            quote: { include: { tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, createdAt: true } } } },
            signers: { select: { orderGroup: true, authMethod: true, status: true } },
          },
        },
      },
    });
    if (!signer) throw new NotFoundException('Signatário não encontrado.');
    if (signer.envelope.status !== EnvelopeStatus.RUNNING) {
      throw new BadRequestException('Esta coleta não está mais ativa.');
    }

    // O lado da Ankaa não tem convite a reenviar: ele não assina por link. O que
    // existe para ele é o AVISO de que o cliente terminou, e reenviá-lo antes
    // disso diria uma inverdade. Depois disso, `notifyAnkaaSigner` é o caminho —
    // e é ele que este ramo usa, para que a mensagem e a trilha continuem
    // saindo de um lugar só.
    if (this.ceremonyKindOf(signer.authMethod) === 'INTERNAL') {
      const pendingCustomer = signer.envelope.signers.filter(
        s => s.orderGroup === 0 && s.status !== EnvelopeSignerStatus.SIGNED,
      ).length;
      if (pendingCustomer > 0) {
        throw new BadRequestException(
          `Ainda há ${pendingCustomer} responsável(is) do cliente sem assinar. O aviso de ` +
            'contra-assinatura só é enviado quando todos concluírem.',
        );
      }
      await this.notifyAnkaaSigner(signer.envelopeId, signer.id);
      return { ok: true, reason: null };
    }

    // Canal do signatário, gravado na emissão. O reenvio NÃO relê
    // `SIGNATURE_DELIVERY_CHANNEL`: trocar o canal no meio de uma coleta viva
    // mandaria o link para um contato diferente daquele que o hash material
    // congelou, e a próxima conferência derrubaria o envelope.
    //
    // ⚠️ O SIGNATÁRIO DE PORTAL NÃO CARREGA CANAL. `RESPONSIBLE_SESSION` não é
    // e-mail nem WhatsApp, e `channelForAuthMethod` devolveria o padrão (EMAIL)
    // para ele — o reenvio de uma coleta de WhatsApp sairia por e-mail, com
    // "email" gravado na trilha append-only. Ele cai no canal de AVISO da
    // coleta, o mesmo de que a contra-assinatura se serve, e pela mesma razão.
    //
    // E o que ele recebe continua sendo o link: para quem assina pelo portal, a
    // página pública é onde se CONFERE o documento (`canSign: false` +
    // `portalNotice` explicam onde o ato acontece). É a mesma doutrina do lado
    // da Ankaa — token e página para ler, ato em outro lugar.
    const channel = this.deliveryChannelFor(signer, signer.envelope.signers);

    // ═══════════════════════════════════════════════════════════════════════
    // REENVIAR A QUEM RECUSOU É PEDIR DE NOVO — e reabre a vez dele
    // ═══════════════════════════════════════════════════════════════════════
    //
    // `assertSignable` barra signatário `REFUSED` ("este link não está mais
    // válido"), então sem esta reabertura o reenvio entregaria um link morto: o
    // contato receberia a mensagem, clicaria e bateria num erro.
    //
    // É deliberado que o gesto do operador seja o MESMO de reenviar. Recusar não
    // é um estado que a Ankaa desfaz por conta própria — é o cliente que muda de
    // ideia. O que o reenvio faz é devolver a ele a possibilidade de decidir,
    // depois de uma conversa que aconteceu fora do sistema.
    //
    // `refusedAt` e `refusalReason` FICAM. Eles são o registro de um ato que
    // aconteceu, a trilha de auditoria já o gravou, e apagá-los faria o painel
    // esquecer por que a coleta parou. A tela lê os dois como histórico e o
    // `status` como estado — que é a distinção certa.
    if (signer.status === EnvelopeSignerStatus.REFUSED) {
      await this.prisma.envelopeSigner.update({
        where: { id: signer.id },
        data: { status: EnvelopeSignerStatus.PENDING },
      });
      await this.audit.recordBestEffort(signer.envelopeId, {
        eventType: 'SIGNER_REOPENED',
        actorType: 'OPERATOR',
        actorId: actorUserId,
        actorLabel: signer.declaredName,
        payload: {
          kind: 'refusal_reopened',
          // O motivo entra na trilha de novo, aqui: quem auditar a reabertura
          // precisa ver CONTRA O QUÊ ela foi feita sem ter de cruzar eventos.
          previousRefusalReason: signer.refusalReason ?? null,
        },
      });
      this.logger.log(
        `Signatário ${signer.id} reaberto após recusa — envelope ${signer.envelopeId}.`,
      );
    }

    const invitation = {
      signerName: signer.declaredName,
      budgetNumber: signer.envelope.quote.budgetNumber,
      signingUrl: this.signingUrl(signer.accessToken),
      deadlineDate: this.deadlineLabel(signer.envelope.deadlineAt),
      isResend: true,
    };

    const delivery = await this.deliverToSigner({
      signer,
      channel,
      email: generateSignatureInvitationEmail(invitation),
      whatsapp: generateSignatureInvitationWhatsApp(invitation),
      whatsappPreview: this.signingLinkPreview(
        signer.envelope.quote.budgetNumber,
        invitation.signingUrl,
        'invite',
      ),
      whatsappTemplate: resendTemplate({
        signerName: signer.declaredName,
        budgetNumber: signer.envelope.quote.budgetNumber,
        deadlineDate: invitation.deadlineDate,
        accessToken: signer.accessToken,
      }),
      kind: 'SIGNATURE_INVITATION_RESEND',
    });

    await this.audit.record(signer.envelopeId, {
      eventType: delivery.ok ? 'INVITATION_SENT' : 'INVITATION_FAILED',
      actorType: 'OPERATOR',
      actorId: signer.id,
      actorLabel: signer.declaredName,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      payload: {
        channel: auditChannelOf(channel),
        destination: this.maskContactFor(signer, channel),
        resentBy: actorUserId,
        ...(delivery.reason ? { failureReason: delivery.reason } : {}),
      },
    });
    return delivery;
  }

  /** Canal em que uma coleta foi emitida — para a mensagem de retorno da rota. */
  async channelOfSigner(signerId: string): Promise<SignatureDeliveryChannel> {
    const signer = await this.prisma.envelopeSigner.findUnique({
      where: { id: signerId },
      select: { authMethod: true },
    });
    return channelForAuthMethod(signer?.authMethod);
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

  /**
   * A tela interna do orçamento. É por ela que a Ankaa contra-assina.
   *
   * Chaveada pelo id da TAREFA, que é como a rota do web é definida
   * (`/financeiro/orcamento/detalhes/:taskId`). Sem tarefa — orçamento órfão,
   * que existe no histórico — devolve a raiz do módulo, que ao menos põe a
   * pessoa no lugar certo para procurar.
   */
  /**
   * O sufixo do botão "Abrir o orçamento" dos templates INTERNOS.
   *
   * O template guarda `https://…/financeiro/orcamento/detalhes/{{1}}` e só o id
   * viaja — o mesmo desenho do botão do cliente, onde só o token viaja.
   *
   * ⚠️ A TELA INTERNA É ENDEREÇADA PELA TAREFA, não pelo orçamento, e há
   * orçamento sem tarefa: 6 dos 47 envelopes em produção hoje, todos de
   * julho/agosto, dois números só (883 e 945). Nesses o botão cai no id do
   * orçamento e a tela não encontra nada — um beco, mas um beco RARO e
   * herdado, e a alternativa (não mandar botão nenhum) piora os outros 41.
   * O conserto de verdade é a rota do web aceitar o id do orçamento; enquanto
   * não existe, o parâmetro nunca vai vazio, que é o que a Meta recusaria.
   */
  private internalQuoteButtonParam(taskId: string | null, quoteId: string): string {
    return taskId ?? quoteId;
  }

  private internalQuoteUrl(taskId: string | null): string {
    return taskId
      ? `${this.webBase()}/financeiro/orcamento/detalhes/${taskId}`
      : `${this.webBase()}/financeiro/orcamento`;
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
    quote: {
      budgetNumber: number;
      tasks?: Array<{
        id: string;
        createdAt?: Date | null;
        customer?: { fantasyName?: string } | null;
      }> | null;
    },
    pdf: Buffer,
    /**
     * Rótulo do arquivo no disco. Aceita sufixo de RECORTE
     * (`original-sem-layout`, `assinado-layout`): a coleta congela um PDF por
     * recorte, e nomes iguais os fariam disputar o mesmo caminho.
     */
    kind: `original${string}` | `assinado${string}` | 'dossie' | 'aditivo',
    verificationCode: string,
  ): Promise<string> {
    // O caminho vem do FilesStorageService, não de um sanitizador local.
    //
    // Este método montava a pasta na mão com um sanitizador próprio — tirava acentos e
    // toda pontuação. Ele DISCORDA do resto do sistema para 78 dos 231 clientes, e o
    // resultado é uma segunda pasta do mesmo cliente: "53842320 Kennedy de Campos
    // Teixeira" (criada aqui) ao lado de "53.842.320 Kennedy de Campos Teixeira" (onde
    // moram checkin, checkout, layouts e base files do mesmo cliente). Enquanto o
    // orçamento era renderizado sob demanda isso atingia um punhado de PDFs; com o
    // documento PERSISTIDO para assinatura, atingiria um terço da base de clientes.
    //
    // `generateFilePath` também garante nome único (sufixo anti-colisão), cria o
    // diretório com a permissão certa e devolve caminho ABSOLUTO — `FILES_ROOT` é
    // `./files` em dev, e um caminho relativo ao cwd estourava ENOENT em qualquer
    // processo iniciado de outro diretório (cron, script, worker).
    const customerName = primaryTask(quote)?.customer?.fantasyName ?? 'Sem Cliente';
    const baseName =
      kind === 'dossie'
        ? `dossie_${quote.budgetNumber}_${verificationCode}.pdf`
        : kind === 'aditivo'
          ? `aditivo_${quote.budgetNumber}_${verificationCode}.pdf`
          : `orcamento_${quote.budgetNumber}_${verificationCode}_${kind}.pdf`;

    const path = this.filesStorage.generateFilePath(
      baseName,
      kind === 'dossie' ? 'budgetDossiers' : 'budgetSignatures',
      'application/pdf',
      undefined,
      undefined,
      undefined,
      undefined,
      customerName,
    );
    await this.filesStorage.ensureDirectory(dirname(path));
    writeFileSync(path, pdf);

    const file = await this.prisma.file.create({
      data: {
        filename: basename(path),
        originalName:
          kind === 'dossie'
            ? `Dossiê ${quote.budgetNumber}.pdf`
            : kind === 'aditivo'
              ? `Aditivo ${quote.budgetNumber}.pdf`
              : `Orçamento ${quote.budgetNumber} — ${kind}.pdf`,
        mimetype: 'application/pdf',
        path,
        size: pdf.length,
      },
    });
    return file.id;
  }
}
