import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { RecurrentPayableService } from './recurrent-payable.service';

/** Materializes due RecurrentPayableOccurrences for each active RecurrentPayable
 *  whose `nextRun` has passed (one per competence for monthly bills, a rolling
 *  horizon of due dates for weekly bills), then advances `nextRun` — the
 *  advance-in-place + atomic-claim pattern borrowed from OrderScheduleScheduler.
 *
 *  Concurrency (the cron runs in every PM2 worker): each payable is CLAIMED with
 *  an atomic conditional UPDATE on `lastFiredAt` before processing; only one
 *  worker wins. The occurrence's unique [payableId, dueDate] is the final
 *  idempotency backstop. */
@Injectable()
export class RecurrentPayableScheduler {
  private readonly logger = new Logger(RecurrentPayableScheduler.name);
  private static readonly MIN_FIRE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: RecurrentPayableService,
  ) {}

  /** Daily at 05:15 BRT (offset off the 0/4/5-minute crons). */
  @Cron('15 5 * * *', { timeZone: 'America/Sao_Paulo' })
  async processDueRecurrentPayables(): Promise<void> {
    const devEnabled = process.env.RECURRENT_PAYABLE_CRON_DEV === '1';
    if (process.env.NODE_ENV !== 'production' && !devEnabled) return;
    if (process.env.RECURRENT_PAYABLE_CRON_ENABLED === '0') {
      this.logger.warn('Recurrent-payable cron disabled via RECURRENT_PAYABLE_CRON_ENABLED=0');
      return;
    }
    await this.runDue();
  }

  /** Public entry point for the dev/manual trigger endpoint. */
  async runDue(): Promise<{ materialized: number; failed: number; settled?: number; linked?: number }> {
    const now = new Date();
    const fireFloor = new Date(now.getTime() - RecurrentPayableScheduler.MIN_FIRE_INTERVAL_MS);

    const due = await this.prisma.recurrentPayable.findMany({
      where: {
        isActive: true,
        nextRun: { lte: now },
        OR: [{ lastFiredAt: null }, { lastFiredAt: { lt: fireFloor } }],
      },
    });
    if (due.length === 0) {
      this.logger.debug('No recurrent payables due');
      return { materialized: 0, failed: 0 };
    }

    let materialized = 0;
    let failed = 0;
    for (const payable of due) {
      try {
        // Atomically CLAIM so only one cluster worker processes this payable.
        const claim = await this.prisma.recurrentPayable.updateMany({
          where: {
            id: payable.id,
            isActive: true,
            OR: [{ lastFiredAt: null }, { lastFiredAt: { lt: fireFloor } }],
          },
          data: { lastFiredAt: now },
        });
        if (claim.count === 0) continue; // another worker won the race

        const anchor = payable.nextRun ?? now;
        // Monthly bills materialize the anchor month; weekly bills fill a rolling
        // horizon of due dates from today.
        await this.service.materializeDue(payable, anchor, now);

        await this.prisma.recurrentPayable.update({
          where: { id: payable.id },
          data: {
            lastRun: now,
            lastRunStatus: 'SUCCESS',
            lastRunError: null,
            nextRun: this.service.computeNextRun(payable, anchor),
          },
        });
        materialized++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`RecurrentPayable ${payable.id} failed: ${msg}`);
        // Leave nextRun untouched so the next tick retries.
        await this.prisma.recurrentPayable
          .update({
            where: { id: payable.id },
            data: { lastRunStatus: 'FAILED', lastRunError: msg.slice(0, 1000) },
          })
          .catch(() => undefined);
      }
    }

    // Close the loop: first give uncategorized debits the category of the recurring
    // payee they were paid to (CNPJ match — the category source for no-NF bills),
    // then settle occurrences whose category got a tagged bank debit (manual or
    // auto), link inbound NFs for expectsNf payables, and age past-due open
    // occurrences to OVERDUE.
    let settled = 0;
    let linked = 0;
    let overdue = 0;
    try {
      await this.service.categorizeFromPayeeCnpj();
      settled = await this.service.reconcilePendingFromBank();
      linked = await this.service.linkPendingNfs();
      overdue = await this.service.markOverdueOccurrences();
    } catch (err) {
      this.logger.error(`Recurrent-payable sweep failed: ${err instanceof Error ? err.message : err}`);
    }

    this.logger.log(
      `Recurrent-payable run done: ${materialized} materialized, ${settled} settled, ${linked} NF linked, ${overdue} overdue, ${failed} failed`,
    );
    return { materialized, failed, settled, linked };
  }
}
