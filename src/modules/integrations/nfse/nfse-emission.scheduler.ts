import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { NfseService } from './nfse.service';
import { ElotechOxyNfseService } from './elotech-oxy-nfse.service';
import { buildNfseCustomer, NFSE_CUSTOMER_SELECT } from './nfse-tomador.mapper';
import { NfseStatus } from '@prisma/client';
import { NFSE_LIVE_STATUSES } from '@constants';
import { orderNumberLabel } from '../../../utils/quote-tasks';
import { missingCoverageError, resolveCoveredVehicles } from '../../../utils/nfse-coverage';
import { BILLING_FROZEN_WHERE } from '../../../modules/production/budget/budget.guards';
import { billingDeepLinkForInvoice } from '../../../utils/billing-links';

/**
 * Scheduler for automatic NFS-e emission.
 *
 * Uses the Elotech OXY municipal REST API (Ibiporã) for emission.
 * The national SEFIN integration is preserved but disabled until the city migrates.
 *
 * Runs a daily job at 9 AM to emit PENDING NFS-e documents.
 * Also retries ERROR documents that have passed their retryAfter window (max 3 attempts).
 */
/**
 * The discount the NFS-e must carry, derived from the INVOICE TOTAL and not from
 * the declared `discountType` / `discountValue`.
 *
 * Those two columns are a UI convenience, not the source of truth: production
 * configs routinely carry `subtotal > total` while `discountType` is `'NONE'` and
 * `discountValue` is null, because the total was edited directly instead of
 * through the discount fields. Reading only the declared pair then emits the note
 * for the PRE-discount sum of the service lines. NF 3139 (Nutrymax) went out at
 * R$ 12.765,00 against an invoice of R$ 11.871,45 — R$ 893,55 of service value
 * invoiced, and taxed, that was never charged to the customer and never collected
 * by the boleto.
 *
 * The invoice total is what the customer owes and what the boleto collects, so the
 * gap between the line-item sum and that total IS the discount, however it was
 * entered. Expressing it as FIXED_VALUE makes the emitted net land exactly on
 * `invoice.totalAmount` (see the `targetCents` note in
 * `elotech-oxy-nfse.service.ts`) — a PERCENTAGE can only approximate it after
 * rounding. The declared pair is still the fallback when there are no line items
 * to measure against.
 */
const resolveGlobalDiscount = (
  services: { amount: number }[] | undefined,
  invoiceTotal: number,
  declaredType: string | undefined,
  declaredValue: number | undefined,
  /**
   * QUANTOS VEÍCULOS a fatura cobre — a quantidade de cada linha.
   *
   * O desconto é a diferença entre o que as linhas somam e o que a fatura cobra,
   * e as linhas só somam o valor da fatura depois de multiplicadas pelos
   * veículos cobertos (`svc.amount` é o preço de UM). Medir sobre o unitário
   * fazia o `gap` ficar NEGATIVO em toda fatura de mais de um veículo — e o
   * ramo do negativo devolve o desconto declarado sem acusar nada, que é
   * exatamente como uma nota de um caminhão saía contra um boleto de sessenta.
   */
  quantity = 1,
): { type: string; value: number } | undefined => {
  const declared =
    declaredType && declaredType !== 'NONE' && declaredValue
      ? { type: declaredType, value: declaredValue }
      : undefined;
  if (!services || services.length === 0) return declared;
  const qty = Math.max(1, Math.trunc(Number(quantity ?? 1)) || 1);
  const linesSum = Number(services.reduce((s, x) => s + x.amount * qty, 0).toFixed(2));
  if (linesSum <= 0) return declared;
  const gap = Number((linesSum - invoiceTotal).toFixed(2));
  // No gap leaves whatever was declared in charge. Um gap NEGATIVO — as linhas
  // somam menos do que a fatura cobra — não é desconto nenhum e significa que a
  // nota sairia abaixo do cobrado; `emitNfse` tem a trava que recusa isso, e
  // devolver o declarado aqui só evita inventar um desconto para esconder.
  if (gap <= 0.005) return declared;
  return { type: 'FIXED_VALUE', value: gap };
};


@Injectable()
export class NfseEmissionScheduler {
  private readonly logger = new Logger(NfseEmissionScheduler.name);
  private isProcessing = false;
  private isRecovering = false;
  private isReconcilingCancellations = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfseService: NfseService,
    private readonly municipalNfseService: ElotechOxyNfseService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * PARA a emissão deste documento com uma recusa DEFINITIVA.
   *
   * `retryAfter: null` porque o motivo não se resolve sozinho — é o mesmo
   * protocolo da recusa por cadastro incompleto do tomador
   * (`elotech-oxy-nfse.service.ts`). Sem parar aqui, o documento voltaria PENDENTE
   * à varredura das 09:00 todos os dias, para falhar pela mesma razão.
   */
  private async parkNfseDocumentAsError(docId: string, errorMessage: string): Promise<void> {
    await this.prisma.nfseDocument.update({
      where: { id: docId },
      data: {
        status: NfseStatus.ERROR,
        errorMessage: errorMessage.slice(0, 1000),
        errorCount: { increment: 1 },
        retryAfter: null,
      },
    });
  }

  /**
   * Emit nfse.issued (AUTHORIZED) or nfse.rejected (ERROR) to FINANCIAL/ADMIN.
   * Best-effort — never breaks the emission flow. Deep link keyed by taskId.
   */
  private async dispatchNfseOutcomeNotification(
    invoiceId: string,
    outcome: 'AUTHORIZED' | 'ERROR',
    detail?: { nfseNumber?: number | string | null; errorMessage?: string | null },
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true } },
          externalOperation: { select: { id: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskId = invoice.task?.id ?? invoice.taskId ?? null;
      const withdrawalId = invoice.externalOperation?.id ?? invoice.externalOperationId ?? null;
      const isWithdrawal = !!withdrawalId;
      const taskName = isWithdrawal ? 'Operação Externa' : invoice.task?.name || 'N/A';
      // "da tarefa X" for task-backed invoices, "da operação externa" for withdrawal-backed.
      const refLabel = isWithdrawal ? 'da operação externa' : `da tarefa ${taskName}`;

      // A fatura conjunta e o lote têm `Invoice.taskId` NULO por construção
      // (`sliceAnchorTaskId` só o preenche quando a cobertura tem UM veículo), e o
      // link ia para `/detalhes/null` — tela morta. `billingDeepLinkForInvoice`
      // resolve pela COBERTURA e nunca devolve nulo.
      const billingLink = isWithdrawal
        ? null
        : await billingDeepLinkForInvoice(this.prisma as any, invoice.id);
      const webUrl = isWithdrawal
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : billingLink!.web;
      const mobileUrl = isWithdrawal
        ? `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : billingLink!.mobile;

      if (outcome === 'AUTHORIZED') {
        await this.dispatchService.dispatchByConfiguration('nfse.issued', 'system', {
          entityType: 'NfseDocument',
          entityId: taskId ?? withdrawalId ?? invoiceId,
          action: 'issued',
          data: {
            customerName,
            taskName,
            nfseNumber: detail?.nfseNumber ?? 'N/A',
            invoiceId,
            taskId: taskId || undefined,
            externalOperationId: withdrawalId || undefined,
          },
          overrides: {
            title: 'NFS-e Emitida',
            body: `A NFS-e${detail?.nfseNumber ? ` Nº ${detail.nfseNumber}` : ''} ${refLabel} (${customerName}) foi autorizada.`,
            relatedEntityType: 'NFSE',
            ...(webUrl ? { webUrl } : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
          },
        });
      } else {
        await this.dispatchService.dispatchByConfiguration('nfse.rejected', 'system', {
          entityType: 'NfseDocument',
          entityId: taskId ?? withdrawalId ?? invoiceId,
          action: 'rejected',
          data: {
            customerName,
            taskName,
            errorMessage: detail?.errorMessage || 'N/A',
            invoiceId,
            taskId: taskId || undefined,
            externalOperationId: withdrawalId || undefined,
          },
          overrides: {
            title: 'NFS-e Rejeitada',
            body: `A emissão da NFS-e ${refLabel} (${customerName}) foi rejeitada.${detail?.errorMessage ? `\nMotivo: ${detail.errorMessage}` : ''}`,
            relatedEntityType: 'NFSE',
            ...(webUrl ? { webUrl } : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Falha ao notificar resultado de NFS-e (${outcome}) para fatura ${invoiceId}:`,
        error,
      );
    }
  }

  /**
   * Rescue documents stranded in PROCESSING — deliberately NOT behind
   * `NFSE_SCHEDULER_ENABLED`.
   *
   * That flag gates BULK AUTO-EMISSION, which mints live municipal notes and must stay
   * opt-in. Recovery mints nothing: it reads the prefeitura's live state and either links
   * a note that already exists or rewinds the document to PENDING. Leaving recovery
   * behind the emission flag is what turned a 5-second crash window into an invoice
   * stuck in "Processando" with no error, no retry and no button — `emitNfse` refuses a
   * PROCESSING doc by design, so nothing could move it.
   *
   * Runs every 10 minutes against docs untouched for >5 minutes: emission takes seconds,
   * so anything older than that lost its process.
   */
  @Cron('*/10 * * * *', {
    name: 'nfse-stuck-recovery',
    timeZone: 'America/Sao_Paulo',
  })
  async recoverStuckNfseDocuments(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    if (this.isRecovering) {
      this.logger.warn('[NFSE_RECOVERY] Already running, skipping');
      return;
    }
    this.isRecovering = true;

    try {
      const stuckThreshold = new Date(Date.now() - 5 * 60 * 1000);
      const stuck = await this.prisma.nfseDocument.findMany({
        where: {
          status: NfseStatus.PROCESSING,
          updatedAt: { lt: stuckThreshold },
          invoice: { is: { status: { not: 'CANCELLED' } } },
        },
        select: { id: true, invoiceId: true, createdAt: true },
      });

      if (stuck.length === 0) return;

      this.logger.warn(
        `[NFSE_RECOVERY] ${stuck.length} document(s) stranded in PROCESSING — reconciling against the prefeitura`,
      );

      for (const doc of stuck) {
        try {
          const result = await this.municipalNfseService.reconcileStuckDocument(doc.id);
          this.logger.log(`[NFSE_RECOVERY] ${doc.id}: ${result.outcome} — ${result.message}`);

          // AMBIGUOUS is the only outcome a human must resolve. Park it as ERROR so it
          // surfaces in the UI with the reason, and push retryAfter out so the emission
          // sweep never silently re-emits it.
          if (result.outcome === 'AMBIGUOUS') {
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: {
                status: NfseStatus.ERROR,
                errorMessage: result.message,
                errorCount: 3,
                retryAfter: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
              },
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`[NFSE_RECOVERY] ${doc.id} failed: ${message}`);
          // Could not reach the prefeitura — leave it PROCESSING so the next pass retries.
          // Parking it as ERROR here would hide a note that may well be live.
        }
      }
    } catch (error) {
      this.logger.error(
        `[NFSE_RECOVERY] Sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isRecovering = false;
    }
  }

  @Cron('0 9 * * *', {
    name: 'nfse-emission',
    timeZone: 'America/Sao_Paulo',
  })
  async emitPendingNfses(): Promise<void> {
    if (process.env.NFSE_SCHEDULER_ENABLED !== 'true') {
      this.logger.log('NFSe scheduler disabled (NFSE_SCHEDULER_ENABLED!=true)');
      return;
    }

    if (this.isProcessing) {
      this.logger.warn('NFS-e emission already in progress, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      this.logger.log('Starting NFS-e emission job...');

      const now = new Date();

      // Docs stranded in PROCESSING are handled by `recoverStuckNfseDocuments()` above,
      // which runs every 10 minutes and is NOT gated behind NFSE_SCHEDULER_ENABLED.
      // It reconciles against the prefeitura's live state — linking a note that already
      // exists, or rewinding to PENDING when nothing was minted — and only parks a doc as
      // ERROR when two live notes genuinely tie. Blanket-parking every stuck doc as ERROR
      // here (the previous behaviour) left invoices with no exit even when the live state
      // was unambiguous.

      // Find NfseDocuments that are PENDING, or ERROR with retryAfter passed and < 3 errors.
      // I33: NEVER emit a note for a CANCELLED invoice or an opted-out customer
      // (generateInvoice=false). The note's lifecycle is owned by an ACTIVE/billable invoice;
      // a doc still PENDING/ERROR against a cancelled invoice (or one whose customer opted out)
      // must not mint a live municipal note. The flag lives on customerConfig (task-backed) or
      // on the externalOperation (withdrawal-backed) — exclude either opt-out.
      const pendingDocs = await this.prisma.nfseDocument.findMany({
        where: {
          invoice: {
            is: {
              status: { not: 'CANCELLED' },
              // Exclude opt-outs: customer config OR external operation with generateInvoice=false.
              customerConfig: { isNot: { generateInvoice: false } },
              externalOperation: { isNot: { generateInvoice: false } },
              // ── SÓ SOBRE COBRANÇA QUE DE FATO FOI APROVADA ────────────────
              //
              // `generateInvoicesForTaskDetailed` COMMITA a própria transação, e
              // só DEPOIS dela as guardas de `internalApprove` podem lançar
              // (pagador sem condição de pagamento, divergência de valor, falha
              // da cascata). O rollback de lá levanta o CARIMBO — não apaga a
              // fatura nem este `NfseDocument` PENDING. Sem este filtro, o cron
              // das 09:00 emitia na prefeitura a nota de uma cobrança que a tela
              // acabara de dizer ao operador que NÃO foi aprovada.
              //
              // A retirada externa não tem `Billing` e continua passando pelo
              // ramo dela — daí o OR, e não um AND direto.
              OR: [
                { customerConfig: { is: { billing: { is: BILLING_FROZEN_WHERE } } } },
                { externalOperationId: { not: null } },
              ],
            },
          },
          OR: [
            { status: NfseStatus.PENDING },
            {
              status: NfseStatus.ERROR,
              errorCount: { lt: 3 },
              retryAfter: { lte: now },
            },
          ],
        },
        include: {
          invoice: {
            include: {
              customer: { select: NFSE_CUSTOMER_SELECT },
              task: {
                select: {
                  id: true,
                  name: true,
                  serialNumber: true,
                  truck: {
                    select: {
                      plate: true,
                      chassisNumber: true,
                      category: true,
                      implementType: true,
                    },
                  },
                  quote: {
                    select: {
                      services: {
                        select: {
                          description: true,
                          observation: true,
                          amount: true,
                          invoiceToCustomerId: true,
                        },
                        orderBy: { position: 'asc' as const },
                      },
                    },
                  },
                },
              },
              // O ORÇAMENTO da nota, pelo vínculo direto (`NfseDocument.quoteId`) e
              // pela configuração de faturamento. É por aqui que a nota CONJUNTA
              // — a que cobre os sessenta caminhões e por isso tem
              // `Invoice.taskId` nulo — encontra os serviços e os veículos.
              customerConfig: {
                select: {
                  discountType: true,
                  discountValue: true,
                  responsible: { select: { email: true, phone: true, roles: true } },
                  // A COBERTURA DESTA FATURA — de quais VEÍCULOS ela é.
                  //
                  // Era a coluna `taskId` da fatia, nula querendo dizer "todos". Virou
                  // relação porque uma fatura pode cobrir um lote — vinte dos sessenta —, e
                  // nesse caso não existe coluna que responda. Leia por `sliceTask()` /
                  // `coveredTaskIds()` de `@utils/quote-tasks`.
                  billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } },
                  quote: {
                    select: {
                      id: true,
                      budgetNumber: true,
                      billingSplit: true,
                      services: {
                        select: {
                          description: true,
                          observation: true,
                          amount: true,
                          invoiceToCustomerId: true,
                        },
                        orderBy: { position: 'asc' as const },
                      },
                      tasks: {
                        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
                        select: {
                          id: true,
                          name: true,
                          serialNumber: true,
                          // O NÚMERO DO PEDIDO DE COMPRA é do VEÍCULO: a nota
                          // conjunta cita o de todos os que ela cobre.
                          customerOrderNumber: true,
                          truck: {
                            select: {
                              plate: true,
                              chassisNumber: true,
                              category: true,
                              implementType: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              externalOperation: {
                include: {
                  services: { orderBy: { position: 'asc' as const } },
                  items: { include: { item: { select: { name: true } } } },
                },
              },
            },
          },
        },
      });

      this.logger.log(`Found ${pendingDocs.length} NFS-e document(s) to emit`);

      let emitted = 0;
      let errors = 0;

      for (const doc of pendingDocs) {
        try {
          // H3c: the atomic claim (PENDING/ERROR → PROCESSING, proceed only when
          // count === 1) lives INSIDE municipalNfseService.emitNfse() — the single
          // claim authority for both this sweep and the targeted emission path.
          // A doc claimed by another process comes back as { skipped: true }.

          const invoice = doc.invoice;
          if (!invoice) {
            this.logger.warn(`NfseDocument ${doc.id} has no invoice, skipping`);
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No invoice linked' },
            });
            continue;
          }

          const customer = invoice.customer;
          if (!customer) {
            this.logger.warn(`NfseDocument ${doc.id} has no customer, skipping`);
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No customer linked' },
            });
            continue;
          }

          const task = invoice.task;
          const withdrawal = (invoice as any).externalOperation;
          const isWithdrawal = !!invoice.externalOperationId;
          // Fatura sem tarefa é ESPERADO em dois casos: "Operação Externa" e a
          // nota CONJUNTA de um orçamento multitarefa, em que `Invoice.taskId` é
          // nulo de propósito (a nota cobre os sessenta caminhões e não é de
          // nenhum deles). O que não pode faltar é o vínculo com o ORÇAMENTO —
          // sem ele não há serviço nem veículo para discriminar, e marcar ERROR
          // é a resposta certa.
          const hasQuoteContext = !!(invoice as any).customerConfig?.quote;
          if (!task && !isWithdrawal && !hasQuoteContext) {
            this.logger.warn(`NfseDocument ${doc.id} has no task, skipping`);
            await this.prisma.nfseDocument.update({
              where: { id: doc.id },
              data: { status: NfseStatus.ERROR, errorMessage: 'No task linked' },
            });
            continue;
          }

          let emitTask: { id: string; name: string; serialNumber?: string };
          let emitTruck:
            | {
                plate?: string;
                chassisNumber?: string;
                category?: string;
                implementType?: string;
              }
            | undefined;
          let services: { description: string; amount: number }[] | undefined;
          let orderNumber: string | undefined;
          let globalDiscount: { type: string; value: number } | undefined;
          /** Todos os veículos que a nota cobre — ver `ElotechInvoiceInput.vehicles`. */
          let emitVehicles:
            | Array<{
                serialNumber?: string | null;
                plate?: string | null;
                chassisNumber?: string | null;
                category?: string | null;
                implementType?: string | null;
              }>
            | undefined;
          let emitBudgetNumber: number | null = null;
          /** Quantos veículos cada linha de serviço cobre. Operação Externa = 1. */
          let emitServiceQuantity = 1;

          if (isWithdrawal) {
            // Operação Externa: discriminate services + withdrawn items; no truck/order/discount.
            emitTask = { id: invoice.externalOperationId!, name: 'Operação Externa' };
            emitTruck = undefined;
            orderNumber = undefined;
            globalDiscount = undefined;
            services = [
              ...((withdrawal?.services ?? []) as any[]).map((s: any) => ({
                description: s.description as string,
                amount: Number(s.amount),
              })),
              ...((withdrawal?.items ?? []) as any[]).map((i: any) => ({
                description: `${i.item?.name ?? 'Item'} - ${i.withdrawedQuantity} un`,
                amount: Number(i.price ?? 0) * i.withdrawedQuantity,
              })),
            ];
          } else {
            // O ORÇAMENTO da nota. Vem pela configuração de faturamento, e não
            // pela tarefa: numa nota CONJUNTA `Invoice.taskId` é nulo de
            // propósito (ela não é de nenhum dos sessenta caminhões em
            // particular) e `task` aqui é null. Ler os serviços por
            // `task.quote` deixaria a nota conjunta sem nenhum item de serviço —
            // a Elotech receberia uma linha só, com a descrição de fallback.
            const nfseQuote =
              ((invoice as any).customerConfig?.quote ?? (task as any)?.quote) ?? null;

            // Build services list from task quote, filtered by customer
            const allServices = nfseQuote?.services as
              | Array<{
                  description: string;
                  observation: string | null;
                  amount: any;
                  invoiceToCustomerId: string | null;
                }>
              | undefined;

            services = allServices
              ?.filter(s => !s.invoiceToCustomerId || s.invoiceToCustomerId === customer.id)
              .map(s => ({
                // "Outros" is a generic catch-all description; the real service text
                // lives in the observation. Use it so Elotech gets the actual service
                // instead of the literal word "Outros".
                description:
                  s.description === 'Outros' && s.observation?.trim()
                    ? s.observation.trim()
                    : s.description,
                amount: Number(s.amount),
              }));

            // Get customer config discount (global discount for this customer)
            const customerConfig = (invoice as any).customerConfig;
            const configDiscountType = customerConfig?.discountType || undefined;
            const configDiscountValue =
              customerConfig?.discountValue != null
                ? Number(customerConfig.discountValue)
                : undefined;

            // OS VEÍCULOS QUE ESTA NOTA COBRE — lidos da cobertura, uma vez, e
            // usados por tudo o que fala deles: a discriminação, o nº do pedido
            // e a âncora do rótulo.
            const quoteTaskRows = (nfseQuote?.tasks ?? []) as Array<any>;
            const coverage = resolveCoveredVehicles(
              (invoice as any).customerConfig,
              quoteTaskRows,
              task as any,
            );
            // Cobertura que FALTA não vira "todos os veículos" — ver
            // `missingCoverageError`. A nota não sai; o documento para em ERROR.
            const coverageError = missingCoverageError(customerConfig, coverage);
            if (coverageError) {
              errors++;
              this.logger.error(
                `NfseDocument ${doc.id} recusado — ${coverageError} (fatura ${invoice.id})`,
              );
              await this.parkNfseDocumentAsError(doc.id, coverageError);
              await this.dispatchNfseOutcomeNotification(invoice.id, 'ERROR', {
                errorMessage: coverageError,
              });
              continue;
            }
            const coveredRows = coverage.rows;
            // A tarefa da FATIA: a PRIMEIRA que esta nota cobre. Serve de
            // contexto (rótulo de fallback, placa do cabeçalho); quais veículos a
            // nota cobre é `emitVehicles`, abaixo. Era `quoteTaskRows[0]` — o
            // primeiro do ORÇAMENTO —, que num lote é um caminhão de outra nota.
            const sliceTask = (task as any) ?? coveredRows[0] ?? quoteTaskRows[0] ?? null;
            const truck = sliceTask?.truck;
            emitTask = {
              id: sliceTask?.id ?? invoice.id,
              name: sliceTask?.name ?? `Orçamento ${nfseQuote?.budgetNumber ?? ''}`.trim(),
              serialNumber: sliceTask?.serialNumber || undefined,
            };
            emitTruck = truck
              ? {
                  plate: truck.plate || undefined,
                  chassisNumber: truck.chassisNumber || undefined,
                  category: truck.category || undefined,
                  implementType: truck.implementType || undefined,
                }
              : undefined;

            // A DISCRIMINAÇÃO. Cobertura de um veículo ⇒ sai idêntica à de
            // sempre; de N ⇒ declara a contagem e a faixa de séries dos N que
            // esta nota cobra — nunca dos que estão noutra nota do mesmo
            // orçamento.
            emitVehicles = coveredRows.map((t: any) => ({
              serialNumber: t.serialNumber ?? null,
              plate: t.truck?.plate ?? null,
              chassisNumber: t.truck?.chassisNumber ?? null,
              category: t.truck?.category ?? null,
              implementType: t.truck?.implementType ?? null,
              // O pedido de compra é DA TAREFA: numa fatura conjunta os veículos
              // podem ter pedidos diferentes, e a discriminação cita o de cada um.
              orderNumber: t.customerOrderNumber ?? null,
            }));
            emitBudgetNumber = nfseQuote?.budgetNumber ?? null;

            // O pedido de compra dos VEÍCULOS DESTA fatura — o do caminhão
            // quando ela cobra um; os do lote quando cobra vinte. É o campo em
            // que a Elotech procura o empenho, e citar o pedido de um caminhão
            // que está noutra nota é errar de nota.
            // `240` e não sem limite: a discriminação tem teto de 11 LINHAS de 255
            // caracteres, e o cabeçalho (pedido + veículos) disputa essas linhas
            // com a lista de serviços — que é o que o fiscal e o cliente leem.
            // Vinte pedidos numa linha só passavam de mil caracteres.
            orderNumber = orderNumberLabel(coveredRows, 240) ?? undefined;
            // A QUANTIDADE de cada linha: os veículos que esta nota cobre. É o
            // mesmo multiplicador que `Invoice.totalAmount` já carrega
            // (`por veículo × cobertos`), e é o que faz a nota fechar com o boleto.
            emitServiceQuantity = Math.max(1, coveredRows.length);
            globalDiscount = resolveGlobalDiscount(
              services,
              Number(invoice.totalAmount),
              configDiscountType,
              configDiscountValue,
              emitServiceQuantity,
            );
          }

          // Build the input for municipal NFSe emission (Elotech OXY)
          const emitInput = {
            id: invoice.id,
            totalAmount: Number(invoice.totalAmount),
            customer: buildNfseCustomer(customer, (invoice as any).customerConfig?.responsible),
            task: emitTask,
            truck: emitTruck,
            vehicles: emitVehicles,
            budgetNumber: emitBudgetNumber,
            orderNumber,
            services,
            serviceQuantity: emitServiceQuantity,
            globalDiscount,
          };

          const result = await this.municipalNfseService.emitNfse(emitInput);

          if ((result as any)?.skipped) {
            this.logger.warn(
              `NfseDocument ${doc.id} skipped (${(result as any)?.reason ?? 'claimed by another process'})`,
            );
            continue;
          }
          emitted++;

          this.logger.log(
            `NFS-e emitted for invoice ${invoice.id} (${isWithdrawal ? 'operação externa' : `task: ${task?.name}`})`,
          );

          // Notify FINANCIAL/ADMIN of the emission outcome. emitNfse returns
          // { status: 'AUTHORIZED' | 'ERROR' | skipped }. Skip notifying on no-op skips.
          if ((result as any)?.status === 'AUTHORIZED') {
            await this.dispatchNfseOutcomeNotification(invoice.id, 'AUTHORIZED', {
              nfseNumber: (result as any)?.nfseNumber ?? null,
            });
          } else if ((result as any)?.status === 'ERROR') {
            await this.dispatchNfseOutcomeNotification(invoice.id, 'ERROR', {
              errorMessage: (result as any)?.errorMessage ?? null,
            });
          }
        } catch (error) {
          errors++;
          const errorMessage = error instanceof Error ? error.message : String(error);

          this.logger.error(`Failed to emit NFS-e for document ${doc.id}: ${errorMessage}`);

          // NfseService.emitNfse() already handles error status update,
          // so we don't need to update the doc here. Notify FINANCIAL/ADMIN of rejection.
          if (doc.invoice?.id) {
            await this.dispatchNfseOutcomeNotification(doc.invoice.id, 'ERROR', { errorMessage });
          }
        }
      }

      this.logger.log(`NFS-e emission job completed. Emitted: ${emitted}, Errors: ${errors}`);
    } catch (error) {
      this.logger.error('Error during NFS-e emission job:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Emit NfSe documents for specific invoice IDs synchronously.
   * Called during task quote approval so NfSe is authorized BEFORE bank slips are
   * registered at Sicredi — this ensures the NfSe number is available for seuNumero.
   *
   * Does NOT use the global isProcessing lock (targeted, not the full scheduled sweep).
   * emitNfse() handles its own atomic claim internally so concurrent safety is preserved.
   */
  async emitNfseForInvoices(invoiceIds: string[]): Promise<void> {
    if (invoiceIds.length === 0) return;

    this.logger.log(
      `[NFSE_TARGETED] Emitting NfSe for ${invoiceIds.length} invoice(s): [${invoiceIds.join(', ')}]`,
    );

    const docs = await this.prisma.nfseDocument.findMany({
      where: {
        invoiceId: { in: invoiceIds },
        status: { in: [NfseStatus.PENDING, NfseStatus.ERROR] },
        // ── SÓ SOBRE COBRANÇA QUE DE FATO FOI APROVADA ────────────────────────
        //
        // O MESMO predicado da varredura das 09:00 (ver o `where` de
        // `processNfseEmissions`), e pela mesma razão — que aqui era mais grave,
        // porque este caminho é o do BOTÃO.
        //
        // `generateInvoicesForTaskDetailed` COMMITA a própria transação, e só
        // depois dela as guardas de `internalApprove` podem lançar (pagador sem
        // condição de pagamento, divergência de valor, falha da cascata). O
        // rollback de lá levanta o CARIMBO e grava PENDENTE — não apaga a fatura
        // nem este `NfseDocument`. O resíduo é exatamente: fatura viva + nota
        // PENDENTE + cobrança NÃO aprovada. O operador clicava "Emitir NFS-e" e
        // nascia nota municipal VIVA de uma cobrança que a tela acabara de dizer
        // que não foi aprovada — desfazer custa cancelamento + substituição, com
        // o fiscal da prefeitura no meio.
        //
        // A aprovação legítima carimba `Billing.approvedAt` ANTES de gerar as
        // faturas e de chamar este método, então o caminho feliz passa por aqui
        // sem mudança nenhuma.
        //
        // A retirada externa ("Operação Externa") não tem `Billing` e continua
        // passando pelo ramo dela — daí o OR, e não um AND direto.
        invoice: {
          is: {
            OR: [
              { customerConfig: { is: { billing: { is: BILLING_FROZEN_WHERE } } } },
              { externalOperationId: { not: null } },
            ],
          },
        },
      },
      include: {
        invoice: {
          include: {
            customer: { select: NFSE_CUSTOMER_SELECT },
            task: {
              select: {
                id: true,
                name: true,
                serialNumber: true,
                truck: {
                  select: {
                    plate: true,
                    chassisNumber: true,
                    category: true,
                    implementType: true,
                  },
                },
                quote: {
                  select: {
                    services: {
                      select: {
                        description: true,
                        observation: true,
                        amount: true,
                        invoiceToCustomerId: true,
                      },
                      orderBy: { position: 'asc' as const },
                    },
                  },
                },
              },
            },
            // Mesmo grafo do caminho agendado: é por aqui que a nota CONJUNTA
            // (sem tarefa) acha os serviços, os veículos e o nº do orçamento.
            customerConfig: {
              select: {
                discountType: true,
                discountValue: true,
                responsible: { select: { email: true, phone: true, roles: true } },
                // A COBERTURA DESTA FATURA — de quais VEÍCULOS ela é.
                //
                // Era a coluna `taskId` da fatia, nula querendo dizer "todos". Virou
                // relação porque uma fatura pode cobrir um lote — vinte dos sessenta —, e
                // nesse caso não existe coluna que responda. Leia por `sliceTask()` /
                // `coveredTaskIds()` de `@utils/quote-tasks`.
                billing: { select: { id: true, approvedAt: true, tasks: { select: { taskId: true } } } },
                quote: {
                  select: {
                    id: true,
                    budgetNumber: true,
                    billingSplit: true,
                    services: {
                      select: {
                        description: true,
                        observation: true,
                        amount: true,
                        invoiceToCustomerId: true,
                      },
                      orderBy: { position: 'asc' as const },
                    },
                    tasks: {
                      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
                      select: {
                        id: true,
                        name: true,
                        serialNumber: true,
                        // Ver a nota do caminho agendado: o pedido é do veículo.
                        customerOrderNumber: true,
                        truck: {
                          select: {
                            plate: true,
                            chassisNumber: true,
                            category: true,
                            implementType: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            externalOperation: {
              include: {
                services: { orderBy: { position: 'asc' as const } },
                items: { include: { item: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    this.logger.log(`[NFSE_TARGETED] Found ${docs.length} NfSe document(s) to emit`);

    // O filtro acima pode ter engolido documentos, e engolir em silêncio é o que
    // faria o operador ficar esperando por uma nota que nunca vai sair.
    if (docs.length < invoiceIds.length) {
      const encontrados = new Set(docs.map(d => d.invoiceId));
      const ausentes = invoiceIds.filter(id => !encontrados.has(id));
      this.logger.warn(
        `[NFSE_TARGETED] ${ausentes.length} fatura(s) sem documento emissível — nota já emitida, ` +
          `em emissão, ou cobrança NÃO aprovada: [${ausentes.join(', ')}]`,
      );
    }

    let emitted = 0;
    let errors = 0;

    for (const doc of docs) {
      try {
        const invoice = doc.invoice;
        const customer = invoice?.customer;
        const task = invoice?.task;
        const withdrawal = (invoice as any)?.externalOperation;
        const isWithdrawal = !!invoice?.externalOperationId;

        // Fatura sem tarefa é ESPERADO em dois casos: "Operação Externa" e a
        // nota CONJUNTA de um orçamento multitarefa (`Invoice.taskId` nulo de
        // propósito). O que não pode faltar é o vínculo com o orçamento, que é de
        // onde saem os serviços e os veículos.
        const hasQuoteContext = !!(invoice as any)?.customerConfig?.quote;
        if (!invoice || !customer || (!task && !isWithdrawal && !hasQuoteContext)) {
          this.logger.warn(
            `[NFSE_TARGETED] NfseDocument ${doc.id} missing invoice/customer/task — skipping`,
          );
          continue;
        }

        let emitTask: { id: string; name: string; serialNumber?: string };
        let emitTruck:
          | {
              plate?: string;
              chassisNumber?: string;
              category?: string;
              implementType?: string;
            }
          | undefined;
        let services: { description: string; amount: number }[] | undefined;
        let orderNumber: string | undefined;
        let globalDiscount: { type: string; value: number } | undefined;
        let emitVehicles:
          | Array<{
              serialNumber?: string | null;
              plate?: string | null;
              chassisNumber?: string | null;
              category?: string | null;
              implementType?: string | null;
            }>
          | undefined;
        let emitBudgetNumber: number | null = null;
        /** Quantos veículos cada linha de serviço cobre. Operação Externa = 1. */
        let emitServiceQuantity = 1;

        if (isWithdrawal) {
          // Operação Externa: discriminate services + withdrawn items; no truck/order/discount.
          emitTask = { id: invoice.externalOperationId!, name: 'Operação Externa' };
          emitTruck = undefined;
          orderNumber = undefined;
          globalDiscount = undefined;
          services = [
            ...((withdrawal?.services ?? []) as any[]).map((s: any) => ({
              description: s.description as string,
              amount: Number(s.amount),
            })),
            ...((withdrawal?.items ?? []) as any[]).map((i: any) => ({
              description: `${i.item?.name ?? 'Item'} - ${i.withdrawedQuantity} un`,
              amount: Number(i.price ?? 0) * i.withdrawedQuantity,
            })),
          ];
        } else {
          // Ver o caminho agendado: numa nota CONJUNTA `Invoice.taskId` é nulo e
          // `task` aqui é null, então os serviços vêm pela configuração de
          // faturamento. Ler por `task.quote` deixaria a nota conjunta sem item.
          const nfseQuote =
            ((invoice as any).customerConfig?.quote ?? (task as any)?.quote) ?? null;
          const allServices = nfseQuote?.services as
            | Array<{
                description: string;
                observation: string | null;
                amount: any;
                invoiceToCustomerId: string | null;
              }>
            | undefined;

          services = allServices
            ?.filter(s => !s.invoiceToCustomerId || s.invoiceToCustomerId === customer.id)
            .map(s => ({
              // "Outros" is a generic catch-all description; the real service text
              // lives in the observation. Use it so Elotech gets the actual service
              // instead of the literal word "Outros".
              description:
                s.description === 'Outros' && s.observation?.trim()
                  ? s.observation.trim()
                  : s.description,
              amount: Number(s.amount),
            }));

          // Get customer config discount (global discount for this customer)
          const customerConfig = (invoice as any).customerConfig;
          const configDiscountType = customerConfig?.discountType || undefined;
          const configDiscountValue =
            customerConfig?.discountValue != null
              ? Number(customerConfig.discountValue)
              : undefined;

          const quoteTaskRows = (nfseQuote?.tasks ?? []) as Array<any>;
          // Mesma leitura do caminho agendado: a cobertura, uma vez. A âncora é
          // o primeiro veículo DESTA nota, não o primeiro do orçamento.
          const coverage = resolveCoveredVehicles(customerConfig, quoteTaskRows, task as any);
          // E a MESMA recusa: cobertura que falta não vira "todos os veículos".
          const coverageError = missingCoverageError(customerConfig, coverage);
          if (coverageError) {
            errors++;
            this.logger.error(
              `[NFSE_TARGETED] NfseDocument ${doc.id} recusado — ${coverageError} ` +
                `(fatura ${invoice.id})`,
            );
            await this.parkNfseDocumentAsError(doc.id, coverageError);
            await this.dispatchNfseOutcomeNotification(invoice.id, 'ERROR', {
              errorMessage: coverageError,
            });
            continue;
          }
          const coveredRows = coverage.rows;
          const sliceTask = (task as any) ?? coveredRows[0] ?? quoteTaskRows[0] ?? null;
          const truck = sliceTask?.truck;
          emitTask = {
            id: sliceTask?.id ?? invoice.id,
            name: sliceTask?.name ?? `Orçamento ${nfseQuote?.budgetNumber ?? ''}`.trim(),
            serialNumber: sliceTask?.serialNumber || undefined,
          };
          emitTruck = truck
            ? {
                plate: truck.plate || undefined,
                chassisNumber: truck.chassisNumber || undefined,
                category: truck.category || undefined,
                implementType: truck.implementType || undefined,
              }
            : undefined;
          emitVehicles = coveredRows.map((t: any) => ({
            serialNumber: t.serialNumber ?? null,
            plate: t.truck?.plate ?? null,
            chassisNumber: t.truck?.chassisNumber ?? null,
            category: t.truck?.category ?? null,
            implementType: t.truck?.implementType ?? null,
            // Ver o irmão acima: o pedido de compra mora na tarefa.
            orderNumber: t.customerOrderNumber ?? null,
          }));
          emitBudgetNumber = nfseQuote?.budgetNumber ?? null;
          // Mesmo teto do caminho agendado — ver a nota lá.
          orderNumber = orderNumberLabel(coveredRows, 240) ?? undefined;
          // Mesma quantidade do caminho agendado: os veículos cobertos.
          emitServiceQuantity = Math.max(1, coveredRows.length);
          globalDiscount = resolveGlobalDiscount(
            services,
            Number(invoice.totalAmount),
            configDiscountType,
            configDiscountValue,
            emitServiceQuantity,
          );
        }

        const targetedResult = await this.municipalNfseService.emitNfse({
          id: invoice.id,
          totalAmount: Number(invoice.totalAmount),
          customer: buildNfseCustomer(customer, (invoice as any).customerConfig?.responsible),
          task: emitTask,
          truck: emitTruck,
          vehicles: emitVehicles,
          budgetNumber: emitBudgetNumber,
          orderNumber,
          services,
          serviceQuantity: emitServiceQuantity,
          globalDiscount,
        });

        // H3c: emitNfse() owns the atomic PENDING/ERROR → PROCESSING claim and
        // returns { skipped: true } when another process (e.g. the 9AM sweep)
        // already claimed this document — never double-emit.
        if ((targetedResult as any)?.skipped) {
          this.logger.warn(
            `[NFSE_TARGETED] NfseDocument ${doc.id} skipped (${(targetedResult as any)?.reason ?? 'claimed by another process'})`,
          );
          continue;
        }

        emitted++;
        this.logger.log(
          `[NFSE_TARGETED] NfSe emitted for invoice ${invoice.id} (${isWithdrawal ? 'operação externa' : `task: ${task?.name}`})`,
        );

        // Notify FINANCIAL/ADMIN of the emission outcome.
        if ((targetedResult as any)?.status === 'AUTHORIZED') {
          await this.dispatchNfseOutcomeNotification(invoice.id, 'AUTHORIZED', {
            nfseNumber: (targetedResult as any)?.nfseNumber ?? null,
          });
        } else if ((targetedResult as any)?.status === 'ERROR') {
          await this.dispatchNfseOutcomeNotification(invoice.id, 'ERROR', {
            errorMessage: (targetedResult as any)?.errorMessage ?? null,
          });
        }
      } catch (error) {
        errors++;
        const targetedErrMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[NFSE_TARGETED] Failed to emit NfSe for document ${doc.id}: ${targetedErrMsg}`,
        );
        // emitNfse() already updated the NfseDocument to ERROR status. Notify rejection.
        if (doc.invoice?.id) {
          await this.dispatchNfseOutcomeNotification(doc.invoice.id, 'ERROR', {
            errorMessage: targetedErrMsg,
          });
        }
      }
    }

    this.logger.log(`[NFSE_TARGETED] Done. Emitted: ${emitted}, Errors: ${errors}`);
  }

  // ─── Cancellation reconciliation ───────────────────────────────────────────
  // Cancellation at Elotech is asynchronous + fiscal-approved. A submitted request sits in
  // CANCEL_REQUESTED (AGUARDANDO_FISCAL) until a municipal fiscal approves (→ CANCELLED) or
  // rejects it (→ CANCEL_REJECTED). This job re-checks pending requests against the live
  // Elotech state so the system never lies about whether a note is actually cancelled, and
  // so users who only use our system learn the moment the fiscal acts (incl. the rejection
  // message). It also re-syncs AUTHORIZED notes that were cancelled directly at the portal.

  /**
   * Best-effort notification when a cancellation request is resolved by the fiscal.
   * Reuses the configuration-driven dispatch; a no-op if the config key is absent.
   */
  private async dispatchCancellationOutcome(
    doc: { id: string; invoiceId: string | null; taskId: string | null },
    outcome: 'CANCELLED' | 'REJECTED',
    detail: { nfseNumber?: number | null; rejectionMessage?: string | null },
  ): Promise<void> {
    try {
      // The invoice is USUALLY gone by the time the fiscal answers. Cancellation at Elotech is
      // asynchronous (hours), and the billing revert that requested it deletes the Invoice in
      // the same breath — NfseDocument.invoiceId is FK SetNull, so it lands here as null. This
      // used to be passed straight into findUnique({ where: { id: null } }), which throws
      // PrismaClientValidationError into the catch below and swallowed the whole notification.
      // That is exactly how the rejection of NF 3199 ("Tati Minas 8,50") reached nobody on
      // 13/08/2026 — the log even printed "para fatura null".
      //
      // The note outlives the invoice but keeps its taskId, so fall back to that.
      const invoice = doc.invoiceId
        ? await this.prisma.invoice.findUnique({
            where: { id: doc.invoiceId },
            include: {
              customer: { select: { fantasyName: true } },
              task: { select: { id: true, name: true } },
              externalOperation: { select: { id: true } },
            },
          })
        : null;

      const fallbackTask =
        !invoice && doc.taskId
          ? await this.prisma.task.findUnique({
              where: { id: doc.taskId },
              select: { id: true, name: true, customer: { select: { fantasyName: true } } },
            })
          : null;

      if (!invoice && !fallbackTask) return;

      const customerName =
        invoice?.customer?.fantasyName || fallbackTask?.customer?.fantasyName || 'N/A';
      const taskId = invoice?.task?.id ?? invoice?.taskId ?? fallbackTask?.id ?? null;
      const withdrawalId = invoice?.externalOperation?.id ?? invoice?.externalOperationId ?? null;
      const isWithdrawal = !!withdrawalId;
      const taskName = isWithdrawal
        ? 'Operação Externa'
        : invoice?.task?.name || fallbackTask?.name || 'N/A';
      const refLabel = isWithdrawal ? 'da operação externa' : `da tarefa ${taskName}`;
      // Mesmo link da emissão — com uma ressalva: aqui a FATURA costuma já não
      // existir (o cancelamento na Elotech é assíncrono e a reversão apaga a
      // fatura no mesmo gesto, `invoiceId` vira nulo por `SetNull`). Com fatura,
      // pergunta-se à cobertura; sem ela, sobra a tarefa durável da nota.
      const billingLink =
        invoice && !isWithdrawal
          ? await billingDeepLinkForInvoice(this.prisma as any, invoice.id)
          : null;
      const webUrl = isWithdrawal
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : (billingLink?.web ??
          (taskId ? `/financeiro/faturamento/detalhes/${taskId}` : undefined));
      const mobileUrl = isWithdrawal
        ? `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : (billingLink?.mobile ??
          (taskId ? `/(tabs)/financeiro/faturamento/detalhes/${taskId}` : undefined));

      const numero = detail.nfseNumber ? ` Nº ${detail.nfseNumber}` : '';
      const isCancelled = outcome === 'CANCELLED';
      await this.dispatchService.dispatchByConfiguration(
        isCancelled ? 'nfse.cancelled' : 'nfse.cancel_rejected',
        'system',
        {
          entityType: 'NfseDocument',
          entityId: taskId ?? withdrawalId ?? doc.id,
          action: isCancelled ? 'cancelled' : 'cancel_rejected',
          data: {
            customerName,
            taskName,
            nfseNumber: detail.nfseNumber ?? 'N/A',
            // The fiscal's own words — the templates interpolate this, and it is the whole
            // point of the notification: it tells the operator WHAT to fix on the resubmission.
            rejectionMessage: detail.rejectionMessage ?? undefined,
            invoiceId: doc.invoiceId ?? undefined,
            taskId: taskId || undefined,
            externalOperationId: withdrawalId || undefined,
          },
          overrides: {
            title: isCancelled ? 'NFS-e Cancelada' : 'Cancelamento de NFS-e Rejeitado',
            body: isCancelled
              ? `A NFS-e${numero} ${refLabel} (${customerName}) foi cancelada na prefeitura.`
              : `O cancelamento da NFS-e${numero} ${refLabel} (${customerName}) foi REJEITADO pela prefeitura.${
                  detail.rejectionMessage ? `\nMotivo: ${detail.rejectionMessage}` : ''
                }\nÉ necessário corrigir e reenviar a solicitação.`,
            relatedEntityType: 'NFSE',
            ...(webUrl ? { webUrl } : {}),
            ...(mobileUrl ? { mobileUrl } : {}),
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Falha ao notificar resultado do cancelamento (${outcome}) do NfseDocument ${doc.id} ` +
          `(fatura ${doc.invoiceId ?? 'já excluída'}, tarefa ${doc.taskId ?? 'sem vínculo'}):`,
        error,
      );
    }
  }

  @Cron('*/20 * * * *', {
    name: 'nfse-cancellation-reconcile',
    timeZone: 'America/Sao_Paulo',
  })
  async reconcilePendingCancellations(): Promise<void> {
    // Only runs where Elotech OXY is configured (production). No-ops in dev.
    if (!process.env.ELOTECH_OXY_USERNAME || !process.env.ELOTECH_OXY_PASSWORD) {
      return;
    }
    if (this.isReconcilingCancellations) {
      this.logger.warn('[NFSE_CANCEL_RECON] Already running, skipping');
      return;
    }
    this.isReconcilingCancellations = true;

    try {
      const pending = await this.prisma.nfseDocument.findMany({
        where: {
          status: NfseStatus.CANCEL_REQUESTED,
          elotechNfseId: { not: null },
        },
        select: { id: true, invoiceId: true, taskId: true, nfseNumber: true },
      });

      if (pending.length === 0) return;
      this.logger.log(`[NFSE_CANCEL_RECON] Checking ${pending.length} pending cancellation(s)`);

      let resolved = 0;
      for (const doc of pending) {
        try {
          const result = await this.municipalNfseService.syncCancellationStatus(doc.id);

          // Still pending — nothing changed.
          if (result.status === NfseStatus.CANCEL_REQUESTED) continue;

          resolved++;
          if (result.cancelled) {
            this.logger.log(
              `[NFSE_CANCEL_RECON] NFS-e #${doc.nfseNumber} cancellation APPROVED by fiscal`,
            );
            await this.dispatchCancellationOutcome(doc, 'CANCELLED', {
              nfseNumber: doc.nfseNumber,
            });
          } else if (result.rejected) {
            this.logger.warn(
              `[NFSE_CANCEL_RECON] NFS-e #${doc.nfseNumber} cancellation REJECTED: ${result.rejectionMessage}`,
            );
            await this.dispatchCancellationOutcome(doc, 'REJECTED', {
              nfseNumber: doc.nfseNumber,
              rejectionMessage: result.rejectionMessage,
            });
          }
        } catch (error) {
          this.logger.error(
            `[NFSE_CANCEL_RECON] Failed to reconcile NfseDocument ${doc.id}: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }

      this.logger.log(
        `[NFSE_CANCEL_RECON] Done. Checked: ${pending.length}, Resolved: ${resolved}`,
      );

      await this.retrySupersededCancellations();
    } catch (error) {
      this.logger.error('[NFSE_CANCEL_RECON] Error during cancellation reconciliation:', error);
    } finally {
      this.isReconcilingCancellations = false;
    }
  }

  /**
   * Resume substitutions whose cancellation never completed.
   *
   * `supersedePreviousNfses` writes the `superseded*` columns BEFORE calling Elotech, so a note
   * carrying them while still alive means the request failed, was rejected, or died mid-flight.
   * The substitute number is already recorded, which is exactly what the fiscal demands — so the
   * retry can be fully automatic.
   *
   * Throttled to one attempt per 24h per note: the fiscal reviews these by hand, and hammering
   * the prefeitura every 20 minutes would be both useless and rude.
   */
  private async retrySupersededCancellations(): Promise<void> {
    const RETRY_AFTER_HOURS = 24;
    const cutoff = new Date(Date.now() - RETRY_AFTER_HOURS * 60 * 60 * 1000);

    const stalled = await this.prisma.nfseDocument.findMany({
      where: {
        status: { in: [NfseStatus.AUTHORIZED, NfseStatus.CANCEL_REJECTED] },
        supersededByNfseNumber: { not: null },
        elotechNfseId: { not: null },
        OR: [{ cancelRequestedAt: null }, { cancelRequestedAt: { lt: cutoff } }],
      },
      select: { id: true, nfseNumber: true, supersededByNfseNumber: true },
    });

    if (stalled.length === 0) return;
    this.logger.log(
      `[NFSE_SUPERSEDE_RETRY] Reenviando cancelamento de ${stalled.length} nota(s) já substituída(s)`,
    );

    for (const doc of stalled) {
      try {
        await this.municipalNfseService.cancelNfse(
          doc.id,
          `Nota substituída por refaturamento da ordem de serviço. O mesmo serviço foi ` +
            `faturado novamente na NFS-e nº ${doc.supersededByNfseNumber}, que substitui esta.`,
          1,
          doc.supersededByNfseNumber,
        );
      } catch (error) {
        this.logger.warn(
          `[NFSE_SUPERSEDE_RETRY] NFS-e #${doc.nfseNumber}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
  }

  /**
   * Daily watch for notes left ALIVE at the prefeitura with no billing behind them.
   *
   * A billing revert deliberately leaves its NFS-e standing (there is no substitute to cite
   * yet). That is correct only if a re-approval follows. When it does not, the result is ISS
   * owed on a service nobody is billing — and absolutely nothing used to detect it: three
   * Masterboi notes (3097/3098/3099, R$ 22.500,87) sat exactly like this for 63 days unnoticed.
   */
  @Cron('0 9 * * *', { name: 'nfse-orphan-live-notes', timeZone: 'America/Sao_Paulo' })
  async alertOrphanLiveNotes(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;

    const STALE_DAYS = 3;
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    // Duas situações, o mesmo sintoma — uma nota fiscal viva que ninguém está tratando:
    //
    //  (a) órfã de fatura: o faturamento foi revertido e nunca refeito;
    //  (b) cancelamento recusado e abandonado: o fiscal pediu correção e ninguém voltou.
    //
    // A (b) precisa entrar mesmo com fatura vinculada — as NF 3097/3098/3099 (Masterboi,
    // R$ 22.500,87) ficaram exatamente assim por 63 dias, com as faturas PAGAS, e nada no
    // sistema apontou para elas uma única vez.
    const REJECTED_STALE_DAYS = 7;
    const rejectedCutoff = new Date(Date.now() - REJECTED_STALE_DAYS * 24 * 60 * 60 * 1000);

    const orphans = await this.prisma.nfseDocument.findMany({
      where: {
        nfseNumber: { not: null },
        supersededByNfseNumber: null,
        OR: [
          {
            invoiceId: null,
            status: { in: [...NFSE_LIVE_STATUSES] },
            updatedAt: { lt: cutoff },
          },
          {
            status: NfseStatus.CANCEL_REJECTED,
            cancelResolvedAt: { lt: rejectedCutoff },
          },
        ],
      },
      select: { id: true, invoiceId: true, taskId: true, nfseNumber: true, status: true },
    });

    if (orphans.length === 0) return;

    this.logger.warn(
      `[NFSE_ORPHAN_WATCH] ${orphans.length} NFS-e viva(s) sem tratamento: ` +
        `${orphans.map(o => `#${o.nfseNumber} (${o.status})`).join(', ')}`,
    );

    for (const orphan of orphans) {
      await this.dispatchOrphanLiveNote(orphan);
    }
  }

  private async dispatchOrphanLiveNote(doc: {
    id: string;
    invoiceId: string | null;
    taskId: string | null;
    nfseNumber: number | null;
  }): Promise<void> {
    try {
      const task = doc.taskId
        ? await this.prisma.task.findUnique({
            where: { id: doc.taskId },
            select: { id: true, name: true, customer: { select: { fantasyName: true } } },
          })
        : null;

      await this.dispatchService.dispatchByConfiguration('nfse.orphan_live', 'system', {
        entityType: 'NfseDocument',
        entityId: task?.id ?? doc.id,
        action: 'orphan_live',
        data: {
          nfseNumber: doc.nfseNumber ?? 'N/A',
          taskName: task?.name ?? 'N/A',
          customerName: task?.customer?.fantasyName ?? 'N/A',
          taskId: task?.id || undefined,
        },
        overrides: {
          title: 'NFS-e ativa sem faturamento',
          body:
            `A NFS-e nº ${doc.nfseNumber} da tarefa "${task?.name ?? 'N/A'}" continua VÁLIDA na ` +
            `prefeitura e está sem tratamento` +
            (doc.invoiceId
              ? `: o cancelamento foi recusado pelo fiscal e não houve novo pedido.`
              : `: o faturamento foi revertido e não houve novo faturamento.`) +
            ` Aprove o faturamento novamente (a nota será substituída) ou reenvie o ` +
            `cancelamento informando a nota substituta.`,
          relatedEntityType: 'NFSE',
          ...(task?.id ? { webUrl: `/financeiro/faturamento/detalhes/${task.id}` } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        `[NFSE_ORPHAN_WATCH] Falha ao notificar NFS-e órfã ${doc.id}:`,
        error,
      );
    }
  }
}
