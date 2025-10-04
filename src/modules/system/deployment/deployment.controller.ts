import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Sse,
  Req,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, interval, map } from 'rxjs';
import { DeploymentService } from './deployment.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { SECTOR_PRIVILEGES, DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_APPLICATION } from '../../../constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit, NoRateLimit } from '@modules/common/throttler/throttler.decorators';
import type {
  DeploymentBatchResponse,
  DeploymentCreateResponse,
  DeploymentDeleteResponse,
  DeploymentGetManyResponse,
  DeploymentGetUniqueResponse,
  DeploymentUpdateResponse,
} from '../../../types';
import type {
  DeploymentCreateFormData,
  DeploymentUpdateFormData,
  DeploymentGetManyFormData,
  DeploymentBatchCreateFormData,
  DeploymentBatchUpdateFormData,
  DeploymentBatchDeleteFormData,
  DeploymentQueryFormData,
} from '../../../schemas';
import {
  deploymentCreateSchema,
  deploymentBatchCreateSchema,
  deploymentBatchDeleteSchema,
  deploymentBatchUpdateSchema,
  deploymentGetManySchema,
  deploymentUpdateSchema,
  deploymentQuerySchema,
} from '../../../schemas';

@Controller('deployments')
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  // Basic CRUD Operations
  @Get()
  @Public()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(deploymentGetManySchema)) query: DeploymentGetManyFormData,
    @UserId() userId: string,
  ): Promise<DeploymentGetManyResponse> {
    return this.deploymentService.findMany(query);
  }

  @Post()
  @Public()
  @NoRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(deploymentCreateSchema)) data: DeploymentCreateFormData,
    @Query(new ZodQueryValidationPipe(deploymentQuerySchema)) query: DeploymentQueryFormData,
    @UserId() userId: string,
  ): Promise<DeploymentCreateResponse> {
    // Use a system user ID if not authenticated
    const effectiveUserId = userId || 'system-deployment';
    return this.deploymentService.create(data, effectiveUserId, query.include);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(deploymentBatchCreateSchema)) data: DeploymentBatchCreateFormData,
    @UserId() userId: string,
  ): Promise<DeploymentBatchResponse> {
    return this.deploymentService.batchCreate(data, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async batchUpdate(
    @Body(new ZodValidationPipe(deploymentBatchUpdateSchema)) data: DeploymentBatchUpdateFormData,
    @UserId() userId: string,
  ): Promise<DeploymentBatchResponse> {
    return this.deploymentService.batchUpdate(data, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(deploymentBatchDeleteSchema)) data: DeploymentBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<DeploymentBatchResponse> {
    return this.deploymentService.batchDelete(data, userId);
  }

  // New Deployment Workflow Endpoints (specific routes must come before dynamic routes)

  /**
   * Get current deployment for application and environment
   */
  @Get('current/:application/:environment')
  @Public()
  @NoRateLimit()
  async getCurrentDeployment(
    @Param('application') application: DEPLOYMENT_APPLICATION,
    @Param('environment') environment: DEPLOYMENT_ENVIRONMENT,
    @Query(new ZodQueryValidationPipe(deploymentQuerySchema)) query: DeploymentQueryFormData,
  ): Promise<DeploymentGetUniqueResponse> {
    return this.deploymentService.getCurrentDeployment(application, environment, query.include);
  }

  /**
   * Get available commits for deployment
   */
  @Get('commits/list')
  @Public()
  @NoRateLimit()
  async getAvailableCommits(@Query('limit') limit?: number) {
    return this.deploymentService.getAvailableCommits(limit ? parseInt(limit.toString()) : 50);
  }

  /**
   * Create and trigger a new deployment
   */
  @Post('deploy/:application/:environment/:commitHash')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @NoRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async createDeployment(
    @Param('application') application: DEPLOYMENT_APPLICATION,
    @Param('environment') environment: DEPLOYMENT_ENVIRONMENT,
    @Param('commitHash') commitHash: string,
    @UserId() userId: string,
  ): Promise<DeploymentCreateResponse> {
    return this.deploymentService.createDeployment(application, commitHash, environment, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(deploymentQuerySchema)) query: DeploymentQueryFormData,
    @UserId() userId: string,
  ): Promise<DeploymentGetUniqueResponse> {
    return this.deploymentService.findById(id, query.include);
  }

  @Put(':id')
  @Public()
  @NoRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deploymentUpdateSchema)) data: DeploymentUpdateFormData,
    @Query(new ZodQueryValidationPipe(deploymentQuerySchema)) query: DeploymentQueryFormData,
    @UserId() userId: string,
  ): Promise<DeploymentUpdateResponse> {
    // Use a system user ID if not authenticated
    const effectiveUserId = userId || 'system-deployment';
    return this.deploymentService.update(id, data, effectiveUserId, query.include);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<DeploymentDeleteResponse> {
    return this.deploymentService.delete(id, userId);
  }

  /**
   * Cancel a running deployment
   */
  @Post(':id/cancel')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  async cancelDeployment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(deploymentQuerySchema)) query: DeploymentQueryFormData,
    @UserId() userId: string,
  ): Promise<DeploymentUpdateResponse> {
    return this.deploymentService.cancelDeployment(id, userId, query.include);
  }

  /**
   * Stream deployment logs (Server-Sent Events)
   */
  @Sse(':id/logs')
  @ReadRateLimit()
  streamLogs(@Param('id', ParseUUIDPipe) id: string): Observable<MessageEvent> {
    // Note: This is a simplified implementation
    // In production, you'd want to stream from DeploymentExecutorService
    return interval(1000).pipe(
      map((index) => ({
        data: { message: `Log entry ${index} for deployment ${id}`, timestamp: new Date() },
      }) as MessageEvent),
    );
  }

  /**
   * GitHub webhook endpoint (public, uses signature verification)
   */
  @Post('webhook')
  @Public()
  @NoRateLimit()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['x-hub-signature-256'] as string;
    const webhookSecret = process.env.WEBHOOK_SECRET || 'your-webhook-secret';

    if (!signature) {
      throw new UnauthorizedException('Missing signature');
    }

    const rawBody = req.rawBody?.toString() || JSON.stringify(req.body);
    const isValid = this.deploymentService.verifyWebhookSignature(rawBody, signature, webhookSecret);

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    return this.deploymentService.handleWebhook(req.body);
  }
}
