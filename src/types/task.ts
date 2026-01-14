// packages/interfaces/src/task.ts

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
import type { TASK_STATUS, COMMISSION_STATUS } from '@constants';
import type { Sector, SectorIncludes, SectorOrderBy } from './sector';
import type { Customer, CustomerIncludes, CustomerOrderBy } from './customer';
import type { File, FileIncludes } from './file';
import type { Artwork, ArtworkIncludes } from './artwork';
import type { Observation, ObservationIncludes } from './observation';
import type { Paint, PaintIncludes, PaintOrderBy } from './paint';
import type { User, UserIncludes, UserOrderBy } from './user';
import type { ServiceOrder, ServiceOrderIncludes } from './serviceOrder';
import type { TaskPricing } from './task-pricing';
import type { Airbrushing, AirbrushingIncludes } from './airbrushing';
import type { Cut, CutIncludes } from './cut';
import type { Truck, TruckIncludes } from './truck';

// =====================
// Task Interface
// =====================

export interface Task extends BaseEntity {
  name: string;
  status: TASK_STATUS;
  statusOrder: number;
  commission: COMMISSION_STATUS | null;
  serialNumber: string | null;
  details: string | null;
  entryDate: Date | null;
  term: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  forecastDate: Date | null;
  paintId: string | null;
  customerId: string | null;
  invoiceToId: string | null;
  sectorId: string | null;
  negotiatingWith: { name: string; phone: string } | null;
  budgetIds?: string[];
  invoiceIds?: string[];
  receiptIds?: string[];
  reimbursementIds?: string[];
  reimbursementInvoiceIds?: string[];
  baseFileIds?: string[];
  createdById: string | null;
  priority?: string | null;

  // Relations
  sector?: Sector;
  customer?: Customer;
  invoiceTo?: Customer;
  budgets?: File[];
  invoices?: File[];
  receipts?: File[];
  reimbursements?: File[];
  invoiceReimbursements?: File[];
  baseFiles?: File[]; // Files used as base for artwork design
  observation?: Observation;
  generalPainting?: Paint;
  createdBy?: User;
  artworks?: Artwork[];
  logoPaints?: Paint[];
  services?: ServiceOrder[]; // Alias for backward compatibility
  serviceOrders?: ServiceOrder[]; // Prisma field name
  pricing?: TaskPricing; // Task pricing with status and items
  airbrushings?: Airbrushing[];
  cuts?: Cut[];
  truck?: Truck;
  relatedTasks?: Task[];
  relatedTo?: Task[];
}

// =====================
// Include Types
// =====================

export interface TaskIncludes {
  sector?:
    | boolean
    | {
        include?: SectorIncludes;
      };
  customer?:
    | boolean
    | {
        include?: CustomerIncludes;
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
  baseFiles?:
    | boolean
    | {
        include?: FileIncludes;
      };
  observation?:
    | boolean
    | {
        include?: ObservationIncludes;
      };
  generalPainting?:
    | boolean
    | {
        include?: PaintIncludes;
      };
  createdBy?:
    | boolean
    | {
        include?: UserIncludes;
      };
  artworks?:
    | boolean
    | {
        include?: ArtworkIncludes;
      };
  logoPaints?:
    | boolean
    | {
        include?: PaintIncludes;
      };
  services?:
    | boolean
    | {
        include?: ServiceOrderIncludes;
      };
  pricing?: boolean; // Task pricing with status and items
  airbrushings?:
    | boolean
    | {
        include?: AirbrushingIncludes;
      };
  cuts?:
    | boolean
    | {
        include?: CutIncludes;
      };
  truck?:
    | boolean
    | {
        include?: TruckIncludes;
      };
  relatedTasks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  relatedTo?:
    | boolean
    | {
        include?: TaskIncludes;
      };
}

// =====================
// OrderBy Types
// =====================

export interface TaskOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  commission?: ORDER_BY_DIRECTION;
  serialNumber?: ORDER_BY_DIRECTION;
  details?: ORDER_BY_DIRECTION;
  entryDate?: ORDER_BY_DIRECTION;
  term?: ORDER_BY_DIRECTION;
  startedAt?: ORDER_BY_DIRECTION;
  finishedAt?: ORDER_BY_DIRECTION;
  paintId?: ORDER_BY_DIRECTION;
  customerId?: ORDER_BY_DIRECTION;
  sectorId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  sector?: SectorOrderBy;
  customer?: CustomerOrderBy;
  generalPainting?: PaintOrderBy;
  createdBy?: UserOrderBy;
}

// =====================
// Where Types
// =====================

export interface TaskWhere {
  id?: string;
  name?: string;
  status?: TASK_STATUS;
  commission?: COMMISSION_STATUS;
  serialNumber?: string;
  details?: string;
  entryDate?: Date;
  term?: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  paintId?: string | null;
  customerId?: string;
  sectorId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// =====================
// Response Interfaces
// =====================

export interface TaskGetUniqueResponse extends BaseGetUniqueResponse<Task> {}
export interface TaskGetManyResponse extends BaseGetManyResponse<Task> {}
export interface TaskCreateResponse extends BaseCreateResponse<Task> {}
export interface TaskUpdateResponse extends BaseUpdateResponse<Task> {}
export interface TaskDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface TaskBatchCreateResponse<T> extends BaseBatchResponse<Task, T> {}
export interface TaskBatchUpdateResponse<T> extends BaseBatchResponse<Task, T & { id: string }> {}
export interface TaskBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
