// src/types/leave.ts
// Afastamentos (Medicina do Trabalho)

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
  LEAVE_TYPE,
  LEAVE_STATUS,
  INSS_BENEFIT_SPECIES,
  ORDER_BY_DIRECTION,
} from '@constants';
import type { User, UserIncludes } from './user';
import type { File } from './file';

// =====================
// Main Entity Interface
// =====================

export interface Leave extends BaseEntity {
  userId: string;
  type: LEAVE_TYPE;
  status: LEAVE_STATUS;
  statusOrder: number;
  startDate: Date;
  expectedEndDate: Date | null;
  actualEndDate: Date | null;
  // Restricted field: only ACCOUNTING/HUMAN_RESOURCES/ADMIN routes expose it
  // (the whole leaves controller is gated to those roles).
  cid: string | null;
  inssBenefitSpecies: INSS_BENEFIT_SPECIES | null;
  inssBenefitNumber: string | null;
  returnExamRequired: boolean;
  notes: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  files?: File[];
}

// =====================
// Include Types
// =====================

export interface LeaveIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  files?: boolean;
}

// =====================
// Order By Types
// =====================

export interface LeaveOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  startDate?: ORDER_BY_DIRECTION;
  expectedEndDate?: ORDER_BY_DIRECTION;
  actualEndDate?: ORDER_BY_DIRECTION;
  returnExamRequired?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface LeaveGetUniqueResponse extends BaseGetUniqueResponse<Leave> {}
export interface LeaveGetManyResponse extends BaseGetManyResponse<Leave> {}
export interface LeaveCreateResponse extends BaseCreateResponse<Leave> {}
export interface LeaveUpdateResponse extends BaseUpdateResponse<Leave> {}
export interface LeaveDeleteResponse extends BaseDeleteResponse {}

export interface LeaveBatchCreateResponse<T> extends BaseBatchResponse<Leave, T> {}
export interface LeaveBatchUpdateResponse<T> extends BaseBatchResponse<
  Leave,
  T & { id: string }
> {}
export interface LeaveBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
