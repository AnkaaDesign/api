// packages/types/src/paint-brand.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION } from '@constants';
import type { Paint, PaintIncludes } from './paint';
import type { Item } from './item';

// =====================
// Main Entity Interfaces
// =====================

export interface PaintBrand extends BaseEntity {
  name: string;

  // Relations (optional, populated based on query)
  paints?: Paint[];
  componentItems?: Item[];

  // Count fields (optional, populated when using _count in include)
  _count?: {
    paints?: number;
    componentItems?: number;
  };
}

// =====================
// Include Types
// =====================

export interface PaintBrandIncludes {
  paints?:
    | boolean
    | {
        include?: PaintIncludes;
        where?: any; // PaintWhere conditions
        orderBy?: any; // PaintOrderBy conditions
      };
  componentItems?:
    | boolean
    | {
        include?: any; // ItemIncludes when available
        where?: any; // ItemWhere conditions
        orderBy?: any; // ItemOrderBy conditions
      };
  _count?:
    | boolean
    | {
        select?: {
          paints?: boolean;
          componentItems?: boolean;
        };
      };
}

// =====================
// Where Clause Types
// =====================

export interface PaintBrandWhere {
  // Logical operators
  AND?: PaintBrandWhere | PaintBrandWhere[];
  OR?: PaintBrandWhere[];
  NOT?: PaintBrandWhere | PaintBrandWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // String fields
  name?:
    | string
    | {
        equals?: string;
        not?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
        in?: string[];
        notIn?: string[];
      };

  // Date fields
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
  paints?: any; // PaintWhere conditions when filtering by related paints
}

// =====================
// Order By Types
// =====================

export interface PaintBrandOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

// PaintBrand responses
export interface PaintBrandGetUniqueResponse extends BaseGetUniqueResponse<PaintBrand> {}
export interface PaintBrandGetManyResponse extends BaseGetManyResponse<PaintBrand> {}
export interface PaintBrandCreateResponse extends BaseCreateResponse<PaintBrand> {}
export interface PaintBrandUpdateResponse extends BaseUpdateResponse<PaintBrand> {}
export interface PaintBrandDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// PaintBrand batch operations
export interface PaintBrandBatchCreateResponse<T> extends BaseBatchResponse<PaintBrand, T> {}
export interface PaintBrandBatchUpdateResponse<T> extends BaseBatchResponse<
  PaintBrand,
  T & { id: string }
> {}
export interface PaintBrandBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
