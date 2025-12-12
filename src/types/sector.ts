// packages/interfaces/src/sector.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION, SECTOR_PRIVILEGES } from '@constants';
import type { User, UserIncludes } from './user';
import type { Task, TaskIncludes } from './task';

// =====================
// Main Entity Interface
// =====================

export interface Sector extends BaseEntity {
  name: string;
  privileges: SECTOR_PRIVILEGES;
  managerId: string | null;

  // Relations
  users?: User[];
  tasks?: Task[];
  /** The user who manages this sector (via Sector.managerId) */
  manager?: User;

  // Count fields (when included)
  _count?: {
    users?: number;
    tasks?: number;
  };
}

// =====================
// Include Types
// =====================

export interface SectorIncludes {
  users?:
    | boolean
    | {
        include?: UserIncludes;
      };
  tasks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  manager?:
    | boolean
    | {
        include?: UserIncludes;
      };
  _count?:
    | boolean
    | {
        select?: {
          users?: boolean;
          tasks?: boolean;
        };
      };
}

// =====================
// Order By Types
// =====================

export interface SectorOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  privileges?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface SectorGetUniqueResponse extends BaseGetUniqueResponse<Sector> {}
export interface SectorGetManyResponse extends BaseGetManyResponse<Sector> {}
export interface SectorCreateResponse extends BaseCreateResponse<Sector> {}
export interface SectorUpdateResponse extends BaseUpdateResponse<Sector> {}
export interface SectorDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

export interface SectorBatchCreateResponse<T> extends BaseBatchResponse<Sector, T> {}
export interface SectorBatchUpdateResponse<T>
  extends BaseBatchResponse<Sector, T & { id: string }> {}
export interface SectorBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// =====================
// Form Data Types
// =====================

export interface SectorCreateFormData {
  name: string;
  privileges: SECTOR_PRIVILEGES;
  managerId?: string | null;
}

export interface SectorUpdateFormData {
  name?: string;
  privileges?: SECTOR_PRIVILEGES;
  managerId?: string | null;
}

export interface SectorGetManyFormData {
  page?: number;
  limit?: number;
  take?: number;
  skip?: number;
  where?: any;
  orderBy?: SectorOrderBy;
  include?: SectorIncludes;
  searchingFor?: string;
  privilege?: SECTOR_PRIVILEGES;
  hasUsers?: boolean;
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
  updatedAt?: {
    gte?: Date;
    lte?: Date;
  };
}

export interface SectorBatchCreateFormData {
  sectors: SectorCreateFormData[];
}

export interface SectorBatchUpdateFormData {
  sectors: {
    id: string;
    data: SectorUpdateFormData;
  }[];
}

export interface SectorBatchDeleteFormData {
  sectorIds: string[];
}
