/**
 * PPE Signature Audit Service
 *
 * Records every event in the PPE delivery signature lifecycle so the
 * audit trail page in the signed PDF can reconstruct the full timeline,
 * Clicksign-style.
 *
 * Events are best-effort: any logging failure is swallowed so it can never
 * break the user-facing flow.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { PpeSignatureEventType, Prisma } from '@prisma/client';

export interface AuditEventContext {
  signatureId?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  occurredAt?: Date;
}

export interface AuditEventRecord {
  id: string;
  type: PpeSignatureEventType;
  occurredAt: Date;
  actorUserId: string | null;
  actorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: any;
}

@Injectable()
export class PpeSignatureAuditService {
  private readonly logger = new Logger(PpeSignatureAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  /**
   * Record a single audit event. Never throws.
   */
  async recordEvent(
    deliveryId: string,
    type: PpeSignatureEventType,
    ctx: AuditEventContext = {},
  ): Promise<void> {
    try {
      await this.prisma.ppeDeliverySignatureEvent.create({
        data: {
          deliveryId,
          signatureId: ctx.signatureId ?? null,
          type,
          occurredAt: ctx.occurredAt ?? new Date(),
          actorUserId: ctx.actorUserId ?? null,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
          metadata: ctx.metadata ?? Prisma.JsonNull,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record audit event ${type} for delivery ${deliveryId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    // A failed signature/seal is an operational incident — notify HR/admin so it
    // can be retried. Best-effort: never let a notification failure surface here.
    if (type === 'SIGNATURE_FAILED' || type === 'PADES_FAILED') {
      try {
        // Best-effort: resolve the item name so the alert names the EPI.
        let itemName = 'EPI';
        try {
          const delivery = await this.prisma.ppeDelivery.findUnique({
            where: { id: deliveryId },
            select: { item: { select: { name: true } } },
          });
          if (delivery?.item?.name) {
            itemName = delivery.item.name;
          }
        } catch {
          // ignore — fall back to the generic label
        }

        const reason =
          type === 'PADES_FAILED'
            ? 'falha ao selar digitalmente (PAdES) o comprovante'
            : 'falha na assinatura digital do comprovante';

        await this.dispatchService.dispatchByConfiguration(
          'ppe.signature_failed',
          ctx.actorUserId ?? 'system',
          {
            entityType: 'PpeDelivery',
            entityId: deliveryId,
            action: 'signature_failed',
            data: {
              eventType: type,
              itemName,
            },
            overrides: {
              title: 'Falha na Assinatura de EPI',
              body: `Falha na entrega do EPI "${itemName}": ${reason}. Verifique e tente novamente.`,
              webUrl: `/estoque/epi/entregas/detalhes/${deliveryId}`,
              relatedEntityType: 'PPE_DELIVERY',
            },
          },
        );
      } catch (notifyErr) {
        this.logger.error(
          `Falha ao notificar falha de assinatura de EPI (ppe.signature_failed) para entrega ${deliveryId}: ${
            notifyErr instanceof Error ? notifyErr.message : notifyErr
          }`,
        );
      }
    }
  }

  /**
   * Backfill the signatureId on any prior events that were recorded
   * before the PpeDeliverySignature row existed (e.g. DELIVERY_CREATED).
   */
  async attachSignatureId(deliveryId: string, signatureId: string): Promise<void> {
    try {
      await this.prisma.ppeDeliverySignatureEvent.updateMany({
        where: { deliveryId, signatureId: null },
        data: { signatureId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to attach signatureId ${signatureId} to events for delivery ${deliveryId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Fetch the chronological audit trail for a delivery, ready to render.
   */
  async getAuditTrail(deliveryId: string): Promise<AuditEventRecord[]> {
    const events = await this.prisma.ppeDeliverySignatureEvent.findMany({
      where: { deliveryId },
      orderBy: { occurredAt: 'asc' },
      include: {
        actorUser: { select: { id: true, name: true } },
      },
    });

    return events.map(e => ({
      id: e.id,
      type: e.type,
      occurredAt: e.occurredAt,
      actorUserId: e.actorUserId,
      actorName: e.actorUser?.name ?? null,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      metadata: e.metadata,
    }));
  }
}
