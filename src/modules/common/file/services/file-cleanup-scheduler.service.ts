import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { UPLOAD_CONFIG } from '../config/upload.config';

interface OrphanedFile {
  path: string;
  size: number;
  age: number; // age in days
  reason: 'no_db_record' | 'missing_on_disk';
}

interface CleanupStats {
  filesScanned: number;
  orphanedFilesFound: number;
  filesDeleted: number;
  spaceSaved: number; // in bytes
  errors: string[];
}

@Injectable()
export class FileCleanupSchedulerService {
  private readonly logger = new Logger(FileCleanupSchedulerService.name);
  private readonly orphanedFileAgeThresholdDays = 7; // Delete orphaned files older than 7 days
  private readonly webdavRoot: string;
  private readonly uploadDir: string;

  // Folders managed via Samba that should be excluded from orphaned file cleanup
  // These folders contain files uploaded directly via Samba and won't have database records
  private readonly sambaExcludedFolders = [
    'Artes',
    'Auxiliares',
    'Fotos',
    'Aerografias',
    'Backup',
  ];

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly prisma: PrismaService,
  ) {
    this.webdavRoot = process.env.WEBDAV_ROOT || '/srv/webdav';
    this.uploadDir = process.env.UPLOAD_DIR || './uploads';
  }

  /**
   * Initialize scheduled cleanup tasks
   */
  onModuleInit() {
    this.scheduleOrphanedFileCleanup();
    this.logger.log('File cleanup scheduler initialized');
  }

  /**
   * Schedule orphaned file cleanup
   * Runs daily at 3 AM (1 hour after temp file cleanup)
   */
  private scheduleOrphanedFileCleanup(): void {
    try {
      const cleanupJob = new CronJob(
        '0 3 * * *', // Run at 3:00 AM every day
        async () => {
          await this.performOrphanedFileCleanup();
        },
        null,
        true,
        'America/Sao_Paulo',
      );

      this.schedulerRegistry.addCronJob('orphaned-file-cleanup', cleanupJob);
      this.logger.log('Scheduled orphaned file cleanup at 3:00 AM daily');
    } catch (error: any) {
      this.logger.error(`Failed to schedule orphaned file cleanup: ${error.message}`);
    }
  }

  /**
   * Perform orphaned file cleanup
   */
  async performOrphanedFileCleanup(): Promise<CleanupStats> {
    const stats: CleanupStats = {
      filesScanned: 0,
      orphanedFilesFound: 0,
      filesDeleted: 0,
      spaceSaved: 0,
      errors: [],
    };

    this.logger.log('Starting orphaned file cleanup...');

    try {
      // 1. Find files on disk without database records
      const orphanedOnDisk = await this.findOrphanedFilesOnDisk();
      stats.orphanedFilesFound += orphanedOnDisk.length;

      // 2. Find files in database without physical files (for logging only)
      const missingOnDisk = await this.findFilesInDBWithoutPhysicalFile();

      if (missingOnDisk.length > 0) {
        this.logger.warn(
          `Found ${missingOnDisk.length} files in database without physical files`,
        );
        // Log them but don't delete - may be temporary network issue
        for (const file of missingOnDisk.slice(0, 10)) { // Log first 10
          this.logger.warn(`Missing file: ${file.path} (ID: ${file.id})`);
        }
      }

      // 3. Delete orphaned files on disk (older than threshold)
      for (const orphanedFile of orphanedOnDisk) {
        if (orphanedFile.age >= this.orphanedFileAgeThresholdDays) {
          try {
            await fs.unlink(orphanedFile.path);
            stats.filesDeleted++;
            stats.spaceSaved += orphanedFile.size;
            this.logger.log(
              `Deleted orphaned file: ${orphanedFile.path} (${Math.round(orphanedFile.size / 1024)}KB, ${orphanedFile.age} days old)`,
            );
          } catch (error: any) {
            const errorMsg = `Failed to delete ${orphanedFile.path}: ${error.message}`;
            stats.errors.push(errorMsg);
            this.logger.error(errorMsg);
          }
        }
      }

      this.logger.log(
        `Orphaned file cleanup completed: ${stats.filesDeleted}/${stats.orphanedFilesFound} files deleted, ${Math.round(stats.spaceSaved / (1024 * 1024))}MB freed`,
      );

      return stats;
    } catch (error: any) {
      this.logger.error(`Orphaned file cleanup failed: ${error.message}`, error.stack);
      stats.errors.push(error.message);
      return stats;
    }
  }

  /**
   * Find files on disk that don't have database records
   */
  private async findOrphanedFilesOnDisk(): Promise<OrphanedFile[]> {
    const orphanedFiles: OrphanedFile[] = [];

    try {
      // Get all file paths from database
      const dbFiles = await this.prisma.file.findMany({
        select: { path: true },
      });
      const dbFilePaths = new Set(dbFiles.map(f => f.path));

      // Scan WebDAV directory (excluding Samba-managed folders)
      if (UPLOAD_CONFIG.useWebDAV && existsSync(this.webdavRoot)) {
        this.logger.log(`Scanning WebDAV directory: ${this.webdavRoot}`);
        this.logger.log(`Excluding Samba folders: ${this.sambaExcludedFolders.join(', ')}`);
        const webdavOrphans = await this.scanDirectoryForOrphans(
          this.webdavRoot,
          dbFilePaths,
          this.sambaExcludedFolders, // Exclude Samba-managed folders
        );
        orphanedFiles.push(...webdavOrphans);
      }

      // Scan upload directory (but skip temp folder - handled by upload-init.service)
      if (existsSync(this.uploadDir)) {
        this.logger.log(`Scanning upload directory: ${this.uploadDir}`);
        const uploadOrphans = await this.scanDirectoryForOrphans(
          this.uploadDir,
          dbFilePaths,
          ['temp'], // Skip temp folder
        );
        orphanedFiles.push(...uploadOrphans);
      }

      this.logger.log(`Found ${orphanedFiles.length} orphaned files on disk`);
      return orphanedFiles;
    } catch (error: any) {
      this.logger.error(`Failed to find orphaned files: ${error.message}`);
      return orphanedFiles;
    }
  }

  /**
   * Recursively scan directory for orphaned files
   */
  private async scanDirectoryForOrphans(
    dirPath: string,
    dbFilePaths: Set<string>,
    skipDirs: string[] = [],
  ): Promise<OrphanedFile[]> {
    const orphanedFiles: OrphanedFile[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        // Skip specified directories
        if (entry.isDirectory()) {
          if (skipDirs.includes(entry.name)) {
            this.logger.log(`Skipping excluded directory: ${fullPath}`);
            continue;
          }
          // Recursively scan subdirectories
          const subOrphans = await this.scanDirectoryForOrphans(
            fullPath,
            dbFilePaths,
            skipDirs,
          );
          orphanedFiles.push(...subOrphans);
        } else if (entry.isFile()) {
          // Skip macOS metadata files (created by Samba/macOS clients)
          if (entry.name.startsWith('._') || entry.name === '.DS_Store') {
            continue;
          }

          // Check if file exists in database
          if (!dbFilePaths.has(fullPath)) {
            try {
              const stats = await fs.stat(fullPath);
              const ageInDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);

              orphanedFiles.push({
                path: fullPath,
                size: stats.size,
                age: ageInDays,
                reason: 'no_db_record',
              });
            } catch (error: any) {
              this.logger.warn(`Failed to stat file ${fullPath}: ${error.message}`);
            }
          }
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to scan directory ${dirPath}: ${error.message}`);
    }

    return orphanedFiles;
  }

  /**
   * Find files in database that don't exist on disk
   */
  private async findFilesInDBWithoutPhysicalFile(): Promise<Array<{ id: string; path: string }>> {
    const missingFiles: Array<{ id: string; path: string }> = [];

    try {
      const dbFiles = await this.prisma.file.findMany({
        select: { id: true, path: true },
      });

      for (const file of dbFiles) {
        if (!existsSync(file.path)) {
          missingFiles.push({
            id: file.id,
            path: file.path,
          });
        }
      }

      return missingFiles;
    } catch (error: any) {
      this.logger.error(`Failed to check for missing files: ${error.message}`);
      return missingFiles;
    }
  }

  /**
   * Manual cleanup trigger (for administrative use)
   */
  async triggerManualCleanup(): Promise<{
    success: boolean;
    message: string;
    stats: CleanupStats;
  }> {
    try {
      this.logger.log('Manual orphaned file cleanup triggered');
      const stats = await this.performOrphanedFileCleanup();

      return {
        success: true,
        message: 'Orphaned file cleanup completed',
        stats,
      };
    } catch (error: any) {
      this.logger.error(`Manual cleanup failed: ${error.message}`);
      return {
        success: false,
        message: `Cleanup failed: ${error.message}`,
        stats: {
          filesScanned: 0,
          orphanedFilesFound: 0,
          filesDeleted: 0,
          spaceSaved: 0,
          errors: [error.message],
        },
      };
    }
  }

  /**
   * Get orphaned file report without deleting
   */
  async getOrphanedFileReport(): Promise<{
    orphanedOnDisk: OrphanedFile[];
    missingOnDisk: Array<{ id: string; path: string }>;
    summary: {
      totalOrphanedOnDisk: number;
      totalSizeOrphaned: number;
      deletableOrphaned: number;
      missingOnDisk: number;
    };
  }> {
    const orphanedOnDisk = await this.findOrphanedFilesOnDisk();
    const missingOnDisk = await this.findFilesInDBWithoutPhysicalFile();

    const deletableOrphaned = orphanedOnDisk.filter(
      f => f.age >= this.orphanedFileAgeThresholdDays,
    );

    const totalSizeOrphaned = orphanedOnDisk.reduce((sum, f) => sum + f.size, 0);

    return {
      orphanedOnDisk,
      missingOnDisk,
      summary: {
        totalOrphanedOnDisk: orphanedOnDisk.length,
        totalSizeOrphaned,
        deletableOrphaned: deletableOrphaned.length,
        missingOnDisk: missingOnDisk.length,
      },
    };
  }

  /**
   * Clean up orphaned files immediately (skip age threshold)
   */
  async forceCleanupOrphanedFiles(): Promise<CleanupStats> {
    const stats: CleanupStats = {
      filesScanned: 0,
      orphanedFilesFound: 0,
      filesDeleted: 0,
      spaceSaved: 0,
      errors: [],
    };

    this.logger.warn('FORCE cleanup initiated - deleting ALL orphaned files regardless of age');

    try {
      const orphanedOnDisk = await this.findOrphanedFilesOnDisk();
      stats.orphanedFilesFound = orphanedOnDisk.length;

      for (const orphanedFile of orphanedOnDisk) {
        try {
          await fs.unlink(orphanedFile.path);
          stats.filesDeleted++;
          stats.spaceSaved += orphanedFile.size;
        } catch (error: any) {
          const errorMsg = `Failed to delete ${orphanedFile.path}: ${error.message}`;
          stats.errors.push(errorMsg);
        }
      }

      this.logger.log(
        `Force cleanup completed: ${stats.filesDeleted}/${stats.orphanedFilesFound} files deleted`,
      );

      return stats;
    } catch (error: any) {
      this.logger.error(`Force cleanup failed: ${error.message}`);
      stats.errors.push(error.message);
      return stats;
    }
  }
}
