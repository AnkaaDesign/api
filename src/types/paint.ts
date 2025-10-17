// packages/interfaces/src/paint.ts

import type { BaseEntity, BaseGetUniqueResponse, BaseGetManyResponse, BaseCreateResponse, BaseUpdateResponse, BaseDeleteResponse, BaseBatchResponse, BaseMergeResponse } from "./common";
import type { PAINT_FINISH, ORDER_BY_DIRECTION, COLOR_PALETTE, TRUCK_MANUFACTURER, PAINT_TYPE_ENUM } from '@constants';
import type { Item, ItemIncludes, ItemOrderBy } from "./item";
import type { Task, TaskIncludes } from "./task";
import type { PaintBrand, PaintBrandIncludes, PaintBrandOrderBy, PaintBrandWhere } from "./paint-brand";

// =====================
// Main Entity Interfaces
// =====================

export interface PaintType extends BaseEntity {
  name: string;
  type: PAINT_TYPE_ENUM;
  needGround: boolean;

  // Relations (optional, populated based on query)
  paints?: Paint[];
  componentItems?: Item[];

  // Count fields (optional, populated when using _count in include)
  _count?: {
    paints?: number;
    componentItems?: number;
  };
}

export interface Paint extends BaseEntity {
  name: string;
  code: string | null;
  hex: string;
  finish: PAINT_FINISH;
  manufacturer: TRUCK_MANUFACTURER | null;
  tags: string[];
  palette: COLOR_PALETTE;
  paletteOrder: number;
  colorOrder: number;
  paintTypeId: string;
  paintBrandId: string | null;

  // Relations (optional, populated based on query)
  paintType?: PaintType;
  paintBrand?: PaintBrand;
  formulas?: PaintFormula[];
  generalPaintings?: Task[];
  logoTasks?: Task[];
  relatedPaints?: Paint[];
  relatedTo?: Paint[];
  paintGrounds?: PaintGround[];
  groundPaintFor?: PaintGround[];

  // Count fields (when included)
  _count?: {
    formulas?: number;
    paintProduction?: number;
    generalPaintings?: number;
    logoTasks?: number;
    relatedPaints?: number;
    relatedTo?: number;
    paintGrounds?: number;
    groundPaintFor?: number;
  };
}

export interface PaintGround extends BaseEntity {
  paintId: string;
  groundPaintId: string;

  // Relations (optional, populated based on query)
  paint?: Paint;
  groundPaint?: Paint;
}

export interface PaintFormula extends BaseEntity {
  description: string;
  paintId: string;
  density: number;
  pricePerLiter: number;

  // Relations (optional, populated based on query)
  components?: PaintFormulaComponent[];
  paint?: Paint;
  paintProduction?: PaintProduction[];
}

export interface PaintFormulaComponent extends BaseEntity {
  ratio: number; // Percentage of this component in the formula (calculated from weightInGrams)
  itemId: string;
  formulaPaintId: string;

  // Relations (optional, populated based on query)
  item?: Item;
  formula?: PaintFormula;
}

export interface PaintProduction extends BaseEntity {
  volumeLiters: number;
  formulaId: string;

  // Relations (optional, populated based on query)
  formula?: PaintFormula;
}

// =====================
// Include Types
// =====================

export interface PaintTypeIncludes {
  paints?:
    | boolean
    | {
        include?: PaintIncludes;
      };
  componentItems?:
    | boolean
    | {
        include?: ItemIncludes;
      };
}

export interface PaintIncludes {
  paintType?:
    | boolean
    | {
        include?: PaintTypeIncludes;
      };
  paintBrand?:
    | boolean
    | {
        include?: PaintBrandIncludes;
      };
  formulas?:
    | boolean
    | {
        include?: PaintFormulaIncludes;
      };
  generalPaintings?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  logoTasks?:
    | boolean
    | {
        include?: TaskIncludes;
      };
  paintProduction?:
    | boolean
    | {
        include?: PaintProductionIncludes;
      };
  relatedPaints?:
    | boolean
    | {
        include?: PaintIncludes;
      };
  relatedTo?:
    | boolean
    | {
        include?: PaintIncludes;
      };
  paintGrounds?:
    | boolean
    | {
        include?: PaintGroundIncludes;
      };
  groundPaintFor?:
    | boolean
    | {
        include?: PaintGroundIncludes;
      };
}

export interface PaintFormulaIncludes {
  components?:
    | boolean
    | {
        include?: PaintFormulaComponentIncludes;
      };
  paint?:
    | boolean
    | {
        include?: PaintIncludes;
      };
}

export interface PaintFormulaComponentIncludes {
  item?:
    | boolean
    | {
        include?: ItemIncludes;
      };
  formula?:
    | boolean
    | {
        include?: PaintFormulaIncludes;
      };
}

export interface PaintProductionIncludes {
  formula?:
    | boolean
    | {
        include?: PaintFormulaIncludes;
      };
}

export interface PaintGroundIncludes {
  paint?:
    | boolean
    | {
        include?: PaintIncludes;
      };
  groundPaint?:
    | boolean
    | {
        include?: PaintIncludes;
      };
}

// =====================
// Order By Types
// =====================

export interface PaintTypeOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

export interface PaintOrderBy {
  id?: ORDER_BY_DIRECTION;
  name?: ORDER_BY_DIRECTION;
  hex?: ORDER_BY_DIRECTION;
  finish?: ORDER_BY_DIRECTION;
  manufacturer?: ORDER_BY_DIRECTION;
  palette?: ORDER_BY_DIRECTION;
  paletteOrder?: ORDER_BY_DIRECTION;
  colorOrder?: ORDER_BY_DIRECTION;
  paintTypeId?: ORDER_BY_DIRECTION;
  paintBrandId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  paintType?: PaintTypeOrderBy;
  paintBrand?: PaintBrandOrderBy;
}

export interface PaintFormulaOrderBy {
  id?: ORDER_BY_DIRECTION;
  description?: ORDER_BY_DIRECTION;
  density?: ORDER_BY_DIRECTION;
  pricePerLiter?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  paint?: PaintOrderBy;
}

export interface PaintFormulaComponentOrderBy {
  id?: ORDER_BY_DIRECTION;
  ratio?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  item?: ItemOrderBy;
  formula?: PaintFormulaOrderBy;
}

export interface PaintProductionOrderBy {
  id?: ORDER_BY_DIRECTION;
  volumeLiters?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  formula?: PaintFormulaOrderBy;
}

export interface PaintGroundOrderBy {
  id?: ORDER_BY_DIRECTION;
  paintId?: ORDER_BY_DIRECTION;
  groundPaintId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
  paint?: PaintOrderBy;
  groundPaint?: PaintOrderBy;
}

// =====================
// Where Clause Types
// =====================

export interface PaintTypeWhere {
  // Logical operators
  AND?: PaintTypeWhere | PaintTypeWhere[];
  OR?: PaintTypeWhere[];
  NOT?: PaintTypeWhere | PaintTypeWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // String fields
  name?: string | { equals?: string; not?: string; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive"; in?: string[]; notIn?: string[] };

  // Type fields
  type?: PAINT_TYPE_ENUM | { equals?: PAINT_TYPE_ENUM; not?: PAINT_TYPE_ENUM; in?: PAINT_TYPE_ENUM[]; notIn?: PAINT_TYPE_ENUM[] };

  // Boolean fields
  needGround?: boolean | { equals?: boolean; not?: boolean };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  paints?: any; // Paint where conditions when filtering by related paints
  componentItems?: any; // Item where conditions when filtering by component items
}

export interface PaintWhere {
  // Logical operators
  AND?: PaintWhere | PaintWhere[];
  OR?: PaintWhere[];
  NOT?: PaintWhere | PaintWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  paintTypeId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  paintBrandId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] } | null;

  // String fields
  name?: string | { equals?: string; not?: string; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive"; in?: string[]; notIn?: string[] };
  hex?: string | { equals?: string; not?: string; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive"; in?: string[]; notIn?: string[] };

  // Enum fields
  finish?: PAINT_FINISH | { equals?: PAINT_FINISH; not?: PAINT_FINISH; in?: PAINT_FINISH[]; notIn?: PAINT_FINISH[] };
  manufacturer?: TRUCK_MANUFACTURER | { equals?: TRUCK_MANUFACTURER; not?: TRUCK_MANUFACTURER; in?: TRUCK_MANUFACTURER[]; notIn?: TRUCK_MANUFACTURER[] } | null;
  palette?: COLOR_PALETTE | { equals?: COLOR_PALETTE; not?: COLOR_PALETTE; in?: COLOR_PALETTE[]; notIn?: COLOR_PALETTE[] };

  // Number fields
  paletteOrder?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };
  colorOrder?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };

  // Array fields
  tags?: string[] | { has?: string; hasEvery?: string[]; hasSome?: string[]; isEmpty?: boolean };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  paintType?: PaintTypeWhere;
  paintBrand?: PaintBrandWhere | null;
  formulas?: any; // PaintFormula where conditions
  generalPaintings?: any; // Task where conditions
  logoTasks?: any; // Task where conditions
  relatedPaints?: PaintWhere;
  relatedTo?: PaintWhere;
  paintGrounds?: any; // PaintGround where conditions
  groundPaintFor?: any; // PaintGround where conditions
}

export interface PaintFormulaWhere {
  // Logical operators
  AND?: PaintFormulaWhere | PaintFormulaWhere[];
  OR?: PaintFormulaWhere[];
  NOT?: PaintFormulaWhere | PaintFormulaWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  paintId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // String fields
  description?:
    | string
    | { equals?: string; not?: string; contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive"; in?: string[]; notIn?: string[] };

  // Number fields
  density?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };
  pricePerLiter?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  components?: any; // PaintFormulaComponent where conditions
  paint?: PaintWhere;
  paintProduction?: any; // PaintProduction where conditions
}

export interface PaintFormulaComponentWhere {
  // Logical operators
  AND?: PaintFormulaComponentWhere | PaintFormulaComponentWhere[];
  OR?: PaintFormulaComponentWhere[];
  NOT?: PaintFormulaComponentWhere | PaintFormulaComponentWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  itemId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  formulaPaintId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // Number fields
  ratio?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  item?: any; // Item where conditions
  formula?: PaintFormulaWhere;
}

export interface PaintProductionWhere {
  // Logical operators
  AND?: PaintProductionWhere | PaintProductionWhere[];
  OR?: PaintProductionWhere[];
  NOT?: PaintProductionWhere | PaintProductionWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  formulaId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // Number fields
  volumeLiters?: number | { equals?: number; not?: number; lt?: number; lte?: number; gt?: number; gte?: number; in?: number[]; notIn?: number[] };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  formula?: PaintFormulaWhere;
}

export interface PaintGroundWhere {
  // Logical operators
  AND?: PaintGroundWhere | PaintGroundWhere[];
  OR?: PaintGroundWhere[];
  NOT?: PaintGroundWhere | PaintGroundWhere[];

  // ID fields
  id?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  paintId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };
  groundPaintId?: string | { equals?: string; not?: string; in?: string[]; notIn?: string[] };

  // Date fields
  createdAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };
  updatedAt?: Date | { equals?: Date; not?: Date; lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: Date[]; notIn?: Date[] };

  // Relations
  paint?: PaintWhere;
  groundPaint?: PaintWhere;
}

// Specialized filtering types for dual filtering (paint type + paint brand)
export interface ComponentFilterOptions {
  paintTypeId?: string;
  paintBrandId?: string;
  paintType?: PaintTypeWhere;
  paintBrand?: PaintBrandWhere;
  paintName?: string;
  searchTerm?: string; // For unified search across paint names, types, and brands
}

export interface PaintComponentFilters {
  // Direct field filters
  paintTypeId?: string | string[];
  paintBrandId?: string | string[];

  // Nested relation filters
  paintType?: {
    id?: string | string[];
    name?: string;
    type?: PAINT_TYPE_ENUM | PAINT_TYPE_ENUM[];
    needGround?: boolean;
  };

  paintBrand?: {
    id?: string | string[];
    name?: string;
  };

  // Combined search
  search?: string; // Searches across paint name, type name, and brand name

  // Paint-specific filters
  paint?: {
    name?: string;
    hex?: string;
    finish?: PAINT_FINISH | PAINT_FINISH[];
    manufacturer?: TRUCK_MANUFACTURER | TRUCK_MANUFACTURER[];
    palette?: COLOR_PALETTE | COLOR_PALETTE[];
    tags?: string[];
  };
}

// =====================
// Response Interfaces
// =====================

// PaintType responses
export interface PaintTypeGetUniqueResponse extends BaseGetUniqueResponse<PaintType> {}
export interface PaintTypeGetManyResponse extends BaseGetManyResponse<PaintType> {}
export interface PaintTypeCreateResponse extends BaseCreateResponse<PaintType> {}
export interface PaintTypeUpdateResponse extends BaseUpdateResponse<PaintType> {}
export interface PaintTypeDeleteResponse extends BaseDeleteResponse {}

// Paint responses
export interface PaintGetUniqueResponse extends BaseGetUniqueResponse<Paint> {}
export interface PaintGetManyResponse extends BaseGetManyResponse<Paint> {}
export interface PaintCreateResponse extends BaseCreateResponse<Paint> {}
export interface PaintUpdateResponse extends BaseUpdateResponse<Paint> {}
export interface PaintDeleteResponse extends BaseDeleteResponse {}
export interface PaintMergeResponse extends BaseMergeResponse<Paint> {}

// PaintGround responses
export interface PaintGroundGetUniqueResponse extends BaseGetUniqueResponse<PaintGround> {}
export interface PaintGroundGetManyResponse extends BaseGetManyResponse<PaintGround> {}
export interface PaintGroundCreateResponse extends BaseCreateResponse<PaintGround> {}
export interface PaintGroundUpdateResponse extends BaseUpdateResponse<PaintGround> {}
export interface PaintGroundDeleteResponse extends BaseDeleteResponse {}

// PaintFormula responses
export interface PaintFormulaGetUniqueResponse extends BaseGetUniqueResponse<PaintFormula> {}
export interface PaintFormulaGetManyResponse extends BaseGetManyResponse<PaintFormula> {}
export interface PaintFormulaCreateResponse extends BaseCreateResponse<PaintFormula> {}
export interface PaintFormulaUpdateResponse extends BaseUpdateResponse<PaintFormula> {}
export interface PaintFormulaDeleteResponse extends BaseDeleteResponse {}

// PaintFormulaComponent responses
export interface PaintFormulaComponentGetUniqueResponse extends BaseGetUniqueResponse<PaintFormulaComponent> {}
export interface PaintFormulaComponentGetManyResponse extends BaseGetManyResponse<PaintFormulaComponent> {}
export interface PaintFormulaComponentCreateResponse extends BaseCreateResponse<PaintFormulaComponent> {}
export interface PaintFormulaComponentUpdateResponse extends BaseUpdateResponse<PaintFormulaComponent> {}
export interface PaintFormulaComponentDeleteResponse extends BaseDeleteResponse {}

// PaintProduction responses
export interface PaintProductionGetUniqueResponse extends BaseGetUniqueResponse<PaintProduction> {}
export interface PaintProductionGetManyResponse extends BaseGetManyResponse<PaintProduction> {}
export interface PaintProductionCreateResponse extends BaseCreateResponse<PaintProduction> {}
export interface PaintProductionUpdateResponse extends BaseUpdateResponse<PaintProduction> {}
export interface PaintProductionDeleteResponse extends BaseDeleteResponse {}

// =====================
// Batch Operation Responses
// =====================

// PaintType batch operations
export interface PaintTypeBatchCreateResponse<T> extends BaseBatchResponse<PaintType, T> {}
export interface PaintTypeBatchUpdateResponse<T> extends BaseBatchResponse<PaintType, T & { id: string }> {}
export interface PaintTypeBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// Paint batch operations
export interface PaintBatchCreateResponse<T> extends BaseBatchResponse<Paint, T> {}
export interface PaintBatchUpdateResponse<T> extends BaseBatchResponse<Paint, T & { id: string }> {}
export interface PaintBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// PaintGround batch operations
export interface PaintGroundBatchCreateResponse<T> extends BaseBatchResponse<PaintGround, T> {}
export interface PaintGroundBatchUpdateResponse<T> extends BaseBatchResponse<PaintGround, T & { id: string }> {}
export interface PaintGroundBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// PaintFormula batch operations
export interface PaintFormulaBatchCreateResponse<T> extends BaseBatchResponse<PaintFormula, T> {}
export interface PaintFormulaBatchUpdateResponse<T> extends BaseBatchResponse<PaintFormula, T & { id: string }> {}
export interface PaintFormulaBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// PaintFormulaComponent batch operations
export interface PaintFormulaComponentBatchCreateResponse<T> extends BaseBatchResponse<PaintFormulaComponent, T> {}
export interface PaintFormulaComponentBatchUpdateResponse<T> extends BaseBatchResponse<PaintFormulaComponent, T & { id: string }> {}
export interface PaintFormulaComponentBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// PaintProduction batch operations
export interface PaintProductionBatchCreateResponse<T> extends BaseBatchResponse<PaintProduction, T> {}
export interface PaintProductionBatchUpdateResponse<T> extends BaseBatchResponse<PaintProduction, T & { id: string }> {}
export interface PaintProductionBatchDeleteResponse extends BaseBatchResponse<{ id: string; deleted: boolean }, { id: string }> {}

// Dashboard types have been moved to packages/types/src/dashboard.ts
