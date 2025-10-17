// packages/interfaces/src/economic-activity.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION } from '@constants';
import type { Customer, CustomerIncludes } from "./customer";

// =====================
// Main Entity Interface
// =====================

export interface EconomicActivity extends BaseEntity {
  code: string;
  description: string;

  // Relations
  customers?: Customer[];

  // Count fields (when included)
  _count?: {
    customers?: number;
  };
}

// =====================
// Include Types
// =====================

export interface EconomicActivityIncludes {
  customers?:
    | boolean
    | {
        include?: CustomerIncludes;
      };
  _count?:
    | boolean
    | {
        select?: {
          customers?: boolean;
        };
      };
}

// =====================
// Order By Types
// =====================

export interface EconomicActivityOrderBy {
  id?: ORDER_BY_DIRECTION;
  code?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface EconomicActivityGetUniqueResponse extends BaseGetUniqueResponse<EconomicActivity> {}
export interface EconomicActivityGetManyResponse extends BaseGetManyResponse<EconomicActivity> {}
export interface EconomicActivityCreateResponse extends BaseCreateResponse<EconomicActivity> {}
export interface EconomicActivityUpdateResponse extends BaseUpdateResponse<EconomicActivity> {}
export interface EconomicActivityDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface EconomicActivityBatchCreateResponse<T> extends BaseBatchResponse<EconomicActivity, T> {}
export interface EconomicActivityBatchUpdateResponse<T> extends BaseBatchResponse<EconomicActivity, T & { id: string }> {}
export interface EconomicActivityBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// =====================
// Form Data Types
// =====================

export interface EconomicActivityCreateFormData {
  code: string;
  description: string;
}

export interface EconomicActivityUpdateFormData {
  code?: string;
  description?: string;
}

export interface EconomicActivityGetManyFormData {
  page?: number;
  limit?: number;
  take?: number;
  skip?: number;
  where?: any;
  orderBy?: EconomicActivityOrderBy;
  include?: EconomicActivityIncludes;
  searchingFor?: string;
  code?: string;
  hasCustomers?: boolean;
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
  updatedAt?: {
    gte?: Date;
    lte?: Date;
  };
}

export interface EconomicActivityBatchCreateFormData {
  economicActivities: EconomicActivityCreateFormData[];
}

export interface EconomicActivityBatchUpdateFormData {
  economicActivities: {
    id: string;
    data: EconomicActivityUpdateFormData;
  }[];
}

export interface EconomicActivityBatchDeleteFormData {
  economicActivityIds: string[];
}
