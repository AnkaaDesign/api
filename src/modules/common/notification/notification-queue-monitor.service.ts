import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobCounts } from 'bull';
import { NotificationJobData } from './notification-queue.processor';

/**
 * Enhanced queue statistics with additional metrics
 */
export interface EnhancedQueueStats extends JobCounts {
  total: number;
  isPaused: boolean;
  processingRate?: number;
  averageProcessingTime?: number;
  errorRate?: number;
}

/**
 * Job details for monitoring purposes
 */
export interface MonitorJobInfo {
  id: string | number;
  name: string;
  data: NotificationJobData;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  attemptsMade: number;
  delay?: number;
  priority?: number;
  state?: string;
  progress?: number;
  stacktrace?: string[];
}

/**
 * Worker metrics for monitoring
 */
export interface WorkerMetrics {
  name: string;
  isRunning: boolean;
  isActive: boolean;
  isIdle: boolean;
}

/**
 * Queue health status
 */
export interface QueueHealthStatus {
  isHealthy: boolean;
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  recommendations: string[];
  metrics: {
    failedJobsCount: number;
    activeJobsCount: number;
    waitingJobsCount: number;
    delayedJobsCount: number;
    stalledJobsCount: number;
  };
}

/**
 * Notification Queue Monitor Service
 * Provides comprehensive monitoring and health check capabilities for the notification queue
 */
@Injectable()
export class NotificationQueueMonitorService {
  private readonly logger = new Logger(NotificationQueueMonitorService.name);

  constructor(@InjectQueue('notification') private queue: Queue<NotificationJobData>) {}

  /**
   * Get comprehensive queue statistics
   * Includes all job counts and queue status
   */
  async getQueueStats(): Promise<EnhancedQueueStats> {
    try {
      const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
        this.queue.isPaused(),
      ]);

      const total = waiting + active + completed + failed + delayed;

      // Calculate processing rate (jobs completed in last hour)
      const processingRate = await this.calculateProcessingRate();

      // Calculate average processing time
      const averageProcessingTime = await this.calculateAverageProcessingTime();

      // Calculate error rate
      const errorRate = total > 0 ? (failed / total) * 100 : 0;

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: 0, // Bull uses number for paused count
        total,
        isPaused: paused,
        processingRate,
        averageProcessingTime,
        errorRate: Math.round(errorRate * 100) / 100,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get queue stats: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get jobs by status with detailed information
   */
  async getJobs(
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    limit = 10,
  ): Promise<MonitorJobInfo[]> {
    try {
      const jobs = await this.queue.getJobs([status], 0, limit - 1);

      return Promise.all(
        jobs.map(async job => {
          const state = await job.getState();
          return {
            id: job.id,
            name: job.name,
            data: job.data,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            failedReason: job.failedReason,
            attemptsMade: job.attemptsMade,
            delay: job.delay,
            priority: job.opts?.priority,
            state,
            progress: job.progress() as number,
            stacktrace: job.stacktrace,
          };
        }),
      );
    } catch (error: any) {
      this.logger.error(`Failed to get ${status} jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get failed jobs with details
   */
  async getFailedJobs(limit = 20): Promise<MonitorJobInfo[]> {
    return this.getJobs('failed', limit);
  }

  /**
   * Get job by ID with full details
   */
  async getJobById(jobId: string | number): Promise<MonitorJobInfo | null> {
    try {
      const job = await this.queue.getJob(jobId);

      if (!job) {
        return null;
      }

      const state = await job.getState();

      return {
        id: job.id,
        name: job.name,
        data: job.data,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        delay: job.delay,
        priority: job.opts?.priority,
        state,
        progress: job.progress() as number,
        stacktrace: job.stacktrace,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get job ${jobId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Retry a single failed job
   */
  async retryJob(jobId: string | number): Promise<{ success: boolean; jobId: string | number }> {
    try {
      const job = await this.queue.getJob(jobId);

      if (!job) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }

      const state = await job.getState();

      if (state !== 'failed') {
        this.logger.warn(`Job ${jobId} is not in failed state (current: ${state})`);
        throw new Error(`Job is not in failed state. Current state: ${state}`);
      }

      await job.retry();

      this.logger.log(`Successfully retried job ${jobId}`);

      return { success: true, jobId: job.id };
    } catch (error: any) {
      this.logger.error(`Failed to retry job ${jobId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Retry all failed jobs
   */
  async retryAllFailed(): Promise<{ retried: number; failed: number }> {
    try {
      const failedJobs = await this.queue.getFailed();
      let retriedCount = 0;
      let failedCount = 0;

      this.logger.log(`Attempting to retry ${failedJobs.length} failed jobs`);

      for (const job of failedJobs) {
        try {
          await job.retry();
          retriedCount++;
        } catch (error: any) {
          this.logger.warn(`Failed to retry job ${job.id}: ${error.message}`);
          failedCount++;
        }
      }

      this.logger.log(`Retry complete: ${retriedCount} succeeded, ${failedCount} failed`);

      return { retried: retriedCount, failed: failedCount };
    } catch (error: any) {
      this.logger.error(`Failed to retry all failed jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Clean completed jobs older than the specified grace period
   * @param grace Grace period in milliseconds (default: 1 hour)
   */
  async cleanCompleted(grace: number = 3600000): Promise<number> {
    try {
      const jobs = await this.queue.clean(grace, 'completed');
      const count = jobs.length;

      this.logger.log(`Cleaned ${count} completed jobs older than ${grace}ms`);

      return count;
    } catch (error: any) {
      this.logger.error(`Failed to clean completed jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Clean failed jobs older than the specified grace period
   * @param grace Grace period in milliseconds (default: 7 days)
   */
  async cleanFailed(grace: number = 7 * 24 * 3600000): Promise<number> {
    try {
      const jobs = await this.queue.clean(grace, 'failed');
      const count = jobs.length;

      this.logger.log(`Cleaned ${count} failed jobs older than ${grace}ms`);

      return count;
    } catch (error: any) {
      this.logger.error(`Failed to clean failed jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(): Promise<void> {
    try {
      await this.queue.pause();
      this.logger.log('Notification queue paused');
    } catch (error: any) {
      this.logger.error(`Failed to pause queue: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    try {
      await this.queue.resume();
      this.logger.log('Notification queue resumed');
    } catch (error: any) {
      this.logger.error(`Failed to resume queue: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get worker metrics (if available)
   * Note: Bull doesn't provide direct worker access, this is a placeholder
   */
  async getWorkerMetrics(): Promise<WorkerMetrics[]> {
    try {
      // Bull doesn't expose workers directly in the Queue interface
      // This would require access to the underlying Redis connection
      // For now, we return basic status based on queue state
      const isPaused = await this.queue.isPaused();
      const activeCount = await this.queue.getActiveCount();

      return [
        {
          name: 'notification-worker',
          isRunning: !isPaused,
          isActive: activeCount > 0,
          isIdle: activeCount === 0 && !isPaused,
        },
      ];
    } catch (error: any) {
      this.logger.error(`Failed to get worker metrics: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Get queue health status with analysis
   */
  async getQueueHealthStatus(): Promise<QueueHealthStatus> {
    try {
      const stats = await this.getQueueStats();
      const issues: string[] = [];
      const recommendations: string[] = [];
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';

      // Check for high number of failed jobs
      if (stats.failed > 50) {
        issues.push(`High number of failed jobs: ${stats.failed}`);
        recommendations.push('Review failed jobs and investigate common failure patterns');
        status = 'warning';
      }

      if (stats.failed > 100) {
        status = 'critical';
      }

      // Check for high number of active jobs (potential bottleneck)
      if (stats.active > 100) {
        issues.push(`High number of active jobs: ${stats.active}`);
        recommendations.push('Consider scaling workers or optimizing job processing');
        if (status === 'healthy') status = 'warning';
      }

      if (stats.active > 500) {
        status = 'critical';
      }

      // Check for high number of waiting jobs (backlog)
      if (stats.waiting > 1000) {
        issues.push(`Large backlog of waiting jobs: ${stats.waiting}`);
        recommendations.push('Increase worker capacity or optimize job processing rate');
        if (status === 'healthy') status = 'warning';
      }

      if (stats.waiting > 5000) {
        status = 'critical';
      }

      // Check if queue is paused
      if (stats.isPaused) {
        issues.push('Queue is paused');
        recommendations.push('Resume queue processing if pause was not intentional');
        if (status === 'healthy') status = 'warning';
      }

      // Check error rate
      if (stats.errorRate && stats.errorRate > 5) {
        issues.push(`High error rate: ${stats.errorRate.toFixed(2)}%`);
        recommendations.push('Investigate common failure causes and improve error handling');
        if (status === 'healthy') status = 'warning';
      }

      if (stats.errorRate && stats.errorRate > 20) {
        status = 'critical';
      }

      const isHealthy = status === 'healthy';

      return {
        isHealthy,
        status,
        issues,
        recommendations,
        metrics: {
          failedJobsCount: stats.failed,
          activeJobsCount: stats.active,
          waitingJobsCount: stats.waiting,
          delayedJobsCount: stats.delayed,
          stalledJobsCount: 0, // Would need to track stalled jobs separately
        },
      };
    } catch (error: any) {
      this.logger.error(`Failed to get queue health status: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Calculate processing rate (jobs completed per hour)
   */
  private async calculateProcessingRate(): Promise<number> {
    try {
      const oneHourAgo = Date.now() - 3600000;
      const completedJobs = await this.queue.getJobs(['completed'], 0, 1000);

      const recentlyCompleted = completedJobs.filter(
        job => job.finishedOn && job.finishedOn >= oneHourAgo,
      );

      return recentlyCompleted.length;
    } catch (error: any) {
      this.logger.warn(`Failed to calculate processing rate: ${error.message}`);
      return 0;
    }
  }

  /**
   * Calculate average processing time in milliseconds
   */
  private async calculateAverageProcessingTime(): Promise<number> {
    try {
      const completedJobs = await this.queue.getJobs(['completed'], 0, 100);

      const processingTimes = completedJobs
        .filter(job => job.processedOn && job.finishedOn)
        .map(job => job.finishedOn! - job.processedOn!);

      if (processingTimes.length === 0) {
        return 0;
      }

      const sum = processingTimes.reduce((acc, time) => acc + time, 0);
      return Math.round(sum / processingTimes.length);
    } catch (error: any) {
      this.logger.warn(`Failed to calculate average processing time: ${error.message}`);
      return 0;
    }
  }

  /**
   * Remove a specific job by ID
   */
  async removeJob(jobId: string | number): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);

      if (!job) {
        throw new NotFoundException(`Job ${jobId} not found`);
      }

      await job.remove();
      this.logger.log(`Removed job ${jobId}`);
    } catch (error: any) {
      this.logger.error(`Failed to remove job ${jobId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get job counts by status
   */
  async getJobCounts(): Promise<JobCounts> {
    try {
      return await this.queue.getJobCounts();
    } catch (error: any) {
      this.logger.error(`Failed to get job counts: ${error.message}`, error.stack);
      throw error;
    }
  }
}
