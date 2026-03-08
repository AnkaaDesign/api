import { BaseEntity } from './common';
import {
  INVOICE_STATUS,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
  NFSE_STATUS,
  BANK_SLIP_TYPE,
} from '../constants/enums';

// =====================
// Invoice
// =====================

export interface Invoice extends BaseEntity {
  customerConfigId: string;
  taskId: string;
  customerId: string;
  totalAmount: number;
  paidAmount: number;
  status: INVOICE_STATUS;
  notes: string | null;
  createdById: string | null;
  installments?: Installment[];
  nfseDocument?: NfseDocument | null;
  customer?: { id: string; fantasyName: string; cnpj?: string | null };
  task?: { id: string; name?: string | null; serialNumber?: string | null };
  createdBy?: { id: string; name: string } | null;
}

export interface InvoiceInclude {
  installments?:
    | boolean
    | { include?: { bankSlip?: boolean | { include?: { pdfFile?: boolean } } } };
  nfseDocument?: boolean | { include?: { pdfFile?: boolean } };
  customer?: boolean;
  task?: boolean;
  createdBy?: boolean;
  customerConfig?: boolean;
}

export interface InvoiceOrderBy {
  createdAt?: 'asc' | 'desc';
  totalAmount?: 'asc' | 'desc';
  status?: 'asc' | 'desc';
  paidAmount?: 'asc' | 'desc';
}

export interface InvoiceWhere {
  taskId?: string;
  customerId?: string;
  status?: INVOICE_STATUS | INVOICE_STATUS[];
  createdById?: string;
}

// =====================
// Installment
// =====================

export interface Installment extends BaseEntity {
  customerConfigId: string;
  invoiceId: string | null;
  number: number;
  dueDate: Date;
  amount: number;
  paidAmount: number;
  paidAt: Date | null;
  status: INSTALLMENT_STATUS;
  bankSlip?: BankSlip | null;
  invoice?: Invoice;
}

// =====================
// BankSlip
// =====================

export interface BankSlip extends BaseEntity {
  installmentId: string;
  nossoNumero: string;
  seuNumero: string | null;
  barcode: string | null;
  digitableLine: string | null;
  pixQrCode: string | null;
  txid: string | null;
  type: BANK_SLIP_TYPE;
  amount: number;
  dueDate: Date;
  status: BANK_SLIP_STATUS;
  sicrediStatus: string | null;
  pdfFileId: string | null;
  paidAmount: number | null;
  paidAt: Date | null;
  liquidationData: Record<string, unknown> | null;
  errorMessage: string | null;
  errorCount: number;
  lastSyncAt: Date | null;
  pdfFile?: { id: string; path: string } | null;
  installment?: Installment;
}

// =====================
// NfseDocument
// =====================

export interface NfseDocument extends BaseEntity {
  invoiceId: string;
  nfseNumber: string | null;
  chaveAcesso: string | null;
  verificationCode: string | null;
  nDps: number | null;
  xml: string | null;
  status: NFSE_STATUS;
  issuedAt: Date | null;
  cancelledAt: Date | null;
  errorMessage: string | null;
  errorCount: number;
  retryAfter: Date | null;
  municipalServiceCode: string | null;
  description: string | null;
  totalAmount: number;
  issRate: number | null;
  issAmount: number | null;
  pdfFileId: string | null;
  pdfFile?: { id: string; path: string } | null;
  invoice?: Invoice;
}

// =====================
// API Response Types
// =====================

export interface InvoiceGetUniqueResponse {
  data: Invoice;
}

export interface InvoiceGetManyResponse {
  data: Invoice[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface InvoiceGetManyFormData {
  page?: number;
  limit?: number;
  orderBy?: InvoiceOrderBy;
  where?: InvoiceWhere;
  include?: InvoiceInclude;
  taskId?: string;
  customerId?: string;
  status?: INVOICE_STATUS | INVOICE_STATUS[];
}
