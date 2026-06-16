import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BonusService } from '../../human-resources/bonus/bonus.service';
import { PayrollService } from '../../human-resources/payroll/payroll.service';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';
import { BONIFIABLE_USER_WHERE } from '../../../utils/contract';

@Injectable()
export class BonusCronService {
  private readonly logger = new Logger(BonusCronService.name);
  private readonly PREWARM_LOCK_KEY = 'bonus:prewarm:lock';
  private readonly PREWARM_LOCK_TTL_SEC = 25 * 60; // 25 min (< cron interval of 30 min)

  constructor(
    private readonly bonusService: BonusService,
    private readonly payrollService: PayrollService,
    private readonly cacheService: CacheService,
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  // Runs daily at 01:00 SP time.
  // Primary attempt: day 5 (payment day). Retry window: days 6–10.
  // After day 10 the window closes — the next period is already live.
  // Idempotent: skips each step that already has saved records for the period.
  @Cron('0 1 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleMonthlyBonusAndPayrollFinalization() {
    const now = new Date();
    const currentDay = now.getDate();

    // Only run within the retry window (5th = primary, 6th–10th = retries)
    if (currentDay < 5 || currentDay > 10) {
      this.logger.debug(
        `[FINALIZATION] Day ${currentDay} — outside save window (5–10). Skipping.`,
      );
      return;
    }

    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Target: previous calendar month (the period that closed on the 25th)
    let periodMonth = currentMonth - 1;
    let periodYear = currentYear;
    if (periodMonth === 0) {
      periodMonth = 12;
      periodYear = currentYear - 1;
    }

    const year = periodYear.toString();
    const month = periodMonth.toString().padStart(2, '0');
    const attempt = currentDay - 4; // attempt 1 = day 5, attempt 6 = day 10

    this.logger.log(
      `[FINALIZATION] Day ${currentDay} — attempt ${attempt}/6 for period ${year}/${month}`,
    );

    try {
      // Check what is already persisted for this period
      const [savedBonusCount, savedPayrollCount, expectedUserCount] = await Promise.all([
        this.prisma.bonus.count({ where: { year: periodYear, month: periodMonth } }),
        this.prisma.payroll.count({ where: { year: periodYear, month: periodMonth } }),
        this.prisma.user.count({
          where: {
            ...BONIFIABLE_USER_WHERE,
            payrollNumber: { not: null },
            secullumEmployeeId: { not: null },
          },
        }),
      ]);

      // Bonuses are complete only when every currently-eligible user has a record.
      // A partial count (savedBonusCount > 0 but < expected) means the first run
      // succeeded for some users but new hires were added after — must re-run upsert.
      const bonusesComplete = savedBonusCount >= expectedUserCount && expectedUserCount > 0;

      if (bonusesComplete && savedPayrollCount > 0) {
        this.logger.log(
          `[FINALIZATION] Period ${year}/${month} already complete` +
            ` (${savedBonusCount}/${expectedUserCount} bonuses, ${savedPayrollCount} payrolls). Nothing to do.`,
        );
        return;
      }

      // Step 1 — bonuses (skip only if all expected users already have records)
      if (bonusesComplete) {
        this.logger.log(
          `[FINALIZATION] Step 1 already done (${savedBonusCount}/${expectedUserCount} bonuses). Skipping.`,
        );
      } else {
        this.logger.log(
          `[FINALIZATION] Step 1: Calculating and saving bonuses for ${year}/${month}` +
            ` (${savedBonusCount} existing / ${expectedUserCount} expected)...`,
        );
        const bonusResult = await this.bonusService.calculateAndSaveBonuses(year, month, 'system');
        this.logger.log(
          `[FINALIZATION] Bonuses: ${bonusResult.totalSuccess} ok, ${bonusResult.totalFailed} failed`,
        );
        if (bonusResult.totalFailed > 0) {
          this.logger.error(
            `[FINALIZATION] ${bonusResult.totalFailed} bonus failures — will retry tomorrow if within window`,
          );
          await this.notifyFinalization('failed', year, month, {
            stage: 'Bônus',
            detail: `${bonusResult.totalFailed} falha(s) no cálculo de bônus`,
          });
          return; // do not advance to payroll if bonuses are incomplete
        }
      }

      // Step 2 — payrolls (skip if already saved)
      if (savedPayrollCount > 0) {
        this.logger.log(
          `[FINALIZATION] Step 2 already done (${savedPayrollCount} payrolls). Skipping.`,
        );
      } else {
        this.logger.log(`[FINALIZATION] Step 2: Generating payrolls for ${year}/${month}...`);
        const payrollResult = await this.payrollService.generateForMonth(
          parseInt(year),
          parseInt(month),
          'system',
        );
        this.logger.log(
          `[FINALIZATION] Payrolls: ${payrollResult.created} created,` +
            ` ${payrollResult.skipped} skipped, ${payrollResult.errors?.length || 0} errors`,
        );
        if (payrollResult.errors && payrollResult.errors.length > 0) {
          this.logger.error('[FINALIZATION] Payroll errors:', payrollResult.errors);
          await this.notifyFinalization('failed', year, month, {
            stage: 'Folha de pagamento',
            detail: `${payrollResult.errors.length} erro(s) ao gerar a folha`,
          });
          return;
        }
      }

      this.logger.log(`[FINALIZATION] Period ${year}/${month} finalization complete.`);
      await this.notifyFinalization('succeeded', year, month, {
        detail: `Bônus e folha de pagamento do período ${month}/${year} finalizados.`,
      });
    } catch (error) {
      this.logger.error(
        `[FINALIZATION] Failed on attempt ${attempt}/6 — will retry tomorrow if within window`,
        error,
      );
      await this.notifyFinalization('failed', year, month, {
        detail: `Erro inesperado na finalização (tentativa ${attempt}/6): ${(error as Error)?.message || error}`,
      });
    }
  }

  /**
   * Emits payroll.finalization.succeeded / payroll.finalization.failed.
   * System-triggered; never throws (notification failures must not break the cron).
   */
  private async notifyFinalization(
    outcome: 'succeeded' | 'failed',
    year: string,
    month: string,
    opts: { stage?: string; detail: string },
  ): Promise<void> {
    try {
      const period = `${month}/${year}`;
      const isFailure = outcome === 'failed';
      await this.dispatchService.dispatchByConfiguration(
        `payroll.finalization.${outcome}`,
        'system',
        {
          entityType: 'Payroll',
          entityId: `${year}-${month}`,
          action: `finalization_${outcome}`,
          data: {
            period,
            year,
            month,
            stage: opts.stage,
            detail: opts.detail,
          },
          overrides: {
            webUrl: '/recursos-humanos/folha-de-pagamento',
            mobileUrl: '/(tabs)/recursos-humanos/folha-de-pagamento',
            relatedEntityType: 'PAYROLL',
            title: isFailure
              ? `Falha na finalização da folha (${period})`
              : `Folha de pagamento finalizada (${period})`,
            body: opts.detail,
          },
        },
      );
    } catch (err) {
      this.logger.error(
        `[FINALIZATION] Failed to dispatch payroll.finalization.${outcome} notification`,
        err as Error,
      );
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

    // If we're before the 5th of this month, next execution is this month's 5th at 1 AM
    if (currentDay < 5) {
      nextExecution = new Date(currentYear, currentMonth, 5, 1, 0, 0);
    } else {
      // Otherwise, it's the 5th of next month
      nextExecution = new Date(currentYear, currentMonth + 1, 5, 1, 0, 0);
    }

    return nextExecution;
  }

  // Optional: Check if today is bonus/payroll calculation day
  isBonusCalculationDay(): boolean {
    const now = new Date();
    return now.getDate() === 5;
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
