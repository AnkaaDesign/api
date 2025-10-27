import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { BackupService, CreateBackupDto } from './backup.service';
import * as fs from 'fs/promises';
import * as path from 'path';

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
              // If no paths specified for files backup, backup entire WebDAV directory
              this.logger.log('No paths specified, performing full WebDAV backup');
              backupPath = await this.backupService.performWebDAVBackup(backupId);
            } else {
              // Backup specific WebDAV directories
              backupPath = await this.backupService.performWebDAVBackup(backupId, paths);
            }
            break;
          case 'system':
            // Backup system configuration files
            backupPath = await this.backupService.performSystemBackup(backupId, paths);
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
      if (!metadata) {
        this.logger.error(`CRITICAL: Metadata not found for backup ${backupId} after completion!`);
        throw new Error(`Metadata not found for backup ${backupId}`);
      }

      metadata.status = 'completed';
      metadata.size = stats.size;
      metadata.priority = priority;
      metadata.raidAware = raidAware;
      metadata.compressionLevel = compressionLevel;
      metadata.encrypted = encrypted;
      await this.backupService.saveBackupMetadata(metadata);

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
        // ========== DATABASE RESTORE ==========
        this.logger.log(`Restoring DATABASE backup: ${backupId}`);

        // Find the .sql.gz and .sql files
        const sqlGzFile = path.join(targetPath, `${backupId}.sql.gz`);
        const sqlFile = path.join(targetPath, `${backupId}.sql`);

        // Clean up any existing files from previous restore attempts
        await fs.unlink(sqlGzFile).catch(() => {});
        await fs.unlink(sqlFile).catch(() => {});

        // Extract the tar (note: it's named .tar.gz but is actually just .tar)
        const extractCommand = `tar -xf "${backupPath}" -C "${targetPath}"`;
        await execAsync(extractCommand);

        // Decompress the SQL file
        await execAsync(`gunzip "${sqlGzFile}"`);

        // Get database credentials from environment
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) {
          throw new Error('DATABASE_URL not configured');
        }

        // Parse DATABASE_URL to get connection details
        // Handle format: postgresql://user:pass@host:port/dbname or postgres://user:pass@host:port/dbname?schema=public
        const urlPattern = /postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/;
        const match = dbUrl.match(urlPattern);
        if (!match) {
          this.logger.error(`Failed to parse DATABASE_URL: ${dbUrl}`);
          throw new Error('Invalid DATABASE_URL format');
        }

        const [, username, password, host, port, dbName] = match;

        this.logger.warn(`⚠️  RESTORING DATABASE FROM BACKUP! This will overwrite all current data.`);

        const env = { PGPASSWORD: password };

        // Step 1: Terminate all connections to the database
        this.logger.log(`Terminating all connections to database: ${dbName}`);
        const terminateCmd = `psql -h ${host} -p ${port} -U ${username} -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid();"`;
        await execAsync(terminateCmd, { env }).catch((err) => {
          this.logger.warn(`Some connections could not be terminated: ${err.message}`);
        });

        // Step 2: Drop the database
        this.logger.log(`Dropping database: ${dbName}`);
        const dropCmd = `psql -h ${host} -p ${port} -U ${username} -d postgres -c "DROP DATABASE IF EXISTS \\"${dbName}\\";"`;
        await execAsync(dropCmd, { env });

        // Step 3: Recreate the database
        this.logger.log(`Creating database: ${dbName}`);
        const createCmd = `psql -h ${host} -p ${port} -U ${username} -d postgres -c "CREATE DATABASE \\"${dbName}\\" OWNER \\"${username}\\";"`;
        await execAsync(createCmd, { env });

        // Step 4: Restore the SQL dump
        this.logger.log(`Restoring SQL dump to database: ${dbName}`);
        const restoreCommand = `psql -h ${host} -p ${port} -U ${username} -d ${dbName} -f "${sqlFile}" --set ON_ERROR_STOP=on`;
        const result = await execAsync(restoreCommand, { env });

        if (result.stderr && result.stderr.includes('ERROR')) {
          this.logger.error(`Restore completed with errors: ${result.stderr}`);
          throw new Error(`Restore failed with errors: ${result.stderr}`);
        }

        // Clean up temporary files
        await fs.unlink(sqlFile);

        this.logger.log(`✅ Database restored successfully from backup: ${backupId}`);

      } else if (metadata.type === 'files') {
        // ========== WEBDAV FILES RESTORE ==========
        this.logger.log(`Restoring WEBDAV FILES backup: ${backupId}`);
        this.logger.warn(`⚠️  RESTORING WEBDAV FILES! This will overwrite existing files in /srv/webdav`);

        // WebDAV files should be restored to /srv/webdav (their original location)
        const webdavRoot = '/srv/webdav';

        // Ensure WebDAV directory exists
        await fs.mkdir(webdavRoot, { recursive: true });

        // Extract backup to WebDAV root (files are stored with relative paths)
        // Use sudo to preserve proper ownership and avoid permission errors
        const extractCommand = `sudo tar -xzf "${backupPath}" -C "${webdavRoot}"`;
        await execAsync(extractCommand);

        // Set proper WebDAV permissions
        try {
          await execAsync(`sudo chown -R www-data:www-data "${webdavRoot}"`);
          await execAsync(`sudo chmod -R 2775 "${webdavRoot}"`);
        } catch (permError) {
          this.logger.warn(`Could not set WebDAV permissions: ${permError.message}`);
        }

        this.logger.log(`✅ WebDAV files restored successfully to ${webdavRoot}`);

      } else if (metadata.type === 'system') {
        // ========== SYSTEM CONFIG RESTORE ==========
        this.logger.log(`Restoring SYSTEM CONFIGURATION backup: ${backupId}`);
        this.logger.warn(`⚠️  RESTORING SYSTEM CONFIGS! This will overwrite existing configuration files`);

        // System files are stored with absolute paths and must be extracted to root (/)
        // Using --absolute-names to preserve the absolute paths
        const extractCommand = `tar --absolute-names -xzf "${backupPath}" -C /`;
        await execAsync(extractCommand);

        this.logger.log(`✅ System configuration files restored successfully`);
        this.logger.warn(`⚠️  You may need to restart services (nginx, samba, etc.) for changes to take effect`);

      } else if (metadata.type === 'full') {
        // ========== FULL BACKUP RESTORE ==========
        this.logger.log(`Restoring FULL backup: ${backupId}`);
        this.logger.warn(`⚠️  RESTORING FULL BACKUP! This will restore both database and files`);

        // Full backups contain both database and files components
        // Extract the full backup to a temporary location first
        const tempExtractPath = path.join(targetPath, 'full_backup_extract');
        await fs.mkdir(tempExtractPath, { recursive: true });

        const extractCommand = `tar -xzf "${backupPath}" -C "${tempExtractPath}"`;
        await execAsync(extractCommand);

        // List contents to find database and files components
        const contents = await fs.readdir(tempExtractPath);
        this.logger.log(`Full backup contents: ${contents.join(', ')}`);

        // Find and restore database component (ends with _db.tar.gz)
        const dbBackup = contents.find(f => f.includes('_db.tar.gz'));
        if (dbBackup) {
          this.logger.log(`Found database component: ${dbBackup}`);
          // Recursively call restore for database component
          const dbBackupPath = path.join(tempExtractPath, dbBackup);
          await this.handleRestoreBackup({
            data: {
              backupId: `${backupId}_db`,
              backupPath: dbBackupPath,
              targetPath,
              metadata: { ...metadata, type: 'database' },
            },
          } as any);
        }

        // Find and restore files component (ends with _files.tar.gz)
        const filesBackup = contents.find(f => f.includes('_files.tar.gz'));
        if (filesBackup) {
          this.logger.log(`Found files component: ${filesBackup}`);
          // Recursively call restore for files component
          const filesBackupPath = path.join(tempExtractPath, filesBackup);
          await this.handleRestoreBackup({
            data: {
              backupId: `${backupId}_files`,
              backupPath: filesBackupPath,
              targetPath,
              metadata: { ...metadata, type: 'files' },
            },
          } as any);
        }

        // Clean up temporary extraction directory
        await fs.rm(tempExtractPath, { recursive: true, force: true });

        this.logger.log(`✅ Full backup restored successfully`);

      } else {
        // Unknown backup type
        throw new Error(`Unknown backup type: ${metadata.type}`);
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
