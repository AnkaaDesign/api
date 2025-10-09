// packages/interfaces/src/observation.ts

import type { ORDER_BY_DIRECTION } from '@constants';
import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { File, FileIncludes } from "./file";
import type { Task, TaskIncludes, TaskOrderBy } from "./task";

// =====================
// Main Entity Interface
// =====================

export interface Observation extends BaseEntity {
  reason: string; // TASK_OBSERVATION_TYPE enum value
  description: string;
  taskId: string;

  // Relations
  files?: File[];
  task?: Task;
}

// =====================
// Include Types
// =====================

export interface ObservationIncludes {
  files?:
    | boolean
    | {
        include?: FileIncludes;
        where?: any;
        orderBy?: any;
        take?: number;
        skip?: number;
      };
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface ObservationOrderBy {
  id?: ORDER_BY_DIRECTION;
  reason?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface ObservationGetUniqueResponse extends BaseGetUniqueResponse<Observation> {}
export interface ObservationGetManyResponse extends BaseGetManyResponse<Observation> {}
export interface ObservationCreateResponse extends BaseCreateResponse<Observation> {}
export interface ObservationUpdateResponse extends BaseUpdateResponse<Observation> {}
export interface ObservationDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface ObservationBatchCreateResponse<T> extends BaseBatchResponse<Observation, T> {}
export interface ObservationBatchUpdateResponse<T> extends BaseBatchResponse<Observation, T & { id: string }> {}
export interface ObservationBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
