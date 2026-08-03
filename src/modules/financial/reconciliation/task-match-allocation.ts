/**
 * Pure decision logic for the task-anchored conciliation.
 *
 * Split out of `ReceivableTaskMatchService` on purpose: everything here is a
 * decision about money — how much a task can absorb, how a credit spreads over
 * its parcelas, whether an operator opt-in is required — and none of it needs a
 * database. Keeping it separate is what makes those decisions testable without
 * standing up Prisma, and it is where the invariants that matter are enforced.
 */

/** Centavo drift absorbed everywhere a sum is compared to a credit. */
export const ALLOC_TOLERANCE = 0.05;

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Installment statuses that still hold allocatable balance. */
export const OPEN_INSTALLMENT_STATUSES = ['PENDING', 'PROCESSING', 'OVERDUE'] as const;

/** Billing shape of a task, from the point of view of an incoming credit. */
export type TaskBillingStateValue =
  | 'NO_QUOTE'
  | 'QUOTE_UNBILLED'
  | 'QUOTE_OPEN'
  | 'QUOTE_SETTLED';

export interface AllocatableInstallment {
  id: string;
  dueDate: Date;
  /** Outstanding balance: amount − paidAmount, never negative. */
  remaining: number;
}

/**
 * Derive what a task looks like to a credit.
 *
 * The distinction that matters is `NO_QUOTE` vs everything else: with no quote
 * there is no fatura and no parcela, so the ordinary candidate list cannot see
 * the task at all. That is the case this whole feature exists to serve.
 */
export function deriveBillingState(input: {
  hasQuote: boolean;
  installmentCount: number;
  openCapacity: number;
}): TaskBillingStateValue {
  if (!input.hasQuote) return 'NO_QUOTE';
  if (input.installmentCount === 0) return 'QUOTE_UNBILLED';
  return input.openCapacity > ALLOC_TOLERANCE ? 'QUOTE_OPEN' : 'QUOTE_SETTLED';
}

/** Total a task can absorb without creating new billing capacity. */
export function openCapacityOf(open: AllocatableInstallment[]): number {
  return round2(open.reduce((sum, i) => sum + Math.max(0, i.remaining), 0));
}

/**
 * Spread an amount across open parcelas, oldest due date first.
 *
 * FIFO rather than best-fit: a customer paying down a job settles its oldest
 * outstanding parcela, and any other order would leave an older parcela open
 * behind a newer paid one — which then reads as overdue in every list.
 *
 * Returns `null` when the parcelas cannot absorb the whole amount, so the
 * caller can create capacity (or refuse) rather than silently under-allocating.
 */
export function planFifo(
  open: AllocatableInstallment[],
  amount: number,
): { installmentId: string; amount: number }[] | null {
  const plan: { installmentId: string; amount: number }[] = [];
  let left = round2(amount);

  const ordered = [...open].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  for (const inst of ordered) {
    if (left <= ALLOC_TOLERANCE) break;
    const take = round2(Math.min(inst.remaining, left));
    if (take <= 0) continue;
    plan.push({ installmentId: inst.id, amount: take });
    left = round2(left - take);
  }

  if (left > ALLOC_TOLERANCE) return null;
  return plan;
}

/**
 * Score a task against a credit, 0-100.
 *
 *   identity 40 · value 30 · date 20 · billing-state 10
 *
 * Identity outweighs value here, unlike the installment scorer, and
 * deliberately: these are tasks whose paperwork was lost, so there is no
 * parcela face value to corroborate an amount. A value coincidence is much
 * weaker evidence than knowing who paid, and weighting it the other way would
 * float a stranger's task to the top of the list purely because the number
 * happened to line up.
 */
export function scoreTaskCandidate(input: {
  /** Credit amount still unallocated. */
  unallocated: number;
  postedAt: Date;
  txCnpj: string;
  txName: string | null;
  customerCnpjCpf: string | null;
  customerName: string | null;
  referenceDate: Date | null;
  quoteTotal: number | null;
  openCapacity: number;
  billingState: TaskBillingStateValue;
  fromSearch: boolean;
  /** Injected so this module stays free of the text-normalization dependency. */
  nameSimilarity: (a: string, b: string) => number;
}): { confidence: number; reason: string } {
  const parts: string[] = [];

  // --- identity, max 40
  let identity = 0;
  if (input.txCnpj && input.customerCnpjCpf) {
    if (input.txCnpj === input.customerCnpjCpf) {
      identity = 40;
      parts.push('CNPJ/CPF exato');
    } else if (
      input.txCnpj.length === 14 &&
      input.customerCnpjCpf.length === 14 &&
      input.txCnpj.slice(0, 8) === input.customerCnpjCpf.slice(0, 8)
    ) {
      identity = 32;
      parts.push('mesma raiz de CNPJ');
    }
  }
  if (identity === 0 && input.txName && input.customerName) {
    const sim = input.nameSimilarity(input.txName, input.customerName);
    if (sim >= 0.8) {
      identity = 28;
      parts.push('nome da contraparte confere');
    } else if (sim >= 0.6) {
      identity = 18;
      parts.push('nome da contraparte semelhante');
    } else if (sim >= 0.45) {
      identity = 10;
      parts.push('nome da contraparte parecido');
    }
  }

  // --- value, max 30. Compared against what the task can actually absorb —
  // its open balance, or its quote total when it was never billed.
  const reference =
    input.openCapacity > ALLOC_TOLERANCE ? input.openCapacity : (input.quoteTotal ?? 0);
  let value = 0;
  if (reference > 0) {
    const diff = Math.abs(reference - input.unallocated);
    const ratio = diff / Math.max(reference, input.unallocated);
    if (diff <= ALLOC_TOLERANCE) {
      value = 30;
      parts.push('valor exato');
    } else if (ratio <= 0.01) {
      value = 24;
      parts.push('valor ~1%');
    } else if (ratio <= 0.05) {
      value = 16;
      parts.push('valor ~5%');
    } else if (ratio <= 0.15) {
      value = 8;
    } else if (input.unallocated < reference) {
      // A credit smaller than the balance is a normal partial payment, not a
      // mismatch — it just carries no positive evidence either way.
      value = 4;
    }
  }

  // --- date, max 20
  let date = 0;
  if (input.referenceDate) {
    const days = Math.abs(input.postedAt.getTime() - input.referenceDate.getTime()) / 86_400_000;
    if (days <= 7) {
      date = 20;
      parts.push('mesma semana');
    } else if (days <= 30) date = 16;
    else if (days <= 90) date = 10;
    else if (days <= 180) date = 5;
    else date = 1;
  }

  // --- billing state, max 10
  let state = 0;
  if (input.billingState === 'QUOTE_OPEN') {
    state = 10;
    parts.push('parcela em aberto');
  } else if (input.billingState === 'NO_QUOTE') {
    state = 6;
    parts.push('sem orçamento');
  } else if (input.billingState === 'QUOTE_UNBILLED') {
    state = 4;
    parts.push('orçamento não faturado');
  }

  const confidence = Math.max(0, Math.min(100, identity + value + date + state));
  if (parts.length === 0) parts.push(input.fromSearch ? 'resultado da busca' : 'cliente relacionado');
  return { confidence, reason: parts.join(' • ') };
}
