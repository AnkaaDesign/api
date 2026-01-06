import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATION_CHANNEL } from '../../../../constants';

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  channel: NOTIFICATION_CHANNEL;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeliveryData {
  notificationId: string;
  channel: NOTIFICATION_CHANNEL;
  status?: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  metadata?: any;
}

export interface UpdateDeliveryData {
  status?: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  metadata?: any;
}

/**
 * Repository for managing NotificationDelivery records
 * Handles delivery tracking across different notification channels
 */
@Injectable()
export class NotificationDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new delivery record
   */
  async create(data: CreateDeliveryData): Promise<NotificationDelivery> {
    return this.prisma.notificationDelivery.create({
      data: {
        notificationId: data.notificationId,
        channel: data.channel,
        status: data.status || 'PENDING',
        sentAt: data.sentAt || null,
        deliveredAt: data.deliveredAt || null,
        failedAt: data.failedAt || null,
        errorMessage: data.errorMessage || null,
        metadata: data.metadata || null,
      },
    }) as Promise<NotificationDelivery>;
  }

  /**
   * Update an existing delivery record
   */
  async update(id: string, data: UpdateDeliveryData): Promise<NotificationDelivery> {
    return this.prisma.notificationDelivery.update({
      where: { id },
      data,
    }) as Promise<NotificationDelivery>;
  }

  /**
   * Find delivery record by notification ID and channel
   */
  async findByNotificationAndChannel(
    notificationId: string,
    channel: NOTIFICATION_CHANNEL,
  ): Promise<NotificationDelivery | null> {
    return this.prisma.notificationDelivery.findFirst({
      where: {
        notificationId,
        channel,
      },
    }) as Promise<NotificationDelivery | null>;
  }

  /**
   * Find all deliveries for a notification
   */
  async findByNotification(notificationId: string): Promise<NotificationDelivery[]> {
    return this.prisma.notificationDelivery.findMany({
      where: {
        notificationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }) as Promise<NotificationDelivery[]>;
  }

  /**
   * Mark delivery as sent
   */
  async markAsSent(id: string): Promise<NotificationDelivery> {
    return this.prisma.notificationDelivery.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
      },
    }) as Promise<NotificationDelivery>;
  }

  /**
   * Mark delivery as delivered
   */
  async markAsDelivered(id: string): Promise<NotificationDelivery> {
    return this.prisma.notificationDelivery.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    }) as Promise<NotificationDelivery>;
  }

  /**
   * Mark delivery as failed
   */
  async markAsFailed(id: string, errorMessage?: string): Promise<NotificationDelivery> {
    return this.prisma.notificationDelivery.update({
      where: { id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMessage: errorMessage || null,
      },
    }) as Promise<NotificationDelivery>;
  }

  /**
   * Find or create delivery record
   * Useful for ensuring a delivery record exists before updating
   */
  async findOrCreate(data: CreateDeliveryData): Promise<NotificationDelivery> {
    const existing = await this.findByNotificationAndChannel(data.notificationId, data.channel);

    if (existing) {
      return existing;
    }

    return this.create(data);
  }

  /**
   * Get delivery statistics for a notification
   */
  async getDeliveryStats(notificationId: string): Promise<{
    total: number;
    pending: number;
    sent: number;
    delivered: number;
    failed: number;
    byChannel: Record<string, { status: string; deliveredAt: Date | null; failedAt: Date | null }>;
  }> {
    const deliveries = await this.findByNotification(notificationId);

    const stats = {
      total: deliveries.length,
      pending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      byChannel: {} as Record<
        string,
        { status: string; deliveredAt: Date | null; failedAt: Date | null }
      >,
    };

    for (const delivery of deliveries) {
      stats[delivery.status.toLowerCase() as 'pending' | 'sent' | 'delivered' | 'failed']++;
      stats.byChannel[delivery.channel] = {
        status: delivery.status,
        deliveredAt: delivery.deliveredAt,
        failedAt: delivery.failedAt,
      };
    }

    return stats;
  }

  /**
   * Get failed deliveries for retry
   */
  async getFailedDeliveries(limit = 100): Promise<NotificationDelivery[]> {
    return this.prisma.notificationDelivery.findMany({
      where: {
        status: 'FAILED',
      },
      orderBy: {
        failedAt: 'asc',
      },
      take: limit,
    }) as Promise<NotificationDelivery[]>;
  }

  /**
   * Delete delivery record
   */
  async delete(id: string): Promise<void> {
    await this.prisma.notificationDelivery.delete({
      where: { id },
    });
  }

  /**
   * Delete all deliveries for a notification
   */
  async deleteByNotification(notificationId: string): Promise<void> {
    await this.prisma.notificationDelivery.deleteMany({
      where: {
        notificationId,
      },
    });
  }
}
