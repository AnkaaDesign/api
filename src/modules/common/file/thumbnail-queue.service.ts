import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { PrismaService } from '@modules/common/prisma/prisma.service';

// Import Bull types for proper type checking
type JobStatus = 'completed' | 'waiting' | 'active' | 'delayed' | 'failed' | 'paused';
type JobStatusClean = 'completed' | 'wait' | 'active' | 'delayed' | 'failed' | 'paused';
export type JobStatusCleanInput =
  | 'completed'
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed'
  | 'paused';

export interface ThumbnailJobData {
  fileId: string;
  filePath: string;
  mimetype: string;
  priority: 'low' | 'normal' | 'high';
  retryCount?: number;
  options?: {
    width?: number;
    height?: number;
    quality?: number;
    format?: 'png' | 'jpg' | 'webp';
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  };
}

export interface ThumbnailJobResult {
  fileId: string;
  success: boolean;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  error?: string;
  processingTime?: number;
}

export enum ThumbnailJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

@Injectable()
export class ThumbnailQueueService {
  private readonly logger = new Logger(ThumbnailQueueService.name);

  constructor(
    @InjectQueue('thumbnail-generation') private thumbnailQueue: Queue<ThumbnailJobData>,
    private readonly prisma: PrismaService,
  ) {
    this.setupQueueListeners();
  }

  /**
   * Add a thumbnail generation job to the queue
   */
  async addThumbnailJob(data: ThumbnailJobData): Promise<Job<ThumbnailJobData>> {
    try {
      const jobOptions = this.getJobOptions(data.priority);

      // Log job creation
      this.logger.log(
        `Adding thumbnail job for file ${data.fileId} with priority ${data.priority}`,
      );

      const job = await this.thumbnailQueue.add('generate-thumbnail', data, {
        ...jobOptions,
        jobId: `thumbnail-${data.fileId}`,
        removeOnComplete: 10, // Keep 10 completed jobs
        removeOnFail: 50, // Keep 50 failed jobs for debugging
      });

      // Update job status in database
      await this.updateJobStatus(data.fileId, ThumbnailJobStatus.PENDING, job.id.toString());

      return job;
    } catch (error: any) {
      this.logger.error(`Failed to add thumbnail job for file ${data.fileId}: ${error.message}`);
      await this.updateJobStatus(data.fileId, ThumbnailJobStatus.FAILED, undefined, error.message);
      throw error;
    }
  }

  /**
   * Add multiple thumbnail jobs in batch
   */
  async addBatchThumbnailJobs(jobs: ThumbnailJobData[]): Promise<Job<ThumbnailJobData>[]> {
    const results: Job<ThumbnailJobData>[] = [];

    for (const jobData of jobs) {
      try {
        const job = await this.addThumbnailJob(jobData);
        results.push(job);
      } catch (error: any) {
        this.logger.error(
          `Failed to add batch thumbnail job for file ${jobData.fileId}: ${error.message}`,
        );
        // Continue with other jobs even if one fails
      }
    }

    return results;
  }

  /**
   * Retry a failed thumbnail job
   */
  async retryThumbnailJob(fileId: string): Promise<Job<ThumbnailJobData> | null> {
    try {
      // Get file information
      const file = await this.prisma.file.findUnique({
        where: { id: fileId },
        select: { id: true, path: true, mimetype: true },
      });

      if (!file) {
        throw new Error(`File not found: ${fileId}`);
      }

      // Check if there's already a pending or processing job
      const existingJob = await this.getJobByFileId(fileId);
      const jobState = await existingJob?.getState();
      if (existingJob && jobState && ['active', 'waiting', 'delayed'].includes(jobState)) {
        this.logger.warn(`Job already exists for file ${fileId} in state: ${jobState}`);
        return existingJob;
      }

      // Create retry job with higher priority
      const retryJobData: ThumbnailJobData = {
        fileId: file.id,
        filePath: file.path,
        mimetype: file.mimetype,
        priority: 'high',
        retryCount: (existingJob?.data.retryCount || 0) + 1,
      };

      return await this.addThumbnailJob(retryJobData);
    } catch (error: any) {
      this.logger.error(`Failed to retry thumbnail job for file ${fileId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get job status for a file
   */
  async getJobStatus(fileId: string): Promise<{
    status: ThumbnailJobStatus;
    jobId?: string;
    progress?: number;
    error?: string;
    createdAt?: Date;
    completedAt?: Date;
  } | null> {
    try {
      // First check database for job tracking
      const jobRecord = await this.prisma.$queryRaw<
        Array<{
          file_id: string;
          job_id: string | null;
          status: string;
          error: string | null;
          created_at: Date;
          completed_at: Date | null;
          progress: number | null;
        }>
      >`
        SELECT file_id, job_id, status, error, created_at, completed_at, progress
        FROM thumbnail_jobs 
        WHERE file_id = ${fileId}
        ORDER BY created_at DESC 
        LIMIT 1
      `;

      if (jobRecord.length === 0) {
        return null;
      }

      const record = jobRecord[0];

      // If we have a job ID, get additional info from Bull
      let progress: number | undefined;
      if (record.job_id) {
        try {
          const job = await this.thumbnailQueue.getJob(record.job_id);
          if (job) {
            progress = job.progress() as number;
          }
        } catch (error) {
          // Job might not exist in Bull anymore, use database info
        }
      }

      return {
        status: record.status as ThumbnailJobStatus,
        jobId: record.job_id || undefined,
        progress: progress !== undefined ? progress : record.progress || undefined,
        error: record.error || undefined,
        createdAt: record.created_at,
        completedAt: record.completed_at || undefined,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get job status for file ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
  }> {
    try {
      const [active, waiting, completed, failed, delayed, paused] = await Promise.all([
        this.thumbnailQueue.getActive(),
        this.thumbnailQueue.getWaiting(),
        this.thumbnailQueue.getCompleted(),
        this.thumbnailQueue.getFailed(),
        this.thumbnailQueue.getDelayed(),
        this.thumbnailQueue.isPaused(),
      ]);

      return {
        active: active.length,
        waiting: waiting.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get queue stats: ${error.message}`);
      return {
        active: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      };
    }
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(): Promise<void> {
    await this.thumbnailQueue.pause();
    this.logger.log('Thumbnail generation queue paused');
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    await this.thumbnailQueue.resume();
    this.logger.log('Thumbnail generation queue resumed');
  }

  /**
   * Clean old jobs from the queue
   */
  async cleanQueue(
    type: JobStatusCleanInput = 'completed',
    olderThan: number = 24 * 60 * 60 * 1000, // 24 hours
  ): Promise<number> {
    // Map user-friendly 'waiting' to Bull.js expected 'wait'
    const cleanType: JobStatusClean = type === 'waiting' ? 'wait' : (type as JobStatusClean);
    const cleaned = await this.thumbnailQueue.clean(olderThan, cleanType);
    this.logger.log(`Cleaned ${cleaned.length} ${type} jobs older than ${olderThan}ms`);
    return cleaned.length;
  }

  /**
   * Setup queue event listeners for monitoring
   */
  private setupQueueListeners(): void {
    this.thumbnailQueue.on('active', (job: Job<ThumbnailJobData>) => {
      this.logger.log(`Thumbnail job started: ${job.id} for file ${job.data.fileId}`);
      this.updateJobStatus(job.data.fileId, ThumbnailJobStatus.PROCESSING, job.id.toString());
    });

    this.thumbnailQueue.on(
      'completed',
      (job: Job<ThumbnailJobData>, result: ThumbnailJobResult) => {
        this.logger.log(
          `Thumbnail job completed: ${job.id} for file ${job.data.fileId} in ${result.processingTime}ms`,
        );
        this.updateJobStatus(
          job.data.fileId,
          ThumbnailJobStatus.COMPLETED,
          job.id.toString(),
          undefined,
          100,
        );
      },
    );

    this.thumbnailQueue.on('failed', (job: Job<ThumbnailJobData>, error: Error) => {
      this.logger.error(
        `Thumbnail job failed: ${job.id} for file ${job.data.fileId}: ${error.message}`,
      );
      this.updateJobStatus(
        job.data.fileId,
        ThumbnailJobStatus.FAILED,
        job.id.toString(),
        error.message,
      );
    });

    this.thumbnailQueue.on('progress', (job: Job<ThumbnailJobData>, progress: number) => {
      this.updateJobStatus(
        job.data.fileId,
        ThumbnailJobStatus.PROCESSING,
        job.id.toString(),
        undefined,
        progress,
      );
    });

    this.thumbnailQueue.on('stalled', (job: Job<ThumbnailJobData>) => {
      this.logger.warn(`Thumbnail job stalled: ${job.id} for file ${job.data.fileId}`);
    });

    this.thumbnailQueue.on('error', (error: Error) => {
      this.logger.error(`Thumbnail queue error: ${error.message}`);
    });
  }

  /**
   * Get job options based on priority
   */
  private getJobOptions(priority: ThumbnailJobData['priority']) {
    const baseOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 10,
      removeOnFail: 50,
    };

    switch (priority) {
      case 'high':
        return {
          ...baseOptions,
          priority: 10,
          delay: 0,
          attempts: 5,
        };
      case 'normal':
        return {
          ...baseOptions,
          priority: 5,
          delay: 1000, // Small delay for normal priority
        };
      case 'low':
        return {
          ...baseOptions,
          priority: 1,
          delay: 5000, // Longer delay for low priority
          attempts: 2,
        };
      default:
        return baseOptions;
    }
  }

  /**
   * Get a job by file ID
   */
  private async getJobByFileId(fileId: string): Promise<Job<ThumbnailJobData> | null> {
    try {
      const jobs = await this.thumbnailQueue.getJobs([
        'active',
        'waiting',
        'delayed',
        'failed',
        'completed',
      ] as JobStatus[]);
      return jobs.find(job => job.data.fileId === fileId) || null;
    } catch (error: any) {
      this.logger.error(`Failed to find job for file ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(
    fileId: string,
    status: ThumbnailJobStatus,
    jobId?: string,
    error?: string,
    progress?: number,
  ): Promise<void> {
    try {
      // Commented out until thumbnail_jobs table is created
      // const now = new Date();

      // // Using raw query since we don't have a Prisma model for this table yet
      // await this.prisma.$executeRaw`
      //   INSERT INTO thumbnail_jobs (file_id, job_id, status, error, progress, created_at, updated_at, completed_at)
      //   VALUES (${fileId}, ${jobId || null}, ${status}, ${error || null}, ${progress || null}, ${now}, ${now}, ${status === ThumbnailJobStatus.COMPLETED || status === ThumbnailJobStatus.FAILED ? now : null})
      //   ON CONFLICT (file_id) DO UPDATE SET
      //     job_id = EXCLUDED.job_id,
      //     status = EXCLUDED.status,
      //     error = EXCLUDED.error,
      //     progress = EXCLUDED.progress,
      //     updated_at = EXCLUDED.updated_at,
      //     completed_at = EXCLUDED.completed_at
      // `;

      // Just log the status change for now
      this.logger.log(
        `Job status update (not persisted): File ${fileId} - Status: ${status}, JobId: ${jobId}, Progress: ${progress}%`,
      );
    } catch (error: any) {
      // Don't throw here as it would break the main flow
      this.logger.error(`Failed to update job status for file ${fileId}: ${error.message}`);
    }
  }
}
