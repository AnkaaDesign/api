// packages/types/src/payrollDetails.ts

import type { BaseGetUniqueResponse } from "./common";
import type { BONUS_STATUS } from '@constants';
import type { Bonus, BonusIncludes } from "./bonus";
import type { Task } from "./task";
import type { User } from "./user";
import type { Position } from "./position";

// =====================
// PayrollDetails Core Types
// =====================

export interface PayrollDetails {
  year: number;
  month: number;
  totalBonuses: number;
  totalValue: number;
  userCount: number;
  averageTasksPerUser: number; // weighted average
  bonuses: Bonus[];

  // Relations
  users?: PayrollUserStats[];
  taskSummary?: PayrollTaskSummary[];
}

export interface PayrollUserStats {
  userId: string;
  userName: string;
  positionName: string;
  taskCount: number;
  weightedTaskCount: number;
  bonusValue: number;
  performanceLevel: number;
  status: BONUS_STATUS;

  // Relations (optional, populated based on query)
  user?: User;
  position?: Position;
  bonus?: Bonus;
  tasks?: Task[];
}

export interface PayrollTaskSummary {
  taskId: string;
  taskName: string;
  taskStatus: string;
  customerId: string | null;
  customerName: string | null;
  sectorName: string | null;
  taskPrice: number | null;
  completedAt: Date | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  positionLevel: number | null;
  weight: number;

  // Relations (optional, populated based on query)
  task?: Task;
  assignedUser?: User;
}

// =====================
// Include Types
// =====================

export interface PayrollDetailsIncludes {
  users?:
    | boolean
    | {
        include?: {
          user?: boolean;
          position?: boolean;
          bonus?: boolean | { include?: BonusIncludes };
          tasks?: boolean;
        };
      };
  taskSummary?:
    | boolean
    | {
        include?: {
          task?: boolean;
          assignedUser?: boolean;
        };
      };
  bonuses?:
    | boolean
    | {
        include?: BonusIncludes;
      };
}

export interface PayrollUserStatsIncludes {
  user?: boolean;
  position?: boolean;
  bonus?:
    | boolean
    | {
        include?: BonusIncludes;
      };
  tasks?: boolean;
}

export interface PayrollTaskSummaryIncludes {
  task?: boolean;
  assignedUser?: boolean;
}

// =====================
// API Response Types
// =====================

export type PayrollDetailsResponse = BaseGetUniqueResponse<PayrollDetails>;

// =====================
// Get Params
// =====================

export interface PayrollDetailsParams {
  year: number;
  month: number;
  include?: PayrollDetailsIncludes;

  // Optional filters for detailed analysis
  userId?: string;
  sectorId?: string;
  positionId?: string;
  status?: BONUS_STATUS;
  includeTaskDetails?: boolean;
}

// =====================
// Calculation Types
// =====================

export interface PayrollCalculationSummary {
  period: {
    year: number;
    month: number;
    periodStart: Date;
    periodEnd: Date;
  };
  totals: {
    totalEmployees: number;
    eligibleEmployees: number;
    totalTasks: number;
    completedTasks: number;
    totalBonusAmount: number;
    totalRemunerationAmount: number;
    totalEarnings: number;
  };
  averages: {
    averageTasksPerEmployee: number;
    weightedAverageTasksPerEmployee: number;
    averageBonusPerEmployee: number;
    averagePerformanceLevel: number;
  };
  breakdown: {
    byStatus: Record<BONUS_STATUS, number>;
    bySector: Array<{
      sectorId: string;
      sectorName: string;
      employeeCount: number;
      totalBonus: number;
      averageBonus: number;
    }>;
    byPosition: Array<{
      positionId: string;
      positionName: string;
      positionLevel: number;
      employeeCount: number;
      totalBonus: number;
      averageBonus: number;
    }>;
  };
}

export type PayrollCalculationSummaryResponse = BaseGetUniqueResponse<PayrollCalculationSummary>;

// =====================
// Utility Types
// =====================

export interface PayrollPeriod {
  year: number;
  month: number;
  periodStart: Date;
  periodEnd: Date;
  isCurrentPeriod: boolean;
  isCalculated: boolean;
  calculatedAt?: Date;
}

export interface PayrollMetrics {
  taskCompletionRate: number;
  averageTasksPerDay: number;
  topPerformers: Array<{
    userId: string;
    userName: string;
    taskCount: number;
    bonusAmount: number;
    rank: number;
  }>;
  sectorPerformance: Array<{
    sectorId: string;
    sectorName: string;
    taskCount: number;
    completionRate: number;
    averageBonus: number;
  }>;
}

export type PayrollMetricsResponse = BaseGetUniqueResponse<PayrollMetrics>;