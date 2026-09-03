import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReconciliationMatchType, ReconciliationSource, ReconciliationStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { TaskQuoteStatusCascadeService } from '@modules/production/task-quote/task-quote-status-cascade.service';
import { TASK_QUOTE_STATUS, TASK_QUOTE_STATUS_ORDER } from '@constants';
import { allocateBudgetNumber } from '@utils/budget-number';
import { isDueDateOverdue } from '@utils/due-date.util';
import { nameSimilarity } from './text-normalization';
import {
  ALLOC_TOLERANCE,
  deriveBillingState,
  openCapacityOf,
  planFifo,
  round2,
  scoreTaskCandidate,
  OPEN_INSTALLMENT_STATUSES,
} from './task-match-allocation';
import { RECON_ADVISORY_LOCK_KEY } from './reconciliation-matcher.service';
import { QUOTE_TASKS_ORDER_BY } from '@utils/quote-tasks';
import type {
  TaskBillingState,
  TaskMatchAllocationInput,
  TaskMatchCandidate,
  TaskMatchOutcome,
} from '../../../types';

/**
 * Task-anchored manual conciliation of an incoming bank credit.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Installment` is the only anchor a CREDIT can be matched to
 * (`ReconciliationMatch.installmentId`), and an installment only exists at the
 * end of a chain that starts at the quote:
 *
 *     Task.quoteId → TaskQuote → TaskQuoteCustomerConfig → Invoice → Installment
 *
 * The system migration left a large population of tasks with `quoteId = NULL`
 * (the FK lives on Task with ON DELETE SET NULL, so a deleted quote leaves no
 * trace at all). For those tasks the chain simply does not exist, so a Sicredi
 * credit that really did pay them has nowhere to go: it is invisible to the
 * candidate finder, to Contas a Receber, and to every matcher pass.
 *
 * This service closes that gap by building whatever part of the spine is
 * missing — up to and including the TaskQuote itself — and then handing off to
 * the ordinary allocation path, so nothing downstream needs to know a shortcut
 * was taken.
 *
 * CARDINALITY
 * -----------
 * Both directions are genuinely N:M and both fall out of the existing schema:
 *
 *  - one credit → many tasks: one `ReconciliationMatch` row per installment,
 *    each carrying its own `allocatedAmount`. Guarded by
 *    `@@unique([transactionId, installmentId])`.
 *  - many credits → one task/quote: `Installment.paidAmount` accrues across
 *    matches; the parcela flips to PAID only when fully covered, and
 *    `unmatchInflow` recomputes it from the surviving matches.
 *
 * SETTLEMENT
 * ----------
 * This service never writes a quote status directly. It mints/advances the
 * quote to BILLING_APPROVED — the entry point of the receivables lifecycle —
 * and `TaskQuoteStatusCascadeService.cascadeFromInstallment` does the rest,
 * landing on PARTIAL or SETTLED from the installments alone. That is the same
 * path the Sicredi webhook uses, so a task paid by PIX and a task paid by
 * boleto end up in exactly the same state by exactly the same code.
 */
@Injectable()
export class ReceivableTaskMatchService {
  private readonly logger = new Logger(ReceivableTaskMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cascadeService: TaskQuoteStatusCascadeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------------

  /** How many tasks the identity-derived (no search term) list returns. */
  private static readonly IDENTITY_LIMIT = 40;

  /** How many tasks a free-text search returns. */
  private static readonly SEARCH_LIMIT = 40;

  /**
   * Date half-window (days) for scoring a task against a credit. Deliberately
   * wide: these are tasks whose paperwork was lost, so the gap between the work
   * finishing and the money landing can be months.
   */
  private static readonly DATE_WINDOW_DAYS = 180;

  /** Minimum name similarity for a task's customer to be offered at all. */
  private static readonly NAME_SUGGEST_SIM = 0.45;

  /** Statuses whose tasks are never conciliation targets. */
  private static readonly EXCLUDED_TASK_STATUSES = ['CANCELLED'] as const;

  private static onlyDigits(v: string | null | undefined): string {
    return (v || '').replace(/\D/g, '');
  }

  // ---------------------------------------------------------------------------
  // Candidate discovery
  // ---------------------------------------------------------------------------

  /**
   * Tasks offered as conciliation targets for a credit.
   *
   * Two modes, deliberately different:
   *
   *  - no `search`: identity-first. Resolve WHO paid from the credit's CNPJ/CPF
   *    (exact, then 8-digit CNPJ root for filiais) or a fuzzy counterparty-name
   *    hit, then list that customer's tasks. This mirrors the installment
   *    matcher's dominant real-world pattern — value alone finds nothing,
   *    because B2B customers pay many jobs in one PIX. Tasks that already have
   *    an open parcela are deliberately excluded: those belong to the ordinary
   *    receivable candidate list, and offering them here as well would show the
   *    same money twice under two different names.
   *
   *  - with `search`: the operator overrides identity entirely. Searches the
   *    accent-insensitive generated columns, so a plate, a serial, a task name
   *    or a customer name all work. This is the escape hatch for a credit whose
   *    memo carries no usable identity at all (`LIQ.COBRANCA` and friends).
   */
  async getTaskCandidates(transactionId: string, search?: string): Promise<TaskMatchCandidate[]> {
    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        postedAt: true,
        amount: true,
        type: true,
        counterpartyName: true,
        counterpartyCnpjCpf: true,
      },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') {
      throw new BadRequestException('Conciliação por tarefa requer um crédito (entrada).');
    }

    const creditAbs = Math.abs(Number(tx.amount));
    // What this credit still has to give — a credit already partly allocated to
    // other targets must not suggest its gross value all over again.
    const unallocated = await this.remainingCredit(transactionId, creditAbs);

    const term = search?.trim() || '';
    const taskIds = term
      ? await this.searchTaskIds(term)
      : await this.identityTaskIds(tx.counterpartyCnpjCpf, tx.counterpartyName);

    if (taskIds.length === 0) return [];

    return this.buildCandidates(taskIds, tx, unallocated, term.length > 0);
  }

  /** Free-text task lookup over the accent-insensitive generated columns. */
  private async searchTaskIds(term: string): Promise<string[]> {
    // Match how the generated *Normalized columns are built (unaccent + lower),
    // so the operator's accents never prevent a hit. Escaped combining-mark
    // range rather than literal marks, which do not survive copy/paste intact.
    const normalized = term
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const digits = ReceivableTaskMatchService.onlyDigits(term);
    const plateTerm = normalized.replace(/[^a-z0-9]/g, '');

    const rows = await this.prisma.task.findMany({
      where: {
        status: { notIn: ReceivableTaskMatchService.EXCLUDED_TASK_STATUSES as unknown as any },
        OR: [
          { nameNormalized: { contains: normalized } },
          { serialNumberNormalized: { contains: normalized } },
          // Placa e chassi entram no banco sem separador — o termo perde o
          // hífen também, senão colar "ABC-1234" da tela não casa nada.
          { truck: { plateNormalized: { contains: plateTerm } } },
          { truck: { chassisNumberNormalized: { contains: plateTerm } } },
          { customer: { fantasyNameNormalized: { contains: normalized } } },
          { customer: { corporateNameNormalized: { contains: normalized } } },
          ...(digits.length >= 3
            ? [
                { customer: { cnpjNormalized: { contains: digits } } },
                { customer: { cpfNormalized: { contains: digits } } },
              ]
            : []),
        ],
      },
      select: { id: true },
      orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
      take: ReceivableTaskMatchService.SEARCH_LIMIT,
    });
    return rows.map(r => r.id);
  }

  /**
   * Identity-first task lookup: resolve the paying customer from the credit,
   * then take their tasks. Returns [] when identity cannot be resolved at all,
   * which is the honest answer — the UI then prompts for a search term rather
   * than showing an arbitrary list of tasks.
   */
  private async identityTaskIds(
    counterpartyCnpjCpf: string | null,
    counterpartyName: string | null,
  ): Promise<string[]> {
    const customerIds = await this.resolveCustomerIds(counterpartyCnpjCpf, counterpartyName);
    if (customerIds.length === 0) return [];

    const rows = await this.prisma.task.findMany({
      where: {
        status: { notIn: ReceivableTaskMatchService.EXCLUDED_TASK_STATUSES as unknown as any },
        OR: [
          { customerId: { in: customerIds } },
          // A task can be billed to someone other than its own customer, so the
          // quote's billing configs are an equally valid identity route.
          { quote: { customerConfigs: { some: { customerId: { in: customerIds } } } } },
        ],
        // A task whose quote ALREADY has an open parcela is not this list's
        // business: the credit is conciliated against the parcela, by the
        // ordinary receivable candidate list, exactly like every other receipt.
        // Offering it here too would show the same money twice under two
        // different names. What is left is precisely what the parcela list
        // structurally cannot reach — no quote at all, an unbilled quote, or a
        // settled quote that has to grow to absorb more money.
        NOT: {
          quote: {
            customerConfigs: {
              some: {
                installments: {
                  some: {
                    status: { in: OPEN_INSTALLMENT_STATUSES as unknown as any },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
      orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
      take: ReceivableTaskMatchService.IDENTITY_LIMIT,
    });
    return rows.map(r => r.id);
  }

  /**
   * Resolve candidate customers for a credit.
   *
   * Ranked exactly like the installment matcher: exact document, then CNPJ root
   * (same economic group, different filial), then fuzzy name. Returns a list
   * rather than a single winner because this feeds a manual picker — ambiguity
   * is the operator's to resolve, not ours to guess.
   */
  private async resolveCustomerIds(
    counterpartyCnpjCpf: string | null,
    counterpartyName: string | null,
  ): Promise<string[]> {
    const digits = ReceivableTaskMatchService.onlyDigits(counterpartyCnpjCpf);

    if (digits) {
      const exact = await this.prisma.customer.findFirst({
        where: { OR: [{ cnpj: digits }, { cpf: digits }] },
        select: { id: true },
      });
      if (exact) return [exact.id];

      if (digits.length === 14) {
        const root = digits.slice(0, 8);
        const filiais = await this.prisma.customer.findMany({
          where: { cnpj: { startsWith: root } },
          select: { id: true },
          take: 10,
        });
        if (filiais.length > 0) return filiais.map(c => c.id);
      }
    }

    if (!counterpartyName) return [];

    // No trigram index is reachable through Prisma here, so score in memory over
    // the id/name projection only. `nameSimilarity` already strips OFX prefixes
    // (PIX_CRED) and legal forms (LTDA/SA), so raw memo names compare cleanly.
    const all = await this.prisma.customer.findMany({
      select: { id: true, fantasyName: true, corporateName: true },
    });
    const scored = all
      .map(c => ({
        id: c.id,
        sim: Math.max(
          nameSimilarity(counterpartyName, c.fantasyName ?? ''),
          nameSimilarity(counterpartyName, c.corporateName ?? ''),
        ),
      }))
      .filter(c => c.sim >= ReceivableTaskMatchService.NAME_SUGGEST_SIM)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5);
    return scored.map(c => c.id);
  }

  /** Hydrate task ids into scored candidates. */
  private async buildCandidates(
    taskIds: string[],
    tx: {
      postedAt: Date;
      amount: Prisma.Decimal | number;
      counterpartyName: string | null;
      counterpartyCnpjCpf: string | null;
    },
    unallocated: number,
    fromSearch: boolean,
  ): Promise<TaskMatchCandidate[]> {
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        name: true,
        serialNumber: true,
        status: true,
        entryDate: true,
        finishedAt: true,
        createdAt: true,
        customerId: true,
        customer: {
          select: { id: true, fantasyName: true, corporateName: true, cnpj: true, cpf: true },
        },
        truck: { select: { plate: true } },
        quote: {
          select: {
            id: true,
            budgetNumber: true,
            status: true,
            total: true,
            customerConfigs: {
              select: {
                id: true,
                customerId: true,
                customer: {
                  select: { id: true, fantasyName: true, corporateName: true, cnpj: true, cpf: true },
                },
                installments: {
                  select: {
                    id: true,
                    number: true,
                    dueDate: true,
                    amount: true,
                    paidAmount: true,
                    status: true,
                    bankSlip: { select: { id: true } },
                  },
                  orderBy: { dueDate: 'asc' },
                },
              },
            },
          },
        },
        // Invoice-anchored parcelas (a quote-less invoice bound straight to the
        // task) are equally real receivables and must count toward capacity.
        invoiceEntities: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            id: true,
            installments: {
              select: {
                id: true,
                number: true,
                dueDate: true,
                amount: true,
                paidAmount: true,
                status: true,
                bankSlip: { select: { id: true } },
              },
              orderBy: { dueDate: 'asc' },
            },
          },
        },
      },
    });

    const txCnpj = ReceivableTaskMatchService.onlyDigits(tx.counterpartyCnpjCpf);
    const creditAbs = Math.abs(Number(tx.amount));

    const candidates = tasks.map<TaskMatchCandidate>(task => {
      const installments = this.collectInstallments(task);
      const open = installments.filter(i =>
        (OPEN_INSTALLMENT_STATUSES as readonly string[]).includes(i.status),
      );
      const openCapacity = openCapacityOf(open);
      const reconciledAmount = round2(installments.reduce((s, i) => s + i.paidAmount, 0));

      const billingState: TaskBillingState = deriveBillingState({
        hasQuote: !!task.quote,
        installmentCount: installments.length,
        openCapacity,
      });

      // Billing customer beats the task's own customer for identity purposes —
      // Task.invoiceToId was removed precisely because the money side lives on
      // the quote's configs.
      const billed = task.quote?.customerConfigs?.[0]?.customer ?? null;
      const customer = billed ?? task.customer ?? null;
      const customerCnpjCpf =
        ReceivableTaskMatchService.onlyDigits(customer?.cnpj ?? customer?.cpf ?? null) || null;
      const customerName = customer?.fantasyName ?? customer?.corporateName ?? null;
      const referenceDate = task.finishedAt ?? task.entryDate ?? task.createdAt ?? null;

      const { confidence, reason } = scoreTaskCandidate({
        unallocated,
        postedAt: tx.postedAt,
        txCnpj,
        txName: tx.counterpartyName,
        customerCnpjCpf,
        customerName,
        referenceDate,
        quoteTotal: task.quote ? Number(task.quote.total) : null,
        openCapacity,
        billingState,
        fromSearch,
        nameSimilarity,
      });

      return {
        taskId: task.id,
        taskName: task.name,
        taskSerialNumber: task.serialNumber,
        taskStatus: task.status,
        plate: task.truck?.plate ?? null,
        customerId: customer?.id ?? task.customerId ?? null,
        customerName,
        customerCnpjCpf,
        quoteId: task.quote?.id ?? null,
        budgetNumber: task.quote?.budgetNumber ?? null,
        quoteStatus: task.quote?.status ?? null,
        quoteTotal: task.quote ? Number(task.quote.total) : null,
        billingState,
        openCapacity,
        openInstallments: open.map(i => ({
          installmentId: i.id,
          number: i.number,
          dueDate: i.dueDate,
          amount: i.amount,
          paidAmount: i.paidAmount,
          remaining: round2(i.remaining),
          status: i.status,
          hasBankSlip: i.hasBankSlip,
        })),
        reconciledAmount,
        // Never suggest more than the credit still has, nor more than the task
        // can absorb without new capacity — unless it has no capacity at all,
        // in which case the whole remainder is the natural proposal.
        suggestedAmount: round2(
          openCapacity > ALLOC_TOLERANCE
            ? Math.min(unallocated, openCapacity)
            : unallocated,
        ),
        confidence,
        reason,
        referenceDate,
      };
    });

    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Every installment reachable from a task, de-duplicated.
   *
   * Two routes reach the same parcela and both must be walked: the quote's
   * customer configs, and invoices bound straight to the task. An installment
   * generated the normal way carries BOTH `customerConfigId` and `invoiceId`,
   * so it shows up twice and has to be keyed by id.
   */
  private collectInstallments(task: {
    quote: { customerConfigs: { installments: RawInstallment[] }[] } | null;
    invoiceEntities: { installments: RawInstallment[] }[];
  }): CollectedInstallment[] {
    const byId = new Map<string, CollectedInstallment>();
    const push = (i: RawInstallment) => {
      if (byId.has(i.id)) return;
      const amount = Number(i.amount);
      const paidAmount = Number(i.paidAmount ?? 0);
      byId.set(i.id, {
        id: i.id,
        number: i.number,
        dueDate: i.dueDate,
        amount,
        paidAmount,
        remaining: Math.max(0, amount - paidAmount),
        status: i.status,
        hasBankSlip: !!i.bankSlip,
      });
    };
    for (const config of task.quote?.customerConfigs ?? []) config.installments.forEach(push);
    for (const invoice of task.invoiceEntities ?? []) invoice.installments.forEach(push);
    return [...byId.values()].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }

  /** How much of a credit is not yet spoken for by live matches. */
  private async remainingCredit(transactionId: string, creditAbs: number): Promise<number> {
    const existing = await this.prisma.reconciliationMatch.aggregate({
      where: { transactionId, reversedAt: null },
      _sum: { allocatedAmount: true },
    });
    const used = Number(existing._sum.allocatedAmount ?? 0);
    return round2(Math.max(0, creditAbs - used));
  }

  // ---------------------------------------------------------------------------
  // The match itself
  // ---------------------------------------------------------------------------

  /**
   * Conciliate a credit against one or more tasks, building whatever billing
   * spine each task is missing.
   *
   * Everything below runs inside ONE transaction holding
   * `pg_advisory_xact_lock(RECON_ADVISORY_LOCK_KEY)`, so the read-then-write
   * windows (capacity check → allocate, MAX(budgetNumber) → insert) cannot race
   * the auto-matcher or a second operator. The cascade runs after COMMIT,
   * mirroring every other settlement path.
   */
  async matchTasks(
    transactionId: string,
    allocations: TaskMatchAllocationInput[],
    userId: string,
    notes?: string,
  ) {
    if (!allocations?.length) throw new BadRequestException('Informe ao menos uma tarefa.');

    const duplicates = allocations
      .map(a => a.taskId)
      .filter((id, i, arr) => arr.indexOf(id) !== i);
    if (duplicates.length > 0) {
      throw new BadRequestException(
        'A mesma tarefa foi informada mais de uma vez. Some os valores em uma única alocação.',
      );
    }

    const tx = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, postedAt: true, amount: true, type: true, subtype: true, memo: true },
    });
    if (!tx) throw new NotFoundException('Transação não encontrada.');
    if (tx.type !== 'CREDIT') {
      throw new BadRequestException('Conciliação por tarefa requer um crédito (entrada).');
    }

    const creditAbs = Math.abs(Number(tx.amount));
    const totalAlloc = round2(
      allocations.reduce((s, a) => s + a.amount, 0),
    );
    if (totalAlloc <= 0) throw new BadRequestException('Valor alocado deve ser maior que zero.');

    // Room left on the credit, accounting for allocations it already carries —
    // this is what lets a second task be conciliated onto a PARTIAL credit
    // without wiping the first.
    const available = await this.remainingCredit(transactionId, creditAbs);
    if (totalAlloc > available + ALLOC_TOLERANCE) {
      throw new BadRequestException(
        `A soma das alocações (${this.brl(totalAlloc)}) excede o saldo disponível do crédito (${this.brl(available)}).`,
      );
    }

    const outcomes: TaskMatchOutcome[] = [];
    const touchedInstallmentIds: string[] = [];

    await this.prisma.$transaction(
      async db => {
        // Serializes against the auto-matcher and against a concurrent operator.
        await db.$executeRaw`SELECT pg_advisory_xact_lock(${RECON_ADVISORY_LOCK_KEY})`;

        // Re-read under the lock: the credit may have been reconciled, ignored
        // or partly allocated between the pre-flight checks above and here.
        const live = await db.bankTransaction.findUniqueOrThrow({
          where: { id: transactionId },
          select: { reconciliationStatus: true },
        });
        if (live.reconciliationStatus === ReconciliationStatus.IGNORED) {
          throw new BadRequestException(
            'Esta transação está ignorada. Reative-a antes de conciliar.',
          );
        }

        // Authoritative balance check. The pre-flight one above is a fast fail
        // outside the lock and can be stale; this one cannot.
        const claimed = await db.reconciliationMatch.aggregate({
          where: { transactionId, reversedAt: null },
          _sum: { allocatedAmount: true },
        });
        const liveAvailable = round2(
          Math.max(0, creditAbs - Number(claimed._sum.allocatedAmount ?? 0)),
        );
        if (totalAlloc > liveAvailable + ALLOC_TOLERANCE) {
          throw new BadRequestException(
            `A soma das alocações (${this.brl(totalAlloc)}) excede o saldo disponível do crédito (${this.brl(liveAvailable)}).`,
          );
        }

        for (const alloc of allocations) {
          const outcome = await this.applyTaskAllocation(db, tx, alloc, userId, notes);
          outcomes.push(outcome.outcome);
          touchedInstallmentIds.push(...outcome.outcome.installmentIds);
        }

        // Recompute every touched invoice from its installments.
        const invoiceIds = await db.installment.findMany({
          where: { id: { in: touchedInstallmentIds }, invoiceId: { not: null } },
          select: { invoiceId: true },
        });
        for (const id of new Set(invoiceIds.map(i => i.invoiceId!))) {
          await this.recalcInvoice(db, id);
        }

        // The credit is RECONCILED only when everything it carries — including
        // allocations made by earlier calls — covers its face value.
        const totalNow = await db.reconciliationMatch.aggregate({
          where: { transactionId, reversedAt: null },
          _sum: { allocatedAmount: true },
        });
        const allocatedNow = Number(totalNow._sum.allocatedAmount ?? 0);
        const fully = allocatedNow >= creditAbs - ALLOC_TOLERANCE;

        await db.bankTransaction.update({
          where: { id: transactionId },
          data: {
            reconciliationStatus: fully ? ReconciliationStatus.RECONCILED : ReconciliationStatus.PARTIAL,
            reconciliationSource: ReconciliationSource.MANUAL,
            topMatchScore: null,
          },
        });

        await this.tagServiceRevenue(db, transactionId, new Decimal(allocatedNow));
      },
      // Minting a quote + invoice + parcelas for several tasks in one call does
      // real work; the 5s default is too tight for a lump-sum split.
      { timeout: 30_000 },
    );

    // Outside the transaction, exactly like every other settlement path: the
    // cascade re-reads committed state and dispatches notifications.
    for (const installmentId of new Set(touchedInstallmentIds)) {
      await this.cascadeService.cascadeFromInstallment(installmentId).catch(() => undefined);
    }

    const finalStatus = await this.prisma.bankTransaction.findUnique({
      where: { id: transactionId },
      select: { reconciliationStatus: true },
    });

    const created = outcomes.filter(o => o.quoteCreated).length;
    const message = created
      ? `Crédito conciliado com ${outcomes.length} tarefa(s); ${created} orçamento(s) criado(s).`
      : `Crédito conciliado com ${outcomes.length} tarefa(s).`;

    return {
      success: true,
      message,
      data: {
        transactionId,
        totalAllocated: totalAlloc,
        reconciliationStatus: finalStatus?.reconciliationStatus ?? ReconciliationStatus.PARTIAL,
        outcomes,
      },
    };
  }

  /**
   * Resolve one task's billing spine and allocate its share onto it.
   *
   * Order of operations matters: use existing capacity first, materialize an
   * unbilled quote second, and only create new capacity as a last resort. That
   * way a credit for a task that WAS properly billed never invents a parallel
   * parcela beside the real one.
   */
  private async applyTaskAllocation(
    db: Prisma.TransactionClient,
    tx: { id: string; postedAt: Date; subtype: string | null; memo: string | null },
    alloc: TaskMatchAllocationInput,
    userId: string,
    notes?: string,
  ): Promise<{ outcome: TaskMatchOutcome }> {
    if (alloc.amount <= 0) throw new BadRequestException('Cada alocação deve ser positiva.');

    const task = await db.task.findUnique({
      where: { id: alloc.taskId },
      select: {
        id: true,
        name: true,
        status: true,
        serialNumber: true,
        customerId: true,
        finishedAt: true,
        quoteId: true,
        quote: {
          select: {
            id: true,
            budgetNumber: true,
            status: true,
            subtotal: true,
            total: true,
            customerConfigs: {
              select: {
                id: true,
                customerId: true,
                // A TAREFA DA FATIA. Nula quando a fatia cobre o orçamento
                // inteiro (`JOINT`); preenchida quando o orçamento fatura
                // veículo a veículo (`PER_TASK`). Sem ela, a fatura da fatia do
                // caminhão 37 nasceria apontando para o caminhão 1.
                taskId: true,
                subtotal: true,
                total: true,
                paymentCondition: true,
                generateInvoice: true,
                generateBankSlip: true,
                invoice: { select: { id: true, status: true, totalAmount: true } },
                installments: {
                  select: { id: true, number: true, dueDate: true, amount: true, paidAmount: true, status: true },
                  orderBy: { dueDate: 'asc' },
                },
              },
            },
            services: { select: { id: true, position: true, amount: true } },
          },
        },
        invoiceEntities: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            id: true,
            customerConfigId: true,
            installments: {
              select: { id: true, number: true, dueDate: true, amount: true, paidAmount: true, status: true },
              orderBy: { dueDate: 'asc' },
            },
          },
        },
      },
    });
    if (!task) throw new NotFoundException(`Tarefa ${alloc.taskId} não encontrada.`);
    if ((ReceivableTaskMatchService.EXCLUDED_TASK_STATUSES as readonly string[]).includes(task.status)) {
      throw new BadRequestException(`A tarefa ${this.taskLabel(task)} está cancelada.`);
    }

    const dueDate = alloc.dueDate ?? task.finishedAt ?? tx.postedAt;
    const description =
      alloc.description?.trim() ||
      `Conciliação bancária${task.serialNumber ? ` — OS ${task.serialNumber}` : ''}`;

    let quoteId = task.quote?.id ?? null;
    let budgetNumber = task.quote?.budgetNumber ?? 0;
    let quoteCreated = false;
    let quoteExtended = false;
    let invoiceCreated = false;

    // ---- 1. no quote at all → mint the whole spine, sized to this allocation.
    if (!task.quote) {
      const customerId = alloc.customerId ?? task.customerId;
      if (!customerId) {
        throw new BadRequestException(
          `A tarefa ${this.taskLabel(task)} não tem cliente. Informe o cliente a faturar.`,
        );
      }
      const minted = await this.mintQuote(db, {
        taskId: task.id,
        customerId,
        amount: alloc.amount,
        dueDate,
        description,
        subtype: tx.subtype,
        userId,
      });
      quoteId = minted.quoteId;
      budgetNumber = minted.budgetNumber;
      quoteCreated = true;
      invoiceCreated = true;

      const installmentIds = await this.allocateOnto(
        db,
        tx,
        [{ installmentId: minted.installmentId, amount: alloc.amount }],
        userId,
        notes,
      );
      return {
        outcome: {
          taskId: task.id,
          quoteId: quoteId!,
          budgetNumber,
          quoteCreated,
          quoteExtended,
          invoiceCreated,
          allocated: alloc.amount,
          installmentIds,
        },
      };
    }

    // ---- 2. quote exists. Gather what it can already absorb.
    let open = this.openFromTask(task);
    let capacity = openCapacityOf(open);

    // ---- 2a. billed nothing yet → materialize invoice + parcelas from the
    // quote's OWN totals (never from the credit: the quote is the authority on
    // what the job was worth).
    if (open.length === 0 && this.hasBillableConfigs(task.quote)) {
      await this.materializeFromQuote(db, task.quote, dueDate, tx.subtype, userId);
      invoiceCreated = true;
      const reloaded = await this.reloadOpen(db, task.id, task.quote.id);
      open = reloaded;
      capacity = openCapacityOf(open);
    }

    // ---- 2b. still short → this credit is revenue the quote does not record
    // yet, so give the quote a service + a parcela for exactly the difference.
    //
    // Several credits landing on one job is the normal shape of this flow, so it
    // still needs no confirmation checkbox — but it is no longer unconditional.
    //
    // Guarded 19/08/2026. The original doctrine assumed the operator reaches this
    // screen knowing the quote should grow. Production said otherwise: the
    // candidate list returned nothing for LIQ.COBRANCA credits whose boleto had
    // been CANCELLED, so "Conciliar por tarefa" was the only button left, and five
    // quotes were silently inflated by R$ 45.384,83 of revenue nobody had billed.
    // Four of them had to be deleted by hand.
    //
    // The discriminator is the authority rule branch 2a already states: the QUOTE
    // decides what the job was worth. If every centavo of the quote's own total
    // already carries a parcela, the job is fully billed and this credit is not
    // new revenue — it is money for something already recorded, belonging on an
    // existing parcela (now offered as a link-only candidate) or on another task.
    // A quote that is NOT fully billed can still be extended, which is the case
    // this flow was written for.
    const shortfall = round2(alloc.amount - capacity);
    if (shortfall > ALLOC_TOLERANCE) {
      const quoteTotal = round2(
        task.quote.customerConfigs.reduce((s, c) => s + Number(c.total), 0),
      );
      const billed = round2(
        task.quote.customerConfigs.reduce(
          (s, c) => s + c.installments.reduce((t, i) => t + Number(i.amount), 0),
          0,
        ),
      );
      if (quoteTotal > 0 && billed >= quoteTotal - ALLOC_TOLERANCE) {
        throw new BadRequestException(
          `O orçamento da tarefa ${this.taskLabel(task)} já está integralmente faturado ` +
            `(${this.brl(billed)} em parcelas para um total de ${this.brl(quoteTotal)}). ` +
            `Conciliar ${this.brl(alloc.amount)} aqui criaria receita que ninguém faturou. ` +
            `Se o dinheiro é desta tarefa, aloque-o na parcela já existente pela lista de ` +
            `candidatos; se o orçamento está errado, corrija o orçamento antes de conciliar.`,
        );
      }
      const extended = await this.extendQuote(db, {
        quote: task.quote,
        taskId: task.id,
        customerId: alloc.customerId ?? task.customerId,
        amount: shortfall,
        dueDate,
        description,
        subtype: tx.subtype,
        userId,
      });
      quoteExtended = true;
      if (extended.invoiceCreated) invoiceCreated = true;
      open = [...open, extended.installment];
      capacity += shortfall;
    }

    // ---- 3. allocate FIFO by due date across the open parcelas.
    const plan = planFifo(open, alloc.amount);
    if (!plan) {
      // Unreachable: capacity was checked (and grown) before planning. Kept as
      // a hard stop so a future change to the branches above can never make
      // this silently under-allocate.
      throw new BadRequestException(
        `Não foi possível alocar ${this.brl(alloc.amount)} na tarefa ${this.taskLabel(task)} — saldo insuficiente nas parcelas.`,
      );
    }
    const installmentIds = await this.allocateOnto(db, tx, plan, userId, notes);

    // A quote sitting below the receivables lifecycle would be ignored by the
    // status cascade, leaving it reading "Pendente" with paid parcelas hanging
    // off it. Lift it to the lifecycle entry point and let the cascade decide
    // between PARTIAL and SETTLED from the installments alone.
    await this.ensureCascadable(db, task.quote.id, task.quote.status);

    return {
      outcome: {
        taskId: task.id,
        quoteId: quoteId!,
        budgetNumber,
        quoteCreated,
        quoteExtended,
        invoiceCreated,
        allocated: alloc.amount,
        installmentIds,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Spine construction
  // ---------------------------------------------------------------------------

  /**
   * Create TaskQuote → TaskQuoteCustomerConfig → Invoice → Installment for a
   * task that has none, sized to the credit being conciliated.
   *
   * Deliberately NOT routed through `TaskQuoteService.create` or
   * `InvoiceGenerationService.generateInvoicesForTask`: both emit NFS-e and
   * register Sicredi boletos. This is retroactive bookkeeping for money that
   * already landed — issuing a fiscal document or a charge for it would be
   * wrong and, in the boleto case, would bill the customer a second time.
   * `generateInvoice`/`generateBankSlip` are stored as false so any later pass
   * over these configs stays consistent with that.
   */
  private async mintQuote(
    db: Prisma.TransactionClient,
    input: {
      taskId: string;
      customerId: string;
      amount: number;
      dueDate: Date;
      description: string;
      subtype: string | null;
      userId: string;
    },
  ): Promise<{ quoteId: string; budgetNumber: number; installmentId: string }> {
    // Must be allocated inside THIS transaction — the advisory lock it takes is
    // released at COMMIT, so allocating outside buys nothing.
    const budgetNumber = await allocateBudgetNumber(db);
    const amount = new Decimal(input.amount);
    const now = new Date();

    const quote = await db.taskQuote.create({
      data: {
        budgetNumber,
        subtotal: amount,
        total: amount,
        // The work is done and paid; validity is bookkeeping only.
        expiresAt: input.dueDate,
        // Entry point of the receivables lifecycle — the cascade takes it from
        // here to PARTIAL/SETTLED once the parcela is allocated.
        status: TASK_QUOTE_STATUS.BILLING_APPROVED as any,
        statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.BILLING_APPROVED],
        billingApprovedAt: now,
        services: {
          create: [{ description: input.description, amount, position: 0 }],
        },
        customerConfigs: {
          create: [
            {
              customerId: input.customerId,
              subtotal: amount,
              total: amount,
              discountType: 'NONE',
              // No fiscal document, no charge — see the doc block above.
              generateInvoice: false,
              generateBankSlip: false,
            },
          ],
        },
      },
      select: { id: true, customerConfigs: { select: { id: true } } },
    });

    const configId = quote.customerConfigs[0].id;

    // Este ramo só roda com `task.quoteId` NULO, então não há orçamento anterior
    // para ficar órfão. (A justificativa antiga era o `@unique` de
    // `Task.quoteId`, que caiu com o orçamento multitarefa; a conclusão continua
    // valendo pela condição de entrada, não pela unicidade.)
    await db.task.update({ where: { id: input.taskId }, data: { quoteId: quote.id } });

    const invoice = await db.invoice.create({
      data: {
        customerConfigId: configId,
        taskId: input.taskId,
        customerId: input.customerId,
        totalAmount: amount,
        paidAmount: 0,
        status: 'ACTIVE',
        createdById: input.userId,
      },
      select: { id: true },
    });

    const installment = await db.installment.create({
      data: {
        // BOTH anchors, exactly like the commercial generator: the status
        // cascade reads parcelas through `quote.customerConfigs.installments`,
        // while invoice recalculation reads them through `invoiceId`.
        customerConfigId: configId,
        invoiceId: invoice.id,
        number: 1,
        dueDate: input.dueDate,
        amount,
        paidAmount: 0,
        status: 'PENDING',
        paymentMethod: this.paymentMethodFor(input.subtype),
      },
      select: { id: true },
    });

    this.logger.log(
      `[TASK_MATCH] Minted quote #${budgetNumber} (${quote.id}) for task ${input.taskId} — ${this.brl(input.amount)}`,
    );

    return { quoteId: quote.id, budgetNumber, installmentId: installment.id };
  }

  /**
   * Turn an approved-but-unbilled quote into real receivables.
   *
   * Amounts come from the quote's customer configs, NOT from the credit — the
   * quote already states what the job was worth, and a credit that covers only
   * part of it must leave the rest genuinely open.
   */
  private async materializeFromQuote(
    db: Prisma.TransactionClient,
    quote: QuoteWithConfigs,
    dueDate: Date,
    subtype: string | null,
    userId: string,
  ): Promise<void> {
    // A tarefa ÂNCORA do orçamento, só como reserva para a fatia `JOINT` (que
    // não tem tarefa própria). `orderBy` explícito porque um `findFirst` sem
    // ordem devolve o que o plano do Postgres entregar primeiro: em duas
    // execuções o mesmo orçamento apontaria a fatura para caminhões diferentes.
    const anchorTask = await db.task.findFirst({
      where: { quoteId: quote.id },
      orderBy: QUOTE_TASKS_ORDER_BY,
      select: { id: true },
    });

    for (const config of quote.customerConfigs) {
      const total = Number(config.total);
      if (total <= 0) continue;
      if (config.installments.length > 0) continue;

      let invoiceId = config.invoice?.id ?? null;
      if (invoiceId && config.invoice?.status === 'CANCELLED') invoiceId = null;

      if (!invoiceId) {
        const invoice = await db.invoice.create({
          data: {
            customerConfigId: config.id,
            // A tarefa DESTA fatia primeiro: em `PER_TASK` cada fatia é um
            // veículo, e usar a âncora para todas faria as sessenta faturas
            // apontarem para o caminhão 1.
            taskId: config.taskId ?? anchorTask?.id ?? null,
            customerId: config.customerId,
            totalAmount: new Decimal(total),
            paidAmount: 0,
            status: 'ACTIVE',
            createdById: userId,
          },
          select: { id: true },
        });
        invoiceId = invoice.id;
      }

      await db.installment.create({
        data: {
          customerConfigId: config.id,
          invoiceId,
          number: 1,
          dueDate,
          amount: new Decimal(total),
          paidAmount: 0,
          status: 'PENDING',
          paymentMethod: this.paymentMethodFor(subtype),
        },
      });

      this.logger.log(
        `[TASK_MATCH] Materialized ${this.brl(total)} for unbilled config ${config.id} (quote ${quote.id})`,
      );
    }
  }

  /**
   * Append billing capacity to an existing quote: one new service line plus one
   * new parcela, with the quote's and the config's totals kept consistent.
   *
   * Only reached behind an explicit `extend` opt-in — see the DTO.
   */
  private async extendQuote(
    db: Prisma.TransactionClient,
    input: {
      quote: QuoteWithConfigs;
      taskId: string;
      customerId: string | null;
      amount: number;
      dueDate: Date;
      description: string;
      subtype: string | null;
      userId: string;
    },
  ): Promise<{ installment: CollectedInstallment; invoiceCreated: boolean }> {
    const amount = new Decimal(input.amount);

    // Prefer the config the operator named, then the quote's only config —
    // anything else is genuinely ambiguous and must be asked, not guessed.
    const configs = input.quote.customerConfigs;
    let config =
      (input.customerId ? configs.find(c => c.customerId === input.customerId) : undefined) ??
      (configs.length === 1 ? configs[0] : undefined);

    // A quote with no billing config at all is degenerate (it can never have
    // produced a receivable). Give it one rather than refusing — this is
    // exactly the migration damage the feature exists to repair.
    if (!config && configs.length === 0) {
      if (!input.customerId) {
        throw new BadRequestException(
          'O orçamento não tem cliente de faturamento. Informe o cliente a faturar.',
        );
      }
      const created = await db.taskQuoteCustomerConfig.create({
        data: {
          quoteId: input.quote.id,
          customerId: input.customerId,
          subtotal: new Decimal(0),
          total: new Decimal(0),
          discountType: 'NONE',
          generateInvoice: false,
          generateBankSlip: false,
        },
        select: { id: true, customerId: true, subtotal: true, total: true },
      });
      config = {
        id: created.id,
        customerId: created.customerId,
        // `taskId` nulo: esta fatia de reparo cobre o ORÇAMENTO inteiro, que é o
        // que `JOINT` significa. Amarrá-la a um veículo faria a fatura nascer
        // recortada num caminhão que ninguém escolheu.
        taskId: null,
        subtotal: created.subtotal,
        total: created.total,
        paymentCondition: null,
        generateInvoice: false,
        generateBankSlip: false,
        invoice: null,
        installments: [],
      };
    }

    if (!config) {
      throw new BadRequestException(
        'O orçamento fatura para vários clientes. Informe qual cliente deve receber o valor adicional.',
      );
    }

    const nextPosition =
      input.quote.services.reduce((max, s) => Math.max(max, s.position ?? 0), -1) + 1;

    await db.taskQuoteService.create({
      data: {
        quoteId: input.quote.id,
        description: input.description,
        amount,
        position: nextPosition,
        // Pin the billing target explicitly — on a multi-config quote an
        // unassigned service folds into every aggregate.
        invoiceToCustomerId: config.customerId,
      },
    });

    await db.taskQuoteCustomerConfig.update({
      where: { id: config.id },
      data: {
        subtotal: new Decimal(Number(config.subtotal)).add(amount),
        total: new Decimal(Number(config.total)).add(amount),
      },
    });

    await db.taskQuote.update({
      where: { id: input.quote.id },
      data: {
        subtotal: new Decimal(Number(input.quote.subtotal)).add(amount),
        total: new Decimal(Number(input.quote.total)).add(amount),
      },
    });

    let invoiceCreated = false;

    // Re-read the config's invoice instead of trusting the snapshot taken when
    // the task was loaded. `materializeFromQuote` may have created one earlier
    // in THIS transaction (unbilled quote + a credit larger than its total), in
    // which case the snapshot still says null and creating a second one would
    // violate `Invoice_customerConfigId_active_unique` — the partial index over
    // non-CANCELLED invoices — taking the whole transaction down with it.
    const liveInvoice = await db.invoice.findFirst({
      where: { customerConfigId: config.id, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    let invoiceId = liveInvoice?.id ?? null;

    if (!invoiceId) {
      const invoice = await db.invoice.create({
        data: {
          customerConfigId: config.id,
          taskId: input.taskId,
          customerId: config.customerId,
          totalAmount: amount,
          paidAmount: 0,
          status: 'ACTIVE',
          createdById: input.userId,
        },
        select: { id: true },
      });
      invoiceId = invoice.id;
      invoiceCreated = true;
    } else {
      await db.invoice.update({
        where: { id: invoiceId },
        data: { totalAmount: { increment: amount } },
      });
    }

    // `@@unique([customerConfigId, number])` — number within the config, not
    // within the invoice.
    const last = await db.installment.aggregate({
      where: { customerConfigId: config.id },
      _max: { number: true },
    });

    const installment = await db.installment.create({
      data: {
        customerConfigId: config.id,
        invoiceId,
        number: (last._max.number ?? 0) + 1,
        dueDate: input.dueDate,
        amount,
        paidAmount: 0,
        status: 'PENDING',
        paymentMethod: this.paymentMethodFor(input.subtype),
      },
      select: { id: true, number: true, dueDate: true, amount: true, paidAmount: true, status: true },
    });

    this.logger.warn(
      `[TASK_MATCH] Extended quote ${input.quote.id} by ${this.brl(input.amount)} ` +
        `(task ${input.taskId}, operator ${input.userId}) — explicit opt-in.`,
    );

    return {
      installment: {
        id: installment.id,
        number: installment.number,
        dueDate: installment.dueDate,
        amount: Number(installment.amount),
        paidAmount: 0,
        remaining: Number(installment.amount),
        status: installment.status,
        hasBankSlip: false,
      },
      invoiceCreated,
    };
  }

  /**
   * Lift a quote into the range `cascadeFromQuote` acts on.
   *
   * Below BILLING_APPROVED the cascade returns early, so a quote conciliated
   * from PENDING/BUDGET_APPROVED would keep reading "Pendente" forever while
   * carrying paid parcelas. CANCELLED is left alone — reviving a cancelled
   * quote is a commercial decision, not a reconciliation side effect.
   */
  private async ensureCascadable(
    db: Prisma.TransactionClient,
    quoteId: string,
    status: string,
  ): Promise<void> {
    const lifecycle: string[] = [
      TASK_QUOTE_STATUS.BILLING_APPROVED,
      TASK_QUOTE_STATUS.UPCOMING,
      TASK_QUOTE_STATUS.DUE,
      TASK_QUOTE_STATUS.PARTIAL,
      TASK_QUOTE_STATUS.SETTLED,
    ];
    if (lifecycle.includes(status) || status === TASK_QUOTE_STATUS.CANCELLED) return;

    await db.taskQuote.update({
      where: { id: quoteId },
      data: {
        status: TASK_QUOTE_STATUS.BILLING_APPROVED as any,
        statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.BILLING_APPROVED],
        billingApprovedAt: new Date(),
      },
    });
    this.logger.log(`[TASK_MATCH] Quote ${quoteId}: ${status} → BILLING_APPROVED (conciliação)`);
  }

  // ---------------------------------------------------------------------------
  // Allocation
  // ---------------------------------------------------------------------------

  /**
   * Write the match rows and accrue onto the parcelas.
   *
   * `upsert` on the composite unique, not `create`: a task can legitimately
   * receive a second slice of the SAME credit (two allocations landing on one
   * parcela after a capacity extension), and the unique index counts reversed
   * rows, so a blind create would 500.
   */
  private async allocateOnto(
    db: Prisma.TransactionClient,
    tx: { id: string; postedAt: Date },
    plan: { installmentId: string; amount: number }[],
    userId: string,
    notes?: string,
  ): Promise<string[]> {
    const ids: string[] = [];

    for (const p of plan) {
      const inst = await db.installment.findUniqueOrThrow({
        where: { id: p.installmentId },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          status: true,
          paidAt: true,
          dueDate: true,
        },
      });

      const newPaid = new Decimal(inst.paidAmount ?? 0).add(new Decimal(p.amount));
      const fullyPaid = newPaid.gte(
        new Decimal(inst.amount).sub(ALLOC_TOLERANCE),
      );

      await db.installment.update({
        where: { id: inst.id },
        data: {
          paidAmount: newPaid,
          // Calendar-day comparison in SP: a parcela due TODAY is not overdue.
          status: fullyPaid ? 'PAID' : isDueDateOverdue(inst.dueDate) ? 'OVERDUE' : inst.status,
          // Only stamp on full settlement, and never clear a date an earlier
          // credit already set — topping up a parcela must not un-pay it.
          paidAt: fullyPaid ? (inst.paidAt ?? tx.postedAt) : inst.paidAt,
        },
      });

      const existing = await db.reconciliationMatch.findFirst({
        where: { transactionId: tx.id, installmentId: inst.id },
        select: { id: true, allocatedAmount: true },
      });

      if (existing) {
        await db.reconciliationMatch.update({
          where: { id: existing.id },
          data: {
            allocatedAmount: new Decimal(existing.allocatedAmount).add(new Decimal(p.amount)),
            matchType: ReconciliationMatchType.MANUAL,
            confidenceScore: 100,
            matchedByUserId: userId,
            notes: notes ?? undefined,
            // Re-matching after a reversal revives the row.
            reversedAt: null,
            reversedById: null,
          },
        });
      } else {
        await db.reconciliationMatch.create({
          data: {
            transactionId: tx.id,
            installmentId: inst.id,
            allocatedAmount: new Decimal(p.amount),
            matchType: ReconciliationMatchType.MANUAL,
            confidenceScore: 100,
            matchedByUserId: userId,
            notes: notes ?? null,
          },
        });
      }

      ids.push(inst.id);
    }

    return ids;
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  private openFromTask(task: {
    quote: QuoteWithConfigs | null;
    invoiceEntities: { installments: RawLiteInstallment[] }[];
  }): CollectedInstallment[] {
    const byId = new Map<string, CollectedInstallment>();
    const push = (i: RawLiteInstallment) => {
      if (byId.has(i.id)) return;
      if (!(OPEN_INSTALLMENT_STATUSES as readonly string[]).includes(i.status)) {
        return;
      }
      const amount = Number(i.amount);
      const paidAmount = Number(i.paidAmount ?? 0);
      const remaining = Math.max(0, amount - paidAmount);
      if (remaining <= ALLOC_TOLERANCE) return;
      byId.set(i.id, {
        id: i.id,
        number: i.number,
        dueDate: i.dueDate,
        amount,
        paidAmount,
        remaining,
        status: i.status,
        hasBankSlip: false,
      });
    };
    for (const config of task.quote?.customerConfigs ?? []) config.installments.forEach(push);
    for (const invoice of task.invoiceEntities ?? []) invoice.installments.forEach(push);
    return [...byId.values()];
  }

  private async reloadOpen(
    db: Prisma.TransactionClient,
    taskId: string,
    quoteId: string,
  ): Promise<CollectedInstallment[]> {
    const rows = await db.installment.findMany({
      where: {
        status: { in: OPEN_INSTALLMENT_STATUSES as unknown as any },
        OR: [{ customerConfig: { quoteId } }, { invoice: { taskId } }],
      },
      select: { id: true, number: true, dueDate: true, amount: true, paidAmount: true, status: true },
      orderBy: { dueDate: 'asc' },
    });
    return rows
      .map(i => {
        const amount = Number(i.amount);
        const paidAmount = Number(i.paidAmount ?? 0);
        return {
          id: i.id,
          number: i.number,
          dueDate: i.dueDate,
          amount,
          paidAmount,
          remaining: Math.max(0, amount - paidAmount),
          status: i.status,
          hasBankSlip: false,
        };
      })
      .filter(i => i.remaining > ALLOC_TOLERANCE);
  }

  private hasBillableConfigs(quote: QuoteWithConfigs): boolean {
    return quote.customerConfigs.some(c => Number(c.total) > 0);
  }

  /** Map the OFX subtype onto the installment's payment method. */
  private paymentMethodFor(subtype: string | null): 'PIX' | 'TRANSFER' | 'BANK_SLIP' | 'OTHER' {
    switch (subtype) {
      case 'PIX':
        return 'PIX';
      case 'TED':
      case 'DOC':
      case 'TRANSFERENCIA':
        return 'TRANSFER';
      case 'BOLETO':
        return 'BANK_SLIP';
      default:
        return 'OTHER';
    }
  }

  private taskLabel(task: { name: string | null; serialNumber: string | null; id: string }): string {
    return task.serialNumber
      ? `#${task.serialNumber}`
      : (task.name ?? task.id.slice(-8).toUpperCase());
  }

  private brl(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Copy of ReceivableMatchService.recalcInvoice — one behavior, two callers. */
  private async recalcInvoice(db: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.status === 'CANCELLED') return;
    const installments = await db.installment.findMany({ where: { invoiceId } });
    const totalPaid = installments.reduce(
      (sum, inst) => sum.add(inst.paidAmount ?? new Decimal(0)),
      new Decimal(0),
    );
    const status = totalPaid.gte(invoice.totalAmount)
      ? 'PAID'
      : totalPaid.gt(0)
        ? 'PARTIALLY_PAID'
        : 'ACTIVE';
    await db.invoice.update({ where: { id: invoiceId }, data: { paidAmount: totalPaid, status } });
  }

  /**
   * Tag the credit with service revenue, mirroring ReceivableMatchService so a
   * task-anchored receipt carries the same accounting classification as an
   * installment-anchored one. AUTO on purpose — it is derived from the match,
   * so every unmatch path that drops AUTO tags cleans it up.
   */
  private async tagServiceRevenue(
    db: Prisma.TransactionClient,
    transactionId: string,
    allocatedAmount: Decimal,
  ): Promise<void> {
    const category = await db.transactionCategory.findFirst({
      where: { slug: 'receita-servicos' },
      select: { id: true },
    });
    if (!category) return;
    await db.bankTransactionCategory.upsert({
      where: { transactionId_categoryId: { transactionId, categoryId: category.id } },
      create: {
        transactionId,
        categoryId: category.id,
        source: ReconciliationSource.AUTO,
        allocatedAmount,
      },
      update: { allocatedAmount, source: ReconciliationSource.AUTO },
    });
  }
}

// ---------------------------------------------------------------------------
// Local shapes
// ---------------------------------------------------------------------------

type RawInstallment = {
  id: string;
  number: number;
  dueDate: Date;
  amount: Prisma.Decimal | number;
  paidAmount: Prisma.Decimal | number | null;
  status: string;
  bankSlip: { id: string } | null;
};

type RawLiteInstallment = {
  id: string;
  number: number;
  dueDate: Date;
  amount: Prisma.Decimal | number;
  paidAmount: Prisma.Decimal | number | null;
  status: string;
};

type CollectedInstallment = {
  id: string;
  number: number;
  dueDate: Date;
  amount: number;
  paidAmount: number;
  remaining: number;
  status: string;
  hasBankSlip: boolean;
};

type QuoteWithConfigs = {
  id: string;
  budgetNumber: number;
  status: string;
  subtotal: Prisma.Decimal | number;
  total: Prisma.Decimal | number;
  services: { id: string; position: number; amount: Prisma.Decimal | number }[];
  customerConfigs: {
    id: string;
    customerId: string;
    /** A tarefa da fatia — nula em `JOINT`, o veículo em `PER_TASK`. */
    taskId: string | null;
    subtotal: Prisma.Decimal | number;
    total: Prisma.Decimal | number;
    paymentCondition: string | null;
    generateInvoice: boolean;
    generateBankSlip: boolean;
    invoice: { id: string; status: string; totalAmount: Prisma.Decimal | number } | null;
    installments: RawLiteInstallment[];
  }[];
};
