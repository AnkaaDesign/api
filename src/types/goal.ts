import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
} from './common';
import type { ORDER_BY_DIRECTION, GOAL_METRIC } from '@constants';
import type { Sector, SectorIncludes } from './sector';

// =====================
// Main Entity Interface
// =====================

export interface Goal extends BaseEntity {
  metric: GOAL_METRIC;
  /** Year of the bonus period that ends on day 25 of `month`. */
  year: number;
  /** 1-12. Period runs from day 26 of (month-1) to day 25 of `month` in `year`. */
  month: number;
  targetValue: number;
  sectorId: string | null;

  sector?: Sector | null;
}

// =====================
// Include Types
// =====================

export interface GoalIncludes {
  sector?:
    | boolean
    | {
        include?: SectorIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface GoalOrderBy {
  id?: ORDER_BY_DIRECTION;
  metric?: ORDER_BY_DIRECTION;
  year?: ORDER_BY_DIRECTION;
  month?: ORDER_BY_DIRECTION;
  targetValue?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Response Interfaces
// =====================

export interface GoalGetUniqueResponse extends BaseGetUniqueResponse<Goal> {}
export interface GoalGetManyResponse extends BaseGetManyResponse<Goal> {}
export interface GoalCreateResponse extends BaseCreateResponse<Goal> {}
export interface GoalUpdateResponse extends BaseUpdateResponse<Goal> {}
export interface GoalDeleteResponse extends BaseDeleteResponse {}

export interface GoalBatchCreateResponse<T> extends BaseBatchResponse<Goal, T> {}
export interface GoalBatchUpdateResponse<T> extends BaseBatchResponse<Goal, T & { id: string }> {}
export interface GoalBatchDeleteResponse
  extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// =====================
// Form Data Types
// =====================

export interface GoalCreateFormData {
  metric: GOAL_METRIC;
  year: number;
  month: number;
  targetValue: number;
  sectorId?: string | null;
}

export interface GoalUpdateFormData {
  targetValue?: number;
}

export interface GoalGetManyFormData {
  page?: number;
  limit?: number;
  take?: number;
  skip?: number;
  where?: any;
  orderBy?: GoalOrderBy;
  include?: GoalIncludes;
  metric?: GOAL_METRIC | GOAL_METRIC[];
  year?: number;
  month?: number;
  sectorId?: string | null;
}

export interface GoalBatchCreateFormData {
  goals: GoalCreateFormData[];
}

export interface GoalBatchUpdateFormData {
  goals: {
    id: string;
    data: GoalUpdateFormData;
  }[];
}

export interface GoalBatchDeleteFormData {
  goalIds: string[];
}

export interface GoalUpsertYearFormData {
  metric: GOAL_METRIC;
  year: number;
  sectorId?: string | null;
  values: Array<{
    month: number;
    targetValue: number | null;
  }>;
}

export interface GoalUpsertYearResponse {
  success: boolean;
  message: string;
  data: {
    created: Goal[];
    updated: Goal[];
    deleted: string[];
  };
}

export interface GoalDeleteRowFormData {
  metric: GOAL_METRIC;
  year: number;
  sectorId?: string | null;
}
