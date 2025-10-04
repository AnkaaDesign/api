import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';

const execAsync = promisify(exec);

export interface BackupMetadata {
  id: string;
  name: string;
  type: 'database' | 'files' | 'full';
  size: number;
  createdAt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
  paths?: string[];
  error?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  raidAware?: boolean;
  compressionLevel?: number;
  encrypted?: boolean;
}

export interface CreateBackupDto {
  name: string;
  type: 'database' | 'files' | 'full';
  description?: string;
  paths?: string[];
  schedule?: {
    enabled: boolean;
    cron: string;
  };
  priority?: 'low' | 'medium' | 'high' | 'critical';
  raidAware?: boolean;
  compressionLevel?: number;
  encrypted?: boolean;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupBasePath = '/home/kennedy/ankaa/backups';

  // RAID-aware and priority-based backup paths
  private readonly criticalPaths = [
    '/home/kennedy/ankaa',
    '/home/kennedy/ankaa/.env',
    '/home/kennedy/ankaa/apps/api/.env',
  ];

  private readonly highPriorityPaths = [
    '/home/kennedy/ankaa/apps',
    '/home/kennedy/ankaa/packages',
    '/home/kennedy/ankaa/scripts',
    '/etc/nginx',
    '/etc/ssl',
  ];

  private readonly mediumPriorityPaths = [
    '/home/kennedy/ankaa/docs',
    '/home/kennedy/ankaa/test-examples',
    '/var/log/nginx',
    '/var/www',
  ];

  private readonly lowPriorityPaths = [
    '/home/kennedy/ankaa/node_modules',
    '/home/kennedy/ankaa/.git',
    '/tmp',
  ];

  constructor(
    @InjectQueue('backup-queue') private backupQueue: Queue,
    private configService: ConfigService,
  ) {
    this.ensureBackupDirectories();
  }

  private async ensureBackupDirectories(): Promise<void> {
    try {
      const directories = ['database', 'files', 'metadata'];
      for (const dir of directories) {
        const dirPath = path.join(this.backupBasePath, dir);
        await fs.mkdir(dirPath, { recursive: true });
      }
    } catch (error) {
      this.logger.error(`Failed to create backup directories: ${error.message}`);
    }
  }

  async createBackup(createBackupDto: CreateBackupDto): Promise<{ id: string; message: string }> {
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      // Create initial metadata
      const metadata: BackupMetadata = {
        id: backupId,
        name: createBackupDto.name,
        type: createBackupDto.type,
        size: 0,
        createdAt: new Date().toISOString(),
        status: 'pending',
        description: createBackupDto.description,
        paths: createBackupDto.paths,
      };

      await this.saveBackupMetadata(metadata);

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

  async getBackups(): Promise<BackupMetadata[]> {
    try {
      const metadataPath = path.join(this.backupBasePath, 'metadata');
      const files = await fs.readdir(metadataPath);

      const backups: BackupMetadata[] = [];

      for (const file of files) {
        if (file.endsWith('.json') && !file.includes('latest.json')) {
          try {
            const filePath = path.join(metadataPath, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const metadata = JSON.parse(content);

            // Validate that this is a proper BackupMetadata object
            if (this.isValidBackupMetadata(metadata)) {
              backups.push(metadata);
            } else {
              this.logger.warn(`Skipping invalid backup metadata file: ${file}`);
            }
          } catch (error) {
            this.logger.warn(`Failed to read backup metadata file: ${file}`);
          }
        }
      }

      // Sort by creation date (newest first)
      return backups.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } catch (error) {
      this.logger.error(`Failed to get backups: ${error.message}`);
      throw new InternalServerErrorException('Failed to retrieve backups');
    }
  }

  async getBackupById(backupId: string): Promise<BackupMetadata | null> {
    try {
      const metadataPath = path.join(this.backupBasePath, 'metadata', `${backupId}.json`);
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      this.logger.error(`Failed to get backup metadata: ${error.message}`);
      throw new InternalServerErrorException('Failed to get backup metadata');
    }
  }

  async deleteBackup(backupId: string): Promise<void> {
    try {
      const metadata = await this.getBackupById(backupId);
      if (!metadata) {
        throw new Error('Backup not found');
      }

      // Delete backup files
      const backupFileName = `${backupId}.tar.gz`;
      const backupPath = path.join(this.backupBasePath, metadata.type, backupFileName);

      try {
        await fs.unlink(backupPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn(`Failed to delete backup file: ${backupPath}`);
        }
      }

      // Delete metadata
      const metadataPath = path.join(this.backupBasePath, 'metadata', `${backupId}.json`);
      await fs.unlink(metadataPath);

      this.logger.log(`Backup deleted: ${backupId}`);
    } catch (error) {
      this.logger.error(`Failed to delete backup: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete backup');
    }
  }

  async restoreBackup(backupId: string, targetPath?: string): Promise<{ message: string }> {
    try {
      const metadata = await this.getBackupById(backupId);
      if (!metadata || metadata.status !== 'completed') {
        throw new Error('Backup not found or not completed');
      }

      const backupFileName = `${backupId}.tar.gz`;
      const backupPath = path.join(this.backupBasePath, metadata.type, backupFileName);

      // Check if backup file exists
      try {
        await fs.access(backupPath);
      } catch (error) {
        throw new Error('Backup file not found');
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

  async performDatabaseBackup(backupId: string): Promise<string> {
    try {
      const dbUrl = this.configService.get<string>('DATABASE_URL');
      if (!dbUrl) {
        throw new Error('DATABASE_URL not configured');
      }

      const backupFileName = `${backupId}.tar.gz`;
      const tempSqlFile = `/tmp/${backupId}.sql`;
      const finalBackupPath = path.join(this.backupBasePath, 'database', backupFileName);

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

      // Compress the SQL dump
      const compressCommand = `tar -czf ${finalBackupPath} -C /tmp ${backupId}.sql`;
      await execAsync(compressCommand);

      // Clean up temporary file
      await fs.unlink(tempSqlFile);

      this.logger.log(`Database backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Database backup failed: ${error.message}`);
      throw error;
    }
  }

  async performFilesBackup(backupId: string, paths: string[]): Promise<string> {
    try {
      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(this.backupBasePath, 'files', backupFileName);

      // Validate paths exist and are accessible
      const validPaths: string[] = [];
      for (const targetPath of paths) {
        try {
          await fs.access(targetPath);
          validPaths.push(targetPath);
        } catch (error) {
          this.logger.warn(`Path not accessible, skipping: ${targetPath}`);
        }
      }

      if (validPaths.length === 0) {
        throw new Error('No valid paths found for backup');
      }

      // Create tar archive
      const pathsStr = validPaths.join(' ');
      const tarCommand = `tar -czf ${finalBackupPath} ${pathsStr}`;
      await execAsync(tarCommand);

      this.logger.log(`Files backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Files backup failed: ${error.message}`);
      throw error;
    }
  }

  async performFullBackup(backupId: string): Promise<string> {
    try {
      // Create database backup
      const dbBackupPath = await this.performDatabaseBackup(`${backupId}_db`);

      // Create files backup for important directories
      const importantPaths = ['/home/kennedy/ankaa', '/var/www', '/etc/nginx'];
      const filesBackupPath = await this.performFilesBackup(`${backupId}_files`, importantPaths);

      // Combine both backups
      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(this.backupBasePath, 'files', backupFileName);

      const combineCommand = `tar -czf ${finalBackupPath} -C ${path.dirname(dbBackupPath)} ${path.basename(dbBackupPath)} -C ${path.dirname(filesBackupPath)} ${path.basename(filesBackupPath)}`;
      await execAsync(combineCommand);

      // Clean up individual backup files
      await fs.unlink(dbBackupPath);
      await fs.unlink(filesBackupPath);

      this.logger.log(`Full backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Full backup failed: ${error.message}`);
      throw error;
    }
  }

  async saveBackupMetadata(metadata: BackupMetadata): Promise<void> {
    try {
      const metadataPath = path.join(this.backupBasePath, 'metadata', `${metadata.id}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      this.logger.error(`Failed to save backup metadata: ${error.message}`);
      throw error;
    }
  }

  private isValidBackupMetadata(metadata: any): metadata is BackupMetadata {
    return (
      metadata &&
      typeof metadata.id === 'string' &&
      typeof metadata.name === 'string' &&
      typeof metadata.createdAt === 'string' &&
      ['database', 'files', 'full'].includes(metadata.type) &&
      ['pending', 'in_progress', 'completed', 'failed'].includes(metadata.status) &&
      typeof metadata.size === 'number'
    );
  }

  async updateBackupStatus(
    backupId: string,
    status: BackupMetadata['status'],
    error?: string,
  ): Promise<void> {
    try {
      const metadata = await this.getBackupById(backupId);
      if (metadata) {
        metadata.status = status;
        if (error) {
          metadata.error = error;
        }
        await this.saveBackupMetadata(metadata);
      }
    } catch (err) {
      this.logger.error(`Failed to update backup status: ${err.message}`);
    }
  }

  async scheduleBackup(createBackupDto: CreateBackupDto): Promise<{ message: string }> {
    try {
      if (!createBackupDto.schedule?.enabled || !createBackupDto.schedule.cron) {
        throw new Error('Invalid schedule configuration');
      }

      // Generate unique job name with timestamp to avoid conflicts
      const timestamp = Date.now();
      const jobName = `scheduled-backup-${createBackupDto.name}-${timestamp}`;

      // Add a cron job to the queue with unique identifier
      await this.backupQueue.add(jobName, createBackupDto, {
        repeat: { cron: createBackupDto.schedule.cron },
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      this.logger.log(`Backup scheduled: ${jobName} with cron: ${createBackupDto.schedule.cron}`);
      return { message: 'Backup scheduled successfully' };
    } catch (error) {
      this.logger.error(`Failed to schedule backup: ${error.message}`);
      throw new InternalServerErrorException('Failed to schedule backup');
    }
  }

  async getScheduledBackups(): Promise<any[]> {
    try {
      const repeatableJobs = await this.backupQueue.getRepeatableJobs();
      return repeatableJobs.map(job => {
        // Extract the original name from job name pattern: scheduled-backup-{name}-{timestamp}
        let extractedName = job.name;
        if (job.name.startsWith('scheduled-backup-')) {
          const namePart = job.name.replace('scheduled-backup-', '');
          // Remove timestamp suffix if present (last part after final dash)
          const dashIndex = namePart.lastIndexOf('-');
          if (dashIndex > 0 && /^\d+$/.test(namePart.substring(dashIndex + 1))) {
            extractedName = namePart.substring(0, dashIndex);
          } else {
            extractedName = namePart;
          }
        }

        return {
          id: job.id || job.key, // Use key as fallback if id is not available
          name: extractedName,
          cron: job.cron,
          next: job.next,
          jobName: job.name, // Keep full job name for internal use
          key: job.key, // Keep job key for deletion
        };
      });
    } catch (error) {
      this.logger.error(`Failed to get scheduled backups: ${error.message}`);
      throw new InternalServerErrorException('Failed to get scheduled backups');
    }
  }

  async removeScheduledBackup(jobId: string): Promise<void> {
    try {
      const repeatableJobs = await this.backupQueue.getRepeatableJobs();

      // Find job by id, key, or job name
      const job = repeatableJobs.find(j => j.id === jobId || j.key === jobId || j.name === jobId);

      if (job) {
        await this.backupQueue.removeRepeatableByKey(job.key);
        this.logger.log(`Scheduled backup removed: ${job.name} (key: ${job.key})`);
      } else {
        this.logger.warn(`Scheduled backup not found with identifier: ${jobId}`);
        throw new Error('Scheduled backup not found');
      }
    } catch (error) {
      this.logger.error(`Failed to remove scheduled backup: ${error.message}`);
      throw new InternalServerErrorException('Failed to remove scheduled backup');
    }
  }

  // RAID and System Health Methods

  async checkRaidStatus(): Promise<{ healthy: boolean; details: string; degraded: boolean }> {
    try {
      const { stdout } = await execAsync('cat /proc/mdstat');

      const healthy = stdout.includes('active') && !stdout.includes('[U_]');
      const degraded =
        stdout.includes('[U_]') || stdout.includes('recovery') || stdout.includes('resync');

      const md0Line = stdout.split('\n').find(line => line.includes('md0')) || 'No RAID info';

      return {
        healthy,
        degraded,
        details: md0Line,
      };
    } catch (error) {
      this.logger.warn(`Failed to check RAID status: ${error.message}`);
      return {
        healthy: false,
        degraded: true,
        details: 'Unable to read RAID status',
      };
    }
  }

  async checkDiskSpace(): Promise<{
    available: string;
    used: string;
    total: string;
    usagePercent: number;
    availableBytes: number;
  }> {
    try {
      const { stdout } = await execAsync('df -h /home/kennedy/ankaa/backups | tail -1');
      const parts = stdout.trim().split(/\s+/);

      // Get available space in bytes for calculations
      const { stdout: bytesOutput } = await execAsync(
        'df -B1 /home/kennedy/ankaa/backups | tail -1',
      );
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

  async performRaidAwareBackup(
    backupId: string,
    type: 'database' | 'files' | 'full',
    paths?: string[],
    options?: {
      priority?: 'low' | 'medium' | 'high' | 'critical';
      compressionLevel?: number;
      encrypted?: boolean;
    },
  ): Promise<string> {
    const raidStatus = await this.checkRaidStatus();
    const diskSpace = await this.checkDiskSpace();

    this.logger.log(
      `RAID Status: ${raidStatus.healthy ? 'Healthy' : 'Degraded'} - ${raidStatus.details}`,
    );

    // Adjust backup strategy based on RAID status
    if (raidStatus.degraded) {
      this.logger.warn('RAID is degraded - using conservative backup settings');
      options = {
        ...options,
        compressionLevel: Math.min(options?.compressionLevel || 6, 3), // Lower compression for faster backup
      };
    }

    // Check available disk space
    const minimumSpaceGB = type === 'full' ? 5 : type === 'database' ? 1 : 2;
    const minimumSpaceBytes = minimumSpaceGB * 1024 * 1024 * 1024;

    if (diskSpace.availableBytes < minimumSpaceBytes) {
      throw new Error(
        `Insufficient disk space. Available: ${diskSpace.available}, Required: ${minimumSpaceGB}GB`,
      );
    }

    // Perform backup based on type
    switch (type) {
      case 'database':
        return await this.performEnhancedDatabaseBackup(backupId, options);
      case 'files':
        const targetPaths = paths || this.getPathsByPriority(options?.priority);
        return await this.performEnhancedFilesBackup(backupId, targetPaths, options);
      case 'full':
        return await this.performEnhancedFullBackup(backupId, options);
      default:
        throw new Error(`Unknown backup type: ${type}`);
    }
  }

  private async performEnhancedDatabaseBackup(
    backupId: string,
    options?: {
      compressionLevel?: number;
      encrypted?: boolean;
    },
  ): Promise<string> {
    try {
      const dbUrl = this.configService.get<string>('DATABASE_URL');
      if (!dbUrl) {
        throw new Error('DATABASE_URL not configured');
      }

      const backupFileName = `${backupId}.tar.gz`;
      const tempSqlFile = `/tmp/${backupId}.sql`;
      const finalBackupPath = path.join(this.backupBasePath, 'database', backupFileName);

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

      this.logger.log(`Starting database backup for ${dbName} on ${host}:${port}`);

      // Create PostgreSQL dump with additional options
      const dumpOptions = [
        '--verbose',
        '--no-password',
        '--format=custom',
        '--compress=9',
        '--no-privileges',
        '--no-owner',
      ];

      const dumpCommand = `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} ${dumpOptions.join(' ')} -f ${tempSqlFile}`;
      await execAsync(dumpCommand, { env });

      // Compress with specified compression level
      const compressionLevel = options?.compressionLevel || 6;
      let compressCommand = `tar -czf ${finalBackupPath} -C /tmp ${backupId}.sql`;

      if (compressionLevel !== 6) {
        // Use gzip with specific compression level
        compressCommand = `gzip -${compressionLevel} -c ${tempSqlFile} > ${tempSqlFile}.gz && tar -cf ${finalBackupPath} -C /tmp ${backupId}.sql.gz`;
      }

      await execAsync(compressCommand);

      // Encrypt if requested
      if (options?.encrypted) {
        const encryptedPath = `${finalBackupPath}.gpg`;
        const encryptCommand = `gpg --cipher-algo AES256 --compress-algo 1 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65536 --symmetric --output ${encryptedPath} ${finalBackupPath}`;
        await execAsync(encryptCommand);
        await fs.unlink(finalBackupPath); // Remove unencrypted version
        await fs.rename(encryptedPath, finalBackupPath);
      }

      // Clean up temporary files
      await fs.unlink(tempSqlFile).catch(() => {});
      await fs.unlink(`${tempSqlFile}.gz`).catch(() => {});

      this.logger.log(`Enhanced database backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Enhanced database backup failed: ${error.message}`);
      throw error;
    }
  }

  private async performEnhancedFilesBackup(
    backupId: string,
    paths: string[],
    options?: {
      compressionLevel?: number;
      encrypted?: boolean;
    },
  ): Promise<string> {
    try {
      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(this.backupBasePath, 'files', backupFileName);

      // Validate and filter paths
      const { validPaths, invalidPaths } = await this.validateAndFilterPaths(paths);

      if (invalidPaths.length > 0) {
        this.logger.warn(`Skipping invalid paths: ${invalidPaths.join(', ')}`);
      }

      if (validPaths.length === 0) {
        throw new Error('No valid paths found for backup');
      }

      this.logger.log(`Starting files backup for ${validPaths.length} paths`);

      // Create exclude list for common unnecessary files
      const excludePatterns = [
        '--exclude=node_modules',
        '--exclude=.git',
        '--exclude=*.log',
        '--exclude=*.tmp',
        '--exclude=.cache',
        '--exclude=dist',
        '--exclude=build',
      ];

      // Create tar archive with compression and exclude patterns
      const compressionLevel = options?.compressionLevel || 6;
      const pathsStr = validPaths.map(p => `"${p}"`).join(' ');

      let tarCommand = `tar ${excludePatterns.join(' ')} --use-compress-program="gzip -${compressionLevel}" -cf ${finalBackupPath} ${pathsStr}`;

      await execAsync(tarCommand);

      // Encrypt if requested
      if (options?.encrypted) {
        const encryptedPath = `${finalBackupPath}.gpg`;
        const encryptCommand = `gpg --cipher-algo AES256 --compress-algo 1 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65536 --symmetric --output ${encryptedPath} ${finalBackupPath}`;
        await execAsync(encryptCommand);
        await fs.unlink(finalBackupPath); // Remove unencrypted version
        await fs.rename(encryptedPath, finalBackupPath);
      }

      this.logger.log(`Enhanced files backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Enhanced files backup failed: ${error.message}`);
      throw error;
    }
  }

  private async performEnhancedFullBackup(
    backupId: string,
    options?: {
      compressionLevel?: number;
      encrypted?: boolean;
    },
  ): Promise<string> {
    try {
      this.logger.log(`Starting enhanced full backup: ${backupId}`);

      // Create database backup
      const dbBackupPath = await this.performEnhancedDatabaseBackup(`${backupId}_db`, options);

      // Create files backup for critical and high priority paths
      const importantPaths = this.getPathsByPriority('high');
      const filesBackupPath = await this.performEnhancedFilesBackup(
        `${backupId}_files`,
        importantPaths,
        options,
      );

      // Combine both backups
      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(this.backupBasePath, 'files', backupFileName);

      const combineCommand = `tar -czf ${finalBackupPath} -C ${path.dirname(dbBackupPath)} ${path.basename(dbBackupPath)} -C ${path.dirname(filesBackupPath)} ${path.basename(filesBackupPath)}`;
      await execAsync(combineCommand);

      // Clean up individual backup files
      await fs.unlink(dbBackupPath);
      await fs.unlink(filesBackupPath);

      this.logger.log(`Enhanced full backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Enhanced full backup failed: ${error.message}`);
      throw error;
    }
  }

  async getSystemHealthSummary(): Promise<{
    raidStatus: { healthy: boolean; details: string; degraded: boolean };
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
    const raidStatus = await this.checkRaidStatus();
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

    if (!raidStatus.healthy) {
      recommendations.push(
        'URGENT: RAID array is degraded - consider immediate hardware attention',
      );
    }

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
      raidStatus,
      diskSpace,
      backupStats,
      recommendations,
    };
  }
}
