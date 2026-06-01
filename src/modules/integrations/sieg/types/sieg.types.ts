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

/** Per-item tax group extracted from NFe `det.imposto`. */
export interface ParsedItemTaxes {
  icms?: { vBC?: number; pICMS?: number; vICMS?: number; cst?: string } | null;
  ipi?: { vBC?: number; pIPI?: number; vIPI?: number; cst?: string } | null;
  pis?: { vBC?: number; pPIS?: number; vPIS?: number; cst?: string } | null;
  cofins?: { vBC?: number; pCOFINS?: number; vCOFINS?: number; cst?: string } | null;
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
  /** Fiscal classification (NFe only). */
  ncm?: string | null;
  cfop?: string | null;
  cest?: string | null;
  ean?: string | null;
  cst?: string | null;
  discount?: number | null;
  freight?: number | null;
  taxes?: ParsedItemTaxes | null;
}

/** Address block extracted from NFe `enderEmit`/`enderDest`. */
export interface ParsedAddress {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  fone?: string | null;
}

/** NFe ICMSTot totals breakdown. */
export interface ParsedTotals {
  vBC?: number;
  vICMS?: number;
  vICMSDeson?: number;
  vProd?: number;
  vFrete?: number;
  vSeg?: number;
  vDesc?: number;
  vOutro?: number;
  vST?: number;
  vIPI?: number;
  vPIS?: number;
  vCOFINS?: number;
  vNF?: number;
  vTotTrib?: number;
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

  // --- Rich fields (persisted to FiscalDocument columns) ---
  series?: string | null;
  model?: string | null;
  naturezaOperacao?: string | null;
  protocolNumber?: string | null;
  authorizationDate?: Date | null;
  cStat?: string | null;
  xMotivo?: string | null;
  /** True when issueDate could not be parsed and was inferred to "now". */
  dateInferred?: boolean;
  emitIE?: string | null;
  emitAddress?: ParsedAddress | null;
  destIE?: string | null;
  destEmail?: string | null;
  destAddress?: ParsedAddress | null;
  totals?: ParsedTotals | null;
  cancelledAt?: Date | null;
  // NFSe-specific
  issValue?: number | null;
  issRetained?: boolean | null;
  issRate?: number | null;
  baseCalculo?: number | null;
  valorLiquido?: number | null;
  valorServicos?: number | null;
  codigoTributacaoMunicipio?: string | null;
  municipioPrestacao?: string | null;
  itemListaServico?: string | null;
}

export const SIEG_XML_TYPE_MAP: Record<FiscalDocumentType, 1 | 2 | 3 | 4 | 5> = {
  NFE: 1,
  CTE: 2,
  NFSE: 3,
  NFCE: 4,
  CFE: 5,
};
