// packages/types/src/holiday.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BatchCreateResponse,
  BatchUpdateResponse,
  BatchDeleteResponse,
} from './common';
import { HOLIDAY_TYPE } from '@constants';

export interface Holiday extends BaseEntity {
  name: string;
  date: Date;
  type: HOLIDAY_TYPE | null;
}

export interface HolidayIncludes {
  _count?: boolean | { select?: Record<string, boolean> };
}

// =====================
// Response Types
// =====================

export interface HolidayGetUniqueResponse extends BaseGetUniqueResponse<Holiday> {}
export interface HolidayGetManyResponse extends BaseGetManyResponse<Holiday> {}
export interface HolidayCreateResponse extends BaseCreateResponse<Holiday> {}
export interface HolidayUpdateResponse extends BaseUpdateResponse<Holiday> {}
export interface HolidayDeleteResponse extends BaseDeleteResponse {}
export interface HolidayBatchCreateResponse<T> extends BatchCreateResponse<T> {}
export interface HolidayBatchUpdateResponse<T> extends BatchUpdateResponse<T> {}
export interface HolidayBatchDeleteResponse extends BatchDeleteResponse {}
