// packages/interfaces/src/supplier.ts

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
import type { File, FileIncludes } from './file';
import type { Item, ItemIncludes } from './item';
import type { Order, OrderIncludes, OrderRule, OrderRuleIncludes } from './order';

// =====================
// Supplier Interface
// =====================

export interface Supplier extends BaseEntity {
  fantasyName: string;
  name?: string; // Alias for fantasyName for backwards compatibility
  cnpj: string | null;
  corporateName: string | null;
  email: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  site: string | null;
  phones: string[];
  tags: string[];
  logoId: string | null;

  // Relations
  logo?: File;
  items?: Item[];
  orders?: Order[];
  orderRules?: OrderRule[];

  // Count aggregations
  _count?: {
    items?: number;
    orders?: number;
    orderRules?: number;
  };
}

// =====================
// Include Types
// =====================

export interface SupplierIncludes {
  logo?:
    | boolean
    | {
        include?: FileIncludes;
      };
  items?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  orders?:
    | boolean
    | {
        include?: OrderIncludes;
      };
  orderRules?:
    | boolean
    | {
        include?: OrderRuleIncludes;
      };
}

// =====================
// OrderBy Types
// =====================

export interface SupplierOrderBy {
  id?: ORDER_BY_DIRECTION;
  fantasyName?: ORDER_BY_DIRECTION;
  cnpj?: ORDER_BY_DIRECTION;
  corporateName?: ORDER_BY_DIRECTION;
  email?: ORDER_BY_DIRECTION;
  address?: ORDER_BY_DIRECTION;
  addressNumber?: ORDER_BY_DIRECTION;
  addressComplement?: ORDER_BY_DIRECTION;
  neighborhood?: ORDER_BY_DIRECTION;
  city?: ORDER_BY_DIRECTION;
  state?: ORDER_BY_DIRECTION;
  zipCode?: ORDER_BY_DIRECTION;
  site?: ORDER_BY_DIRECTION;
  logoId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  _count?: {
    items?: ORDER_BY_DIRECTION;
    orders?: ORDER_BY_DIRECTION;
    orderRules?: ORDER_BY_DIRECTION;
  };
}

// =====================
// Response Interfaces
// =====================

export interface SupplierGetUniqueResponse extends BaseGetUniqueResponse<Supplier> {}
export interface SupplierGetManyResponse extends BaseGetManyResponse<Supplier> {}
export interface SupplierCreateResponse extends BaseCreateResponse<Supplier> {}
export interface SupplierUpdateResponse extends BaseUpdateResponse<Supplier> {}
export interface SupplierDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface SupplierBatchCreateResponse<T> extends BaseBatchResponse<Supplier, T> {}
export interface SupplierBatchUpdateResponse<T>
  extends BaseBatchResponse<Supplier, T & { id: string }> {}
export interface SupplierBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
