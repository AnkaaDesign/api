// packages/interfaces/src/customer.ts

import type { ORDER_BY_DIRECTION } from '@constants';
import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { File, FileIncludes } from "./file";
import type { Task, TaskIncludes } from "./task";

// =====================
// Main Entity Interface
// =====================

export interface Customer extends BaseEntity {
  fantasyName: string;
  cnpj: string | null;
  cpf: string | null;
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
  tasks?: Task[];

  // Count relations
  _count?: {
    tasks?: number;
    serviceOrders?: number;
    services?: number;
  };
}

// =====================
// Include Types
// =====================

export interface CustomerIncludes {
  logo?:
    | boolean
    | {
        include?: FileIncludes;
      };
  tasks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  _count?: {
    tasks?: boolean;
    serviceOrders?: boolean;
    services?: boolean;
  };
}

// =====================
// Order By Types
// =====================

export interface CustomerOrderBy {
  id?: ORDER_BY_DIRECTION;
  fantasyName?: ORDER_BY_DIRECTION;
  cnpj?: ORDER_BY_DIRECTION;
  cpf?: ORDER_BY_DIRECTION;
  corporateName?: ORDER_BY_DIRECTION;
  email?: ORDER_BY_DIRECTION;
  address?: ORDER_BY_DIRECTION;
  addressNumber?: ORDER_BY_DIRECTION;
  neighborhood?: ORDER_BY_DIRECTION;
  city?: ORDER_BY_DIRECTION;
  state?: ORDER_BY_DIRECTION;
  zipCode?: ORDER_BY_DIRECTION;
  site?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface CustomerGetUniqueResponse extends BaseGetUniqueResponse<Customer> {}
export interface CustomerGetManyResponse extends BaseGetManyResponse<Customer> {}
export interface CustomerCreateResponse extends BaseCreateResponse<Customer> {}
export interface CustomerUpdateResponse extends BaseUpdateResponse<Customer> {}
export interface CustomerDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface CustomerBatchCreateResponse extends BaseBatchResponse<Customer, unknown> {}
export interface CustomerBatchUpdateResponse extends BaseBatchResponse<Customer, unknown> {}
export interface CustomerBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
