import { Prisma } from '@prisma/client';

/**
 * Shared order↔bank clearance derivation — the single source of truth both
 * `PayablesService.annotateClearance` (Contas a Pagar, Axis B) and
 * `OutflowForecastService` (Previsão de Saídas) read, so the SAME cash is never
 * counted as both an open/paid-on-paper obligation AND a reconciled bank debit.
 *
 * An order is "bank-backed" (its cash provably left the account) when either:
 *   - one of its OrderInstallments carries a non-reversed ReconciliationMatch on
 *     the `orderInstallmentId` anchor (written by the C1 tie-back and the C2
 *     direct confirmation), OR
 *   - a FiscalDocument linked to the order (M2M `orders` or a resolved
 *     `FiscalDocumentOrderCode.orderId`) carries a non-reversed bank match.
 *
 * The two paths can share a row (the C1 tie-back sets BOTH `fiscalDocumentId`
 * and `orderInstallmentId` on the one NF-match row), so amounts are summed over
 * DISTINCT match ids to avoid double counting a single tie-back row.
 */

/** Consistency tolerance for the 3-way (tx ≟ nf ≟ installment) signal. */
export const THREE_WAY_TOLERANCE_ABS = 2;
export const THREE_WAY_TOLERANCE_PCT = 0.005;

export type ThreeWayFlag = 'OK' | 'MISMATCH';

export interface OrderThreeWay {
  /** Σ allocatedAmount of DISTINCT non-reversed bank matches tied to the order
   *  (via the installment anchor OR the linked-NF path). */
  txAllocated: number;
  /** Σ totalValue of FiscalDocuments linked to the order. */
  nfLinkedTotal: number;
  /** Σ OrderInstallment.amount for the order. */
  installmentTotal: number;
  /** OK when the present bank/nf signals agree with the installment total within
   *  tolerance; MISMATCH otherwise. `null` when the order has NO bank backing at
   *  all (paid-on-paper / still open) — there is nothing to cross-validate yet. */
  flag: ThreeWayFlag | null;
}

/** Per-installment bank-backing detail (drives CLEARED vs DISPUTED). */
export interface InstallmentClearance {
  allocatedAmount: number;
  transactionId: string;
  matchedAt: Date;
}

export interface OrderClearance {
  /** installmentId → the (single, most-recent) anchor match that clears it. */
  byInstallment: Map<string, InstallmentClearance>;
  /** True when ANY installment anchor OR any linked-NF bank match exists. */
  hasBankBacking: boolean;
  /** Representative bank line + timestamp for order-level clearance (prefers an
   *  installment anchor, else the NF path). */
  transactionId: string | null;
  matchedAt: Date | null;
  /** 3-way consistency signal (C4). */
  threeWay: OrderThreeWay;
}

const num = (v: Prisma.Decimal | number | null | undefined): number =>
  v == null ? 0 : Number(v);

/**
 * Resolve the Order ids reachable from a set of FiscalDocuments — the M2M
 * `orders` link plus resolved `FiscalDocumentOrderCode.orderId` rows. Returns a
 * fiscalDocumentId → orderId[] map (an NF can back several orders; an order can
 * span several NFs).
 */
export async function resolveOrderIdsForFiscalDocs(
  db: Prisma.TransactionClient,
  fiscalDocumentIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (fiscalDocumentIds.length === 0) return out;

  const docs = await db.fiscalDocument.findMany({
    where: { id: { in: fiscalDocumentIds } },
    select: {
      id: true,
      orders: { select: { id: true } },
      orderCodes: { where: { orderId: { not: null } }, select: { orderId: true } },
    },
  });
  for (const d of docs) {
    const ids = new Set<string>();
    for (const o of d.orders) ids.add(o.id);
    for (const oc of d.orderCodes) if (oc.orderId) ids.add(oc.orderId);
    if (ids.size > 0) out.set(d.id, [...ids]);
  }
  return out;
}

/**
 * Derive bank clearance for a set of orders from the reconciliation match graph.
 * One batched pass (installments → anchor matches; linked NFs → NF matches),
 * usable inside or outside a transaction.
 */
export async function deriveOrderClearance(
  db: Prisma.TransactionClient,
  orderIds: string[],
): Promise<Map<string, OrderClearance>> {
  const result = new Map<string, OrderClearance>();
  if (orderIds.length === 0) return result;

  // Installments of every order (for anchors + Σ installment amounts).
  const installments = await db.orderInstallment.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true, orderId: true, amount: true },
  });
  const installmentsByOrder = new Map<string, { id: string; amount: number }[]>();
  const orderByInstallment = new Map<string, string>();
  for (const i of installments) {
    orderByInstallment.set(i.id, i.orderId);
    const arr = installmentsByOrder.get(i.orderId) ?? [];
    arr.push({ id: i.id, amount: num(i.amount) });
    installmentsByOrder.set(i.orderId, arr);
  }

  // Linked NFs of every order (M2M + resolved order codes).
  const orders = await db.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      fiscalDocuments: { select: { id: true, totalValue: true } },
      fiscalDocumentOrderCodes: {
        select: { fiscalDocument: { select: { id: true, totalValue: true } } },
      },
    },
  });
  const nfByOrder = new Map<string, Map<string, number>>(); // orderId → fdId → totalValue
  const fdToOrders = new Map<string, Set<string>>(); // fdId → orderIds
  for (const o of orders) {
    const nfMap = new Map<string, number>();
    for (const fd of o.fiscalDocuments) nfMap.set(fd.id, num(fd.totalValue));
    for (const oc of o.fiscalDocumentOrderCodes) {
      if (oc.fiscalDocument) nfMap.set(oc.fiscalDocument.id, num(oc.fiscalDocument.totalValue));
    }
    nfByOrder.set(o.id, nfMap);
    for (const fdId of nfMap.keys()) {
      const s = fdToOrders.get(fdId) ?? new Set<string>();
      s.add(o.id);
      fdToOrders.set(fdId, s);
    }
  }

  const allInstallmentIds = installments.map(i => i.id);
  const allFdIds = [...fdToOrders.keys()];

  // Non-reversed matches on either anchor path, in one query. A single row can
  // carry BOTH orderInstallmentId (anchor) and fiscalDocumentId (NF) — the C1
  // tie-back — so we dedupe by match id when summing txAllocated per order.
  const matches =
    allInstallmentIds.length || allFdIds.length
      ? await db.reconciliationMatch.findMany({
          where: {
            reversedAt: null,
            OR: [
              allInstallmentIds.length ? { orderInstallmentId: { in: allInstallmentIds } } : undefined,
              allFdIds.length ? { fiscalDocumentId: { in: allFdIds } } : undefined,
            ].filter(Boolean) as Prisma.ReconciliationMatchWhereInput[],
          },
          select: {
            id: true,
            transactionId: true,
            allocatedAmount: true,
            matchedAt: true,
            orderInstallmentId: true,
            fiscalDocumentId: true,
          },
        })
      : [];

  // Aggregate per order.
  const txAllocatedByOrder = new Map<string, number>();
  const nfAmountSeen = new Map<string, Set<string>>(); // orderId → match ids already counted
  const byInstallment = new Map<string, InstallmentClearance>();
  const orderRep = new Map<string, { transactionId: string; matchedAt: Date; anchor: boolean }>();

  const addTx = (orderId: string, matchId: string, amount: number, seen: Set<string>) => {
    if (seen.has(matchId)) return;
    seen.add(matchId);
    txAllocatedByOrder.set(orderId, (txAllocatedByOrder.get(orderId) ?? 0) + amount);
  };

  for (const orderId of orderIds) nfAmountSeen.set(orderId, new Set<string>());

  for (const m of matches) {
    const amount = num(m.allocatedAmount);
    // Anchor path
    if (m.orderInstallmentId) {
      const orderId = orderByInstallment.get(m.orderInstallmentId);
      if (orderId) {
        byInstallment.set(m.orderInstallmentId, {
          allocatedAmount: amount,
          transactionId: m.transactionId,
          matchedAt: m.matchedAt,
        });
        addTx(orderId, m.id, amount, nfAmountSeen.get(orderId)!);
        const rep = orderRep.get(orderId);
        if (!rep || !rep.anchor) {
          orderRep.set(orderId, { transactionId: m.transactionId, matchedAt: m.matchedAt, anchor: true });
        }
      }
    }
    // NF path (may be the same row as the anchor — addTx dedupes by match id).
    if (m.fiscalDocumentId) {
      const ordersForFd = fdToOrders.get(m.fiscalDocumentId);
      if (ordersForFd) {
        for (const orderId of ordersForFd) {
          addTx(orderId, m.id, amount, nfAmountSeen.get(orderId)!);
          if (!orderRep.has(orderId)) {
            orderRep.set(orderId, { transactionId: m.transactionId, matchedAt: m.matchedAt, anchor: false });
          }
        }
      }
    }
  }

  for (const orderId of orderIds) {
    const insts = installmentsByOrder.get(orderId) ?? [];
    const installmentTotal = insts.reduce((s, i) => s + i.amount, 0);
    const nfMap = nfByOrder.get(orderId) ?? new Map();
    const nfLinkedTotal = [...nfMap.values()].reduce((s, v) => s + v, 0);
    const txAllocated = txAllocatedByOrder.get(orderId) ?? 0;

    const orderByInst = new Map<string, InstallmentClearance>();
    for (const i of insts) {
      const c = byInstallment.get(i.id);
      if (c) orderByInst.set(i.id, c);
    }
    const hasBankBacking = txAllocated > 0 || orderByInst.size > 0;

    // 3-way consistency: only meaningful once bank-backed.
    let flag: ThreeWayFlag | null = null;
    if (hasBankBacking) {
      const tol = Math.max(THREE_WAY_TOLERANCE_ABS, installmentTotal * THREE_WAY_TOLERANCE_PCT);
      const txAgrees = Math.abs(txAllocated - installmentTotal) <= tol;
      const nfAgrees = nfLinkedTotal === 0 || Math.abs(nfLinkedTotal - installmentTotal) <= tol;
      flag = txAgrees && nfAgrees ? 'OK' : 'MISMATCH';
    }

    const rep = orderRep.get(orderId) ?? null;
    result.set(orderId, {
      byInstallment: orderByInst,
      hasBankBacking,
      transactionId: rep?.transactionId ?? null,
      matchedAt: rep?.matchedAt ?? null,
      threeWay: { txAllocated, nfLinkedTotal, installmentTotal, flag },
    });
  }

  return result;
}
