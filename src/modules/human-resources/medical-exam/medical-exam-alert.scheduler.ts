// medical-exam-alert.scheduler.ts
// Medicina do Trabalho — motor de alertas (Part E).
//
// Cron diário que:
//  1) Vira COMPLETED → EXPIRED os exames cuja validade já passou (autoExpireOverdue).
//  2) Alerta exames a vencer (expiresAt dentro de ADVANCE_DAYS) — ASOs periódicos.
//  3) Alerta exames de retorno ao trabalho (RETURN_TO_WORK) agendados/vencidos.
//
// Espelha o estilo de cron do EPI (ppe-delivery-schedule / borrow-notification.scheduler):
// roda 1×/dia, faz dispatch por configuração (que faz no-op gracioso se a chave de
// configuração ainda não existir no seed) e emite eventos para listeners.
//
// A janela de antecedência (ADVANCE_DAYS) é configurável via env
// MEDICAL_EXAM_ALERT_ADVANCE_DAYS (default 30).

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { MEDICAL_EXAM_STATUS, MEDICAL_EXAM_TYPE } from '../../../constants';
import { MedicalExamService } from './medical-exam.service';

/**
 * Emitido quando há exames ocupacionais a vencer / vencidos / retornos pendentes.
 */
export class MedicalExamAlertEvent {
  constructor(
    public readonly expiringCount: number,
    public readonly returnDueCount: number,
    public readonly expiredCount: number,
  ) {}
}

@Injectable()
export class MedicalExamAlertScheduler {
  private readonly logger = new Logger(MedicalExamAlertScheduler.name);

  private readonly advanceDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly medicalExamService: MedicalExamService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {
    const parsed = Number(process.env.MEDICAL_EXAM_ALERT_ADVANCE_DAYS);
    this.advanceDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  /**
   * Roda diariamente às 07:10 (após o cron de EPI 07:00 da casa).
   */
  @Cron('10 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDailyMedicalExamAlerts(): Promise<void> {
    this.logger.log('Running daily medical-exam alerting...');

    try {
      // 1) Auto-EXPIRE: COMPLETED com validade vencida → EXPIRED.
      const expiredCount = await this.medicalExamService.autoExpireOverdue();
      if (expiredCount > 0) {
        this.logger.log(`Auto-expired ${expiredCount} overdue medical exams.`);
      }

      const now = new Date();
      const limitDate = new Date(now);
      limitDate.setDate(limitDate.getDate() + this.advanceDays);

      // 2) Exames a vencer: COMPLETED com expiresAt dentro da janela (ou já vencidos
      //    e ainda não reprocessados). Inclui usuário para roteamento/contexto.
      const expiring = await this.prisma.medicalExam.findMany({
        where: {
          status: MEDICAL_EXAM_STATUS.COMPLETED as any,
          expiresAt: { not: null, lte: limitDate },
        },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { expiresAt: 'asc' },
      });

      // 3) Exames de retorno (RETURN_TO_WORK) agendados cuja data já chegou/passou.
      const returnDue = await this.prisma.medicalExam.findMany({
        where: {
          status: MEDICAL_EXAM_STATUS.SCHEDULED as any,
          type: MEDICAL_EXAM_TYPE.RETURN_TO_WORK as any,
          scheduledAt: { not: null, lte: now },
        },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { scheduledAt: 'asc' },
      });

      this.logger.log(
        `Medical-exam alerts: ${expiring.length} expiring (≤${this.advanceDays}d), ` +
          `${returnDue.length} return-to-work due.`,
      );

      // Dispatch a vencer (sector-routed: ADMIN/HR/ACCOUNTING via config row).
      if (expiring.length > 0) {
        const names = expiring.map(e => e.user?.name).filter(Boolean) as string[];
        const preview = names.length > 5 ? `${names.slice(0, 5).join(', ')}…` : names.join(', ');
        await this.dispatchService.dispatchByConfiguration('medical_exam.expiring', 'system', {
          entityType: 'MedicalExam',
          entityId: expiring[0].id,
          action: 'expiring',
          data: {
            count: expiring.length.toString(),
            advanceDays: this.advanceDays.toString(),
            employees: preview,
          },
          metadata: {
            count: expiring.length,
            advanceDays: this.advanceDays,
            exams: expiring.map(e => ({
              id: e.id,
              userId: e.userId,
              userName: e.user?.name,
              type: e.type,
              expiresAt: e.expiresAt,
            })),
            noReschedule: true,
          },
          overrides: {
            webUrl: '/medicina-do-trabalho/aso',
            mobileUrl: '/(tabs)/recursos-humanos/medicina/aso',
            relatedEntityType: 'MEDICAL_EXAM',
            title: 'Exames ocupacionais a vencer',
            body: `${expiring.length} exame(s) vencem nos próximos ${this.advanceDays} dias${
              preview ? `: ${preview}` : ''
            }.`,
          },
        });
      }

      // Dispatch retornos pendentes.
      if (returnDue.length > 0) {
        const names = returnDue.map(e => e.user?.name).filter(Boolean) as string[];
        const preview = names.length > 5 ? `${names.slice(0, 5).join(', ')}…` : names.join(', ');
        await this.dispatchService.dispatchByConfiguration('medical_exam.return_due', 'system', {
          entityType: 'MedicalExam',
          entityId: returnDue[0].id,
          action: 'return_due',
          data: {
            count: returnDue.length.toString(),
            employees: preview,
          },
          metadata: {
            count: returnDue.length,
            exams: returnDue.map(e => ({
              id: e.id,
              userId: e.userId,
              userName: e.user?.name,
              scheduledAt: e.scheduledAt,
            })),
            noReschedule: true,
          },
          overrides: {
            webUrl: '/medicina-do-trabalho/aso',
            mobileUrl: '/(tabs)/recursos-humanos/medicina/aso',
            relatedEntityType: 'MEDICAL_EXAM',
            title: 'Exames de retorno ao trabalho pendentes',
            body: `${returnDue.length} exame(s) de retorno ao trabalho (ASO) aguardam realização${
              preview ? `: ${preview}` : ''
            }.`,
          },
        });
      }

      this.eventEmitter.emit(
        'medical-exam.alerts',
        new MedicalExamAlertEvent(expiring.length, returnDue.length, expiredCount),
      );
    } catch (error) {
      this.logger.error('Error during medical-exam alerting:', error);
    }
  }
}
