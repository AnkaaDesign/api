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
  BadRequestException,
  NotFoundException,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import {
  NotificationQueueService,
  JobStatusCleanInput,
  NotificationJobInfo,
  NotificationQueueStats,
} from './notification-queue.service';
import { Job } from 'bull';
import { NotificationJobData } from './notification-queue.processor';

/**
 * Notification Queue Controller
 * Provides monitoring and management endpoints for the notification queue
 */
@Controller('notifications/queue')
@UseGuards(AuthGuard)
export class NotificationQueueController {
  private readonly logger = new Logger(NotificationQueueController.name);

  constructor(private readonly notificationQueueService: NotificationQueueService) {}

  /**
   * GET /notifications/queue/stats
   * Get queue statistics (active, waiting, completed, failed, delayed jobs)
   */
  @Get('stats')
  async getQueueStats(): Promise<{
    success: boolean;
    data: NotificationQueueStats;
    message: string;
  }> {
    try {
      const stats = await this.notificationQueueService.getQueueStats();

      return {
        success: true,
        data: stats,
        message: 'Estatísticas da fila de notificações obtidas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao obter estatísticas da fila:', error);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/jobs
   * List jobs by state with pagination
   */
  @Get('jobs')
  async getJobs(
    @Query('state') state?: string,
    @Query('start', new ParseIntPipe({ optional: true })) start?: number,
    @Query('end', new ParseIntPipe({ optional: true })) end?: number,
  ): Promise<{
    success: boolean;
    data: NotificationJobInfo[];
    message: string;
    meta: {
      start: number;
      end: number;
      count: number;
    };
  }> {
    try {
      // Parse states from comma-separated string or use defaults
      const validStates: Array<'active' | 'waiting' | 'delayed' | 'completed' | 'failed'> = state
        ? (state.split(',') as any)
        : ['active', 'waiting', 'delayed'];

      // Validate states
      const allowedStates = ['active', 'waiting', 'delayed', 'completed', 'failed', 'paused'];
      for (const s of validStates) {
        if (!allowedStates.includes(s)) {
          throw new BadRequestException(
            `Estado inválido: ${s}. Estados permitidos: ${allowedStates.join(', ')}`,
          );
        }
      }

      const startIndex = start ?? 0;
      const endIndex = end ?? 99;

      const jobs = await this.notificationQueueService.getJobsByState(
        validStates,
        startIndex,
        endIndex,
      );

      return {
        success: true,
        data: jobs,
        message: 'Jobs da fila obtidos com sucesso.',
        meta: {
          start: startIndex,
          end: endIndex,
          count: jobs.length,
        },
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao obter jobs da fila:', error);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/failed
   * List failed jobs
   */
  @Get('failed')
  async getFailedJobs(
    @Query('start', new ParseIntPipe({ optional: true })) start?: number,
    @Query('end', new ParseIntPipe({ optional: true })) end?: number,
  ): Promise<{
    success: boolean;
    data: NotificationJobInfo[];
    message: string;
    meta: {
      start: number;
      end: number;
      count: number;
    };
  }> {
    try {
      const startIndex = start ?? 0;
      const endIndex = end ?? 99;

      const jobs = await this.notificationQueueService.getJobsByState(
        ['failed'],
        startIndex,
        endIndex,
      );

      return {
        success: true,
        data: jobs,
        message: 'Jobs falhados obtidos com sucesso.',
        meta: {
          start: startIndex,
          end: endIndex,
          count: jobs.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao obter jobs falhados:', error);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/job/:id
   * Get specific job details by ID
   */
  @Get('job/:id')
  async getJobById(@Param('id') id: string): Promise<{
    success: boolean;
    data: NotificationJobInfo | null;
    message: string;
  }> {
    try {
      const job = await this.notificationQueueService.getJob(id);

      if (!job) {
        throw new NotFoundException(`Job ${id} não encontrado.`);
      }

      const state = await job.getState();

      const jobInfo: NotificationJobInfo = {
        id: job.id,
        notificationId: job.data.notificationId,
        channel: job.data.channel,
        state,
        progress: job.progress() as number,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        data: job.data,
      };

      return {
        success: true,
        data: jobInfo,
        message: 'Detalhes do job obtidos com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Erro ao obter job ${id}:`, error);
      throw error;
    }
  }

  /**
   * GET /notifications/queue/notification/:notificationId
   * Get all jobs for a specific notification
   */
  @Get('notification/:notificationId')
  async getJobsByNotificationId(@Param('notificationId') notificationId: string): Promise<{
    success: boolean;
    data: NotificationJobInfo[];
    message: string;
  }> {
    try {
      const jobs = await this.notificationQueueService.getJobsByNotificationId(notificationId);

      const jobInfos: NotificationJobInfo[] = await Promise.all(
        jobs.map(async job => ({
          id: job.id,
          notificationId: job.data.notificationId,
          channel: job.data.channel,
          state: await job.getState(),
          progress: job.progress() as number,
          attemptsMade: job.attemptsMade,
          timestamp: job.timestamp,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
          failedReason: job.failedReason,
          data: job.data,
        })),
      );

      return {
        success: true,
        data: jobInfos,
        message: `Jobs da notificação ${notificationId} obtidos com sucesso.`,
      };
    } catch (error: any) {
      this.logger.error(`Erro ao obter jobs da notificação ${notificationId}:`, error);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/retry/:id
   * Retry a failed job
   */
  @Post('retry/:id')
  @HttpCode(HttpStatus.OK)
  async retryJob(@Param('id') id: string): Promise<{
    success: boolean;
    data: {
      jobId: string | number;
      notificationId: string;
      state: string;
    };
    message: string;
  }> {
    try {
      const job = await this.notificationQueueService.retryJob(id);

      if (!job) {
        throw new NotFoundException(`Job ${id} não encontrado.`);
      }

      const state = await job.getState();

      return {
        success: true,
        data: {
          jobId: job.id,
          notificationId: job.data.notificationId,
          state,
        },
        message: 'Job reagendado com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Erro ao reagendar job ${id}:`, error);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/retry-failed
   * Retry all failed jobs
   */
  @Post('retry-failed')
  @HttpCode(HttpStatus.OK)
  async retryAllFailedJobs(): Promise<{
    success: boolean;
    data: {
      retriedCount: number;
    };
    message: string;
  }> {
    try {
      const failedJobs = await this.notificationQueueService.getJobsByState(['failed'], 0, 1000);

      let retriedCount = 0;
      for (const jobInfo of failedJobs) {
        try {
          await this.notificationQueueService.retryJob(jobInfo.id);
          retriedCount++;
        } catch (error: any) {
          this.logger.warn(`Failed to retry job ${jobInfo.id}: ${error.message}`);
        }
      }

      return {
        success: true,
        data: {
          retriedCount,
        },
        message: `${retriedCount} jobs falhados reagendados com sucesso.`,
      };
    } catch (error: any) {
      this.logger.error('Erro ao reagendar jobs falhados:', error);
      throw error;
    }
  }

  /**
   * DELETE /notifications/queue/:id
   * Remove/cancel a job
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async removeJob(@Param('id') id: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.notificationQueueService.removeJob(id);

      return {
        success: true,
        message: 'Job removido com sucesso.',
      };
    } catch (error: any) {
      this.logger.error(`Erro ao remover job ${id}:`, error);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/pause
   * Pause queue processing
   */
  @Post('pause')
  @HttpCode(HttpStatus.OK)
  async pauseQueue(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.notificationQueueService.pauseQueue();

      return {
        success: true,
        message: 'Fila de processamento pausada com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao pausar fila:', error);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/resume
   * Resume queue processing
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  async resumeQueue(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.notificationQueueService.resumeQueue();

      return {
        success: true,
        message: 'Fila de processamento retomada com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao retomar fila:', error);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/clean
   * Clean old jobs from the queue
   */
  @Post('clean')
  @HttpCode(HttpStatus.OK)
  async cleanQueue(
    @Query('type') type?: JobStatusCleanInput,
    @Query('olderThan', new ParseIntPipe({ optional: true })) olderThan?: number,
  ): Promise<{
    success: boolean;
    data: {
      cleaned: number;
      type: JobStatusCleanInput;
      olderThan: number;
    };
    message: string;
  }> {
    try {
      const inputType = type || 'completed';
      const ageLimit = olderThan ?? 24 * 60 * 60 * 1000; // 24 hours default

      // Validate type
      const validTypes: JobStatusCleanInput[] = [
        'completed',
        'waiting',
        'active',
        'delayed',
        'failed',
        'paused',
      ];
      if (!validTypes.includes(inputType)) {
        throw new BadRequestException(
          `Tipo inválido: ${inputType}. Tipos permitidos: ${validTypes.join(', ')}`,
        );
      }

      const cleanedCount = await this.notificationQueueService.cleanQueue(inputType, ageLimit);

      return {
        success: true,
        data: {
          cleaned: cleanedCount,
          type: inputType,
          olderThan: ageLimit,
        },
        message: `${cleanedCount} jobs ${inputType} mais antigos que ${Math.round(ageLimit / 1000 / 60)} minutos foram removidos.`,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao limpar fila:', error);
      throw error;
    }
  }

  /**
   * POST /notifications/queue/empty
   * Empty the entire queue (remove all jobs)
   * Use with caution!
   */
  @Post('empty')
  @HttpCode(HttpStatus.OK)
  async emptyQueue(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      this.logger.warn('Emptying entire notification queue - all jobs will be removed!');
      await this.notificationQueueService.emptyQueue();

      return {
        success: true,
        message: 'Fila esvaziada com sucesso. Todos os jobs foram removidos.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao esvaziar fila:', error);
      throw error;
    }
  }
}
