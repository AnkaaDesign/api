// packages/interfaces/src/ppe.ts

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
  PPE_DELIVERY_STATUS,
  PPE_TYPE,
  SCHEDULE_FREQUENCY,
  WEEK_DAY,
  MONTH,
  MONTH_OCCURRENCE,
  SHIRT_SIZE,
  BOOT_SIZE,
  PANTS_SIZE,
  SLEEVES_SIZE,
  MASK_SIZE,
  GLOVES_SIZE,
  RAIN_BOOTS_SIZE,
  ASSIGNMENT_TYPE,
  RESCHEDULE_REASON,
} from '@constants';
import type { User, UserIncludes, UserOrderBy } from './user';
import type { Item, ItemIncludes, ItemOrderBy } from './item';
import type { Order, OrderIncludes } from './order';

// =====================
// Main Entity Interfaces
// =====================

export interface PpeSize extends BaseEntity {
  shirts: SHIRT_SIZE | null;
  boots: BOOT_SIZE | null;
  pants: PANTS_SIZE | null;
  shorts: PANTS_SIZE | null;
  sleeves: SLEEVES_SIZE | null;
  mask: MASK_SIZE | null;
  gloves: GLOVES_SIZE | null;
  rainBoots: RAIN_BOOTS_SIZE | null;
  userId: string;

  // Relations (optional, populated based on query)
  user?: User;
}

export interface PpeDelivery extends BaseEntity {
  userId: string;
  itemId: string;
  reviewedBy: string | null;
  ppeScheduleId: string | null;
  scheduledDate: Date | null;
  actualDeliveryDate: Date | null;
  status: PPE_DELIVERY_STATUS;
  statusOrder: number;
  quantity: number;
  reason: string | null;

  // Relations (optional, populated based on query)
  user?: User;
  reviewedByUser?: User;
  ppeSchedule?: PpeDeliverySchedule;
  item?: Item;
}

// PPE configuration is now stored directly on the Item model
// Each PPE size is a separate item (e.g., "Camisa EPI Tamanho M", "Bota de Segurança Tamanho 42")
// The Item entity now contains all PPE-specific fields:
// - ppeType: Type of PPE (SHIRT, PANTS, BOOTS, etc.)
// - measures: Array with measureType: "SIZE" and unit from MEASURE_UNIT (P, M, G, SIZE_40, etc.)
// - ppeCA: Certificate of Approval
// - ppeDeliveryMode: SCHEDULED, ON_DEMAND, BOTH
// - ppeStandardQuantity: Standard quantity per delivery

// PPE Schedule Item - database entity for PPE types in a schedule
export interface PpeScheduleItem extends BaseEntity {
  scheduleId: string;
  ppeType: PPE_TYPE;
  quantity: number;
  itemId: string | null; // Required when ppeType is OTHERS - references specific item

  // Relations (optional, populated based on query)
  schedule?: PpeDeliverySchedule;
  item?: Item;
}

// Input type for creating/updating PPE schedule items (without id/timestamps)
export interface PpeScheduleItemInput {
  ppeType: PPE_TYPE;
  quantity: number;
  itemId?: string; // Required when ppeType is OTHERS
}

export interface PpeDeliverySchedule extends BaseEntity {
  name: string;
  assignmentType: ASSIGNMENT_TYPE;
  excludedUserIds: string[];
  includedUserIds: string[];
  frequency: SCHEDULE_FREQUENCY;
  frequencyCount: number;
  isActive: boolean;
  specificDate: Date | null;
  dayOfMonth: number | null;
  dayOfWeek: WEEK_DAY | null;
  month: MONTH | null;
  customMonths: MONTH[];
  rescheduleCount: number;
  originalDate: Date | null;
  lastRescheduleDate: Date | null;
  rescheduleReason: RESCHEDULE_REASON | null;
  nextRun: Date | null;
  lastRun: Date | null;

  // Relations (optional, populated based on query)
  items?: PpeScheduleItem[];
  deliveries?: PpeDelivery[];
  autoOrders?: Order[];
}

// Unified Schedule Configuration Interfaces
export interface WeeklyScheduleConfig extends BaseEntity {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;

  // Relations (optional, populated based on query)
  ppeSchedule?: PpeDeliverySchedule;
  orderSchedule?: any; // Avoid circular dependency
  maintenance?: any; // Avoid circular dependency
}

export interface MonthlyScheduleConfig extends BaseEntity {
  dayOfMonth: number | null;
  occurrence: MONTH_OCCURRENCE | null;
  dayOfWeek: WEEK_DAY | null;

  // Relations (optional, populated based on query)
  ppeSchedule?: PpeDeliverySchedule;
  orderSchedule?: any; // Avoid circular dependency
  maintenance?: any; // Avoid circular dependency
}

export interface YearlyScheduleConfig extends BaseEntity {
  month: MONTH;
  dayOfMonth: number | null;
  occurrence: MONTH_OCCURRENCE | null;
  dayOfWeek: WEEK_DAY | null;

  // Relations (optional, populated based on query)
  ppeSchedule?: PpeDeliverySchedule;
  orderSchedule?: any; // Avoid circular dependency
  maintenance?: any; // Avoid circular dependency
}

// =====================
// Include Types
// =====================

export interface PpeSizeIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
}

export interface PpeDeliveryIncludes {
  user?:
    | boolean
    | {
        include?: UserIncludes;
      };
  reviewedByUser?:
    | boolean
    | {
        include?: UserIncludes;
      };
  ppeSchedule?:
    | boolean
    | {
        include?: PpeDeliveryScheduleIncludes;
      };
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
}

// PPE configuration includes are not needed as PPE config is stored directly on Item

export interface PpeDeliveryScheduleIncludes {
  deliveries?:
    | boolean
    | {
        include?: PpeDeliveryIncludes;
      };
  autoOrders?:
    | boolean
    | {
        include?: OrderIncludes;
      };
}

export interface WeeklyScheduleConfigIncludes {
  ppeSchedule?:
    | boolean
    | {
        include?: PpeDeliveryScheduleIncludes;
      };
  orderSchedule?: boolean;
  maintenance?: boolean;
}

export interface MonthlyScheduleConfigIncludes {
  ppeSchedule?:
    | boolean
    | {
        include?: PpeDeliveryScheduleIncludes;
      };
  orderSchedule?: boolean;
  maintenance?: boolean;
}

export interface YearlyScheduleConfigIncludes {
  ppeSchedule?:
    | boolean
    | {
        include?: PpeDeliveryScheduleIncludes;
      };
  orderSchedule?: boolean;
  maintenance?: boolean;
}

// =====================
// Where Clause Types
// =====================

export interface PpeSizeWhere {
  // Logical operators
  AND?: PpeSizeWhere | PpeSizeWhere[];
  OR?: PpeSizeWhere[];
  NOT?: PpeSizeWhere | PpeSizeWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  shirts?:
    | SHIRT_SIZE
    | { equals?: SHIRT_SIZE; not?: SHIRT_SIZE; in?: SHIRT_SIZE[]; notIn?: SHIRT_SIZE[] }
    | null;
  boots?:
    | BOOT_SIZE
    | { equals?: BOOT_SIZE; not?: BOOT_SIZE; in?: BOOT_SIZE[]; notIn?: BOOT_SIZE[] }
    | null;
  pants?:
    | PANTS_SIZE
    | { equals?: PANTS_SIZE; not?: PANTS_SIZE; in?: PANTS_SIZE[]; notIn?: PANTS_SIZE[] }
    | null;
  sleeves?:
    | SLEEVES_SIZE
    | { equals?: SLEEVES_SIZE; not?: SLEEVES_SIZE; in?: SLEEVES_SIZE[]; notIn?: SLEEVES_SIZE[] }
    | null;
  mask?:
    | MASK_SIZE
    | { equals?: MASK_SIZE; not?: MASK_SIZE; in?: MASK_SIZE[]; notIn?: MASK_SIZE[] }
    | null;
  gloves?:
    | GLOVES_SIZE
    | { equals?: GLOVES_SIZE; not?: GLOVES_SIZE; in?: GLOVES_SIZE[]; notIn?: GLOVES_SIZE[] }
    | null;
  rainBoots?:
    | RAIN_BOOTS_SIZE
    | {
        equals?: RAIN_BOOTS_SIZE;
        not?: RAIN_BOOTS_SIZE;
        in?: RAIN_BOOTS_SIZE[];
        notIn?: RAIN_BOOTS_SIZE[];
      }
    | null;
  userId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

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

  // Relations
  user?: UserIncludes;
}

export interface PpeDeliveryWhere {
  // Logical operators
  AND?: PpeDeliveryWhere | PpeDeliveryWhere[];
  OR?: PpeDeliveryWhere[];
  NOT?: PpeDeliveryWhere | PpeDeliveryWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  userId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  itemId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  reviewedBy?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  ppeScheduleId?:
    | string
    | { equals?: string; not?: string; in?: string[]; notIn?: string[] }
    | null;
  status?:
    | PPE_DELIVERY_STATUS
    | {
        equals?: PPE_DELIVERY_STATUS;
        not?: PPE_DELIVERY_STATUS;
        in?: PPE_DELIVERY_STATUS[];
        notIn?: PPE_DELIVERY_STATUS[];
      };
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
  scheduledDate?:
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
  actualDeliveryDate?:
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

  // Relations
  user?: UserIncludes;
  reviewedByUser?: UserIncludes | null;
  ppeSchedule?: PpeDeliveryScheduleIncludes | null;
  item?: ItemIncludes;
}

export interface PpeDeliveryScheduleWhere {
  // Logical operators
  AND?: PpeDeliveryScheduleWhere | PpeDeliveryScheduleWhere[];
  OR?: PpeDeliveryScheduleWhere[];
  NOT?: PpeDeliveryScheduleWhere | PpeDeliveryScheduleWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  assignmentType?:
    | ASSIGNMENT_TYPE
    | {
        equals?: ASSIGNMENT_TYPE;
        not?: ASSIGNMENT_TYPE;
        in?: ASSIGNMENT_TYPE[];
        notIn?: ASSIGNMENT_TYPE[];
      };
  excludedUserIds?:
    | string[]
    | { has?: string; hasEvery?: string[]; hasSome?: string[]; isEmpty?: boolean };
  includedUserIds?:
    | string[]
    | { has?: string; hasEvery?: string[]; hasSome?: string[]; isEmpty?: boolean };
  frequency?:
    | SCHEDULE_FREQUENCY
    | {
        equals?: SCHEDULE_FREQUENCY;
        not?: SCHEDULE_FREQUENCY;
        in?: SCHEDULE_FREQUENCY[];
        notIn?: SCHEDULE_FREQUENCY[];
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
  isActive?: boolean | { equals?: boolean; not?: boolean };
  // items relation - query by PPE types in the schedule
  items?: {
    some?: { ppeType?: PPE_TYPE | { in?: PPE_TYPE[] } };
    none?: { ppeType?: PPE_TYPE | { in?: PPE_TYPE[] } };
    every?: { ppeType?: PPE_TYPE | { in?: PPE_TYPE[] } };
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
  dayOfWeek?:
    | WEEK_DAY
    | { equals?: WEEK_DAY; not?: WEEK_DAY; in?: WEEK_DAY[]; notIn?: WEEK_DAY[] }
    | null;
  month?: MONTH | { equals?: MONTH; not?: MONTH; in?: MONTH[]; notIn?: MONTH[] } | null;
  customMonths?:
    | MONTH[]
    | { has?: MONTH; hasEvery?: MONTH[]; hasSome?: MONTH[]; isEmpty?: boolean };
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
  rescheduleReason?:
    | RESCHEDULE_REASON
    | {
        equals?: RESCHEDULE_REASON;
        not?: RESCHEDULE_REASON;
        in?: RESCHEDULE_REASON[];
        notIn?: RESCHEDULE_REASON[];
      }
    | null;

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
}

export interface WeeklyScheduleConfigWhere {
  // Logical operators
  AND?: WeeklyScheduleConfigWhere | WeeklyScheduleConfigWhere[];
  OR?: WeeklyScheduleConfigWhere[];
  NOT?: WeeklyScheduleConfigWhere | WeeklyScheduleConfigWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  monday?: boolean | { equals?: boolean; not?: boolean };
  tuesday?: boolean | { equals?: boolean; not?: boolean };
  wednesday?: boolean | { equals?: boolean; not?: boolean };
  thursday?: boolean | { equals?: boolean; not?: boolean };
  friday?: boolean | { equals?: boolean; not?: boolean };
  saturday?: boolean | { equals?: boolean; not?: boolean };
  sunday?: boolean | { equals?: boolean; not?: boolean };

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
}

export interface MonthlyScheduleConfigWhere {
  // Logical operators
  AND?: MonthlyScheduleConfigWhere | MonthlyScheduleConfigWhere[];
  OR?: MonthlyScheduleConfigWhere[];
  NOT?: MonthlyScheduleConfigWhere | MonthlyScheduleConfigWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
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
  occurrence?:
    | MONTH_OCCURRENCE
    | {
        equals?: MONTH_OCCURRENCE;
        not?: MONTH_OCCURRENCE;
        in?: MONTH_OCCURRENCE[];
        notIn?: MONTH_OCCURRENCE[];
      }
    | null;
  dayOfWeek?:
    | WEEK_DAY
    | { equals?: WEEK_DAY; not?: WEEK_DAY; in?: WEEK_DAY[]; notIn?: WEEK_DAY[] }
    | null;

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
}

export interface YearlyScheduleConfigWhere {
  // Logical operators
  AND?: YearlyScheduleConfigWhere | YearlyScheduleConfigWhere[];
  OR?: YearlyScheduleConfigWhere[];
  NOT?: YearlyScheduleConfigWhere | YearlyScheduleConfigWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  month?: MONTH | { equals?: MONTH; not?: MONTH; in?: MONTH[]; notIn?: MONTH[] };
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
  occurrence?:
    | MONTH_OCCURRENCE
    | {
        equals?: MONTH_OCCURRENCE;
        not?: MONTH_OCCURRENCE;
        in?: MONTH_OCCURRENCE[];
        notIn?: MONTH_OCCURRENCE[];
      }
    | null;
  dayOfWeek?:
    | WEEK_DAY
    | { equals?: WEEK_DAY; not?: WEEK_DAY; in?: WEEK_DAY[]; notIn?: WEEK_DAY[] }
    | null;

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
}

// =====================
// Order By Types
// =====================

export interface PpeSizeOrderBy {
  id?: ORDER_BY_DIRECTION;
  shirts?: ORDER_BY_DIRECTION;
  boots?: ORDER_BY_DIRECTION;
  pants?: ORDER_BY_DIRECTION;
  sleeves?: ORDER_BY_DIRECTION;
  mask?: ORDER_BY_DIRECTION;
  gloves?: ORDER_BY_DIRECTION;
  rainBoots?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  user?: UserOrderBy;
}

export interface PpeDeliveryOrderBy {
  id?: ORDER_BY_DIRECTION;
  userId?: ORDER_BY_DIRECTION;
  itemId?: ORDER_BY_DIRECTION;
  reviewedBy?: ORDER_BY_DIRECTION;
  ppeScheduleId?: ORDER_BY_DIRECTION;
  scheduledDate?: ORDER_BY_DIRECTION;
  actualDeliveryDate?: ORDER_BY_DIRECTION;
  status?: ORDER_BY_DIRECTION;
  statusOrder?: ORDER_BY_DIRECTION;
  quantity?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  user?: UserOrderBy;
  reviewedByUser?: UserOrderBy;
  ppeSchedule?: PpeDeliveryScheduleOrderBy;
  item?: ItemOrderBy;
}

// PPE configuration order by is not needed as PPE config is stored directly on Item

export interface PpeDeliveryScheduleOrderBy {
  id?: ORDER_BY_DIRECTION;
  assignmentType?: ORDER_BY_DIRECTION;
  frequency?: ORDER_BY_DIRECTION;
  frequencyCount?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  specificDate?: ORDER_BY_DIRECTION;
  dayOfMonth?: ORDER_BY_DIRECTION;
  dayOfWeek?: ORDER_BY_DIRECTION;
  month?: ORDER_BY_DIRECTION;
  nextRun?: ORDER_BY_DIRECTION;
  lastRun?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface WeeklyScheduleConfigOrderBy {
  id?: ORDER_BY_DIRECTION;
  monday?: ORDER_BY_DIRECTION;
  tuesday?: ORDER_BY_DIRECTION;
  wednesday?: ORDER_BY_DIRECTION;
  thursday?: ORDER_BY_DIRECTION;
  friday?: ORDER_BY_DIRECTION;
  saturday?: ORDER_BY_DIRECTION;
  sunday?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  ppeSchedule?: PpeDeliveryScheduleOrderBy;
}

export interface MonthlyScheduleConfigOrderBy {
  id?: ORDER_BY_DIRECTION;
  dayOfMonth?: ORDER_BY_DIRECTION;
  occurrence?: ORDER_BY_DIRECTION;
  dayOfWeek?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  ppeSchedule?: PpeDeliveryScheduleOrderBy;
}

export interface YearlyScheduleConfigOrderBy {
  id?: ORDER_BY_DIRECTION;
  month?: ORDER_BY_DIRECTION;
  dayOfMonth?: ORDER_BY_DIRECTION;
  occurrence?: ORDER_BY_DIRECTION;
  dayOfWeek?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  ppeSchedule?: PpeDeliveryScheduleOrderBy;
}

// =====================
// Response Interfaces
// =====================

// PpeSize Responses
export interface PpeSizeGetUniqueResponse extends BaseGetUniqueResponse<PpeSize> {}
export interface PpeSizeGetManyResponse extends BaseGetManyResponse<PpeSize> {}
export interface PpeSizeCreateResponse extends BaseCreateResponse<PpeSize> {}
export interface PpeSizeUpdateResponse extends BaseUpdateResponse<PpeSize> {}
export interface PpeSizeDeleteResponse extends BaseDeleteResponse {}

// PpeDelivery Responses
export interface PpeDeliveryGetUniqueResponse extends BaseGetUniqueResponse<PpeDelivery> {}
export interface PpeDeliveryGetManyResponse extends BaseGetManyResponse<PpeDelivery> {}
export interface PpeDeliveryCreateResponse extends BaseCreateResponse<PpeDelivery> {}
export interface PpeDeliveryUpdateResponse extends BaseUpdateResponse<PpeDelivery> {}
export interface PpeDeliveryDeleteResponse extends BaseDeleteResponse {}

// PpeConfig Responses - PPE configuration is now stored directly on the Item model
// All PPE configuration operations are done through the Item entity

// PpeDeliverySchedule Responses
export interface PpeDeliveryScheduleGetUniqueResponse extends BaseGetUniqueResponse<PpeDeliverySchedule> {}
export interface PpeDeliveryScheduleGetManyResponse extends BaseGetManyResponse<PpeDeliverySchedule> {}
export interface PpeDeliveryScheduleCreateResponse extends BaseCreateResponse<PpeDeliverySchedule> {}
export interface PpeDeliveryScheduleUpdateResponse extends BaseUpdateResponse<PpeDeliverySchedule> {}
export interface PpeDeliveryScheduleDeleteResponse extends BaseDeleteResponse {}

// WeeklyScheduleConfig Responses
export interface WeeklyScheduleConfigGetUniqueResponse extends BaseGetUniqueResponse<WeeklyScheduleConfig> {}
export interface WeeklyScheduleConfigGetManyResponse extends BaseGetManyResponse<WeeklyScheduleConfig> {}
export interface WeeklyScheduleConfigCreateResponse extends BaseCreateResponse<WeeklyScheduleConfig> {}
export interface WeeklyScheduleConfigUpdateResponse extends BaseUpdateResponse<WeeklyScheduleConfig> {}
export interface WeeklyScheduleConfigDeleteResponse extends BaseDeleteResponse {}

// MonthlyScheduleConfig Responses
export interface MonthlyScheduleConfigGetUniqueResponse extends BaseGetUniqueResponse<MonthlyScheduleConfig> {}
export interface MonthlyScheduleConfigGetManyResponse extends BaseGetManyResponse<MonthlyScheduleConfig> {}
export interface MonthlyScheduleConfigCreateResponse extends BaseCreateResponse<MonthlyScheduleConfig> {}
export interface MonthlyScheduleConfigUpdateResponse extends BaseUpdateResponse<MonthlyScheduleConfig> {}
export interface MonthlyScheduleConfigDeleteResponse extends BaseDeleteResponse {}

// YearlyScheduleConfig Responses
export interface YearlyScheduleConfigGetUniqueResponse extends BaseGetUniqueResponse<YearlyScheduleConfig> {}
export interface YearlyScheduleConfigGetManyResponse extends BaseGetManyResponse<YearlyScheduleConfig> {}
export interface YearlyScheduleConfigCreateResponse extends BaseCreateResponse<YearlyScheduleConfig> {}
export interface YearlyScheduleConfigUpdateResponse extends BaseUpdateResponse<YearlyScheduleConfig> {}
export interface YearlyScheduleConfigDeleteResponse extends BaseDeleteResponse {}

// =====================
// API Request Types
// =====================

export interface PpeSizeGetManyParams {
  where?: PpeSizeWhere;
  include?: PpeSizeIncludes;
  orderBy?: PpeSizeOrderBy | PpeSizeOrderBy[];
  skip?: number;
  take?: number;
}

export interface PpeSizeGetByIdParams {
  include?: PpeSizeIncludes;
}

export interface PpeDeliveryGetManyParams {
  where?: PpeDeliveryWhere;
  include?: PpeDeliveryIncludes;
  orderBy?: PpeDeliveryOrderBy | PpeDeliveryOrderBy[];
  skip?: number;
  take?: number;
}

export interface PpeDeliveryGetByIdParams {
  include?: PpeDeliveryIncludes;
}

export interface PpeDeliveryScheduleGetManyParams {
  where?: PpeDeliveryScheduleWhere;
  include?: PpeDeliveryScheduleIncludes;
  orderBy?: PpeDeliveryScheduleOrderBy | PpeDeliveryScheduleOrderBy[];
  skip?: number;
  take?: number;
}

export interface PpeDeliveryScheduleGetByIdParams {
  include?: PpeDeliveryScheduleIncludes;
}

export interface WeeklyScheduleConfigGetManyParams {
  where?: WeeklyScheduleConfigWhere;
  include?: WeeklyScheduleConfigIncludes;
  orderBy?: WeeklyScheduleConfigOrderBy | WeeklyScheduleConfigOrderBy[];
  skip?: number;
  take?: number;
}

export interface WeeklyScheduleConfigGetByIdParams {
  include?: WeeklyScheduleConfigIncludes;
}

export interface MonthlyScheduleConfigGetManyParams {
  where?: MonthlyScheduleConfigWhere;
  include?: MonthlyScheduleConfigIncludes;
  orderBy?: MonthlyScheduleConfigOrderBy | MonthlyScheduleConfigOrderBy[];
  skip?: number;
  take?: number;
}

export interface MonthlyScheduleConfigGetByIdParams {
  include?: MonthlyScheduleConfigIncludes;
}

export interface YearlyScheduleConfigGetManyParams {
  where?: YearlyScheduleConfigWhere;
  include?: YearlyScheduleConfigIncludes;
  orderBy?: YearlyScheduleConfigOrderBy | YearlyScheduleConfigOrderBy[];
  skip?: number;
  take?: number;
}

export interface YearlyScheduleConfigGetByIdParams {
  include?: YearlyScheduleConfigIncludes;
}

// =====================
// Batch Operation Responses
// =====================

// PpeSize Batch Operations
export interface PpeSizeBatchCreateResponse<T> extends BaseBatchResponse<PpeSize, T> {}
export interface PpeSizeBatchUpdateResponse<T> extends BaseBatchResponse<
  PpeSize,
  T & { id: string }
> {}
export interface PpeSizeBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// PpeDelivery Batch Operations
export interface PpeDeliveryBatchCreateResponse<T> extends BaseBatchResponse<PpeDelivery, T> {}
export interface PpeDeliveryBatchUpdateResponse<T> extends BaseBatchResponse<
  PpeDelivery,
  T & { id: string }
> {}
export interface PpeDeliveryBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// PpeConfig Batch Operations - PPE configuration is now stored directly on the Item model
// All PPE configuration batch operations are done through the Item entity

// PpeDeliverySchedule Batch Operations
export interface PpeDeliveryScheduleBatchCreateResponse<T> extends BaseBatchResponse<
  PpeDeliverySchedule,
  T
> {}
export interface PpeDeliveryScheduleBatchUpdateResponse<T> extends BaseBatchResponse<
  PpeDeliverySchedule,
  T & { id: string }
> {}
export interface PpeDeliveryScheduleBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}
