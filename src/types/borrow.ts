// packages/interfaces/src/borrow.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
  ORDER_BY_DIRECTION,
} from './common';
import type { BORROW_STATUS } from '@constants';
import type { Item, ItemIncludes, ItemOrderBy, ItemSelect } from './item';
import type { User, UserIncludes, UserOrderBy, UserSelect } from './user';

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

  // Count fields (when included)
  _count?: {
    item?: number;
    user?: number;
  };
}

// =====================
// Select Types
// =====================

/**
 * Borrow select type - defines which fields can be selected
 * Used with Prisma's select functionality for optimized queries
 */
export interface BorrowSelect {
  // Scalar fields
  id?: boolean;
  itemId?: boolean;
  userId?: boolean;
  quantity?: boolean;
  status?: boolean;
  statusOrder?: boolean;
  returnedAt?: boolean;
  createdAt?: boolean;
  updatedAt?: boolean;

  // Relations with nested select
  item?:
    | boolean
    | {
        select?: ItemSelect;
      };
  user?:
    | boolean
    | {
        select?: UserSelect;
      };

  // Count select
  _count?:
    | boolean
    | {
        select?: {
          item?: boolean;
          user?: boolean;
        };
      };
}

/**
 * Optimized select for table/list views
 * Returns only essential fields for displaying borrows in tables
 */
export type BorrowSelectTable = {
  id: true;
  quantity: true;
  status: true;
  returnedAt: true;
  createdAt: true;
  item: {
    select: {
      id: true;
      name: true;
      uniCode: true;
      quantity: true;
      brand?: {
        select: {
          name: true;
        };
      };
      category?: {
        select: {
          name: true;
        };
      };
    };
  };
  user: {
    select: {
      id: true;
      name: true;
      position?: {
        select: {
          name: true;
        };
      };
      sector?: {
        select: {
          name: true;
        };
      };
    };
  };
};

/**
 * Optimized select for form views
 * Returns fields needed for editing/creating borrows
 */
export type BorrowSelectForm = {
  id: true;
  itemId: true;
  userId: true;
  quantity: true;
  status: true;
  statusOrder: true;
  returnedAt: true;
  createdAt: true;
  updatedAt: true;
  item: {
    select: {
      id: true;
      name: true;
      uniCode: true;
      quantity: true;
      isPpe?: true;
      brand?: {
        select: {
          id: true;
          name: true;
        };
      };
      category?: {
        select: {
          id: true;
          name: true;
        };
      };
    };
  };
  user: {
    select: {
      id: true;
      name: true;
      email: true;
      status?: true;
      sectorId: true;
      positionId: true;
      position?: {
        select: {
          id: true;
          name: true;
        };
      };
      sector?: {
        select: {
          id: true;
          name: true;
        };
      };
    };
  };
};

/**
 * Optimized select for detail views
 * Returns all fields with complete relation data
 */
export type BorrowSelectDetail = {
  id: true;
  itemId: true;
  userId: true;
  quantity: true;
  status: true;
  statusOrder: true;
  returnedAt: true;
  createdAt: true;
  updatedAt: true;
  item: {
    select: {
      id: true;
      name: true;
      uniCode: true;
      quantity: true;
      isActive: true;
      isPpe?: true;
      brandId: true;
      categoryId: true;
      supplierId: true;
      createdAt: true;
      updatedAt: true;
      brand?: {
        select: {
          id: true;
          name: true;
        };
      };
      category?: {
        select: {
          id: true;
          name: true;
        };
      };
      supplier?: {
        select: {
          id: true;
          fantasyName: true;
        };
      };
    };
  };
  user: {
    select: {
      id: true;
      name: true;
      email: true;
      status?: true;
      sectorId: true;
      positionId: true;
      createdAt: true;
      updatedAt: true;
      position?: {
        select: {
          id: true;
          name: true;
        };
      };
      sector?: {
        select: {
          id: true;
          name: true;
        };
      };
    };
  };
};

// =====================
// Include Types
// =====================

/**
 * Borrow include type - defines which relations can be included
 * Backward compatible with existing include-based queries
 */
export interface BorrowIncludes {
  item?:
    | boolean
    | {
        include?: ItemIncludes;
        select?: ItemSelect;
      };
  user?:
    | boolean
    | {
        include?: UserIncludes;
        select?: UserSelect;
      };
  _count?:
    | boolean
    | {
        select?: {
          item?: boolean;
          user?: boolean;
        };
      };
}

// =====================
// Where Clause Types
// =====================

export interface BorrowWhere {
  // Logical operators
  AND?: BorrowWhere | BorrowWhere[];
  OR?: BorrowWhere[];
  NOT?: BorrowWhere | BorrowWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  itemId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  userId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // Numeric fields
  quantity?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      };

  statusOrder?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      };

  // Enum fields
  status?:
    | BORROW_STATUS
    | {
        equals?: BORROW_STATUS;
        not?: BORROW_STATUS;
        in?: BORROW_STATUS[];
        notIn?: BORROW_STATUS[];
      };

  // Date fields
  returnedAt?:
    | Date
    | null
    | {
        equals?: Date | null;
        not?: Date | null;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };

  createdAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };

  updatedAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };

  // Relations
  item?: {
    is?: any;
    isNot?: any;
  };
  user?: {
    is?: any;
    isNot?: any;
  };
}

// =====================
// Order By Types
// =====================

export interface BorrowOrderBy {
  id?: ORDER_BY_DIRECTION;
  itemId?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
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
export interface BorrowBatchUpdateResponse<T> extends BaseBatchResponse<
  Borrow,
  T & { id: string }
> {}
export interface BorrowBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// =====================
// API Request Types
// =====================

/**
 * Parameters for fetching multiple borrows
 * Supports both select and include for backward compatibility
 */
export interface BorrowGetManyParams {
  where?: BorrowWhere;
  include?: BorrowIncludes;
  select?: BorrowSelect;
  orderBy?: BorrowOrderBy | BorrowOrderBy[];
  skip?: number;
  take?: number;
  searchingFor?: string;
}

/**
 * Parameters for fetching a single borrow by ID
 * Supports both select and include for backward compatibility
 */
export interface BorrowGetByIdParams {
  include?: BorrowIncludes;
  select?: BorrowSelect;
}

// =====================
// Utility Types
// =====================

/**
 * Helper type to infer the result type based on select
 * This provides type safety for queries with custom selects
 */
export type BorrowWithSelect<S extends BorrowSelect> = {
  [K in keyof S]: S[K] extends true
    ? K extends keyof Borrow
      ? Borrow[K]
      : never
    : S[K] extends { select: infer NestedSelect }
      ? K extends 'item'
        ? Item
        : K extends 'user'
          ? User
          : never
      : never;
};

/**
 * Conditional type to get borrow with specific relations
 */
export type BorrowWithRelations<
  I extends boolean | object = false,
  U extends boolean | object = false,
> = Borrow & {
  item?: I extends true ? Item : I extends object ? Item : never;
  user?: U extends true ? User : U extends object ? User : never;
};

/**
 * Type for borrow in table view (minimal data)
 */
export type BorrowTableView = Pick<
  Borrow,
  'id' | 'quantity' | 'status' | 'returnedAt' | 'createdAt'
> & {
  item: Pick<Item, 'id' | 'name' | 'uniCode' | 'quantity'> & {
    brand?: { name: string };
    category?: { name: string };
  };
  user: Pick<User, 'id' | 'name'> & {
    position?: { name: string };
    sector?: { name: string };
  };
};

/**
 * Type for borrow in form view (editable data)
 */
export type BorrowFormView = Pick<
  Borrow,
  | 'id'
  | 'itemId'
  | 'userId'
  | 'quantity'
  | 'status'
  | 'statusOrder'
  | 'returnedAt'
  | 'createdAt'
  | 'updatedAt'
> & {
  item: Pick<Item, 'id' | 'name' | 'uniCode' | 'quantity'> & {
    isPpe?: boolean;
    brand?: { id: string; name: string };
    category?: { id: string; name: string };
  };
  user: Pick<User, 'id' | 'name' | 'email' | 'sectorId' | 'positionId'> & {
    status?: string;
    position?: { id: string; name: string };
    sector?: { id: string; name: string };
  };
};

/**
 * Type for borrow in detail view (complete data)
 */
export type BorrowDetailView = Borrow & {
  item: Item & {
    brand?: { id: string; name: string };
    category?: { id: string; name: string };
    supplier?: { id: string; fantasyName: string };
  };
  user: User & {
    position?: { id: string; name: string };
    sector?: { id: string; name: string };
  };
};
