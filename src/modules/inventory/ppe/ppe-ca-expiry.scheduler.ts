// ppe-ca-expiry.scheduler.ts
// EPI — alertas de vencimento do CA (Certificado de Aprovação) — NR-6 (Part E).
//
// Cron diário que varre os itens-EPI (ppeType != null) cujo CA está vencido ou
// vence dentro da janela de antecedência e dispara notificação (sector-routed via
// config row — no-op gracioso se a chave de configuração ainda não existir no seed).
//
// A entrega de um EPI com CA vencido já é bloqueada em ppe-delivery.service
// (validateEntity); este cron apenas avisa para que o CA seja renovado a tempo.
//
// Janela configurável via env PPE_CA_ALERT_ADVANCE_DAYS (default 30).

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { isPpeCaExpired } from './ppe-ca-expiry.util';

export class PpeCaExpiryAlertEvent {
  constructor(
    public readonly expiredCount: number,
    public readonly expiringCount: number,
  ) {}
}

@Injectable()
export class PpeCaExpiryScheduler {
  private readonly logger = new Logger(PpeCaExpiryScheduler.name);

  private readonly advanceDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
  ) {
    const parsed = Number(process.env.PPE_CA_ALERT_ADVANCE_DAYS);
    this.advanceDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  /**
   * Roda diariamente às 07:05 (junto da bateria de crons da casa).
   */
  @Cron('5 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async runDailyCaExpiryAlerts(): Promise<void> {
    this.logger.log('Running daily PPE CA-expiry alerting...');

    try {
      const now = new Date();
      const limitDate = new Date(now);
      limitDate.setDate(limitDate.getDate() + this.advanceDays);

      // Itens-EPI ativos com CA cadastrado vencendo na janela (ou já vencidos).
      const items = await this.prisma.item.findMany({
        where: {
          ppeType: { not: null },
          isActive: true,
          ppeCAExpiry: { not: null, lte: limitDate },
        },
        select: {
          id: true,
          name: true,
          ppeCA: true,
          ppeCAExpiry: true,
        },
        orderBy: { ppeCAExpiry: 'asc' },
      });

      if (items.length === 0) {
        this.logger.log('No PPE items with CA expiring/expired.');
        return;
      }

      const expired = items.filter(i => isPpeCaExpired(i.ppeCAExpiry, now));
      const expiring = items.filter(i => !isPpeCaExpired(i.ppeCAExpiry, now));

      this.logger.log(
        `PPE CA alerts: ${expired.length} expired, ${expiring.length} expiring within ${this.advanceDays}d.`,
      );

      const previewNames = (rows: typeof items) => {
        const labels = rows.map(i => (i.ppeCA ? `${i.name} (CA ${i.ppeCA})` : i.name));
        return labels.length > 5 ? `${labels.slice(0, 5).join(', ')}…` : labels.join(', ');
      };

      await this.dispatchService.dispatchByConfiguration('ppe.ca_expiry', 'system', {
        entityType: 'Item',
        entityId: items[0].id,
        action: 'ca_expiry',
        data: {
          expiredCount: expired.length.toString(),
          expiringCount: expiring.length.toString(),
          advanceDays: this.advanceDays.toString(),
          items: previewNames(items),
        },
        metadata: {
          expiredCount: expired.length,
          expiringCount: expiring.length,
          advanceDays: this.advanceDays,
          items: items.map(i => ({
            id: i.id,
            name: i.name,
            ca: i.ppeCA,
            caExpiry: i.ppeCAExpiry,
            expired: isPpeCaExpired(i.ppeCAExpiry, now),
          })),
          noReschedule: true,
        },
        overrides: {
          actionUrl: '/estoque/epis',
          webUrl: '/estoque/epis',
          relatedEntityType: 'ITEM',
          title: 'CA de EPI vencido / a vencer (NR-6)',
          body:
            `${expired.length} EPI(s) com CA vencido e ${expiring.length} a vencer em ` +
            `${this.advanceDays} dias: ${previewNames(items)}. A entrega de EPI com CA vencido está bloqueada.`,
        },
      });

      this.eventEmitter.emit(
        'ppe.ca-expiry.alert',
        new PpeCaExpiryAlertEvent(expired.length, expiring.length),
      );
    } catch (error) {
      this.logger.error('Error during PPE CA-expiry alerting:', error);
    }
  }
}
