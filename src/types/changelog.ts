// packages/interfaces/src/changelog.ts

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
  CHANGE_LOG_ACTION,
  CHANGE_LOG_ENTITY_TYPE,
  ORDER_BY_DIRECTION,
  CHANGE_TRIGGERED_BY,
} from '@constants';
import type { User, UserIncludes, UserOrderBy } from './user';

// =====================
// Main Entity Interface
// =====================

export interface ChangeLog extends BaseEntity {
  entityType: CHANGE_LOG_ENTITY_TYPE;
  entityId: string;
  action: CHANGE_LOG_ACTION;
  field: string | null;
  oldValue: any | null;
  newValue: any | null;
  reason: string | null;
  metadata: any | null;
  userId: string | null;
  triggeredBy: CHANGE_TRIGGERED_BY | null;
  triggeredById: string | null;

  // Relations (optional, populated based on query)
  user?: User;
}

// =====================
// Include Types
// =====================

export interface ChangeLogIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface ChangeLogOrderBy {
  id?: ORDER_BY_DIRECTION;
  entityType?: ORDER_BY_DIRECTION;
  entityId?: ORDER_BY_DIRECTION;
  action?: ORDER_BY_DIRECTION;
  field?: ORDER_BY_DIRECTION;
  reason?: ORDER_BY_DIRECTION;
  triggeredBy?: ORDER_BY_DIRECTION;
  triggeredById?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  user?: UserOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface ChangeLogGetUniqueResponse extends BaseGetUniqueResponse<ChangeLog> {}
export interface ChangeLogGetManyResponse extends BaseGetManyResponse<ChangeLog> {}
export interface ChangeLogCreateResponse extends BaseCreateResponse<ChangeLog> {}
export interface ChangeLogUpdateResponse extends BaseUpdateResponse<ChangeLog> {}
export interface ChangeLogDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface ChangeLogBatchCreateResponse<T> extends BaseBatchResponse<ChangeLog, T> {}
export interface ChangeLogBatchUpdateResponse<T>
  extends BaseBatchResponse<ChangeLog, T & { id: string }> {}
export interface ChangeLogBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
