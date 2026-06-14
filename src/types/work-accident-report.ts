// src/types/work-accident-report.ts
// CAT — Comunicação de Acidente de Trabalho (Medicina do Trabalho, Part E)

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { WORK_ACCIDENT_REPORT_TYPE, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes } from './user';
import type { Leave } from './leave';
import type { File } from './file';

// =====================
// Main Entity Interface
// =====================

export interface WorkAccidentReport extends BaseEntity {
  userId: string;
  leaveId: string | null;
  type: WORK_ACCIDENT_REPORT_TYPE;
  catNumber: string | null;
  emissionDate: Date | null;
  accidentDate: Date | null;
  description: string | null;
  fileId: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  leave?: Leave;
  file?: File;
}

// =====================
// Include Types
// =====================

export interface WorkAccidentReportIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  leave?: boolean;
  file?: boolean;
}

// =====================
// Order By Types
// =====================

export interface WorkAccidentReportOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  catNumber?: ORDER_BY_DIRECTION;
  emissionDate?: ORDER_BY_DIRECTION;
  accidentDate?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface WorkAccidentReportGetUniqueResponse
  extends BaseGetUniqueResponse<WorkAccidentReport> {}
export interface WorkAccidentReportGetManyResponse
  extends BaseGetManyResponse<WorkAccidentReport> {}
export interface WorkAccidentReportCreateResponse
  extends BaseCreateResponse<WorkAccidentReport> {}
export interface WorkAccidentReportUpdateResponse
  extends BaseUpdateResponse<WorkAccidentReport> {}
export interface WorkAccidentReportDeleteResponse extends BaseDeleteResponse {}

export interface WorkAccidentReportBatchCreateResponse<T>
  extends BaseBatchResponse<WorkAccidentReport, T> {}
export interface WorkAccidentReportBatchUpdateResponse<T>
  extends BaseBatchResponse<WorkAccidentReport, T & { id: string }> {}
export interface WorkAccidentReportBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
