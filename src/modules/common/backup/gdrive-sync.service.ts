import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { EventEmitter2 } from 'eventemitter2';
import { BackupRepository } from './backup.repository';
import { RcloneService } from './rclone.service';
import { GDriveSyncStatus } from '@prisma/client';
import {
  GDriveSyncJobData,
  GDriveDeleteJobData,
  GDriveSyncStats,
} from './gdrive-sync.types';

@Injectable()
export class GDriveSyncService {
  private readonly logger = new Logger(GDriveSyncService.name);

  constructor(
    @InjectQueue('gdrive-sync-queue') private gdriveSyncQueue: Queue,
    private readonly backupRepository: BackupRepository,
    private readonly rcloneService: RcloneService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Queue a backup for Google Drive sync
   */
  async queueSync(
    backupId: string,
    backupFilePath: string,
    backupType: 'database' | 'files' | 'system' | 'full',
  ): Promise<Job<GDriveSyncJobData>> {
    this.logger.log(`Queueing GDrive sync for backup: ${backupId}`);

    // Update status to SYNCING in database
    await this.backupRepository.updateGDriveStatus(backupId, GDriveSyncStatus.SYNCING);

    // Emit syncing event
    this.eventEmitter.emit('gdrive.sync-started', { backupId });

    const job = await this.gdriveSyncQueue.add(
      'sync-backup',
      {
        backupId,
        backupFilePath,
        backupType,
        retryCount: 0,
      } as GDriveSyncJobData,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000, // Start with 1 minute, then 2, then 4
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
      },
    );

    this.logger.log(`GDrive sync job created: ${job.id} for backup: ${backupId}`);
    return job;
  }

  /**
   * Queue a backup for deletion from Google Drive
   */
  async queueDelete(
    backupId: string,
    gdriveFileId?: string,
  ): Promise<Job<GDriveDeleteJobData>> {
    this.logger.log(`Queueing GDrive delete for backup: ${backupId}`);

    const job = await this.gdriveSyncQueue.add(
      'delete-from-gdrive',
      {
        backupId,
        gdriveFileId,
        retryCount: 0,
      } as GDriveDeleteJobData,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 30000, // Start with 30 seconds
        },
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );

    this.logger.log(`GDrive delete job created: ${job.id} for backup: ${backupId}`);
    return job;
  }

  /**
   * Retry all failed syncs
   */
  async retryFailedSyncs(): Promise<{ retriedCount: number; backupIds: string[] }> {
    const failedBackups = await this.backupRepository.findAll({
      status: undefined,
      includeDeleted: false,
    });

    const failedSyncs = failedBackups.filter(
      (b) => b.gdriveStatus === GDriveSyncStatus.FAILED && b.filePath,
    );

    const retriedBackupIds: string[] = [];

    for (const backup of failedSyncs) {
      try {
        const backupType = this.mapDbTypeToDto(backup.type);
        await this.queueSync(backup.id, backup.filePath!, backupType);
        retriedBackupIds.push(backup.id);
      } catch (error) {
        this.logger.error(`Failed to retry sync for ${backup.id}: ${error.message}`);
      }
    }

    this.logger.log(`Retried ${retriedBackupIds.length} failed syncs`);
    return {
      retriedCount: retriedBackupIds.length,
      backupIds: retriedBackupIds,
    };
  }

  /**
   * Retry a specific failed sync
   */
  async retrySingleSync(backupId: string): Promise<Job<GDriveSyncJobData> | null> {
    const backup = await this.backupRepository.findById(backupId);

    if (!backup) {
      this.logger.warn(`Backup not found: ${backupId}`);
      return null;
    }

    if (!backup.filePath) {
      this.logger.warn(`Backup has no file path: ${backupId}`);
      return null;
    }

    const backupType = this.mapDbTypeToDto(backup.type);
    return this.queueSync(backupId, backup.filePath, backupType);
  }

  /**
   * Get sync status for a specific backup
   */
  async getSyncStatus(backupId: string): Promise<{
    backupId: string;
    status: GDriveSyncStatus;
    gdriveFileId?: string;
    syncedAt?: Date;
    error?: string;
  } | null> {
    const backup = await this.backupRepository.findById(backupId);

    if (!backup) {
      return null;
    }

    return {
      backupId: backup.id,
      status: backup.gdriveStatus,
      gdriveFileId: backup.gdriveFileId || undefined,
      syncedAt: backup.gdriveSyncedAt || undefined,
      error: backup.error || undefined,
    };
  }

  /**
   * Get sync statistics
   */
  async getSyncStats(): Promise<GDriveSyncStats> {
    const stats = await this.backupRepository.getStatistics();

    return {
      pending: stats.byGDriveStatus['PENDING'] || 0,
      syncing: stats.byGDriveStatus['SYNCING'] || 0,
      synced: stats.byGDriveStatus['SYNCED'] || 0,
      failed: stats.byGDriveStatus['FAILED'] || 0,
      totalBytesUploaded: stats.totalSize,
    };
  }

  /**
   * Get queue status
   */
  async getQueueStatus(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.gdriveSyncQueue.getWaitingCount(),
      this.gdriveSyncQueue.getActiveCount(),
      this.gdriveSyncQueue.getCompletedCount(),
      this.gdriveSyncQueue.getFailedCount(),
      this.gdriveSyncQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get pending sync backups
   */
  async getPendingSyncs(): Promise<{ id: string; name: string; type: string; createdAt: Date }[]> {
    const backups = await this.backupRepository.findPendingGDriveSync();

    return backups.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      createdAt: b.createdAt,
    }));
  }

  /**
   * Check Google Drive connection status
   */
  async checkConnection(): Promise<{ connected: boolean; error?: string }> {
    return this.rcloneService.checkConnection();
  }

  /**
   * Get Google Drive storage info
   */
  async getStorageInfo(): Promise<{
    usage: {
      used: string;
      total: string;
      free: string;
      usedBytes: number;
      totalBytes: number;
    } | null;
    backupFolder: {
      count: number;
      size: string;
      sizeBytes: number;
    } | null;
  }> {
    const [usage, backupFolder] = await Promise.all([
      this.rcloneService.getStorageUsage(),
      this.rcloneService.getBackupFolderSize(),
    ]);

    return { usage, backupFolder };
  }

  private mapDbTypeToDto(dbType: string): 'database' | 'files' | 'system' | 'full' {
    const mapping: Record<string, 'database' | 'files' | 'system' | 'full'> = {
      DATABASE: 'database',
      FILES: 'files',
      SYSTEM: 'system',
      FULL: 'full',
    };
    return mapping[dbType] || 'database';
  }
}
