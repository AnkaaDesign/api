import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException
} from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { DeploymentApplication, DeploymentEnvironment, DeploymentTrigger } from '@prisma/client';

@Controller('deployments')
@UseGuards(AuthGuard)
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get('commits')
  async getCommits(
    @Query('application') application: string,
    @Query('environment') environment: string,
    @Query('limit') limit?: string
  ) {
    if (!application || !environment) {
      throw new BadRequestException('Application and environment are required');
    }

    const app = application.toUpperCase() as DeploymentApplication;
    const env = environment.toUpperCase() as DeploymentEnvironment;

    if (!Object.values(DeploymentApplication).includes(app)) {
      throw new BadRequestException(`Invalid application: ${application}`);
    }

    if (!Object.values(DeploymentEnvironment).includes(env)) {
      throw new BadRequestException(`Invalid environment: ${environment}`);
    }

    const commits = await this.deploymentService.getCommits(
      app,
      env,
      limit ? parseInt(limit) : 20
    );

    return {
      success: true,
      data: commits
    };
  }

  @Get('current')
  async getCurrentDeployment(
    @Query('application') application: string,
    @Query('environment') environment: string
  ) {
    if (!application || !environment) {
      throw new BadRequestException('Application and environment are required');
    }

    const app = application.toUpperCase() as DeploymentApplication;
    const env = environment.toUpperCase() as DeploymentEnvironment;

    const deployment = await this.deploymentService.getCurrentDeployment(app, env);

    return {
      success: true,
      data: deployment
    };
  }

  @Get('history')
  async getDeploymentHistory(
    @Query('application') application?: string,
    @Query('environment') environment?: string,
    @Query('limit') limit?: string
  ) {
    const app = application ? application.toUpperCase() as DeploymentApplication : undefined;
    const env = environment ? environment.toUpperCase() as DeploymentEnvironment : undefined;

    const history = await this.deploymentService.getDeploymentHistory(
      app,
      env,
      limit ? parseInt(limit) : 50
    );

    return {
      success: true,
      data: history,
      meta: {
        totalRecords: history.length
      }
    };
  }

  @Get(':id')
  async getDeploymentById(@Param('id') id: string) {
    const deployment = await this.deploymentService.getDeploymentById(id);

    return {
      success: true,
      data: deployment
    };
  }

  @Get(':id/logs')
  async getDeploymentLogs(@Param('id') id: string) {
    const logs = await this.deploymentService.getDeploymentLogs(id);

    return {
      success: true,
      data: logs
    };
  }

  @Post('deploy')
  @HttpCode(HttpStatus.ACCEPTED)
  async deploy(
    @Body() body: {
      application: string;
      environment: string;
      commitHash: string;
      trigger?: string;
    },
    @Request() req: any
  ) {
    if (!body.application || !body.environment || !body.commitHash) {
      throw new BadRequestException('Application, environment, and commitHash are required');
    }

    const app = body.application.toUpperCase() as DeploymentApplication;
    const env = body.environment.toUpperCase() as DeploymentEnvironment;
    const trigger = body.trigger ? body.trigger.toUpperCase() as DeploymentTrigger : DeploymentTrigger.MANUAL;

    if (!Object.values(DeploymentApplication).includes(app)) {
      throw new BadRequestException(`Invalid application: ${body.application}`);
    }

    if (!Object.values(DeploymentEnvironment).includes(env)) {
      throw new BadRequestException(`Invalid environment: ${body.environment}`);
    }

    const deployment = await this.deploymentService.deploy(
      app,
      env,
      body.commitHash,
      req.user?.sub,
      trigger
    );

    return {
      success: true,
      message: 'Deployment started',
      data: deployment
    };
  }

  @Post('rollback')
  @HttpCode(HttpStatus.ACCEPTED)
  async rollback(
    @Body() body: {
      application: string;
      environment: string;
    },
    @Request() req: any
  ) {
    if (!body.application || !body.environment) {
      throw new BadRequestException('Application and environment are required');
    }

    const app = body.application.toUpperCase() as DeploymentApplication;
    const env = body.environment.toUpperCase() as DeploymentEnvironment;

    const deployment = await this.deploymentService.rollback(
      app,
      env,
      req.user?.sub
    );

    return {
      success: true,
      message: 'Rollback started',
      data: deployment
    };
  }

  @Put(':id/cancel')
  async cancelDeployment(@Param('id') id: string) {
    const result = await this.deploymentService.cancelDeployment(id);

    return {
      success: true,
      message: result.message
    };
  }

  @Get('applications/list')
  async getApplications() {
    return {
      success: true,
      data: Object.values(DeploymentApplication)
    };
  }

  @Get('environments/list')
  async getEnvironments() {
    return {
      success: true,
      data: Object.values(DeploymentEnvironment)
    };
  }

  @Get('status/list')
  async getStatuses() {
    return {
      success: true,
      data: [
        'PENDING',
        'IN_PROGRESS',
        'BUILDING',
        'TESTING',
        'DEPLOYING',
        'COMPLETED',
        'FAILED',
        'ROLLED_BACK',
        'CANCELLED'
      ]
    };
  }
}