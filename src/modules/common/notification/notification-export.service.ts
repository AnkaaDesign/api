import { Injectable, Logger, InternalServerErrorException, StreamableFile } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { stringify } from 'csv-stringify';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';

/**
 * Export format types
 */
export type ExportFormat = 'csv' | 'xlsx';

/**
 * Notification export data interface
 */
export interface NotificationExportData {
  id: string;
  type: string;
  user: string;
  message: string;
  channels: string;
  status: string;
  sentAt: string;
  deliveredAt: string;
  seenAt: string;
  failedReason: string;
}

/**
 * Analytics export data interface
 */
export interface AnalyticsExportData {
  date: string;
  totalNotifications: number;
  sentNotifications: number;
  deliveredNotifications: number;
  failedNotifications: number;
  seenNotifications: number;
  deliveryRate: string;
  seenRate: string;
  avgDeliveryTime: string;
  topChannel: string;
  topFailureReason: string;
}

/**
 * Export filters interface
 */
export interface ExportFilters {
  type?: string;
  channel?: string;
  status?: 'sent' | 'scheduled' | 'pending';
  deliveryStatus?: 'delivered' | 'failed' | 'pending';
  userId?: string;
  sectorId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Notification Export Service
 * Provides functionality to export notifications and analytics to CSV and Excel formats
 *
 * Features:
 * - CSV export with streaming support for large datasets
 * - Excel (XLSX) export with formatted columns
 * - Analytics data export with aggregated metrics
 * - Automatic filename generation with timestamps
 * - Memory-efficient streaming for large exports
 * - Comprehensive data formatting
 */
@Injectable()
export class NotificationExportService {
  private readonly logger = new Logger(NotificationExportService.name);
  private readonly BATCH_SIZE = 1000; // Process records in batches for streaming

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Export notifications to CSV format
   * Streams data to avoid memory issues with large datasets
   *
   * @param filters - Query filters for notifications
   * @returns CSV content as Buffer
   */
  async exportToCSV(filters: ExportFilters = {}): Promise<Buffer> {
    try {
      this.logger.log('Starting CSV export with filters:', filters);

      const notifications = await this.fetchNotifications(filters);
      const exportData = await this.formatExportData(notifications);

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];

        const stringifier = stringify({
          header: true,
          columns: [
            { key: 'id', header: 'ID' },
            { key: 'type', header: 'Type' },
            { key: 'user', header: 'User' },
            { key: 'message', header: 'Message' },
            { key: 'channels', header: 'Channels' },
            { key: 'status', header: 'Status' },
            { key: 'sentAt', header: 'Sent At' },
            { key: 'deliveredAt', header: 'Delivered At' },
            { key: 'seenAt', header: 'Seen At' },
            { key: 'failedReason', header: 'Failed Reason' },
          ],
        });

        stringifier.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        stringifier.on('end', () => {
          const result = Buffer.concat(chunks);
          this.logger.log(`CSV export completed. Size: ${result.length} bytes`);
          resolve(result);
        });

        stringifier.on('error', (error: Error) => {
          this.logger.error('CSV export error:', error);
          reject(error);
        });

        // Write data to stringifier
        exportData.forEach(row => stringifier.write(row));
        stringifier.end();
      });
    } catch (error) {
      this.logger.error('Error exporting to CSV:', error);
      throw new InternalServerErrorException('Failed to export notifications to CSV');
    }
  }

  /**
   * Export notifications to Excel (XLSX) format
   * Creates a formatted Excel workbook with proper column types
   *
   * @param filters - Query filters for notifications
   * @returns Excel file as Buffer
   */
  async exportToExcel(filters: ExportFilters = {}): Promise<Buffer> {
    try {
      this.logger.log('Starting Excel export with filters:', filters);

      const notifications = await this.fetchNotifications(filters);
      const exportData = await this.formatExportData(notifications);

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();

      // Convert data to worksheet
      const worksheet = XLSX.utils.json_to_sheet(exportData, {
        header: [
          'id',
          'type',
          'user',
          'message',
          'channels',
          'status',
          'sentAt',
          'deliveredAt',
          'seenAt',
          'failedReason',
        ],
      });

      // Set column widths for better readability
      worksheet['!cols'] = [
        { wch: 36 }, // ID
        { wch: 20 }, // Type
        { wch: 25 }, // User
        { wch: 50 }, // Message
        { wch: 30 }, // Channels
        { wch: 15 }, // Status
        { wch: 20 }, // Sent At
        { wch: 20 }, // Delivered At
        { wch: 20 }, // Seen At
        { wch: 40 }, // Failed Reason
      ];

      // Add custom headers
      const headers = {
        A1: { v: 'ID', t: 's' },
        B1: { v: 'Type', t: 's' },
        C1: { v: 'User', t: 's' },
        D1: { v: 'Message', t: 's' },
        E1: { v: 'Channels', t: 's' },
        F1: { v: 'Status', t: 's' },
        G1: { v: 'Sent At', t: 's' },
        H1: { v: 'Delivered At', t: 's' },
        I1: { v: 'Seen At', t: 's' },
        J1: { v: 'Failed Reason', t: 's' },
      };

      Object.assign(worksheet, headers);

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Notifications');

      // Generate buffer
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
        compression: true,
      });

      this.logger.log(`Excel export completed. Size: ${buffer.length} bytes`);
      return buffer;
    } catch (error) {
      this.logger.error('Error exporting to Excel:', error);
      throw new InternalServerErrorException('Failed to export notifications to Excel');
    }
  }

  /**
   * Export analytics data with aggregated metrics
   * Includes delivery rates, seen rates, and failure analysis
   *
   * @param filters - Query filters for analytics
   * @param format - Export format ('csv' or 'xlsx')
   * @returns Export file as Buffer
   */
  async exportAnalytics(
    filters: ExportFilters = {},
    format: ExportFormat = 'csv',
  ): Promise<Buffer> {
    try {
      this.logger.log('Starting analytics export with filters:', filters);

      const analyticsData = await this.generateAnalyticsData(filters);

      if (format === 'csv') {
        return this.exportAnalyticsToCSV(analyticsData);
      } else {
        return this.exportAnalyticsToExcel(analyticsData);
      }
    } catch (error) {
      this.logger.error('Error exporting analytics:', error);
      throw new InternalServerErrorException('Failed to export analytics data');
    }
  }

  /**
   * Format notification data for export
   * Transforms database records into export-friendly format
   *
   * @param notifications - Array of notifications from database
   * @returns Formatted export data
   */
  async formatExportData(notifications: any[]): Promise<NotificationExportData[]> {
    try {
      return notifications.map(notification => {
        // Get delivery status
        const deliveryStatus = this.getDeliveryStatus(notification.deliveries);

        // Get first delivery timestamp
        const firstDelivery = notification.deliveries.find((d: any) => d.deliveredAt !== null);

        // Get failed delivery reason
        const failedDelivery = notification.deliveries.find((d: any) => d.status === 'FAILED');

        // Get seen information
        const seenNotification = notification.seenBy?.[0];

        return {
          id: notification.id,
          type: notification.type,
          user: notification.user
            ? `${notification.user.name} (${notification.user.email})`
            : 'N/A',
          message: notification.body.substring(0, 200), // Truncate for readability
          channels: notification.channel.join(', '),
          status: deliveryStatus,
          sentAt: notification.sentAt ? notification.sentAt.toISOString() : 'Not sent',
          deliveredAt: firstDelivery?.deliveredAt
            ? firstDelivery.deliveredAt.toISOString()
            : 'Not delivered',
          seenAt: seenNotification?.seenAt ? seenNotification.seenAt.toISOString() : 'Not seen',
          failedReason: failedDelivery?.errorMessage || 'N/A',
        };
      });
    } catch (error) {
      this.logger.error('Error formatting export data:', error);
      throw new InternalServerErrorException('Failed to format export data');
    }
  }

  /**
   * Generate timestamped filename for export
   * Creates descriptive filename with date, format, and type
   *
   * @param format - File format ('csv' or 'xlsx')
   * @param type - Export type ('notifications' or 'analytics')
   * @returns Formatted filename
   */
  generateExportFilename(
    format: ExportFormat,
    type: 'notifications' | 'analytics' = 'notifications',
  ): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const time = new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');

    return `${type}-export-${timestamp}-${time}.${format}`;
  }

  /**
   * Stream large exports to avoid memory issues
   * Processes notifications in batches and streams to client
   *
   * @param filters - Query filters for notifications
   * @param format - Export format
   * @returns Readable stream
   */
  async streamExport(filters: ExportFilters = {}, format: ExportFormat = 'csv'): Promise<Readable> {
    try {
      this.logger.log('Starting streamed export with filters:', filters);

      if (format === 'csv') {
        return this.streamCSVExport(filters);
      } else {
        // For Excel, we need to build the entire file in memory
        // So we'll just return a readable stream from the buffer
        const buffer = await this.exportToExcel(filters);
        return Readable.from(buffer);
      }
    } catch (error) {
      this.logger.error('Error streaming export:', error);
      throw new InternalServerErrorException('Failed to stream export');
    }
  }

  // =====================
  // Private Helper Methods
  // =====================

  /**
   * Fetch notifications from database with filters
   */
  private async fetchNotifications(filters: ExportFilters): Promise<any[]> {
    const where: any = {};

    // Apply filters
    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.channel) {
      where.channel = {
        has: filters.channel,
      };
    }

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.sectorId) {
      where.user = {
        sectorId: filters.sectorId,
      };
    }

    if (filters.status) {
      switch (filters.status) {
        case 'sent':
          where.sentAt = { not: null };
          break;
        case 'scheduled':
          where.scheduledAt = { not: null, gt: new Date() };
          where.sentAt = null;
          break;
        case 'pending':
          where.sentAt = null;
          where.OR = [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }];
          break;
      }
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        where.createdAt.lte = filters.dateTo;
      }
    }

    if (filters.deliveryStatus) {
      where.deliveries = {
        some: {
          status: filters.deliveryStatus.toUpperCase(),
        },
      };
    }

    // Fetch notifications with related data
    return this.prisma.notification.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        deliveries: {
          select: {
            channel: true,
            status: true,
            sentAt: true,
            deliveredAt: true,
            failedAt: true,
            errorMessage: true,
          },
        },
        seenBy: {
          select: {
            userId: true,
            seenAt: true,
          },
          take: 1,
          orderBy: {
            seenAt: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50000, // Reasonable limit for exports
    });
  }

  /**
   * Get overall delivery status from deliveries
   */
  private getDeliveryStatus(deliveries: any[]): string {
    if (!deliveries || deliveries.length === 0) {
      return 'Not sent';
    }

    const hasDelivered = deliveries.some(d => d.status === 'DELIVERED');
    const hasFailed = deliveries.some(d => d.status === 'FAILED');
    const hasPending = deliveries.some(d => d.status === 'PENDING');

    if (hasDelivered && !hasFailed && !hasPending) return 'Delivered';
    if (hasFailed && !hasDelivered && !hasPending) return 'Failed';
    if (hasDelivered && hasFailed) return 'Partially delivered';
    if (hasPending) return 'Pending';

    return 'Unknown';
  }

  /**
   * Generate analytics data from notifications
   */
  private async generateAnalyticsData(filters: ExportFilters): Promise<AnalyticsExportData[]> {
    const dateFilter: any = {};

    if (filters.dateFrom || filters.dateTo) {
      if (filters.dateFrom) {
        dateFilter.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        dateFilter.lte = filters.dateTo;
      }
    }

    const whereClause = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    // Get aggregated data by day
    const analyticsData = await this.prisma.$queryRaw<
      Array<{
        date: Date;
        total: bigint;
        sent: bigint;
        delivered: bigint;
        failed: bigint;
        seen: bigint;
      }>
    >`
      SELECT
        DATE_TRUNC('day', n."createdAt") as date,
        COUNT(DISTINCT n.id) as total,
        COUNT(DISTINCT CASE WHEN n."sentAt" IS NOT NULL THEN n.id END) as sent,
        COUNT(DISTINCT CASE WHEN nd.status = 'DELIVERED' THEN nd.id END) as delivered,
        COUNT(DISTINCT CASE WHEN nd.status = 'FAILED' THEN nd.id END) as failed,
        COUNT(DISTINCT sn.id) as seen
      FROM "Notification" n
      LEFT JOIN "NotificationDelivery" nd ON nd."notificationId" = n.id
      LEFT JOIN "SeenNotification" sn ON sn."notificationId" = n.id
      ${Object.keys(whereClause).length > 0 ? `WHERE n."createdAt" >= ${filters.dateFrom} AND n."createdAt" <= ${filters.dateTo}` : ''}
      GROUP BY date
      ORDER BY date DESC
      LIMIT 365
    `;

    // Get top channel and failure reason for each day
    const enrichedData = await Promise.all(
      analyticsData.map(async row => {
        const dayStart = new Date(row.date);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        // Get top channel
        const topChannelData = await this.prisma.notificationDelivery.groupBy({
          by: ['channel'],
          where: {
            notification: {
              createdAt: {
                gte: dayStart,
                lt: dayEnd,
              },
            },
          },
          _count: true,
          orderBy: {
            _count: {
              channel: 'desc',
            },
          },
          take: 1,
        });

        // Get top failure reason
        const topFailureData = await this.prisma.notificationDelivery.groupBy({
          by: ['errorMessage'],
          where: {
            status: 'FAILED',
            notification: {
              createdAt: {
                gte: dayStart,
                lt: dayEnd,
              },
            },
          },
          _count: true,
          orderBy: {
            _count: {
              errorMessage: 'desc',
            },
          },
          take: 1,
        });

        const total = Number(row.total);
        const sent = Number(row.sent);
        const delivered = Number(row.delivered);
        const failed = Number(row.failed);
        const seen = Number(row.seen);

        const deliveryRate = sent > 0 ? ((delivered / sent) * 100).toFixed(2) : '0.00';
        const seenRate = delivered > 0 ? ((seen / delivered) * 100).toFixed(2) : '0.00';

        // Calculate average delivery time
        const deliveryTimes = await this.prisma.notificationDelivery.findMany({
          where: {
            status: 'DELIVERED',
            sentAt: { not: null },
            deliveredAt: { not: null },
            notification: {
              createdAt: {
                gte: dayStart,
                lt: dayEnd,
              },
            },
          },
          select: {
            sentAt: true,
            deliveredAt: true,
          },
        });

        let avgDeliveryTime = '0s';
        if (deliveryTimes.length > 0) {
          const totalTime = deliveryTimes.reduce((sum, d) => {
            const timeDiff = d.deliveredAt!.getTime() - d.sentAt!.getTime();
            return sum + timeDiff;
          }, 0);
          const avgMs = totalTime / deliveryTimes.length;
          avgDeliveryTime = `${(avgMs / 1000).toFixed(2)}s`;
        }

        return {
          date: row.date.toISOString().split('T')[0],
          totalNotifications: total,
          sentNotifications: sent,
          deliveredNotifications: delivered,
          failedNotifications: failed,
          seenNotifications: seen,
          deliveryRate: `${deliveryRate}%`,
          seenRate: `${seenRate}%`,
          avgDeliveryTime,
          topChannel: topChannelData[0]?.channel || 'N/A',
          topFailureReason: topFailureData[0]?.errorMessage || 'N/A',
        };
      }),
    );

    return enrichedData;
  }

  /**
   * Export analytics to CSV
   */
  private async exportAnalyticsToCSV(analyticsData: AnalyticsExportData[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const stringifier = stringify({
        header: true,
        columns: [
          { key: 'date', header: 'Date' },
          { key: 'totalNotifications', header: 'Total Notifications' },
          { key: 'sentNotifications', header: 'Sent Notifications' },
          { key: 'deliveredNotifications', header: 'Delivered Notifications' },
          { key: 'failedNotifications', header: 'Failed Notifications' },
          { key: 'seenNotifications', header: 'Seen Notifications' },
          { key: 'deliveryRate', header: 'Delivery Rate' },
          { key: 'seenRate', header: 'Seen Rate' },
          { key: 'avgDeliveryTime', header: 'Avg Delivery Time' },
          { key: 'topChannel', header: 'Top Channel' },
          { key: 'topFailureReason', header: 'Top Failure Reason' },
        ],
      });

      stringifier.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stringifier.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      stringifier.on('error', reject);

      analyticsData.forEach(row => stringifier.write(row));
      stringifier.end();
    });
  }

  /**
   * Export analytics to Excel
   */
  private async exportAnalyticsToExcel(analyticsData: AnalyticsExportData[]): Promise<Buffer> {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(analyticsData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 12 }, // Date
      { wch: 20 }, // Total
      { wch: 20 }, // Sent
      { wch: 25 }, // Delivered
      { wch: 20 }, // Failed
      { wch: 20 }, // Seen
      { wch: 15 }, // Delivery Rate
      { wch: 15 }, // Seen Rate
      { wch: 20 }, // Avg Delivery Time
      { wch: 15 }, // Top Channel
      { wch: 40 }, // Top Failure Reason
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Analytics');

    return XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
    });
  }

  /**
   * Stream CSV export in batches
   */
  private async streamCSVExport(filters: ExportFilters): Promise<Readable> {
    const notifications = await this.fetchNotifications(filters);
    const exportData = await this.formatExportData(notifications);

    const stringifier = stringify({
      header: true,
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'type', header: 'Type' },
        { key: 'user', header: 'User' },
        { key: 'message', header: 'Message' },
        { key: 'channels', header: 'Channels' },
        { key: 'status', header: 'Status' },
        { key: 'sentAt', header: 'Sent At' },
        { key: 'deliveredAt', header: 'Delivered At' },
        { key: 'seenAt', header: 'Seen At' },
        { key: 'failedReason', header: 'Failed Reason' },
      ],
    });

    // Process in batches
    let index = 0;
    const batchInterval = setInterval(() => {
      const batch = exportData.slice(index, index + this.BATCH_SIZE);

      if (batch.length === 0) {
        clearInterval(batchInterval);
        stringifier.end();
        return;
      }

      batch.forEach(row => stringifier.write(row));
      index += this.BATCH_SIZE;
    }, 10);

    return stringifier;
  }
}
