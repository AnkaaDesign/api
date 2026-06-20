// src/types/fispq.ts
// FISPQ / FDS — Ficha de Informações de Segurança de Produtos Químicos (Medicina
// do Trabalho — inventário de produtos químicos).

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type {
  GHS_PICTOGRAM,
  GHS_SIGNAL_WORD,
  FISPQ_STATUS,
  ORDER_BY_DIRECTION,
} from '@constants';
import type { Item, ItemIncludes } from './item';
import type { File } from './file';

// =====================
// Main Entity Interface
// =====================

export interface Fispq extends BaseEntity {
  itemId: string;

  // Section 1 — identification
  productName: string | null;
  manufacturer: string | null;
  supplierName: string | null;
  recommendedUse: string | null;
  emergencyPhone: string | null;

  // Section 2 — GHS hazards
  ghsPictograms: GHS_PICTOGRAM[];
  signalWord: GHS_SIGNAL_WORD | null;
  hazardStatements: string[];
  precautionStatements: string[];

  // Section 3 + 14 — composition / transport
  casNumber: string | null;
  onuNumber: string | null;
  unRiskClass: string | null;
  packingGroup: string | null;

  // Section 9 — physical/chemical
  physicalState: string | null;
  color: string | null;
  odor: string | null;
  flashPoint: string | null;
  phValue: string | null;

  // Sections 4–7 — narrative safety guidance
  firstAidMeasures: string | null;
  fireFightingMeasures: string | null;
  accidentalRelease: string | null;
  handlingStorage: string | null;

  // Section 8 — exposure control / PPE
  requiredPpeText: string | null;

  // Document + lifecycle
  pdfFileId: string | null;
  revisionNumber: string | null;
  issueDate: Date | null;
  revisionDate: Date | null;
  validUntil: Date | null;
  status: FISPQ_STATUS;
  notes: string | null;
  isActive: boolean;

  // Relations (optional, populated based on query)
  item?: Item;
  pdfFile?: File;
  requiredPpeItems?: Item[];
}

// =====================
// Include Types
// =====================

export interface FispqIncludes {
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  pdfFile?: boolean;
  requiredPpeItems?: boolean;
}

// =====================
// Order By Types
// =====================

export interface FispqOrderBy {
  id?: ORDER_BY_DIRECTION;
  itemId?: ORDER_BY_DIRECTION;
  productName?: ORDER_BY_DIRECTION;
  manufacturer?: ORDER_BY_DIRECTION;
  casNumber?: ORDER_BY_DIRECTION;
  onuNumber?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  signalWord?: ORDER_BY_DIRECTION;
  issueDate?: ORDER_BY_DIRECTION;
  revisionDate?: ORDER_BY_DIRECTION;
  validUntil?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface FispqGetUniqueResponse extends BaseGetUniqueResponse<Fispq> {}
export interface FispqGetManyResponse extends BaseGetManyResponse<Fispq> {}
export interface FispqCreateResponse extends BaseCreateResponse<Fispq> {}
export interface FispqUpdateResponse extends BaseUpdateResponse<Fispq> {}
export interface FispqDeleteResponse extends BaseDeleteResponse {}

export interface FispqBatchCreateResponse<T> extends BaseBatchResponse<Fispq, T> {}
export interface FispqBatchUpdateResponse<T> extends BaseBatchResponse<Fispq, T & { id: string }> {}
export interface FispqBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
