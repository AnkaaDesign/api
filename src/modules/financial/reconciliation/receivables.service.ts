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

  async getReceivables(): Promise<ReceivablesResponse> {
    try {
      const now = new Date();
      const receivedSince = new Date(now.getTime() - RECEIVED_LOOKBACK_DAYS * 86_400_000);

      const installments = await this.prisma.installment.findMany({
        where: {
          OR: [
            { status: { in: ['PENDING', 'PROCESSING', 'OVERDUE'] } },
            { status: 'PAID', paidAt: { gte: receivedSince } },
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
