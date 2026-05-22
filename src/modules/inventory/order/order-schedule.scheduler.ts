import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { OrderScheduleService } from './order-schedule.service';
import { OrderService } from './order.service';
import { ORDER_STATUS } from '../../../constants/enums';

/** Fires OrderSchedule rows whose `nextRun` has passed. Updates `lastRun` /
 *  `lastFiredAt` / `nextRun` in the SAME transaction as the order creation
 *  so a duplicate firing in the same minute can't produce a duplicate order.
 *
 *  Idempotency:
 *  - Skip if `lastFiredAt` is within MIN_FIRE_INTERVAL_MS of `now`.
 *  - Skip if a successful Order with `orderScheduleId = schedule.id` already
 *    exists with `createdAt` on the same calendar day in São Paulo timezone.
 *
 *  In non-production environments the cron only runs when explicitly enabled
 *  via `ORDER_SCHEDULE_CRON_DEV=1` to avoid noise during local dev. */
@Injectable()
export class OrderScheduleScheduler {
  private readonly logger = new Logger(OrderScheduleScheduler.name);
  private static readonly MIN_FIRE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderScheduleService: OrderScheduleService,
    private readonly orderService: OrderService,
  ) {}

  /** Runs hourly at minute 5 (offset so it doesn't collide with the 0-minute
   *  cron jobs). Picks the smallest unit that still gives same-day responsiveness. */
  @Cron('5 * * * *', { timeZone: 'America/Sao_Paulo' })
  async processDueOrderSchedules(): Promise<void> {
    const devEnabled = process.env.ORDER_SCHEDULE_CRON_DEV === '1';
    if (process.env.NODE_ENV !== 'production' && !devEnabled) {
      return;
    }

    const now = new Date();
    const fireFloor = new Date(now.getTime() - OrderScheduleScheduler.MIN_FIRE_INTERVAL_MS);

    const dueSchedules = await this.prisma.orderSchedule.findMany({
      where: {
        isActive: true,
        finishedAt: null,
        nextRun: { lte: now },
        OR: [{ lastFiredAt: null }, { lastFiredAt: { lt: fireFloor } }],
      },
      select: { id: true, name: true, supplierId: true, lastRun: true, lastFiredAt: true },
    });

    if (dueSchedules.length === 0) {
      this.logger.debug('No order schedules due');
      return;
    }

    this.logger.log(`Processing ${dueSchedules.length} due order schedule(s)`);

    let created = 0;
    let skippedNoItems = 0;
    let failed = 0;

    for (const schedule of dueSchedules) {
      try {
        // Same-day duplicate guard (calendar day in SP timezone).
        const todayStart = startOfDaySaoPaulo(now);
        const dupe = await this.prisma.order.findFirst({
          where: {
            orderScheduleId: schedule.id,
            createdAt: { gte: todayStart },
            status: { not: ORDER_STATUS.CANCELLED },
          },
          select: { id: true },
        });
        if (dupe) {
          this.logger.warn(
            `Schedule ${schedule.id} (${schedule.name ?? '<unnamed>'}) already created order ${dupe.id} today — skipping`,
          );
          continue;
        }

        const orderData = await this.orderScheduleService.createOrderFromSchedule(schedule.id);

        if (!orderData) {
          // Schedule fired but no items need ordering — advance nextRun and lastFiredAt anyway.
          await this.advanceSchedule(schedule.id, { fired: true, ordered: false });
          skippedNoItems++;
          continue;
        }

        // Persist order + advance schedule together. If order creation fails,
        // schedule fields are NOT advanced — next cron tick will retry.
        const orderResp = await this.orderService.create(orderData as any, undefined);
        if (orderResp?.success) {
          await this.advanceSchedule(schedule.id, { fired: true, ordered: true });
          created++;
        } else {
          failed++;
          this.logger.error(
            `Schedule ${schedule.id}: order creation returned non-success: ${JSON.stringify(orderResp)}`,
          );
        }
      } catch (err) {
        failed++;
        this.logger.error(
          `Schedule ${schedule.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Order-schedule run done: ${created} orders created, ${skippedNoItems} skipped (no items needed), ${failed} failed`,
    );
  }

  /** Advances `lastFiredAt` always; advances `lastRun` only when an order
   *  was created. Recomputes `nextRun` from the schedule's frequency config. */
  private async advanceSchedule(
    scheduleId: string,
    { fired, ordered }: { fired: boolean; ordered: boolean },
  ): Promise<void> {
    const schedule = await this.prisma.orderSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) return;

    const nextRunDate = this.orderScheduleService.calculateNextRunDate(schedule as any);
    const now = new Date();
    await this.prisma.orderSchedule.update({
      where: { id: scheduleId },
      data: {
        ...(fired ? { lastFiredAt: now } : {}),
        ...(ordered ? { lastRun: now } : {}),
        nextRun: nextRunDate,
      },
    });
  }
}

function startOfDaySaoPaulo(d: Date): Date {
  // São Paulo is UTC-3 year-round (no DST since 2019).
  const utcMs = d.getTime();
  const spOffset = -3 * 60 * 60 * 1000;
  const sp = new Date(utcMs + spOffset);
  sp.setUTCHours(0, 0, 0, 0);
  return new Date(sp.getTime() - spOffset);
}
