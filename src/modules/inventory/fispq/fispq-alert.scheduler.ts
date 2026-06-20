// fispq-alert.scheduler.ts
// FISPQ / FDS — motor de alertas (Medicina do Trabalho).
//
// Cron diário (07:15 BRT, após EPI 07:00 e exames 07:10) que encontra produtos
// químicos sem FDS válida — FISPQ sem PDF, sem validade, ou com validade dentro de
// ADVANCE_DAYS / vencida — e dispara dispatchByConfiguration('fispq.expiring', ...).
//
// dispatchByConfiguration faz no-op gracioso se a chave de config ainda não existir
// no seed (mesmo padrão do MedicalExamAlertScheduler).
//
// Janela de antecedência configurável via env FISPQ_ALERT_ADVANCE_DAYS (default 30).

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { FISPQ_STATUS } from '../../../constants';

/**
 * Emitido quando há produtos químicos com FDS a vencer / vencida / ausente.
 */
export class FispqAlertEvent {
  constructor(
    public readonly expiringCount: number,
    public readonly missingCount: number,
  ) {}
}

@Injectable()
export class FispqAlertScheduler {
  private readonly logger = new Logger(FispqAlertScheduler.name);

  private readonly advanceDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {
    const parsed = Number(process.env.FISPQ_ALERT_ADVANCE_DAYS);
    this.advanceDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  @Cron('15 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDailyFispqAlerts(): Promise<void> {
    this.logger.log('Running daily FISPQ alerting...');

    try {
      const now = new Date();
      const limitDate = new Date(now);
      limitDate.setDate(limitDate.getDate() + this.advanceDays);

      // FDS a vencer (validade dentro da janela ou já vencida).
      const expiring = await this.prisma.fispq.findMany({
        where: {
          isActive: true,
          status: { not: FISPQ_STATUS.ARCHIVED as any },
          validUntil: { not: null, lte: limitDate },
        },
        include: { item: { select: { id: true, name: true } } },
        orderBy: { validUntil: 'asc' },
      });

      // FDS ausente/incompleta: cadastro sem PDF ou sem validade (status DRAFT).
      const missing = await this.prisma.fispq.findMany({
        where: {
          isActive: true,
          status: FISPQ_STATUS.DRAFT as any,
        },
        include: { item: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });

      this.logger.log(
        `FISPQ alerts: ${expiring.length} expiring (≤${this.advanceDays}d), ${missing.length} missing/incomplete.`,
      );

      const buildPreview = (rows: Array<{ item?: { name: string | null } | null; productName?: string | null }>) => {
        const names = rows
          .map(r => r.item?.name || (r as any).productName)
          .filter(Boolean) as string[];
        return names.length > 5 ? `${names.slice(0, 5).join(', ')}…` : names.join(', ');
      };

      if (expiring.length > 0 || missing.length > 0) {
        const anchor = expiring[0] || missing[0];
        const expiringPreview = buildPreview(expiring as any);
        const missingPreview = buildPreview(missing as any);
        const preview = expiringPreview || missingPreview;

        await this.dispatchService.dispatchByConfiguration('fispq.expiring', 'system', {
          entityType: 'Fispq',
          entityId: anchor.id,
          action: 'expiring',
          data: {
            count: (expiring.length + missing.length).toString(),
            expiringCount: expiring.length.toString(),
            missingCount: missing.length.toString(),
            advanceDays: this.advanceDays.toString(),
            products: preview,
          },
          metadata: {
            expiringCount: expiring.length,
            missingCount: missing.length,
            advanceDays: this.advanceDays,
            expiring: expiring.map(f => ({
              id: f.id,
              itemId: f.itemId,
              itemName: f.item?.name,
              validUntil: f.validUntil,
              status: f.status,
            })),
            missing: missing.map(f => ({
              id: f.id,
              itemId: f.itemId,
              itemName: f.item?.name,
              status: f.status,
            })),
            noReschedule: true,
          },
          overrides: {
            webUrl: '/medicina-do-trabalho/fispq',
            relatedEntityType: 'FISPQ',
            title: 'FISPQ/FDS a vencer ou pendente',
            body:
              `${expiring.length} FDS vencem nos próximos ${this.advanceDays} dias` +
              `${missing.length ? ` e ${missing.length} produto(s) sem FDS válida` : ''}` +
              `${preview ? `: ${preview}` : ''}.`,
          },
        });
      }

      this.eventEmitter.emit('fispq.alerts', new FispqAlertEvent(expiring.length, missing.length));
    } catch (error) {
      this.logger.error('Error during FISPQ alerting:', error);
    }
  }
}
