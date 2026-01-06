// packages/interfaces/src/maintenance.ts

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
import {
  MAINTENANCE_STATUS,
  SCHEDULE_FREQUENCY,
  WEEK_DAY,
  MONTH,
  RESCHEDULE_REASON,
} from '@constants';
import type { Item, ItemIncludes, ItemOrderBy } from './item';
import type {
  WeeklyScheduleConfig,
  MonthlyScheduleConfig,
  YearlyScheduleConfig,
  WeeklyScheduleConfigIncludes,
  MonthlyScheduleConfigIncludes,
  YearlyScheduleConfigIncludes,
} from './ppe';

// =====================
// Main Entity Interfaces
// =====================

export interface MaintenanceItem extends BaseEntity {
  maintenanceId: string;
  itemId: string;
  quantity: number;

  // Relations
  maintenance?: Maintenance;
  item?: Item;
}

export interface Maintenance extends BaseEntity {
  name: string;
  description: string | null;
  status: MAINTENANCE_STATUS;
  statusOrder: number;
  itemId: string;

  // Time tracking fields
  startedAt: Date | null;
  finishedAt: Date | null;
  timeTaken: number | null; // Duration in seconds
  lastRun: Date | null;

  // Link to the schedule that created this maintenance (if any)
  maintenanceScheduleId: string | null;
  scheduledFor: Date | null; // When this maintenance is scheduled for

  // Legacy auto-creation field (kept for backward compatibility)
  originalMaintenanceId: string | null;

  // Relations
  item?: Item;
  itemsNeeded?: MaintenanceItem[];
  maintenanceSchedule?: MaintenanceSchedule; // Link to the schedule

  // Legacy relations (kept for backward compatibility)
  originalMaintenance?: Maintenance;
}

export interface MaintenanceSchedule extends BaseEntity {
  name: string;
  description: string | null;
  status: string; // MaintenanceSchedule status (PENDING, FINISHED, CANCELLED)
  statusOrder: number;
  itemId: string | null;
  frequency: SCHEDULE_FREQUENCY;
  frequencyCount: number;
  isActive: boolean;

  // Specific scheduling fields
  specificDate: Date | null;
  dayOfMonth: number | null;
  dayOfWeek: WEEK_DAY | null;
  month: MONTH | null;
  customMonths: MONTH[];

  // Reschedule fields
  rescheduleCount: number;
  originalDate: Date | null;
  lastRescheduleDate: Date | null;
  rescheduleReason: RESCHEDULE_REASON | null;

  // Schedule configuration relations
  weeklyConfigId: string | null;
  monthlyConfigId: string | null;
  yearlyConfigId: string | null;

  nextRun: Date | null;
  lastRun: Date | null;
  finishedAt: Date | null;

  // Auto-creation tracking
  lastRunId: string | null;
  originalScheduleId: string | null;

  // Configuration for items needed (stored as JSON)
  maintenanceItemsConfig: any;

  // Relations
  item?: Item;
  category?: any; // ItemCategory
  maintenances?: Maintenance[]; // Maintenance instances created from this schedule
  weeklyConfig?: WeeklyScheduleConfig;
  monthlyConfig?: MonthlyScheduleConfig;
  yearlyConfig?: YearlyScheduleConfig;

  // Auto-creation relations
  lastRunSchedule?: MaintenanceSchedule;
  triggeredSchedules?: MaintenanceSchedule[];
}

// =====================
// Include Types
// =====================

export interface MaintenanceIncludes {
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  itemsNeeded?:
    | boolean
    | {
        include?: MaintenanceItemIncludes;
      };
  maintenanceSchedule?:
    | boolean
    | {
        include?: MaintenanceScheduleIncludes;
      };
  originalMaintenance?:
    | boolean
    | {
        include?: MaintenanceIncludes;
      };
  _count?: boolean;
}

export interface MaintenanceScheduleIncludes {
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  maintenances?:
    | boolean
    | {
        include?: MaintenanceIncludes;
      };
  weeklyConfig?:
    | boolean
    | {
        include?: WeeklyScheduleConfigIncludes;
      };
  monthlyConfig?:
    | boolean
    | {
        include?: MonthlyScheduleConfigIncludes;
      };
  yearlyConfig?:
    | boolean
    | {
        include?: YearlyScheduleConfigIncludes;
      };
  lastRunSchedule?:
    | boolean
    | {
        include?: MaintenanceScheduleIncludes;
      };
  triggeredSchedules?:
    | boolean
    | {
        include?: MaintenanceScheduleIncludes;
      };
  _count?: boolean;
}

export interface MaintenanceItemIncludes {
  maintenance?:
    | boolean
    | {
        include?: MaintenanceIncludes;
      };
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  _count?: boolean;
}

// =====================
// Order By Types
// =====================

export interface MaintenanceOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  frequency?: ORDER_BY_DIRECTION;
  frequencyCount?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  specificDate?: ORDER_BY_DIRECTION;
  dayOfMonth?: ORDER_BY_DIRECTION;
  dayOfWeek?: ORDER_BY_DIRECTION;
  month?: ORDER_BY_DIRECTION;
  rescheduleCount?: ORDER_BY_DIRECTION;
  originalDate?: ORDER_BY_DIRECTION;
  lastRescheduleDate?: ORDER_BY_DIRECTION;
  nextRun?: ORDER_BY_DIRECTION;
  lastRun?: ORDER_BY_DIRECTION;
  finishedAt?: ORDER_BY_DIRECTION;
  originalMaintenanceId?: ORDER_BY_DIRECTION;
  lastRunId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  item?: ItemOrderBy;
  originalMaintenance?: MaintenanceOrderBy;
  lastRunMaintenance?: MaintenanceOrderBy;
}

export interface MaintenanceItemOrderBy {
  id?: ORDER_BY_DIRECTION;
  quantity?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  maintenance?: MaintenanceOrderBy;
  item?: ItemOrderBy;
}

// =====================
// Where Types
// =====================

export interface MaintenanceWhere {
  // Logical operators
  AND?: MaintenanceWhere | MaintenanceWhere[];
  OR?: MaintenanceWhere[];
  NOT?: MaintenanceWhere | MaintenanceWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // String fields
  name?:
    | string
    | {
        equals?: string;
        not?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
        in?: string[];
        notIn?: string[];
      };
  description?:
    | string
    | {
        equals?: string;
        not?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
        in?: string[];
        notIn?: string[];
      }
    | null;

  // Enum fields
  status?:
    | MAINTENANCE_STATUS
    | {
        equals?: MAINTENANCE_STATUS;
        not?: MAINTENANCE_STATUS;
        in?: MAINTENANCE_STATUS[];
        notIn?: MAINTENANCE_STATUS[];
      };

  // Number fields
  statusOrder?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      };
  timeTaken?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      }
    | null;

  // Date fields
  startedAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  finishedAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  lastRun?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  scheduledFor?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  createdAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };
  updatedAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };

  // Foreign key fields
  itemId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  maintenanceScheduleId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;
  originalMaintenanceId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;

  // Relations
  item?: any; // ItemWhere
  itemsNeeded?: any; // MaintenanceItemWhere
  maintenanceSchedule?: any; // MaintenanceScheduleWhere
  originalMaintenance?: MaintenanceWhere;
}

export interface MaintenanceScheduleWhere {
  // Logical operators
  AND?: MaintenanceScheduleWhere | MaintenanceScheduleWhere[];
  OR?: MaintenanceScheduleWhere[];
  NOT?: MaintenanceScheduleWhere | MaintenanceScheduleWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // String fields
  name?:
    | string
    | {
        equals?: string;
        not?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
        in?: string[];
        notIn?: string[];
      };
  description?:
    | string
    | {
        equals?: string;
        not?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
        in?: string[];
        notIn?: string[];
      }
    | null;
  status?:
    | string
    | {
        equals?: string;
        not?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        mode?: 'default' | 'insensitive';
        in?: string[];
        notIn?: string[];
      };

  // Enum fields
  frequency?:
    | SCHEDULE_FREQUENCY
    | {
        equals?: SCHEDULE_FREQUENCY;
        not?: SCHEDULE_FREQUENCY;
        in?: SCHEDULE_FREQUENCY[];
        notIn?: SCHEDULE_FREQUENCY[];
      };
  dayOfWeek?:
    | WEEK_DAY
    | { equals?: WEEK_DAY; not?: WEEK_DAY; in?: WEEK_DAY[]; notIn?: WEEK_DAY[] }
    | null;
  month?: MONTH | { equals?: MONTH; not?: MONTH; in?: MONTH[]; notIn?: MONTH[] } | null;
  rescheduleReason?:
    | RESCHEDULE_REASON
    | {
        equals?: RESCHEDULE_REASON;
        not?: RESCHEDULE_REASON;
        in?: RESCHEDULE_REASON[];
        notIn?: RESCHEDULE_REASON[];
      }
    | null;

  // Number fields
  statusOrder?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      };
  frequencyCount?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      };
  dayOfMonth?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      }
    | null;
  rescheduleCount?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      };

  // Boolean fields
  isActive?: boolean | { equals?: boolean; not?: boolean };

  // Date fields
  specificDate?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  originalDate?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  lastRescheduleDate?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  nextRun?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  lastRun?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  finishedAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      }
    | null;
  createdAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };
  updatedAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };

  // Foreign key fields
  itemId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  weeklyConfigId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;
  monthlyConfigId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;
  yearlyConfigId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;
  lastRunId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  originalScheduleId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;

  // Relations
  item?: any; // ItemWhere
  maintenances?: MaintenanceWhere;
  weeklyConfig?: any; // WeeklyScheduleConfigWhere
  monthlyConfig?: any; // MonthlyScheduleConfigWhere
  yearlyConfig?: any; // YearlyScheduleConfigWhere
  lastRunSchedule?: MaintenanceScheduleWhere;
  triggeredSchedules?: MaintenanceScheduleWhere;
}

export interface MaintenanceItemWhere {
  // Logical operators
  AND?: MaintenanceItemWhere | MaintenanceItemWhere[];
  OR?: MaintenanceItemWhere[];
  NOT?: MaintenanceItemWhere | MaintenanceItemWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // Number fields
  quantity?:
    | number
    | {
        equals?: number;
        not?: number;
        lt?: number;
        lte?: number;
        gt?: number;
        gte?: number;
        in?: number[];
        notIn?: number[];
      };

  // Date fields
  createdAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };
  updatedAt?:
    | Date
    | {
        equals?: Date;
        not?: Date;
        lt?: Date;
        lte?: Date;
        gt?: Date;
        gte?: Date;
        in?: Date[];
        notIn?: Date[];
      };

  // Foreign key fields
  maintenanceId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  itemId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // Relations
  maintenance?: MaintenanceWhere;
  item?: any; // ItemWhere
}

// =====================
// Parameter Types
// =====================

export interface MaintenanceGetManyParams {
  where?: MaintenanceWhere;
  include?: MaintenanceIncludes;
  orderBy?: MaintenanceOrderBy | MaintenanceOrderBy[];
  skip?: number;
  take?: number;
  searchingFor?: string;
}

export interface MaintenanceGetByIdParams {
  include?: MaintenanceIncludes;
}

export interface MaintenanceScheduleGetManyParams {
  where?: MaintenanceScheduleWhere;
  include?: MaintenanceScheduleIncludes;
  orderBy?: MaintenanceOrderBy | MaintenanceOrderBy[];
  skip?: number;
  take?: number;
  searchingFor?: string;
}

export interface MaintenanceScheduleGetByIdParams {
  include?: MaintenanceScheduleIncludes;
}

export interface MaintenanceItemGetManyParams {
  where?: MaintenanceItemWhere;
  include?: MaintenanceItemIncludes;
  orderBy?: MaintenanceItemOrderBy | MaintenanceItemOrderBy[];
  skip?: number;
  take?: number;
  searchingFor?: string;
}

export interface MaintenanceItemGetByIdParams {
  include?: MaintenanceItemIncludes;
}

// =====================
// Response Interfaces
// =====================

// Maintenance responses
export interface MaintenanceGetUniqueResponse extends BaseGetUniqueResponse<Maintenance> {}
export interface MaintenanceGetManyResponse extends BaseGetManyResponse<Maintenance> {}
export interface MaintenanceCreateResponse extends BaseCreateResponse<Maintenance> {}
export interface MaintenanceUpdateResponse extends BaseUpdateResponse<Maintenance> {}
export interface MaintenanceDeleteResponse extends BaseDeleteResponse {}

// MaintenanceSchedule responses
export interface MaintenanceScheduleGetUniqueResponse extends BaseGetUniqueResponse<MaintenanceSchedule> {}
export interface MaintenanceScheduleGetManyResponse extends BaseGetManyResponse<MaintenanceSchedule> {}
export interface MaintenanceScheduleCreateResponse extends BaseCreateResponse<MaintenanceSchedule> {}
export interface MaintenanceScheduleUpdateResponse extends BaseUpdateResponse<MaintenanceSchedule> {}
export interface MaintenanceScheduleDeleteResponse extends BaseDeleteResponse {}

// MaintenanceItem responses
export interface MaintenanceItemGetUniqueResponse extends BaseGetUniqueResponse<MaintenanceItem> {}
export interface MaintenanceItemGetManyResponse extends BaseGetManyResponse<MaintenanceItem> {}
export interface MaintenanceItemCreateResponse extends BaseCreateResponse<MaintenanceItem> {}
export interface MaintenanceItemUpdateResponse extends BaseUpdateResponse<MaintenanceItem> {}
export interface MaintenanceItemDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// Maintenance batch operations
export interface MaintenanceBatchCreateResponse<T> extends BaseBatchResponse<Maintenance, T> {}
export interface MaintenanceBatchUpdateResponse<T> extends BaseBatchResponse<
  Maintenance,
  T & { id: string }
> {}
export interface MaintenanceBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// MaintenanceSchedule batch operations
export interface MaintenanceScheduleBatchCreateResponse<T> extends BaseBatchResponse<
  MaintenanceSchedule,
  T
> {}
export interface MaintenanceScheduleBatchUpdateResponse<T> extends BaseBatchResponse<
  MaintenanceSchedule,
  T & { id: string }
> {}
export interface MaintenanceScheduleBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// MaintenanceItem batch operations
export interface MaintenanceItemBatchCreateResponse<T> extends BaseBatchResponse<
  MaintenanceItem,
  T
> {}
export interface MaintenanceItemBatchUpdateResponse<T> extends BaseBatchResponse<
  MaintenanceItem,
  T & { id: string }
> {}
export interface MaintenanceItemBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
