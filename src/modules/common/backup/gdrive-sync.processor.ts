import { Processor, Process, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EventEmitter2 } from 'eventemitter2';
import { BackupRepository } from './backup.repository';
import { RcloneService } from './rclone.service';
import { GDriveSyncStatus, GDriveDeleteStatus } from '@prisma/client';
import {
  GDriveSyncJobData,
  GDriveDeleteJobData,
  GDriveSyncResult,
  GDriveDeleteResult,
} from './gdrive-sync.types';
import * as path from 'path';

@Processor('gdrive-sync-queue')
export class GDriveSyncProcessor {
  private readonly logger = new Logger(GDriveSyncProcessor.name);
  private readonly backupBasePath = process.env.BACKUP_PATH || '/mnt/backup';

  constructor(
    private readonly backupRepository: BackupRepository,
    private readonly rcloneService: RcloneService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Process('sync-backup')
  async handleSyncBackup(job: Job<GDriveSyncJobData>): Promise<GDriveSyncResult> {
    const { backupId, backupFilePath, backupType } = job.data;
    const startTime = Date.now();

    this.logger.log(`Starting GDrive sync for backup: ${backupId}`);

    try {
      // Build local and remote paths
      const localPath = path.join(this.backupBasePath, backupFilePath);
      const remotePath = backupFilePath; // Keep same structure on GDrive

      // Perform the upload with progress tracking
      const result = await this.rcloneService.copyFile(
        localPath,
        remotePath,
        (progress) => {
          // Emit progress events for WebSocket clients
          this.eventEmitter.emit('gdrive.sync-progress', {
            backupId,
            progress: progress.percent,
            bytesTransferred: progress.bytes,
            totalBytes: progress.totalBytes,
            speed: progress.speed,
            eta: progress.eta,
          });

          // Update job progress
          job.progress(progress.percent);
        },
      );

      const duration = Date.now() - startTime;

      if (result.success) {
        // Update database with success
        await this.backupRepository.updateGDriveStatus(
          backupId,
          GDriveSyncStatus.SYNCED,
          result.fileId,
        );

        this.logger.log(
          `GDrive sync completed for ${backupId} in ${this.formatDuration(duration)}`,
        );

        // Emit completion event
        this.eventEmitter.emit('gdrive.sync-completed', {
          backupId,
          gdriveFileId: result.fileId,
          bytesTransferred: result.bytesTransferred,
          duration,
        });

        return {
          success: true,
          backupId,
          gdriveFileId: result.fileId,
          bytesTransferred: result.bytesTransferred,
          duration,
        };
      } else {
        throw new Error(result.error || 'Unknown sync error');
      }
    } catch (error) {
      this.logger.error(`GDrive sync failed for ${backupId}: ${error.message}`);

      // Update database with failure
      await this.backupRepository.updateGDriveStatus(backupId, GDriveSyncStatus.FAILED);
      await this.backupRepository.update(backupId, { error: error.message });

      // Emit failure event
      this.eventEmitter.emit('gdrive.sync-failed', {
        backupId,
        error: error.message,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts || 3,
      });

      throw error;
    }
  }

  @Process('delete-from-gdrive')
  async handleDeleteFromGDrive(job: Job<GDriveDeleteJobData>): Promise<GDriveDeleteResult> {
    const { backupId, gdriveFileId } = job.data;

    this.logger.log(`Starting GDrive delete for backup: ${backupId}`);

    try {
      // Mark as pending delete
      await this.backupRepository.updateGDriveDeleteStatus(backupId, GDriveDeleteStatus.PENDING);

      // Delete by backup ID (searches all type directories)
      const result = await this.rcloneService.deleteByBackupId(backupId);

      if (result.success) {
        // Update database - mark sync status as DELETED and delete status as DELETED
        await this.backupRepository.updateGDriveStatus(backupId, GDriveSyncStatus.DELETED);
        await this.backupRepository.updateGDriveDeleteStatus(backupId, GDriveDeleteStatus.DELETED);

        this.logger.log(`GDrive delete completed for backup: ${backupId}`);

        // Emit deletion completed event
        this.eventEmitter.emit('gdrive.delete-completed', { backupId });

        return { success: true, backupId };
      } else {
        throw new Error(result.error || 'Unknown delete error');
      }
    } catch (error) {
      this.logger.error(`GDrive delete failed for ${backupId}: ${error.message}`);

      // Update delete status as failed
      await this.backupRepository.updateGDriveDeleteStatus(
        backupId,
        GDriveDeleteStatus.FAILED,
        error.message,
      );

      // Emit failure event
      this.eventEmitter.emit('gdrive.delete-failed', {
        backupId,
        error: error.message,
        attempt: job.attemptsMade + 1,
      });

      throw error;
    }
  }

  @Process('retry-failed-syncs')
  async handleRetryFailedSyncs(job: Job): Promise<{ retriedCount: number }> {
    this.logger.log('Processing retry-failed-syncs job');

    const failedBackups = await this.backupRepository.findAll({
      status: undefined,
      includeDeleted: false,
    });

    const failedSyncs = failedBackups.filter(
      (b) => b.gdriveStatus === GDriveSyncStatus.FAILED && b.filePath,
    );

    let retriedCount = 0;

    for (const backup of failedSyncs) {
      try {
        // Reset status to SYNCING
        await this.backupRepository.updateGDriveStatus(backup.id, GDriveSyncStatus.SYNCING);

        // Build paths
        const localPath = path.join(this.backupBasePath, backup.filePath!);
        const remotePath = backup.filePath!;

        // Attempt sync
        const result = await this.rcloneService.copyFile(localPath, remotePath);

        if (result.success) {
          await this.backupRepository.updateGDriveStatus(
            backup.id,
            GDriveSyncStatus.SYNCED,
            result.fileId,
          );
          retriedCount++;
          this.logger.log(`Retry successful for backup: ${backup.id}`);
        } else {
          await this.backupRepository.updateGDriveStatus(backup.id, GDriveSyncStatus.FAILED);
          this.logger.warn(`Retry failed for backup: ${backup.id}`);
        }
      } catch (error) {
        await this.backupRepository.updateGDriveStatus(backup.id, GDriveSyncStatus.FAILED);
        this.logger.error(`Retry error for backup ${backup.id}: ${error.message}`);
      }
    }

    this.logger.log(`Retry job completed: ${retriedCount}/${failedSyncs.length} syncs successful`);
    return { retriedCount };
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.debug(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }
}
