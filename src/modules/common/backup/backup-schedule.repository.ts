import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BackupSchedule,
  BackupType,
  BackupPriority,
  BackupScheduleStatus,
  Prisma,
} from '@prisma/client';

export interface CreateBackupScheduleDto {
  name: string;
  type: BackupType;
  description?: string;
  paths?: string[];
  cronExpression: string;
  enabled?: boolean;
  priority?: BackupPriority;
  compressionLevel?: number;
  encrypted?: boolean;
  autoDeleteEnabled?: boolean;
  autoDeleteRetention?: string;
  bullJobId?: string;
  createdById?: string;
}

export interface UpdateBackupScheduleDto {
  name?: string;
  type?: BackupType;
  description?: string;
  paths?: string[];
  cronExpression?: string;
  enabled?: boolean;
  priority?: BackupPriority;
  compressionLevel?: number;
  encrypted?: boolean;
  autoDeleteEnabled?: boolean;
  autoDeleteRetention?: string;
  bullJobId?: string;
  lastRunAt?: Date;
  nextRunAt?: Date;
  lastStatus?: BackupScheduleStatus;
  lastError?: string;
  runCount?: number;
  failureCount?: number;
}

@Injectable()
export class BackupScheduleRepository {
  private readonly logger = new Logger(BackupScheduleRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new backup schedule
   */
  async create(data: CreateBackupScheduleDto): Promise<BackupSchedule> {
    try {
      return await this.prisma.backupSchedule.create({
        data: {
          name: data.name,
          type: data.type,
          description: data.description,
          paths: data.paths || [],
          cronExpression: data.cronExpression,
          enabled: data.enabled ?? true,
          priority: data.priority ?? BackupPriority.MEDIUM,
          compressionLevel: data.compressionLevel ?? 6,
          encrypted: data.encrypted ?? false,
          autoDeleteEnabled: data.autoDeleteEnabled ?? false,
          autoDeleteRetention: data.autoDeleteRetention,
          bullJobId: data.bullJobId,
          createdById: data.createdById,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create backup schedule: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find a backup schedule by ID (excludes soft-deleted by default)
   */
  async findById(id: string, includeDeleted = false): Promise<BackupSchedule | null> {
    return this.prisma.backupSchedule.findFirst({
      where: {
        id,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
    });
  }

  /**
   * Find a backup schedule by Bull job ID (excludes soft-deleted)
   */
  async findByBullJobId(bullJobId: string): Promise<BackupSchedule | null> {
    return this.prisma.backupSchedule.findFirst({
      where: {
        bullJobId,
        deletedAt: null,
      },
    });
  }

  /**
   * Find all backup schedules (excludes soft-deleted by default)
   */
  async findAll(options?: {
    enabled?: boolean;
    type?: BackupType;
    includeDeleted?: boolean;
  }): Promise<BackupSchedule[]> {
    const where: Prisma.BackupScheduleWhereInput = {};

    // Exclude soft-deleted by default
    if (!options?.includeDeleted) {
      where.deletedAt = null;
    }

    if (options?.enabled !== undefined) {
      where.enabled = options.enabled;
    }

    if (options?.type) {
      where.type = options.type;
    }

    return this.prisma.backupSchedule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find all enabled backup schedules (for recovery on startup)
   */
  async findAllEnabled(): Promise<BackupSchedule[]> {
    return this.prisma.backupSchedule.findMany({
      where: {
        enabled: true,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Find all deleted backup schedules (for history/audit)
   */
  async findAllDeleted(): Promise<BackupSchedule[]> {
    return this.prisma.backupSchedule.findMany({
      where: {
        deletedAt: { not: null },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  /**
   * Update a backup schedule
   */
  async update(id: string, data: UpdateBackupScheduleDto): Promise<BackupSchedule> {
    try {
      return await this.prisma.backupSchedule.update({
        where: { id },
        data,
      });
    } catch (error) {
      this.logger.error(`Failed to update backup schedule ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update Bull job ID for a schedule
   */
  async updateBullJobId(id: string, bullJobId: string): Promise<BackupSchedule> {
    return this.prisma.backupSchedule.update({
      where: { id },
      data: { bullJobId },
    });
  }

  /**
   * Record a successful execution
   */
  async recordSuccess(id: string, nextRunAt?: Date): Promise<BackupSchedule> {
    return this.prisma.backupSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        lastStatus: BackupScheduleStatus.COMPLETED,
        lastError: null,
        runCount: { increment: 1 },
      },
    });
  }

  /**
   * Record a failed execution
   */
  async recordFailure(id: string, error: string, nextRunAt?: Date): Promise<BackupSchedule> {
    return this.prisma.backupSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        lastStatus: BackupScheduleStatus.FAILED,
        lastError: error,
        runCount: { increment: 1 },
        failureCount: { increment: 1 },
      },
    });
  }

  /**
   * Mark schedule as running
   */
  async markRunning(id: string): Promise<BackupSchedule> {
    return this.prisma.backupSchedule.update({
      where: { id },
      data: {
        lastStatus: BackupScheduleStatus.RUNNING,
      },
    });
  }

  /**
   * Soft delete a backup schedule (keeps record, marks as deleted)
   * The actual backup files should be deleted separately
   */
  async softDelete(id: string, deletedById?: string): Promise<BackupSchedule> {
    try {
      return await this.prisma.backupSchedule.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById,
          enabled: false, // Disable to prevent future runs
          bullJobId: null, // Clear Bull job reference
        },
      });
    } catch (error) {
      this.logger.error(`Failed to soft delete backup schedule ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Soft delete by Bull job ID
   */
  async softDeleteByBullJobId(
    bullJobId: string,
    deletedById?: string,
  ): Promise<BackupSchedule | null> {
    const schedule = await this.findByBullJobId(bullJobId);
    if (schedule) {
      return this.softDelete(schedule.id, deletedById);
    }
    return null;
  }

  /**
   * Restore a soft-deleted schedule
   */
  async restore(id: string): Promise<BackupSchedule> {
    try {
      return await this.prisma.backupSchedule.update({
        where: { id },
        data: {
          deletedAt: null,
          deletedById: null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to restore backup schedule ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Permanently delete a backup schedule (hard delete)
   * Use with caution - this removes all history
   */
  async hardDelete(id: string): Promise<BackupSchedule> {
    try {
      return await this.prisma.backupSchedule.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Failed to hard delete backup schedule ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enable or disable a schedule
   */
  async setEnabled(id: string, enabled: boolean): Promise<BackupSchedule> {
    return this.prisma.backupSchedule.update({
      where: { id },
      data: { enabled },
    });
  }

  /**
   * Get statistics (excludes soft-deleted)
   */
  async getStatistics(): Promise<{
    total: number;
    enabled: number;
    disabled: number;
    deleted: number;
    byType: Record<BackupType, number>;
    byStatus: Record<BackupScheduleStatus, number>;
  }> {
    const [total, enabled, deleted, byType, byStatus] = await Promise.all([
      this.prisma.backupSchedule.count({ where: { deletedAt: null } }),
      this.prisma.backupSchedule.count({ where: { enabled: true, deletedAt: null } }),
      this.prisma.backupSchedule.count({ where: { deletedAt: { not: null } } }),
      this.prisma.backupSchedule.groupBy({
        by: ['type'],
        where: { deletedAt: null },
        _count: true,
      }),
      this.prisma.backupSchedule.groupBy({
        by: ['lastStatus'],
        where: { deletedAt: null },
        _count: true,
      }),
    ]);

    return {
      total,
      enabled,
      disabled: total - enabled,
      deleted,
      byType: byType.reduce(
        (acc, item) => {
          acc[item.type] = item._count;
          return acc;
        },
        {} as Record<BackupType, number>,
      ),
      byStatus: byStatus.reduce(
        (acc, item) => {
          acc[item.lastStatus] = item._count;
          return acc;
        },
        {} as Record<BackupScheduleStatus, number>,
      ),
    };
  }

  /**
   * Get schedule history (including deleted) for audit purposes
   */
  async getHistory(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ schedules: BackupSchedule[]; total: number }> {
    const [schedules, total] = await Promise.all([
      this.prisma.backupSchedule.findMany({
        orderBy: { createdAt: 'desc' },
        take: options?.limit ?? 100,
        skip: options?.offset ?? 0,
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          deletedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.backupSchedule.count(),
    ]);

    return { schedules, total };
  }
}
