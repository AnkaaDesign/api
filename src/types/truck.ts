// packages/interfaces/src/truck.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { Task, TaskIncludes, TaskOrderBy } from "./task";
import type { Garage, GarageIncludes, GarageOrderBy, GarageLane, GarageLaneIncludes } from "./garage";
import type { Layout, LayoutIncludes } from "./layout";
import type { ORDER_BY_DIRECTION, TRUCK_MANUFACTURER } from '@constants';

// =====================
// Main Entity Interface
// =====================

export interface Truck extends BaseEntity {
  // Identification
  plate: string;
  model: string;
  manufacturer: TRUCK_MANUFACTURER;

  // Position
  xPosition: number | null;
  yPosition: number | null;

  // Relations
  taskId: string;
  garageId: string | null;
  laneId: string | null;
  leftSideLayoutId: string | null;
  rightSideLayoutId: string | null;
  backSideLayoutId: string | null;
  task?: Task;
  garage?: Garage;
  lane?: GarageLane;
  leftSideLayout?: Layout;
  rightSideLayout?: Layout;
  backSideLayout?: Layout;
}

// =====================
// Include Types
// =====================

export interface TruckIncludes {
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  garage?:
    | boolean
    | {
        include?: GarageIncludes;
      };
  lane?:
    | boolean
    | {
        include?: GarageLaneIncludes;
      };
  leftSideLayout?:
    | boolean
    | {
        include?: LayoutIncludes;
      };
  rightSideLayout?:
    | boolean
    | {
        include?: LayoutIncludes;
      };
  backSideLayout?:
    | boolean
    | {
        include?: LayoutIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface TruckOrderBy {
  id?: ORDER_BY_DIRECTION;
  plate?: ORDER_BY_DIRECTION;
  model?: ORDER_BY_DIRECTION;
  manufacturer?: ORDER_BY_DIRECTION;
  xPosition?: ORDER_BY_DIRECTION;
  yPosition?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  garageId?: ORDER_BY_DIRECTION;
  laneId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
  garage?: GarageOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface TruckGetUniqueResponse extends BaseGetUniqueResponse<Truck> {}
export interface TruckGetManyResponse extends BaseGetManyResponse<Truck> {}
export interface TruckCreateResponse extends BaseCreateResponse<Truck> {}
export interface TruckUpdateResponse extends BaseUpdateResponse<Truck> {}
export interface TruckDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface TruckBatchCreateResponse<T> extends BaseBatchResponse<Truck, T> {}
export interface TruckBatchUpdateResponse<T> extends BaseBatchResponse<Truck, T & { id: string }> {}
export interface TruckBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
