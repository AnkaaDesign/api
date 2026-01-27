import { Injectable, Logger, InternalServerErrorException, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from 'eventemitter2';
import { BackupRepository } from './backup.repository';
import { BackupScheduleRepository } from './backup-schedule.repository';
import { GDriveSyncService } from './gdrive-sync.service';
import {
  BackupType,
  BackupPriority,
  BackupSchedule,
  BackupStatus,
  GDriveSyncStatus,
  Backup,
} from '@prisma/client';

const execAsync = promisify(exec);

export interface BackupMetadata {
  id: string;
  name: string;
  type: 'database' | 'files' | 'system' | 'full';
  size: number;
  createdAt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
  paths?: string[];
  error?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  compressionLevel?: number;
  encrypted?: boolean;
  autoDelete?: {
    enabled: boolean;
    retention:
      | '1_day'
      | '3_days'
      | '1_week'
      | '2_weeks'
      | '1_month'
      | '3_months'
      | '6_months'
      | '1_year';
    deleteAfter?: string; // ISO date string when backup should be deleted
  };
}

export interface CreateBackupDto {
  name: string;
  type: 'database' | 'files' | 'system' | 'full';
  description?: string;
  paths?: string[];
  schedule?: {
    enabled: boolean;
    cron: string;
  };
  priority?: 'low' | 'medium' | 'high' | 'critical';
  compressionLevel?: number;
  encrypted?: boolean;
  autoDelete?: {
    enabled: boolean;
    retention:
      | '1_day'
      | '3_days'
      | '1_week'
      | '2_weeks'
      | '1_month'
      | '3_months'
      | '6_months'
      | '1_year';
  };
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly filesRoot = '/srv/files';
  private readonly backupBasePath = process.env.BACKUP_PATH || '/mnt/backup';
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';
  private readonly productionBasePath = '/home/kennedy/ankaa';

  // RAID-aware and priority-based backup paths (production only)
  private readonly criticalPaths = this.isDevelopment
    ? []
    : [
        `${this.productionBasePath}`,
        `${this.productionBasePath}/.env`,
        `${this.productionBasePath}/apps/api/.env`,
      ];

  private readonly highPriorityPaths = this.isDevelopment
    ? []
    : [
        `${this.productionBasePath}/apps`,
        `${this.productionBasePath}/packages`,
        `${this.productionBasePath}/scripts`,
        '/etc/nginx',
        '/etc/ssl',
      ];

  private readonly mediumPriorityPaths = this.isDevelopment
    ? []
    : [
        `${this.productionBasePath}/docs`,
        `${this.productionBasePath}/test-examples`,
        '/var/log/nginx',
        '/var/www',
      ];

  private readonly lowPriorityPaths = this.isDevelopment
    ? []
    : [`${this.productionBasePath}/node_modules`, `${this.productionBasePath}/.git`, '/tmp'];

  private gdriveSyncService: GDriveSyncService | null = null;

  constructor(
    @InjectQueue('backup-queue') private backupQueue: Queue,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private backupRepository: BackupRepository,
    private backupScheduleRepository: BackupScheduleRepository,
  ) {
    this.ensureBackupDirectories();
  }

  /**
   * Set GDriveSyncService reference (to avoid circular dependency)
   */
  setGDriveSyncService(service: GDriveSyncService): void {
    this.gdriveSyncService = service;
  }

  /**
   * Get date-based path for backup organization
   * Format: YYYY/MM/DD
   */
  private getDateBasedPath(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  /**
   * Get full backup directory path with date organization
   * Example: /mnt/backup/banco-de-dados/2025/10/25/
   *
   * Folder naming convention (Portuguese):
   * - database → banco-de-dados
   * - files → arquivos
   * - system → sistema
   * - full → completo
   */
  private getBackupDirectoryPath(
    type: 'database' | 'files' | 'system' | 'full' | 'arquivos' | 'sistema' | 'banco-de-dados' | 'completo',
  ): string {
    // Map English type names to Portuguese folder names
    const folderMapping: Record<string, string> = {
      database: 'banco-de-dados',
      files: 'arquivos',
      system: 'sistema',
      full: 'completo',
      // Already Portuguese names pass through
      arquivos: 'arquivos',
      sistema: 'sistema',
      'banco-de-dados': 'banco-de-dados',
      completo: 'completo',
    };

    const typeFolder = folderMapping[type] || type;
    const datePath = this.getDateBasedPath();
    return path.join(this.backupBasePath, typeFolder, datePath);
  }

  private async ensureBackupDirectories(): Promise<void> {
    try {
      // Create base directories (Portuguese naming convention)
      const baseDirectories = ['banco-de-dados', 'arquivos', 'sistema', 'completo'];
      for (const dir of baseDirectories) {
        const dirPath = path.join(this.backupBasePath, dir);
        await fs.mkdir(dirPath, { recursive: true });
        // Set proper permissions for files storage (kennedy:www-data, 2775) - production only
        // kennedy (owner) can write/delete, www-data (group) can read for nginx
        if (!this.isDevelopment) {
          try {
            await execAsync(`chown kennedy:www-data "${dirPath}"`);
            await execAsync(`chmod 2775 "${dirPath}"`);
          } catch (permError) {
            // Fallback to sudo if needed
            try {
              await execAsync(`sudo chown kennedy:www-data "${dirPath}"`);
              await execAsync(`sudo chmod 2775 "${dirPath}"`);
            } catch (sudoError) {
              this.logger.warn(`Could not set permissions on ${dirPath}: ${sudoError.message}`);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to create backup directories: ${error.message}`);
      throw error; // Throw error instead of silently continuing
    }
  }

  /**
   * Ensure date-based directory exists for a specific backup type
   * Creates structure: /banco-de-dados/2025/10/25/backup_XXX/
   */
  private async ensureDateBasedDirectory(
    type: 'database' | 'files' | 'system' | 'full' | 'arquivos' | 'sistema' | 'banco-de-dados' | 'completo',
    backupId: string,
  ): Promise<string> {
    const dateBasedPath = this.getBackupDirectoryPath(type);
    const backupFolderPath = path.join(dateBasedPath, backupId);

    try {
      await fs.mkdir(backupFolderPath, { recursive: true });
      // NOTE: Don't set www-data permissions here - it prevents the running user from writing.
      // Permissions will be set AFTER backup files are created via setBackupPermissions()
      return backupFolderPath;
    } catch (error) {
      this.logger.error(`Failed to create backup directory ${backupFolderPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set final permissions on backup directory after files are created.
   * Makes backup accessible to www-data for web server access while keeping
   * kennedy as owner for delete operations.
   *
   * Ownership: kennedy:www-data (owner can delete, group can read)
   * Mode: 2775 (setgid for group inheritance)
   *
   * NOTE: This should be called AFTER metadata is saved to avoid permission issues.
   */
  async setBackupPermissions(backupPath: string): Promise<void> {
    if (this.isDevelopment) return;

    try {
      // Use kennedy:www-data ownership so:
      // - kennedy (API user) can delete files without sudo
      // - www-data (nginx) can read files via group permissions
      await execAsync(`chown -R kennedy:www-data "${backupPath}"`);
      await execAsync(`chmod -R 2775 "${backupPath}"`);
    } catch (permError) {
      // If chown fails (e.g., not owner), try with sudo as fallback
      try {
        await execAsync(`sudo chown -R kennedy:www-data "${backupPath}"`);
        await execAsync(`sudo chmod -R 2775 "${backupPath}"`);
      } catch (sudoError) {
        this.logger.warn(`Could not set permissions on ${backupPath}: ${sudoError.message}`);
      }
    }
  }

  async createBackup(
    createBackupDto: CreateBackupDto,
    userId?: string,
  ): Promise<{ id: string; message: string }> {
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      // Calculate auto-delete date if enabled
      let autoDeleteAfter: Date | undefined = undefined;
      if (createBackupDto.autoDelete?.enabled) {
        autoDeleteAfter = this.calculateDeleteAfterDate(createBackupDto.autoDelete.retention);
      }

      // Create backup record in database
      await this.backupRepository.create({
        id: backupId,
        name: createBackupDto.name,
        type: this.mapDtoTypeToDb(createBackupDto.type),
        description: createBackupDto.description,
        paths: createBackupDto.paths,
        priority: this.mapDtoPriorityToDb(createBackupDto.priority),
        compressionLevel: createBackupDto.compressionLevel,
        encrypted: createBackupDto.encrypted,
        autoDeleteEnabled: createBackupDto.autoDelete?.enabled ?? false,
        autoDeleteRetention: createBackupDto.autoDelete?.retention,
        autoDeleteAfter,
        createdById: userId,
      });

      // Queue the backup job
      await this.backupQueue.add(
        'create-backup',
        {
          backupId,
          ...createBackupDto,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      this.logger.log(`Backup job queued: ${backupId}`);

      return {
        id: backupId,
        message: 'Backup job queued successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to create backup job: ${error.message}`);
      throw new InternalServerErrorException('Failed to create backup job');
    }
  }

  /**
   * Register an external backup created by shell scripts
   * This allows backups created outside the API to appear in the UI
   */
  async registerExternalBackup(
    dto: {
      name: string;
      type: 'database' | 'files' | 'system' | 'full';
      filePath: string;
      size: number;
      description?: string;
      paths?: string[];
    },
    userId?: string,
  ): Promise<{ id: string }> {
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      await this.backupRepository.create({
        id: backupId,
        name: dto.name,
        type: this.mapDtoTypeToDb(dto.type),
        description: dto.description,
        paths: dto.paths || [],
        filePath: dto.filePath,
        createdById: userId,
      });

      // Update with size and mark as completed
      await this.backupRepository.update(backupId, {
        size: BigInt(dto.size),
        status: BackupStatus.COMPLETED,
        completedAt: new Date(),
      });

      this.logger.log(`External backup registered: ${backupId} (${dto.name})`);

      return { id: backupId };
    } catch (error) {
      this.logger.error(`Failed to register external backup: ${error.message}`);
      throw new InternalServerErrorException('Failed to register external backup');
    }
  }

  /**
   * Get all backups from database
   * Returns backups in a format compatible with the frontend
   */
  async getBackups(): Promise<BackupMetadata[]> {
    try {
      const backups = await this.backupRepository.findAll();
      return backups.map(backup => this.mapDbToMetadata(backup));
    } catch (error) {
      this.logger.error(`Failed to get backups: ${error.message}`);
      throw new InternalServerErrorException('Failed to retrieve backups');
    }
  }

  /**
   * Get deleted backups (history)
   */
  async getDeletedBackups(): Promise<BackupMetadata[]> {
    try {
      const backups = await this.backupRepository.findAllDeleted();
      return backups.map(backup => this.mapDbToMetadata(backup));
    } catch (error) {
      this.logger.error(`Failed to get deleted backups: ${error.message}`);
      throw new InternalServerErrorException('Failed to retrieve deleted backups');
    }
  }

  /**
   * Map database Backup to BackupMetadata format for frontend compatibility
   */
  private mapDbToMetadata(backup: Backup): BackupMetadata {
    return {
      id: backup.id,
      name: backup.name,
      type: this.mapDbTypeToDto(backup.type),
      size: Number(backup.size),
      createdAt: backup.createdAt.toISOString(),
      status: backup.status.toLowerCase() as BackupMetadata['status'],
      description: backup.description || undefined,
      paths: backup.paths,
      error: backup.error || undefined,
      priority: this.mapDbPriorityToDto(backup.priority),
      compressionLevel: backup.compressionLevel,
      encrypted: backup.encrypted,
      autoDelete: backup.autoDeleteEnabled
        ? {
            enabled: true,
            retention: backup.autoDeleteRetention as BackupMetadata['autoDelete']['retention'],
            deleteAfter: backup.autoDeleteAfter?.toISOString(),
          }
        : undefined,
    };
  }

  async getBackupById(backupId: string): Promise<BackupMetadata | null> {
    try {
      const backup = await this.backupRepository.findById(backupId);
      if (!backup) {
        return null;
      }
      return this.mapDbToMetadata(backup);
    } catch (error) {
      this.logger.error(`Failed to get backup metadata: ${error.message}`);
      throw new InternalServerErrorException('Failed to get backup metadata');
    }
  }

  /**
   * Get raw backup from database (for internal use)
   */
  async getBackupRecord(backupId: string): Promise<Backup | null> {
    return this.backupRepository.findById(backupId);
  }

  /**
   * Soft delete a backup (marks as deleted in database, deletes physical files)
   * The backup record is preserved for history/audit purposes
   */
  async deleteBackup(backupId: string, userId?: string): Promise<void> {
    try {
      const backup = await this.backupRepository.findById(backupId);
      if (!backup) {
        throw new Error('Backup not found');
      }

      // Delete physical backup files
      await this.deleteBackupFiles(backup);

      // Soft delete in database (preserves history)
      await this.backupRepository.softDelete(backupId, userId);

      // Queue Google Drive deletion (replaces fire-and-forget)
      if (this.gdriveSyncService) {
        try {
          await this.gdriveSyncService.queueDelete(backupId, backup.gdriveFileId || undefined);
        } catch (syncError) {
          this.logger.error(`Failed to queue GDrive delete: ${syncError.message}`);
          // Don't throw - local delete succeeded
        }
      } else {
        // Fallback to shell script if service not available
        this.deleteFromGoogleDrive(backupId);
      }

      // Emit deletion event so frontend can update
      this.eventEmitter.emit('backup.deleted', {
        backupId,
        deletedAt: Date.now(),
      });

      this.logger.log(`Backup ${backupId} soft deleted successfully`);
    } catch (error) {
      this.logger.error(`Failed to delete backup: ${error.message}`);
      throw new InternalServerErrorException(`Failed to delete backup: ${error.message}`);
    }
  }

  /**
   * Hard delete a backup (permanently removes from database and files)
   * Use with caution - this removes all history
   */
  async hardDeleteBackup(backupId: string): Promise<void> {
    try {
      const backup = await this.backupRepository.findById(backupId, true); // Include deleted
      if (!backup) {
        throw new Error('Backup not found');
      }

      // Delete physical backup files if they still exist
      await this.deleteBackupFiles(backup);

      // Hard delete from database
      await this.backupRepository.hardDelete(backupId);

      // Queue Google Drive deletion (replaces fire-and-forget)
      if (this.gdriveSyncService) {
        try {
          await this.gdriveSyncService.queueDelete(backupId, backup.gdriveFileId || undefined);
        } catch (syncError) {
          this.logger.error(`Failed to queue GDrive delete: ${syncError.message}`);
        }
      } else {
        this.deleteFromGoogleDrive(backupId);
      }

      this.logger.log(`Backup ${backupId} permanently deleted`);
    } catch (error) {
      this.logger.error(`Failed to hard delete backup: ${error.message}`);
      throw new InternalServerErrorException(`Failed to hard delete backup: ${error.message}`);
    }
  }

  /**
   * Delete physical backup files from disk
   */
  private async deleteBackupFiles(backup: Backup): Promise<void> {
    // Map backup type to Portuguese folder name
    const folderMapping: Record<BackupType, string> = {
      [BackupType.DATABASE]: 'banco-de-dados',
      [BackupType.FILES]: 'arquivos',
      [BackupType.SYSTEM]: 'sistema',
      [BackupType.FULL]: 'completo',
    };
    const typeFolder = folderMapping[backup.type] || this.mapDbTypeToDto(backup.type);

    const basePath = path.join(this.backupBasePath, typeFolder);

    // If we have a stored file path, use it directly
    if (backup.filePath) {
      const fullPath = path.join(this.backupBasePath, backup.filePath);
      const dirPath = path.dirname(fullPath);
      try {
        await this.deleteBackupDirectory(dirPath, backup.id);
        return;
      } catch (error) {
        this.logger.warn(`Could not delete using stored path: ${error.message}`);
      }
    }

    // Otherwise, search for the backup directory
    const backupInfo = await this.findBackupDir(basePath, backup.id);
    if (backupInfo) {
      await this.deleteBackupDirectory(backupInfo.fullPath, backup.id);
    } else {
      // Try old flat structure as fallback
      const backupFileName = `${backup.id}.tar.gz`;
      const oldBackupPath = path.join(basePath, backupFileName);
      await this.deleteFileWithPermissions(oldBackupPath).catch(() => {});
      this.logger.warn(`Backup files not found for ${backup.id}, may have been already deleted`);
    }
  }

  /**
   * Recursively search for the backup directory
   */
  private async findBackupDir(
    searchPath: string,
    backupId: string,
    relPath: string = '',
  ): Promise<{ fullPath: string; relativePath: string } | null> {
    try {
      const entries = await fs.readdir(searchPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const fullPath = path.join(searchPath, entry.name);
        const currentRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        if (entry.name === backupId) {
          return { fullPath, relativePath: currentRelPath };
        }

        const found = await this.findBackupDir(fullPath, backupId, currentRelPath);
        if (found) return found;
      }
    } catch (error) {
      // Directory not accessible, skip
    }

    return null;
  }

  /**
   * Delete a backup directory with proper permissions handling.
   * With correct ownership (kennedy:www-data), deletion should work without sudo.
   * Sudo is only used as a fallback for legacy files owned by www-data.
   */
  private async deleteBackupDirectory(dirPath: string, backupId: string): Promise<boolean> {
    try {
      // First try normal deletion (should work if files are owned by kennedy)
      await fs.rm(dirPath, { recursive: true, force: true });
      this.logger.log(`Backup deleted (new structure): ${backupId} at ${dirPath}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`Backup directory not found at expected path: ${dirPath}`);
        return false;
      }

      // If permission denied in production, try to fix ownership first, then delete
      if (error.code === 'EACCES' && !this.isDevelopment) {
        this.logger.warn(`Permission denied for ${dirPath}, attempting to fix ownership...`);

        try {
          // First, try to change ownership to kennedy so we can delete
          await execAsync(`sudo chown -R kennedy:www-data "${dirPath}"`);
          // Now try deletion again
          await fs.rm(dirPath, { recursive: true, force: true });
          this.logger.log(`Backup deleted after fixing ownership: ${backupId} at ${dirPath}`);
          return true;
        } catch (chownError) {
          // If chown fails, try direct sudo rm as last resort
          this.logger.warn(`Ownership fix failed, trying sudo rm: ${chownError.message}`);
          try {
            await execAsync(`sudo rm -rf "${dirPath}"`, { timeout: 30000 });
            this.logger.log(`Backup deleted with sudo rm: ${backupId} at ${dirPath}`);
            return true;
          } catch (sudoError) {
            // Log detailed error for debugging
            this.logger.error(`All deletion methods failed for ${dirPath}:`);
            this.logger.error(`  Original error: ${error.message}`);
            this.logger.error(`  Chown error: ${chownError.message}`);
            this.logger.error(`  Sudo rm error: ${sudoError.message}`);
            throw new Error(`Failed to delete backup: All methods exhausted. Check sudo permissions for user kennedy.`);
          }
        }
      }

      this.logger.error(`Failed to delete backup directory: ${dirPath} - ${error.message}`);
      throw new Error(`Failed to delete backup: ${error.message}`);
    }
  }

  /**
   * Delete a single file with proper permissions handling.
   * With correct ownership (kennedy:www-data), deletion should work without sudo.
   */
  private async deleteFileWithPermissions(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath);
      this.logger.log(`Deleted file: ${filePath}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false; // File doesn't exist, not an error
      }

      // If permission denied in production, try to fix ownership first
      if (error.code === 'EACCES' && !this.isDevelopment) {
        this.logger.warn(`Permission denied for ${filePath}, attempting to fix...`);
        try {
          // Try to change ownership first
          await execAsync(`sudo chown kennedy:www-data "${filePath}"`);
          await fs.unlink(filePath);
          this.logger.log(`Deleted file after fixing ownership: ${filePath}`);
          return true;
        } catch (chownError) {
          // Fall back to sudo rm
          try {
            await execAsync(`sudo rm -f "${filePath}"`, { timeout: 30000 });
            this.logger.log(`Deleted file with sudo rm: ${filePath}`);
            return true;
          } catch (sudoError) {
            this.logger.error(`All deletion methods failed for ${filePath}: ${sudoError.message}`);
            throw new Error(`Permission denied - check sudo permissions for user kennedy`);
          }
        }
      }

      this.logger.warn(`Failed to delete file: ${filePath} - ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete backup from Google Drive
   * Runs asynchronously in the background to not block the response
   */
  private deleteFromGoogleDrive(backupId: string): void {
    this.logger.log(`Triggering Google Drive deletion for backup: ${backupId}`);

    exec(
      `/home/kennedy/scripts/backup/gdrive-delete.sh --id ${backupId}`,
      { timeout: 60000 }, // 1 minute timeout
      (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          this.logger.error(`Google Drive deletion failed for ${backupId}: ${error.message}`);
          if (stderr) this.logger.error(`Deletion stderr: ${stderr}`);
        } else {
          this.logger.log(`Google Drive deletion completed for backup: ${backupId}`);
          if (stdout) this.logger.debug(`Deletion stdout: ${stdout}`);
        }
      },
    );
  }

  /**
   * Emit backup completion event for WebSocket notification
   * Called by processor when backup completes successfully
   */
  emitBackupCompleted(backupId: string, size: number): void {
    this.eventEmitter.emit('backup.completed', {
      backupId,
      status: 'completed',
      size,
      completedAt: Date.now(),
    });

    // Also emit final progress event to ensure all listeners are notified
    this.eventEmitter.emit('backup.progress', {
      backupId,
      progress: 100,
      completed: true,
      timestamp: Date.now(),
    });

    this.logger.log(`Backup completion event emitted: ${backupId}`);
  }

  async restoreBackup(backupId: string, targetPath?: string): Promise<{ message: string }> {
    try {
      const metadata = await this.getBackupById(backupId);
      if (!metadata || metadata.status !== 'completed') {
        throw new Error('Backup not found or not completed');
      }

      const backupFileName = `${backupId}.tar.gz`;
      let backupPath: string;

      // Try new folder structure first (Portuguese folder names)
      const folderMapping: Record<string, string> = {
        database: 'banco-de-dados',
        files: 'arquivos',
        system: 'sistema',
        full: 'completo',
      };
      const typeFolder = folderMapping[metadata.type] || metadata.type;
      const dateBasedDir = this.getBackupDirectoryPath(typeFolder as any);
      const newBackupDir = path.join(dateBasedDir, backupId);
      const newBackupPath = path.join(newBackupDir, backupFileName);

      // Check if backup file exists in new structure
      try {
        await fs.access(newBackupPath);
        backupPath = newBackupPath;
        this.logger.log(`Using new structure backup: ${backupPath}`);
      } catch (error) {
        // Try old flat structure
        const oldBackupPath = path.join(this.backupBasePath, metadata.type, backupFileName);
        try {
          await fs.access(oldBackupPath);
          backupPath = oldBackupPath;
          this.logger.log(`Using old structure backup: ${backupPath}`);
        } catch (oldError) {
          this.logger.error(
            `Backup file not found in new path: ${newBackupPath} or old path: ${oldBackupPath}`,
          );
          throw new Error('Backup file not found');
        }
      }

      // Queue the restore job
      await this.backupQueue.add(
        'restore-backup',
        {
          backupId,
          backupPath,
          targetPath: targetPath || '/tmp/ankaa_restore',
          metadata,
        },
        {
          attempts: 1, // Restores should be done carefully
        },
      );

      return { message: 'Restore job queued successfully' };
    } catch (error) {
      this.logger.error(`Failed to queue restore job: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  /**
   * Execute tar command with real progress tracking using verbose output
   * Sends progress updates every 0.5 seconds via EventEmitter
   */
  private async executeTarWithProgress(
    tarCommand: string,
    backupId: string,
    totalFilesOrBytes?: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tarProcess = spawn('sh', ['-c', tarCommand]);
      let filesProcessed = 0;
      let lastProgress = 0;
      let lastEmitTime = Date.now();
      const EMIT_INTERVAL = 500; // Emit every 500ms as requested

      // CRITICAL: startTime must be declared BEFORE processOutput to avoid undefined reference
      const startTime = Date.now();

      // Capture both stdout and stderr for verbose tar output
      const processOutput = (data: Buffer) => {
        const output = data.toString();

        // Each line in verbose output represents a file being processed
        const lines = output.split('\n').filter(line => line.trim() && !line.startsWith('tar:'));
        filesProcessed += lines.length;

        // Calculate progress based on file count or estimated size
        let progress = 0;
        if (totalFilesOrBytes && totalFilesOrBytes > 0) {
          // If we're tracking bytes (for single file like database), use different calculation
          if (tarCommand.includes('.sql')) {
            // For database backup: tar processes quickly since it's a single file
            // Progress is based on verbose output lines which may include compression stats
            // Since it's essentially one file, we jump quickly through progress
            if (filesProcessed >= 1) {
              // Once we see the file being processed, we're past the dump phase
              // Estimate progress based on time elapsed (compression takes varying time)
              const elapsed = Date.now() - startTime;
              // Assume most database backups complete within 30 seconds of compression
              progress = Math.min(95, 50 + Math.round((elapsed / 30000) * 45));
            } else {
              // Still waiting for first output
              progress = Math.min(45, lastProgress + 5);
            }
          } else {
            // For multiple files, use file count
            progress = Math.min(95, Math.round((filesProcessed / totalFilesOrBytes) * 100));
          }
        } else {
          // No total estimate, just increment slowly
          progress = Math.min(95, lastProgress + 1);
        }

        const now = Date.now();
        const shouldEmit =
          (progress > lastProgress && now - lastEmitTime >= EMIT_INTERVAL) || progress === 95;

        if (shouldEmit) {
          lastProgress = progress;
          lastEmitTime = now;

          const progressData = {
            backupId,
            progress,
            filesProcessed,
            totalFiles: totalFilesOrBytes,
            timestamp: now,
            rate: filesProcessed / ((now - startTime) / 1000), // files per second
          };

          // Emit to EventEmitter for WebSocket/SSE
          this.eventEmitter.emit('backup.progress', progressData);

          // Also send webhook if configured
          this.sendProgressWebhook(backupId, progressData).catch(err => {
            this.logger.debug(`Webhook send failed: ${err.message}`);
          });

          // Update metadata with progress
          this.updateBackupProgress(backupId, progress).catch(err => {
            this.logger.debug(`Progress metadata update failed: ${err.message}`);
          });
        }
      };

      // Listen to both stdout and stderr
      tarProcess.stdout.on('data', processOutput);
      tarProcess.stderr.on('data', processOutput);

      tarProcess.on('close', code => {
        if (code === 0) {
          // Send final 100% progress
          const finalData = {
            backupId,
            progress: 100,
            filesProcessed,
            totalFiles: totalFilesOrBytes,
            timestamp: Date.now(),
            completed: true,
          };

          this.eventEmitter.emit('backup.progress', finalData);
          this.sendProgressWebhook(backupId, finalData).catch(() => {});

          resolve();
        } else {
          reject(new Error(`Tar process exited with code ${code}`));
        }
      });

      tarProcess.on('error', error => {
        reject(error);
      });
    });
  }

  /**
   * Send progress update via webhook
   */
  private async sendProgressWebhook(backupId: string, progressData: any): Promise<void> {
    // Use subdomain webhook URL or fallback to configured URL
    const webhookUrl =
      this.configService.get<string>('BACKUP_PROGRESS_WEBHOOK_URL') ||
      'https://webhook.ankaadesign.com.br/backup/progress';

    try {
      // Create HMAC signature if secret is configured
      const secret = this.configService.get<string>('WEBHOOK_SECRET');
      const headers: any = {
        'Content-Type': 'application/json',
      };

      const payload = {
        type: 'backup.progress',
        backupId,
        ...progressData,
      };

      if (secret) {
        const crypto = require('crypto');
        const signature = crypto
          .createHmac('sha256', secret)
          .update(JSON.stringify(payload))
          .digest('hex');
        headers['X-Webhook-Signature'] = signature;
      }

      // Use fetch or axios to send webhook
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }
    } catch (error) {
      // Webhook failures should not break the backup process
      this.logger.debug(`Failed to send progress webhook: ${error.message}`);
    }
  }

  /**
   * Update backup progress in database
   */
  private async updateBackupProgress(backupId: string, progress: number): Promise<void> {
    try {
      await this.backupRepository.updateProgress(backupId, progress);
    } catch (error) {
      // Silent fail - progress update is not critical
      this.logger.debug(`Progress update failed for ${backupId}: ${error.message}`);
    }
  }

  async performDatabaseBackup(backupId: string): Promise<string> {
    try {
      const dbUrl = this.configService.get<string>('DATABASE_URL');
      if (!dbUrl) {
        throw new Error('DATABASE_URL not configured');
      }

      // Ensure date-based directory exists with backup ID subfolder
      const backupDir = await this.ensureDateBasedDirectory('database', backupId);

      const backupFileName = `${backupId}.tar.gz`;
      const tempSqlFile = `/tmp/${backupId}.sql`;
      const finalBackupPath = path.join(backupDir, backupFileName);

      // Extract database connection details from URL
      const url = new URL(dbUrl);
      const dbName = url.pathname.substring(1);
      const host = url.hostname;
      const port = url.port || '5432';
      const username = url.username;
      const password = url.password;

      // Set environment variables for PostgreSQL
      const env = {
        ...process.env,
        PGPASSWORD: password,
      };

      // Create PostgreSQL dump
      const dumpCommand = `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} -f ${tempSqlFile} --no-password`;
      await execAsync(dumpCommand, { env });

      // Get SQL file size for progress tracking
      const stats = await fs.stat(tempSqlFile);
      const totalSize = stats.size;

      // Emit initial progress
      this.eventEmitter.emit('backup.progress', {
        backupId,
        progress: 10,
        status: 'Starting compression...',
        totalSize,
      });

      // Compress the SQL dump with verbose output for progress tracking
      // Use -v flag to get list of files being compressed
      const compressCommand = `tar -czvf ${finalBackupPath} -C /tmp ${backupId}.sql 2>&1`;

      // For database backups, we know it's a single file, so we can use pv (pipe viewer) if available
      // or track based on tar verbose output
      await this.executeTarWithProgress(compressCommand, backupId, totalSize);

      // Clean up temporary file
      await fs.unlink(tempSqlFile);

      // NOTE: Permissions are set by processor AFTER metadata is saved

      this.logger.log(`Database backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Database backup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Backup files storage directory as "arquivos"
   * Can backup specific paths or entire files storage directory
   * Excludes the Backup folder to avoid recursion
   */
  async performFilesBackup(backupId: string, paths?: string[]): Promise<string> {
    try {
      // Ensure date-based directory exists with backup ID subfolder
      const backupDir = await this.ensureDateBasedDirectory('arquivos', backupId);

      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(backupDir, backupFileName);

      let tarCommand: string;

      if (paths && paths.length > 0) {
        // Backup specific files storage subdirectories
        const validPaths: string[] = [];
        for (const targetPath of paths) {
          const fullPath = path.join(this.filesRoot, targetPath);
          try {
            await fs.access(fullPath);
            validPaths.push(targetPath); // Use relative path for tar
          } catch (error) {
            this.logger.warn(`Path not accessible, skipping: ${fullPath}`);
          }
        }

        if (validPaths.length === 0) {
          throw new Error('No valid files storage paths found for backup');
        }

        const pathsStr = validPaths.join(' ');
        tarCommand = `tar --exclude=Backup -czf "${finalBackupPath}" -C "${this.filesRoot}" ${pathsStr}`;
        this.logger.log(`Starting files storage backup for paths: ${pathsStr}`);
      } else {
        // Backup entire files storage directory excluding Backup folder
        tarCommand = `tar --exclude=Backup -czf "${finalBackupPath}" -C "${this.filesRoot}" .`;
        this.logger.log(
          `Starting full files storage backup: ${this.filesRoot} -> ${finalBackupPath}`,
        );
      }

      await execAsync(tarCommand);

      // NOTE: Permissions are set by processor AFTER metadata is saved

      this.logger.log(`files storage backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`files storage backup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Backup system configuration files (nginx, ssl, etc.)
   */
  async performSystemBackup(backupId: string, paths?: string[]): Promise<string> {
    try {
      // Ensure date-based directory exists with backup ID subfolder
      const backupDir = await this.ensureDateBasedDirectory('sistema', backupId);

      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(backupDir, backupFileName);

      // System configuration paths
      const systemPaths = paths || [
        '/etc/nginx',
        '/etc/ssl',
        '/etc/samba',
        '/etc/systemd/system',
        '/var/www',
        ...(this.isDevelopment
          ? []
          : [
              `${this.productionBasePath}/.env`,
              `${this.productionBasePath}/apps/api/.env`,
              `${this.productionBasePath}/ecosystem.production.js`,
            ]),
      ];

      // Validate paths
      const validPaths: string[] = [];
      for (const targetPath of systemPaths) {
        try {
          await fs.access(targetPath);
          validPaths.push(targetPath);
        } catch (error) {
          this.logger.warn(`System path not accessible, skipping: ${targetPath}`);
        }
      }

      if (validPaths.length === 0) {
        throw new Error('No valid system paths found for backup');
      }

      const pathsStr = validPaths.join(' ');
      // System backups always need sudo for /etc, /var, etc. and --ignore-failed-read for resilience
      const tarCommand = `sudo tar --ignore-failed-read -czf "${finalBackupPath}" ${pathsStr}`;

      this.logger.log(`Starting system backup for paths: ${pathsStr}`);
      await execAsync(tarCommand);

      // Fix ownership after sudo tar (so the backup file is owned by the running user)
      await execAsync(`sudo chown $(whoami):$(whoami) "${finalBackupPath}"`).catch(() => {});

      // NOTE: Permissions are set by processor AFTER metadata is saved

      this.logger.log(`System backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`System backup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all folders in the files storage directory (excluding Backup, Lixeira, hidden files, etc.)
   */
  async listStorageFolders(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.filesRoot, { withFileTypes: true });

      // Filter to only directories, excluding special folders
      const excludeFolders = ['Backup', 'Lixeira', '.recycle', 'Thumbnails'];

      const folders = entries
        .filter(entry => {
          // Only directories
          if (!entry.isDirectory()) return false;
          // Not hidden
          if (entry.name.startsWith('.')) return false;
          // Not in exclude list
          if (excludeFolders.includes(entry.name)) return false;
          return true;
        })
        .map(entry => entry.name)
        .sort(); // Sort alphabetically

      this.logger.log(`Found ${folders.length} storage folders: ${folders.join(', ')}`);
      return folders;
    } catch (error) {
      this.logger.error(`Failed to list storage folders: ${error.message}`);
      throw error;
    }
  }

  async performFullBackup(backupId: string): Promise<string> {
    const intermediateDirs: string[] = [];

    try {
      // Ensure date-based directory exists for full backup
      const backupDir = await this.ensureDateBasedDirectory('full', backupId);
      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(backupDir, backupFileName);

      // Track created backup files for combining
      const backupComponents: { path: string; name: string }[] = [];

      // 1. Create database backup
      this.logger.log(`Full backup [${backupId}]: Starting database backup...`);
      const dbBackupPath = await this.performDatabaseBackup(`${backupId}_db`);
      intermediateDirs.push(path.dirname(dbBackupPath));
      backupComponents.push({
        path: path.dirname(dbBackupPath),
        name: path.basename(dbBackupPath),
      });

      // 2. Create files storage backup (all of /srv/files excluding Backup folder)
      let filesBackupPath: string | null = null;
      try {
        const filesEntries = await fs.readdir(this.filesRoot);
        const hasContent = filesEntries.some(
          e => e !== 'Backup' && e !== 'Lixeira' && !e.startsWith('.'),
        );

        if (hasContent) {
          this.logger.log(`Full backup [${backupId}]: Starting files storage backup...`);
          filesBackupPath = await this.performFilesBackup(`${backupId}_files`);
          intermediateDirs.push(path.dirname(filesBackupPath));
          backupComponents.push({
            path: path.dirname(filesBackupPath),
            name: path.basename(filesBackupPath),
          });
        } else {
          this.logger.log(`Full backup [${backupId}]: Files storage is empty, skipping...`);
        }
      } catch (filesError) {
        this.logger.warn(
          `Full backup [${backupId}]: Files storage not accessible, skipping: ${filesError.message}`,
        );
      }

      // 3. Create system backup (nginx, ssl, app configs, etc.)
      this.logger.log(`Full backup [${backupId}]: Starting system backup...`);
      const systemBackupPath = await this.performSystemBackup(`${backupId}_system`);
      intermediateDirs.push(path.dirname(systemBackupPath));
      backupComponents.push({
        path: path.dirname(systemBackupPath),
        name: path.basename(systemBackupPath),
      });

      // 4. Combine all backups into one archive
      this.logger.log(`Full backup [${backupId}]: Combining ${backupComponents.length} components...`);

      // Build tar command dynamically
      const tarParts = backupComponents.map(c => `-C "${c.path}" "${c.name}"`).join(' ');
      const combineCommand = `tar -czf "${finalBackupPath}" ${tarParts}`;
      await execAsync(combineCommand);

      // 5. Clean up intermediate backup directories
      this.logger.log(`Full backup [${backupId}]: Cleaning up intermediate files...`);
      for (const dir of intermediateDirs) {
        await fs.rm(dir, { recursive: true, force: true }).catch(err => {
          this.logger.warn(`Failed to clean up ${dir}: ${err.message}`);
        });
      }

      this.logger.log(`Full backup completed successfully: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      // Clean up any intermediate files on failure
      this.logger.error(`Full backup failed: ${error.message}`);
      for (const dir of intermediateDirs) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Update backup completion info in database
   */
  async updateBackupCompletion(backupId: string, size: bigint, filePath: string): Promise<void> {
    try {
      await this.backupRepository.update(backupId, {
        status: BackupStatus.COMPLETED,
        size,
        filePath,
        completedAt: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to update backup completion: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update Google Drive sync status
   */
  async updateGDriveStatus(
    backupId: string,
    status: GDriveSyncStatus,
    fileId?: string,
  ): Promise<void> {
    try {
      await this.backupRepository.updateGDriveStatus(backupId, status, fileId);
    } catch (error) {
      this.logger.error(`Failed to update GDrive status: ${error.message}`);
    }
  }

  async updateBackupStatus(
    backupId: string,
    status: BackupMetadata['status'],
    error?: string,
  ): Promise<void> {
    try {
      const dbStatus = this.mapStatusToDb(status);
      await this.backupRepository.updateStatus(backupId, dbStatus, error);
    } catch (err) {
      this.logger.error(`Failed to update backup status: ${err.message}`);
    }
  }

  /**
   * Map string status to database enum
   */
  private mapStatusToDb(status: BackupMetadata['status']): BackupStatus {
    const mapping: Record<string, BackupStatus> = {
      pending: BackupStatus.PENDING,
      in_progress: BackupStatus.IN_PROGRESS,
      completed: BackupStatus.COMPLETED,
      failed: BackupStatus.FAILED,
    };
    return mapping[status] || BackupStatus.PENDING;
  }

  async scheduleBackup(createBackupDto: CreateBackupDto, userId?: string): Promise<{ message: string; scheduleId: string }> {
    try {
      if (!createBackupDto.schedule?.enabled || !createBackupDto.schedule.cron) {
        throw new Error('Invalid schedule configuration');
      }

      // First, persist to database for durability
      const dbSchedule = await this.backupScheduleRepository.create({
        name: createBackupDto.name,
        type: this.mapDtoTypeToDb(createBackupDto.type),
        description: createBackupDto.description,
        paths: createBackupDto.paths,
        cronExpression: createBackupDto.schedule.cron,
        enabled: true,
        priority: this.mapDtoPriorityToDb(createBackupDto.priority),
        compressionLevel: createBackupDto.compressionLevel ?? 6,
        encrypted: createBackupDto.encrypted ?? false,
        autoDeleteEnabled: createBackupDto.autoDelete?.enabled ?? false,
        autoDeleteRetention: createBackupDto.autoDelete?.retention,
        createdById: userId,
      });

      // Generate unique job name using database ID for consistency
      const jobName = `scheduled-backup-${createBackupDto.name}-${dbSchedule.id}`;

      // Add a cron job to the queue with unique identifier
      await this.backupQueue.add('scheduled-backup', createBackupDto, {
        jobId: jobName,
        repeat: { cron: createBackupDto.schedule.cron },
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      // Update database with Bull job ID and next run time
      const nextRunAt = this.calculateNextRunTime(createBackupDto.schedule.cron);
      await this.backupScheduleRepository.update(dbSchedule.id, {
        bullJobId: jobName,
        nextRunAt,
      });

      this.logger.log(`Backup scheduled: ${jobName} with cron: ${createBackupDto.schedule.cron} (DB ID: ${dbSchedule.id})`);
      return { message: 'Backup scheduled successfully', scheduleId: dbSchedule.id };
    } catch (error) {
      this.logger.error(`Failed to schedule backup: ${error.message}`);
      throw new InternalServerErrorException('Failed to schedule backup');
    }
  }

  async getScheduledBackups(): Promise<any[]> {
    try {
      // Get schedules from database (primary source of truth)
      const dbSchedules = await this.backupScheduleRepository.findAll();

      // Get Bull queue jobs for enrichment
      const repeatableJobs = await this.backupQueue.getRepeatableJobs();
      const bullJobsMap = new Map(repeatableJobs.map(job => [job.id || job.key, job]));

      // Map database schedules with Bull queue info
      return dbSchedules.map(schedule => {
        const bullJob = schedule.bullJobId ? bullJobsMap.get(schedule.bullJobId) : null;

        return {
          id: schedule.id, // Database ID for API operations
          bullJobId: schedule.bullJobId,
          name: schedule.name,
          type: this.mapDbTypeToDto(schedule.type),
          description: schedule.description,
          paths: schedule.paths,
          cron: schedule.cronExpression,
          enabled: schedule.enabled,
          priority: this.mapDbPriorityToDto(schedule.priority),
          compressionLevel: schedule.compressionLevel,
          encrypted: schedule.encrypted,
          autoDelete: schedule.autoDeleteEnabled
            ? {
                enabled: true,
                retention: schedule.autoDeleteRetention,
              }
            : undefined,
          // Execution stats
          lastRunAt: schedule.lastRunAt,
          nextRunAt: schedule.nextRunAt || (bullJob ? new Date(bullJob.next) : null),
          lastStatus: schedule.lastStatus,
          lastError: schedule.lastError,
          runCount: schedule.runCount,
          failureCount: schedule.failureCount,
          // Timestamps
          createdAt: schedule.createdAt,
          updatedAt: schedule.updatedAt,
          // Bull queue info (for legacy compatibility)
          key: bullJob?.key,
          jobName: bullJob?.name,
        };
      });
    } catch (error) {
      this.logger.error(`Failed to get scheduled backups: ${error.message}`);
      throw new InternalServerErrorException('Failed to get scheduled backups');
    }
  }

  async removeScheduledBackup(scheduleId: string, deletedById?: string): Promise<void> {
    try {
      // First, try to find in database (primary source)
      const dbSchedule = await this.backupScheduleRepository.findById(scheduleId);

      if (dbSchedule) {
        // Remove from Bull queue if exists
        if (dbSchedule.bullJobId) {
          const repeatableJobs = await this.backupQueue.getRepeatableJobs();
          const job = repeatableJobs.find(
            j => j.id === dbSchedule.bullJobId || j.key === dbSchedule.bullJobId,
          );

          if (job) {
            await this.backupQueue.removeRepeatableByKey(job.key);
            this.logger.log(`Bull job removed: ${job.key}`);
          }
        }

        // Soft delete from database (keeps record for history)
        await this.backupScheduleRepository.softDelete(dbSchedule.id, deletedById);
        this.logger.log(`Scheduled backup soft-deleted: ${dbSchedule.name} (ID: ${dbSchedule.id})`);
        return;
      }

      // Fallback: try to find by Bull job ID (for legacy schedules)
      const repeatableJobs = await this.backupQueue.getRepeatableJobs();
      const job = repeatableJobs.find(
        j => j.id === scheduleId || j.key === scheduleId || j.name === scheduleId,
      );

      if (job) {
        await this.backupQueue.removeRepeatableByKey(job.key);
        this.logger.log(`Legacy scheduled backup removed from Bull queue: ${job.name} (key: ${job.key})`);

        // Also soft delete from database by Bull job ID
        await this.backupScheduleRepository.softDeleteByBullJobId(job.id || job.key, deletedById);
        return;
      }

      this.logger.warn(`Scheduled backup not found with identifier: ${scheduleId}`);
      throw new Error('Scheduled backup not found');
    } catch (error) {
      if (error.message === 'Scheduled backup not found') {
        throw error;
      }
      this.logger.error(`Failed to remove scheduled backup: ${error.message}`);
      throw new InternalServerErrorException('Failed to remove scheduled backup');
    }
  }

  /**
   * Calculate the deletion date based on retention period
   */
  private calculateDeleteAfterDate(retention: string): Date {
    const now = new Date();

    switch (retention) {
      case '1_day':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case '3_days':
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      case '1_week':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case '2_weeks':
        return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      case '1_month':
        return new Date(now.setMonth(now.getMonth() + 1));
      case '3_months':
        return new Date(now.setMonth(now.getMonth() + 3));
      case '6_months':
        return new Date(now.setMonth(now.getMonth() + 6));
      case '1_year':
        return new Date(now.setFullYear(now.getFullYear() + 1));
      default:
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Default to 1 week
    }
  }

  /**
   * Check and delete expired backups, and mark stuck in-progress backups as failed
   */
  async cleanupExpiredBackups(): Promise<{
    deletedCount: number;
    deletedBackups: string[];
    failedCount: number;
    failedBackups: string[];
  }> {
    const deletedBackups: string[] = [];
    const failedBackups: string[] = [];

    try {
      const allBackups = await this.getBackups();
      const now = new Date();

      // Maximum time a backup can be in progress (30 minutes)
      const MAX_IN_PROGRESS_TIME_MS = 30 * 60 * 1000;

      for (const backup of allBackups) {
        // Check for stuck in_progress backups
        if (backup.status === 'in_progress') {
          const createdAt = new Date(backup.createdAt);
          const timeSinceCreation = now.getTime() - createdAt.getTime();

          if (timeSinceCreation > MAX_IN_PROGRESS_TIME_MS) {
            try {
              // Mark as failed since it's been stuck for too long
              await this.updateBackupStatus(
                backup.id,
                'failed',
                'Backup timed out - stuck in progress for more than 30 minutes',
              );
              failedBackups.push(backup.id);
              this.logger.warn(
                `Marked stuck backup as failed: ${backup.id} (${backup.name}) - was in_progress for ${Math.round(timeSinceCreation / 60000)} minutes`,
              );

              // Emit event so frontend updates
              this.eventEmitter.emit('backup.progress', {
                backupId: backup.id,
                progress: 0,
                completed: false,
                status: 'failed',
                error: 'Timeout - backup took too long',
              });
            } catch (error) {
              this.logger.error(
                `Failed to mark stuck backup ${backup.id} as failed: ${error.message}`,
              );
            }
          }
        }

        // Check if backup has auto-delete enabled and is expired
        if (backup.autoDelete?.enabled && backup.autoDelete?.deleteAfter) {
          const deleteAfterDate = new Date(backup.autoDelete.deleteAfter);

          if (now > deleteAfterDate && backup.status === 'completed') {
            try {
              await this.deleteBackup(backup.id);
              deletedBackups.push(backup.id);
              this.logger.log(`Auto-deleted expired backup: ${backup.id} (${backup.name})`);
            } catch (error) {
              this.logger.error(`Failed to auto-delete backup ${backup.id}: ${error.message}`);
            }
          }
        }
      }

      return {
        deletedCount: deletedBackups.length,
        deletedBackups,
        failedCount: failedBackups.length,
        failedBackups,
      };
    } catch (error) {
      this.logger.error(`Failed during cleanup of expired backups: ${error.message}`);
      return {
        deletedCount: 0,
        deletedBackups: [],
        failedCount: 0,
        failedBackups: [],
      };
    }
  }

  /**
   * Get backup statistics from database
   */
  async getStatistics(): Promise<{
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    deleted: number;
    totalSize: bigint;
  }> {
    return this.backupRepository.getStatistics();
  }

  /**
   * Initialize cleanup cron job on service start
   */
  async onModuleInit() {
    // Schedule cleanup to run every hour
    await this.backupQueue.add(
      'cleanup-expired-backups',
      {},
      {
        repeat: { cron: '0 * * * *' }, // Run every hour
        jobId: 'backup-cleanup-cron',
      },
    );

    this.logger.log('Backup cleanup cron job initialized');

    // Recover scheduled backups from database
    await this.recoverScheduledBackups();
  }

  /**
   * Recover scheduled backups from database on application startup
   * This ensures schedules persist across Redis restarts
   */
  private async recoverScheduledBackups(): Promise<void> {
    try {
      const enabledSchedules = await this.backupScheduleRepository.findAllEnabled();

      if (enabledSchedules.length === 0) {
        this.logger.log('No backup schedules to recover from database');
        return;
      }

      this.logger.log(`Recovering ${enabledSchedules.length} backup schedules from database...`);

      // Get existing Bull repeatable jobs
      const existingJobs = await this.backupQueue.getRepeatableJobs();
      const existingJobIds = new Set(existingJobs.map(j => j.id || j.key));

      let recovered = 0;
      let skipped = 0;

      for (const schedule of enabledSchedules) {
        const jobId = `scheduled-backup-${schedule.name}-${schedule.id}`;

        // Check if job already exists in Bull queue
        if (schedule.bullJobId && existingJobIds.has(schedule.bullJobId)) {
          this.logger.debug(`Schedule ${schedule.name} already exists in Bull queue, skipping`);
          skipped++;
          continue;
        }

        try {
          // Convert database schedule to CreateBackupDto format
          const createBackupDto: CreateBackupDto = {
            name: schedule.name,
            type: this.mapDbTypeToDto(schedule.type),
            description: schedule.description || undefined,
            paths: schedule.paths,
            schedule: {
              enabled: true,
              cron: schedule.cronExpression,
            },
            priority: this.mapDbPriorityToDto(schedule.priority),
            compressionLevel: schedule.compressionLevel,
            encrypted: schedule.encrypted,
            autoDelete: schedule.autoDeleteEnabled
              ? {
                  enabled: true,
                  retention: schedule.autoDeleteRetention as any,
                }
              : undefined,
          };

          // Re-add to Bull queue
          await this.backupQueue.add('scheduled-backup', createBackupDto, {
            jobId,
            repeat: { cron: schedule.cronExpression },
            removeOnComplete: 10,
            removeOnFail: 5,
          });

          // Update database with new Bull job ID
          await this.backupScheduleRepository.updateBullJobId(schedule.id, jobId);

          // Calculate next run time
          const nextRunAt = this.calculateNextRunTime(schedule.cronExpression);
          if (nextRunAt) {
            await this.backupScheduleRepository.update(schedule.id, { nextRunAt });
          }

          recovered++;
          this.logger.log(`Recovered schedule: ${schedule.name} (${schedule.cronExpression})`);
        } catch (error) {
          this.logger.error(`Failed to recover schedule ${schedule.name}: ${error.message}`);
        }
      }

      this.logger.log(`Schedule recovery complete: ${recovered} recovered, ${skipped} skipped`);
    } catch (error) {
      this.logger.error(`Failed to recover scheduled backups: ${error.message}`);
    }
  }

  /**
   * Calculate next run time from cron expression
   * Uses simple estimation based on cron pattern
   */
  private calculateNextRunTime(cronExpression: string): Date | null {
    try {
      // Parse cron parts: minute hour dayOfMonth month dayOfWeek
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length < 5) {
        this.logger.warn(`Invalid cron expression: ${cronExpression}`);
        return null;
      }

      const [minute, hour] = parts;
      const now = new Date();
      const nextRun = new Date(now);

      // Handle hour
      if (hour !== '*') {
        const targetHour = parseInt(hour, 10);
        if (!isNaN(targetHour)) {
          nextRun.setHours(targetHour, 0, 0, 0);
        }
      }

      // Handle minute
      if (minute !== '*') {
        const targetMinute = parseInt(minute, 10);
        if (!isNaN(targetMinute)) {
          nextRun.setMinutes(targetMinute, 0, 0);
        }
      }

      // If the calculated time is in the past, move to next day
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      return nextRun;
    } catch (error) {
      this.logger.warn(`Failed to parse cron expression: ${cronExpression}`);
      return null;
    }
  }

  /**
   * Map database BackupType to DTO type
   */
  private mapDbTypeToDto(dbType: BackupType): 'database' | 'files' | 'system' | 'full' {
    const mapping: Record<BackupType, 'database' | 'files' | 'system' | 'full'> = {
      DATABASE: 'database',
      FILES: 'files',
      SYSTEM: 'system',
      FULL: 'full',
    };
    return mapping[dbType];
  }

  /**
   * Map DTO type to database BackupType
   */
  private mapDtoTypeToDb(dtoType: string): BackupType {
    const mapping: Record<string, BackupType> = {
      database: BackupType.DATABASE,
      files: BackupType.FILES,
      system: BackupType.SYSTEM,
      full: BackupType.FULL,
    };
    return mapping[dtoType] || BackupType.DATABASE;
  }

  /**
   * Map database BackupPriority to DTO priority
   */
  private mapDbPriorityToDto(dbPriority: BackupPriority): 'low' | 'medium' | 'high' | 'critical' {
    const mapping: Record<BackupPriority, 'low' | 'medium' | 'high' | 'critical'> = {
      LOW: 'low',
      MEDIUM: 'medium',
      HIGH: 'high',
      CRITICAL: 'critical',
    };
    return mapping[dbPriority];
  }

  /**
   * Map DTO priority to database BackupPriority
   */
  private mapDtoPriorityToDb(dtoPriority?: string): BackupPriority {
    const mapping: Record<string, BackupPriority> = {
      low: BackupPriority.LOW,
      medium: BackupPriority.MEDIUM,
      high: BackupPriority.HIGH,
      critical: BackupPriority.CRITICAL,
    };
    return mapping[dtoPriority || 'medium'] || BackupPriority.MEDIUM;
  }

  // System Health Methods

  async checkDiskSpace(): Promise<{
    available: string;
    used: string;
    total: string;
    usagePercent: number;
    availableBytes: number;
  }> {
    try {
      const { stdout } = await execAsync(`df -h ${this.backupBasePath} | tail -1`);
      const parts = stdout.trim().split(/\s+/);

      // Get available space in bytes for calculations
      const { stdout: bytesOutput } = await execAsync(`df -B1 ${this.backupBasePath} | tail -1`);
      const bytesParts = bytesOutput.trim().split(/\s+/);
      const availableBytes = parseInt(bytesParts[3]);

      return {
        available: parts[3],
        used: parts[2],
        total: parts[1],
        usagePercent: parseInt(parts[4].replace('%', '')),
        availableBytes,
      };
    } catch (error) {
      this.logger.warn(`Failed to check disk space: ${error.message}`);
      return {
        available: 'Unknown',
        used: 'Unknown',
        total: 'Unknown',
        usagePercent: 0,
        availableBytes: 0,
      };
    }
  }

  getPathsByPriority(priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'): string[] {
    switch (priority) {
      case 'critical':
        return [...this.criticalPaths];
      case 'high':
        return [...this.criticalPaths, ...this.highPriorityPaths];
      case 'medium':
        return [...this.criticalPaths, ...this.highPriorityPaths, ...this.mediumPriorityPaths];
      case 'low':
        return [
          ...this.criticalPaths,
          ...this.highPriorityPaths,
          ...this.mediumPriorityPaths,
          ...this.lowPriorityPaths,
        ];
      default:
        return [...this.highPriorityPaths];
    }
  }

  async validateAndFilterPaths(
    paths: string[],
  ): Promise<{ validPaths: string[]; invalidPaths: string[] }> {
    const validPaths: string[] = [];
    const invalidPaths: string[] = [];

    for (const targetPath of paths) {
      try {
        await fs.access(targetPath);
        validPaths.push(targetPath);
      } catch (error) {
        this.logger.warn(`Path not accessible: ${targetPath}`);
        invalidPaths.push(targetPath);
      }
    }

    return { validPaths, invalidPaths };
  }

  async getSystemHealthSummary(): Promise<{
    diskSpace: {
      available: string;
      used: string;
      total: string;
      usagePercent: number;
      availableBytes: number;
    };
    backupStats: {
      total: number;
      completed: number;
      failed: number;
      inProgress: number;
      totalSize: number;
    };
    recommendations: string[];
  }> {
    const diskSpace = await this.checkDiskSpace();
    const backups = await this.getBackups();

    const backupStats = {
      total: backups.length,
      completed: backups.filter(b => b.status === 'completed').length,
      failed: backups.filter(b => b.status === 'failed').length,
      inProgress: backups.filter(b => b.status === 'in_progress').length,
      totalSize: backups
        .filter(b => b.status === 'completed')
        .reduce((sum, b) => sum + (b.size || 0), 0),
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (diskSpace.usagePercent > 80) {
      recommendations.push(
        'WARNING: Backup storage is over 80% full - consider cleanup or expansion',
      );
    }

    if (backupStats.failed > backupStats.completed * 0.1) {
      recommendations.push('WARNING: High backup failure rate - check system resources and logs');
    }

    if (backupStats.completed === 0) {
      recommendations.push('INFO: No completed backups found - consider running a test backup');
    }

    const lastBackup =
      backups.length > 0
        ? backups.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0]
        : null;

    if (lastBackup) {
      const daysSinceLastBackup =
        (Date.now() - new Date(lastBackup.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastBackup > 7) {
        recommendations.push(
          'WARNING: Last backup is over 7 days old - consider scheduling regular backups',
        );
      }
    }

    return {
      diskSpace,
      backupStats,
      recommendations,
    };
  }
}
