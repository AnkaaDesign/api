import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { MaintenanceScheduleService } from './maintenance-schedule.service';

/**
 * MaintenanceNotificationScheduler
 *
 * Daily cron that notifies the MAINTENANCE sector about maintenance schedules
 * that are DUE (nextRun reached) or OVERDUE. Sector targeting is handled by the
 * notification configuration target rule (seeded separately); here we only emit
 * with pt-BR overrides + deep links.
 *
 * Config keys emitted (NEW):
 *  - maintenance.due
 *  - maintenance.overdue
 *
 * Everything is additive and guarded so a notification failure never aborts the
 * run.
 *
 * TODO: cadence is "every day while due/overdue"; if the product wants a single
 *       notification per schedule, add a lastNotifiedAt column / dedup.
 */
@Injectable()
export class MaintenanceNotificationScheduler {
  private readonly logger = new Logger(MaintenanceNotificationScheduler.name);

  constructor(
    private readonly maintenanceScheduleService: MaintenanceScheduleService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleDailyMaintenanceNotifications(): Promise<void> {
    this.logger.log('Running daily maintenance schedule notifications...');
    // Overdue runs first; its ids are excluded from the due pass so a single
    // overdue schedule is never notified twice (getDueSchedules uses nextRun<=now
    // which overlaps the overdue set nextRun<now).
    const overdueIds = new Set<string>();
    try {
      await this.notifyOverdueSchedules(overdueIds);
    } catch (error) {
      this.logger.error('Error notifying overdue maintenance schedules:', error);
    }
    try {
      await this.notifyDueSchedules(overdueIds);
    } catch (error) {
      this.logger.error('Error notifying due maintenance schedules:', error);
    }
    this.logger.log('Daily maintenance schedule notifications finished.');
  }

  private maintenanceWebUrl(scheduleId: string): string {
    return `/estoque/manutencao/agendamentos/detalhes/${scheduleId}`;
  }

  private async notifyOverdueSchedules(overdueIds: Set<string>): Promise<void> {
    const overdue = await this.maintenanceScheduleService.getOverdueSchedules();
    if (!overdue || overdue.length === 0) return;
    this.logger.log(`Notifying ${overdue.length} overdue maintenance schedule(s).`);

    for (const schedule of overdue) {
      overdueIds.add(schedule.id);
      try {
        const itemName = (schedule as any).item?.name || 'Item desconhecido';
        const scheduleName = schedule.name || 'Agendamento de manutenção';
        const nextRun = schedule.nextRun ? new Date(schedule.nextRun) : null;
        const daysOverdue = nextRun
          ? Math.max(0, Math.floor((Date.now() - nextRun.getTime()) / (1000 * 60 * 60 * 24)))
          : 0;
        const daysText = daysOverdue === 1 ? '1 dia' : `${daysOverdue} dias`;

        await this.dispatchService.dispatchByConfiguration('maintenance.overdue', 'system', {
          entityType: 'MaintenanceSchedule',
          entityId: schedule.id,
          action: 'overdue',
          data: {
            scheduleName,
            itemName,
            daysOverdue,
          },
          overrides: {
            title: 'Manutenção Atrasada',
            body: `A manutenção agendada "${scheduleName}" (${itemName}) está atrasada há ${daysText}. Por favor, verifique o agendamento.`,
            webUrl: this.maintenanceWebUrl(schedule.id),
            relatedEntityType: 'MAINTENANCE',
          },
        });
      } catch (error) {
        this.logger.error(`Failed to notify overdue maintenance schedule ${schedule.id}:`, error);
      }
    }
  }

  private async notifyDueSchedules(overdueIds: Set<string>): Promise<void> {
    const now = new Date();
    const due = await this.maintenanceScheduleService.getDueSchedules(now);
    if (!due || due.length === 0) return;
    // Exclude schedules already notified as overdue this run.
    const dueOnly = due.filter(schedule => !overdueIds.has(schedule.id));
    if (dueOnly.length === 0) return;
    this.logger.log(`Notifying ${dueOnly.length} due maintenance schedule(s).`);

    for (const schedule of dueOnly) {
      try {
        const itemName = (schedule as any).item?.name || 'Item desconhecido';
        const scheduleName = schedule.name || 'Agendamento de manutenção';

        await this.dispatchService.dispatchByConfiguration('maintenance.due', 'system', {
          entityType: 'MaintenanceSchedule',
          entityId: schedule.id,
          action: 'due',
          data: {
            scheduleName,
            itemName,
          },
          overrides: {
            title: 'Manutenção Pendente',
            body: `A manutenção agendada "${scheduleName}" (${itemName}) está pendente de execução. Por favor, providencie a manutenção.`,
            webUrl: this.maintenanceWebUrl(schedule.id),
            relatedEntityType: 'MAINTENANCE',
          },
        });
      } catch (error) {
        this.logger.error(`Failed to notify due maintenance schedule ${schedule.id}:`, error);
      }
    }
  }
}
