// packages/interfaces/src/garage.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse, ORDER_BY_DIRECTION } from "./common";
import type { Task, TaskIncludes, TaskOrderBy, TaskWhere } from "./task";
import type { Layout, LayoutIncludes, LayoutOrderBy, LayoutWhere } from "./layout";

// =====================
// Main Entity Interfaces
// =====================

export interface Garage extends BaseEntity {
  name: string;
  width: number;
  length: number;

  // Relations (optional, populated based on query)
  trucks?: Truck[];

  // Count fields (optional, populated when using _count in include)
  _count?: {
    trucks?: number;
  };
}

export interface Truck extends BaseEntity {
  plate: string | null;
  chassisNumber: string | null;
  xPosition: number | null;
  yPosition: number | null;
  taskId: string;
  garageId: string | null;
  backSideLayoutId: string | null;
  leftSideLayoutId: string | null;
  rightSideLayoutId: string | null;

  // Relations (optional, populated based on query)
  task?: Task;
  garage?: Garage | null;
  backSideLayout?: Layout | null;
  leftSideLayout?: Layout | null;
  rightSideLayout?: Layout | null;
}

// =====================
// Include Types
// =====================

export interface GarageIncludes {
  trucks?:
    | boolean
    | {
        include?: TruckIncludes;
      };
  _count?: boolean;
}

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
  backSideLayout?:
    | boolean
    | {
        include?: LayoutIncludes;
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
}

// =====================
// Order By Types
// =====================

export interface GarageOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  width?: ORDER_BY_DIRECTION;
  length?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface TruckOrderBy {
  id?: ORDER_BY_DIRECTION;
  plate?: ORDER_BY_DIRECTION;
  chassisNumber?: ORDER_BY_DIRECTION;
  xPosition?: ORDER_BY_DIRECTION;
  yPosition?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  garageId?: ORDER_BY_DIRECTION;
  backSideLayoutId?: ORDER_BY_DIRECTION;
  leftSideLayoutId?: ORDER_BY_DIRECTION;
  rightSideLayoutId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
  garage?: GarageOrderBy;
}

// =====================
// Where Clause Types
// =====================

export interface GarageWhere {
  // Logical operators
  AND?: GarageWhere | GarageWhere[];
  OR?: GarageWhere[];
  NOT?: GarageWhere | GarageWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // String fields
  name?: string | { equals?: string; not?: string; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive"; in?: string[]; notIn?: string[] };

  // Number fields
  width?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };
  length?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  trucks?: TruckWhere;
}

export interface TruckWhere {
  // Logical operators
  AND?: TruckWhere | TruckWhere[];
  OR?: TruckWhere[];
  NOT?: TruckWhere | TruckWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  taskId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  garageId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  backSideLayoutId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  leftSideLayoutId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  rightSideLayoutId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;

  // String fields
  plate?: string | { equals?: string; not?: string; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive"; in?: string[]; notIn?: string[] } | null;
  chassisNumber?: string | { equals?: string; not?: string; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive"; in?: string[]; notIn?: string[] } | null;

  // Number fields
  xPosition?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] } | null;
  yPosition?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] } | null;

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  task?: TaskWhere;
  garage?: GarageWhere | null;
  backSideLayout?: LayoutWhere | null;
  leftSideLayout?: LayoutWhere | null;
  rightSideLayout?: LayoutWhere | null;
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

// Truck responses
export interface TruckGetUniqueResponse extends BaseGetUniqueResponse<Truck> {}
export interface TruckGetManyResponse extends BaseGetManyResponse<Truck> {}
export interface TruckCreateResponse extends BaseCreateResponse<Truck> {}
export interface TruckUpdateResponse extends BaseUpdateResponse<Truck> {}
export interface TruckDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// Garage batch operations
export interface GarageBatchCreateResponse<T> extends BaseBatchResponse<Garage, T> {}
export interface GarageBatchUpdateResponse<T> extends BaseBatchResponse<Garage, T & { id: string }> {}
export interface GarageBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// Truck batch operations
export interface TruckBatchCreateResponse<T> extends BaseBatchResponse<Truck, T> {}
export interface TruckBatchUpdateResponse<T> extends BaseBatchResponse<Truck, T & { id: string }> {}
export interface TruckBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
