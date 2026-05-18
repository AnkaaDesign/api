import {
  FiscalDocumentType,
  FiscalDocumentOperation,
  FiscalDocumentStatus,
} from '@prisma/client';

export interface SiegXmlResponseItem {
  /** 44-digit access key for NFe/NFCe/CTe; municipality-specific for NFSe */
  chaveAcesso?: string;
  /** Some SIEG endpoints return XML as base64 in this field */
  xml: string;
  /** SIEG-internal identifier */
  id?: string;
  /** Doc type echoed by SIEG */
  tipoDocumento?: number;
}

export interface SiegDownloadParams {
  dateStart: string; // YYYY-MM-DD
  dateEnd: string; // YYYY-MM-DD
  xmlType: 1 | 2 | 3 | 4 | 5;
  cnpjEmit?: string;
  cnpjDest?: string;
  take?: number; // max 50
  skip?: number;
}

export interface ParsedFiscalDocumentItem {
  /** Product code (NFe `cProd`) or service code (NFSe `ItemListaServico` / `cServ`). */
  code: string | null;
  description: string;
  /** Quantity (NFe `qCom`); null for NFSe single-service rows. */
  quantity: number | null;
  /** Unit of measurement (NFe `uCom`); usually null for services. */
  unit: string | null;
  /** Unit price (NFe `vUnCom`); null for NFSe single-service rows. */
  unitValue: number | null;
  /** Line total (NFe `vProd`; NFSe `ValorServicos` / `vServPrest`). */
  totalValue: number;
}

export interface ParsedFiscalDocument {
  accessKey: string;
  docType: FiscalDocumentType;
  operationType: FiscalDocumentOperation;
  status: FiscalDocumentStatus;
  issueDate: Date;
  totalValue: number;
  emitCnpj: string;
  emitName: string | null;
  destCnpj: string | null;
  destCpf: string | null;
  destName: string | null;
  nfNumber: string | null;
  paymentMethods: unknown;
  rawXml: string;
  items: ParsedFiscalDocumentItem[];
}

export const SIEG_XML_TYPE_MAP: Record<FiscalDocumentType, 1 | 2 | 3 | 4 | 5> = {
  NFE: 1,
  CTE: 2,
  NFSE: 3,
  NFCE: 4,
  CFE: 5,
};
