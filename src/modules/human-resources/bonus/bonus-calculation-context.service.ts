// bonus-calculation-context.service.ts
//
// Resolves the inputs the salary-based bonus algorithm needs from the DB:
//   • salaryRange    — [min, max] across all bonifiable positions' "current"
//                       remuneration. Fixed pool (matches HTML simulator behavior).
//   • salaryByPositionId — per-position salary used as the user's salary input.
//
// Centralizing this here means call sites in BonusService, PayrollCalculator,
// and BonusPrismaRepository never re-implement salary lookup, and the
// "what does a position's current salary mean" definition lives in one place.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type { SalaryRange } from './bonus-calculation.service';

export interface BonusCalculationContext {
  salaryRange: SalaryRange;
  salaryByPositionId: Map<string, number>;
  /** Lower-cased position name → current salary. Lets clients (the web/mobile
   * simulators) pass `positionName` without having to track positionIds. */
  salaryByPositionName: Map<string, number>;
}

@Injectable()
export class BonusCalculationContextService {
  private readonly logger = new Logger(BonusCalculationContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads salary range + per-position salaries in a single query.
   * Salaries come from MonetaryValue rows where `current = true`. If a position
   * has multiple `current` rows (data error), the most recent by createdAt wins.
   */
  async load(): Promise<BonusCalculationContext> {
    const positions = await this.prisma.position.findMany({
      where: { bonifiable: true },
      select: {
        id: true,
        name: true,
        remunerations: {
          where: { current: true },
          select: { value: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const salaryByPositionId = new Map<string, number>();
    const salaryByPositionName = new Map<string, number>();
    const salaries: number[] = [];

    for (const p of positions) {
      const salary = p.remunerations[0]?.value;
      if (salary && salary > 0) {
        salaryByPositionId.set(p.id, salary);
        salaryByPositionName.set(p.name.toLowerCase().trim(), salary);
        salaries.push(salary);
      }
    }

    if (salaries.length === 0) {
      this.logger.warn(
        'No bonifiable positions with current remuneration found — bonus calculation will return 0 for all users',
      );
      return {
        salaryRange: { min: 0, max: 0 },
        salaryByPositionId,
        salaryByPositionName,
      };
    }

    return {
      salaryRange: {
        min: Math.min(...salaries),
        max: Math.max(...salaries),
      },
      salaryByPositionId,
      salaryByPositionName,
    };
  }

  /**
   * Resolve a single user's salary from the loaded context.
   * Returns 0 if the user has no position or the position has no current salary.
   */
  resolveSalary(
    context: BonusCalculationContext,
    user: { position?: { id: string } | null },
  ): number {
    if (!user.position?.id) return 0;
    return context.salaryByPositionId.get(user.position.id) ?? 0;
  }
}
