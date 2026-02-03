// packages/interfaces/src/item.ts

import type {
  BaseEntity,
  BaseGetUniqueResponse,
  BaseGetManyResponse,
  BaseCreateResponse,
  BaseUpdateResponse,
  BaseDeleteResponse,
  BaseBatchResponse,
  BaseMergeResponse,
} from './common';
import type {
  MEASURE_UNIT,
  ORDER_BY_DIRECTION,
  ABC_CATEGORY,
  XYZ_CATEGORY,
  PPE_TYPE,
  PPE_SIZE,
  PPE_DELIVERY_MODE,
  ITEM_CATEGORY_TYPE,
} from '@constants';
import type { Supplier, SupplierIncludes, SupplierOrderBy } from './supplier';
import type { Activity, ActivityIncludes } from './activity';
import type { Borrow, BorrowIncludes } from './borrow';
import type { OrderItem, OrderItemIncludes } from './order';
import type {
  PpeDelivery,
  PpeDeliveryIncludes,
  PpeDeliverySchedule,
  PpeDeliveryScheduleIncludes,
} from './ppe';
import type { Measure, MeasureIncludes } from './measure';
import type { MonetaryValue, MonetaryValueIncludes } from './position';

// Re-export MonetaryValue for convenience
export type { MonetaryValue };

// =====================
// Main Entity Interfaces
// =====================

export interface ItemBrand extends BaseEntity {
  name: string;

  // Relations
  items?: Item[];

  // Count fields (when included)
  _count?: {
    items?: number;
  };
}

export interface ItemCategory extends BaseEntity {
  name: string;
  description?: string;
  type: ITEM_CATEGORY_TYPE;
  typeOrder: number;

  // Relations
  items?: Item[];

  // Count fields (when included)
  _count?: {
    items?: number;
  };
}

export interface Item extends BaseEntity {
  name: string;
  uniCode: string | null;
  quantity: number;
  maxQuantity: number | null;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  isManualMaxQuantity: boolean;
  isManualReorderPoint: boolean;
  lastAutoOrderDate: Date | null;
  boxQuantity: number | null;
  icms: number;
  ipi: number;
  totalPrice: number | null;
  monthlyConsumption: number;
  monthlyConsumptionTrendPercent: number | null;
  barcodes: string[];
  shouldAssignToUser: boolean;
  brandId?: string;
  categoryId?: string;
  supplierId: string | null;
  estimatedLeadTime: number | null;
  isActive: boolean;
  abcCategory: ABC_CATEGORY | null;
  abcCategoryOrder: number | null;
  xyzCategory: XYZ_CATEGORY | null;
  xyzCategoryOrder: number | null;

  // PPE-specific fields (when item is a PPE)
  ppeType: PPE_TYPE | null;
  ppeCA: string | null;
  ppeDeliveryMode: PPE_DELIVERY_MODE | null;
  ppeStandardQuantity: number | null;

  // Measure fields (backward compatibility)
  measureUnit?: MEASURE_UNIT;
  measureValue?: number;

  // Relations
  brand?: ItemBrand;
  category?: ItemCategory;
  supplier?: Supplier;
  prices?: MonetaryValue[];
  measures?: Measure[];
  activities?: Activity[];
  borrows?: Borrow[];
  orderItems?: OrderItem[];
  ppeDeliveries?: PpeDelivery[];
  ppeSchedules?: PpeDeliverySchedule[];
  relatedItems?: Item[];
  relatedTo?: Item[];

  // Count fields (when included)
  _count?: {
    activities?: number;
    borrows?: number;
    prices?: number;
    measures?: number;
    orderItems?: number;
    ppeDeliveries?: number;
    relatedItems?: number;
    relatedTo?: number;
  };

  // Virtual field (computed from latest/current monetary value)
  price?: number;
}

// =====================
// Select Types for Partial Data Retrieval
// =====================

/**
 * Minimal Item type - Contains only essential fields for lists
 * Use this when displaying items in lists or dropdowns where full details aren't needed
 */
export type ItemMinimal = Pick<
  Item,
  'id' | 'name' | 'quantity' | 'price' | 'isActive' | 'createdAt' | 'updatedAt'
>;

/**
 * Item with basic details - Includes commonly used fields for standard views
 * Use this for most list views where some additional context is helpful
 */
export type ItemBasic = Pick<
  Item,
  | 'id'
  | 'name'
  | 'uniCode'
  | 'quantity'
  | 'maxQuantity'
  | 'reorderPoint'
  | 'price'
  | 'isActive'
  | 'brandId'
  | 'categoryId'
  | 'supplierId'
  | 'monthlyConsumption'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Item with inventory details - Includes stock management fields
 * Use this for inventory reports and stock analysis
 */
export type ItemInventory = Pick<
  Item,
  | 'id'
  | 'name'
  | 'uniCode'
  | 'quantity'
  | 'maxQuantity'
  | 'reorderPoint'
  | 'reorderQuantity'
  | 'isManualMaxQuantity'
  | 'isManualReorderPoint'
  | 'lastAutoOrderDate'
  | 'monthlyConsumption'
  | 'monthlyConsumptionTrendPercent'
  | 'abcCategory'
  | 'xyzCategory'
  | 'estimatedLeadTime'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Item with PPE details - Includes PPE-specific fields
 * Use this for PPE management and delivery scheduling
 */
export type ItemPPE = Pick<
  Item,
  | 'id'
  | 'name'
  | 'quantity'
  | 'ppeType'
  | 'ppeCA'
  | 'ppeDeliveryMode'
  | 'ppeStandardQuantity'
  | 'categoryId'
  | 'isActive'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Complete Item with all fields
 * This is the same as the full Item interface
 */
export type ItemDetailed = Item;

/**
 * ItemBrand minimal type
 */
export type ItemBrandMinimal = Pick<ItemBrand, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

/**
 * ItemCategory minimal type
 */
export type ItemCategoryMinimal = Pick<
  ItemCategory,
  'id' | 'name' | 'type' | 'typeOrder' | 'createdAt' | 'updatedAt'
>;

// =====================
// Select Field Specifications
// =====================

/**
 * Select fields for Item queries
 * Use these with Prisma select to retrieve partial data
 */
export interface ItemSelect {
  // Base fields
  id?: boolean;
  createdAt?: boolean;
  updatedAt?: boolean;

  // Core fields
  name?: boolean;
  uniCode?: boolean;
  quantity?: boolean;
  maxQuantity?: boolean;
  reorderPoint?: boolean;
  reorderQuantity?: boolean;
  isManualMaxQuantity?: boolean;
  isManualReorderPoint?: boolean;
  lastAutoOrderDate?: boolean;
  boxQuantity?: boolean;
  icms?: boolean;
  ipi?: boolean;
  totalPrice?: boolean;
  monthlyConsumption?: boolean;
  monthlyConsumptionTrendPercent?: boolean;
  barcodes?: boolean;
  shouldAssignToUser?: boolean;
  isActive?: boolean;

  // Category fields
  abcCategory?: boolean;
  abcCategoryOrder?: boolean;
  xyzCategory?: boolean;
  xyzCategoryOrder?: boolean;

  // PPE fields
  ppeType?: boolean;
  ppeCA?: boolean;
  ppeDeliveryMode?: boolean;
  ppeStandardQuantity?: boolean;

  // Foreign keys
  brandId?: boolean;
  categoryId?: boolean;
  supplierId?: boolean;
  estimatedLeadTime?: boolean;

  // Relations
  brand?: boolean | { select?: ItemBrandSelect };
  category?: boolean | { select?: ItemCategorySelect };
  supplier?: boolean;
  prices?: boolean | {
    select?: { id?: boolean; value?: boolean; createdAt?: boolean };
    take?: number;
    skip?: number;
    orderBy?: { id?: 'asc' | 'desc'; value?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' };
  };
  measures?: boolean;
  activities?: boolean;
  borrows?: boolean;
  orderItems?: boolean;
  ppeDeliveries?: boolean;
  ppeSchedules?: boolean;
  relatedItems?: boolean | { select?: ItemSelect };
  relatedTo?: boolean | { select?: ItemSelect };

  // Count
  _count?: boolean | { select?: { activities?: boolean; borrows?: boolean; orderItems?: boolean } };
}

export interface ItemBrandSelect {
  id?: boolean;
  name?: boolean;
  createdAt?: boolean;
  updatedAt?: boolean;
  items?: boolean | { select?: ItemSelect };
  _count?: boolean | { select?: { items?: boolean } };
}

export interface ItemCategorySelect {
  id?: boolean;
  name?: boolean;
  description?: boolean;
  type?: boolean;
  typeOrder?: boolean;
  createdAt?: boolean;
  updatedAt?: boolean;
  items?: boolean | { select?: ItemSelect };
  _count?: boolean | { select?: { items?: boolean } };
}

// =====================
// Predefined Select Presets
// =====================

/**
 * Predefined select presets for common use cases
 */
export const ItemSelectPresets = {
  /**
   * Minimal fields for dropdowns and simple lists
   */
  minimal: {
    id: true,
    name: true,
    quantity: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    prices: {
      select: {
        id: true,
        value: true,
      },
      take: 1,
      orderBy: {
        createdAt: 'desc' as const,
      },
    },
  } satisfies ItemSelect,

  /**
   * Basic fields for standard list views
   */
  basic: {
    id: true,
    name: true,
    uniCode: true,
    quantity: true,
    maxQuantity: true,
    reorderPoint: true,
    isActive: true,
    brandId: true,
    categoryId: true,
    supplierId: true,
    monthlyConsumption: true,
    createdAt: true,
    updatedAt: true,
    prices: {
      select: {
        id: true,
        value: true,
      },
      take: 1,
      orderBy: {
        createdAt: 'desc' as const,
      },
    },
  } satisfies ItemSelect,

  /**
   * Inventory management fields
   */
  inventory: {
    id: true,
    name: true,
    uniCode: true,
    quantity: true,
    maxQuantity: true,
    reorderPoint: true,
    reorderQuantity: true,
    isManualMaxQuantity: true,
    isManualReorderPoint: true,
    lastAutoOrderDate: true,
    monthlyConsumption: true,
    monthlyConsumptionTrendPercent: true,
    abcCategory: true,
    xyzCategory: true,
    estimatedLeadTime: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } satisfies ItemSelect,

  /**
   * PPE-specific fields
   */
  ppe: {
    id: true,
    name: true,
    quantity: true,
    ppeType: true,
    ppeCA: true,
    ppeDeliveryMode: true,
    ppeStandardQuantity: true,
    categoryId: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } satisfies ItemSelect,
} as const;

export const ItemBrandSelectPresets = {
  minimal: {
    id: true,
    name: true,
    createdAt: true,
    updatedAt: true,
  } satisfies ItemBrandSelect,
} as const;

export const ItemCategorySelectPresets = {
  minimal: {
    id: true,
    name: true,
    type: true,
    typeOrder: true,
    createdAt: true,
    updatedAt: true,
  } satisfies ItemCategorySelect,
} as const;

// =====================
// Include Types
// =====================

export interface ItemBrandIncludes {
  items?:
    | boolean
    | {
        include?: ItemIncludes;
        select?: ItemSelect;
      };
}

export interface ItemCategoryIncludes {
  items?:
    | boolean
    | {
        include?: ItemIncludes;
        select?: ItemSelect;
      };
}

export interface ItemIncludes {
  brand?:
    | boolean
    | {
        include?: ItemBrandIncludes;
        select?: ItemBrandSelect;
      };
  category?:
    | boolean
    | {
        include?: ItemCategoryIncludes;
        select?: ItemCategorySelect;
      };
  supplier?:
    | boolean
    | {
        include?: SupplierIncludes;
      };
  prices?:
    | boolean
    | {
        include?: MonetaryValueIncludes;
        select?: { id?: boolean; value?: boolean; createdAt?: boolean };
      };
  measures?:
    | boolean
    | {
        include?: MeasureIncludes;
      };
  activities?:
    | boolean
    | {
        include?: ActivityIncludes;
      };
  borrows?:
    | boolean
    | {
        include?: BorrowIncludes;
      };
  orderItems?:
    | boolean
    | {
        include?: OrderItemIncludes;
      };
  ppeDeliveries?:
    | boolean
    | {
        include?: PpeDeliveryIncludes;
      };
  ppeSchedules?:
    | boolean
    | {
        include?: PpeDeliveryScheduleIncludes;
      };
  relatedItems?:
    | boolean
    | {
        include?: ItemIncludes;
        select?: ItemSelect;
      };
  relatedTo?:
    | boolean
    | {
        include?: ItemIncludes;
        select?: ItemSelect;
      };
}

// =====================
// Where Clause Types
// =====================

export interface ItemWhere {
  // Logical operators
  AND?: ItemWhere | ItemWhere[];
  OR?: ItemWhere[];
  NOT?: ItemWhere | ItemWhere[];

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
  uniCode?:
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
  maxQuantity?:
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
  reorderPoint?:
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
  reorderQuantity?:
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
  boxQuantity?:
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
  icms?:
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
  ipi?:
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
  totalPrice?:
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
  monthlyConsumption?:
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
  monthlyConsumptionTrendPercent?:
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
  estimatedLeadTime?:
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

  // Enum fields
  abcCategory?:
    | ABC_CATEGORY
    | { equals?: ABC_CATEGORY; not?: ABC_CATEGORY; in?: ABC_CATEGORY[]; notIn?: ABC_CATEGORY[] }
    | null;
  xyzCategory?:
    | XYZ_CATEGORY
    | { equals?: XYZ_CATEGORY; not?: XYZ_CATEGORY; in?: XYZ_CATEGORY[]; notIn?: XYZ_CATEGORY[] }
    | null;

  // PPE-specific enum fields
  ppeType?:
    | PPE_TYPE
    | { equals?: PPE_TYPE; not?: PPE_TYPE; in?: PPE_TYPE[]; notIn?: PPE_TYPE[] }
    | null;
  ppeDeliveryMode?:
    | PPE_DELIVERY_MODE
    | {
        equals?: PPE_DELIVERY_MODE;
        not?: PPE_DELIVERY_MODE;
        in?: PPE_DELIVERY_MODE[];
        notIn?: PPE_DELIVERY_MODE[];
      }
    | null;

  // PPE-specific string fields
  ppeCA?:
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

  // PPE-specific number fields
  ppeStandardQuantity?:
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

  // Boolean fields
  shouldAssignToUser?: boolean | { equals?: boolean; not?: boolean };
  isActive?: boolean | { equals?: boolean; not?: boolean };

  // Array fields
  barcodes?:
    | string[]
    | { has?: string; hasEvery?: string[]; hasSome?: string[]; isEmpty?: boolean };

  // Relation IDs
  brandId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  categoryId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;
  supplierId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;

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
  brand?: ItemBrandIncludes;
  category?: ItemCategoryIncludes;
  supplier?: SupplierIncludes | null;
}

export interface ItemBrandWhere {
  // Logical operators
  AND?: ItemBrandWhere | ItemBrandWhere[];
  OR?: ItemBrandWhere[];
  NOT?: ItemBrandWhere | ItemBrandWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
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

export interface ItemCategoryWhere {
  // Logical operators
  AND?: ItemCategoryWhere | ItemCategoryWhere[];
  OR?: ItemCategoryWhere[];
  NOT?: ItemCategoryWhere | ItemCategoryWhere[];

  // Fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
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
  type?:
    | ITEM_CATEGORY_TYPE
    | {
        equals?: ITEM_CATEGORY_TYPE;
        not?: ITEM_CATEGORY_TYPE;
        in?: ITEM_CATEGORY_TYPE[];
        notIn?: ITEM_CATEGORY_TYPE[];
      };
  typeOrder?:
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
}

// =====================
// Order By Types
// =====================

export interface ItemBrandOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface ItemCategoryOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  type?: ORDER_BY_DIRECTION;
  typeOrder?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface ItemOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  uniCode?: ORDER_BY_DIRECTION;
  CA?: ORDER_BY_DIRECTION;
  quantity?: ORDER_BY_DIRECTION;
  maxQuantity?: ORDER_BY_DIRECTION;
  reorderPoint?: ORDER_BY_DIRECTION;
  reorderQuantity?: ORDER_BY_DIRECTION;
  boxQuantity?: ORDER_BY_DIRECTION;
  icms?: ORDER_BY_DIRECTION;
  ipi?: ORDER_BY_DIRECTION;
  monthlyConsumption?: ORDER_BY_DIRECTION;
  monthlyConsumptionTrendPercent?: ORDER_BY_DIRECTION;
  shouldAssignToUser?: ORDER_BY_DIRECTION;
  estimatedLeadTime?: ORDER_BY_DIRECTION;
  isActive?: ORDER_BY_DIRECTION;
  abcCategory?: ORDER_BY_DIRECTION;
  abcCategoryOrder?: ORDER_BY_DIRECTION;
  xyzCategory?: ORDER_BY_DIRECTION;
  xyzCategoryOrder?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  brand?: ItemBrandOrderBy;
  category?: ItemCategoryOrderBy;
  supplier?: SupplierOrderBy;
}

// =====================
// Response Interfaces
// =====================

// Item responses
export interface ItemGetUniqueResponse extends BaseGetUniqueResponse<Item> {}
export interface ItemGetManyResponse extends BaseGetManyResponse<Item> {}
export interface ItemCreateResponse extends BaseCreateResponse<Item> {}
export interface ItemUpdateResponse extends BaseUpdateResponse<Item> {}
export interface ItemDeleteResponse extends BaseDeleteResponse {}
export interface ItemMergeResponse extends BaseMergeResponse<Item> {}

// ItemBrand responses
export interface ItemBrandGetUniqueResponse extends BaseGetUniqueResponse<ItemBrand> {}
export interface ItemBrandGetManyResponse extends BaseGetManyResponse<ItemBrand> {}
export interface ItemBrandCreateResponse extends BaseCreateResponse<ItemBrand> {}
export interface ItemBrandUpdateResponse extends BaseUpdateResponse<ItemBrand> {}
export interface ItemBrandDeleteResponse extends BaseDeleteResponse {}

// ItemCategory responses
export interface ItemCategoryGetUniqueResponse extends BaseGetUniqueResponse<ItemCategory> {}
export interface ItemCategoryGetManyResponse extends BaseGetManyResponse<ItemCategory> {}
export interface ItemCategoryCreateResponse extends BaseCreateResponse<ItemCategory> {}
export interface ItemCategoryUpdateResponse extends BaseUpdateResponse<ItemCategory> {}
export interface ItemCategoryDeleteResponse extends BaseDeleteResponse {}

// =====================
// API Request Types
// =====================

export interface ItemGetManyParams {
  where?: ItemWhere;
  include?: ItemIncludes;
  select?: ItemSelect;
  orderBy?: ItemOrderBy | ItemOrderBy[];
  skip?: number;
  take?: number;
  searchingFor?: string;
}

export interface ItemGetByIdParams {
  include?: ItemIncludes;
  select?: ItemSelect;
}

export interface ItemBrandGetManyParams {
  where?: ItemBrandWhere;
  include?: ItemBrandIncludes;
  select?: ItemBrandSelect;
  orderBy?: ItemBrandOrderBy | ItemBrandOrderBy[];
  skip?: number;
  take?: number;
  searchingFor?: string;
}

export interface ItemBrandGetByIdParams {
  include?: ItemBrandIncludes;
  select?: ItemBrandSelect;
}

export interface ItemCategoryGetManyParams {
  where?: ItemCategoryWhere;
  include?: ItemCategoryIncludes;
  select?: ItemCategorySelect;
  orderBy?: ItemCategoryOrderBy | ItemCategoryOrderBy[];
  skip?: number;
  take?: number;
  searchingFor?: string;
}

export interface ItemCategoryGetByIdParams {
  include?: ItemCategoryIncludes;
  select?: ItemCategorySelect;
}

// =====================
// Batch Operation Responses
// =====================

// Item batch operations
export interface ItemBatchCreateResponse<T> extends BaseBatchResponse<Item, T> {}
export interface ItemBatchUpdateResponse<T> extends BaseBatchResponse<Item, T & { id: string }> {}
export interface ItemBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// ItemBrand batch operations
export interface ItemBrandBatchCreateResponse<T> extends BaseBatchResponse<ItemBrand, T> {}
export interface ItemBrandBatchUpdateResponse<T> extends BaseBatchResponse<
  ItemBrand,
  T & { id: string }
> {}
export interface ItemBrandBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// ItemCategory batch operations
export interface ItemCategoryBatchCreateResponse<T> extends BaseBatchResponse<ItemCategory, T> {}
export interface ItemCategoryBatchUpdateResponse<T> extends BaseBatchResponse<
  ItemCategory,
  T & { id: string }
> {}
export interface ItemCategoryBatchDeleteResponse extends BaseBatchResponse<
  { id: string; deleted: boolean },
  { id: string }
> {}

// =====================
// Stock Management Response Types
// =====================

export interface RecalculateMonthlyConsumptionResponse {
  success: boolean;
  message: string;
  data: {
    success: number;
    failed: number;
    total: number;
  };
}

export interface RecalculateItemMonthlyConsumptionResponse {
  success: boolean;
  message: string;
}

export interface UpdateReorderPointsResponse {
  success: boolean;
  message: string;
  data: {
    totalAnalyzed: number;
    totalUpdated: number;
    updates: Array<{
      itemId: string;
      itemName: string;
      oldReorderPoint: number | null;
      newReorderPoint: number;
      oldReorderQuantity: number | null;
      newReorderQuantity: number;
      avgDailyConsumption: number;
      leadTimeDays: number;
      safetyStockDays: number;
    }>;
  };
}

export interface AnalyzeReorderPointsResponse {
  success: boolean;
  message: string;
  data: Array<{
    itemId: string;
    itemName: string;
    currentReorderPoint: number | null;
    suggestedReorderPoint: number;
    currentReorderQuantity: number | null;
    suggestedReorderQuantity: number;
    avgDailyConsumption: number;
    leadTimeDays: number;
    safetyStockDays: number;
    consumptionData: {
      totalConsumed: number;
      daysAnalyzed: number;
      avgDaily: number;
      maxDaily: number;
      minDaily: number;
    };
  }>;
}
