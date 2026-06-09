// packages/interfaces/src/airbrushing.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type {
  AIRBRUSHING_STATUS,
  AIRBRUSHING_PAYMENT_STATUS,
  ORDER_BY_DIRECTION,
} from '@constants';
import type { Task, TaskIncludes, TaskOrderBy } from './task';
import type { File, FileIncludes } from './file';
import type { Artwork, ArtworkIncludes } from './artwork';
import type { User, UserIncludes } from './user';

// =====================
// Main Entity Interface
// =====================

export interface Airbrushing extends BaseEntity {
  /** Expected (planned) start date */
  startDate: Date | null;
  /** Expected (planned) finish date */
  finishDate: Date | null;
  /** Actual start timestamp */
  startedAt?: Date | null;
  /** Actual finish timestamp */
  finishedAt?: Date | null;
  price: number | null;
  status: AIRBRUSHING_STATUS; // "Pendente", "Em Andamento", "Finalizado"
  statusOrder: number; // 1=Pendente, 2=Em Andamento, 3=Finalizado
  paymentStatus?: AIRBRUSHING_PAYMENT_STATUS;
  taskId: string;
  painterId?: string | null;
  budgetIds?: string[];
  invoiceIds?: string[];
  receiptIds?: string[];
  reimbursementIds?: string[];
  reimbursementInvoiceIds?: string[];
  artworkIds?: string[];

  // Relations (optional, populated based on query)
  task?: Task;
  painter?: User | null;
  budgets?: File[];
  invoices?: File[];
  receipts?: File[];
  reimbursements?: File[];
  invoiceReimbursements?: File[];
  artworks?: Artwork[];
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
  painter?:
    | boolean
    | {
        include?: UserIncludes;
      };
  budgets?:
    | boolean
    | {
        include?: FileIncludes;
      };
  invoices?:
    | boolean
    | {
        include?: FileIncludes;
      };
  receipts?:
    | boolean
    | {
        include?: FileIncludes;
      };
  reimbursements?:
    | boolean
    | {
        include?: FileIncludes;
      };
  invoiceReimbursements?:
    | boolean
    | {
        include?: FileIncludes;
      };
  artworks?:
    | boolean
    | {
        include?: ArtworkIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface AirbrushingOrderBy {
  id?: ORDER_BY_DIRECTION;
  startDate?: ORDER_BY_DIRECTION;
  finishDate?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  finishedAt?: ORDER_BY_DIRECTION;
  price?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  paymentStatus?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  task?: TaskOrderBy;
  painterId?: ORDER_BY_DIRECTION;
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
export interface AirbrushingBatchUpdateResponse<T> extends BaseBatchResponse<
  Airbrushing,
  T & { id: string }
> {}
export interface AirbrushingBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
