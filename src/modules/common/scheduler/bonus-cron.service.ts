import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BonusService } from '../../human-resources/bonus/bonus.service';
import { PayrollService } from '../../human-resources/payroll/payroll.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class BonusCronService {
  private readonly logger = new Logger(BonusCronService.name);
  private readonly PREWARM_LOCK_KEY = 'bonus:prewarm:lock';
  private readonly PREWARM_LOCK_TTL_SEC = 25 * 60; // 25 min (< cron interval of 30 min)

  constructor(
    private readonly bonusService: BonusService,
    private readonly payrollService: PayrollService,
    private readonly cacheService: CacheService,
  ) {}

  // REMOVED: Daily draft updates - bonuses are now calculated LIVE during current period
  // Only the monthly finalization on the 6th saves data to database

  // Run at midnight (00:00) on the 6th of every month to finalize bonuses and create payrolls
  // This runs AFTER the grace period (26th to 5th) which allows fixing commission status errors
  // Period being saved: 26th of previous month to 25th of current month
  // Example: December 6th saves November period (Oct 26 - Nov 25)
  // The period just closed on the 25th, and now after the 5th grace period we save it
  @Cron('0 0 6 * *', { timeZone: 'America/Sao_Paulo' })
  async handleMonthlyBonusAndPayrollFinalization() {
    this.logger.log('Starting monthly bonus and payroll finalization...');

    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1; // 1-12
      const currentYear = now.getFullYear();

      // On the 6th, we save the period that just ended on the 25th of PREVIOUS month
      // The 5th day rule means: days 1-5 = previous period, days 6+ = current period
      // So on Dec 6th, current period switches to December
      // But we need to save November's period (Oct 26 - Nov 25) which just closed
      let periodMonth = currentMonth - 1;
      let periodYear = currentYear;

      if (periodMonth === 0) {
        periodMonth = 12;
        periodYear = currentYear - 1;
      }

      const year = periodYear.toString();
      const month = periodMonth.toString().padStart(2, '0');

      this.logger.log(`Finalizing bonuses and payrolls for period: ${year}/${month}`);

      // Step 1: Calculate and save bonuses for all users FIRST
      // This creates bonus records even for non-eligible users (with value 0)
      // By running on the 6th (after the 5th grace period), all commission status
      // corrections made between the 25th-5th are included in the saved calculations
      // IMPORTANT: Bonuses must be saved BEFORE payrolls so payroll can reference netBonus
      this.logger.log('Step 1: Calculating and saving bonuses...');
      const bonusResult = await this.bonusService.calculateAndSaveBonuses(year, month, 'system');
      this.logger.log(
        `Bonus calculation completed. Success: ${bonusResult.totalSuccess}, Failed: ${bonusResult.totalFailed}`,
      );

      // Log warning if there were failures
      if (bonusResult.totalFailed > 0) {
        this.logger.error(`Failed to calculate bonuses for ${bonusResult.totalFailed} users`);
      }

      // Step 2: Generate payrolls for all active users (uses saved netBonus)
      this.logger.log('Step 2: Generating payrolls for all active users...');
      const payrollResult = await this.payrollService.generateForMonth(
        parseInt(year),
        parseInt(month),
        'system',
      );
      this.logger.log(
        `Payroll generation completed. Created: ${payrollResult.created}, Skipped: ${payrollResult.skipped}, Errors: ${payrollResult.errors?.length || 0}`,
      );

      // Log errors if any
      if (payrollResult.errors && payrollResult.errors.length > 0) {
        this.logger.error('Payroll generation errors:', payrollResult.errors);
      }

      // Log success summary
      this.logger.log(`Monthly finalization completed successfully.`);
      this.logger.log(
        `- Payrolls: ${payrollResult.created} created, ${payrollResult.skipped} skipped, ${payrollResult.errors?.length || 0} errors`,
      );
      this.logger.log(`- Bonuses: ${bonusResult.totalSuccess} calculated`);
    } catch (error) {
      this.logger.error('Failed to run monthly bonus and payroll finalization', error);
    }
  }

  // Optional: Run a test calculation on demand (can be triggered manually)
  async runManualBonusCalculation(year: string, month: string, userId?: string) {
    this.logger.log(`Running manual bonus calculation for ${year}/${month}`);

    try {
      // Validate the period
      if (!year || !month) {
        throw new Error('Year and month are required for manual calculation');
      }

      // Log who triggered the manual calculation
      const triggeredBy = userId ? `user: ${userId}` : 'system';
      this.logger.log(`Manual bonus calculation triggered by ${triggeredBy}`);

      // Use calculateAndSaveBonuses which properly determines bonus status
      const result = await this.bonusService.calculateAndSaveBonuses(
        year,
        month,
        userId || 'system',
      );

      this.logger.log(
        `Manual bonus calculation completed for ${year}/${month}. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`,
      );

      return {
        success: true,
        data: result,
        message: `Cálculo manual de bônus concluído: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas`,
      };
    } catch (error) {
      this.logger.error('Failed to run manual bonus calculation', error);
      throw error;
    }
  }

  // Optional: Get next scheduled execution time
  getNextExecutionTime(): Date {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    let nextExecution: Date;

    // If we're before the 6th of this month, next execution is this month's 6th at midnight
    if (currentDay < 6) {
      nextExecution = new Date(currentYear, currentMonth, 6, 0, 0, 0);
    } else {
      // Otherwise, it's the 6th of next month
      nextExecution = new Date(currentYear, currentMonth + 1, 6, 0, 0, 0);
    }

    return nextExecution;
  }

  // Optional: Check if today is bonus/payroll calculation day
  isBonusCalculationDay(): boolean {
    const now = new Date();
    return now.getDate() === 6;
  }

  /**
   * Pre-warm the live-bonus SWR cache every 30 minutes during São Paulo working hours.
   *
   * Flow:
   * 1. Acquire a Redis lock (`bonus:prewarm:lock`, 25 min TTL) so parallel API instances
   *    don't all fan-out to Secullum at the same tick. If the lock exists, skip this run.
   * 2. Determine the current bonus period (26th-to-25th — the 5th-day rule pushes the
   *    period forward on day 6). We pre-warm only this period.
   * 3. Call `calculateLiveBonuses(year, month)` — the cache wrapper writes the result
   *    to Redis; any Secullum day-cache entries it touches are also warmed.
   * 4. On any error, log and release the lock on next expiration (do not rethrow — we
   *    don't want a pre-warm failure to page on-call).
   */
  @Cron('*/30 8-18 * * 1-5', { timeZone: 'America/Sao_Paulo' })
  async handleLiveBonusPrewarm() {
    // Cheap non-atomic lock: if key exists, another instance/tick already has it.
    // Not a strict mutex — worst case two instances both pre-warm for one tick.
    let alreadyLocked = false;
    try {
      alreadyLocked = await this.cacheService.exists(this.PREWARM_LOCK_KEY);
    } catch (err) {
      this.logger.warn(
        `[PREWARM] Failed to read lock key: ${(err as Error)?.message || err}. Proceeding anyway.`,
      );
    }
    if (alreadyLocked) {
      this.logger.debug('[PREWARM] Lock held by another instance/tick — skipping.');
      return;
    }

    try {
      await this.cacheService.set(this.PREWARM_LOCK_KEY, '1', this.PREWARM_LOCK_TTL_SEC);
    } catch (err) {
      this.logger.warn(
        `[PREWARM] Failed to set lock: ${(err as Error)?.message || err}. Aborting this tick.`,
      );
      return;
    }

    const startedAt = Date.now();
    const { year, month } = this.getCurrentBonusPeriod();

    this.logger.log(`[PREWARM] Starting live-bonus cache warm for ${year}/${month}`);

    try {
      const result = await this.bonusService.calculateLiveBonuses(year, month);
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[PREWARM] Completed ${year}/${month} in ${durationMs}ms — ` +
          `users=${result.bonuses?.length ?? 0} weightedTasks=${result.totalWeightedTasks}`,
      );
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[PREWARM] Failed for ${year}/${month} after ${durationMs}ms: ${(err as Error)?.message || err}`,
      );
      // Release the lock so the next tick can retry immediately.
      try {
        await this.cacheService.del(this.PREWARM_LOCK_KEY);
      } catch {
        /* best-effort — will expire via TTL */
      }
    }
  }

  /**
   * Current bonus period respects the 5th-day rule: days 1-5 still belong to the
   * previous period, days 6+ belong to the current calendar month.
   */
  private getCurrentBonusPeriod(): { year: number; month: number } {
    const now = new Date();
    const day = now.getDate();
    let month = now.getMonth() + 1;
    let year = now.getFullYear();
    if (day <= 5) {
      month = month - 1;
      if (month === 0) {
        month = 12;
        year = year - 1;
      }
    }
    return { year, month };
  }
}
