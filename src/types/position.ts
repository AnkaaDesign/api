// packages/interfaces/src/position.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION } from '@constants';
import type { User, UserIncludes, UserOrderBy } from "./user";

// =====================
// Main Entity Interfaces
// =====================

export interface MonetaryValue extends BaseEntity {
  value: number;
  current: boolean;
  itemId: string | null;
  positionId: string | null;

  // Relations (optional, populated based on query)
  item?: any; // Item type
  position?: Position;
}

export interface Position extends BaseEntity {
  name: string;
  hierarchy: number | null;
  bonifiable: boolean;

  // Relations (optional, populated based on query)
  users?: User[];
  remunerations?: MonetaryValue[];

  // Virtual field (computed from latest/current monetary value)
  remuneration?: number;

  // Count fields (when included)
  _count?: {
    users?: number;
    remunerations?: number;
  };
}

// =====================
// Include Types
// =====================

export interface MonetaryValueIncludes {
  item?: boolean | { include?: any };
  position?: boolean | { include?: PositionIncludes };
}

export interface PositionIncludes {
  users?:
    | boolean
    | {
        include?: UserIncludes;
      };
  remunerations?:
    | boolean
    | {
        include?: MonetaryValueIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface PositionOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  hierarchy?: ORDER_BY_DIRECTION;
  remuneration?: ORDER_BY_DIRECTION;
  user?: UserOrderBy;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
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

// =====================
// Batch Operation Responses
// =====================

// Position batch operations
export interface PositionBatchCreateResponse<T = any> extends BaseBatchResponse<Position, T> {}
export interface PositionBatchUpdateResponse<T = any> extends BaseBatchResponse<Position, T> {}
export interface PositionBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
