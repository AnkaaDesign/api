import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { OrderScheduleService } from './order-schedule.service';
import { OrderService } from './order.service';
import { ORDER_STATUS, SCHEDULE_FREQUENCY, SCHEDULE_RUN_STATUS } from '../../../constants/enums';

/** Cascade behavior when a schedule is triggered manually before its next run.
 *  - GAP_ONLY: order covers only the days until the next scheduled run; the
 *    schedule still fires on its date (a "bridge"/top-up order).
 *  - GAP_PLUS_CYCLE: order covers the gap PLUS the next full cycle; the
 *    schedule's nextRun is advanced one interval (the absorbed cycle is skipped). */
export type OrderScheduleCascadeMode = 'GAP_ONLY' | 'GAP_PLUS_CYCLE';

/** Fires OrderSchedule rows whose `nextRun` has passed, creating one Order per
 *  due schedule and advancing `nextRun` IN PLACE — a schedule produces many
 *  orders over its lifetime (Order.orderScheduleId is a non-unique FK).
 *
 *  Concurrency / idempotency (defense in depth — the cron is registered in
 *  every PM2 cluster worker, so two workers fire each tick):
 *  - Each schedule is CLAIMED with an atomic conditional UPDATE (set
 *    `lastFiredAt`) before processing; only one worker wins, the other skips.
 *    This is pool-safe (no session-bound advisory lock that could leak across
 *    Prisma's connection pool).
 *  - The `MIN_FIRE_INTERVAL_MS` floor on `lastFiredAt` also debounces re-fires.
 *  - Skip (and self-heal `nextRun`) if a non-cancelled Order for this schedule
 *    already exists on the same São Paulo calendar day — this closes the
 *    crash-between-create-and-advance window.
 *
 *  In non-production environments the cron only runs when explicitly enabled
 *  via `ORDER_SCHEDULE_CRON_DEV=1`. A production kill-switch is available via
 *  `ORDER_SCHEDULE_CRON_ENABLED=0`. */
@Injectable()
export class OrderScheduleScheduler {
  private readonly logger = new Logger(OrderScheduleScheduler.name);
  private static readonly MIN_FIRE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderScheduleService: OrderScheduleService,
    private readonly orderService: OrderService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /** Runs hourly at minute 5 (offset so it doesn't collide with the 0-minute
   *  cron jobs). Picks the smallest unit that still gives same-day responsiveness. */
  @Cron('5 * * * *', { timeZone: 'America/Sao_Paulo' })
  async processDueOrderSchedules(): Promise<void> {
    const devEnabled = process.env.ORDER_SCHEDULE_CRON_DEV === '1';
    if (process.env.NODE_ENV !== 'production' && !devEnabled) {
      return;
    }
    // Production kill-switch for incident response.
    if (process.env.ORDER_SCHEDULE_CRON_ENABLED === '0') {
      this.logger.warn('Order-schedule cron disabled via ORDER_SCHEDULE_CRON_ENABLED=0');
      return;
    }

    await this.runDueSchedules();
  }

  private async runDueSchedules(): Promise<void> {
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
        // Atomically CLAIM the schedule so only one cluster worker processes it.
        // The conditional WHERE matches only if no other worker has already
        // bumped lastFiredAt past the floor in this window.
        const claim = await this.prisma.orderSchedule.updateMany({
          where: {
            id: schedule.id,
            isActive: true,
            finishedAt: null,
            OR: [{ lastFiredAt: null }, { lastFiredAt: { lt: fireFloor } }],
          },
          data: { lastFiredAt: now },
        });
        if (claim.count === 0) {
          // Another worker already claimed this schedule this tick — skip.
          continue;
        }

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
          // An order already exists for today but the schedule is still due:
          // a previous tick must have crashed between order creation and the
          // advance. Self-heal by advancing nextRun now (no new order).
          this.logger.warn(
            `Schedule ${schedule.id} (${schedule.name ?? '<unnamed>'}) already created order ${dupe.id} today — advancing without re-ordering`,
          );
          await this.advanceSchedule(schedule.id, {
            fired: true,
            ordered: true,
            status: SCHEDULE_RUN_STATUS.SUCCESS,
          });
          continue;
        }

        const orderData = await this.orderScheduleService.createOrderFromSchedule(schedule.id);

        if (!orderData) {
          // Schedule fired but no items need ordering — advance nextRun and lastFiredAt anyway.
          await this.advanceSchedule(schedule.id, {
            fired: true,
            ordered: false,
            status: SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS,
          });
          skippedNoItems++;
          continue;
        }

        // Persist order, then advance schedule. If order creation fails the
        // schedule fields are NOT advanced — next cron tick retries.
        const orderResp = await this.orderService.create(orderData as any, undefined);
        if (orderResp?.success) {
          await this.advanceSchedule(schedule.id, {
            fired: true,
            ordered: true,
            status: SCHEDULE_RUN_STATUS.SUCCESS,
          });
          created++;
        } else {
          failed++;
          const msg = `order creation returned non-success: ${JSON.stringify(orderResp)}`;
          this.logger.error(`Schedule ${schedule.id}: ${msg}`);
          await this.recordRunFailure(schedule.id, msg);
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Schedule ${schedule.id} failed: ${msg}`);
        await this.recordRunFailure(schedule.id, msg);
      }
    }

    this.logger.log(
      `Order-schedule run done: ${created} orders created, ${skippedNoItems} skipped (no items needed), ${failed} failed`,
    );
  }

  /** Advances `lastFiredAt` always; advances `lastRun` only when an order was
   *  created. Recomputes `nextRun` from the schedule's frequency config and
   *  finalizes ONCE schedules. Records the run outcome for observability. */
  private async advanceSchedule(
    scheduleId: string,
    {
      fired,
      ordered,
      status,
      error,
    }: { fired: boolean; ordered: boolean; status?: SCHEDULE_RUN_STATUS; error?: string },
  ): Promise<void> {
    const schedule = await this.prisma.orderSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) return;

    const now = new Date();
    const isOnce = schedule.frequency === SCHEDULE_FREQUENCY.ONCE;
    const nextRunDate = isOnce
      ? null
      : this.orderScheduleService.calculateNextRunDate(schedule as any);

    const data: Record<string, unknown> = {
      ...(fired ? { lastFiredAt: now } : {}),
      ...(ordered ? { lastRun: now } : {}),
      nextRun: nextRunDate,
    };
    if (status) {
      data.lastRunStatus = status;
      data.lastRunError = status === SCHEDULE_RUN_STATUS.FAILED ? (error ?? null) : null;
    }
    // A ONCE schedule has no further occurrences — finalize it so it doesn't
    // linger active with a stale/null nextRun (and can't double-fire).
    if (isOnce && fired) {
      data.finishedAt = now;
      data.isActive = false;
    }

    await this.prisma.orderSchedule.update({ where: { id: scheduleId }, data });
  }

  /** Records a failed run without advancing nextRun (so the tick retries). */
  private async recordRunFailure(
    scheduleId: string,
    error: string,
    triggeredBy: string = 'system',
  ): Promise<void> {
    let scheduleName: string | undefined;
    await this.prisma.orderSchedule
      .update({
        where: { id: scheduleId },
        data: { lastRunStatus: SCHEDULE_RUN_STATUS.FAILED, lastRunError: error.slice(0, 1000) },
        select: { id: true, name: true },
      })
      .then(s => {
        scheduleName = s?.name ?? undefined;
      })
      .catch(() => undefined);

    // Notify warehouse/logistics/admin that an automatic order schedule failed.
    try {
      const label = scheduleName ?? scheduleId;
      // Sanitize the raw error (which may be an English message, JSON or a
      // stack trace) into a short, human pt-BR-friendly snippet for the body.
      const shortError = (error ?? '')
        .split('\n')[0]
        .replace(/[{}[\]"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      await this.dispatchService.dispatchByConfiguration('order_schedule.run.failed', triggeredBy, {
        entityType: 'OrderSchedule',
        entityId: scheduleId,
        action: 'run_failed',
        data: {
          scheduleName: label,
          errorMessage: error.slice(0, 500),
        },
        overrides: {
          title: 'Falha no Agendamento de Pedido',
          body: shortError
            ? `Falha ao gerar o pedido agendado "${label}": ${shortError}`
            : `Falha ao gerar o pedido agendado "${label}".`,
          webUrl: `/estoque/pedidos/agendamentos/detalhes/${scheduleId}`,
          mobileUrl: `/(tabs)/estoque/pedidos`,
          relatedEntityType: 'ORDER_SCHEDULE',
        },
      });
    } catch (notifyErr) {
      this.logger.error(
        'Falha ao notificar falha de agendamento (order_schedule.run.failed):',
        notifyErr,
      );
    }
  }

  /** Compute the next run strictly after `now`, advancing from `base` and
   *  looping if `base` is itself in the past (overdue/stale schedule). */
  private computeFutureNextRun(schedule: any, base: Date, now: Date): Date | null {
    let next = this.orderScheduleService.calculateNextRunDate(schedule, base);
    let guard = 0;
    while (next && next.getTime() <= now.getTime() && guard < 120) {
      next = this.orderScheduleService.calculateNextRunDate(schedule, next);
      guard++;
    }
    return next;
  }

  /** Manually fire a schedule NOW, actually creating the order (unlike the
   *  preview-only `create-order` endpoint). The cascade mode controls both the
   *  coverage window and how `nextRun` moves:
   *   - GAP_ONLY:       coverage = days until next run; nextRun unchanged (unless
   *                     it is missing/overdue, in which case it is recomputed so
   *                     the cron can resume firing).
   *   - GAP_PLUS_CYCLE: coverage = gap + one full interval; nextRun advanced past
   *                     the absorbed cycle (looped until in the future).
   *  ONCE schedules are finished after firing regardless of mode. Reuses the
   *  cron's same-day duplicate guard and sets lastFiredAt/lastRun so the hourly
   *  cron won't double-fire. */
  async triggerNow(
    scheduleId: string,
    cascadeMode: OrderScheduleCascadeMode,
    userId?: string,
  ): Promise<{ success: boolean; message: string; data: any }> {
    const schedule = await this.prisma.orderSchedule.findUnique({
      where: { id: scheduleId },
      include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Agendamento de pedido ${scheduleId} não encontrado`);
    }
    if (schedule.finishedAt) {
      throw new BadRequestException('Este agendamento já foi finalizado.');
    }

    const now = new Date();

    // Same-day duplicate guard (mirrors the cron) — also blocks a second manual
    // trigger on the same calendar day.
    const todayStart = startOfDaySaoPaulo(now);
    const dupe = await this.prisma.order.findFirst({
      where: {
        orderScheduleId: scheduleId,
        createdAt: { gte: todayStart },
        status: { not: ORDER_STATUS.CANCELLED },
      },
      select: { id: true },
    });
    if (dupe) {
      throw new BadRequestException(
        'Este agendamento já gerou um pedido hoje. Aguarde o próximo ciclo ou cancele o pedido existente.',
      );
    }

    const { nextRun, intervalDays, gapDays } = this.orderScheduleService.getScheduleTiming(
      schedule as any,
    );
    const interval = intervalDays ?? 30;
    const coverageDays =
      cascadeMode === 'GAP_PLUS_CYCLE'
        ? Math.max(1, gapDays) + interval
        : gapDays > 0
          ? gapDays
          : interval; // GAP_ONLY with no gap (overdue/once) falls back to one interval

    const orderData = await this.orderScheduleService.buildOrderDataForCoverage(scheduleId, {
      asOfDate: now,
      coverageDays,
    });

    if (!orderData) {
      // Nothing to order right now. Record the attempt but leave nextRun so the
      // schedule keeps firing normally.
      await this.prisma.orderSchedule.update({
        where: { id: scheduleId },
        data: {
          lastFiredAt: now,
          lastRunStatus: SCHEDULE_RUN_STATUS.SKIPPED_NO_ITEMS,
          lastRunError: null,
        },
      });
      return {
        success: true,
        message: 'Nenhum item precisa ser pedido no momento. Os níveis de estoque estão adequados.',
        data: null,
      };
    }

    const orderResp = await this.orderService.create(orderData as any, undefined, userId);
    if (!orderResp?.success) {
      const msg = `order creation returned non-success: ${JSON.stringify(orderResp)}`;
      this.logger.error(`Manual trigger for schedule ${scheduleId}: ${msg}`);
      await this.recordRunFailure(scheduleId, msg, userId ?? 'system');
      throw new InternalServerErrorException('Falha ao criar o pedido a partir do agendamento.');
    }

    // Advance the schedule per cascade mode.
    const update: Record<string, unknown> = {
      lastFiredAt: now,
      lastRun: now,
      lastRunStatus: SCHEDULE_RUN_STATUS.SUCCESS,
      lastRunError: null,
    };
    if (schedule.frequency === SCHEDULE_FREQUENCY.ONCE) {
      update.finishedAt = now;
      update.isActive = false;
      update.nextRun = null;
    } else if (cascadeMode === 'GAP_PLUS_CYCLE') {
      // Skip the cycle we just absorbed: advance past the current nextRun,
      // looping until the result is in the future (handles overdue/stale nextRun).
      update.nextRun = this.computeFutureNextRun(schedule, nextRun ?? now, now);
    } else if (!nextRun || nextRun.getTime() <= now.getTime()) {
      // GAP_ONLY normally leaves nextRun so the schedule still fires on its date.
      // But if nextRun is missing/overdue, recompute it forward so the cron can
      // resume firing this schedule instead of silently stopping.
      update.nextRun = this.computeFutureNextRun(schedule, now, now);
    }
    // GAP_ONLY with a valid future nextRun leaves it untouched.
    await this.prisma.orderSchedule.update({ where: { id: scheduleId }, data: update });

    this.logger.log(
      `Manual trigger for schedule ${scheduleId} (${cascadeMode}): order created covering ${coverageDays}d (gap=${gapDays}d, interval=${interval}d)`,
    );

    return {
      success: true,
      message: `Pedido criado cobrindo ${coverageDays} dias.`,
      data: {
        order: orderResp.data,
        cascadeMode,
        coverageDays,
        gapDays,
        intervalDays,
        nextRun: update.nextRun ?? nextRun,
      },
    };
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
