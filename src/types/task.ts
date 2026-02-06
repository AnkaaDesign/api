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
import type { Representative, RepresentativeResponse } from './representative';

// =====================
// Task Interface
// =====================

export interface Task extends BaseEntity {
  name: string;
  status: TASK_STATUS;
  statusOrder: number;
  commission: COMMISSION_STATUS | null;
  commissionOrder: number;
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
  // negotiatingWith: { name: string; phone: string } | null; // DEPRECATED - Migrated to Representatives
  budgetIds?: string[];
  invoiceIds?: string[];
  receiptIds?: string[];
  reimbursementIds?: string[];
  reimbursementInvoiceIds?: string[];
  baseFileIds?: string[];
  createdById: string | null;

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
  serviceOrders?: ServiceOrder[]; // Prisma relation field
  pricingId?: string | null; // Foreign key to TaskPricing
  pricing?: TaskPricing; // Task pricing (one-to-many: one pricing can be shared across multiple tasks)
  airbrushings?: Airbrushing[];
  cuts?: Cut[];
  truck?: Truck;
  relatedTasks?: Task[];
  relatedTo?: Task[];
  representatives?: Representative[] | RepresentativeResponse[];
}

// =====================
// Select Types for Granular Field Control
// =====================

/**
 * Basic task fields that can be selected
 */
export interface TaskSelectFields {
  id?: boolean;
  name?: boolean;
  status?: boolean;
  statusOrder?: boolean;
  commission?: boolean;
  serialNumber?: boolean;
  details?: boolean;
  entryDate?: boolean;
  term?: boolean;
  startedAt?: boolean;
  finishedAt?: boolean;
  forecastDate?: boolean;
  paintId?: boolean;
  customerId?: boolean;
  invoiceToId?: boolean;
  sectorId?: boolean;
  createdById?: boolean;
  pricingId?: boolean;
  createdAt?: boolean;
  updatedAt?: boolean;
}

/**
 * Task select configuration - allows selecting specific fields or including all with relations
 */
export type TaskSelect = TaskSelectFields & {
  sector?: boolean | { select?: { id?: boolean; name?: boolean } };
  customer?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
  invoiceTo?: boolean | { select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean } };
  budgets?:
    | boolean
    | {
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  invoices?:
    | boolean
    | {
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  receipts?:
    | boolean
    | {
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  reimbursements?:
    | boolean
    | {
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  invoiceReimbursements?:
    | boolean
    | {
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  baseFiles?:
    | boolean
    | {
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  observation?: boolean | { select?: { id?: boolean; description?: boolean } };
  generalPainting?: boolean | { select?: { id?: boolean; name?: boolean; code?: boolean } };
  createdBy?: boolean | { select?: { id?: boolean; name?: boolean; email?: boolean } };
  artworks?: boolean | { select?: { id?: boolean; fileId?: boolean; status?: boolean } };
  logoPaints?: boolean | { select?: { id?: boolean; name?: boolean; code?: boolean } };
  serviceOrders?:
    | boolean
    | {
        select?: {
          id?: boolean;
          description?: boolean;
          status?: boolean;
          type?: boolean;
          assignedToId?: boolean;
        };
      };
  pricing?:
    | boolean
    | {
        select?: {
          id?: boolean;
          total?: boolean;
          subtotal?: boolean;
          status?: boolean;
          expiresAt?: boolean;
          budgetNumber?: boolean;
        };
      };
  airbrushings?:
    | boolean
    | {
        select?: {
          id?: boolean;
          status?: boolean;
          price?: boolean;
          startDate?: boolean;
          finishDate?: boolean;
        };
      };
  cuts?:
    | boolean
    | { select?: { id?: boolean; type?: boolean; status?: boolean; origin?: boolean } };
  truck?:
    | boolean
    | {
        select?: {
          id?: boolean;
          plate?: boolean;
          chassisNumber?: boolean;
          spot?: boolean;
          category?: boolean;
        };
      };
  relatedTasks?: boolean | { select?: TaskSelect };
  relatedTo?: boolean | { select?: TaskSelect };
  representatives?:
    | boolean
    | {
        select?: { id?: boolean; name?: boolean; phone?: boolean; email?: boolean; role?: boolean };
      };
};

// =====================
// Predefined Select Patterns for Common Use Cases
// =====================

/**
 * Minimal task data for table/list views - only essential fields
 * Optimized for performance with minimal data transfer
 */
export const TASK_SELECT_MINIMAL: TaskSelect = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  serialNumber: true,
  term: true,
  forecastDate: true,
  customerId: true,
  sectorId: true,
  createdAt: true,
  updatedAt: true,
  // Essential relations with minimal fields
  sector: {
    select: { id: true, name: true },
  },
  customer: {
    select: { id: true, fantasyName: true },
  },
};

/**
 * Extended task data for card/grid views - includes more details
 */
export const TASK_SELECT_CARD: TaskSelect = {
  ...TASK_SELECT_MINIMAL,
  details: true,
  entryDate: true,
  startedAt: true,
  finishedAt: true,
  commission: true,
  createdById: true,
  // Additional relations
  createdBy: {
    select: { id: true, name: true },
  },
  truck: {
    select: { id: true, plate: true, spot: true },
  },
  // Count-based info (handled via separate queries typically)
  serviceOrders: {
    select: { id: true, status: true, type: true },
  },
};

/**
 * Complete task data for detail views - includes all relations
 * Use this for task detail pages where all information is needed
 */
export const TASK_SELECT_DETAILED: TaskSelect = {
  id: true,
  name: true,
  status: true,
  statusOrder: true,
  commission: true,
  serialNumber: true,
  details: true,
  entryDate: true,
  term: true,
  startedAt: true,
  finishedAt: true,
  forecastDate: true,
  paintId: true,
  customerId: true,
  invoiceToId: true,
  sectorId: true,
  createdById: true,
  pricingId: true,
  createdAt: true,
  updatedAt: true,
  // All relations with selected fields
  sector: {
    select: { id: true, name: true },
  },
  customer: {
    select: { id: true, fantasyName: true, cnpj: true },
  },
  invoiceTo: {
    select: { id: true, fantasyName: true, cnpj: true },
  },
  budgets: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  invoices: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  receipts: {
    select: {
      id: true,
      filename: true,
      path: true,
      mimetype: true,
      size: true,
      thumbnailUrl: true,
    },
  },
  observation: {
    select: { id: true, description: true },
  },
  generalPainting: {
    select: { id: true, name: true, code: true },
  },
  createdBy: {
    select: { id: true, name: true, email: true },
  },
  artworks: {
    select: {
      id: true,
      fileId: true,
      status: true,
    },
  },
  logoPaints: {
    select: { id: true, name: true, code: true },
  },
  serviceOrders: {
    select: {
      id: true,
      description: true,
      status: true,
      type: true,
      assignedToId: true,
    },
  },
  pricing: {
    select: {
      id: true,
      total: true,
      subtotal: true,
      status: true,
      expiresAt: true,
      budgetNumber: true,
    },
  },
  airbrushings: {
    select: {
      id: true,
      status: true,
      price: true,
      startDate: true,
      finishDate: true,
    },
  },
  cuts: {
    select: {
      id: true,
      type: true,
      status: true,
      origin: true,
    },
  },
  truck: {
    select: {
      id: true,
      plate: true,
      chassisNumber: true,
      spot: true,
      category: true,
    },
  },
  representatives: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
    },
  },
};

// =====================
// Type Helpers for Select Results
// =====================

/**
 * Helper type to infer the result type based on select configuration
 * This ensures type safety when using custom select patterns
 */
export type TaskWithSelect<S extends TaskSelect> = {
  [K in keyof S]: K extends keyof Task
    ? S[K] extends true
      ? Task[K]
      : S[K] extends { select: any }
        ? any // Nested selection - type would need deep inference
        : never
    : never;
};

/**
 * Minimal task type for table views (based on TASK_SELECT_MINIMAL)
 */
export interface TaskMinimal {
  id: string;
  name: string;
  status: TASK_STATUS;
  statusOrder: number;
  serialNumber: string | null;
  term: Date | null;
  forecastDate: Date | null;
  customerId: string | null;
  sectorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  sector?: { id: string; name: string } | null;
  customer?: { id: string; fantasyName: string } | null;
}

/**
 * Card task type for grid/card views (based on TASK_SELECT_CARD)
 */
export interface TaskCard extends TaskMinimal {
  details: string | null;
  entryDate: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  commission: COMMISSION_STATUS | null;
  createdById: string | null;
  createdBy?: { id: string; name: string } | null;
  truck?: { id: string; plate: string | null; spot: string | null } | null;
  serviceOrders?: Array<{ id: string; status: string; type: string }>;
}

/**
 * Detailed task type for detail views (based on TASK_SELECT_DETAILED)
 */
export interface TaskDetailed extends BaseEntity {
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
  createdById: string | null;
  pricingId: string | null;

  sector?: { id: string; name: string } | null;
  customer?: { id: string; fantasyName: string; cnpj: string | null } | null;
  invoiceTo?: { id: string; fantasyName: string; cnpj: string | null } | null;
  budgets?: Array<{
    id: string;
    filename: string;
    path: string;
    mimetype: string;
    size: number;
    thumbnailUrl: string | null;
  }>;
  invoices?: Array<{
    id: string;
    filename: string;
    path: string;
    mimetype: string;
    size: number;
    thumbnailUrl: string | null;
  }>;
  receipts?: Array<{
    id: string;
    filename: string;
    path: string;
    mimetype: string;
    size: number;
    thumbnailUrl: string | null;
  }>;
  observation?: { id: string; description: string } | null;
  generalPainting?: { id: string; name: string; code: string | null } | null;
  createdBy?: { id: string; name: string; email: string } | null;
  artworks?: Array<{ id: string; fileId: string; status: string }>;
  logoPaints?: Array<{ id: string; name: string; code: string | null }>;
  serviceOrders?: Array<{
    id: string;
    description: string;
    status: string;
    type: string;
    assignedToId: string | null;
  }>;
  pricing?: {
    id: string;
    total: number;
    subtotal: number;
    status: string;
    expiresAt: Date;
    budgetNumber: number;
  } | null;
  airbrushings?: Array<{
    id: string;
    status: string;
    price: number | null;
    startDate: Date | null;
    finishDate: Date | null;
  }>;
  cuts?: Array<{ id: string; type: string; status: string; origin: string }>;
  truck?: {
    id: string;
    plate: string | null;
    chassisNumber: string | null;
    spot: string | null;
    category: string | null;
  } | null;
  representatives?: Array<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    role: string;
  }>;
}

// =====================
// Include Types (Backward Compatibility)
// =====================

export interface TaskIncludes {
  sector?:
    | boolean
    | {
        include?: SectorIncludes;
        select?: { id?: boolean; name?: boolean };
      };
  customer?:
    | boolean
    | {
        include?: CustomerIncludes;
        select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean };
      };
  invoiceTo?:
    | boolean
    | {
        include?: CustomerIncludes;
        select?: { id?: boolean; fantasyName?: boolean; cnpj?: boolean };
      };
  budgets?:
    | boolean
    | {
        include?: FileIncludes;
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  invoices?:
    | boolean
    | {
        include?: FileIncludes;
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
      };
  receipts?:
    | boolean
    | {
        include?: FileIncludes;
        select?: {
          id?: boolean;
          filename?: boolean;
          path?: boolean;
          mimetype?: boolean;
          size?: boolean;
          thumbnailUrl?: boolean;
        };
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
  serviceOrders?:
    | boolean
    | {
        include?: ServiceOrderIncludes;
      };
  pricing?:
    | boolean
    | { include?: { items?: boolean; layoutFile?: boolean; customerSignature?: boolean } }; // Task pricing (one-to-many: one pricing can be shared across multiple tasks)
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
  representatives?:
    | boolean
    | {
        include?: {
          customer?: boolean;
        };
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
// Typed Response Interfaces for Select Patterns
// =====================

export interface TaskMinimalGetManyResponse extends BaseGetManyResponse<TaskMinimal> {}
export interface TaskCardGetManyResponse extends BaseGetManyResponse<TaskCard> {}
export interface TaskDetailedGetUniqueResponse extends BaseGetUniqueResponse<TaskDetailed> {}

// =====================
// Batch Operation Responses
// =====================

export interface TaskBatchCreateResponse<T> extends BaseBatchResponse<Task, T> {}
export interface TaskBatchUpdateResponse<T> extends BaseBatchResponse<Task, T & { id: string }> {}
export interface TaskBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
