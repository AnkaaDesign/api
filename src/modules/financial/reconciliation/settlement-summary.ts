import { Prisma } from '@prisma/client';

/**
 * What actually backs a bank transaction, and whether anything is still owed to
 * close it — derived once here so the Extrato list, the transaction detail page
 * and any export all say the SAME thing about the same row.
 *
 * The problem this solves: `BankTransaction.reconciliationStatus = RECONCILED`
 * is reached seven different ways (an NF match, a boleto, a receivable parcela,
 * an order parcela, a recurrent occurrence, an aerografia, a folha) plus an
 * eighth non-match path (a resolving category self-justifies the line). The
 * status column cannot tell them apart, and the UI only ever knew how to render
 * three of them — so a supplier PIX cleared against a purchase order rendered as
 * a bare green "Resolvido"/"Liquidado" chip with an EMPTY "Vínculo" cell and
 * nothing at all on the detail page. Correct data, unreadable screen.
 *
 * The second thing it fixes is the colour contract. Green/yellow has to answer
 * one question — "do I still have to touch this row?" — so:
 *
 *   SETTLED      verde     nothing left to do
 *   AWAITING_NF  amarelo   money provably left the bank, the nota is missing
 *   UNBACKED     amarelo   flagged resolved with nothing behind it at all
 *   OPEN         amarelo   still to conciliate (PENDING/PARTIAL)
 *   DISPUTED     vermelho  matched, but the figures disagree
 *   IGNORED      cinza     deliberately out of scope
 *
 * Nothing is stored: every field below is derived from the live match graph, so
 * there is no new column to migrate and no state that can drift out of sync.
 */

/** Minimal NF projection used both for the linked note and the suggested one. */
export const SETTLEMENT_FD_SELECT = {
  id: true,
  nfNumber: true,
  accessKey: true,
  issueDate: true,
  totalValue: true,
  emitName: true,
  emitCnpj: true,
  status: true,
} satisfies Prisma.FiscalDocumentSelect;

/**
 * Anchor relations every transaction list/detail query must load. Without these
 * the four "settlement" anchors are invisible to the client — which is exactly
 * how 42 reconciled rows ended up with a green chip and a blank Vínculo.
 */
export const SETTLEMENT_ANCHOR_INCLUDE = {
  orderInstallment: {
    select: {
      id: true,
      number: true,
      amount: true,
      dueDate: true,
      status: true,
      order: {
        select: {
          id: true,
          description: true,
          supplier: { select: { id: true, fantasyName: true, cnpj: true } },
          installments: { select: { id: true, amount: true } },
          // Both NF↔order paths: the direct M2M and the resolved "#Ped:" code
          // parsed off the XML. Either one makes the note reachable from the
          // payment, which is what turns a 2-way clearance into a 3-way one.
          fiscalDocuments: {
            select: {
              ...SETTLEMENT_FD_SELECT,
              matches: { where: { reversedAt: null }, select: { id: true, transactionId: true } },
            },
          },
          fiscalDocumentOrderCodes: {
            select: {
              code: true,
              fiscalDocument: {
                select: {
                  ...SETTLEMENT_FD_SELECT,
                  matches: { where: { reversedAt: null }, select: { id: true, transactionId: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  recurrentOccurrence: {
    select: {
      id: true,
      competence: true,
      dueDate: true,
      expectsNf: true,
      fiscalDocumentId: true,
      recurrentPayable: {
        select: { id: true, name: true, payeeName: true, expectsNf: true },
      },
    },
  },
  airbrushing: {
    select: {
      id: true,
      price: true,
      task: { select: { id: true, name: true, serialNumber: true } },
    },
  },
  payrollMonthSettlement: { select: { id: true, year: true, month: true, amount: true } },
} satisfies Prisma.ReconciliationMatchInclude;

export type SettlementState =
  | 'SETTLED'
  | 'AWAITING_NF'
  | 'UNBACKED'
  | 'OPEN'
  | 'IGNORED'
  | 'DISPUTED';

export type SettlementAnchorKind =
  | 'FISCAL_DOCUMENT'
  | 'BANK_SLIP'
  | 'RECEIVABLE_INSTALLMENT'
  | 'ORDER_INSTALLMENT'
  | 'RECURRENT_OCCURRENCE'
  | 'AIRBRUSHING'
  | 'PAYROLL'
  | 'CATEGORY'
  | 'NONE';

/** Where the "Vínculo" cell should navigate to. */
export interface SettlementLink {
  kind: 'fiscalDocument' | 'order' | 'task' | 'receivable' | 'recurrent' | 'payroll';
  id: string | null;
}

export interface SettlementNf {
  id: string;
  nfNumber: string | null;
  accessKey: string | null;
  issueDate: Date | null;
  totalValue: number | null;
  emitName: string | null;
  emitCnpj: string | null;
  status: string | null;
  /** True when this note already carries a live bank match (anywhere). */
  bankMatched: boolean;
  /** Purchase-order code that ties the note to the payment ("C51510"). */
  viaOrderCode: string | null;
}

/** tx ≟ obrigação ≟ nota, in the three amounts a human would check by hand. */
export interface ThreeWayView {
  bank: number;
  anchor: number | null;
  nf: number | null;
  flag: 'OK' | 'MISMATCH' | null;
}

export interface TransactionSettlement {
  state: SettlementState;
  anchor: SettlementAnchorKind;
  /** Short human label — "Pedido C51510 · parcela 1/1", "Aluguel · 07/2026". */
  label: string | null;
  link: SettlementLink | null;
  /** Whether a fiscal document is still owed for this line. */
  expectsNf: boolean;
  /** Note already linked to THIS transaction, if any. */
  nf: SettlementNf | null;
  /** Note reachable through the matched order but NOT yet linked to this
   *  transaction — the "Vincular nota" suggestion. */
  suggestedNf: SettlementNf | null;
  threeWay: ThreeWayView | null;
  /** Name of the resolving category holding an NF-less line up. */
  resolvedByCategory: string | null;
}

/** Tolerance for "these two amounts are the same money" (mirrors order-clearance). */
const TOLERANCE_ABS = 2;
const TOLERANCE_PCT = 0.005;

const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

const agrees = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(TOLERANCE_ABS, Math.abs(b) * TOLERANCE_PCT);

const monthLabel = (competence: string): string => {
  const [y, m] = competence.split('-');
  return m && y ? `${m}/${y}` : competence;
};

/**
 * Shape this accepts — deliberately structural rather than a Prisma payload
 * type, so callers can pass rows selected with slightly different projections
 * (the list query loads less NF detail than the detail query) without fighting
 * the type checker.
 */
interface MatchLike {
  fiscalDocumentId?: string | null;
  bankSlipId?: string | null;
  installmentId?: string | null;
  allocatedAmount?: Prisma.Decimal | number | null;
  fiscalDocument?: Record<string, unknown> | null;
  bankSlip?: { nossoNumero?: string | null; installment?: unknown } | null;
  installment?: Record<string, unknown> | null;
  orderInstallment?: {
    id: string;
    number: number;
    amount: number;
    order?: {
      id: string;
      description?: string | null;
      supplier?: { fantasyName?: string | null } | null;
      installments?: { id: string; amount: number }[];
      fiscalDocuments?: Record<string, unknown>[];
      fiscalDocumentOrderCodes?: { code: string; fiscalDocument?: Record<string, unknown> | null }[];
    } | null;
  } | null;
  recurrentOccurrence?: {
    id: string;
    competence: string;
    expectsNf?: boolean | null;
    fiscalDocumentId?: string | null;
    recurrentPayable?: { id: string; name: string; payeeName?: string | null } | null;
  } | null;
  airbrushing?: {
    id: string;
    price?: number | null;
    task?: { id: string; name?: string | null; serialNumber?: string | null } | null;
  } | null;
  payrollMonthSettlement?: { id: string; year: number; month: number; amount?: Prisma.Decimal | number | null } | null;
}

interface TransactionLike {
  id: string;
  amount: Prisma.Decimal | number;
  reconciliationStatus: string;
  matches?: MatchLike[] | null;
  categories?: { category?: { name: string; isResolving: boolean } | null }[] | null;
}

const toNf = (
  raw: Record<string, unknown> | null | undefined,
  transactionId: string,
  viaOrderCode: string | null,
): SettlementNf | null => {
  if (!raw || typeof raw.id !== 'string') return null;
  const matches = (raw.matches as { transactionId: string }[] | undefined) ?? [];
  return {
    id: raw.id,
    nfNumber: (raw.nfNumber as string | null) ?? null,
    accessKey: (raw.accessKey as string | null) ?? null,
    issueDate: (raw.issueDate as Date | null) ?? null,
    totalValue: raw.totalValue == null ? null : Number(raw.totalValue),
    emitName: (raw.emitName as string | null) ?? null,
    emitCnpj: (raw.emitCnpj as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    // Whether the note is already accounted for on the bank side by ANY
    // transaction. A note matched to THIS one is the stronger case and never
    // reaches here — it lands in `nf`, not `suggestedNf`.
    bankMatched: matches.length > 0,
    viaOrderCode,
  };
};

/**
 * Derive the settlement view for one transaction. Pure — no I/O — so it can run
 * over a whole list page for free.
 */
export function deriveSettlement(tx: TransactionLike): TransactionSettlement {
  const bank = Math.abs(num(tx.amount));
  const matches = tx.matches ?? [];
  const resolvedByCategory =
    tx.categories?.find(c => c.category?.isResolving)?.category?.name ?? null;

  const empty: TransactionSettlement = {
    state: 'OPEN',
    anchor: 'NONE',
    label: null,
    link: null,
    expectsNf: false,
    nf: null,
    suggestedNf: null,
    threeWay: null,
    resolvedByCategory,
  };

  if (tx.reconciliationStatus === 'IGNORED') return { ...empty, state: 'IGNORED' };
  if (tx.reconciliationStatus === 'DISPUTED') return { ...empty, state: 'DISPUTED' };

  const open = tx.reconciliationStatus === 'PENDING' || tx.reconciliationStatus === 'PARTIAL';

  // --- 1. Linked fiscal document — the strongest close. ------------------------
  const docMatch = matches.find(m => m.fiscalDocument || m.fiscalDocumentId);
  if (docMatch) {
    const nf = toNf(docMatch.fiscalDocument, tx.id, null);
    const nfTotal = nf?.totalValue ?? null;
    return {
      ...empty,
      state: open ? 'OPEN' : 'SETTLED',
      anchor: 'FISCAL_DOCUMENT',
      label: nf?.emitName ? `NF ${nf.nfNumber ?? ''} · ${nf.emitName}`.trim() : 'Nota fiscal',
      link: { kind: 'fiscalDocument', id: nf?.id ?? docMatch.fiscalDocumentId ?? null },
      expectsNf: false,
      nf,
      threeWay:
        nfTotal == null
          ? null
          : { bank, anchor: null, nf: nfTotal, flag: agrees(bank, nfTotal) ? 'OK' : 'MISMATCH' },
    };
  }

  // --- 2. Purchase-order parcela (saída sem NF vinculada). ---------------------
  const orderMatch = matches.find(m => m.orderInstallment);
  if (orderMatch?.orderInstallment) {
    const oi = orderMatch.orderInstallment;
    const order = oi.order ?? null;
    // Every note reachable from the order, by either path, tagged with the
    // "#Ped:" code when that is how it was reached.
    const reachable: SettlementNf[] = [];
    for (const fd of order?.fiscalDocuments ?? []) {
      const n = toNf(fd, tx.id, null);
      if (n) reachable.push(n);
    }
    for (const oc of order?.fiscalDocumentOrderCodes ?? []) {
      const n = toNf(oc.fiscalDocument, tx.id, oc.code ?? null);
      if (n && !reachable.some(r => r.id === n.id)) reachable.push(n);
    }
    // Prefer a note whose total matches the payment — with several notes on one
    // order that is the one this specific debit paid.
    const suggested =
      reachable.find(n => n.totalValue != null && agrees(bank, n.totalValue)) ?? reachable[0] ?? null;

    const orderCode = order?.fiscalDocumentOrderCodes?.[0]?.code ?? null;
    const parcelCount = order?.installments?.length ?? 0;
    const installmentTotal = (order?.installments ?? []).reduce((s, i) => s + num(i.amount), 0);
    const label = [
      orderCode ? `Pedido ${orderCode}` : order?.description || 'Pedido',
      parcelCount > 1 || oi.number > 1 ? `parcela ${oi.number}/${parcelCount || oi.number}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const nfTotal = suggested?.totalValue ?? null;
    const anchorTotal = installmentTotal || num(oi.amount);
    // The note is only "already accounted for" when it carries a live bank match
    // of its own; otherwise the money is proven but the fiscal leg is open.
    const nfSettledElsewhere = suggested?.bankMatched === true;

    return {
      ...empty,
      state: open ? 'OPEN' : nfSettledElsewhere ? 'SETTLED' : 'AWAITING_NF',
      anchor: 'ORDER_INSTALLMENT',
      label,
      link: { kind: 'order', id: order?.id ?? null },
      expectsNf: !nfSettledElsewhere,
      suggestedNf: nfSettledElsewhere ? null : suggested,
      threeWay: {
        bank,
        anchor: anchorTotal || null,
        nf: nfTotal,
        // Compare against whichever legs actually exist — an order with no
        // installment total recorded must not read as a mismatch just because
        // one of the three figures is missing.
        flag:
          (anchorTotal ? agrees(bank, anchorTotal) : true) &&
          (nfTotal == null ? true : agrees(nfTotal, anchorTotal || bank))
            ? 'OK'
            : 'MISMATCH',
      },
    };
  }

  // --- 3. Boleto / receivable parcela (entrada) — closed by the billing flow. --
  const slipMatch = matches.find(m => m.bankSlip || m.bankSlipId);
  const instMatch = matches.find(m => m.installment || m.installmentId);
  if (slipMatch || instMatch) {
    const slip = slipMatch?.bankSlip;
    return {
      ...empty,
      state: open ? 'OPEN' : 'SETTLED',
      anchor: slip ? 'BANK_SLIP' : 'RECEIVABLE_INSTALLMENT',
      label: slip?.nossoNumero ? `Boleto ${slip.nossoNumero}` : 'Parcela a receber',
      link: { kind: 'receivable', id: null },
      expectsNf: false,
    };
  }

  // --- 4. Recurrent bill (aluguel, energia, internet…). ------------------------
  const recMatch = matches.find(m => m.recurrentOccurrence);
  if (recMatch?.recurrentOccurrence) {
    const occ = recMatch.recurrentOccurrence;
    const payable = occ.recurrentPayable;
    // `expectsNf` is per-occurrence (copied from the payable at generation), so
    // a landlord's rent never nags for a note while COPEL's energia does.
    const wantsNf = occ.expectsNf === true && !occ.fiscalDocumentId;
    return {
      ...empty,
      state: open ? 'OPEN' : wantsNf ? 'AWAITING_NF' : 'SETTLED',
      anchor: 'RECURRENT_OCCURRENCE',
      label: [payable?.name ?? 'Conta recorrente', monthLabel(occ.competence)]
        .filter(Boolean)
        .join(' · '),
      link: { kind: 'recurrent', id: payable?.id ?? null },
      expectsNf: wantsNf,
    };
  }

  // --- 5. Aerografia / folha — internal, never carry an inbound note. ----------
  const airMatch = matches.find(m => m.airbrushing);
  if (airMatch?.airbrushing) {
    const task = airMatch.airbrushing.task;
    return {
      ...empty,
      state: open ? 'OPEN' : 'SETTLED',
      anchor: 'AIRBRUSHING',
      label: [task?.serialNumber, task?.name].filter(Boolean).join(' · ') || 'Aerografia',
      link: { kind: 'task', id: task?.id ?? null },
      expectsNf: false,
    };
  }

  const payMatch = matches.find(m => m.payrollMonthSettlement);
  if (payMatch?.payrollMonthSettlement) {
    const p = payMatch.payrollMonthSettlement;
    return {
      ...empty,
      state: open ? 'OPEN' : 'SETTLED',
      anchor: 'PAYROLL',
      label: `Folha ${String(p.month).padStart(2, '0')}/${p.year}`,
      link: { kind: 'payroll', id: p.id },
      expectsNf: false,
    };
  }

  // --- 6. No anchor at all. ----------------------------------------------------
  if (open) return { ...empty, state: 'OPEN' };
  // RECONCILED with nothing attached: a resolving category (Tarifa Bancária,
  // Folha, Tributo) is a legitimate, self-justifying close and must read GREEN —
  // it was rendering grey, which looks like unfinished work. Anything else is a
  // genuine orphan and needs a human.
  return resolvedByCategory
    ? {
        ...empty,
        state: 'SETTLED',
        anchor: 'CATEGORY',
        label: resolvedByCategory,
        expectsNf: false,
      }
    : { ...empty, state: 'UNBACKED' };
}

// -----------------------------------------------------------------------------
// Query-side mirror of the derivation above
// -----------------------------------------------------------------------------

/** A live (non-reversed) match linked to an NF. */
const LIVE_NF_MATCH: Prisma.ReconciliationMatchWhereInput = {
  reversedAt: null,
  fiscalDocumentId: { not: null },
};

/**
 * A live match on an anchor that still owes a nota: a purchase-order parcela
 * whose order has NO bank-matched NF by either link path, or a recurrent
 * occurrence flagged `expectsNf` with no note attached yet.
 *
 * Kept adjacent to `deriveSettlement` on purpose — this is the SQL-expressible
 * form of the same rule, and the two must be edited together.
 */
const AWAITING_NF_ANCHOR_MATCH: Prisma.ReconciliationMatchWhereInput = {
  reversedAt: null,
  OR: [
    {
      orderInstallmentId: { not: null },
      orderInstallment: {
        order: {
          AND: [
            { fiscalDocuments: { none: { matches: { some: { reversedAt: null } } } } },
            {
              fiscalDocumentOrderCodes: {
                none: { fiscalDocument: { matches: { some: { reversedAt: null } } } },
              },
            },
          ],
        },
      },
    },
    {
      recurrentOccurrenceId: { not: null },
      recurrentOccurrence: { expectsNf: true, fiscalDocumentId: null },
    },
  ],
};

export type SettlementStateFilter =
  | 'SETTLED'
  | 'AWAITING_NF'
  | 'UNBACKED'
  | 'OPEN'
  | 'NEEDS_ACTION';

/**
 * Translate a settlement state into a `BankTransaction` predicate, so the
 * Extrato can be filtered down to exactly the rows that still need a human —
 * the whole point of the green/yellow split.
 */
export function settlementStateWhere(
  state: SettlementStateFilter,
): Prisma.BankTransactionWhereInput {
  const awaitingNf: Prisma.BankTransactionWhereInput = {
    reconciliationStatus: 'RECONCILED',
    matches: { none: LIVE_NF_MATCH },
    AND: [{ matches: { some: AWAITING_NF_ANCHOR_MATCH } }],
  };
  const unbacked: Prisma.BankTransactionWhereInput = {
    reconciliationStatus: 'RECONCILED',
    matches: { none: { reversedAt: null } },
    categories: { none: { category: { isResolving: true } } },
  };
  const open: Prisma.BankTransactionWhereInput = {
    reconciliationStatus: { in: ['PENDING', 'PARTIAL'] },
  };

  switch (state) {
    case 'AWAITING_NF':
      return awaitingNf;
    case 'UNBACKED':
      return unbacked;
    case 'OPEN':
      return open;
    case 'NEEDS_ACTION':
      return { OR: [open, awaitingNf, unbacked] };
    case 'SETTLED':
      // Everything terminal that is NOT one of the yellow buckets.
      return {
        reconciliationStatus: 'RECONCILED',
        NOT: { OR: [awaitingNf, unbacked] },
      };
  }
}
