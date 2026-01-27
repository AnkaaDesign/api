// packages/types/src/bonusExtra.ts

import type { BaseEntity } from './common';
import type { Bonus, BonusIncludes } from './bonus';

// =====================
// Main Entity Interface
// =====================

export interface BonusExtra extends BaseEntity {
  bonusId: string;
  percentage: number | null;
  value: number | null;
  reference: string;
  calculationOrder: number;

  // Relations (optional, populated based on query)
  bonus?: Bonus;
}

// =====================
// Include Types
// =====================

export interface BonusExtraIncludes {
  bonus?:
    | boolean
    | {
        include?: BonusIncludes;
      };
}
