import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobCounts } from 'bull';
import { NotificationJobData } from './notification-queue.processor';

/**
 * Health indicator result interface
 * Matches the structure expected by NestJS Terminus or custom health check implementations
 */
export interface HealthIndicatorResult {
  [key: string]: {
    status: 'up' | 'down';
    [key: string]: any;
  };
}

/**
 * Notification Queue Health Indicator
 * Provides health check functionality for the notification queue
 * Can be used with @nestjs/terminus or custom health check implementations
 */
@Injectable()
export class NotificationQueueHealthIndicator {
  private readonly logger = new Logger(NotificationQueueHealthIndicator.name);

  constructor(@InjectQueue('notification') private queue: Queue<NotificationJobData>) {}

  /**
   * Check if the notification queue is healthy
   *
   * Health criteria:
   * - Active jobs < 100 (not overloaded)
   * - Failed jobs < 50 (acceptable failure rate)
   * - Queue is not paused (unless intentional)
   * - Waiting jobs < 1000 (no severe backlog)
   *
   * @param key The key to use in the health check result
   * @returns Health indicator result
   */
  async isHealthy(key: string = 'notification-queue'): Promise<HealthIndicatorResult> {
    try {
      const stats = await this.getQueueJobCounts();

      // Health check criteria
      const isActiveHealthy = stats.active < 100;
      const isFailedHealthy = stats.failed < 50;
      const isWaitingHealthy = stats.waiting < 1000;
      const isPausedHealthy = !stats.paused;

      const isHealthy = isActiveHealthy && isFailedHealthy && isWaitingHealthy && isPausedHealthy;

      const status = isHealthy ? 'up' : 'down';

      // Build detailed health information
      const result: HealthIndicatorResult = {
        [key]: {
          status,
          active: stats.active,
          waiting: stats.waiting,
          completed: stats.completed,
          failed: stats.failed,
          delayed: stats.delayed,
          paused: stats.paused,
          checks: {
            activeJobsHealthy: isActiveHealthy,
            failedJobsHealthy: isFailedHealthy,
            waitingJobsHealthy: isWaitingHealthy,
            queueNotPaused: isPausedHealthy,
          },
          thresholds: {
            maxActiveJobs: 100,
            maxFailedJobs: 50,
            maxWaitingJobs: 1000,
          },
        },
      };

      if (!isHealthy) {
        this.logger.warn(`Notification queue health check failed: ${JSON.stringify(result)}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`, error.stack);

      return {
        [key]: {
          status: 'down',
          error: error.message,
          message: 'Failed to retrieve queue health status',
        },
      };
    }
  }

  /**
   * Get queue job counts
   * @returns Job counts for all states
   */
  private async getQueueJobCounts(): Promise<JobCounts & { paused: boolean }> {
    try {
      const [jobCounts, isPaused] = await Promise.all([
        this.queue.getJobCounts(),
        this.queue.isPaused(),
      ]);

      return {
        ...jobCounts,
        paused: isPaused,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get job counts: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get detailed health status
   * Provides more comprehensive health information than isHealthy
   *
   * @returns Detailed health status
   */
  async getDetailedHealthStatus(): Promise<{
    isHealthy: boolean;
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    metrics: JobCounts & { paused: boolean };
    issues: string[];
    recommendations: string[];
  }> {
    try {
      const stats = await this.getQueueJobCounts();
      const issues: string[] = [];
      const recommendations: string[] = [];

      // Analyze health
      if (stats.active > 100) {
        issues.push(`High number of active jobs: ${stats.active}`);
        if (stats.active > 500) {
          recommendations.push('Critical: Scale workers immediately or optimize processing');
        } else {
          recommendations.push('Warning: Consider scaling workers or optimizing job processing');
        }
      }

      if (stats.failed > 50) {
        issues.push(`High number of failed jobs: ${stats.failed}`);
        if (stats.failed > 100) {
          recommendations.push('Critical: Investigate and fix job failures immediately');
        } else {
          recommendations.push('Warning: Review failed jobs and investigate common patterns');
        }
      }

      if (stats.waiting > 1000) {
        issues.push(`Large backlog of waiting jobs: ${stats.waiting}`);
        if (stats.waiting > 5000) {
          recommendations.push('Critical: Increase worker capacity urgently');
        } else {
          recommendations.push('Warning: Increase worker capacity or optimize processing rate');
        }
      }

      if (stats.paused) {
        issues.push('Queue is paused');
        recommendations.push('Resume queue processing if pause was not intentional');
      }

      // Determine overall status
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (issues.length === 0) {
        status = 'healthy';
      } else if (stats.active > 500 || stats.failed > 100 || stats.waiting > 5000) {
        status = 'unhealthy';
      } else {
        status = 'degraded';
      }

      const isHealthy = status === 'healthy';

      return {
        isHealthy,
        status,
        timestamp: new Date().toISOString(),
        metrics: stats,
        issues,
        recommendations,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get detailed health status: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Perform a deep health check
   * Includes connectivity test and queue responsiveness
   *
   * @returns Deep health check result
   */
  async performDeepHealthCheck(): Promise<{
    isHealthy: boolean;
    checks: {
      queueConnectivity: boolean;
      queueResponsive: boolean;
      metricsAvailable: boolean;
    };
    metrics?: JobCounts & { paused: boolean };
    error?: string;
  }> {
    const checks = {
      queueConnectivity: false,
      queueResponsive: false,
      metricsAvailable: false,
    };

    try {
      // Test 1: Can we connect to the queue?
      const client = await this.queue.client;
      if (client) {
        checks.queueConnectivity = true;
      }

      // Test 2: Can we get queue stats (responsiveness)?
      const startTime = Date.now();
      const stats = await this.getQueueJobCounts();
      const responseTime = Date.now() - startTime;

      if (responseTime < 5000) {
        // 5 second timeout
        checks.queueResponsive = true;
      }

      // Test 3: Are metrics available and valid?
      if (
        typeof stats.active === 'number' &&
        typeof stats.waiting === 'number' &&
        typeof stats.failed === 'number'
      ) {
        checks.metricsAvailable = true;
      }

      const isHealthy = Object.values(checks).every(check => check === true);

      return {
        isHealthy,
        checks,
        metrics: stats,
      };
    } catch (error: any) {
      this.logger.error(`Deep health check failed: ${error.message}`, error.stack);

      return {
        isHealthy: false,
        checks,
        error: error.message,
      };
    }
  }
}
