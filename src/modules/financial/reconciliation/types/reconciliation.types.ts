import {
  BankTransactionType,
  BankTransactionSubtype,
  ReconciliationMatchStatus,
  ReconciliationMatchType,
} from '@prisma/client';

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
  periodStart: Date;
  periodEnd: Date;
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: ParsedOfxTransaction[];
}

export interface MatchCandidate {
  fiscalDocumentId: string;
  accessKey: string;
  docType: string;
  issueDate: Date;
  totalValue: number;
  emitCnpj: string;
  emitName: string | null;
  destCnpj: string | null;
  destName: string | null;
  confidence: number;
  matchType: ReconciliationMatchType;
  rationale: string;
}

export interface ImportSummary {
  statementId: string;
  transactionCount: number;
  matchedCount: number;
  autoMatchedCount: number;
  unmatchedCount: number;
  totalCredits: number;
  totalDebits: number;
}

export interface ReconciliationStatistics {
  totalConciliadoMes: number;
  pendenteConciliacao: number;
  notasRecebidas: number;
  ultimaImportacao: Date | null;
  matchedOverTime: Array<{ period: string; matched: number; unmatched: number }>;
  topUnmatchedByCounterparty: Array<{ counterparty: string; amount: number; count: number }>;
  matchTypeDistribution: Record<ReconciliationMatchType, number>;
  matchStatusDistribution: Record<ReconciliationMatchStatus, number>;
}
