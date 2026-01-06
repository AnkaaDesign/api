/**
 * Queue Monitoring Integration Examples
 *
 * This file demonstrates how to integrate the notification queue monitoring system
 * into your application's health checks, alerts, and monitoring pipelines.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationQueueMonitorService } from '../notification-queue-monitor.service';
import { NotificationQueueHealthIndicator } from '../notification-queue.health';

/**
 * Example 1: Scheduled Health Monitoring
 * Automatically monitors queue health and sends alerts
 */
@Injectable()
export class QueueHealthMonitoringService {
  private readonly logger = new Logger(QueueHealthMonitoringService.name);

  constructor(
    private readonly monitorService: NotificationQueueMonitorService,
    private readonly healthIndicator: NotificationQueueHealthIndicator,
  ) {}

  /**
   * Run health check every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async performScheduledHealthCheck(): Promise<void> {
    try {
      const health = await this.healthIndicator.getDetailedHealthStatus();

      if (!health.isHealthy) {
        this.logger.warn(`Queue health degraded: ${health.status}`);
        this.logger.warn(`Issues: ${health.issues.join(', ')}`);

        // Send alert (integrate with your alerting system)
        await this.sendAlert({
          severity: health.status === 'unhealthy' ? 'critical' : 'warning',
          title: 'Notification Queue Health Alert',
          message: `Queue status: ${health.status}`,
          issues: health.issues,
          recommendations: health.recommendations,
          metrics: health.metrics,
        });
      } else {
        this.logger.debug('Queue health check passed');
      }
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Send alert to monitoring system
   */
  private async sendAlert(alert: {
    severity: 'warning' | 'critical';
    title: string;
    message: string;
    issues: string[];
    recommendations: string[];
    metrics: any;
  }): Promise<void> {
    // Example: Send to Slack
    // await this.slackService.sendAlert(alert);

    // Example: Send to PagerDuty
    // await this.pagerDutyService.createIncident(alert);

    // Example: Send to email
    // await this.emailService.sendAdminAlert(alert);

    this.logger.warn(`Alert would be sent: ${JSON.stringify(alert, null, 2)}`);
  }
}

/**
 * Example 2: Automated Queue Cleanup
 * Regularly cleans old jobs to prevent memory issues
 */
@Injectable()
export class QueueCleanupService {
  private readonly logger = new Logger(QueueCleanupService.name);

  constructor(private readonly monitorService: NotificationQueueMonitorService) {}

  /**
   * Clean completed jobs daily at 2 AM
   */
  @Cron('0 2 * * *')
  async cleanCompletedJobs(): Promise<void> {
    try {
      const oneDayInMs = 24 * 60 * 60 * 1000;
      const cleaned = await this.monitorService.cleanCompleted(oneDayInMs);

      this.logger.log(`Daily cleanup: Removed ${cleaned} completed jobs older than 24 hours`);
    } catch (error: any) {
      this.logger.error(`Failed to clean completed jobs: ${error.message}`, error.stack);
    }
  }

  /**
   * Clean failed jobs weekly on Sunday at 3 AM
   */
  @Cron('0 3 * * 0')
  async cleanFailedJobs(): Promise<void> {
    try {
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
      const cleaned = await this.monitorService.cleanFailed(sevenDaysInMs);

      this.logger.log(`Weekly cleanup: Removed ${cleaned} failed jobs older than 7 days`);
    } catch (error: any) {
      this.logger.error(`Failed to clean failed jobs: ${error.message}`, error.stack);
    }
  }
}

/**
 * Example 3: Metrics Collection for External Monitoring
 * Exports metrics for Prometheus, Grafana, etc.
 */
@Injectable()
export class QueueMetricsExporter {
  private readonly logger = new Logger(QueueMetricsExporter.name);

  constructor(private readonly monitorService: NotificationQueueMonitorService) {}

  /**
   * Get metrics in Prometheus format
   */
  async getPrometheusMetrics(): Promise<string> {
    try {
      const stats = await this.monitorService.getQueueStats();

      const metrics = [
        `# HELP notification_queue_waiting Number of waiting jobs`,
        `# TYPE notification_queue_waiting gauge`,
        `notification_queue_waiting ${stats.waiting}`,
        '',
        `# HELP notification_queue_active Number of active jobs`,
        `# TYPE notification_queue_active gauge`,
        `notification_queue_active ${stats.active}`,
        '',
        `# HELP notification_queue_completed Number of completed jobs`,
        `# TYPE notification_queue_completed gauge`,
        `notification_queue_completed ${stats.completed}`,
        '',
        `# HELP notification_queue_failed Number of failed jobs`,
        `# TYPE notification_queue_failed gauge`,
        `notification_queue_failed ${stats.failed}`,
        '',
        `# HELP notification_queue_delayed Number of delayed jobs`,
        `# TYPE notification_queue_delayed gauge`,
        `notification_queue_delayed ${stats.delayed}`,
        '',
        `# HELP notification_queue_processing_rate Jobs processed per hour`,
        `# TYPE notification_queue_processing_rate gauge`,
        `notification_queue_processing_rate ${stats.processingRate || 0}`,
        '',
        `# HELP notification_queue_average_processing_time Average processing time in milliseconds`,
        `# TYPE notification_queue_average_processing_time gauge`,
        `notification_queue_average_processing_time ${stats.averageProcessingTime || 0}`,
        '',
        `# HELP notification_queue_error_rate Error rate percentage`,
        `# TYPE notification_queue_error_rate gauge`,
        `notification_queue_error_rate ${stats.errorRate || 0}`,
        '',
        `# HELP notification_queue_paused Queue paused status (1=paused, 0=running)`,
        `# TYPE notification_queue_paused gauge`,
        `notification_queue_paused ${stats.isPaused ? 1 : 0}`,
      ];

      return metrics.join('\n');
    } catch (error: any) {
      this.logger.error(`Failed to export metrics: ${error.message}`, error.stack);
      return '# Error exporting metrics';
    }
  }

  /**
   * Get metrics in JSON format
   */
  async getJsonMetrics(): Promise<any> {
    try {
      const stats = await this.monitorService.getQueueStats();
      const health = await this.monitorService.getQueueHealthStatus();

      return {
        timestamp: new Date().toISOString(),
        queue: {
          stats,
          health: {
            isHealthy: health.isHealthy,
            status: health.status,
            issues: health.issues,
          },
        },
      };
    } catch (error: any) {
      this.logger.error(`Failed to get JSON metrics: ${error.message}`, error.stack);
      return {
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }
}

/**
 * Example 4: Failed Job Analysis and Auto-Recovery
 * Analyzes failed jobs and attempts smart recovery
 */
@Injectable()
export class FailedJobAnalysisService {
  private readonly logger = new Logger(FailedJobAnalysisService.name);

  constructor(private readonly monitorService: NotificationQueueMonitorService) {}

  /**
   * Analyze failed jobs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async analyzeFailedJobs(): Promise<void> {
    try {
      const failedJobs = await this.monitorService.getFailedJobs(100);

      if (failedJobs.length === 0) {
        this.logger.debug('No failed jobs to analyze');
        return;
      }

      // Group by failure reason
      const failureReasons = new Map<string, number>();
      const failuresByChannel = new Map<string, number>();

      for (const job of failedJobs) {
        const reason = job.failedReason || 'Unknown';
        const channel = job.data.channel;

        failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
        failuresByChannel.set(channel, (failuresByChannel.get(channel) || 0) + 1);
      }

      // Log analysis
      this.logger.log(`Failed job analysis: ${failedJobs.length} total failures`);
      this.logger.log(`Failure reasons: ${JSON.stringify(Array.from(failureReasons.entries()))}`);
      this.logger.log(
        `Failures by channel: ${JSON.stringify(Array.from(failuresByChannel.entries()))}`,
      );

      // Determine if auto-recovery should be attempted
      const shouldAutoRecover = this.shouldAttemptAutoRecovery(failedJobs);

      if (shouldAutoRecover) {
        this.logger.log('Attempting auto-recovery of failed jobs');
        await this.attemptAutoRecovery(failedJobs);
      } else {
        this.logger.warn('Auto-recovery criteria not met, manual intervention required');
      }
    } catch (error: any) {
      this.logger.error(`Failed job analysis failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Determine if auto-recovery should be attempted
   */
  private shouldAttemptAutoRecovery(failedJobs: any[]): boolean {
    // Don't auto-recover if there are too many failures
    if (failedJobs.length > 200) {
      return false;
    }

    // Check if failures are recent (within last hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentFailures = failedJobs.filter(job => job.failedReason && job.timestamp > oneHourAgo);

    // Don't auto-recover if most failures are recent (might be systemic issue)
    if (recentFailures.length > failedJobs.length * 0.8) {
      return false;
    }

    return true;
  }

  /**
   * Attempt auto-recovery of failed jobs
   */
  private async attemptAutoRecovery(failedJobs: any[]): Promise<void> {
    let recovered = 0;
    let failed = 0;

    for (const job of failedJobs) {
      try {
        // Only retry jobs that failed less than 3 times
        if (job.attemptsMade < 3) {
          await this.monitorService.retryJob(job.id);
          recovered++;
        }
      } catch (error: any) {
        this.logger.warn(`Failed to retry job ${job.id}: ${error.message}`);
        failed++;
      }
    }

    this.logger.log(`Auto-recovery complete: ${recovered} recovered, ${failed} failed`);
  }
}

/**
 * Example 5: Queue Performance Monitoring
 * Tracks and logs queue performance metrics
 */
@Injectable()
export class QueuePerformanceMonitor {
  private readonly logger = new Logger(QueuePerformanceMonitor.name);
  private performanceHistory: Array<{
    timestamp: Date;
    stats: any;
  }> = [];

  constructor(private readonly monitorService: NotificationQueueMonitorService) {}

  /**
   * Collect performance metrics every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async collectPerformanceMetrics(): Promise<void> {
    try {
      const stats = await this.monitorService.getQueueStats();

      this.performanceHistory.push({
        timestamp: new Date(),
        stats,
      });

      // Keep only last hour of data
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      this.performanceHistory = this.performanceHistory.filter(
        entry => entry.timestamp > oneHourAgo,
      );

      // Detect trends
      await this.detectPerformanceTrends();
    } catch (error: any) {
      this.logger.error(`Failed to collect performance metrics: ${error.message}`, error.stack);
    }
  }

  /**
   * Detect performance trends
   */
  private async detectPerformanceTrends(): Promise<void> {
    if (this.performanceHistory.length < 10) {
      return; // Not enough data
    }

    const recent = this.performanceHistory.slice(-10);
    const older = this.performanceHistory.slice(-20, -10);

    if (older.length === 0) {
      return;
    }

    // Calculate averages
    const recentAvgWaiting =
      recent.reduce((sum, entry) => sum + entry.stats.waiting, 0) / recent.length;
    const olderAvgWaiting =
      older.reduce((sum, entry) => sum + entry.stats.waiting, 0) / older.length;

    // Detect growing backlog
    if (recentAvgWaiting > olderAvgWaiting * 1.5) {
      this.logger.warn(
        `Growing backlog detected: ${olderAvgWaiting.toFixed(0)} → ${recentAvgWaiting.toFixed(0)}`,
      );
    }

    // Detect improving performance
    if (recentAvgWaiting < olderAvgWaiting * 0.5 && olderAvgWaiting > 100) {
      this.logger.log(
        `Queue performance improving: ${olderAvgWaiting.toFixed(0)} → ${recentAvgWaiting.toFixed(0)}`,
      );
    }
  }

  /**
   * Get performance report
   */
  async getPerformanceReport(): Promise<any> {
    if (this.performanceHistory.length === 0) {
      return { message: 'No performance data available' };
    }

    const stats = this.performanceHistory.map(entry => entry.stats);

    return {
      period: {
        start: this.performanceHistory[0].timestamp,
        end: this.performanceHistory[this.performanceHistory.length - 1].timestamp,
        dataPoints: this.performanceHistory.length,
      },
      averages: {
        waiting: stats.reduce((sum, s) => sum + s.waiting, 0) / stats.length,
        active: stats.reduce((sum, s) => sum + s.active, 0) / stats.length,
        failed: stats.reduce((sum, s) => sum + s.failed, 0) / stats.length,
        processingRate: stats.reduce((sum, s) => sum + (s.processingRate || 0), 0) / stats.length,
      },
      peaks: {
        waiting: Math.max(...stats.map(s => s.waiting)),
        active: Math.max(...stats.map(s => s.active)),
        failed: Math.max(...stats.map(s => s.failed)),
      },
    };
  }
}

/**
 * Example Module: Integration module for all monitoring services
 */
/*
import { Module } from '@nestjs/common';
import { NotificationQueueModule } from '../notification-queue.module';

@Module({
  imports: [NotificationQueueModule],
  providers: [
    QueueHealthMonitoringService,
    QueueCleanupService,
    QueueMetricsExporter,
    FailedJobAnalysisService,
    QueuePerformanceMonitor,
  ],
  exports: [
    QueueMetricsExporter,
    QueuePerformanceMonitor,
  ],
})
export class QueueMonitoringIntegrationModule {}
*/
