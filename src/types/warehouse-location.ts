// packages/interfaces/src/warehouse-location.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION, WAREHOUSE_LOCATION_TYPE } from '@constants';
import type { Item, ItemIncludes } from './item';

// =====================
// WarehouseLocation Interface
// =====================

export interface WarehouseLocation extends BaseEntity {
  name: string;
  type: WAREHOUSE_LOCATION_TYPE;
  // Optional grouping label (e.g. "Setor 1") used to organize locations.
  section: string | null;
  // Optional short human code (e.g. "A1-03"); unique when provided.
  code: string | null;
  description: string | null;
  isActive: boolean;

  // Top-view map placement (logical floor units).
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number;

  // Internal grid for the front view. levels = níveis (rows / prateleiras),
  // columns = default colunas, columnsPerLevel overrides per nível (index 0 = nível 1).
  levels: number;
  columns: number;
  columnsPerLevel: number[];

  // Relations
  items?: Item[];

  // Count aggregations
  _count?: {
    items?: number;
  };
}

// =====================
// Include Types
// =====================

export interface WarehouseLocationIncludes {
  items?:
    | boolean
    | {
        include?: ItemIncludes;
      };
}

// =====================
// OrderBy Types
// =====================

export interface WarehouseLocationOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  section?: ORDER_BY_DIRECTION;
  code?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  levels?: ORDER_BY_DIRECTION;
  columns?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  _count?: {
    items?: ORDER_BY_DIRECTION;
  };
}

// =====================
// Response Interfaces
// =====================

export interface WarehouseLocationGetUniqueResponse
  extends BaseGetUniqueResponse<WarehouseLocation> {}
export interface WarehouseLocationGetManyResponse extends BaseGetManyResponse<WarehouseLocation> {}
export interface WarehouseLocationCreateResponse extends BaseCreateResponse<WarehouseLocation> {}
export interface WarehouseLocationUpdateResponse extends BaseUpdateResponse<WarehouseLocation> {}
export interface WarehouseLocationDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface WarehouseLocationBatchCreateResponse<T>
  extends BaseBatchResponse<WarehouseLocation, T> {}
export interface WarehouseLocationBatchUpdateResponse<T>
  extends BaseBatchResponse<WarehouseLocation, T & { id: string }> {}
export interface WarehouseLocationBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
