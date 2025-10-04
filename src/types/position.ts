// packages/interfaces/src/position.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes, UserOrderBy } from "./user";

// =====================
// Main Entity Interfaces
// =====================

export interface Position extends BaseEntity {
  name: string;
  bonifiable: boolean;

  // Relations (optional, populated based on query)
  users?: User[];
  remunerations?: PositionRemuneration[];

  // Virtual field (computed from latest remuneration)
  remuneration?: number;

  // Count fields (when included)
  _count?: {
    users?: number;
    remunerations?: number;
  };
}

export interface PositionRemuneration extends BaseEntity {
  value: number;
  positionId: string;

  // Relations (optional, populated based on query)
  position?: Position;
}

// =====================
// Include Types
// =====================

export interface PositionIncludes {
  users?:
    | boolean
    | {
        include?: UserIncludes;
      };
  remunerations?:
    | boolean
    | {
        include?: PositionRemunerationIncludes;
      };
}

export interface PositionRemunerationIncludes {
  position?:
    | boolean
    | {
        include?: PositionIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface PositionOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  remuneration?: ORDER_BY_DIRECTION;
  user?: UserOrderBy;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface PositionRemunerationOrderBy {
  id?: ORDER_BY_DIRECTION;
  value?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  position?: PositionOrderBy;
}

// =====================
// Response Interfaces
// =====================

// Position responses
export interface PositionGetUniqueResponse extends BaseGetUniqueResponse<Position> {}
export interface PositionGetManyResponse extends BaseGetManyResponse<Position> {}
export interface PositionCreateResponse extends BaseCreateResponse<Position> {}
export interface PositionUpdateResponse extends BaseUpdateResponse<Position> {}
export interface PositionDeleteResponse extends BaseDeleteResponse {}

// PositionRemuneration responses
export interface PositionRemunerationGetUniqueResponse extends BaseGetUniqueResponse<PositionRemuneration> {}
export interface PositionRemunerationGetManyResponse extends BaseGetManyResponse<PositionRemuneration> {}
export interface PositionRemunerationCreateResponse extends BaseCreateResponse<PositionRemuneration> {}
export interface PositionRemunerationUpdateResponse extends BaseUpdateResponse<PositionRemuneration> {}
export interface PositionRemunerationDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// Position batch operations
export interface PositionBatchCreateResponse<T = any> extends BaseBatchResponse<Position, T> {}
export interface PositionBatchUpdateResponse<T = any> extends BaseBatchResponse<Position, T> {}
export interface PositionBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// PositionRemuneration batch operations
export interface PositionRemunerationBatchCreateResponse<T = any> extends BaseBatchResponse<PositionRemuneration, T> {}
export interface PositionRemunerationBatchUpdateResponse<T = any> extends BaseBatchResponse<PositionRemuneration, T> {}
export interface PositionRemunerationBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
