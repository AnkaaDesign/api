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
  type: 'database' | 'files' | 'system' | 'full';
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
  type: 'database' | 'files' | 'system' | 'full';
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
  private readonly webdavRoot = '/srv/webdav';
  private readonly backupBasePath = process.env.BACKUP_PATH || `${this.webdavRoot}/Backup`;
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';
  private readonly productionBasePath = '/home/kennedy/ankaa';

  // RAID-aware and priority-based backup paths (production only)
  private readonly criticalPaths = this.isDevelopment ? [] : [
    `${this.productionBasePath}`,
    `${this.productionBasePath}/.env`,
    `${this.productionBasePath}/apps/api/.env`,
  ];

  private readonly highPriorityPaths = this.isDevelopment ? [] : [
    `${this.productionBasePath}/apps`,
    `${this.productionBasePath}/packages`,
    `${this.productionBasePath}/scripts`,
    '/etc/nginx',
    '/etc/ssl',
  ];

  private readonly mediumPriorityPaths = this.isDevelopment ? [] : [
    `${this.productionBasePath}/docs`,
    `${this.productionBasePath}/test-examples`,
    '/var/log/nginx',
    '/var/www',
  ];

  private readonly lowPriorityPaths = this.isDevelopment ? [] : [
    `${this.productionBasePath}/node_modules`,
    `${this.productionBasePath}/.git`,
    '/tmp',
  ];

  constructor(
    @InjectQueue('backup-queue') private backupQueue: Queue,
    private configService: ConfigService,
  ) {
    this.ensureBackupDirectories();
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
   * Example: /srv/webdav/Backup/database/2025/10/25/
   */
  private getBackupDirectoryPath(type: 'database' | 'files' | 'system' | 'full' | 'arquivos' | 'sistema'): string {
    let typeFolder: string = type;
    if (type === 'files') typeFolder = 'arquivos';
    if (type === 'system') typeFolder = 'sistema';
    const datePath = this.getDateBasedPath();
    return path.join(this.backupBasePath, typeFolder, datePath);
  }

  private async ensureBackupDirectories(): Promise<void> {
    try {
      // Create base directories
      const baseDirectories = ['database', 'arquivos', 'sistema'];
      for (const dir of baseDirectories) {
        const dirPath = path.join(this.backupBasePath, dir);
        await fs.mkdir(dirPath, { recursive: true });
        // Set proper permissions for WebDAV (www-data:www-data, 2775) - production only
        if (!this.isDevelopment) {
          try {
            await execAsync(`sudo chown www-data:www-data "${dirPath}"`);
            await execAsync(`sudo chmod 2775 "${dirPath}"`);
          } catch (permError) {
            this.logger.warn(`Could not set permissions on ${dirPath}: ${permError.message}`);
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
   * Creates structure: /database/2025/10/25/backup_XXX/
   */
  private async ensureDateBasedDirectory(type: 'database' | 'files' | 'system' | 'full' | 'arquivos' | 'sistema', backupId: string): Promise<string> {
    const dateBasedPath = this.getBackupDirectoryPath(type);
    const backupFolderPath = path.join(dateBasedPath, backupId);

    try {
      await fs.mkdir(backupFolderPath, { recursive: true });
      // Set proper WebDAV permissions - production only
      if (!this.isDevelopment) {
        try {
          await execAsync(`sudo chown -R www-data:www-data "${backupFolderPath}"`);
          await execAsync(`sudo chmod -R 2775 "${backupFolderPath}"`);
        } catch (permError) {
          this.logger.warn(`Could not set permissions on ${backupFolderPath}: ${permError.message}`);
        }
      }
      return backupFolderPath;
    } catch (error) {
      this.logger.error(`Failed to create backup directory ${backupFolderPath}: ${error.message}`);
      throw error;
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
        priority: createBackupDto.priority,
        raidAware: createBackupDto.raidAware,
        compressionLevel: createBackupDto.compressionLevel,
        encrypted: createBackupDto.encrypted,
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

  /**
   * Recursively search for all metadata JSON files in date-based directories
   */
  private async findAllMetadataFiles(basePath: string): Promise<string[]> {
    const metadataFiles: string[] = [];

    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(basePath, entry.name);

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findAllMetadataFiles(fullPath);
          metadataFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('latest.json')) {
          metadataFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Directory might not exist yet, just return empty array
      if (error.code !== 'ENOENT') {
        this.logger.warn(`Error reading directory ${basePath}: ${error.message}`);
      }
    }

    return metadataFiles;
  }

  async getBackups(): Promise<BackupMetadata[]> {
    try {
      const backups: BackupMetadata[] = [];

      // Search in database, arquivos, and sistema directories
      const databasePath = path.join(this.backupBasePath, 'database');
      const arquivosPath = path.join(this.backupBasePath, 'arquivos');
      const sistemaPath = path.join(this.backupBasePath, 'sistema');

      const databaseFiles = await this.findAllMetadataFiles(databasePath);
      const arquivosFiles = await this.findAllMetadataFiles(arquivosPath);
      const sistemaFiles = await this.findAllMetadataFiles(sistemaPath);

      const allFiles = [...databaseFiles, ...arquivosFiles, ...sistemaFiles];

      for (const filePath of allFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const metadata = JSON.parse(content);

          // Validate that this is a proper BackupMetadata object
          if (this.isValidBackupMetadata(metadata)) {
            backups.push(metadata);
          } else {
            this.logger.warn(`Skipping invalid backup metadata file: ${filePath}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to read backup metadata file: ${filePath}`);
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
      // Search for metadata in all date-based directories
      const databasePath = path.join(this.backupBasePath, 'database');
      const arquivosPath = path.join(this.backupBasePath, 'arquivos');
      const sistemaPath = path.join(this.backupBasePath, 'sistema');

      const allMetadataFiles = await Promise.all([
        this.findAllMetadataFiles(databasePath),
        this.findAllMetadataFiles(arquivosPath),
        this.findAllMetadataFiles(sistemaPath),
      ]);

      const flattenedFiles = allMetadataFiles.flat();

      // Find the metadata file with matching backupId
      for (const filePath of flattenedFiles) {
        if (filePath.endsWith(`${backupId}.json`)) {
          const content = await fs.readFile(filePath, 'utf-8');
          return JSON.parse(content);
        }
      }

      // Metadata not found
      return null;
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

      // Try new folder structure first
      let typeFolder: string = metadata.type;
      if (metadata.type === 'files') typeFolder = 'arquivos';
      if (metadata.type === 'system') typeFolder = 'sistema';

      let deleted = false;

      // Search for backup directory in all date-based paths
      // The backup could be in any date folder, not just today's
      const basePath = path.join(this.backupBasePath, typeFolder);

      // Recursively search for the backup directory
      const findBackupDir = async (searchPath: string): Promise<string | null> => {
        try {
          const entries = await fs.readdir(searchPath, { withFileTypes: true });

          for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const fullPath = path.join(searchPath, entry.name);

            // If this directory is the backup ID, we found it
            if (entry.name === backupId) {
              return fullPath;
            }

            // Otherwise, search recursively (for date folders like 2025/10/25)
            const found = await findBackupDir(fullPath);
            if (found) return found;
          }
        } catch (error) {
          // Directory not accessible, skip
        }

        return null;
      };

      const backupDir = await findBackupDir(basePath);

      // Try deleting from new structure (folder per backup)
      if (backupDir) {
        try {
          await fs.rm(backupDir, { recursive: true, force: true });
          this.logger.log(`Backup deleted (new structure): ${backupId} at ${backupDir}`);
          deleted = true;
        } catch (error) {
          this.logger.warn(`Failed to delete backup directory: ${backupDir} - ${error.message}`);
        }
      } else {
        this.logger.warn(`New structure not found for ${backupId}, trying old flat structure...`);
      }

      // If not deleted yet, try old flat structure
      if (!deleted) {
        const backupFileName = `${backupId}.tar.gz`;
        const oldBackupPath = path.join(this.backupBasePath, metadata.type, backupFileName);
        const oldMetadataPath = path.join(this.backupBasePath, 'metadata', `${backupId}.json`);

        let backupFileDeleted = false;
        let metadataFileDeleted = false;

        try {
          await fs.unlink(oldBackupPath);
          this.logger.log(`Deleted old backup file: ${oldBackupPath}`);
          backupFileDeleted = true;
        } catch (error) {
          if (error.code !== 'ENOENT') {
            this.logger.warn(`Failed to delete old backup file: ${oldBackupPath}`);
            throw error;
          }
        }

        try {
          await fs.unlink(oldMetadataPath);
          this.logger.log(`Deleted old metadata file: ${oldMetadataPath}`);
          metadataFileDeleted = true;
        } catch (error) {
          if (error.code !== 'ENOENT') {
            this.logger.warn(`Failed to delete old metadata file: ${oldMetadataPath}`);
            throw error;
          }
        }

        if (backupFileDeleted || metadataFileDeleted) {
          this.logger.log(`Backup deleted (old structure): ${backupId}`);
          deleted = true;
        }
      }

      // If nothing was deleted, throw an error
      if (!deleted) {
        throw new Error(`Backup files not found for ${backupId}`);
      }
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
      let backupPath: string;

      // Try new folder structure first
      let typeFolder: string = metadata.type;
      if (metadata.type === 'files') typeFolder = 'arquivos';
      if (metadata.type === 'system') typeFolder = 'sistema';
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
          this.logger.error(`Backup file not found in new path: ${newBackupPath} or old path: ${oldBackupPath}`);
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
      // Ensure date-based directory exists with backup ID subfolder (files type becomes 'arquivos')
      const backupDir = await this.ensureDateBasedDirectory('arquivos', backupId);

      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(backupDir, backupFileName);

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
      const tarCommand = `tar -czf "${finalBackupPath}" ${pathsStr}`;
      await execAsync(tarCommand);

      this.logger.log(`Files backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`Files backup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Backup entire WebDAV directory as "arquivos"
   * Excludes the Backup folder to avoid recursion
   */
  async performWebDAVBackup(backupId: string, paths?: string[]): Promise<string> {
    try {
      // Ensure date-based directory exists with backup ID subfolder
      const backupDir = await this.ensureDateBasedDirectory('arquivos', backupId);

      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(backupDir, backupFileName);

      let tarCommand: string;

      if (paths && paths.length > 0) {
        // Backup specific WebDAV subdirectories
        const validPaths: string[] = [];
        for (const targetPath of paths) {
          const fullPath = path.join(this.webdavRoot, targetPath);
          try {
            await fs.access(fullPath);
            validPaths.push(targetPath); // Use relative path for tar
          } catch (error) {
            this.logger.warn(`Path not accessible, skipping: ${fullPath}`);
          }
        }

        if (validPaths.length === 0) {
          throw new Error('No valid WebDAV paths found for backup');
        }

        const pathsStr = validPaths.join(' ');
        tarCommand = `tar --exclude=Backup -czf "${finalBackupPath}" -C "${this.webdavRoot}" ${pathsStr}`;
        this.logger.log(`Starting WebDAV backup for paths: ${pathsStr}`);
      } else {
        // Backup entire WebDAV directory excluding Backup folder
        tarCommand = `tar --exclude=Backup -czf "${finalBackupPath}" -C "${this.webdavRoot}" .`;
        this.logger.log(`Starting full WebDAV backup: ${this.webdavRoot} -> ${finalBackupPath}`);
      }

      await execAsync(tarCommand);

      this.logger.log(`WebDAV backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`WebDAV backup failed: ${error.message}`);
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
        ...(this.isDevelopment ? [] : [
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
      const tarCommand = `tar -czf "${finalBackupPath}" ${pathsStr}`;

      this.logger.log(`Starting system backup for paths: ${pathsStr}`);
      await execAsync(tarCommand);

      this.logger.log(`System backup completed: ${backupId}`);
      return finalBackupPath;
    } catch (error) {
      this.logger.error(`System backup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all folders in the WebDAV directory (excluding Backup, Lixeira, hidden files, etc.)
   */
  async listWebDAVFolders(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.webdavRoot, { withFileTypes: true });

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

      this.logger.log(`Found ${folders.length} WebDAV folders: ${folders.join(', ')}`);
      return folders;
    } catch (error) {
      this.logger.error(`Failed to list WebDAV folders: ${error.message}`);
      throw error;
    }
  }

  async performFullBackup(backupId: string): Promise<string> {
    try {
      // Create database backup
      const dbBackupPath = await this.performDatabaseBackup(`${backupId}_db`);

      // Create files backup for important directories
      const importantPaths = this.isDevelopment
        ? ['./']
        : [`${this.productionBasePath}`, '/var/www', '/etc/nginx'];
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
      // Determine the type folder (files -> arquivos, system -> sistema)
      let typeFolder: string = metadata.type;
      if (metadata.type === 'files') typeFolder = 'arquivos';
      if (metadata.type === 'system') typeFolder = 'sistema';

      // Get the directory where the backup is stored (date-based + backup ID subfolder)
      const dateBasedDir = this.getBackupDirectoryPath(typeFolder as any);
      const backupDir = path.join(dateBasedDir, metadata.id);

      // Ensure the directory exists
      await fs.mkdir(backupDir, { recursive: true });

      // Save metadata in the same directory as the backup
      const metadataPath = path.join(backupDir, `${metadata.id}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      // Set WebDAV permissions on metadata file
      try {
        await execAsync(`sudo chown www-data:www-data "${metadataPath}"`);
        await execAsync(`sudo chmod 664 "${metadataPath}"`);
      } catch (permError) {
        this.logger.warn(`Could not set permissions on metadata: ${permError.message}`);
      }
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
      ['database', 'files', 'system', 'full'].includes(metadata.type) &&
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
      // Use 'scheduled-backup' as job type (so processor can handle it)
      // Pass job name as jobId for identification
      await this.backupQueue.add('scheduled-backup', createBackupDto, {
        jobId: jobName,
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
        // Extract the original name from job id pattern: scheduled-backup-{name}-{timestamp}
        let extractedName = job.id || job.name;
        if (extractedName && extractedName.startsWith('scheduled-backup-')) {
          const namePart = extractedName.replace('scheduled-backup-', '');
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
          jobName: job.name, // Keep job type for internal use
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
      const { stdout } = await execAsync(`df -h ${this.backupBasePath} | tail -1`);
      const parts = stdout.trim().split(/\s+/);

      // Get available space in bytes for calculations
      const { stdout: bytesOutput } = await execAsync(
        `df -B1 ${this.backupBasePath} | tail -1`,
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
    type: 'database' | 'files' | 'system' | 'full',
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
        // Files backup = WebDAV folders (use relative paths from /srv/webdav)
        return await this.performWebDAVBackup(backupId, paths);
      case 'system':
        return await this.performSystemBackup(backupId, paths);
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

      this.logger.log(`Starting database backup for ${dbName} on ${host}:${port}`);

      // Create PostgreSQL dump as plain SQL (not custom format)
      const dumpOptions = [
        '--verbose',
        '--no-password',
        '--format=plain',
        '--no-privileges',
        '--no-owner',
      ];

      const dumpCommand = `pg_dump -h ${host} -p ${port} -U ${username} -d ${dbName} ${dumpOptions.join(' ')} -f ${tempSqlFile}`;
      await execAsync(dumpCommand, { env });

      // Gzip the SQL file
      await execAsync(`gzip -f ${tempSqlFile}`);

      // Tar the gzipped SQL file (without additional compression since it's already gzipped)
      const compressCommand = `tar -cf ${finalBackupPath} -C /tmp ${backupId}.sql.gz`;
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
      // Ensure date-based directory exists with backup ID subfolder (files type becomes 'arquivos')
      const backupDir = await this.ensureDateBasedDirectory('arquivos', backupId);

      const backupFileName = `${backupId}.tar.gz`;
      const finalBackupPath = path.join(backupDir, backupFileName);

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
