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
import type { MedicalExam } from './medical-exam';

// =====================
// Main Entity Interfaces
// =====================

export interface Termination extends BaseEntity {
  userId: string;
  contractId: string | null;
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
  // Cancelamento: etapa em que o processo estava ao ser cancelado e a
  // justificativa (≠ `reason`, que é o motivo da rescisão em si).
  cancelledFromStatus: TERMINATION_STATUS | null;
  cancellationReason: string | null;
  initiatedById: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  initiatedBy?: User;
  items?: TerminationItem[];
  documents?: TerminationDocument[];
  dismissalExam?: MedicalExam | null;
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

// Tax/FGTS assist (Part G) — POST :id/compute-taxes.
// Mirrors TerminationCalculationService.computeTaxAssist's TaxAssistResult.
export interface TaxAssistResult {
  /** Base de INSS do mês (saldo + aviso trabalhado), tributável. */
  monthlyInssBase: number;
  /** INSS sobre a base mensal tributável. */
  monthlyInss: number;
  /** IRRF sobre a base mensal tributável (já deduzido o INSS). */
  monthlyIrrf: number;
  /** Base exclusiva de INSS do 13º. */
  thirteenthInssBase: number;
  /** INSS sobre o 13º (base exclusiva). */
  thirteenthInss: number;
  /** IRRF sobre o 13º (base exclusiva). */
  thirteenthIrrf: number;
  /** INSS total a descontar (mensal + 13º). */
  totalInss: number;
  /** IRRF total a descontar (mensal + 13º). */
  totalIrrf: number;
  /** Base da multa do FGTS (saldo informado + 8% sobre aviso indenizado + 13º). */
  fgtsFineBase: number;
}

// =====================
// Include Types
// =====================

export interface TerminationIncludes {
  user?: boolean | { include?: UserIncludes };
  initiatedBy?: boolean | { include?: UserIncludes };
  items?: boolean | { include?: TerminationItemIncludes };
  documents?: boolean | { include?: TerminationDocumentIncludes };
  dismissalExam?: boolean;
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

export interface TerminationComputeTaxesResponse
  extends BaseGetUniqueResponse<TaxAssistResult> {}

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
