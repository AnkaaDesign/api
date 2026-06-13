// src/types/termination.ts
// Rescisões (Departamento Pessoal)

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
  TERMINATION_TYPE,
  TERMINATION_STATUS,
  TERMINATION_ITEM_TYPE,
  TERMINATION_DOCUMENT_TYPE,
  TERMINATION_DOCUMENT_STATUS,
  NOTICE_TYPE,
  NOTICE_REDUCTION,
  ORDER_BY_DIRECTION,
} from '@constants';
import type { User, UserIncludes } from './user';
import type { File, FileIncludes } from './file';

// =====================
// Main Entity Interfaces
// =====================

export interface Termination extends BaseEntity {
  userId: string;
  type: TERMINATION_TYPE;
  status: TERMINATION_STATUS;
  statusOrder: number;
  noticeType: NOTICE_TYPE | null;
  noticeReduction: NOTICE_REDUCTION;
  noticeDays: number | null;
  noticeStartDate: Date | null;
  lastWorkingDate: Date | null;
  terminationDate: Date | null;
  projectedEndDate: Date | null;
  paymentDueDate: Date | null;
  paymentDate: Date | null;
  paidAmount: number | null;
  baseRemuneration: number | null;
  fgtsBalance: number | null;
  accruedVacationPeriods: number;
  reason: string | null;
  justCauseArticle: string | null;
  initiatedById: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  initiatedBy?: User;
  items?: TerminationItem[];
  documents?: TerminationDocument[];
}

export interface TerminationItem extends BaseEntity {
  terminationId: string;
  type: TERMINATION_ITEM_TYPE;
  description: string | null;
  referenceQuantity: number | null;
  baseValue: number | null;
  amount: number; // negative = discount
  isCustom: boolean;

  // Relations (optional, populated based on query)
  termination?: Termination;
}

export interface TerminationDocument extends BaseEntity {
  terminationId: string;
  type: TERMINATION_DOCUMENT_TYPE;
  status: TERMINATION_DOCUMENT_STATUS;
  fileId: string | null;
  note: string | null;

  // Relations (optional, populated based on query)
  termination?: Termination;
  file?: File;
}

// =====================
// Calculation Result Types
// =====================

export interface TerminationCalculationTotals {
  earnings: number;
  discounts: number;
  net: number;
}

export interface TerminationCalculationResult {
  items: TerminationItem[];
  totals: TerminationCalculationTotals;
}

// =====================
// Include Types
// =====================

export interface TerminationIncludes {
  user?: boolean | { include?: UserIncludes };
  initiatedBy?: boolean | { include?: UserIncludes };
  items?: boolean | { include?: TerminationItemIncludes };
  documents?: boolean | { include?: TerminationDocumentIncludes };
}

export interface TerminationItemIncludes {
  termination?: boolean | { include?: TerminationIncludes };
}

export interface TerminationDocumentIncludes {
  termination?: boolean | { include?: TerminationIncludes };
  file?: boolean | { include?: FileIncludes };
}

// =====================
// Order By Types
// =====================

export interface TerminationOrderBy {
  id?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  noticeType?: ORDER_BY_DIRECTION;
  noticeDays?: ORDER_BY_DIRECTION;
  noticeStartDate?: ORDER_BY_DIRECTION;
  lastWorkingDate?: ORDER_BY_DIRECTION;
  terminationDate?: ORDER_BY_DIRECTION;
  projectedEndDate?: ORDER_BY_DIRECTION;
  paymentDueDate?: ORDER_BY_DIRECTION;
  paymentDate?: ORDER_BY_DIRECTION;
  paidAmount?: ORDER_BY_DIRECTION;
  baseRemuneration?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface TerminationGetUniqueResponse extends BaseGetUniqueResponse<Termination> {}
export interface TerminationGetManyResponse extends BaseGetManyResponse<Termination> {}
export interface TerminationCreateResponse extends BaseCreateResponse<Termination> {}
export interface TerminationUpdateResponse extends BaseUpdateResponse<Termination> {}
export interface TerminationDeleteResponse extends BaseDeleteResponse {}

export interface TerminationCalculateResponse
  extends BaseCreateResponse<TerminationCalculationResult> {}

export interface TerminationDocumentUpdateResponse
  extends BaseUpdateResponse<TerminationDocument> {}
export interface TerminationItemCreateResponse extends BaseCreateResponse<TerminationItem> {}
export interface TerminationItemUpdateResponse extends BaseUpdateResponse<TerminationItem> {}
export interface TerminationItemDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface TerminationBatchCreateResponse<T> extends BaseBatchResponse<Termination, T> {}
export interface TerminationBatchUpdateResponse<T>
  extends BaseBatchResponse<Termination, T & { id: string }> {}
export interface TerminationBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
