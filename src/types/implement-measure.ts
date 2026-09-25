// packages/types/src/implementMeasure.ts

import type { BaseEntity, ORDER_BY_DIRECTION } from './common';
import type { File } from './file';
import type { Implement } from './implement';
import type { ImplementMeasureSection } from './implementMeasureSection';

// =====================
// Main Entity Interface
// =====================

export interface ImplementMeasure extends BaseEntity {
  // Dimensions
  height: number;

  // Relations
  sections?: ImplementMeasureSection[];

  photoId: string | null;
  photo?: File;

  // Inverse relations (one-to-many - SHARED RESOURCE)
  // Desde o P04 a medida não é compartilhada (D-07): no máximo 1 implemento por lista
  implementsLeftSide?: Implement[];
  implementsRightSide?: Implement[];
  implementsBackSide?: Implement[];

  // Computed field for usage tracking
  usageCount?: number; // quantos implementos usam esta medida
}

// =====================
// Include Types
// =====================

export interface ImplementMeasureIncludes {
  photo?: boolean;
  sections?: boolean;
  implementsLeftSide?: boolean;
  implementsRightSide?: boolean;
  implementsBackSide?: boolean;
}

// =====================
// Order By Types
// =====================

export interface ImplementMeasureOrderBy {
  id?: ORDER_BY_DIRECTION;
  height?: ORDER_BY_DIRECTION;
  photoId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Where Types
// =====================

export interface ImplementMeasureWhere {
  id?: string;
  height?: number;
  photoId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}
