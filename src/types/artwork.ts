// packages/interfaces/src/artwork.ts

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

export interface Artwork extends BaseEntity {
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

export interface ArtworkIncludes {
  file?: boolean | { include?: FileIncludes };
  task?: boolean | { include?: TaskIncludes };
  airbrushing?: boolean | { include?: AirbrushingIncludes };
}

export type ArtworkInclude = ArtworkIncludes;

// =====================
// Order By Types
// =====================

export interface ArtworkOrderBy {
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

export interface ArtworkWhere {
  id?: string;
  fileId?: string;
  status?: 'DRAFT' | 'APPROVED' | 'REPROVED';
  taskId?: string | null;
  airbrushingId?: string | null;
  AND?: ArtworkWhere[];
  OR?: ArtworkWhere[];
  NOT?: ArtworkWhere[];
}

// =====================
// Form Data Types
// =====================

export interface ArtworkCreateFormData {
  fileId: string;
  status?: 'DRAFT' | 'APPROVED' | 'REPROVED';
  taskId?: string | null;
  airbrushingId?: string | null;
}

export interface ArtworkUpdateFormData {
  fileId?: string;
  status?: 'DRAFT' | 'APPROVED' | 'REPROVED';
  taskId?: string | null;
  airbrushingId?: string | null;
}

export interface ArtworkQueryFormData {
  include?: ArtworkInclude;
}

export interface ArtworkGetManyFormData {
  page?: number;
  limit?: number;
  where?: ArtworkWhere;
  orderBy?: ArtworkOrderBy | ArtworkOrderBy[];
  include?: ArtworkInclude;
}

export interface ArtworkBatchCreateFormData {
  artworks: ArtworkCreateFormData[];
}

export interface ArtworkBatchUpdateFormData {
  artworks: { id: string; data: ArtworkUpdateFormData }[];
}

export interface ArtworkBatchDeleteFormData {
  artworkIds: string[];
}

// =====================
// Response Types
// =====================

export type ArtworkGetUniqueResponse = BaseGetUniqueResponse<Artwork>;
export type ArtworkGetManyResponse = BaseGetManyResponse<Artwork>;
export type ArtworkCreateResponse = BaseCreateResponse<Artwork>;
export type ArtworkUpdateResponse = BaseUpdateResponse<Artwork>;
export type ArtworkDeleteResponse = BaseDeleteResponse;
export type ArtworkBatchCreateResponse<T> = BaseBatchResponse<T>;
export type ArtworkBatchUpdateResponse<T> = BaseBatchResponse<T>;
export type ArtworkBatchDeleteResponse = BaseBatchResponse<string>;
