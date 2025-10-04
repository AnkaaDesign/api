import { Controller, Get, Post, Param, Query, UseGuards, Logger } from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import {
  ThumbnailQueueService,
  ThumbnailJobStatus,
  JobStatusCleanInput,
} from './thumbnail-queue.service';

@Controller('api/thumbnails')
@UseGuards(AuthGuard)
export class ThumbnailMonitoringController {
  private readonly logger = new Logger(ThumbnailMonitoringController.name);

  constructor(private readonly thumbnailQueueService: ThumbnailQueueService) {}

  /**
   * Get queue statistics
   */
  @Get('queue/stats')
  async getQueueStats() {
    try {
      const stats = await this.thumbnailQueueService.getQueueStats();
      return {
        success: true,
        data: stats,
        message: 'Estatísticas da fila de thumbnail obtidas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao obter estatísticas da fila:', error);
      throw error;
    }
  }

  /**
   * Get job status for a specific file
   */
  @Get('job/:fileId/status')
  async getJobStatus(@Param('fileId') fileId: string) {
    try {
      const status = await this.thumbnailQueueService.getJobStatus(fileId);

      if (!status) {
        return {
          success: true,
          data: null,
          message: 'Nenhum job de thumbnail encontrado para este arquivo.',
        };
      }

      return {
        success: true,
        data: status,
        message: 'Status do job de thumbnail obtido com sucesso.',
      };
    } catch (error: any) {
      this.logger.error(`Erro ao obter status do job para arquivo ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Retry a failed thumbnail job
   */
  @Post('job/:fileId/retry')
  async retryJob(@Param('fileId') fileId: string) {
    try {
      const job = await this.thumbnailQueueService.retryThumbnailJob(fileId);

      if (!job) {
        return {
          success: false,
          message: 'Não foi possível criar um novo job de retry.',
        };
      }

      return {
        success: true,
        data: {
          jobId: job.id,
          fileId: fileId,
          status: 'pending',
        },
        message: 'Job de thumbnail reagendado com sucesso.',
      };
    } catch (error: any) {
      this.logger.error(`Erro ao reagendar job para arquivo ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Pause queue processing
   */
  @Post('queue/pause')
  async pauseQueue() {
    try {
      await this.thumbnailQueueService.pauseQueue();
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
   * Resume queue processing
   */
  @Post('queue/resume')
  async resumeQueue() {
    try {
      await this.thumbnailQueueService.resumeQueue();
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
   * Clean old jobs from queue
   */
  @Post('queue/clean')
  async cleanQueue(
    @Query('type') type?: JobStatusCleanInput,
    @Query('olderThan') olderThan?: string,
  ) {
    try {
      const inputType = type || 'completed';
      const ageLimit = olderThan ? parseInt(olderThan) : 24 * 60 * 60 * 1000; // 24 hours

      const cleanedCount = await this.thumbnailQueueService.cleanQueue(inputType, ageLimit);

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
      this.logger.error('Erro ao limpar fila:', error);
      throw error;
    }
  }
}
