import {
  BankTransactionType,
  BankTransactionSubtype,
  ReconciliationMatchType,
  ReconciliationStatus,
} from '@prisma/client';

export interface CategoryDistributionEntry {
  categoryId: string;
  name: string;
  slug: string;
  kind: string;
  count: number;
  amount: number;
}

export interface ParsedOfxTransaction {
  fitId: string;
  postedAt: Date;
  amount: number; // signed: positive credit, negative debit
  type: BankTransactionType;
  subtype: BankTransactionSubtype;
  rawTrnType: string | null;
  memo: string | null;
  counterpartyCnpjCpf: string | null;
  counterpartyName: string | null;
  runningBalance: number | null;
}

export interface ParsedOfxStatement {
  bankCode: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  ownerCnpj: string | null;
  periodStart: Date;
  periodEnd: Date;
  transactions: ParsedOfxTransaction[];
}

export interface OfxImportFileResult {
  /** Original filename from multer (or zip entry path). */
  fileName: string;
  /** Per-statement breakdown (a single OFX may contain multiple statements). */
  statements: Array<{
    bankCode: string;
    bankName: string;
    agency: string;
    accountNumber: string;
    periodStart: Date;
    periodEnd: Date;
    parsed: number;
    inserted: number;
    duplicates: number;
  }>;
  error?: string;
}

/** A line of the candidate document, surfaced so the UI can show what the
 * invoice is for without a second round-trip. */
export interface MatchCandidateItem {
  id: string;
  code: string | null;
  description: string;
  totalValue: number;
  quantity: number | null;
  unit: string | null;
  unitValue: number | null;
  categoryId: string | null;
  category: { id: string; name: string; slug: string; color: string | null } | null;
}

export interface MatchCandidate {
  fiscalDocumentId: string;
  accessKey: string;
  docType: string;
  operationType: string;
  issueDate: Date;
  totalValue: number;
  emitCnpj: string;
  emitName: string | null;
  destCnpj: string | null;
  destCpf: string | null;
  destName: string | null;
  nfNumber: string | null;
  confidence: number;
  matchType: ReconciliationMatchType;
  rationale: string;
  /** Open balance of the NF: totalValue minus what OTHER transactions already
   *  allocated to it (non-reversed). Equals totalValue for a fully-open NF.
   *  A value below totalValue means the NF is being paid in installments and
   *  this is one of the remaining parcelas. */
  remainingValue?: number;
  /** How much of the NF was already settled by other transactions
   *  (totalValue − remainingValue). Present only for partially-paid NFs. */
  allocatedValue?: number;
  /** Absolute R$ difference between the NF total and |transaction amount|. */
  amountDelta: number;
  /** Whole-day difference between issue date and posting date. */
  daysDelta: number;
  /** True when a learned memo→CNPJ alias contributed to the CNPJ score. */
  aliasAssisted: boolean;
  /** First few line items / services (descriptions) of the candidate doc. */
  items: MatchCandidateItem[];
  // --- Order-group candidates (several NFs of one purchase order summed) ---
  /** True when this candidate is a synthetic group of NFs sharing one order
   *  code (`#Ped:` in infCpl), summed into a single matchable unit. */
  isOrderGroup?: boolean;
  /** The shared purchase-order code, when isOrderGroup. */
  orderCode?: string;
  /** The fiscal-document ids of every NF in the group (for allocation on accept). */
  memberFiscalDocumentIds?: string[];
  /** Per-member NF id + value, so the UI can send accurate per-NF allocations. */
  members?: { fiscalDocumentId: string; nfNumber: string | null; totalValue: number }[];
  /** Number of NFs in the group. */
  memberCount?: number;
  /** True when no member NF belongs to more than one order — only clean groups
   *  may be auto-confirmed; unclean groups are surfaced for manual review only
   *  (summing them would double-count a consolidated NF across orders). */
  cleanGroup?: boolean;
}

export interface ImportSummary {
  /** Total .ofx/.qfx files processed (zip entries counted individually). */
  filesProcessed: number;
  /** Transactions read across all OFX files. */
  transactionsParsed: number;
  /** Transactions actually inserted (excludes duplicates). */
  transactionsInserted: number;
  /** Transactions skipped because (bankCode, agency, accountNumber, fitId) already exists. */
  duplicatesSkipped: number;
  /** Newly-inserted transactions that auto-matched. */
  autoMatchedCount: number;
  /** Sums for the inserted transactions. */
  totalCredits: number;
  totalDebits: number;
  /** Per-file outcome, for the UI to surface failures and per-file dedup info. */
  files: OfxImportFileResult[];
  /** Filenames whose import failed (parse error, unreadable, etc.). */
  failedFiles: string[];
}

export interface ReconciliationStatistics {
  totalConciliadoMes: number;
  pendenteConciliacao: number;
  notasRecebidas: number;
  ultimaImportacao: Date | null;
  matchedOverTime: Array<{ period: string; matched: number; unmatched: number }>;
  topUnmatchedByCounterparty: Array<{ counterparty: string; amount: number; count: number }>;
  matchTypeDistribution: Record<ReconciliationMatchType, number>;
  statusDistribution: Record<ReconciliationStatus, number>;
  categoryDistribution: CategoryDistributionEntry[];
}
