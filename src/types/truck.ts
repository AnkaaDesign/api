// packages/interfaces/src/truck.ts

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
import type { Task, TaskIncludes, TaskOrderBy, TaskWhere } from './task';
import type { ImplementMeasure, ImplementMeasureIncludes, ImplementMeasureOrderBy, ImplementMeasureWhere } from './implement-measure';
import type { TRUCK_SPOT, TRUCK_CATEGORY, IMPLEMENT_TYPE } from '@constants';

// =====================
// Main Entity Interface
// =====================

export interface Truck extends BaseEntity {
  plate: string | null;
  chassisNumber: string | null;
  vinPlate: string | null;
  category: TRUCK_CATEGORY | null; // Type of truck (mini, vuc, 3/4, toco, truck, semi-trailer, b-double)
  implementType: IMPLEMENT_TYPE | null; // Type of body/implement (dry-cargo, refrigerated, insulated, curtain-side, tank, flatbed)
  spot: TRUCK_SPOT | null; // Parking spot in garage (B1_F1_V1, B1_F2_V1, etc.) — null means patio
  taskId: string;
  backSideMeasureId: string | null;
  leftSideMeasureId: string | null;
  rightSideMeasureId: string | null;

  // Relations (optional, populated based on query)
  task?: Task;
  backSideMeasure?: ImplementMeasure | null;
  leftSideMeasure?: ImplementMeasure | null;
  rightSideMeasure?: ImplementMeasure | null;
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
  backSideMeasure?:
    | boolean
    | {
        include?: ImplementMeasureIncludes;
      };
  leftSideMeasure?:
    | boolean
    | {
        include?: ImplementMeasureIncludes;
      };
  rightSideMeasure?:
    | boolean
    | {
        include?: ImplementMeasureIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface TruckOrderBy {
  id?: ORDER_BY_DIRECTION;
  plate?: ORDER_BY_DIRECTION;
  chassisNumber?: ORDER_BY_DIRECTION;
  vinPlate?: ORDER_BY_DIRECTION;
  category?: ORDER_BY_DIRECTION;
  implementType?: ORDER_BY_DIRECTION;
  spot?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  backSideMeasureId?: ORDER_BY_DIRECTION;
  leftSideMeasureId?: ORDER_BY_DIRECTION;
  rightSideMeasureId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Where Clause Types
// =====================

export interface TruckWhere {
  // Logical operators
  AND?: TruckWhere | TruckWhere[];
  OR?: TruckWhere[];
  NOT?: TruckWhere | TruckWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  taskId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  backSideMeasureId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;
  leftSideMeasureId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;
  rightSideMeasureId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;

  // String fields
  plate?:
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
      }
    | null;
  chassisNumber?:
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
      }
    | null;
  vinPlate?:
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
      }
    | null;

  // Enum fields
  spot?:
    | TRUCK_SPOT
    | {
        equals?: TRUCK_SPOT;
        not?: TRUCK_SPOT;
        in?: TRUCK_SPOT[];
        notIn?: TRUCK_SPOT[];
      }
    | null;
  category?:
    | TRUCK_CATEGORY
    | {
        equals?: TRUCK_CATEGORY;
        not?: TRUCK_CATEGORY;
        in?: TRUCK_CATEGORY[];
        notIn?: TRUCK_CATEGORY[];
      }
    | null;
  implementType?:
    | IMPLEMENT_TYPE
    | {
        equals?: IMPLEMENT_TYPE;
        not?: IMPLEMENT_TYPE;
        in?: IMPLEMENT_TYPE[];
        notIn?: IMPLEMENT_TYPE[];
      }
    | null;

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
  task?: TaskWhere;
  backSideMeasure?: ImplementMeasureWhere | null;
  leftSideMeasure?: ImplementMeasureWhere | null;
  rightSideMeasure?: ImplementMeasureWhere | null;
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
export interface TruckBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
