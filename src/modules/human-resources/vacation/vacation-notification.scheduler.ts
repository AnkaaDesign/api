// vacation-notification.scheduler.ts
// Alertas de FÉRIAS (Departamento Pessoal) — Part C.
//
// Cron diário (espelha o estilo do MaintenanceNotificationScheduler / EPI
// delivery-schedule) que:
//   1. emite alertas de EXPIRAÇÃO do período CONCESSIVO se aproximando
//      (reaproveita o scaffolding de notificação EXPIRING_DAYS, que hoje não
//      tinha serviço de backing);
//   2. detecta CONFLITO DE PLANEJAMENTO (PLANNING_CONFLICT) — períodos de gozo
//      agendados que excedem o concessivo;
//   3. auto-flipa OPEN/SCHEDULED → EXPIRED após o concessivo (art. 137) e marca
//      isDouble, de modo que o recálculo pague em dobro.
//
// Config keys emitidas (NEW — a serem semeadas no notification system):
//   - vacation.concessive_expiring
//   - vacation.concessive_expired
//   - vacation.planning_conflict
//
// Tudo é aditivo e protegido: uma falha de notificação nunca aborta a varredura.

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  VACATION_STATUS,
  VACATION_STATUS_ORDER,
} from '../../../constants';

// Dias de antecedência para o alerta de "concessivo expirando" (configurável).
const EXPIRY_WARNING_DAYS = 60;

@Injectable()
export class VacationNotificationScheduler {
  private readonly logger = new Logger(VacationNotificationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleDailyVacationAlerts(): Promise<void> {
    this.logger.log('Running daily vacation concessivo-expiry alerts...');
    try {
      await this.expireOverdueVacations();
    } catch (error) {
      this.logger.error('Error expiring overdue vacations:', error);
    }
    try {
      await this.notifyExpiringConcessivo();
    } catch (error) {
      this.logger.error('Error notifying expiring concessivo:', error);
    }
    try {
      await this.notifyPlanningConflicts();
    } catch (error) {
      this.logger.error('Error notifying vacation planning conflicts:', error);
    }
    this.logger.log('Daily vacation alerts finished.');
  }

  private vacationWebUrl(vacationId: string): string {
    return `/recursos-humanos/ferias/detalhes/${vacationId}`;
  }

  private vacationMobileUrl(vacationId: string): string {
    return `/(tabs)/recursos-humanos/ferias/detalhes/${vacationId}`;
  }

  // -------------------------------------------------------------------------
  // 1. Auto-EXPIRE: concessivo já vencido → status EXPIRED + isDouble (art. 137)
  // -------------------------------------------------------------------------
  private async expireOverdueVacations(): Promise<void> {
    const now = new Date();
    const overdue = await this.prisma.vacation.findMany({
      where: {
        concessiveEnd: { lt: now },
        status: { in: [VACATION_STATUS.OPEN, VACATION_STATUS.SCHEDULED] as any[] },
        deletedAt: null,
      },
      include: { user: { select: { name: true } } },
    });
    if (overdue.length === 0) return;
    this.logger.log(`Expiring ${overdue.length} vacation(s) past concessivo (art. 137).`);

    for (const vacation of overdue) {
      try {
        await this.prisma.$transaction(async tx => {
          await tx.vacation.update({
            where: { id: vacation.id },
            data: {
              status: VACATION_STATUS.EXPIRED as any,
              statusOrder: VACATION_STATUS_ORDER[VACATION_STATUS.EXPIRED],
              isDouble: true,
            },
          });
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.VACATION,
            entityId: vacation.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'status',
            oldValue: vacation.status,
            newValue: VACATION_STATUS.EXPIRED,
            reason:
              'Período concessivo expirado sem gozo — férias devidas em dobro (CLT art. 137).',
            triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM,
            triggeredById: null,
            userId: null,
            transaction: tx,
          });
        });

        const userName = (vacation as any).user?.name || 'Colaborador';
        await this.dispatchService.dispatchByConfiguration('vacation.concessive_expired', 'system', {
          entityType: 'Vacation',
          entityId: vacation.id,
          action: 'expired',
          data: { userName },
          overrides: {
            title: 'Férias vencidas (dobro)',
            body: `As férias de ${userName} venceram o período concessivo sem gozo e agora são devidas EM DOBRO (CLT art. 137). Providencie o pagamento.`,
            webUrl: this.vacationWebUrl(vacation.id),
            mobileUrl: this.vacationMobileUrl(vacation.id),
            relatedEntityType: 'VACATION',
          },
        });
      } catch (error) {
        this.logger.error(`Failed to expire vacation ${vacation.id}:`, error);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Concessivo expirando dentro da janela de antecedência
  // -------------------------------------------------------------------------
  private async notifyExpiringConcessivo(): Promise<void> {
    const now = new Date();
    const threshold = new Date(now.getTime());
    threshold.setDate(threshold.getDate() + EXPIRY_WARNING_DAYS);

    const expiring = await this.prisma.vacation.findMany({
      where: {
        concessiveEnd: { gte: now, lte: threshold },
        status: { in: [VACATION_STATUS.OPEN, VACATION_STATUS.SCHEDULED] as any[] },
        deletedAt: null,
      },
      include: { user: { select: { name: true } } },
    });
    if (expiring.length === 0) return;
    this.logger.log(`Notifying ${expiring.length} vacation(s) with concessivo expiring soon.`);

    for (const vacation of expiring) {
      try {
        const userName = (vacation as any).user?.name || 'Colaborador';
        const daysLeft = vacation.concessiveEnd
          ? Math.max(
              0,
              Math.ceil((vacation.concessiveEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
            )
          : 0;
        const daysText = daysLeft === 1 ? '1 dia' : `${daysLeft} dias`;

        await this.dispatchService.dispatchByConfiguration(
          'vacation.concessive_expiring',
          'system',
          {
            entityType: 'Vacation',
            entityId: vacation.id,
            action: 'expiring',
            data: { userName, daysLeft },
            overrides: {
              title: 'Período concessivo de férias expirando',
              body: `As férias de ${userName} devem ser concedidas em até ${daysText}, sob pena de pagamento em dobro (CLT art. 137). Agende o gozo.`,
              webUrl: this.vacationWebUrl(vacation.id),
              mobileUrl: this.vacationMobileUrl(vacation.id),
              relatedEntityType: 'VACATION',
            },
          },
        );
      } catch (error) {
        this.logger.error(`Failed to notify expiring vacation ${vacation.id}:`, error);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Conflito de planejamento: gozo agendado depois do concessivo
  // -------------------------------------------------------------------------
  private async notifyPlanningConflicts(): Promise<void> {
    const conflicting = await this.prisma.vacation.findMany({
      where: {
        status: VACATION_STATUS.SCHEDULED as any,
        concessiveEnd: { not: null },
        deletedAt: null,
      },
      include: {
        user: { select: { name: true } },
      },
    });
    if (conflicting.length === 0) return;

    for (const vacation of conflicting) {
      try {
        const concessiveEnd = vacation.concessiveEnd;
        if (!concessiveEnd) continue;
        // Modelo FLAT: cada Vacation é uma tomada single-period (startDate+days).
        const startDate = (vacation as any).startDate as Date | null;
        const days = (vacation as any).days as number;
        if (!startDate) continue;
        const end = new Date(startDate.getTime());
        end.setDate(end.getDate() + (days || 0) - 1);
        const hasLatePeriod = end.getTime() > concessiveEnd.getTime();
        if (!hasLatePeriod) continue;

        const userName = (vacation as any).user?.name || 'Colaborador';
        await this.dispatchService.dispatchByConfiguration(
          'vacation.planning_conflict',
          'system',
          {
            entityType: 'Vacation',
            entityId: vacation.id,
            action: 'planning_conflict',
            data: { userName },
            overrides: {
              title: 'Conflito no planejamento de férias',
              body: `O gozo agendado das férias de ${userName} ultrapassa o fim do período concessivo. Reagende para evitar pagamento em dobro (CLT art. 137).`,
              webUrl: this.vacationWebUrl(vacation.id),
              mobileUrl: this.vacationMobileUrl(vacation.id),
              relatedEntityType: 'VACATION',
            },
          },
        );
      } catch (error) {
        this.logger.error(`Failed to notify planning conflict for vacation ${vacation.id}:`, error);
      }
    }
  }
}
