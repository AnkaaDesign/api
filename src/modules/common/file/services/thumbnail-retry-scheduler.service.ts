import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ThumbnailQueueService } from '../thumbnail-queue.service';
import { existsSync } from 'fs';

interface ThumbnailRetryStats {
  filesChecked: number;
  missingThumbnails: number;
  failedJobs: number;
  retriesQueued: number;
  errors: string[];
}

interface FileWithoutThumbnail {
  id: string;
  filename: string;
  path: string;
  mimetype: string;
  createdAt: Date;
  ageInDays: number;
  reason: 'no_thumbnail_url' | 'failed_job' | 'stale_job';
}

@Injectable()
export class ThumbnailRetrySchedulerService {
  private readonly logger = new Logger(ThumbnailRetrySchedulerService.name);
  private readonly maxRetries = 3;
  private readonly staleJobThresholdHours = 2; // Jobs older than 2 hours are considered stale

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly thumbnailQueueService: ThumbnailQueueService,
  ) {}

  /**
   * Initialize scheduled thumbnail retry tasks
   */
  onModuleInit() {
    this.scheduleThumbnailRetryCheck();
    this.logger.log('Thumbnail retry scheduler initialized');
  }

  /**
   * Schedule thumbnail retry check
   * Runs every 6 hours
   */
  private scheduleThumbnailRetryCheck(): void {
    try {
      const retryJob = new CronJob(
        '0 */6 * * *', // Run every 6 hours
        async () => {
          await this.performThumbnailRetryCheck();
        },
        null,
        true,
        'America/Sao_Paulo',
      );

      this.schedulerRegistry.addCronJob('thumbnail-retry-check', retryJob);
      this.logger.log('Scheduled thumbnail retry check every 6 hours');
    } catch (error: any) {
      this.logger.error(`Failed to schedule thumbnail retry check: ${error.message}`);
    }
  }

  /**
   * Perform thumbnail retry check and queue retries
   */
  async performThumbnailRetryCheck(): Promise<ThumbnailRetryStats> {
    const stats: ThumbnailRetryStats = {
      filesChecked: 0,
      missingThumbnails: 0,
      failedJobs: 0,
      retriesQueued: 0,
      errors: [],
    };

    this.logger.log('Starting thumbnail retry check...');

    try {
      // 1. Find files that should have thumbnails but don't
      const filesWithoutThumbnails = await this.findFilesWithoutThumbnails();
      stats.filesChecked = filesWithoutThumbnails.length;
      stats.missingThumbnails = filesWithoutThumbnails.length;

      this.logger.log(`Found ${filesWithoutThumbnails.length} files without thumbnails`);

      // 2. Find failed or stale thumbnail jobs
      const failedJobs = await this.findFailedThumbnailJobs();
      stats.failedJobs = failedJobs.length;

      this.logger.log(`Found ${failedJobs.length} failed thumbnail jobs`);

      // 3. Queue retries for files without thumbnails
      for (const file of filesWithoutThumbnails) {
        // Check if file still exists on disk
        if (!existsSync(file.path)) {
          this.logger.warn(`Skipping ${file.filename} - file not found on disk: ${file.path}`);
          continue;
        }

        try {
          // Check if there's already a pending job for this file
          const existingJob = await this.prisma.thumbnailJob.findUnique({
            where: { fileId: file.id },
          });

          if (existingJob && existingJob.status === 'processing') {
            this.logger.log(`Skipping ${file.filename} - job already processing`);
            continue;
          }

          // Determine priority based on file age
          let priority: 'low' | 'normal' | 'high' = 'normal';
          if (file.ageInDays > 30) {
            priority = 'low'; // Old files get low priority
          } else if (file.ageInDays < 1) {
            priority = 'high'; // Recent files get high priority
          }

          // Queue thumbnail generation
          await this.thumbnailQueueService.addThumbnailJob({
            fileId: file.id,
            filePath: file.path,
            mimetype: file.mimetype,
            priority,
            options: {
              width: 300,
              height: 300,
              quality: 85,
              format: 'webp',
              fit: 'contain',
            },
          });

          stats.retriesQueued++;
          this.logger.log(`Queued thumbnail retry for ${file.filename} (${priority} priority)`);
        } catch (error: any) {
          const errorMsg = `Failed to queue retry for ${file.filename}: ${error.message}`;
          stats.errors.push(errorMsg);
          this.logger.error(errorMsg);
        }
      }

      this.logger.log(`Thumbnail retry check completed: ${stats.retriesQueued} retries queued`);

      return stats;
    } catch (error: any) {
      this.logger.error(`Thumbnail retry check failed: ${error.message}`, error.stack);
      stats.errors.push(error.message);
      return stats;
    }
  }

  /**
   * Find files that should have thumbnails but don't
   */
  private async findFilesWithoutThumbnails(): Promise<FileWithoutThumbnail[]> {
    const filesWithoutThumbnails: FileWithoutThumbnail[] = [];

    try {
      // Supported file types for thumbnails
      const supportedMimeTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'application/pdf',
        'application/postscript',
        'application/x-eps',
        'application/eps',
        'image/eps',
        'image/x-eps',
      ];

      // Find files with supported types but no thumbnail
      const files = await this.prisma.file.findMany({
        where: {
          mimetype: { in: supportedMimeTypes },
          OR: [{ thumbnailUrl: null }, { thumbnailUrl: '' }],
        },
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
          createdAt: true,
          thumbnailUrl: true,
        },
        take: 100, // Limit to prevent overwhelming the queue
      });

      for (const file of files) {
        const ageInDays = (Date.now() - file.createdAt.getTime()) / (1000 * 60 * 60 * 24);

        filesWithoutThumbnails.push({
          id: file.id,
          filename: file.filename,
          path: file.path,
          mimetype: file.mimetype,
          createdAt: file.createdAt,
          ageInDays,
          reason: 'no_thumbnail_url',
        });
      }

      return filesWithoutThumbnails;
    } catch (error: any) {
      this.logger.error(`Failed to find files without thumbnails: ${error.message}`);
      return filesWithoutThumbnails;
    }
  }

  /**
   * Find failed or stale thumbnail jobs
   */
  private async findFailedThumbnailJobs(): Promise<
    Array<{
      id: string;
      fileId: string;
      status: string;
      attempts: number;
      createdAt: Date;
    }>
  > {
    try {
      const staleThreshold = new Date(Date.now() - this.staleJobThresholdHours * 60 * 60 * 1000);

      // Find failed jobs or stale processing jobs
      const failedJobs = await this.prisma.thumbnailJob.findMany({
        where: {
          OR: [
            { status: 'failed' },
            {
              status: 'processing',
              updatedAt: { lt: staleThreshold },
            },
          ],
          attempts: { lt: this.maxRetries },
        },
        select: {
          id: true,
          fileId: true,
          status: true,
          attempts: true,
          createdAt: true,
        },
      });

      return failedJobs;
    } catch (error: any) {
      this.logger.error(`Failed to find failed thumbnail jobs: ${error.message}`);
      return [];
    }
  }

  /**
   * Manual retry trigger for all failed thumbnails
   */
  async triggerManualRetry(): Promise<{
    success: boolean;
    message: string;
    stats: ThumbnailRetryStats;
  }> {
    try {
      this.logger.log('Manual thumbnail retry triggered');
      const stats = await this.performThumbnailRetryCheck();

      return {
        success: true,
        message: 'Thumbnail retry completed',
        stats,
      };
    } catch (error: any) {
      this.logger.error(`Manual retry failed: ${error.message}`);
      return {
        success: false,
        message: `Retry failed: ${error.message}`,
        stats: {
          filesChecked: 0,
          missingThumbnails: 0,
          failedJobs: 0,
          retriesQueued: 0,
          errors: [error.message],
        },
      };
    }
  }

  /**
   * Get thumbnail status report
   */
  async getThumbnailStatusReport(): Promise<{
    filesWithoutThumbnails: FileWithoutThumbnail[];
    failedJobs: any[];
    summary: {
      totalFilesChecked: number;
      totalWithoutThumbnails: number;
      totalFailedJobs: number;
      queueSize: number;
    };
  }> {
    const filesWithoutThumbnails = await this.findFilesWithoutThumbnails();
    const failedJobs = await this.findFailedThumbnailJobs();

    // Get queue stats
    let queueSize = 0;
    try {
      const queueStats = await this.thumbnailQueueService.getQueueStats();
      queueSize = queueStats.waiting + queueStats.active;
    } catch (error) {
      this.logger.warn('Failed to get queue stats');
    }

    return {
      filesWithoutThumbnails,
      failedJobs,
      summary: {
        totalFilesChecked: filesWithoutThumbnails.length + failedJobs.length,
        totalWithoutThumbnails: filesWithoutThumbnails.length,
        totalFailedJobs: failedJobs.length,
        queueSize,
      },
    };
  }

  /**
   * Force retry for a specific file
   */
  async retryThumbnailForFile(fileId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const file = await this.prisma.file.findUnique({
        where: { id: fileId },
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
        },
      });

      if (!file) {
        return {
          success: false,
          message: 'File not found',
        };
      }

      if (!existsSync(file.path)) {
        return {
          success: false,
          message: 'File not found on disk',
        };
      }

      // Queue thumbnail generation with high priority
      await this.thumbnailQueueService.addThumbnailJob({
        fileId: file.id,
        filePath: file.path,
        mimetype: file.mimetype,
        priority: 'high',
        options: {
          width: 300,
          height: 300,
          quality: 85,
          format: 'webp',
          fit: 'contain',
        },
      });

      return {
        success: true,
        message: `Thumbnail generation queued for ${file.filename}`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to retry thumbnail for ${fileId}: ${error.message}`);
      return {
        success: false,
        message: `Failed to queue retry: ${error.message}`,
      };
    }
  }

  /**
   * Clean up old failed jobs (older than 30 days)
   */
  async cleanupOldFailedJobs(): Promise<{
    success: boolean;
    deletedCount: number;
    message: string;
  }> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.thumbnailJob.deleteMany({
        where: {
          status: 'failed',
          createdAt: { lt: thirtyDaysAgo },
        },
      });

      this.logger.log(`Cleaned up ${result.count} old failed thumbnail jobs`);

      return {
        success: true,
        deletedCount: result.count,
        message: `Cleaned up ${result.count} old failed jobs`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to cleanup old failed jobs: ${error.message}`);
      return {
        success: false,
        deletedCount: 0,
        message: `Cleanup failed: ${error.message}`,
      };
    }
  }
}
