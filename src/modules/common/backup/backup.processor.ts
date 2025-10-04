import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { BackupService, CreateBackupDto } from './backup.service';
import * as fs from 'fs/promises';

@Processor('backup-queue')
export class BackupProcessor {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(private readonly backupService: BackupService) {}

  @Process('create-backup')
  async handleCreateBackup(job: Job<CreateBackupDto & { backupId: string }>) {
    const { backupId, type, paths, priority, raidAware, compressionLevel, encrypted } = job.data;

    try {
      this.logger.log(`Starting backup: ${backupId} (type: ${type})`);

      // Update status to in_progress
      await this.backupService.updateBackupStatus(backupId, 'in_progress');

      let backupPath: string;

      // Use RAID-aware backup if enabled, otherwise fallback to legacy methods
      if (raidAware) {
        backupPath = await this.backupService.performRaidAwareBackup(backupId, type, paths, {
          priority,
          compressionLevel,
          encrypted,
        });
      } else {
        // Legacy backup methods for compatibility
        switch (type) {
          case 'database':
            backupPath = await this.backupService.performDatabaseBackup(backupId);
            break;
          case 'files':
            if (!paths || paths.length === 0) {
              // Use default paths based on priority
              const defaultPaths = this.backupService.getPathsByPriority(priority || 'medium');
              backupPath = await this.backupService.performFilesBackup(backupId, defaultPaths);
            } else {
              backupPath = await this.backupService.performFilesBackup(backupId, paths);
            }
            break;
          case 'full':
            backupPath = await this.backupService.performFullBackup(backupId);
            break;
          default:
            throw new Error(`Unknown backup type: ${type}`);
        }
      }

      // Get file size
      const stats = await fs.stat(backupPath);

      // Update metadata with completion info
      const metadata = await this.backupService.getBackupById(backupId);
      if (metadata) {
        metadata.status = 'completed';
        metadata.size = stats.size;
        metadata.priority = priority;
        metadata.raidAware = raidAware;
        metadata.compressionLevel = compressionLevel;
        metadata.encrypted = encrypted;
        await this.backupService.saveBackupMetadata(metadata);
      }

      this.logger.log(
        `Backup completed successfully: ${backupId} (${this.formatBytes(stats.size)})`,
      );
    } catch (error) {
      this.logger.error(`Backup failed: ${backupId} - ${error.message}`);
      await this.backupService.updateBackupStatus(backupId, 'failed', error.message);
      throw error;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  @Process('restore-backup')
  async handleRestoreBackup(
    job: Job<{
      backupId: string;
      backupPath: string;
      targetPath: string;
      metadata: any;
    }>,
  ) {
    const { backupId, backupPath, targetPath, metadata } = job.data;

    try {
      this.logger.log(`Starting restore: ${backupId} to ${targetPath}`);

      // Create target directory if it doesn't exist
      await fs.mkdir(targetPath, { recursive: true });

      // Extract backup to target path
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      if (metadata.type === 'database') {
        // For database backups, extract and provide instructions
        const extractCommand = `tar -xzf ${backupPath} -C ${targetPath}`;
        await execAsync(extractCommand);

        this.logger.log(`Database backup extracted to ${targetPath}. Manual restoration required.`);
      } else {
        // For file backups, extract directly
        const extractCommand = `tar -xzf ${backupPath} -C ${targetPath}`;
        await execAsync(extractCommand);

        this.logger.log(`Files restored to ${targetPath}`);
      }
    } catch (error) {
      this.logger.error(`Restore failed: ${backupId} - ${error.message}`);
      throw error;
    }
  }

  @Process('scheduled-backup')
  async handleScheduledBackup(job: Job<CreateBackupDto>) {
    try {
      this.logger.log(`Processing scheduled backup: ${job.data.name}`);

      // Create a new backup with a unique ID
      const scheduledBackupData = {
        ...job.data,
        name: `${job.data.name}_scheduled_${new Date().toISOString().split('T')[0]}`,
      };

      const result = await this.backupService.createBackup(scheduledBackupData);
      this.logger.log(`Scheduled backup queued: ${result.id}`);
    } catch (error) {
      this.logger.error(`Scheduled backup failed: ${error.message}`);
      throw error;
    }
  }
}
