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
  /** Absolute R$ difference between the NF total and |transaction amount|. */
  amountDelta: number;
  /** Whole-day difference between issue date and posting date. */
  daysDelta: number;
  /** True when a learned memo→CNPJ alias contributed to the CNPJ score. */
  aliasAssisted: boolean;
  /** First few line items / services (descriptions) of the candidate doc. */
  items: MatchCandidateItem[];
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
