import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { existsSync, mkdirSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { cleanupTemporaryFiles, getUploadStats } from '../config/upload.config';

@Injectable()
export class UploadInitService implements OnModuleInit {
  private readonly logger = new Logger(UploadInitService.name);
  private readonly uploadPath: string;

  constructor(private schedulerRegistry: SchedulerRegistry) {
    this.uploadPath = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  }

  async onModuleInit() {
    await this.initializeUploadDirectory();
    await this.initializeFilesDirectory();
    this.scheduleCleanupTasks();
    await this.logUploadStats();
  }

  /**
   * Initialize upload directory with proper permissions and structure
   */
  private async initializeUploadDirectory(): Promise<void> {
    try {
      // Create main upload directory
      this.ensureDirectoryExists(this.uploadPath);

      // Create subdirectories for different file types
      const subdirectories = ['images', 'documents', 'temp', 'archives'];

      for (const subdir of subdirectories) {
        const subdirPath = join(this.uploadPath, subdir);
        this.ensureDirectoryExists(subdirPath);
      }

      // Verify write permissions
      this.verifyWritePermissions(this.uploadPath);

      this.logger.log(`Upload directory initialized: ${this.uploadPath}`);
    } catch (error: any) {
      this.logger.error(`Failed to initialize upload directory: ${error.message}`);
      throw new Error(`Upload initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize files storage directory structure (mirrors production /srv/files)
   * Skips initialization for absolute paths (production — managed externally)
   */
  private async initializeFilesDirectory(): Promise<void> {
    const filesRoot = process.env.FILES_ROOT || './files';

    // Skip if absolute path (production — managed externally)
    if (filesRoot.startsWith('/')) {
      this.logger.log(`Files root is absolute path (${filesRoot}), skipping auto-initialization`);
      return;
    }

    const directories = [
      'Projetos',
      'Orcamentos/Tarefas',
      'Orcamentos/Pedidos',
      'Orcamentos/Aerografias',
      'Notas Fiscais/Tarefas',
      'Notas Fiscais/Pedidos',
      'Notas Fiscais/Aerografias',
      'Notas Fiscais/RetiradasExternas',
      'Comprovantes/Tarefas',
      'Comprovantes/Pedidos',
      'Comprovantes/Aerografias',
      'Comprovantes/RetiradasExternas',
      'Reembolsos/Tarefas',
      'Reembolsos/Pedidos',
      'Reembolsos/Aerografias',
      'Reembolsos/RetiradasExternas',
      'Notas Fiscais Reembolso/Tarefas',
      'Notas Fiscais Reembolso/Pedidos',
      'Notas Fiscais Reembolso/Aerografias',
      'Notas Fiscais Reembolso/RetiradasExternas',
      'Colaboradores/Documentos',
      'Logos/Clientes',
      'Logos/Fornecedores',
      'Aerografias',
      'Plotter',
      'Arquivos Clientes',
      'Observacoes',
      'Advertencias',
      'Auxiliares/Traseiras/Fotos',
      'Fotos',
      'Layouts/Orcamentos',
      'Thumbnails',
      'Tintas',
      'Mensagens',
      'Uploads',
    ];

    this.ensureDirectoryExists(filesRoot);
    for (const dir of directories) {
      this.ensureDirectoryExists(join(filesRoot, dir));
    }
    this.logger.log(`Files storage initialized: ${filesRoot} (${directories.length} directories)`);
  }

  /**
   * Ensure a directory exists, create if it doesn't
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true, mode: 0o755 });
      this.logger.log(`Created directory: ${dirPath}`);
    }
  }

  /**
   * Verify write permissions on upload directory
   */
  private verifyWritePermissions(dirPath: string): void {
    try {
      accessSync(dirPath, constants.W_OK | constants.R_OK);
      this.logger.log(`Write permissions verified for: ${dirPath}`);
    } catch (error) {
      throw new Error(`No write permission for upload directory: ${dirPath}`);
    }
  }

  /**
   * Schedule periodic cleanup tasks
   */
  private scheduleCleanupTasks(): void {
    try {
      // Daily cleanup at 2 AM
      const cleanupJob = new CronJob(
        '0 2 * * *', // Run at 2:00 AM every day
        async () => {
          await this.performCleanup();
        },
        null,
        true,
        'America/Sao_Paulo', // Brazilian timezone
      );

      this.schedulerRegistry.addCronJob('upload-cleanup', cleanupJob);
      this.logger.log('Scheduled daily cleanup task at 2:00 AM');

      // Weekly stats report on Mondays at 8 AM
      const statsJob = new CronJob(
        '0 8 * * 1', // Run at 8:00 AM every Monday
        async () => {
          await this.logUploadStats(true);
        },
        null,
        true,
        'America/Sao_Paulo',
      );

      this.schedulerRegistry.addCronJob('upload-stats', statsJob);
      this.logger.log('Scheduled weekly stats report on Mondays at 8:00 AM');
    } catch (error: any) {
      this.logger.error(`Failed to schedule cleanup tasks: ${error.message}`);
    }
  }

  /**
   * Perform cleanup of old temporary files
   */
  private async performCleanup(): Promise<void> {
    const logger = new Logger('UploadCleanup');

    try {
      logger.log('Starting scheduled cleanup of temporary files');

      // Clean main upload directory (24 hours)
      await cleanupTemporaryFiles(this.uploadPath, 24 * 60 * 60 * 1000);

      // Clean temp subdirectory (1 hour)
      const tempDir = join(this.uploadPath, 'temp');
      if (existsSync(tempDir)) {
        await cleanupTemporaryFiles(tempDir, 60 * 60 * 1000);
      }

      // Get stats after cleanup
      const stats = await getUploadStats(this.uploadPath);
      logger.log(
        `Cleanup completed. Current stats: ${stats.totalFiles} files, ${Math.round(stats.totalSize / (1024 * 1024))}MB`,
      );
    } catch (error: any) {
      logger.error(`Cleanup failed: ${error.message}`);
    }
  }

  /**
   * Log upload directory statistics
   */
  private async logUploadStats(detailed = false): Promise<void> {
    try {
      const stats = await getUploadStats(this.uploadPath);

      const sizeInMB = Math.round(stats.totalSize / (1024 * 1024));
      this.logger.log(`Upload stats: ${stats.totalFiles} files, ${sizeInMB}MB total`);

      if (detailed) {
        this.logger.log(`Oldest file: ${stats.oldestFile?.toISOString() || 'none'}`);
        this.logger.log(`Newest file: ${stats.newestFile?.toISOString() || 'none'}`);

        // Log subdirectory stats
        const subdirs = ['images', 'documents', 'temp', 'archives'];
        for (const subdir of subdirs) {
          const subdirPath = join(this.uploadPath, subdir);
          if (existsSync(subdirPath)) {
            const subdirStats = await getUploadStats(subdirPath);
            this.logger.log(
              `${subdir}: ${subdirStats.totalFiles} files, ${Math.round(subdirStats.totalSize / (1024 * 1024))}MB`,
            );
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to get upload stats: ${error.message}`);
    }
  }

  /**
   * Manual cleanup trigger (for administrative use)
   */
  async triggerCleanup(): Promise<{
    success: boolean;
    message: string;
    stats: { before: any; after: any };
  }> {
    try {
      const beforeStats = await getUploadStats(this.uploadPath);
      await this.performCleanup();
      const afterStats = await getUploadStats(this.uploadPath);

      return {
        success: true,
        message: 'Cleanup completed successfully',
        stats: { before: beforeStats, after: afterStats },
      };
    } catch (error: any) {
      this.logger.error(`Manual cleanup failed: ${error.message}`);
      return {
        success: false,
        message: `Cleanup failed: ${error.message}`,
        stats: { before: null, after: null },
      };
    }
  }

  /**
   * Get current upload directory information
   */
  async getUploadInfo(): Promise<{
    path: string;
    exists: boolean;
    writable: boolean;
    stats: any;
    subdirectories: Array<{ name: string; exists: boolean; stats: any }>;
  }> {
    const subdirs = ['images', 'documents', 'temp', 'archives'];

    return {
      path: this.uploadPath,
      exists: existsSync(this.uploadPath),
      writable: this.checkWritable(this.uploadPath),
      stats: await getUploadStats(this.uploadPath),
      subdirectories: await Promise.all(
        subdirs.map(async subdir => {
          const subdirPath = join(this.uploadPath, subdir);
          return {
            name: subdir,
            exists: existsSync(subdirPath),
            stats: existsSync(subdirPath) ? await getUploadStats(subdirPath) : null,
          };
        }),
      ),
    };
  }

  /**
   * Check if directory is writable
   */
  private checkWritable(dirPath: string): boolean {
    try {
      accessSync(dirPath, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Health check for upload system
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    message: string;
    details: any;
  }> {
    try {
      const info = await this.getUploadInfo();

      if (!info.exists) {
        return {
          status: 'error',
          message: 'Upload directory does not exist',
          details: info,
        };
      }

      if (!info.writable) {
        return {
          status: 'error',
          message: 'Upload directory is not writable',
          details: info,
        };
      }

      // Warning if too many files or too much space used
      const maxFiles = parseInt(process.env.MAX_UPLOAD_FILES || '10000');
      const maxSizeMB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '10000'); // 10GB default

      if (info.stats.totalFiles > maxFiles) {
        return {
          status: 'warning',
          message: `Too many files in upload directory: ${info.stats.totalFiles} > ${maxFiles}`,
          details: info,
        };
      }

      if (info.stats.totalSize > maxSizeMB * 1024 * 1024) {
        return {
          status: 'warning',
          message: `Upload directory size too large: ${Math.round(info.stats.totalSize / (1024 * 1024))}MB > ${maxSizeMB}MB`,
          details: info,
        };
      }

      return {
        status: 'healthy',
        message: 'Upload system is healthy',
        details: info,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: `Health check failed: ${error.message}`,
        details: null,
      };
    }
  }
}
