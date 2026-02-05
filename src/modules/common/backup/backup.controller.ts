import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  ValidationPipe,
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserId } from '@common/decorators/current-user.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import { BackupService, BackupMetadata, CreateBackupDto } from './backup.service';
import { GDriveSyncService } from './gdrive-sync.service';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// DTOs for validation
class CreateBackupRequestDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsEnum(['database', 'files', 'system', 'full'])
  type: 'database' | 'files' | 'system' | 'full';

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];

  @IsOptional()
  @IsEnum(['low', 'medium', 'high', 'critical'])
  priority?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  @IsNumber()
  compressionLevel?: number;

  @IsOptional()
  @IsBoolean()
  encrypted?: boolean;
}

class AutoDeleteDto {
  @IsBoolean()
  enabled: boolean;

  @IsEnum(['1_day', '3_days', '1_week', '2_weeks', '1_month', '3_months', '6_months', '1_year'])
  retention:
    | '1_day'
    | '3_days'
    | '1_week'
    | '2_weeks'
    | '1_month'
    | '3_months'
    | '6_months'
    | '1_year';
}

class CreateBackupWithAutoDeleteDto extends CreateBackupRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoDeleteDto)
  autoDelete?: AutoDeleteDto;
}

class ScheduleBackupDto extends CreateBackupWithAutoDeleteDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @IsNotEmpty()
  cron: string;
}

class BackupQueryDto {
  @IsOptional()
  @IsEnum(['database', 'files', 'full'])
  type?: 'database' | 'files' | 'full';

  @IsOptional()
  @IsEnum(['pending', 'in_progress', 'completed', 'failed'])
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';

  @IsOptional()
  @IsString()
  limit?: string;
}

class RegisterExternalBackupDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsEnum(['database', 'files', 'system', 'full'])
  type: 'database' | 'files' | 'system' | 'full';

  @IsNotEmpty()
  @IsString()
  filePath: string;

  @IsNumber()
  size: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];

  @IsOptional()
  @IsBoolean()
  triggerGDriveSync?: boolean;
}

@ApiTags('Backup Management')
@ApiBearerAuth()
@Controller('backups')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.ADMIN)
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    private readonly gdriveSyncService: GDriveSyncService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @ApiOperation({ summary: 'Get all backups' })
  @ApiResponse({
    status: 200,
    description: 'List of all backups',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string', enum: ['database', 'files', 'system', 'full'] },
              size: { type: 'number' },
              createdAt: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] },
              description: { type: 'string' },
              paths: { type: 'array', items: { type: 'string' } },
              error: { type: 'string' },
            },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @ApiQuery({ name: 'type', required: false, enum: ['database', 'files', 'system', 'full'] })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'in_progress', 'completed', 'failed'],
  })
  @ApiQuery({ name: 'limit', required: false, type: 'string' })
  async getBackups(@Query(ValidationPipe) query: BackupQueryDto) {
    try {
      let backups = await this.backupService.getBackups();

      // Apply filters
      if (query.type) {
        backups = backups.filter(backup => backup.type === query.type);
      }

      if (query.status) {
        backups = backups.filter(backup => backup.status === query.status);
      }

      if (query.limit) {
        const limit = parseInt(query.limit, 10);
        if (!isNaN(limit) && limit > 0) {
          backups = backups.slice(0, limit);
        }
      }

      return {
        success: true,
        data: backups,
        message: 'Backups recuperados com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        message: error.message || 'Falha ao recuperar backups',
      };
    }
  }

  @Get('storage-folders')
  @ApiOperation({ summary: 'Get list of storage folders available for backup' })
  @ApiResponse({
    status: 200,
    description: 'List of files storage folder names',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: { type: 'string' },
        },
        message: { type: 'string' },
      },
    },
  })
  async getStorageFolders() {
    try {
      const folders = await this.backupService.listStorageFolders();
      return {
        success: true,
        data: folders,
        message: 'storage folders retrieved successfully',
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        message: error.message || 'Failed to list storage folders',
      };
    }
  }

  @Get(':id')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @ApiOperation({ summary: 'Get backup by ID' })
  @ApiParam({ name: 'id', description: 'Backup ID' })
  @ApiResponse({
    status: 200,
    description: 'Backup details',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string', enum: ['database', 'files', 'full'] },
            size: { type: 'number' },
            createdAt: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] },
            description: { type: 'string' },
            paths: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Backup não encontrado' })
  async getBackupById(@Param('id') id: string) {
    try {
      const backup = await this.backupService.getBackupById(id);

      if (!backup) {
        return {
          success: false,
          data: null,
          message: 'Backup não encontrado',
        };
      }

      return {
        success: true,
        data: backup,
        message: 'Backup recuperado com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Falha ao recuperar backup',
      };
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new backup' })
  @ApiBody({
    type: CreateBackupWithAutoDeleteDto,
    description: 'Backup creation data',
  })
  @ApiResponse({
    status: 201,
    description: 'Backup created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            message: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  async createBackup(@Body(ValidationPipe) createBackupDto: CreateBackupWithAutoDeleteDto) {
    try {
      const result = await this.backupService.createBackup(createBackupDto);

      return {
        success: true,
        data: result,
        message: 'Backup criado com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Falha ao criar backup',
      };
    }
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore a backup' })
  @ApiParam({ name: 'id', description: 'Backup ID to restore' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        targetPath: { type: 'string', description: 'Target path for restoration (optional)' },
      },
    },
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Backup restore initiated',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async restoreBackup(@Param('id') id: string, @Body() body?: { targetPath?: string }) {
    // Let exceptions propagate for proper error handling on the frontend
    const result = await this.backupService.restoreBackup(id, body?.targetPath);

    return {
      success: true,
      data: result,
      message: 'Restauração de backup iniciada com sucesso',
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a backup' })
  @ApiParam({ name: 'id', description: 'Backup ID to delete' })
  @ApiResponse({
    status: 200,
    description: 'Backup excluído com sucesso',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'null' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Falha ao excluir backup',
  })
  @HttpCode(HttpStatus.OK)
  async deleteBackup(@Param('id') id: string) {
    // Let exceptions propagate - service throws InternalServerErrorException on failure
    await this.backupService.deleteBackup(id);

    return {
      success: true,
      data: null,
      message: 'Backup excluído com sucesso',
    };
  }

  @Post('register-external')
  @ApiOperation({ summary: 'Register an external backup (created by shell scripts)' })
  @ApiBody({
    type: RegisterExternalBackupDto,
    description: 'External backup registration data',
  })
  @ApiResponse({
    status: 201,
    description: 'External backup registered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            gdriveJobId: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  async registerExternalBackup(
    @Body(ValidationPipe) dto: RegisterExternalBackupDto,
    @UserId() userId?: string,
  ) {
    try {
      const result = await this.backupService.registerExternalBackup(dto, userId);

      // Optionally trigger GDrive sync
      let gdriveJobId: string | undefined;
      if (dto.triggerGDriveSync) {
        try {
          const job = await this.gdriveSyncService.queueSync(result.id, dto.filePath, dto.type);
          gdriveJobId = job.id?.toString();
        } catch (syncError) {
          // Don't fail the registration if sync fails to queue
        }
      }

      return {
        success: true,
        data: {
          id: result.id,
          gdriveJobId,
        },
        message: 'External backup registered successfully',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Failed to register external backup',
      };
    }
  }

  @Get('scheduled/list')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @ApiOperation({ summary: 'Get all scheduled backups' })
  @ApiResponse({
    status: 200,
    description: 'List of scheduled backups',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              cron: { type: 'string' },
              next: { type: 'number' },
            },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async getScheduledBackups() {
    try {
      const scheduledBackups = await this.backupService.getScheduledBackups();

      return {
        success: true,
        data: scheduledBackups,
        message: 'Backups agendados recuperados com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        message: error.message || 'Falha ao recuperar backups agendados',
      };
    }
  }

  @Post('scheduled')
  @ApiOperation({ summary: 'Schedule a backup' })
  @ApiBody({
    type: ScheduleBackupDto,
    description: 'Backup scheduling data',
  })
  @ApiResponse({
    status: 201,
    description: 'Backup agendado com sucesso',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  async scheduleBackup(
    @Body(ValidationPipe) scheduleBackupDto: ScheduleBackupDto,
    @UserId() userId?: string,
  ) {
    try {
      const { enabled, cron, ...backupData } = scheduleBackupDto;

      const createBackupDto: CreateBackupDto = {
        ...backupData,
        schedule: {
          enabled,
          cron,
        },
      };

      const result = await this.backupService.scheduleBackup(createBackupDto, userId);

      return {
        success: true,
        data: result,
        message: 'Backup agendado com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Falha ao agendar backup',
      };
    }
  }

  @Delete('scheduled/:id')
  @ApiOperation({ summary: 'Remove a scheduled backup' })
  @ApiParam({ name: 'id', description: 'Scheduled backup job ID' })
  @ApiResponse({
    status: 200,
    description: 'Scheduled backup removed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'null' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Falha ao remover backup agendado',
  })
  @HttpCode(HttpStatus.OK)
  async removeScheduledBackup(@Param('id') id: string, @UserId() userId?: string) {
    // Let exceptions propagate for proper error handling on the frontend
    await this.backupService.removeScheduledBackup(id, userId);

    return {
      success: true,
      data: null,
      message: 'Backup agendado removido com sucesso',
    };
  }

  @Get('system/health/summary')
  @ApiOperation({ summary: 'Get comprehensive backup system health summary' })
  @ApiResponse({
    status: 200,
    description: 'Comprehensive system health summary',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            raidStatus: {
              type: 'object',
              properties: {
                healthy: { type: 'boolean' },
                details: { type: 'string' },
                degraded: { type: 'boolean' },
              },
            },
            diskSpace: {
              type: 'object',
              properties: {
                available: { type: 'string' },
                used: { type: 'string' },
                total: { type: 'string' },
                usagePercent: { type: 'number' },
                availableBytes: { type: 'number' },
              },
            },
            backupStats: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                completed: { type: 'number' },
                failed: { type: 'number' },
                inProgress: { type: 'number' },
                totalSize: { type: 'number' },
              },
            },
            recommendations: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async getSystemHealthSummary() {
    try {
      const healthSummary = await this.backupService.getSystemHealthSummary();

      return {
        success: true,
        data: healthSummary,
        message: 'Resumo de saúde do sistema recuperado com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Falha ao recuperar resumo de saúde do sistema',
      };
    }
  }

  @Get('system/health')
  @ApiOperation({ summary: 'Get backup system health status' })
  @ApiResponse({
    status: 200,
    description: 'System health status',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            totalBackups: { type: 'number' },
            completedBackups: { type: 'number' },
            failedBackups: { type: 'number' },
            inProgressBackups: { type: 'number' },
            totalSize: { type: 'string' },
            diskSpace: {
              type: 'object',
              properties: {
                available: { type: 'string' },
                used: { type: 'string' },
                total: { type: 'string' },
                usagePercent: { type: 'number' },
              },
            },
            raidStatus: {
              type: 'object',
              properties: {
                healthy: { type: 'boolean' },
                details: { type: 'string' },
              },
            },
            scheduledBackups: { type: 'number' },
            lastBackup: { type: 'string' },
            nextScheduledBackup: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async getSystemHealth() {
    try {
      const backups = await this.backupService.getBackups();
      const scheduledBackups = await this.backupService.getScheduledBackups();

      const totalBackups = backups.length;
      const completedBackups = backups.filter(b => b.status === 'completed').length;
      const failedBackups = backups.filter(b => b.status === 'failed').length;
      const inProgressBackups = backups.filter(b => b.status === 'in_progress').length;

      // Calculate total size
      const totalSizeBytes = backups
        .filter(b => b.status === 'completed')
        .reduce((sum, b) => sum + (b.size || 0), 0);
      const totalSize = this.formatBytes(totalSizeBytes);

      // Get disk space info
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      let diskSpace;
      try {
        const backupPath = process.env.BACKUP_PATH || '/mnt/backup';
        const { stdout } = await execAsync(`df -h ${backupPath} | tail -1`);
        const parts = stdout.trim().split(/\s+/);
        diskSpace = {
          available: parts[3],
          used: parts[2],
          total: parts[1],
          usagePercent: parseInt(parts[4].replace('%', '')),
        };
      } catch (err) {
        diskSpace = {
          available: 'Unknown',
          used: 'Unknown',
          total: 'Unknown',
          usagePercent: 0,
        };
      }

      // Check RAID status
      let raidStatus;
      try {
        const { stdout } = await execAsync('cat /proc/mdstat');
        const healthy = stdout.includes('active') && !stdout.includes('[U_]');
        raidStatus = {
          healthy,
          details: stdout.split('\n').find(line => line.includes('md0')) || 'No RAID info',
        };
      } catch (err) {
        raidStatus = {
          healthy: false,
          details: 'Unable to read RAID status',
        };
      }

      const lastBackup =
        backups.length > 0
          ? backups.sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            )[0].createdAt
          : null;

      const nextScheduledBackup =
        scheduledBackups.length > 0
          ? Math.min(...scheduledBackups.map(s => s.next)).toString()
          : null;

      return {
        success: true,
        data: {
          totalBackups,
          completedBackups,
          failedBackups,
          inProgressBackups,
          totalSize,
          diskSpace,
          raidStatus,
          scheduledBackups: scheduledBackups.length,
          lastBackup,
          nextScheduledBackup,
        },
        message: 'Saúde do sistema recuperada com sucesso',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Falha ao recuperar saúde do sistema',
      };
    }
  }

  @Post('system/verify/:id')
  @ApiOperation({ summary: 'Verify backup integrity' })
  @ApiParam({ name: 'id', description: 'Backup ID to verify' })
  @ApiResponse({
    status: 200,
    description: 'Backup verification result',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            backupId: { type: 'string' },
            fileExists: { type: 'boolean' },
            archiveIntegrity: { type: 'boolean' },
            sizeMatch: { type: 'boolean' },
            verificationTime: { type: 'string' },
            details: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async verifyBackup(@Param('id') id: string) {
    try {
      const metadata = await this.backupService.getBackupById(id);
      if (!metadata) {
        return {
          success: false,
          data: null,
          message: 'Backup não encontrado',
        };
      }

      const path = require('path');
      const fs = require('fs/promises');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const backupFileName = `${id}.tar.gz`;
      const backupBasePath = process.env.BACKUP_PATH || '/mnt/backup';
      const backupPath = path.join(backupBasePath, metadata.type, backupFileName);

      // Check if file exists
      let fileExists = true;
      let actualSize = 0;
      try {
        const stats = await fs.stat(backupPath);
        actualSize = stats.size;
      } catch (err) {
        fileExists = false;
      }

      // Check archive integrity
      let archiveIntegrity = false;
      if (fileExists) {
        try {
          await execAsync(`tar -tzf ${backupPath} > /dev/null 2>&1`);
          archiveIntegrity = true;
        } catch (err) {
          archiveIntegrity = false;
        }
      }

      // Check size match
      const sizeMatch = actualSize === metadata.size;

      const verificationTime = new Date().toISOString();
      const details = `File exists: ${fileExists}, Archive integrity: ${archiveIntegrity}, Size match: ${sizeMatch} (expected: ${metadata.size}, actual: ${actualSize})`;

      return {
        success: true,
        data: {
          backupId: id,
          fileExists,
          archiveIntegrity,
          sizeMatch,
          verificationTime,
          details,
        },
        message: 'Verificação de backup concluída',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Falha ao verificar backup',
      };
    }
  }

  @Get('history')
  @ApiOperation({ summary: 'Get deleted backups history' })
  @ApiResponse({
    status: 200,
    description: 'Deleted backups history',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: { type: 'object' },
        },
      },
    },
  })
  async getBackupHistory() {
    const deletedBackups = await this.backupService.getDeletedBackups();
    return {
      success: true,
      data: deletedBackups,
    };
  }

  @Delete(':id/hard')
  @ApiOperation({ summary: 'Permanently delete a backup (removes from history)' })
  @ApiParam({ name: 'id', description: 'Backup ID' })
  @ApiResponse({ status: 200, description: 'Backup permanently deleted' })
  @HttpCode(HttpStatus.OK)
  async hardDeleteBackup(@Param('id') id: string) {
    await this.backupService.hardDeleteBackup(id);
    return {
      success: true,
      message: 'Backup permanently deleted',
    };
  }

  // ============ Google Drive Sync Endpoints ============

  @Get('gdrive/status/:id')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @ApiOperation({ summary: 'Get Google Drive sync status for a backup' })
  @ApiParam({ name: 'id', description: 'Backup ID' })
  @ApiResponse({
    status: 200,
    description: 'GDrive sync status',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            backupId: { type: 'string' },
            status: { type: 'string', enum: ['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'DELETED'] },
            gdriveFileId: { type: 'string' },
            syncedAt: { type: 'string' },
            error: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async getGDriveSyncStatus(@Param('id') id: string) {
    try {
      const status = await this.gdriveSyncService.getSyncStatus(id);

      if (!status) {
        return {
          success: false,
          data: null,
          message: 'Backup not found',
        };
      }

      return {
        success: true,
        data: status,
        message: 'GDrive sync status retrieved',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Failed to get GDrive sync status',
      };
    }
  }

  @Post('gdrive/retry/:id')
  @ApiOperation({ summary: 'Retry failed GDrive sync for a backup' })
  @ApiParam({ name: 'id', description: 'Backup ID' })
  @ApiResponse({
    status: 200,
    description: 'Sync retry queued',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async retryGDriveSync(@Param('id') id: string) {
    try {
      const job = await this.gdriveSyncService.retrySingleSync(id);

      if (!job) {
        return {
          success: false,
          data: null,
          message: 'Backup not found or has no file path',
        };
      }

      return {
        success: true,
        data: { jobId: job.id?.toString() },
        message: 'GDrive sync retry queued',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Failed to retry GDrive sync',
      };
    }
  }

  @Post('gdrive/retry-all-failed')
  @ApiOperation({ summary: 'Retry all failed GDrive syncs' })
  @ApiResponse({
    status: 200,
    description: 'All failed syncs retry queued',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            retriedCount: { type: 'number' },
            backupIds: { type: 'array', items: { type: 'string' } },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async retryAllFailedSyncs() {
    try {
      const result = await this.gdriveSyncService.retryFailedSyncs();

      return {
        success: true,
        data: result,
        message: `Retry queued for ${result.retriedCount} backups`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Failed to retry failed syncs',
      };
    }
  }

  @Get('gdrive/stats')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @ApiOperation({ summary: 'Get GDrive sync statistics' })
  @ApiResponse({
    status: 200,
    description: 'GDrive sync statistics',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            syncStats: {
              type: 'object',
              properties: {
                pending: { type: 'number' },
                syncing: { type: 'number' },
                synced: { type: 'number' },
                failed: { type: 'number' },
              },
            },
            queueStats: {
              type: 'object',
              properties: {
                waiting: { type: 'number' },
                active: { type: 'number' },
                completed: { type: 'number' },
                failed: { type: 'number' },
                delayed: { type: 'number' },
              },
            },
            storageInfo: { type: 'object' },
            connected: { type: 'boolean' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async getGDriveStats() {
    try {
      const [syncStats, queueStats, storageInfo, connectionStatus] = await Promise.all([
        this.gdriveSyncService.getSyncStats(),
        this.gdriveSyncService.getQueueStatus(),
        this.gdriveSyncService.getStorageInfo(),
        this.gdriveSyncService.checkConnection(),
      ]);

      return {
        success: true,
        data: {
          syncStats,
          queueStats,
          storageInfo,
          connected: connectionStatus.connected,
          connectionError: connectionStatus.error,
        },
        message: 'GDrive stats retrieved',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error.message || 'Failed to get GDrive stats',
      };
    }
  }

  @Get('gdrive/pending')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @ApiOperation({ summary: 'Get backups pending GDrive sync' })
  @ApiResponse({
    status: 200,
    description: 'List of backups pending sync',
  })
  async getPendingSyncs() {
    try {
      const pending = await this.gdriveSyncService.getPendingSyncs();

      return {
        success: true,
        data: pending,
        message: `${pending.length} backups pending sync`,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        message: error.message || 'Failed to get pending syncs',
      };
    }
  }

  @Get('gdrive/connection')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @ApiOperation({ summary: 'Check Google Drive connection status' })
  @ApiResponse({
    status: 200,
    description: 'Connection status',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        message: { type: 'string' },
      },
    },
  })
  async checkGDriveConnection() {
    try {
      const status = await this.gdriveSyncService.checkConnection();

      return {
        success: true,
        data: status,
        message: status.connected ? 'Google Drive connected' : 'Google Drive not connected',
      };
    } catch (error) {
      return {
        success: false,
        data: { connected: false, error: error.message },
        message: 'Failed to check connection',
      };
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
