import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ServerService } from './server.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { ReadRateLimit, WriteRateLimit } from '../throttler/throttler.decorators';
import { Roles } from '../auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';

@Controller('server')
@UseGuards(AuthGuard)
export class ServerController {
  constructor(private readonly serverService: ServerService) {}

  @Get('services')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getServices(@UserId() userId: string) {
    const services = await this.serverService.getSystemServices();
    return {
      success: true,
      message: 'Serviços do sistema obtidos com sucesso',
      data: services,
    };
  }

  @Get('metrics')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getMetrics(@UserId() userId: string) {
    const metrics = await this.serverService.getSystemMetrics();
    return {
      success: true,
      message: 'Métricas do sistema obtidas com sucesso',
      data: metrics,
    };
  }

  @Get('users')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getUsers(@UserId() userId: string) {
    const users = await this.serverService.getSystemUsers();
    return {
      success: true,
      message: 'Usuários do sistema obtidos com sucesso',
      data: users,
    };
  }

  @Get('shared-folders')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getSharedFolders(@UserId() userId: string) {
    const folders = await this.serverService.getSharedFolders();
    return {
      success: true,
      message: 'Pastas compartilhadas obtidas com sucesso',
      data: folders,
    };
  }

  @Get('shared-folders/:folderName/contents')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getSharedFolderContents(
    @UserId() userId: string,
    @Param('folderName') folderName: string,
    @Query('subPath') subPath?: string,
  ) {
    const contents = await this.serverService.getSharedFolderContents(folderName, subPath);
    return {
      success: true,
      message: `Conteúdo da pasta ${folderName} obtido com sucesso`,
      data: contents,
    };
  }

  @Get('services/:serviceName/logs')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getServiceLogs(
    @UserId() userId: string,
    @Param('serviceName') serviceName: string,
    @Query('lines') lines?: string,
  ) {
    const logLines = lines ? parseInt(lines, 10) : 50;
    const logs = await this.serverService.getServiceLogs(serviceName, logLines);
    return {
      success: true,
      message: `Logs do serviço ${serviceName} obtidos com sucesso`,
      data: logs,
    };
  }

  @Post('services/:serviceName/restart')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async restartService(@UserId() userId: string, @Param('serviceName') serviceName: string) {
    await this.serverService.restartService(serviceName);
    return {
      success: true,
      message: `Serviço ${serviceName} reiniciado com sucesso`,
    };
  }

  @Post('services/:serviceName/start')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async startService(@UserId() userId: string, @Param('serviceName') serviceName: string) {
    await this.serverService.startService(serviceName);
    return {
      success: true,
      message: `Serviço ${serviceName} iniciado com sucesso`,
    };
  }

  @Post('services/:serviceName/stop')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async stopService(@UserId() userId: string, @Param('serviceName') serviceName: string) {
    await this.serverService.stopService(serviceName);
    return {
      success: true,
      message: `Serviço ${serviceName} parado com sucesso`,
    };
  }

  @Post('users')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @UserId() userId: string,
    @Body() body: { username: string; fullName?: string; password?: string },
  ) {
    const { username, fullName, password } = body;

    await this.serverService.createUser(username, fullName);

    if (password) {
      await this.serverService.setUserPassword(username, password);
    }

    return {
      success: true,
      message: `Usuário ${username} criado com sucesso`,
      data: { username, fullName },
    };
  }

  @Put('users/:username/password')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async setUserPassword(
    @UserId() userId: string,
    @Param('username') username: string,
    @Body() body: { password: string },
  ) {
    const { password } = body;
    await this.serverService.setUserPassword(username, password);

    return {
      success: true,
      message: `Senha do usuário ${username} definida com sucesso`,
    };
  }

  @Get('status')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getSystemStatus(@UserId() userId: string) {
    const [services, metrics] = await Promise.all([
      this.serverService.getSystemServices(),
      this.serverService.getSystemMetrics(),
    ]);

    const criticalServices = services.filter(s =>
      ['nginx', 'postgresql', 'redis-server', 'ssh'].includes(s.name),
    );
    const healthyServices = criticalServices.filter(s => s.status === 'active').length;
    const totalServices = criticalServices.length;

    const systemHealth = {
      overall: healthyServices === totalServices ? 'healthy' : 'warning',
      services: {
        healthy: healthyServices,
        total: totalServices,
        critical: criticalServices.filter(s => s.status !== 'active'),
      },
      resources: {
        cpu: metrics.cpu.usage,
        memory: metrics.memory.percentage,
        disk: metrics.disk.percentage,
      },
      uptime: metrics.uptime,
      hostname: metrics.hostname,
    };

    return {
      success: true,
      message: 'Status do sistema obtido com sucesso',
      data: systemHealth,
    };
  }

  @Get('ssd-health')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getSsdHealth(@UserId() userId: string) {
    try {
      const ssdHealth = await this.serverService.getSsdHealthData();
      return {
        success: true,
        message: 'Dados de saúde dos SSDs obtidos com sucesso',
        data: ssdHealth,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Falha ao obter dados de saúde dos SSDs: ' + error.message,
        data: [],
      };
    }
  }

  @Get('ssd-health/:device')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getSingleSsdHealth(@UserId() userId: string, @Param('device') device: string) {
    try {
      // Decode the device parameter (e.g., sda -> /dev/sda)
      const devicePath = device.startsWith('/dev/') ? device : `/dev/${device}`;
      const ssdHealthData = await this.serverService.getSsdHealthData();
      const deviceData = ssdHealthData.find(ssd => ssd.device === devicePath);

      if (!deviceData) {
        return {
          success: false,
          message: `Dispositivo ${device} não encontrado`,
          data: null,
        };
      }

      return {
        success: true,
        message: `Dados de saúde do dispositivo ${device} obtidos com sucesso`,
        data: deviceData,
      };
    } catch (error) {
      return {
        success: false,
        message: `Falha ao obter dados de saúde do dispositivo ${device}: ` + error.message,
        data: null,
      };
    }
  }

  @Get('temperature')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getCpuTemperature(@UserId() userId: string) {
    try {
      const temperatureData = await this.serverService.getDetailedCpuTemperature();

      if (!temperatureData) {
        return {
          success: false,
          message: 'Dados de temperatura da CPU não disponíveis',
          data: null,
        };
      }

      return {
        success: true,
        message: 'Dados de temperatura da CPU obtidos com sucesso',
        data: temperatureData,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Falha ao obter dados de temperatura da CPU: ' + error.message,
        data: null,
      };
    }
  }

  @Get('raid-status')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getRaidStatus(@UserId() userId: string) {
    try {
      const raidStatus = await this.serverService.getRaidStatus();
      return {
        success: true,
        message: 'Status dos arrays RAID obtido com sucesso',
        data: raidStatus,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Falha ao obter status dos arrays RAID: ' + error.message,
        data: {
          arrays: [],
          overall: {
            status: 'failed' as const,
            totalArrays: 0,
            healthyArrays: 0,
            degradedArrays: 0,
            failedArrays: 0,
            rebuildingArrays: 0,
          },
          lastUpdated: new Date(),
        },
      };
    }
  }

  @Get('raid-status/:arrayName')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getSingleRaidArray(@UserId() userId: string, @Param('arrayName') arrayName: string) {
    try {
      const raidStatus = await this.serverService.getRaidStatus();
      const arrayData = raidStatus.arrays.find(
        arr =>
          arr.name === arrayName || arr.device === arrayName || arr.device === `/dev/${arrayName}`,
      );

      if (!arrayData) {
        return {
          success: false,
          message: `Array RAID ${arrayName} não encontrado`,
          data: null,
        };
      }

      return {
        success: true,
        message: `Status do array RAID ${arrayName} obtido com sucesso`,
        data: arrayData,
      };
    } catch (error) {
      return {
        success: false,
        message: `Falha ao obter status do array RAID ${arrayName}: ` + error.message,
        data: null,
      };
    }
  }

  @Post('ssd-health/refresh')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async refreshSsdHealth(@UserId() userId: string) {
    try {
      const ssdHealth = await this.serverService.getSsdHealthData();
      return {
        success: true,
        message: 'Dados de saúde dos SSDs atualizados com sucesso',
        data: ssdHealth,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Falha ao atualizar dados de saúde dos SSDs: ' + error.message,
        data: [],
      };
    }
  }

  @Post('raid-status/refresh')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async refreshRaidStatus(@UserId() userId: string) {
    try {
      const raidStatus = await this.serverService.getRaidStatus();
      return {
        success: true,
        message: 'Status dos arrays RAID atualizado com sucesso',
        data: raidStatus,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Falha ao atualizar status dos arrays RAID: ' + error.message,
        data: {
          arrays: [],
          overall: {
            status: 'failed' as const,
            totalArrays: 0,
            healthyArrays: 0,
            degradedArrays: 0,
            failedArrays: 0,
            rebuildingArrays: 0,
          },
          lastUpdated: new Date(),
        },
      };
    }
  }

  @Post('database/sync')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async triggerDatabaseSync(@UserId() userId: string) {
    try {
      const result = await this.serverService.triggerDatabaseSync();
      return {
        success: result.success,
        message: result.message,
        data: { jobId: result.jobId },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Falha ao iniciar sincronização do banco de dados',
        data: null,
      };
    }
  }

  @Get('database/sync-status')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @ReadRateLimit()
  @HttpCode(HttpStatus.OK)
  async getDatabaseSyncStatus(@UserId() userId: string) {
    try {
      const status = await this.serverService.getSyncStatus();
      return {
        success: true,
        message: 'Status da sincronização obtido com sucesso',
        data: status,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Falha ao obter status da sincronização: ' + error.message,
        data: {
          isRunning: false,
        },
      };
    }
  }
}
