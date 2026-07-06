// packages/interfaces/src/layout.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { File, FileIncludes } from './file';
import type { Task, TaskIncludes } from './task';
import type { Airbrushing, AirbrushingIncludes } from './airbrushing';
import type { ORDER_BY_DIRECTION } from '@constants';

// =====================
// Main Entity Interface
// =====================

export interface Layout extends BaseEntity {
  fileId: string;
  status: 'DRAFT' | 'APPROVED' | 'REPROVED';
  taskId?: string | null;
  airbrushingId?: string | null;

  // Relations
  file?: File;
  task?: Task | null;
  airbrushing?: Airbrushing | null;

  // Index signature for compatibility
  [key: string]: unknown;
}

// =====================
// Include Types
// =====================

export interface LayoutIncludes {
  file?: boolean | { include?: FileIncludes };
  task?: boolean | { include?: TaskIncludes };
  airbrushing?: boolean | { include?: AirbrushingIncludes };
}

export type LayoutInclude = LayoutIncludes;

// =====================
// Order By Types
// =====================

export interface LayoutOrderBy {
  id?: ORDER_BY_DIRECTION;
  fileId?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  taskId?: ORDER_BY_DIRECTION;
  airbrushingId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Where Types
// =====================

export interface LayoutWhere {
  id?: string;
  fileId?: string;
  status?: 'DRAFT' | 'APPROVED' | 'REPROVED';
  taskId?: string | null;
  airbrushingId?: string | null;
  AND?: LayoutWhere[];
  OR?: LayoutWhere[];
  NOT?: LayoutWhere[];
}

// =====================
// Form Data Types
// =====================

export interface LayoutCreateFormData {
  fileId: string;
  status?: 'DRAFT' | 'APPROVED' | 'REPROVED';
  taskId?: string | null;
  airbrushingId?: string | null;
}

export interface LayoutUpdateFormData {
  fileId?: string;
  status?: 'DRAFT' | 'APPROVED' | 'REPROVED';
  taskId?: string | null;
  airbrushingId?: string | null;
}

export interface LayoutQueryFormData {
  include?: LayoutInclude;
}

export interface LayoutGetManyFormData {
  page?: number;
  limit?: number;
  where?: LayoutWhere;
  orderBy?: LayoutOrderBy | LayoutOrderBy[];
  include?: LayoutInclude;
}

export interface LayoutBatchCreateFormData {
  layouts: LayoutCreateFormData[];
}

export interface LayoutBatchUpdateFormData {
  layouts: { id: string; data: LayoutUpdateFormData }[];
}

export interface LayoutBatchDeleteFormData {
  layoutIds: string[];
}

// =====================
// Response Types
// =====================

export type LayoutGetUniqueResponse = BaseGetUniqueResponse<Layout>;
export type LayoutGetManyResponse = BaseGetManyResponse<Layout>;
export type LayoutCreateResponse = BaseCreateResponse<Layout>;
export type LayoutUpdateResponse = BaseUpdateResponse<Layout>;
export type LayoutDeleteResponse = BaseDeleteResponse;
export type LayoutBatchCreateResponse<T> = BaseBatchResponse<T>;
export type LayoutBatchUpdateResponse<T> = BaseBatchResponse<T>;
export type LayoutBatchDeleteResponse = BaseBatchResponse<string>;
