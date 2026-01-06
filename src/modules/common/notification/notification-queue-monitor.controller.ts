import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import {
  NotificationQueueMonitorService,
  EnhancedQueueStats,
  MonitorJobInfo,
  WorkerMetrics,
  QueueHealthStatus,
} from './notification-queue-monitor.service';

/**
 * Notification Queue Monitoring Controller
 * Provides comprehensive monitoring, health checks, and management endpoints
 * for the notification queue system
 */
@ApiTags('Notification Queue Monitoring')
@Controller('notifications/queue/monitor')
@UseGuards(AuthGuard)
export class NotificationQueueMonitorController {
  private readonly logger = new Logger(NotificationQueueMonitorController.name);

  constructor(private readonly monitorService: NotificationQueueMonitorService) {}

  /**
   * GET /notifications/queue/monitor/stats
   * Get comprehensive queue statistics with metrics
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get comprehensive queue statistics' })
  @ApiResponse({
    status: 200,
    description: 'Queue statistics retrieved successfully',
  })
  async getStats(): Promise<{
    success: boolean;
    data: EnhancedQueueStats;
    message: string;
  }> {
    try {
      const stats = await this.monitorService.getQueueStats();

      return {
        success: true,
        data: stats,
        message: 'Queue statistics retrieved successfully',
      };
    } catch (error: any) {
      this.logger.error(`Failed to get queue stats: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/monitor/health
   * Get queue health status with analysis
   */
  @Get('health')
  @ApiOperation({ summary: 'Get queue health status' })
  @ApiResponse({
    status: 200,
    description: 'Queue health status retrieved successfully',
  })
  async getHealth(): Promise<{
    success: boolean;
    data: QueueHealthStatus;
    message: string;
  }> {
    try {
      const health = await this.monitorService.getQueueHealthStatus();

      return {
        success: true,
        data: health,
        message: `Queue health status: ${health.status}`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get queue health: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/monitor/jobs/:status
   * Get jobs by status with detailed information
   */
  @Get('jobs/:status')
  @ApiOperation({ summary: 'Get jobs by status' })
  @ApiParam({
    name: 'status',
    enum: ['waiting', 'active', 'completed', 'failed', 'delayed'],
    description: 'Job status to filter by',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of jobs to return (default: 10)',
  })
  @ApiResponse({
    status: 200,
    description: 'Jobs retrieved successfully',
  })
  async getJobs(
    @Param('status') status: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<{
    success: boolean;
    data: MonitorJobInfo[];
    meta: {
      status: string;
      count: number;
      limit: number;
    };
    message: string;
  }> {
    try {
      // Validate status
      const validStatuses = ['waiting', 'active', 'completed', 'failed', 'delayed'];
      if (!validStatuses.includes(status)) {
        throw new BadRequestException(
          `Invalid status: ${status}. Valid statuses: ${validStatuses.join(', ')}`,
        );
      }

      const jobLimit = limit || 10;
      const jobs = await this.monitorService.getJobs(status as any, jobLimit);

      return {
        success: true,
        data: jobs,
        meta: {
          status,
          count: jobs.length,
          limit: jobLimit,
        },
        message: `Retrieved ${jobs.length} ${status} jobs`,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to get jobs with status ${status}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/monitor/failed
   * Get failed jobs with details
   */
  @Get('failed')
  @ApiOperation({ summary: 'Get failed jobs with details' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of jobs to return (default: 20)',
  })
  @ApiResponse({
    status: 200,
    description: 'Failed jobs retrieved successfully',
  })
  async getFailedJobs(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<{
    success: boolean;
    data: MonitorJobInfo[];
    meta: {
      count: number;
      limit: number;
    };
    message: string;
  }> {
    try {
      const jobLimit = limit || 20;
      const jobs = await this.monitorService.getFailedJobs(jobLimit);

      return {
        success: true,
        data: jobs,
        meta: {
          count: jobs.length,
          limit: jobLimit,
        },
        message: `Retrieved ${jobs.length} failed jobs`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get failed jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/monitor/job/:id
   * Get detailed job information by ID
   */
  @Get('job/:id')
  @ApiOperation({ summary: 'Get detailed job information by ID' })
  @ApiParam({
    name: 'id',
    description: 'Job ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Job details retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Job not found',
  })
  async getJobById(@Param('id') id: string): Promise<{
    success: boolean;
    data: MonitorJobInfo | null;
    message: string;
  }> {
    try {
      const job = await this.monitorService.getJobById(id);

      if (!job) {
        return {
          success: false,
          data: null,
          message: `Job ${id} not found`,
        };
      }

      return {
        success: true,
        data: job,
        message: 'Job details retrieved successfully',
      };
    } catch (error: any) {
      this.logger.error(`Failed to get job ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/monitor/retry/:id
   * Retry a failed job by ID
   */
  @Post('retry/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed job' })
  @ApiParam({
    name: 'id',
    description: 'Job ID to retry',
  })
  @ApiResponse({
    status: 200,
    description: 'Job retried successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Job not found',
  })
  async retryJob(@Param('id') id: string): Promise<{
    success: boolean;
    data: {
      jobId: string | number;
    };
    message: string;
  }> {
    try {
      const result = await this.monitorService.retryJob(id);

      return {
        success: result.success,
        data: {
          jobId: result.jobId,
        },
        message: `Job ${id} retried successfully`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to retry job ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/monitor/retry-all
   * Retry all failed jobs
   */
  @Post('retry-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry all failed jobs' })
  @ApiResponse({
    status: 200,
    description: 'Failed jobs retried successfully',
  })
  async retryAll(): Promise<{
    success: boolean;
    data: {
      retried: number;
      failed: number;
    };
    message: string;
  }> {
    try {
      const result = await this.monitorService.retryAllFailed();

      return {
        success: true,
        data: result,
        message: `Retried ${result.retried} failed jobs (${result.failed} failed to retry)`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to retry all failed jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/monitor/pause
   * Pause queue processing
   */
  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause queue processing' })
  @ApiResponse({
    status: 200,
    description: 'Queue paused successfully',
  })
  async pause(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.monitorService.pauseQueue();

      return {
        success: true,
        message: 'Queue paused successfully',
      };
    } catch (error: any) {
      this.logger.error(`Failed to pause queue: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/monitor/resume
   * Resume queue processing
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume queue processing' })
  @ApiResponse({
    status: 200,
    description: 'Queue resumed successfully',
  })
  async resume(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.monitorService.resumeQueue();

      return {
        success: true,
        message: 'Queue resumed successfully',
      };
    } catch (error: any) {
      this.logger.error(`Failed to resume queue: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/monitor/clean/completed
   * Clean completed jobs older than grace period
   */
  @Post('clean/completed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clean old completed jobs' })
  @ApiQuery({
    name: 'grace',
    required: false,
    type: Number,
    description: 'Grace period in milliseconds (default: 1 hour)',
  })
  @ApiResponse({
    status: 200,
    description: 'Completed jobs cleaned successfully',
  })
  async cleanCompleted(
    @Query('grace', new ParseIntPipe({ optional: true })) grace?: number,
  ): Promise<{
    success: boolean;
    data: {
      cleaned: number;
      gracePeriod: number;
    };
    message: string;
  }> {
    try {
      const gracePeriod = grace || 3600000; // 1 hour default
      const cleaned = await this.monitorService.cleanCompleted(gracePeriod);

      return {
        success: true,
        data: {
          cleaned,
          gracePeriod,
        },
        message: `Cleaned ${cleaned} completed jobs older than ${gracePeriod}ms`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to clean completed jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/monitor/clean/failed
   * Clean failed jobs older than grace period
   */
  @Post('clean/failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clean old failed jobs' })
  @ApiQuery({
    name: 'grace',
    required: false,
    type: Number,
    description: 'Grace period in milliseconds (default: 7 days)',
  })
  @ApiResponse({
    status: 200,
    description: 'Failed jobs cleaned successfully',
  })
  async cleanFailed(@Query('grace', new ParseIntPipe({ optional: true })) grace?: number): Promise<{
    success: boolean;
    data: {
      cleaned: number;
      gracePeriod: number;
    };
    message: string;
  }> {
    try {
      const gracePeriod = grace || 7 * 24 * 3600000; // 7 days default
      const cleaned = await this.monitorService.cleanFailed(gracePeriod);

      return {
        success: true,
        data: {
          cleaned,
          gracePeriod,
        },
        message: `Cleaned ${cleaned} failed jobs older than ${gracePeriod}ms`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to clean failed jobs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * DELETE /notifications/queue/monitor/job/:id
   * Remove a specific job by ID
   */
  @Delete('job/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a specific job' })
  @ApiParam({
    name: 'id',
    description: 'Job ID to remove',
  })
  @ApiResponse({
    status: 200,
    description: 'Job removed successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Job not found',
  })
  async removeJob(@Param('id') id: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.monitorService.removeJob(id);

      return {
        success: true,
        message: `Job ${id} removed successfully`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to remove job ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/monitor/workers
   * Get worker metrics and status
   */
  @Get('workers')
  @ApiOperation({ summary: 'Get worker metrics and status' })
  @ApiResponse({
    status: 200,
    description: 'Worker metrics retrieved successfully',
  })
  async getWorkerMetrics(): Promise<{
    success: boolean;
    data: WorkerMetrics[];
    message: string;
  }> {
    try {
      const workers = await this.monitorService.getWorkerMetrics();

      return {
        success: true,
        data: workers,
        message: 'Worker metrics retrieved successfully',
      };
    } catch (error: any) {
      this.logger.error(`Failed to get worker metrics: ${error.message}`, error.stack);
      throw error;
    }
  }
}
