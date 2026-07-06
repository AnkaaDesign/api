// packages/types/src/implementMeasure.ts

import type { BaseEntity, ORDER_BY_DIRECTION } from './common';
import type { File } from './file';
import type { Truck } from './truck';
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
  // Multiple trucks can use the same implementMeasure
  trucksLeftSide?: Truck[]; // Changed from Truck to Truck[]
  trucksRightSide?: Truck[]; // Changed from Truck to Truck[]
  trucksBackSide?: Truck[]; // Changed from Truck to Truck[]

  // Computed field for usage tracking
  usageCount?: number; // Total number of trucks using this implementMeasure
}

// =====================
// Include Types
// =====================

export interface ImplementMeasureIncludes {
  photo?: boolean;
  sections?: boolean;
  trucksLeftSide?: boolean; // Changed from truckLeftSide
  trucksRightSide?: boolean; // Changed from truckRightSide
  trucksBackSide?: boolean; // Changed from truckBackSide
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
