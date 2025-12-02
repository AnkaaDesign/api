// packages/interfaces/src/borrow.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION, BORROW_STATUS } from '@constants';
import type { Item, ItemIncludes, ItemOrderBy } from './item';
import type { User, UserIncludes, UserOrderBy } from './user';

// =====================
// Main Entity Interface
// =====================

export interface Borrow extends BaseEntity {
  itemId: string;
  userId: string;
  quantity: number;
  status: BORROW_STATUS;
  statusOrder: number;
  returnedAt: Date | null;

  // Relations (optional, populated based on query)
  item?: Item;
  user?: User;
}

// =====================
// Include Types
// =====================

export interface BorrowIncludes {
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface BorrowOrderBy {
  id?: ORDER_BY_DIRECTION;
  quantity?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  returnedAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  item?: ItemOrderBy;
  user?: UserOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface BorrowGetUniqueResponse extends BaseGetUniqueResponse<Borrow> {}
export interface BorrowGetManyResponse extends BaseGetManyResponse<Borrow> {}
export interface BorrowCreateResponse extends BaseCreateResponse<Borrow> {}
export interface BorrowUpdateResponse extends BaseUpdateResponse<Borrow> {}
export interface BorrowDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface BorrowBatchCreateResponse<T> extends BaseBatchResponse<Borrow, T> {}
export interface BorrowBatchUpdateResponse<T>
  extends BaseBatchResponse<Borrow, T & { id: string }> {}
export interface BorrowBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
