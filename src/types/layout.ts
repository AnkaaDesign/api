// packages/types/src/layout.ts

import type { BaseEntity, ORDER_BY_DIRECTION } from './common';
import type { File } from './file';
import type { Truck } from './garage';
import type { LayoutSection } from './layoutSection';

// =====================
// Main Entity Interface
// =====================

export interface Layout extends BaseEntity {
  // Dimensions
  height: number;

  // Relations
  layoutSections?: LayoutSection[];

  photoId: string | null;
  photo?: File;

  // Inverse relations (one-to-one with specific sides)
  truckLeftSide?: Truck;
  truckRightSide?: Truck;
  truckBackSide?: Truck;
}

// =====================
// Include Types
// =====================

export interface LayoutIncludes {
  photo?: boolean;
  layoutSections?: boolean;
  truckLeftSide?: boolean;
  truckRightSide?: boolean;
  truckBackSide?: boolean;
}

// =====================
// Order By Types
// =====================

export interface LayoutOrderBy {
  id?: ORDER_BY_DIRECTION;
  height?: ORDER_BY_DIRECTION;
  photoId?: ORDER_BY_DIRECTION;
  createdAt?: ORDER_BY_DIRECTION;
  updatedAt?: ORDER_BY_DIRECTION;
}

// =====================
// Where Types
// =====================

export interface LayoutWhere {
  id?: string;
  height?: number;
  photoId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}
