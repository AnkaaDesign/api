// packages/interfaces/src/garage.ts

import type { ORDER_BY_DIRECTION } from '@constants';
import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { Truck, TruckIncludes } from "./truck";

// =====================
// Main Entity Interfaces
// =====================

export interface ParkingSpot extends BaseEntity {
  name: string;
  length: number;
  garageLaneId: string;

  // Relations
  garageLane?: GarageLane;
}

export interface GarageLane extends BaseEntity {
  width: number;
  length: number;
  xPosition: number;
  yPosition: number;
  garageId: string;

  // Relations
  garage?: Garage;
  parkingSpots?: ParkingSpot[];
  trucks?: Truck[];
}

export interface Garage extends BaseEntity {
  name: string;
  width: number;
  length: number;
  isVirtual?: boolean;

  // Relations
  lanes?: GarageLane[];
  trucks?: Truck[];
}

// =====================
// Include Types
// =====================

export interface GarageIncludes {
  lanes?:
    | boolean
    | {
        include?: GarageLaneIncludes;
      };
  trucks?:
    | boolean
    | {
        include?: TruckIncludes;
      };
}

export interface GarageLaneIncludes {
  garage?:
    | boolean
    | {
        include?: GarageIncludes;
      };
  parkingSpots?:
    | boolean
    | {
        include?: ParkingSpotIncludes;
      };
  trucks?:
    | boolean
    | {
        include?: TruckIncludes;
      };
}

export interface ParkingSpotIncludes {
  garageLane?:
    | boolean
    | {
        include?: GarageLaneIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface GarageOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  width?: ORDER_BY_DIRECTION;
  length?: ORDER_BY_DIRECTION;
  isVirtual?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface GarageLaneOrderBy {
  id?: ORDER_BY_DIRECTION;
  width?: ORDER_BY_DIRECTION;
  length?: ORDER_BY_DIRECTION;
  xPosition?: ORDER_BY_DIRECTION;
  yPosition?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  garage?: GarageOrderBy;
}

export interface ParkingSpotOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  length?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  garageLane?: GarageLaneOrderBy;
}

// =====================
// Response Interfaces
// =====================

// Garage responses
export interface GarageGetUniqueResponse extends BaseGetUniqueResponse<Garage> {}
export interface GarageGetManyResponse extends BaseGetManyResponse<Garage> {}
export interface GarageCreateResponse extends BaseCreateResponse<Garage> {}
export interface GarageUpdateResponse extends BaseUpdateResponse<Garage> {}
export interface GarageDeleteResponse extends BaseDeleteResponse {}

// GarageLane responses
export interface GarageLaneGetUniqueResponse extends BaseGetUniqueResponse<GarageLane> {}
export interface GarageLaneGetManyResponse extends BaseGetManyResponse<GarageLane> {}
export interface GarageLaneCreateResponse extends BaseCreateResponse<GarageLane> {}
export interface GarageLaneUpdateResponse extends BaseUpdateResponse<GarageLane> {}
export interface GarageLaneDeleteResponse extends BaseDeleteResponse {}

// ParkingSpot responses
export interface ParkingSpotGetUniqueResponse extends BaseGetUniqueResponse<ParkingSpot> {}
export interface ParkingSpotGetManyResponse extends BaseGetManyResponse<ParkingSpot> {}
export interface ParkingSpotCreateResponse extends BaseCreateResponse<ParkingSpot> {}
export interface ParkingSpotUpdateResponse extends BaseUpdateResponse<ParkingSpot> {}
export interface ParkingSpotDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// Garage batch operations
export interface GarageBatchCreateResponse<T> extends BaseBatchResponse<Garage, T> {}
export interface GarageBatchUpdateResponse<T> extends BaseBatchResponse<Garage, T & { id: string }> {}
export interface GarageBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// GarageLane batch operations
export interface GarageLaneBatchCreateResponse<T> extends BaseBatchResponse<GarageLane, T> {}
export interface GarageLaneBatchUpdateResponse<T> extends BaseBatchResponse<GarageLane, T & { id: string }> {}
export interface GarageLaneBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// ParkingSpot batch operations
export interface ParkingSpotBatchCreateResponse<T> extends BaseBatchResponse<ParkingSpot, T> {}
export interface ParkingSpotBatchUpdateResponse<T> extends BaseBatchResponse<ParkingSpot, T & { id: string }> {}
export interface ParkingSpotBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
