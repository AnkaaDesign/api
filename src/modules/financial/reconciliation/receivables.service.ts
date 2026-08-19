import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_ACTION, CHANGE_TRIGGERED_BY, ENTITY_TYPE } from '@constants';
import { isDueDateOverdue } from '@utils/due-date.util';
import {
  ReceivableRow,
  ReceivableSource,
  ReceivableState,
  ReceivablesResponse,
  ReceivablesSummary,
} from '../../../types';

const RECEIVED_LOOKBACK_DAYS = 60;

/** Period the caller is looking at (Contas a Receber's year + months selector).
 *  Months are 2-digit strings ("01".."12"), exactly as the UI stores them. */
export type ReceivablesPeriod = { year: number; months: string[] };

/**
 * PAID window for a requested period: from the first day of its earliest month
 * to the last instant of its latest month.
 *
 * WHY THIS EXISTS
 * ---------------
 * The list is bucketed by month on the client, and a RECEIVED parcela's month is
 * its `paidAt`. The server, however, only ever shipped receipts from the last
 * RECEIVED_LOOKBACK_DAYS, so every month older than that rendered EMPTY — the
 * navigation offered history the payload could not contain. It stayed invisible
 * while `paidAt` was the date the baixa was typed (always "recent"); the moment
 * the operator could set the REAL payment date, correcting a parcela to the day
 * the customer actually paid deleted it from the screen (the Amendolândia case:
 * two parcelas moved out of July, then showed up in no month at all).
 *
 * A gap month (e.g. Jan + Mar selected) is included in the range and filtered out
 * again on the client — over-fetching a month is free, missing one is not.
 */
const paidWindowFor = (period: ReceivablesPeriod): { gte: Date; lte: Date } => {
  const monthNums = period.months
    .map(m => parseInt(m, 10))
    .filter(m => Number.isFinite(m) && m >= 1 && m <= 12);
  const first = Math.min(...monthNums);
  const last = Math.max(...monthNums);
  return {
    // UTC boundaries with a day of slack on each side: `paidAt` is stored as a
    // local-noon timestamp (see DateTimeInput's 13:00 anchor), so a strict
    // month boundary in UTC can drop the first/last day of the month.
    gte: new Date(Date.UTC(period.year, first - 1, 1, 0, 0, 0) - 86_400_000),
    lte: new Date(Date.UTC(period.year, last, 1, 0, 0, 0) + 86_400_000),
  };
};

/**
 * Unified Contas a Receber source — the ENTRADA analog of PayablesService.
 * Aggregates open (and recently received) Invoice installments into one
 * normalized list bucketed by state, so finance sees what customers owe in one
 * place and conciliates incoming bank credits against it.
 */
@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Declare a receipt reconciled WITHOUT a bank line, or undo that declaration.
   *
   * A ReconciliationMatch requires a `transactionId`, so money that landed in a
   * partner's personal account can never be conciliated the normal way — the
   * matching bank line will never appear in our OFX, because it was never our
   * account. Those parcelas were therefore stuck as "recebida, não conciliada"
   * forever, and the nightly stale-paid sweep counted them every single night,
   * which is how a real alarm turns into noise.
   *
   * This is an ASSERTION, not evidence: nothing verifies it, so it records who
   * made it and why, and it is restricted to ADMIN/ACCOUNTING at the route.
   */
  async setExternalClearance(
    installmentId: string,
    cleared: boolean,
    note: string | null | undefined,
    userId?: string,
  ) {
    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      select: { id: true, status: true, amount: true, externalClearedAt: true, invoiceId: true },
    });
    if (!installment) throw new NotFoundException('Parcela não encontrada.');

    // Only a received parcela can be declared conciliated: "o dinheiro entrou por
    // fora" presupposes that it entered at all.
    if (cleared && installment.status !== 'PAID') {
      throw new BadRequestException(
        'Apenas uma parcela já recebida pode ser marcada como conciliada.',
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async tx => {
      await tx.installment.update({
        where: { id: installmentId },
        data: cleared
          ? {
              externalClearedAt: now,
              externalClearedById: userId ?? null,
              externalClearedNote: note?.trim() || null,
            }
          : { externalClearedAt: null, externalClearedById: null, externalClearedNote: null },
      });

      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.INSTALLMENT,
        entityId: installmentId,
        action: CHANGE_ACTION.UPDATE,
        field: 'externalClearedAt',
        oldValue: installment.externalClearedAt,
        newValue: cleared ? now : null,
        reason: cleared
          ? `Conciliação declarada manualmente (recebimento fora da conta da empresa)` +
            `${note?.trim() ? `: ${note.trim()}` : '.'} Sem linha de extrato correspondente.`
          : 'Conciliação manual desfeita — a parcela volta a aguardar conciliação bancária.',
        triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        triggeredById: userId ?? null,
        userId: userId ?? null,
        transaction: tx,
        metadata: { invoiceId: installment.invoiceId, amount: Number(installment.amount) },
      });
    });

    return {
      success: true,
      message: cleared
        ? 'Parcela marcada como conciliada.'
        : 'Conciliação manual removida.',
    };
  }

  async getReceivables(period?: ReceivablesPeriod | null): Promise<ReceivablesResponse> {
    try {
      const now = new Date();
      const receivedSince = new Date(now.getTime() - RECEIVED_LOOKBACK_DAYS * 86_400_000);
      // With a period, receipts come from THAT period (see `paidWindowFor`);
      // without one, the caller gets the recent-receipts default it always got.
      const paidWindow =
        period && period.months.length > 0
          ? paidWindowFor(period)
          : { gte: receivedSince };

      const installments = await this.prisma.installment.findMany({
        where: {
          OR: [
            { status: { in: ['PENDING', 'PROCESSING', 'OVERDUE'] } },
            { status: 'PAID', paidAt: paidWindow },
            // A parcela marked PAID with no payment date has no month of its own;
            // it would otherwise be unreachable from every period. Anchor it to
            // its due date so it lands somewhere a human can find it.
            { status: 'PAID', paidAt: null, dueDate: paidWindow },
          ],
        },
        include: {
          bankSlip: {
            select: {
              id: true,
              // Boleto receipts are matched via bankSlipId, not installmentId —
              // without this, a Sicredi-liquidated parcela never clears below.
              reconciliationMatches: {
                where: { reversedAt: null },
                select: { id: true, transactionId: true, allocatedAmount: true, matchedAt: true },
              },
            },
          },
          reconciliationMatches: {
            where: { reversedAt: null },
            select: { id: true, transactionId: true, allocatedAmount: true, matchedAt: true },
          },
          invoice: {
            select: {
              id: true,
              taskId: true,
              task: { select: { name: true } },
              customer: { select: { id: true, fantasyName: true } },
              _count: { select: { installments: true } },
            },
          },
          customerConfig: {
            select: {
              orderNumber: true,
              customer: { select: { id: true, fantasyName: true } },
              quote: { select: { task: { select: { id: true, name: true } } } },
              _count: { select: { installments: true } },
            },
          },
          externalOperation: {
            select: {
              id: true,
              customer: { select: { id: true, fantasyName: true } },
              _count: { select: { installments: true } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      const rows: ReceivableRow[] = installments.map(inst => {
        const amount = Number(inst.amount);
        const paidAmount = Number(inst.paidAmount ?? 0);
        const customer =
          inst.invoice?.customer ??
          inst.customerConfig?.customer ??
          inst.externalOperation?.customer ??
          null;
        const source: ReceivableSource = inst.externalOperationId
          ? 'EXTERNAL_OPERATION'
          : inst.customerConfigId
            ? 'TASK_QUOTE'
            : 'INVOICE';

        // A parcela due TODAY is not overdue — it only becomes overdue the day after
        // its due date. Comparing raw instants flipped it at 09:00 SP (noon UTC) on the
        // due date itself.
        const overdue =
          inst.status !== 'PAID' && inst.dueDate != null && isDueDateOverdue(inst.dueDate);
        let state: ReceivableState;
        if (inst.status === 'PAID') state = 'RECEIVED';
        else if (overdue) state = 'OVERDUE';
        else if (paidAmount > 0 && paidAmount < amount) state = 'PARTIALLY_RECEIVED';
        else state = 'AWAITING_RECEIPT';

        const label =
          customer?.fantasyName ??
          inst.customerConfig?.orderNumber ??
          'Cliente';

        // Primary row label is the task (faturamento) name; non-task receivables
        // (external ops / standalone invoices) fall back to the customer / parcela.
        const taskName =
          inst.invoice?.task?.name ??
          inst.customerConfig?.quote?.task?.name ??
          null;
        const description =
          taskName ?? customer?.fantasyName ?? `Parcela ${inst.number}`;
        const totalInstallments =
          inst.invoice?._count?.installments ??
          inst.customerConfig?._count?.installments ??
          inst.externalOperation?._count?.installments ??
          1;

        // Axis B — derive clearance from the (non-reversed) match + amount drift.
        // Matches land on installmentId (PIX/TED direct) OR bankSlipId (boleto) —
        // merge both anchors so boleto-cleared parcelas count as reconciled too.
        const allMatches = [...inst.reconciliationMatches, ...(inst.bankSlip?.reconciliationMatches ?? [])];
        const match = allMatches[0] ?? null;
        // Conciliação declarada à mão vale como CLEARED: o dinheiro entrou numa
        // conta de sócio, então a linha de extrato que confirmaria isto não existe
        // e nunca vai existir. Sem contar aqui, a parcela ficaria para sempre
        // "recebida mas não conciliada" — que é exatamente o alarme reservado para
        // dinheiro que talvez não tenha entrado.
        const externallyCleared = !!inst.externalClearedAt;
        let clearanceState: 'UNCLEARED' | 'CLEARED' | 'DISPUTED' = 'UNCLEARED';
        if (match) {
          const tol = Math.max(2, amount * 0.005);
          const drift = Math.abs(Number(match.allocatedAmount) - amount);
          clearanceState = drift > tol ? 'DISPUTED' : 'CLEARED';
        } else if (externallyCleared) {
          clearanceState = 'CLEARED';
        }

        return {
          source,
          id: inst.id,
          invoiceId: inst.invoiceId,
          // Task-quote (faturamento) the receipt belongs to — the row's nav target.
          taskId: inst.invoice?.taskId ?? inst.customerConfig?.quote?.task?.id ?? null,
          customerId: customer?.id ?? null,
          customerName: label,
          description,
          amount,
          paidAmount,
          state,
          dueDate: inst.dueDate,
          paidAt: inst.paidAt ?? null,
          number: inst.number,
          totalInstallments,
          paymentMethod: inst.paymentMethod ?? null,
          hasBankSlip: !!inst.bankSlip,
          reconciled: allMatches.length > 0 || externallyCleared,
          // Distingue "bate com o extrato" de "alguém declarou que entrou por fora",
          // para a lista poder rotular as duas coisas sem fingir que são a mesma.
          externallyCleared,
          externalClearedNote: inst.externalClearedNote ?? null,
          // The bank transaction this receipt was conciliated against (if any),
          // so the list row can link straight to its reconciliation detail.
          transactionId: match?.transactionId ?? null,
          clearanceState,
          clearedAt: match?.matchedAt ?? inst.externalClearedAt ?? null,
        };
      });

      const emptyBucket = () => ({ count: 0, total: 0 });
      const summary: ReceivablesSummary = {
        AWAITING_RECEIPT: emptyBucket(),
        PARTIALLY_RECEIVED: emptyBucket(),
        OVERDUE: emptyBucket(),
        RECEIVED: emptyBucket(),
      };
      for (const row of rows) {
        const bucket = summary[row.state];
        if (!bucket) continue;
        bucket.count += 1;
        // Show the outstanding amount for open buckets, the received amount for RECEIVED.
        bucket.total += row.state === 'RECEIVED' ? row.paidAmount : row.amount - row.paidAmount;
      }

      return {
        success: true,
        message: 'Contas a receber carregadas com sucesso.',
        data: { rows, summary },
      };
    } catch (error) {
      this.logger.error('Erro ao carregar contas a receber:', error as Error);
      throw new InternalServerErrorException('Erro ao carregar contas a receber. Por favor, tente novamente.');
    }
  }
}
