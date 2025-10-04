// packages/interfaces/src/serviceOrder.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION, SERVICE_ORDER_STATUS } from '@constants';
import type { Task, TaskIncludes, TaskOrderBy } from "./task";

// =====================
// ServiceOrder Interface
// =====================

export interface ServiceOrder extends BaseEntity {
  status: SERVICE_ORDER_STATUS | null;
  statusOrder: number; // 1=Pendente, 2=Em Andamento, 3=Finalizado, 4=Cancelado
  description: string;
  taskId: string;
  startedAt: Date | null;
  finishedAt: Date | null;

  // Relations
  task?: Task;
  service?: {
    name: string;
  };
}

// =====================
// Include Types
// =====================

export interface ServiceOrderIncludes {
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
}

// =====================
// OrderBy Types
// =====================

export interface ServiceOrderOrderBy {
  id?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  finishedAt?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Response Interfaces - ServiceOrder
// =====================

export interface ServiceOrderGetUniqueResponse extends BaseGetUniqueResponse<ServiceOrder> {}
export interface ServiceOrderGetManyResponse extends BaseGetManyResponse<ServiceOrder> {}
export interface ServiceOrderCreateResponse extends BaseCreateResponse<ServiceOrder> {}
export interface ServiceOrderUpdateResponse extends BaseUpdateResponse<ServiceOrder> {}
export interface ServiceOrderDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses - ServiceOrder
// =====================

export interface ServiceOrderBatchCreateResponse<T> extends BaseBatchResponse<ServiceOrder, T> {}
export interface ServiceOrderBatchUpdateResponse<T> extends BaseBatchResponse<ServiceOrder, T & { id: string }> {}
export interface ServiceOrderBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
