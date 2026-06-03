import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';

/**
 * Learns the cadence (period + amount) of recurring counterparty payments so we
 * can flag a transaction as "recurring", spot amount anomalies, and forecast
 * the upcoming monthly recurring spend.
 *
 * NOT a CategoryLearner — it does not emit category signals; it observes the
 * already-categorized stream and maintains per-(counterparty, category) EWMA
 * statistics. All public methods are best-effort.
 */

/** EWMA smoothing factor for both amount and period statistics. */
const EWMA_ALPHA = 0.4;
/** Minimum observations before a cadence is considered "recurring". */
const MIN_SAMPLES_RECURRING = 3;
/** Period coefficient-of-variation ceiling for "recurring" (regularity gate). */
const MAX_PERIOD_CV = 0.35;
/** Anomaly threshold in standard deviations of amount. */
const ANOMALY_K = 2;

const MS_PER_DAY = 86_400_000;

@Injectable()
export class RecurrenceLearnerService {
  private readonly logger = new Logger(RecurrenceLearnerService.name);

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Record one observation of a (counterparty, category) cadence and update its
   * EWMA period/amount statistics. Idempotent per transaction.
   */
  async recordCadence(opts: {
    counterpartyKey: string;
    counterpartyLabel?: string | null;
    categoryId: string;
    transactionId: string;
    occurredAt: Date;
    amount: number;
  }): Promise<void> {
    try {
      await this.prisma.$transaction(async (db) => {
        // Ensure the cadence row exists.
        const cadence = await db.counterpartyCadence.upsert({
          where: {
            counterpartyKey_categoryId: {
              counterpartyKey: opts.counterpartyKey,
              categoryId: opts.categoryId,
            },
          },
          create: {
            counterpartyKey: opts.counterpartyKey,
            counterpartyLabel: opts.counterpartyLabel ?? null,
            categoryId: opts.categoryId,
            sampleCount: 0,
            isLearnedRecurring: false,
          },
          update: {
            ...(opts.counterpartyLabel
              ? { counterpartyLabel: opts.counterpartyLabel }
              : {}),
          },
        });

        const absAmount = Math.abs(opts.amount);

        // Dedupe: only proceed when this transaction is a brand-new observation.
        const created = await db.cadenceObservation.createMany({
          data: [
            {
              cadenceId: cadence.id,
              transactionId: opts.transactionId,
              occurredAt: opts.occurredAt,
              amount: absAmount,
            },
          ],
          skipDuplicates: true,
        });
        if (created.count === 0) return;

        const prevSamples = cadence.sampleCount;
        const nextSamples = prevSamples + 1;

        // --- Amount EWMA + incremental (West) variance --------------------
        const prevExpected =
          cadence.expectedAmount != null ? Number(cadence.expectedAmount) : null;
        const prevAmountVar = cadence.amountVariance;

        let nextExpected: number;
        let nextAmountVar: number;
        if (prevExpected == null) {
          nextExpected = absAmount;
          nextAmountVar = 0;
        } else {
          const delta = absAmount - prevExpected;
          nextExpected = prevExpected + EWMA_ALPHA * delta;
          const incVar = (1 - EWMA_ALPHA) * (prevAmountVar ?? 0) + EWMA_ALPHA * delta * delta;
          nextAmountVar = incVar;
        }

        // --- Period EWMA + variance (gap in days from previous lastSeenAt)--
        let nextMeanPeriod = cadence.meanPeriodDays;
        let nextPeriodVar = cadence.periodVarianceDays;
        if (cadence.lastSeenAt) {
          const gapDays = (opts.occurredAt.getTime() - cadence.lastSeenAt.getTime()) / MS_PER_DAY;
          if (gapDays > 0) {
            if (nextMeanPeriod == null) {
              nextMeanPeriod = gapDays;
              nextPeriodVar = 0;
            } else {
              const pDelta = gapDays - nextMeanPeriod;
              nextMeanPeriod = nextMeanPeriod + EWMA_ALPHA * pDelta;
              nextPeriodVar =
                (1 - EWMA_ALPHA) * (nextPeriodVar ?? 0) + EWMA_ALPHA * pDelta * pDelta;
            }
          }
        }

        // --- Regularity / recurring decision ------------------------------
        let periodCv: number | null = null;
        if (nextMeanPeriod != null && nextMeanPeriod > 0 && nextPeriodVar != null) {
          periodCv = Math.sqrt(nextPeriodVar) / nextMeanPeriod;
        }
        const isLearnedRecurring =
          nextSamples >= MIN_SAMPLES_RECURRING &&
          periodCv != null &&
          periodCv <= MAX_PERIOD_CV;

        await db.counterpartyCadence.update({
          where: { id: cadence.id },
          data: {
            sampleCount: nextSamples,
            expectedAmount: nextExpected,
            amountVariance: nextAmountVar,
            meanPeriodDays: nextMeanPeriod,
            periodVarianceDays: nextPeriodVar,
            periodCv,
            isLearnedRecurring,
            lastSeenAt: opts.occurredAt,
            lastAmount: absAmount,
          },
        });
      });
    } catch (err) {
      this.logger.warn(`recordCadence failed: ${(err as Error)?.message ?? err}`);
    }
  }

  /** Detect whether an amount deviates from a cadence's learned expectation. */
  amountAnomaly(
    c: { expectedAmount: Prisma.Decimal | null; amountVariance: number | null },
    amount: number,
  ): { anomalous: boolean; expected: number; z: number } | null {
    if (c.expectedAmount == null) return null;
    const expected = Number(c.expectedAmount);
    const variance = c.amountVariance ?? 0;
    const std = Math.sqrt(Math.max(0, variance));
    const absAmount = Math.abs(amount);
    const z = std > 0 ? Math.abs(absAmount - expected) / std : 0;
    return {
      anomalous: std > 0 && z >= ANOMALY_K,
      expected,
      z,
    };
  }

  /** Forecast the upcoming recurring spend relative to a reference date. */
  async forecast(
    reference: Date,
  ): Promise<{ reference: Date; expectedMonthlyTotal: number; items: any[] }> {
    const cadences = await this.prisma.counterpartyCadence.findMany({
      where: { isLearnedRecurring: true },
      include: {
        category: { select: { id: true, name: true, slug: true, color: true } },
      },
    });

    let expectedMonthlyTotal = 0;
    const items = cadences.map((c) => {
      const expected = c.expectedAmount != null ? Number(c.expectedAmount) : 0;
      const lastAmount = c.lastAmount != null ? Number(c.lastAmount) : null;

      let nextDueAt: Date | null = null;
      if (c.lastSeenAt && c.meanPeriodDays != null) {
        nextDueAt = new Date(c.lastSeenAt.getTime() + c.meanPeriodDays * MS_PER_DAY);
      }
      const overdue = nextDueAt != null && nextDueAt.getTime() < reference.getTime();

      const lastAnomaly =
        lastAmount != null
          ? this.amountAnomaly(
              { expectedAmount: c.expectedAmount, amountVariance: c.amountVariance },
              lastAmount,
            )
          : null;

      expectedMonthlyTotal += expected;

      return {
        cadenceId: c.id,
        counterpartyKey: c.counterpartyKey,
        counterpartyLabel: c.counterpartyLabel,
        category: c.category,
        expectedAmount: expected,
        lastAmount,
        meanPeriodDays: c.meanPeriodDays,
        periodCv: c.periodCv,
        nextDueAt,
        overdue,
        sampleCount: c.sampleCount,
        lastAnomaly,
      };
    });

    return { reference, expectedMonthlyTotal, items };
  }
}
