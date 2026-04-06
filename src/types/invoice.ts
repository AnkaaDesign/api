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
  nfseDocuments?: NfseDocument[];
  customer?: { id: string; fantasyName: string; cnpj?: string | null };
  task?: { id: string; name?: string | null; serialNumber?: string | null };
  createdBy?: { id: string; name: string } | null;
}

export interface InvoiceInclude {
  installments?:
    | boolean
    | { include?: { bankSlip?: boolean | { include?: { pdfFile?: boolean } } } };
  nfseDocuments?: boolean;
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
  paymentMethod: string | null;
  receiptFileId: string | null;
  bankSlip?: BankSlip | null;
  receiptFile?: { id: string; path: string; originalName: string; mimetype: string; size: number } | null;
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
  elotechNfseId: number | null;
  status: NFSE_STATUS;
  errorMessage: string | null;
  errorCount: number;
  retryAfter: Date | null;
  invoice?: Invoice;
}

export interface ElotechNfseListItem {
  id: number;
  numeroNotaFiscal: number;
  tipoDocumento: string;
  dataEmissao: string;
  situacao: number;
  descricaoSituacao: string;
  cancelada: boolean;
  emitida: boolean;
  tomadorCnpjCpf: string;
  tomadorRazaoNome: string;
  valorDoc: number;
  valorServico: number;
  valorISS: number;
  issRetido: string;
  idMotivoSituacao?: number;
  descricaoMotivoSituacao?: string;
  // Enriched from local DB
  invoiceId?: string;
  taskId?: string;
  taskName?: string;
  taskSerialNumber?: string;
  customerName?: string;
  nfseDocumentId?: string;
  localStatus?: string;
}

export interface ElotechNfseDetail {
  formTomador: Record<string, any>;
  formDadosNFSe: Record<string, any>;
  formImposto: Record<string, any>;
  formTotal: Record<string, any>;
  // Enriched from local DB
  invoiceId?: string | null;
  taskId?: string | null;
  taskName?: string | null;
  taskSerialNumber?: string | null;
  customerName?: string | null;
  nfseDocumentId?: string | null;
  localStatus?: string | null;
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
