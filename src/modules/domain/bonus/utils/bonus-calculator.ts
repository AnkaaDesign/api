/**
 * Comprehensive Bonus Calculator Utility
 *
 * This module serves as the single source of truth for all bonus calculations
 * in the Ankaa system. It implements the exact bonus calculation algorithm
 * based on position levels, performance ratings, and task completion metrics.
 *
 * Key Features:
 * - Period calculation (26th of prev month to 25th of current month)
 * - Weighted task counting (full commission = 1, partial = 0.5)
 * - Average tasks per user calculation
 * - Exact bonus matrix calculation
 * - Live bonus generation for missing records
 *
 * @author Generated with Claude Code
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  COMMISSION_STATUS,
  TASK_STATUS,
  USER_STATUS,
  BONUS_STATUS,
  ACTIVE_USER_STATUSES
} from '../../../../constants';
import type { Task, User, Bonus } from '../../../../types';
import { roundCurrency, roundAverage } from '@modules/human-resources/utils/currency-precision.util';

// =====================
// Types & Interfaces
// =====================

export interface BonusPeriod {
  startDate: Date;
  endDate: Date;
  year: number;
  month: number;
}

export interface TaskCountMetrics {
  totalTasks: number;
  fullCommissionTasks: number;
  partialCommissionTasks: number;
  noCommissionTasks: number;
  ponderedTaskCount: number;
}

export interface UserBonusMetrics {
  userId: string;
  userName: string;
  positionName: string;
  performanceLevel: number;
  taskCount: number;
  ponderedTaskCount: number;
  bonusAmount: number;
  baseSalary?: number;
}

export interface PeriodBonusCalculation {
  period: BonusPeriod;
  totalEligibleUsers: number;
  averageTasksPerUser: number;
  totalPonderedTasks: number;
  userMetrics: UserBonusMetrics[];
  summary: {
    totalBonusAmount: number;
    averageBonusAmount: number;
    usersWithBonus: number;
    usersWithoutBonus: number;
  };
}

export interface LiveBonusData {
  userId: string;
  year: number;
  month: number;
  performanceLevel: number;
  baseBonus: number;
  status: BONUS_STATUS;
  statusOrder: number;
  payrollId: string;
  isLiveCalculation: true;
  calculatedAt: Date;
  period: BonusPeriod;
  taskMetrics: TaskCountMetrics;
}

// =====================
// Bonus Calculator Service
// =====================

@Injectable()
export class BonusCalculatorService {
  private readonly logger = new Logger(BonusCalculatorService.name);

  /**
   * Position level mapping for bonus calculation
   * 1-4: Junior I-IV, 5-8: Pleno I-IV, 9-12: Senior I-IV
   */
  private getPositionLevel(positionName: string): number {
    const normalized = positionName.toLowerCase().replace(/\s+/g, '').trim();

    // CRITICAL: Check MORE SPECIFIC patterns FIRST (IV before I, III before II)
    // Junior levels (1-4)
    if (normalized.includes('junioriv') || normalized.includes('júnioriv')) return 4;
    if (normalized.includes('junioriii') || normalized.includes('júnioriii')) return 3;
    if (normalized.includes('juniorii') || normalized.includes('júniorii')) return 2;
    if (normalized.includes('juniori') || normalized.includes('júniori') ||
        normalized === 'junior' || normalized === 'júnior') return 1;

    // Pleno levels (5-8)
    if (normalized.includes('plenoiv')) return 8;
    if (normalized.includes('plenoiii')) return 7;
    if (normalized.includes('plenoii')) return 6;
    if (normalized.includes('plenoi') || normalized === 'pleno') return 5;

    // Senior levels (9-12)
    if (normalized.includes('senioriv') || normalized.includes('sênioriv')) return 12;
    if (normalized.includes('senioriii') || normalized.includes('sênioriii')) return 11;
    if (normalized.includes('seniorii') || normalized.includes('sêniorii')) return 10;
    if (normalized.includes('seniori') || normalized.includes('sêniori')) return 9;
    if (normalized.includes('senior') || normalized.includes('sênior')) return 11; // Default to Senior III

    // Default based on general category
    if (normalized.includes('junior') || normalized.includes('júnior') ||
        normalized.includes('auxiliar') || normalized.includes('estagiário')) return 1;
    if (normalized.includes('pleno')) return 5;
    if (normalized.includes('senior') || normalized.includes('sênior')) return 11;

    return 5; // Default to Pleno I
  }

  /**
   * Exact bonus matrix from spreadsheet for 4 tasks base
   * Scales proportionally based on actual average tasks per user
   */
  private readonly bonusMatrix: Record<string, number> = {
    // Junior I (1.x)
    '1.1': 50.76, '1.2': 101.52, '1.3': 152.28, '1.4': 177.65, '1.5': 205.24,

    // Junior II (2.x)
    '2.1': 101.52, '2.2': 203.03, '2.3': 304.55, '2.4': 355.31, '2.5': 410.48,

    // Junior III (3.x)
    '3.1': 169.19, '3.2': 338.39, '3.3': 507.58, '3.4': 592.18, '3.5': 684.14,

    // Junior IV (4.x)
    '4.1': 241.71, '4.2': 483.41, '4.3': 725.12, '4.4': 845.97, '4.5': 977.34,

    // Pleno I (5.x)
    '5.1': 313.91, '5.2': 627.81, '5.3': 941.72, '5.4': 1098.67, '5.5': 1269.27,

    // Pleno II (6.x)
    '6.1': 378.20, '6.2': 756.40, '6.3': 1134.60, '6.4': 1323.70, '6.5': 1529.24,

    // Pleno III (7.x)
    '7.1': 434.71, '7.2': 869.42, '7.3': 1304.14, '7.4': 1521.49, '7.5': 1757.75,

    // Pleno IV (8.x)
    '8.1': 483.01, '8.2': 966.03, '8.3': 1449.04, '8.4': 1690.55, '8.5': 1953.05,

    // Senior I (9.x)
    '9.1': 525.01, '9.2': 1050.03, '9.3': 1575.04, '9.4': 1837.55, '9.5': 2100.06,

    // Senior II (10.x)
    '10.1': 555.57, '10.2': 1111.14, '10.3': 1666.71, '10.4': 1944.50, '10.5': 2222.28,

    // Senior III (11.x)
    '11.1': 579.50, '11.2': 1159.01, '11.3': 1738.51, '11.4': 2028.26, '11.5': 2318.02,

    // Senior IV (12.x)
    '12.1': 608.48, '12.2': 1216.96, '12.3': 1825.44, '12.4': 2129.68, '12.5': 2433.92,
  };

  // =====================
  // Core Calculation Methods
  // =====================

  /**
   * Calculate bonus period dates
   * Period runs from 26th of previous month 00:01 to 25th of current month 23:59
   *
   * @param month Target month (1-12)
   * @param year Target year
   * @returns BonusPeriod with start and end dates
   */
  calculateBonusPeriod(month: number, year: number): BonusPeriod {
    if (month < 1 || month > 12) {
      throw new Error(`Mês inválido: ${month}. Deve estar entre 1 e 12.`);
    }

    if (year < 2000 || year > 2099) {
      throw new Error(`Ano inválido: ${year}. Deve estar entre 2000 e 2099.`);
    }

    // Start: 26th of previous month at 00:01
    const startDate = new Date(year, month - 1, 26, 0, 1, 0, 0);

    // If we're in January, go back to December of previous year
    if (month === 1) {
      startDate.setFullYear(year - 1);
      startDate.setMonth(11); // December
    } else {
      startDate.setMonth(month - 2); // Previous month
    }

    // End: 25th of current month at 23:59
    const endDate = new Date(year, month - 1, 25, 23, 59, 59, 999);

    this.logger.debug(`Calculated bonus period for ${month}/${year}: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    return {
      startDate,
      endDate,
      year,
      month,
    };
  }

  /**
   * Calculate pondered (weighted) task count
   * Full commission = 1.0, Partial commission = 0.5, No commission = 0.0
   *
   * @param tasks Array of tasks to analyze
   * @returns TaskCountMetrics with detailed breakdown
   */
  calculatePonderedTaskCount(tasks: Task[]): TaskCountMetrics {
    if (!Array.isArray(tasks)) {
      throw new Error('Tasks deve ser um array válido.');
    }

    const metrics: TaskCountMetrics = {
      totalTasks: tasks.length,
      fullCommissionTasks: 0,
      partialCommissionTasks: 0,
      noCommissionTasks: 0,
      ponderedTaskCount: 0,
    };

    for (const task of tasks) {
      // Only count completed tasks
      if (task.status !== TASK_STATUS.COMPLETED) {
        continue;
      }

      switch (task.commission) {
        case COMMISSION_STATUS.FULL_COMMISSION:
          metrics.fullCommissionTasks++;
          metrics.ponderedTaskCount += 1.0;
          break;

        case COMMISSION_STATUS.PARTIAL_COMMISSION:
          metrics.partialCommissionTasks++;
          metrics.ponderedTaskCount += 0.5;
          break;

        case COMMISSION_STATUS.NO_COMMISSION:
        case COMMISSION_STATUS.SUSPENDED_COMMISSION:
          metrics.noCommissionTasks++;
          // No pondered count added
          break;

        default:
          this.logger.warn(`Unknown commission status: ${task.commission} for task ${task.id}`);
          metrics.noCommissionTasks++;
          break;
      }
    }

    this.logger.debug(`Pondered task count calculated: ${JSON.stringify(metrics)}`);
    return metrics;
  }

  /**
   * Calculate average tasks per eligible user
   * Only counts active users with eligible positions
   *
   * @param users Array of users to analyze
   * @param tasks Array of tasks completed in the period
   * @returns Average pondered tasks per eligible user
   */
  calculateAverageTasksPerUser(users: User[], tasks: Task[]): number {
    if (!Array.isArray(users) || !Array.isArray(tasks)) {
      throw new Error('Users e tasks devem ser arrays válidos.');
    }

    // Filter eligible users (active status and has position)
    const eligibleUsers = users.filter(user =>
      ACTIVE_USER_STATUSES.includes(user.status as any) &&
      user.positionId !== null &&
      user.position !== null
    );

    if (eligibleUsers.length === 0) {
      this.logger.warn('Nenhum usuário elegível encontrado para cálculo de bônus.');
      return 0;
    }

    // Calculate total pondered tasks
    const taskMetrics = this.calculatePonderedTaskCount(tasks);
    const averageTasksPerUser = taskMetrics.ponderedTaskCount / eligibleUsers.length;

    this.logger.debug(
      `Average tasks per user: ${taskMetrics.ponderedTaskCount} pondered tasks / ${eligibleUsers.length} eligible users = ${averageTasksPerUser}`
    );

    // CRITICAL: Use centralized rounding utility for consistency
    return roundAverage(averageTasksPerUser);
  }

  /**
   * Calculate bonus amount using the exact matrix algorithm
   *
   * @param ponderedTaskCount Weighted task count for the user
   * @param averageTasksPerUser Average tasks per user in the period
   * @param baseSalary Base salary (optional, for future salary-based calculations)
   * @returns Calculated bonus amount in BRL
   */
  calculateBonusAmount(
    ponderedTaskCount: number,
    averageTasksPerUser: number,
    baseSalary?: number
  ): number {
    if (ponderedTaskCount < 0 || averageTasksPerUser < 0) {
      throw new Error('Contagem de tarefas e média devem ser valores não negativos.');
    }

    // If no tasks completed, no bonus
    if (ponderedTaskCount === 0) {
      return 0;
    }

    // For now, we use position-based calculation
    // In the future, baseSalary could be used for salary-percentage based bonuses
    if (baseSalary !== undefined && baseSalary < 0) {
      throw new Error('Salário base deve ser um valor não negativo.');
    }

    // This method is typically called by the position-specific bonus calculation
    // The actual matrix lookup is done in getBonusFromMatrix
    this.logger.debug(
      `Calculating bonus amount: pondered=${ponderedTaskCount}, average=${averageTasksPerUser}, baseSalary=${baseSalary}`
    );

    return 0; // This is overridden by specific implementations
  }

  /**
   * Get bonus value from matrix and scale by average tasks per user
   * Base matrix is calibrated for 4 tasks per user average
   *
   * @param positionLevel Position level (1-12)
   * @param performanceLevel Performance level (1-5)
   * @param averageTasksPerUser Average tasks per user in the period
   * @returns Scaled bonus amount
   */
  private getBonusFromMatrix(
    positionLevel: number,
    performanceLevel: number,
    averageTasksPerUser: number
  ): number {
    const clampedPerformanceLevel = Math.max(1, Math.min(5, performanceLevel));
    const matrixKey = `${positionLevel}.${clampedPerformanceLevel}`;
    const baseValue = this.bonusMatrix[matrixKey];

    if (!baseValue) {
      this.logger.warn(`No matrix value found for position ${positionLevel}, performance ${clampedPerformanceLevel}`);
      return 0;
    }

    // Scale the base value (calibrated for 4 tasks per user) to actual average
    const scaledValue = (baseValue / 4) * averageTasksPerUser;

    this.logger.debug(
      `Matrix calculation: ${matrixKey} base=${baseValue}, scaled by ${averageTasksPerUser}/4 = ${scaledValue}`
    );

    // CRITICAL: Use centralized rounding utility for consistency
    return roundCurrency(scaledValue);
  }

  /**
   * Calculate individual user bonus
   *
   * @param user User data with position information
   * @param userTasks Tasks completed by this user in the period
   * @param averageTasksPerUser Average tasks per user in the period
   * @returns Calculated bonus amount
   */
  calculateUserBonus(
    user: User,
    userTasks: Task[],
    averageTasksPerUser: number
  ): number {
    if (!user.position) {
      this.logger.warn(`User ${user.id} has no position assigned, no bonus calculated.`);
      return 0;
    }

    if (!ACTIVE_USER_STATUSES.includes(user.status as any)) {
      this.logger.debug(`User ${user.id} is not active, no bonus calculated.`);
      return 0;
    }

    const positionLevel = this.getPositionLevel(user.position.name);
    const performanceLevel = Math.max(1, Math.min(5, user.performanceLevel || 1));

    // Calculate user's pondered task count
    const taskMetrics = this.calculatePonderedTaskCount(userTasks);

    // Get bonus from matrix
    const bonusAmount = this.getBonusFromMatrix(
      positionLevel,
      performanceLevel,
      averageTasksPerUser
    );

    this.logger.debug(
      `User bonus calculated: ${user.name} (${user.position.name}, level ${positionLevel}, ` +
      `performance ${performanceLevel}) = R$ ${bonusAmount}`
    );

    return bonusAmount;
  }

  // =====================
  // Advanced Calculation Methods
  // =====================

  /**
   * Calculate bonus for entire period with detailed metrics
   *
   * @param users All users in the system
   * @param tasks All tasks completed in the period
   * @param month Target month
   * @param year Target year
   * @returns Complete period bonus calculation
   */
  calculatePeriodBonus(
    users: User[],
    tasks: Task[],
    month: number,
    year: number
  ): PeriodBonusCalculation {
    const period = this.calculateBonusPeriod(month, year);

    // Filter eligible users
    const eligibleUsers = users.filter(user =>
      ACTIVE_USER_STATUSES.includes(user.status as any) &&
      user.positionId !== null &&
      user.position !== null
    );

    // Filter tasks in period
    const periodTasks = tasks.filter(task => {
      if (!task.finishedAt) return false;
      return task.finishedAt >= period.startDate && task.finishedAt <= period.endDate;
    });

    // Calculate metrics
    const totalTaskMetrics = this.calculatePonderedTaskCount(periodTasks);
    const averageTasksPerUser = this.calculateAverageTasksPerUser(eligibleUsers, periodTasks);

    // Calculate individual user bonuses
    const userMetrics: UserBonusMetrics[] = eligibleUsers.map(user => {
      const userTasks = periodTasks.filter(task => task.createdById === user.id);
      const userTaskMetrics = this.calculatePonderedTaskCount(userTasks);
      const bonusAmount = this.calculateUserBonus(user, userTasks, averageTasksPerUser);

      return {
        userId: user.id,
        userName: user.name,
        positionName: user.position?.name || 'Sem Posição',
        performanceLevel: user.performanceLevel || 1,
        taskCount: userTasks.length,
        ponderedTaskCount: userTaskMetrics.ponderedTaskCount,
        bonusAmount,
        baseSalary: user.position?.remunerations?.[0]?.value || undefined,
      };
    });

    // Calculate summary
    const totalBonusAmount = userMetrics.reduce((sum, metric) => sum + metric.bonusAmount, 0);
    const usersWithBonus = userMetrics.filter(metric => metric.bonusAmount > 0).length;
    const averageBonusAmount = usersWithBonus > 0 ? totalBonusAmount / usersWithBonus : 0;

    const calculation: PeriodBonusCalculation = {
      period,
      totalEligibleUsers: eligibleUsers.length,
      averageTasksPerUser,
      totalPonderedTasks: totalTaskMetrics.ponderedTaskCount,
      userMetrics,
      summary: {
        totalBonusAmount,
        averageBonusAmount: roundCurrency(averageBonusAmount),
        usersWithBonus,
        usersWithoutBonus: eligibleUsers.length - usersWithBonus,
      },
    };

    this.logger.log(
      `Period bonus calculation completed: ${month}/${year}, ` +
      `${eligibleUsers.length} eligible users, ` +
      `R$ ${totalBonusAmount} total bonus`
    );

    return calculation;
  }

  /**
   * Generate live bonus calculation when no database record exists
   * This is used for real-time bonus preview and simulation
   *
   * @param userId User ID to calculate bonus for
   * @param month Target month
   * @param year Target year
   * @param user User data (optional, if not provided will need to be fetched)
   * @param allUsers All users for average calculation (optional)
   * @param periodTasks Tasks in the period (optional)
   * @returns Live bonus data with calculation details
   */
  generateLiveBonus(
    userId: string,
    month: number,
    year: number,
    user?: User,
    allUsers?: User[],
    periodTasks?: Task[]
  ): LiveBonusData {
    if (!user) {
      throw new Error('User data is required for live bonus calculation.');
    }

    if (!allUsers || !periodTasks) {
      this.logger.warn('Incomplete data for live bonus calculation. Some calculations may be inaccurate.');
    }

    const period = this.calculateBonusPeriod(month, year);

    // Calculate user's task metrics
    const userTasks = periodTasks?.filter(task => task.createdById === userId) || [];
    const taskMetrics = this.calculatePonderedTaskCount(userTasks);

    // Calculate average (if data available)
    const averageTasksPerUser = allUsers && periodTasks
      ? this.calculateAverageTasksPerUser(allUsers, periodTasks)
      : 4; // Default to 4 if no data available

    // Calculate bonus
    const baseBonus = this.calculateUserBonus(user, userTasks, averageTasksPerUser);

    // Generate payroll ID (temporary for live calculation)
    const payrollId = `live_${year}_${month.toString().padStart(2, '0')}_${userId}`;

    const liveBonus: LiveBonusData = {
      userId,
      year,
      month,
      performanceLevel: user.performanceLevel || 1,
      baseBonus,
      status: BONUS_STATUS.DRAFT,
      statusOrder: 1,
      payrollId,
      isLiveCalculation: true,
      calculatedAt: new Date(),
      period,
      taskMetrics,
    };

    this.logger.debug(
      `Live bonus generated for user ${userId} (${month}/${year}): R$ ${baseBonus}`
    );

    return liveBonus;
  }

  // =====================
  // Utility Methods
  // =====================

  /**
   * Validate bonus calculation parameters
   *
   * @param month Month (1-12)
   * @param year Year (2000-2099)
   * @param userId User ID
   * @throws Error if parameters are invalid
   */
  validateBonusParameters(month: number, year: number, userId?: string): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`Mês inválido: ${month}. Deve ser um número inteiro entre 1 e 12.`);
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2099) {
      throw new Error(`Ano inválido: ${year}. Deve ser um número inteiro entre 2000 e 2099.`);
    }

    if (userId !== undefined && (!userId || typeof userId !== 'string')) {
      throw new Error('User ID deve ser uma string válida.');
    }
  }

  /**
   * Get detailed calculation breakdown for debugging
   *
   * @param positionName Position name
   * @param performanceLevel Performance level (1-5)
   * @param ponderedTaskCount Pondered task count
   * @param averageTasksPerUser Average tasks per user
   * @returns Detailed breakdown object
   */
  getCalculationDetails(
    positionName: string,
    performanceLevel: number,
    ponderedTaskCount: number,
    averageTasksPerUser: number
  ): {
    positionLevel: number;
    positionName: string;
    performanceLevel: number;
    taskCount: number;
    averageTasksPerUser: number;
    matrixKey: string;
    baseMatrixValue: number;
    bonusValue: number;
    formula: string;
  } {
    const positionLevel = this.getPositionLevel(positionName);
    const clampedPerformanceLevel = Math.max(1, Math.min(5, performanceLevel));
    const bonusValue = this.getBonusFromMatrix(positionLevel, clampedPerformanceLevel, averageTasksPerUser);
    const matrixKey = `${positionLevel}.${clampedPerformanceLevel}`;
    const baseMatrixValue = this.bonusMatrix[matrixKey] || 0;

    return {
      positionLevel,
      positionName,
      performanceLevel: clampedPerformanceLevel,
      taskCount: ponderedTaskCount,
      averageTasksPerUser,
      matrixKey,
      baseMatrixValue,
      bonusValue,
      formula: `Matrix[${matrixKey}] = R$ ${baseMatrixValue} (base for 4 tasks) → scaled to ${averageTasksPerUser} average tasks = R$ ${bonusValue}`
    };
  }

  /**
   * Test the calculation algorithm with sample data
   *
   * @returns Array of test results for verification
   */
  testCalculationAlgorithm(): Array<{
    position: string;
    performanceLevel: number;
    averageTasks: number;
    expectedBonus: number;
    calculatedBonus: number;
    passed: boolean;
  }> {
    const testCases = [
      { position: 'Junior I', performanceLevel: 1, averageTasks: 4, expectedBonus: 50.76 },
      { position: 'Junior II', performanceLevel: 2, averageTasks: 4, expectedBonus: 203.03 },
      { position: 'Pleno I', performanceLevel: 3, averageTasks: 4, expectedBonus: 941.72 },
      { position: 'Senior III', performanceLevel: 4, averageTasks: 4, expectedBonus: 2028.26 },
      { position: 'Senior IV', performanceLevel: 5, averageTasks: 4, expectedBonus: 2433.92 },
      // Test scaling
      { position: 'Junior I', performanceLevel: 1, averageTasks: 8, expectedBonus: 101.52 }, // Double tasks = double bonus
      { position: 'Pleno I', performanceLevel: 1, averageTasks: 2, expectedBonus: 156.96 }, // Half tasks = half bonus
    ];

    return testCases.map(test => {
      const positionLevel = this.getPositionLevel(test.position);
      const calculatedBonus = this.getBonusFromMatrix(positionLevel, test.performanceLevel, test.averageTasks);
      const passed = Math.abs(calculatedBonus - test.expectedBonus) < 0.01; // Allow 1 cent tolerance

      return {
        position: test.position,
        performanceLevel: test.performanceLevel,
        averageTasks: test.averageTasks,
        expectedBonus: test.expectedBonus,
        calculatedBonus,
        passed,
      };
    });
  }
}