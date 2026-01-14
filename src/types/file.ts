// packages/interfaces/src/file.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { Artwork, ArtworkIncludes } from './artwork';
import type { Task, TaskIncludes } from './task';
import type { Customer, CustomerIncludes } from './customer';
import type { Supplier, SupplierIncludes } from './supplier';
import type { Warning, WarningIncludes } from './warning';
import type { Order, OrderIncludes } from './order';
import type { ExternalWithdrawal, ExternalWithdrawalIncludes } from './externalWithdrawal';
import type { Airbrushing, AirbrushingIncludes } from './airbrushing';
import type { Observation, ObservationIncludes } from './observation';
import type { ORDER_BY_DIRECTION } from '@constants';

// =====================
// Main Entity Interface
// =====================

export interface File extends BaseEntity {
  filename: string; // Display name for the file
  originalName: string; // Original filename when uploaded
  mimetype: string;
  path: string; // Server file path for internal use
  size: number;
  thumbnailUrl?: string | null; // URL for PDF thumbnails or image thumbnails

  // Relations
  artworks?: Artwork[];
  tasksArtworks?: Task[];
  customerLogo?: Customer[];
  supplierLogo?: Supplier[];
  observations?: Observation[];
  warning?: Warning[];
  airbrushingReceipts?: Airbrushing[];
  airbrushingInvoices?: Airbrushing[];
  airbrushingArtworks?: Airbrushing[];
  orderBudgets?: Order[];
  orderInvoices?: Order[];
  orderReceipts?: Order[];
  taskBudgets?: Task[];
  taskInvoices?: Task[];
  taskReceipts?: Task[];
  externalWithdrawalBudgets?: ExternalWithdrawal[];
  externalWithdrawalInvoices?: ExternalWithdrawal[];
  externalWithdrawalReceipts?: ExternalWithdrawal[];

  // Index signature for FileWithRelationships compatibility
  [key: string]: unknown;
}

// =====================
// Include Types
// =====================

export interface FileIncludes {
  tasksArtworks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  customerLogo?:
    | boolean
    | {
        include?: CustomerIncludes;
      };
  supplierLogo?:
    | boolean
    | {
        include?: SupplierIncludes;
      };
  observations?:
    | boolean
    | {
        include?: ObservationIncludes;
      };
  warning?:
    | boolean
    | {
        include?: WarningIncludes;
      };
  airbrushingReceipts?:
    | boolean
    | {
        include?: AirbrushingIncludes;
      };
  airbrushingInvoices?:
    | boolean
    | {
        include?: AirbrushingIncludes;
      };
  airbrushingArtworks?:
    | boolean
    | {
        include?: AirbrushingIncludes;
      };
  orderBudgets?:
    | boolean
    | {
        include?: OrderIncludes;
      };
  orderInvoices?:
    | boolean
    | {
        include?: OrderIncludes;
      };
  orderReceipts?:
    | boolean
    | {
        include?: OrderIncludes;
      };
  taskBudgets?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  taskInvoices?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  taskReceipts?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  externalWithdrawalBudgets?:
    | boolean
    | {
        include?: ExternalWithdrawalIncludes;
      };
  externalWithdrawalInvoices?:
    | boolean
    | {
        include?: ExternalWithdrawalIncludes;
      };
  externalWithdrawalReceipts?:
    | boolean
    | {
        include?: ExternalWithdrawalIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface FileOrderBy {
  id?: ORDER_BY_DIRECTION;
  filename?: ORDER_BY_DIRECTION;
  originalName?: ORDER_BY_DIRECTION;
  mimetype?: ORDER_BY_DIRECTION;
  path?: ORDER_BY_DIRECTION;
  size?: ORDER_BY_DIRECTION;
  thumbnailUrl?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface FileGetUniqueResponse extends BaseGetUniqueResponse<File> {}
export interface FileGetManyResponse extends BaseGetManyResponse<File> {}
export interface FileCreateResponse extends BaseCreateResponse<File> {}
export interface FileUpdateResponse extends BaseUpdateResponse<File> {}
export interface FileDeleteResponse extends BaseDeleteResponse {}

// =====================
// Multiple Upload Response
// =====================

export interface FileMultipleUploadResponse extends BaseCreateResponse<File[]> {}

// =====================
// Batch Operation Responses
// =====================

export interface FileBatchCreateResponse<T> extends BaseBatchResponse<File, T> {}
export interface FileBatchUpdateResponse<T> extends BaseBatchResponse<File, T & { id: string }> {}
export interface FileBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
