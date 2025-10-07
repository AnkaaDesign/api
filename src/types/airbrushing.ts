// packages/interfaces/src/airbrushing.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { AIRBRUSHING_STATUS, ORDER_BY_DIRECTION } from '@constants';
import type { Task, TaskIncludes, TaskOrderBy } from "./task";
import type { File, FileIncludes } from "./file";

// =====================
// Main Entity Interface
// =====================

export interface Airbrushing extends BaseEntity {
  startDate: Date | null;
  finishDate: Date | null;
  price: number | null;
  status: AIRBRUSHING_STATUS; // "Pendente", "Em Andamento", "Finalizado"
  statusOrder: number; // 1=Pendente, 2=Em Andamento, 3=Finalizado
  taskId: string;
  budgetIds?: string[];
  invoiceIds?: string[];
  receiptIds?: string[];
  reimbursementIds?: string[];
  reimbursementInvoiceIds?: string[];
  artworkIds?: string[];

  // Relations (optional, populated based on query)
  task?: Task;
  budgets?: File[];
  nfes?: File[];
  receipts?: File[];
  reembolsos?: File[];
  nfeReembolsos?: File[];
  artworks?: File[];
}

// =====================
// Include Types
// =====================

export interface AirbrushingIncludes {
  task?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  budgets?:
    | boolean
    | {
        include?: FileIncludes;
      };
  nfes?:
    | boolean
    | {
        include?: FileIncludes;
      };
  receipts?:
    | boolean
    | {
        include?: FileIncludes;
      };
  reembolsos?:
    | boolean
    | {
        include?: FileIncludes;
      };
  nfeReembolsos?:
    | boolean
    | {
        include?: FileIncludes;
      };
  artworks?:
    | boolean
    | {
        include?: FileIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface AirbrushingOrderBy {
  id?: ORDER_BY_DIRECTION;
  startDate?: ORDER_BY_DIRECTION;
  finishDate?: ORDER_BY_DIRECTION;
  price?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
}

// =====================
// Response Interfaces
// =====================

export interface AirbrushingGetUniqueResponse extends BaseGetUniqueResponse<Airbrushing> {}
export interface AirbrushingGetManyResponse extends BaseGetManyResponse<Airbrushing> {}
export interface AirbrushingCreateResponse extends BaseCreateResponse<Airbrushing> {}
export interface AirbrushingUpdateResponse extends BaseUpdateResponse<Airbrushing> {}
export interface AirbrushingDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface AirbrushingBatchCreateResponse<T> extends BaseBatchResponse<Airbrushing, T> {}
export interface AirbrushingBatchUpdateResponse<T> extends BaseBatchResponse<Airbrushing, T & { id: string }> {}
export interface AirbrushingBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
