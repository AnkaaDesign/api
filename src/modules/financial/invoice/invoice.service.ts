import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import { BudgetStatusCascadeService } from '@modules/production/budget/budget-status-cascade.service';
import { deriveInvoicePaymentState } from './invoice-payment-state';
import { billingDeepLinkForInvoice } from '@utils/billing-links';

/**
 * Minimal Prisma transaction-client shape needed by recalcInvoicePaymentState.
 * Accepts either the PrismaService or an interactive-transaction client.
 */
type InvoiceTxClient = {
  invoice: PrismaService['invoice'];
  installment: PrismaService['installment'];
};
import type {
  Invoice,
  InvoiceInclude,
  InvoiceGetManyFormData,
  InvoiceGetManyResponse,
} from '@types';
import {
  INVOICE_STATUS,
  BANK_SLIP_STATUS,
  NFSE_STATUS,
  BILLING_STATUS,
  BILLING_STATUS_ORDER,
} from '@constants';

/**
 * Service for managing Invoice entities.
 * Handles CRUD operations, cancellation, and payment status recalculation.
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly dispatchService: NotificationDispatchService,
    // A cascata que recalcula `Billing.status` depois que um carimbo ou uma
    // parcela muda. O `InvoiceController` deste mesmo módulo já a injeta — o
    // `BudgetModule` a exporta e este módulo já o importa.
    private readonly cascadeService: BudgetStatusCascadeService,
  ) {}

  /**
   * Emit invoice.cancelled to FINANCIAL/COMMERCIAL/ADMIN after an invoice is cancelled.
   * Best-effort — never breaks the cancellation flow. Deep link keyed by taskId.
   */
  private async dispatchInvoiceCancelledNotification(
    invoiceId: string,
    reason?: string,
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true, implement: { select: { serialNumber: true } } } },
          externalOperation: { select: { id: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskId = invoice.task?.id ?? invoice.taskId ?? null;
      const withdrawalId = invoice.externalOperation?.id ?? invoice.externalOperationId ?? null;
      const taskName = withdrawalId ? 'Operação Externa' : invoice.task?.name || 'N/A';
      const refLabel = withdrawalId ? 'da operação externa' : `da tarefa ${taskName}`;

      // A fatura conjunta e o lote têm `Invoice.taskId` NULO por construção
      // (`sliceAnchorTaskId` só o preenche quando a cobertura tem UM veículo), e o
      // link ia para `/detalhes/null` — tela morta. `billingDeepLinkForInvoice`
      // resolve pela COBERTURA e nunca devolve nulo.
      const billingLink = withdrawalId
        ? null
        : await billingDeepLinkForInvoice(this.prisma as any, invoice.id);
      const webUrl = withdrawalId
        ? `/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : billingLink!.web;
      const mobileUrl = withdrawalId
        ? `/(tabs)/estoque/operacoes-externas/detalhes/${withdrawalId}`
        : billingLink!.mobile;

      await this.dispatchService.dispatchByConfiguration('invoice.cancelled', 'system', {
        entityType: 'Invoice',
        entityId: taskId ?? withdrawalId ?? invoice.id,
        action: 'cancelled',
        data: {
          customerName,
          taskName,
          reason: reason || 'Não especificado',
          invoiceId: invoice.id,
          taskId: taskId || undefined,
          externalOperationId: withdrawalId || undefined,
        },
        overrides: {
          title: 'Fatura Cancelada',
          body: `A fatura ${refLabel} (${customerName}) foi cancelada.${reason ? `\nMotivo: ${reason}` : ''}`,
          relatedEntityType: 'INVOICE',
          ...(webUrl ? { webUrl } : {}),
          ...(mobileUrl ? { mobileUrl } : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar cancelamento de fatura (invoice.cancelled):', error);
    }
  }

  /**
   * Find many invoices with filtering, pagination, and sorting.
   */
  async findMany(query: InvoiceGetManyFormData): Promise<InvoiceGetManyResponse> {
    try {
      const result = await this.invoiceRepository.findMany({
        page: query.page,
        limit: query.limit,
        orderBy: query.orderBy,
        where: {
          ...(query.where || {}),
          ...(query.taskId && { taskId: query.taskId }),
          ...(query.customerId && { customerId: query.customerId }),
          ...(query.status && { status: query.status }),
        },
        include: query.include,
      });

      return {
        data: result.data,
        meta: result.meta,
      };
    } catch (error: unknown) {
      this.logger.error('Error finding invoices', error);
      throw error;
    }
  }

  /**
   * Find a single invoice by ID.
   * @throws NotFoundException if not found
   */
  async findById(id: string, include?: InvoiceInclude): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findById(id, include);

    if (!invoice) {
      throw new NotFoundException(`Fatura com ID ${id} não encontrada.`);
    }

    return invoice;
  }

  /**
   * Find all invoices for a given task.
   */
  async findByTaskId(taskId: string, include?: InvoiceInclude): Promise<Invoice[]> {
    return this.invoiceRepository.findByTaskId(taskId, include);
  }

  /**
   * As faturas de TODOS os veículos de um orçamento. Ver o controller: com
   * `PER_TASK` há uma fatura por implemento, e a rota por tarefa devolve só a do
   * veículo por onde a tela entrou.
   */
  async findByQuoteId(quoteId: string, include?: InvoiceInclude): Promise<Invoice[]> {
    return this.invoiceRepository.findByQuoteId(quoteId, include);
  }

  /**
   * Find all invoices for a given customer.
   */
  async findByCustomerId(customerId: string, include?: InvoiceInclude): Promise<Invoice[]> {
    return this.invoiceRepository.findByCustomerId(customerId, include);
  }

  /**
   * Cancel an invoice and all its children (installments, bank slips, NFS-e).
   * @param id - Invoice UUID
   * @param reason - Optional cancellation reason stored in notes
   * @throws NotFoundException if invoice not found
   * @throws BadRequestException if invoice is already cancelled or fully paid
   */
  async cancelInvoice(id: string, reason?: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findById(id);

    if (!invoice) {
      throw new NotFoundException(`Fatura com ID ${id} não encontrada.`);
    }

    if (invoice.status === INVOICE_STATUS.CANCELLED) {
      throw new BadRequestException('Fatura já está cancelada.');
    }

    if (invoice.status === INVOICE_STATUS.PAID) {
      throw new BadRequestException('Não é possível cancelar uma fatura totalmente paga.');
    }

    // Use a transaction to cancel invoice + all children atomically
    await this.prisma.$transaction(async tx => {
      // Cancel all installments that aren't already paid
      await tx.installment.updateMany({
        where: {
          invoiceId: id,
          status: { not: 'PAID' },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Cancel all bank slips that aren't already paid
      await tx.bankSlip.updateMany({
        where: {
          installment: {
            invoiceId: id,
          },
          status: { notIn: ['PAID', 'CANCELLED'] },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Only locally-cancel NFS-e documents that have NO live municipal note and are
      // NOT in an in-flight cancellation lifecycle. PENDING/PROCESSING/ERROR were never
      // authorized (or never emitted) so there is nothing live at the prefeitura — safe
      // to cancel locally. AUTHORIZED notes are live and must go through the real Elotech
      // cancel request (handled by the controller post-transaction). CANCEL_REQUESTED is a
      // pending request the reconciler still tracks — force-flipping it would orphan a live
      // note. CANCEL_REJECTED is still a live AUTHORIZED note (its cancel was rejected).
      // Never orphan a live municipal note by locally-flipping it to CANCELLED.
      await tx.nfseDocument.updateMany({
        where: {
          invoiceId: id,
          status: { in: ['PENDING', 'PROCESSING', 'ERROR'] },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Cancel the invoice itself
      await tx.invoice.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          ...(reason && { notes: reason }),
        },
      });
    });

    // Check for AUTHORIZED NFS-e docs that require manual cancellation at Elotech
    const authorizedNfse = await this.prisma.nfseDocument.findMany({
      where: { invoiceId: id, status: 'AUTHORIZED' },
      select: { id: true, nfseNumber: true, elotechNfseId: true },
    });
    if (authorizedNfse.length > 0) {
      for (const nfse of authorizedNfse) {
        this.logger.warn(
          `Invoice ${id} cancelled — NFS-e #${nfse.nfseNumber} (Elotech ID: ${nfse.elotechNfseId}) requires manual cancellation at Elotech OXY`,
        );
      }
      // Append a note on the invoice so the record itself carries the warning
      const nfseWarning = authorizedNfse
        .map(nfse => `NFS-e #${nfse.nfseNumber} pendente cancelamento no Elotech`)
        .join('; ');
      const existing = await this.prisma.invoice.findUnique({
        where: { id },
        select: { notes: true },
      });
      const updatedNotes = existing?.notes
        ? `${existing.notes} | ${nfseWarning}`
        : nfseWarning;
      await this.prisma.invoice.update({
        where: { id },
        data: { notes: updatedNotes },
      });
    }

    // Depois de cancelar os artefatos da fatura, levanta os CARIMBOS de
    // faturamento que ficaram sobre fatos que deixaram de ser verdade — o da
    // cobrança (por `Billing`) e o do contrato (`Budget.billingApprovedAt`) —
    // para que o operador possa reaprovar o faturamento (por exemplo, depois de
    // corrigir o cadastro do cliente) sem cirurgia no banco.
    try {
      const invoiceWithConfig = await this.prisma.invoice.findUnique({
        where: { id },
        select: {
          customerConfigId: true,
          customerConfig: {
            select: { billingId: true, quote: { select: { id: true } } },
          },
        },
      });
      const quote = invoiceWithConfig?.customerConfig?.quote;

      // ───────────────────────────────────────────────────────────────────────
      // O CARIMBO DA FATIA TAMBÉM CAI. Este era o beco sem saída.
      //
      // Cancelar a fatura devolvia o orçamento a "Orçamento Aprovado" e deixava
      // `BudgetPayer.billingApprovedAt` preenchido. Depois disso o
      // sistema dizia as duas coisas ao mesmo tempo: aprovar respondia "esta
      // fatia já teve o faturamento aprovado" (o carimbo) e reverter respondia
      // "status não revertível" (o orçamento já tinha voltado). Não havia gesto
      // de tela que saísse dali — só cirurgia no banco.
      //
      // O carimbo é levantado SÓ quando o FATURAMENTO fica sem fatura viva —
      // nenhuma de nenhum pagador dele. Cancelar a fatura de um ciclo antigo não
      // desfaz a aprovação da vigente, e cancelar a de UM pagador não desfaz a
      // aprovação de um recorte que o outro pagador ainda cobre.
      //
      // A conta migrou da fatia para o faturamento junto com o carimbo: perguntar
      // "esta fatia ficou sem fatura?" com dois pagadores respondia sim para
      // metade de um faturamento inteiro, e levantava o carimbo dos dois.
      const billingId = invoiceWithConfig?.customerConfig?.billingId ?? null;
      if (billingId) {
        const liveOnBilling = await this.prisma.invoice.count({
          where: {
            customerConfig: { billingId },
            status: { not: 'CANCELLED' },
          },
        });
        if (liveOnBilling === 0) {
          const cleared = await this.prisma.billing.updateMany({
            where: { id: billingId, approvedAt: { not: null } },
            data: {
              approvedAt: null,
              // ── O ESTADO VAI JUNTO COM O CARIMBO, NA MESMA ESCRITA ──────────
              //
              // Era só `approvedAt: null`. A cascata logo abaixo REALMENTE roda
              // (`cascadeFromQuote` → `recomputeForQuote`) e devolveria a cobrança
              // a PENDENTE — mas ela roda FORA desta escrita, depois de duas
              // consultas e um `budget.updateMany`, e engole erro por cobrança.
              // Morrer nesse intervalo deixava `status` pós-aprovação com
              // `approvedAt` nulo, e essa combinação fecha as TRÊS portas de uma
              // vez: não é alvo de aprovação (o carimbo sumiu), não é revertível
              // (não há fatura), e não volta a Pendente sozinha. A tela mostra
              // "Aprovado"/"Vencido" sem cobrança nenhuma por trás e o dinheiro do
              // orçamento segue travado por `isBillingFrozen`.
              //
              // É a mesma escrita que `revertBilling` e o cancelamento do orçamento
              // fazem (`budget.service.ts`): PENDENTE aqui deixa um estado COERENTE
              // mesmo se a cascata falhar, e a cascata só REFINA depois — devolvendo
              // PARCIAL/LIQUIDADO quando sobrou parcela paga, que é o único caso em
              // que PENDENTE estaria por baixo da verdade.
              status: BILLING_STATUS.PENDING as any,
              statusOrder: BILLING_STATUS_ORDER[BILLING_STATUS.PENDING],
            },
          });
          if (cleared.count > 0) {
            this.logger.log(
              `Faturamento ${billingId}: carimbo levantado — a fatura foi cancelada e não sobrou nenhuma viva.`,
            );
          }
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // O CARIMBO DO CONTRATO — e o que deixou de existir aqui.
      //
      // Este bloco rebaixava o orçamento de `BILLING_APPROVED`/`UPCOMING`/`DUE`/
      // `PARTIAL` de volta para "Orçamento Aprovado". NÃO HÁ MAIS PARA ONDE
      // VOLTAR: `APPROVED` é o ÚLTIMO estado do ORÇAMENTO e o ciclo do pagamento
      // mudou de entidade (`Billing.status`). Cancelar fatura não desfaz a
      // VENDA — desfaz a COBRANÇA, e quem responde por ela é o carimbo levantado
      // logo acima, por faturamento.
      //
      // O que continua sendo do orçamento é `Budget.billingApprovedAt`: a data
      // em que o contrato INTEIRO ficou faturado. Sem nenhuma fatura viva ela
      // afirma um fato que deixou de ser verdade — e envenena o
      // `avgSalesCycleDays` do painel, que a lê como "quando esta venda virou
      // dinheiro".
      if (quote) {
        const liveOnQuote = await this.prisma.invoice.count({
          where: { customerConfig: { quoteId: quote.id }, status: { not: 'CANCELLED' } },
        });
        if (liveOnQuote === 0) {
          const cleared = await this.prisma.budget.updateMany({
            where: { id: quote.id, billingApprovedAt: { not: null } },
            data: { billingApprovedAt: null },
          });
          if (cleared.count > 0) {
            this.logger.log(
              `Orçamento ${quote.id}: carimbo de faturado levantado — nenhuma fatura viva restou.`,
            );
          }
        }

        // O estado de cada cobrança é DERIVADO do carimbo e das parcelas, e as
        // duas coisas acabaram de mudar. Quem recalcula é a cascata — este
        // serviço não escreve `Billing.status`, e escrever aqui abriria a
        // segunda fonte de verdade que a separação existiu para fechar.
        await this.cascadeService.cascadeFromQuote(quote.id);
      }
    } catch (revertError) {
      this.logger.warn(
        `Failed to revert Budget status after invoice cancellation: ${revertError}`,
      );
    }

    // Notify FINANCIAL/COMMERCIAL/ADMIN that the invoice was cancelled.
    await this.dispatchInvoiceCancelledNotification(id, reason);

    // Return the updated invoice
    return this.findById(id);
  }

  /**
   * Recalculate the paidAmount and status of an invoice based on its installments.
   * Called after a payment is recorded or a boleto is liquidated.
   *
   * ⚠️ Era a QUINTA cópia da derivação, e a mais perigosa das cinco: sem nenhum
   * chamador, divergindo das outras quatro e capaz de escrever `CANCELLED` — um
   * estado terminal que só `cancelInvoice` pode escrever. Ficou como fachada
   * sobre `recalcInvoicePaymentState` para que ninguém a adote por engano.
   */
  async updateInvoicePaymentStatus(invoiceId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Fatura com ID ${invoiceId} não encontrada.`);
    }

    await this.recalcInvoicePaymentState(this.prisma, invoiceId);

    return this.findById(invoiceId);
  }

  /**
   * SINGLE source of truth for recomputing an invoice's paidAmount + status from its
   * installments. Used by every payment path (Sicredi webhook, boleto reconcile cron,
   * manual mark-paid) so the three previously-divergent recalcs can never disagree.
   *
   * - paidAmount = Σ paidAmount of NON-CANCELLED installments (Decimal-safe), ALWAYS written.
   * - status:
   *     PAID            — every active installment is PAID
   *     PARTIALLY_PAID  — some payment recorded but not all paid
   *     ACTIVE          — no payment recorded
   * - CANCELLED invoices are never touched (cancelInvoice owns that terminal state).
   *
   * Idempotent: re-running with no installment change yields the same result.
   * Accepts a tx client so callers can fold it into their own $transaction.
   */
  async recalcInvoicePaymentState(tx: InvoiceTxClient, invoiceId: string): Promise<void> {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return;

    // Never overwrite a CANCELLED invoice — cancelInvoice owns that state.
    if (invoice.status === INVOICE_STATUS.CANCELLED) {
      return;
    }

    const installments = await tx.installment.findMany({ where: { invoiceId } });

    // A derivação mora em `deriveInvoicePaymentState` — uma só, compartilhada
    // com o webhook do Sicredi, as duas conciliações e o agendador de boletos.
    // As cinco cópias que existiam discordavam, e três decidiam por DINHEIRO
    // contra o `totalAmount` congelado; ver o cabeçalho daquele arquivo.
    const { paidAmount, status } = deriveInvoicePaymentState(installments);

    // ALWAYS write paidAmount (do not skip on unchanged status — that was the I31 staleness bug).
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount, status: status as any },
    });

    this.logger.log(
      `Invoice ${invoiceId} payment state recalculated: paidAmount=${paidAmount}, status=${status}`,
    );
  }
}
