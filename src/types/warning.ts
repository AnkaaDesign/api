// packages/interfaces/src/warning.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { WARNING_CATEGORY, WARNING_SEVERITY, ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes, UserOrderBy } from './user';
import type { File, FileIncludes } from './file';

// =====================
// Main Entity Interface
// =====================

export interface Warning extends BaseEntity {
  severity: WARNING_SEVERITY;
  severityOrder: number; // 1=Verbal, 2=Escrita, 3=Suspensão, 4=Advertência Final
  category: WARNING_CATEGORY;
  reason: string;
  description: string | null;
  isActive: boolean;
  collaboratorId: string;
  supervisorId: string;
  followUpDate: Date;
  hrNotes: string | null;
  resolvedAt: Date | null;

  // Relations (optional, populated based on query)
  collaborator?: User;
  supervisor?: User;
  witness?: User[];
  attachments?: File[];
}

// =====================
// Include Types
// =====================

export interface WarningIncludes {
  collaborator?:
    | boolean
    | {
        include?: UserIncludes;
      };
  supervisor?:
    | boolean
    | {
        include?: UserIncludes;
      };
  witness?:
    | boolean
    | {
        include?: UserIncludes;
      };
  attachments?:
    | boolean
    | {
        include?: FileIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface WarningOrderBy {
  id?: ORDER_BY_DIRECTION;
  severity?: ORDER_BY_DIRECTION;
  category?: ORDER_BY_DIRECTION;
  reason?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  followUpDate?: ORDER_BY_DIRECTION;
  hrNotes?: ORDER_BY_DIRECTION;
  resolvedAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  collaboratorId?: ORDER_BY_DIRECTION;
  supervisorId?: ORDER_BY_DIRECTION;
  collaborator?: UserOrderBy;
  supervisor?: UserOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface WarningGetUniqueResponse extends BaseGetUniqueResponse<Warning> {}
export interface WarningGetManyResponse extends BaseGetManyResponse<Warning> {}
export interface WarningCreateResponse extends BaseCreateResponse<Warning> {}
export interface WarningUpdateResponse extends BaseUpdateResponse<Warning> {}
export interface WarningDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface WarningBatchCreateResponse<T> extends BaseBatchResponse<Warning, T> {}
export interface WarningBatchUpdateResponse<T>
  extends BaseBatchResponse<Warning, T & { id: string }> {}
export interface WarningBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
