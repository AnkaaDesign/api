// packages/interfaces/src/task.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse } from "./common";
import type { ORDER_BY_DIRECTION, TASK_STATUS, COMMISSION_STATUS } from '@constants';
import type { Sector, SectorIncludes, SectorOrderBy } from "./sector";
import type { Customer, CustomerIncludes, CustomerOrderBy } from "./customer";
import type { File, FileIncludes } from "./file";
import type { Observation, ObservationIncludes } from "./observation";
import type { Paint, PaintIncludes, PaintOrderBy } from "./paint";
import type { User, UserIncludes, UserOrderBy } from "./user";
import type { ServiceOrder, ServiceOrderIncludes } from "./serviceOrder";
import type { Budget, BudgetIncludes } from "./budget";
import type { Airbrushing, AirbrushingIncludes } from "./airbrushing";
import type { Cut, CutIncludes } from "./cut";
import type { Truck, TruckIncludes } from "./truck";

// =====================
// Task Interface
// =====================

export interface Task extends BaseEntity {
  name: string;
  status: TASK_STATUS;
  statusOrder: number;
  commission: COMMISSION_STATUS;
  serialNumber: string | null;
  chassisNumber?: string | null;
  plate?: string | null;
  details: string | null;
  entryDate: Date | null;
  term: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  paintId: string | null;
  customerId: string | null;
  sectorId: string | null;
  budgetIds?: string[];
  invoiceIds?: string[];
  receiptIds?: string[];
  reimbursementIds?: string[];
  reimbursementInvoiceIds?: string[];
  createdById: string | null;
  priority?: string | null;
  price?: number | null; // Calculated from budget total

  // Relations
  sector?: Sector;
  customer?: Customer;
  budgets?: File[];
  invoices?: File[];
  receipts?: File[];
  reimbursements?: File[];
  invoiceReimbursements?: File[];
  observation?: Observation;
  generalPainting?: Paint;
  createdBy?: User;
  artworks?: File[];
  logoPaints?: Paint[];
  services?: ServiceOrder[];
  budget?: Budget;
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
        include?: FileIncludes;
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
  budget?:
    | boolean
    | {
        include?: BudgetIncludes;
      };
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
  chassisNumber?: ORDER_BY_DIRECTION;
  plate?: ORDER_BY_DIRECTION;
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
export interface TaskBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}
