import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Backup,
  BackupType,
  BackupPriority,
  BackupStatus,
  GDriveSyncStatus,
  GDriveDeleteStatus,
  Prisma,
} from '@prisma/client';

export interface CreateBackupDto {
  id: string; // backup_TIMESTAMP_RANDOM
  name: string;
  type: BackupType;
  description?: string;
  paths?: string[];
  priority?: BackupPriority;
  compressionLevel?: number;
  encrypted?: boolean;
  autoDeleteEnabled?: boolean;
  autoDeleteRetention?: string;
  autoDeleteAfter?: Date;
  filePath?: string;
  scheduleId?: string;
  createdById?: string;
}

export interface UpdateBackupDto {
  name?: string;
  description?: string;
  status?: BackupStatus;
  size?: bigint;
  progress?: number;
  error?: string;
  filePath?: string;
  completedAt?: Date;
  autoDeleteAfter?: Date;
  gdriveFileId?: string;
  gdriveStatus?: GDriveSyncStatus;
  gdriveSyncedAt?: Date;
}

export type BackupWithRelations = Backup & {
  createdBy?: { id: string; name: string; email: string } | null;
  deletedBy?: { id: string; name: string; email: string } | null;
  schedule?: { id: string; name: string } | null;
};

@Injectable()
export class BackupRepository {
  private readonly logger = new Logger(BackupRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new backup record
   */
  async create(data: CreateBackupDto): Promise<Backup> {
    try {
      return await this.prisma.backup.create({
        data: {
          id: data.id,
          name: data.name,
          type: data.type,
          description: data.description,
          paths: data.paths || [],
          priority: data.priority ?? BackupPriority.MEDIUM,
          compressionLevel: data.compressionLevel ?? 6,
          encrypted: data.encrypted ?? false,
          autoDeleteEnabled: data.autoDeleteEnabled ?? false,
          autoDeleteRetention: data.autoDeleteRetention,
          autoDeleteAfter: data.autoDeleteAfter,
          filePath: data.filePath,
          scheduleId: data.scheduleId,
          createdById: data.createdById,
          status: BackupStatus.PENDING,
          gdriveStatus: GDriveSyncStatus.PENDING,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create backup: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find a backup by ID (excludes soft-deleted by default)
   */
  async findById(id: string, includeDeleted = false): Promise<Backup | null> {
    return this.prisma.backup.findFirst({
      where: {
        id,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
    });
  }

  /**
   * Find a backup by ID with relations
   */
  async findByIdWithRelations(
    id: string,
    includeDeleted = false,
  ): Promise<BackupWithRelations | null> {
    return this.prisma.backup.findFirst({
      where: {
        id,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        deletedBy: { select: { id: true, name: true, email: true } },
        schedule: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Find all backups (excludes soft-deleted by default)
   */
  async findAll(options?: {
    status?: BackupStatus;
    type?: BackupType;
    scheduleId?: string;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Backup[]> {
    const where: Prisma.BackupWhereInput = {};

    // Exclude soft-deleted by default
    if (!options?.includeDeleted) {
      where.deletedAt = null;
    }

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.type) {
      where.type = options.type;
    }

    if (options?.scheduleId) {
      where.scheduleId = options.scheduleId;
    }

    return this.prisma.backup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  /**
   * Find all backups with relations
   */
  async findAllWithRelations(options?: {
    status?: BackupStatus;
    type?: BackupType;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<BackupWithRelations[]> {
    const where: Prisma.BackupWhereInput = {};

    if (!options?.includeDeleted) {
      where.deletedAt = null;
    }

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.type) {
      where.type = options.type;
    }

    return this.prisma.backup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        deletedBy: { select: { id: true, name: true, email: true } },
        schedule: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Find all deleted backups (history)
   */
  async findAllDeleted(options?: {
    limit?: number;
    offset?: number;
  }): Promise<BackupWithRelations[]> {
    return this.prisma.backup.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        deletedBy: { select: { id: true, name: true, email: true } },
        schedule: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Find backups due for auto-deletion
   */
  async findDueForAutoDelete(): Promise<Backup[]> {
    return this.prisma.backup.findMany({
      where: {
        deletedAt: null,
        autoDeleteEnabled: true,
        autoDeleteAfter: { lte: new Date() },
        status: BackupStatus.COMPLETED,
      },
    });
  }

  /**
   * Find backups that need Google Drive sync
   */
  async findPendingGDriveSync(): Promise<Backup[]> {
    return this.prisma.backup.findMany({
      where: {
        deletedAt: null,
        status: BackupStatus.COMPLETED,
        gdriveStatus: GDriveSyncStatus.PENDING,
      },
    });
  }

  /**
   * Update a backup record
   */
  async update(id: string, data: UpdateBackupDto): Promise<Backup> {
    try {
      return await this.prisma.backup.update({
        where: { id },
        data,
      });
    } catch (error) {
      this.logger.error(`Failed to update backup ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update backup status
   */
  async updateStatus(
    id: string,
    status: BackupStatus,
    error?: string,
  ): Promise<Backup> {
    const data: Prisma.BackupUpdateInput = { status };

    if (error) {
      data.error = error;
    }

    if (status === BackupStatus.COMPLETED) {
      data.completedAt = new Date();
    }

    return this.prisma.backup.update({
      where: { id },
      data,
    });
  }

  /**
   * Update backup progress
   */
  async updateProgress(id: string, progress: number): Promise<Backup> {
    return this.prisma.backup.update({
      where: { id },
      data: { progress: Math.min(100, Math.max(0, progress)) },
    });
  }

  /**
   * Update backup size after completion
   */
  async updateSize(id: string, size: bigint): Promise<Backup> {
    return this.prisma.backup.update({
      where: { id },
      data: { size, completedAt: new Date() },
    });
  }

  /**
   * Update Google Drive sync status
   */
  async updateGDriveStatus(
    id: string,
    status: GDriveSyncStatus,
    fileId?: string,
  ): Promise<Backup> {
    const data: Prisma.BackupUpdateInput = { gdriveStatus: status };

    if (fileId) {
      data.gdriveFileId = fileId;
    }

    if (status === GDriveSyncStatus.SYNCED) {
      data.gdriveSyncedAt = new Date();
    }

    return this.prisma.backup.update({
      where: { id },
      data,
    });
  }

  /**
   * Update Google Drive delete status
   */
  async updateGDriveDeleteStatus(
    id: string,
    status: GDriveDeleteStatus,
    error?: string,
  ): Promise<Backup> {
    const data: Prisma.BackupUpdateInput = {
      gdriveDeleteStatus: status,
    };

    if (error) {
      data.gdriveDeleteError = error;
    }

    if (status === GDriveDeleteStatus.FAILED) {
      // Increment attempt counter
      return this.prisma.backup.update({
        where: { id },
        data: {
          ...data,
          gdriveDeleteAttempts: { increment: 1 },
        },
      });
    }

    return this.prisma.backup.update({
      where: { id },
      data,
    });
  }

  /**
   * Mark backup as pending GDrive delete
   */
  async markPendingGDriveDelete(id: string): Promise<Backup> {
    return this.prisma.backup.update({
      where: { id },
      data: {
        gdriveDeleteStatus: GDriveDeleteStatus.PENDING,
        gdriveDeleteError: null,
      },
    });
  }

  /**
   * Find backups with pending or failed GDrive deletes
   */
  async findPendingOrFailedGDriveDeletes(): Promise<Backup[]> {
    return this.prisma.backup.findMany({
      where: {
        gdriveDeleteStatus: {
          in: [GDriveDeleteStatus.PENDING, GDriveDeleteStatus.FAILED],
        },
      },
      orderBy: { deletedAt: 'asc' },
    });
  }

  /**
   * Find backup by file path
   */
  async findByFilePath(filePath: string): Promise<Backup | null> {
    return this.prisma.backup.findFirst({
      where: { filePath },
    });
  }

  /**
   * Soft delete a backup (keeps record for history)
   */
  async softDelete(id: string, deletedById?: string): Promise<Backup> {
    try {
      return await this.prisma.backup.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedById,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to soft delete backup ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Restore a soft-deleted backup
   */
  async restore(id: string): Promise<Backup> {
    try {
      return await this.prisma.backup.update({
        where: { id },
        data: {
          deletedAt: null,
          deletedById: null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to restore backup ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Permanently delete a backup (hard delete)
   * Use with caution - this removes all history
   */
  async hardDelete(id: string): Promise<Backup> {
    try {
      return await this.prisma.backup.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Failed to hard delete backup ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Count backups
   */
  async count(options?: {
    status?: BackupStatus;
    type?: BackupType;
    includeDeleted?: boolean;
  }): Promise<number> {
    const where: Prisma.BackupWhereInput = {};

    if (!options?.includeDeleted) {
      where.deletedAt = null;
    }

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.type) {
      where.type = options.type;
    }

    return this.prisma.backup.count({ where });
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    deleted: number;
    totalSize: bigint;
    byType: Record<string, number>;
    byGDriveStatus: Record<string, number>;
  }> {
    const [total, completed, failed, inProgress, pending, deleted, sizeAgg, byType, byGDrive] =
      await Promise.all([
        this.prisma.backup.count({ where: { deletedAt: null } }),
        this.prisma.backup.count({
          where: { deletedAt: null, status: BackupStatus.COMPLETED },
        }),
        this.prisma.backup.count({
          where: { deletedAt: null, status: BackupStatus.FAILED },
        }),
        this.prisma.backup.count({
          where: { deletedAt: null, status: BackupStatus.IN_PROGRESS },
        }),
        this.prisma.backup.count({
          where: { deletedAt: null, status: BackupStatus.PENDING },
        }),
        this.prisma.backup.count({ where: { deletedAt: { not: null } } }),
        this.prisma.backup.aggregate({
          where: { deletedAt: null, status: BackupStatus.COMPLETED },
          _sum: { size: true },
        }),
        this.prisma.backup.groupBy({
          by: ['type'],
          where: { deletedAt: null },
          _count: true,
        }),
        this.prisma.backup.groupBy({
          by: ['gdriveStatus'],
          where: { deletedAt: null },
          _count: true,
        }),
      ]);

    return {
      total,
      completed,
      failed,
      inProgress,
      pending,
      deleted,
      totalSize: sizeAgg._sum.size ?? BigInt(0),
      byType: byType.reduce(
        (acc, item) => {
          acc[item.type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      byGDriveStatus: byGDrive.reduce(
        (acc, item) => {
          acc[item.gdriveStatus] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  /**
   * Get backup history with pagination
   */
  async getHistory(options?: {
    limit?: number;
    offset?: number;
    includeActive?: boolean;
  }): Promise<{ backups: BackupWithRelations[]; total: number }> {
    const where: Prisma.BackupWhereInput = options?.includeActive
      ? {}
      : { deletedAt: { not: null } };

    const [backups, total] = await Promise.all([
      this.prisma.backup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options?.limit ?? 100,
        skip: options?.offset ?? 0,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          deletedBy: { select: { id: true, name: true, email: true } },
          schedule: { select: { id: true, name: true } },
        },
      }),
      this.prisma.backup.count({ where }),
    ]);

    return { backups, total };
  }

  /**
   * Delete all backups permanently (for cleanup)
   */
  async deleteAll(): Promise<{ count: number }> {
    const result = await this.prisma.backup.deleteMany({});
    this.logger.warn(`Deleted all ${result.count} backup records from database`);
    return result;
  }
}
