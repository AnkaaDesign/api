import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { ThumbnailJobData, ThumbnailJobResult } from './thumbnail-queue.service';
import { ThumbnailService } from './thumbnail.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { promises as fs } from 'fs';
import { join } from 'path';

@Processor('thumbnail-generation')
@Injectable()
export class ThumbnailProcessorService {
  private readonly logger = new Logger(ThumbnailProcessorService.name);
  private readonly concurrency = parseInt(process.env.THUMBNAIL_CONCURRENCY || '2');
  private readonly timeout = parseInt(process.env.THUMBNAIL_TIMEOUT || '60000'); // 60 seconds

  constructor(
    private readonly thumbnailService: ThumbnailService,
    private readonly prisma: PrismaService,
  ) {}

  @Process({
    name: 'generate-thumbnail',
    concurrency: 2, // Process max 2 jobs simultaneously
  })
  async processThumbnailGeneration(job: Job<ThumbnailJobData>): Promise<ThumbnailJobResult> {
    const startTime = Date.now();
    const { fileId, filePath, mimetype, options } = job.data;

    this.logger.log(`Starting thumbnail generation for file ${fileId} (${mimetype})`);

    try {
      // Update progress
      await job.progress(10);

      // Verify file exists
      await this.verifyFileExists(filePath);
      await job.progress(20);

      let result: any;

      // Route to appropriate processor based on file type
      if (this.isVideoFile(mimetype)) {
        result = await this.processVideoThumbnail(job, filePath, fileId, options);
      } else if (this.isImageFile(mimetype)) {
        result = await this.processImageThumbnail(job, filePath, fileId, mimetype, options);
      } else if (this.isPdfFile(mimetype)) {
        result = await this.processPdfThumbnail(job, filePath, fileId, mimetype, options);
      } else if (this.isEpsFile(mimetype)) {
        result = await this.processEpsThumbnail(job, filePath, fileId, mimetype, options);
      } else {
        throw new Error(`Unsupported file type for thumbnail generation: ${mimetype}`);
      }

      await job.progress(90);

      // Update file record with thumbnail URL if successful
      if (result.success && result.thumbnailUrl) {
        await this.updateFileThumbnailUrl(fileId, result.thumbnailUrl);
        this.logger.log(`Updated file ${fileId} with thumbnail URL: ${result.thumbnailUrl}`);
      }

      await job.progress(100);

      const processingTime = Date.now() - startTime;

      const jobResult: ThumbnailJobResult = {
        fileId,
        success: result.success,
        thumbnailPath: result.thumbnailPath,
        thumbnailUrl: result.thumbnailUrl,
        error: result.error,
        processingTime,
      };

      this.logger.log(`Thumbnail generation completed for file ${fileId} in ${processingTime}ms`);
      return jobResult;
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Thumbnail generation failed for file ${fileId} after ${processingTime}ms: ${error.message}`,
      );

      // Clean up any partial files
      await this.cleanupPartialThumbnails(fileId);

      return {
        fileId,
        success: false,
        error: error.message || 'Unknown error during thumbnail generation',
        processingTime,
      };
    }
  }

  /**
   * Process video thumbnail generation using ThumbnailService (FFmpeg + Sharp pipeline)
   */
  private async processVideoThumbnail(
    job: Job<ThumbnailJobData>,
    filePath: string,
    fileId: string,
    options?: ThumbnailJobData['options'],
  ): Promise<any> {
    await job.progress(30);

    const result = await this.thumbnailService.generateThumbnail(filePath, 'video/mp4', fileId, {
      width: options?.width || 300,
      height: options?.height || 300,
      quality: options?.quality || 85,
      format: options?.format || 'webp',
      fit: options?.fit || 'contain',
    });

    await job.progress(80);
    return result;
  }

  /**
   * Process image thumbnail using existing thumbnail service
   */
  private async processImageThumbnail(
    job: Job<ThumbnailJobData>,
    filePath: string,
    fileId: string,
    mimetype: string,
    options?: ThumbnailJobData['options'],
  ): Promise<any> {
    await job.progress(30);

    const result = await this.thumbnailService.generateThumbnail(filePath, mimetype, fileId, {
      width: options?.width || 300,
      height: options?.height || 300,
      quality: options?.quality || 85,
      format: options?.format || 'webp',
      fit: options?.fit || 'contain',
    });

    await job.progress(80);
    return result;
  }

  /**
   * Process PDF thumbnail using existing thumbnail service
   */
  private async processPdfThumbnail(
    job: Job<ThumbnailJobData>,
    filePath: string,
    fileId: string,
    mimetype: string,
    options?: ThumbnailJobData['options'],
  ): Promise<any> {
    await job.progress(30);

    const result = await this.thumbnailService.generateThumbnail(filePath, mimetype, fileId, {
      width: options?.width || 300,
      height: options?.height || 300,
      quality: options?.quality || 85,
      format: options?.format || 'webp',
      fit: options?.fit || 'contain',
    });

    await job.progress(80);
    return result;
  }

  /**
   * Process EPS thumbnail using existing thumbnail service
   */
  private async processEpsThumbnail(
    job: Job<ThumbnailJobData>,
    filePath: string,
    fileId: string,
    mimetype: string,
    options?: ThumbnailJobData['options'],
  ): Promise<any> {
    await job.progress(30);

    const result = await this.thumbnailService.generateThumbnail(filePath, mimetype, fileId, {
      width: options?.width || 300,
      height: options?.height || 300,
      quality: options?.quality || 85,
      format: options?.format || 'webp',
      fit: options?.fit || 'contain',
    });

    await job.progress(80);
    return result;
  }

  /**
   * Verify file exists and is readable
   */
  private async verifyFileExists(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        throw new Error('Path does not point to a valid file');
      }
      if (stats.size === 0) {
        throw new Error('File is empty');
      }
    } catch (error: any) {
      throw new Error(`File verification failed: ${error.message}`);
    }
  }

  /**
   * Update file record with thumbnail URL
   */
  private async updateFileThumbnailUrl(fileId: string, thumbnailUrl: string): Promise<void> {
    try {
      await this.prisma.file.update({
        where: { id: fileId },
        data: { thumbnailUrl },
      });
    } catch (error: any) {
      this.logger.error(`Failed to update file ${fileId} with thumbnail URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up partial thumbnail files on failure
   */
  private async cleanupPartialThumbnails(fileId: string): Promise<void> {
    try {
      const uploadsDir = process.env.UPLOAD_DIR || './uploads';
      const thumbnailDir = join(uploadsDir, 'thumbnails');

      // Common thumbnail sizes to clean up
      const sizes = ['150x150', '300x300', '600x600'];
      const formats = ['jpg', 'png', 'webp'];

      for (const size of sizes) {
        const sizeDir = join(thumbnailDir, size);
        for (const format of formats) {
          const thumbnailPath = join(sizeDir, `${fileId}_${size}.${format}`);
          const tempPath = join(sizeDir, `${fileId}_${size}_temp.${format}`);

          // Try to clean up both final and temp files
          for (const path of [thumbnailPath, tempPath]) {
            try {
              await fs.access(path);
              await fs.unlink(path);
              this.logger.log(`Cleaned up partial thumbnail: ${path}`);
            } catch (error) {
              // File doesn't exist, ignore
            }
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to cleanup partial thumbnails for file ${fileId}: ${error.message}`);
    }
  }

  /**
   * File type detection methods
   */
  private isVideoFile(mimetype: string): boolean {
    return mimetype.startsWith('video/');
  }

  private isImageFile(mimetype: string): boolean {
    return (
      mimetype.startsWith('image/') && !this.isEpsFile(mimetype) && mimetype !== 'image/svg+xml'
    );
  }

  private isPdfFile(mimetype: string): boolean {
    return mimetype === 'application/pdf';
  }

  private isEpsFile(mimetype: string): boolean {
    return [
      'application/postscript',
      'application/x-eps',
      'application/eps',
      'image/eps',
      'image/x-eps',
    ].includes(mimetype.toLowerCase());
  }
}
