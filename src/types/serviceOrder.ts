// packages/interfaces/src/serviceOrder.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION, SERVICE_ORDER_STATUS, SERVICE_ORDER_TYPE } from '@constants';
import type { Task, TaskIncludes, TaskOrderBy } from './task';

// =====================
// ServiceOrder Interface
// =====================

export interface ServiceOrder extends BaseEntity {
  status: SERVICE_ORDER_STATUS | null;
  type: SERVICE_ORDER_TYPE | null;
  statusOrder: number; // 1=Pendente, 2=Em Andamento, 3=Aguardando Aprovação, 4=Concluído, 5=Cancelado
  description: string;
  observation: string | null;
  position: number; // User-defined order within each type group
  taskId: string;
  assignedToId: string | null;
  startedById: string | null;
  approvedById: string | null;
  completedById: string | null;
  startedAt: Date | null;
  approvedAt: Date | null;
  finishedAt: Date | null;

  // Relations
  task?: Task;
  assignedTo?: {
    id: string;
    name: string;
    email: string;
  };
  startedBy?: {
    id: string;
    name: string;
    email: string;
  };
  approvedBy?: {
    id: string;
    name: string;
    email: string;
  };
  completedBy?: {
    id: string;
    name: string;
    email: string;
  };
  createdBy?: {
    id: string;
    name: string;
    email: string;
  };
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
  assignedTo?: boolean;
  createdBy?: boolean;
  startedBy?: boolean;
  approvedBy?: boolean;
  completedBy?: boolean;
}

// =====================
// OrderBy Types
// =====================

export interface ServiceOrderOrderBy {
  id?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  observation?: ORDER_BY_DIRECTION;
  position?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  assignedToId?: ORDER_BY_DIRECTION;
  startedById?: ORDER_BY_DIRECTION;
  approvedById?: ORDER_BY_DIRECTION;
  completedById?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  approvedAt?: ORDER_BY_DIRECTION;
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
export interface ServiceOrderBatchUpdateResponse<T> extends BaseBatchResponse<
  ServiceOrder,
  T & { id: string }
> {}
export interface ServiceOrderBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
