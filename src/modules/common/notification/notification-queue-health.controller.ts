import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NotificationQueueHealthIndicator } from './notification-queue.health';
import { Public } from '../auth/decorators/public.decorator';
import { AuthGuard } from '../auth/auth.guard';

/**
 * Notification Queue Health Check Controller
 * Provides health check endpoints for monitoring systems and orchestrators
 */
@ApiTags('Notification Queue Health')
@Controller('health/notification-queue')
export class NotificationQueueHealthController {
  private readonly logger = new Logger(NotificationQueueHealthController.name);

  constructor(private readonly notificationQueueHealth: NotificationQueueHealthIndicator) {}

  /**
   * GET /health/notification-queue
   * Basic health check endpoint (can be public for k8s/monitoring)
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Basic notification queue health check' })
  @ApiResponse({
    status: 200,
    description: 'Health check completed',
  })
  async check(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    try {
      const result = await this.notificationQueueHealth.isHealthy('notification-queue');

      const queueHealth = result['notification-queue'];
      const isHealthy = queueHealth.status === 'up';

      return {
        success: isHealthy,
        data: result,
        message: isHealthy ? 'Notification queue is healthy' : 'Notification queue is unhealthy',
      };
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`, error.stack);
      return {
        success: false,
        data: {
          'notification-queue': {
            status: 'down',
            error: error.message,
          },
        },
        message: 'Health check failed',
      };
    }
  }

  /**
   * GET /health/notification-queue/detailed
   * Detailed health check with recommendations
   */
  @Get('detailed')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Detailed notification queue health check' })
  @ApiResponse({
    status: 200,
    description: 'Detailed health check completed',
  })
  async detailedCheck(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    try {
      const result = await this.notificationQueueHealth.getDetailedHealthStatus();

      return {
        success: result.isHealthy,
        data: result,
        message: `Queue status: ${result.status}`,
      };
    } catch (error: any) {
      this.logger.error(`Detailed health check failed: ${error.message}`, error.stack);
      return {
        success: false,
        data: {
          isHealthy: false,
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error.message,
        },
        message: 'Detailed health check failed',
      };
    }
  }

  /**
   * GET /health/notification-queue/deep
   * Deep health check including connectivity and responsiveness
   */
  @Get('deep')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Deep notification queue health check' })
  @ApiResponse({
    status: 200,
    description: 'Deep health check completed',
  })
  async deepCheck(): Promise<{
    success: boolean;
    data: any;
    message: string;
  }> {
    try {
      const result = await this.notificationQueueHealth.performDeepHealthCheck();

      return {
        success: result.isHealthy,
        data: result,
        message: result.isHealthy
          ? 'All deep health checks passed'
          : 'Some deep health checks failed',
      };
    } catch (error: any) {
      this.logger.error(`Deep health check failed: ${error.message}`, error.stack);
      return {
        success: false,
        data: {
          isHealthy: false,
          error: error.message,
        },
        message: 'Deep health check failed',
      };
    }
  }

  /**
   * GET /health/notification-queue/liveness
   * Liveness probe for Kubernetes (minimal check)
   */
  @Public()
  @Get('liveness')
  @ApiOperation({ summary: 'Liveness probe for orchestrators' })
  @ApiResponse({
    status: 200,
    description: 'Service is alive',
  })
  async liveness(): Promise<{
    status: string;
    timestamp: string;
  }> {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /health/notification-queue/readiness
   * Readiness probe for Kubernetes (checks if queue is ready to process)
   */
  @Public()
  @Get('readiness')
  @ApiOperation({ summary: 'Readiness probe for orchestrators' })
  @ApiResponse({
    status: 200,
    description: 'Service is ready',
  })
  @ApiResponse({
    status: 503,
    description: 'Service is not ready',
  })
  async readiness(): Promise<{
    status: string;
    ready: boolean;
    timestamp: string;
  }> {
    try {
      const result = await this.notificationQueueHealth.isHealthy('notification-queue');
      const queueHealth = result['notification-queue'];
      const isReady = queueHealth.status === 'up' && !queueHealth.paused;

      return {
        status: isReady ? 'ready' : 'not-ready',
        ready: isReady,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`Readiness check failed: ${error.message}`, error.stack);
      return {
        status: 'not-ready',
        ready: false,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
