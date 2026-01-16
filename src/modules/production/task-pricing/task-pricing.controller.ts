// api/src/modules/production/task-pricing/task-pricing.controller.ts

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
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TaskPricingService } from './task-pricing.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { SECTOR_PRIVILEGES } from '@constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  taskPricingCreateSchema,
  taskPricingUpdateSchema,
  taskPricingGetManySchema,
  taskPricingQuerySchema,
  taskPricingBatchCreateSchema,
  taskPricingBatchUpdateSchema,
  taskPricingBatchDeleteSchema,
} from '@schemas/task-pricing';
import type {
  TaskPricingCreateFormData,
  TaskPricingUpdateFormData,
  TaskPricingGetManyFormData,
} from '@schemas/task-pricing';

/**
 * Controller for TaskPricing endpoints
 * Handles HTTP requests for pricing management
 *
 * Access Control:
 * - COMMERCIAL: Can create, edit, view all pricing
 * - FINANCIAL: Can view all, approve/reject pricing
 * - ADMIN: Full access to everything
 */
@Controller('task-pricings')
export class TaskPricingController {
  constructor(private readonly taskPricingService: TaskPricingService) {}

  /**
   * GET /task-pricings
   * List all pricings with filtering and pagination
   *
   * Query params:
   * - page, limit (pagination)
   * - status (filter by status)
   * - taskId (filter by task)
   * - searchingFor (search in items)
   */
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(taskPricingGetManySchema))
    query: TaskPricingGetManyFormData,
  ) {
    return this.taskPricingService.findMany(query);
  }

  /**
   * GET /task-pricings/:id
   * Get single pricing by ID
   */
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  async findUnique(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(taskPricingQuerySchema)) query: any,
  ) {
    return this.taskPricingService.findUnique(id, query.include);
  }

  /**
   * GET /task-pricings/task/:taskId
   * Get pricing for specific task
   */
  @Get('task/:taskId')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
  )
  async findByTaskId(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.taskPricingService.findByTaskId(taskId);
  }

  /**
   * POST /task-pricings
   * Create new pricing
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(taskPricingCreateSchema))
    data: TaskPricingCreateFormData,
    @UserId() userId: string,
  ) {
    return this.taskPricingService.create(data, userId);
  }

  /**
   * PUT /task-pricings/:id
   * Update existing pricing
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskPricingUpdateSchema))
    data: TaskPricingUpdateFormData,
    @UserId() userId: string,
  ) {
    return this.taskPricingService.update(id, data, userId);
  }

  /**
   * PUT /task-pricings/:id/status
   * Update pricing status
   *
   * Access: FINANCIAL, ADMIN (for approval/rejection)
   */
  @Put(':id/status')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    @Body('reason') reason: string | undefined,
    @UserId() userId: string,
  ) {
    return this.taskPricingService.updateStatus(id, status as any, userId, reason);
  }

  /**
   * PUT /task-pricings/:id/approve
   * Approve pricing (shortcut for status update)
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ) {
    return this.taskPricingService.approve(id, userId);
  }

  /**
   * PUT /task-pricings/:id/reject
   * Reject pricing (shortcut for status update)
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/reject')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string | undefined,
    @UserId() userId: string,
  ) {
    return this.taskPricingService.reject(id, userId, reason);
  }

  /**
   * PUT /task-pricings/:id/cancel
   * Cancel pricing
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id/cancel')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ) {
    return this.taskPricingService.cancel(id, userId);
  }

  /**
   * DELETE /task-pricings/:id
   * Delete pricing
   *
   * Access: ADMIN only
   */
  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ) {
    return this.taskPricingService.delete(id, userId);
  }

  /**
   * GET /task-pricings/expired/list
   * Get all expired pricings
   *
   * Access: FINANCIAL, ADMIN
   */
  @Get('expired/list')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async findExpired() {
    const expired = await this.taskPricingService.findAndMarkExpired();
    return {
      success: true,
      data: expired,
      message: `${expired.length} orçamentos expirados encontrados.`,
    };
  }

  // =====================
  // PUBLIC ENDPOINTS (No Authentication Required)
  // =====================

  /**
   * GET /task-pricings/public/:id
   * Get pricing for public view (customer budget page)
   * Only returns data if pricing is not expired
   *
   * Access: PUBLIC (no authentication required)
   */
  @Get('public/:id')
  @Public()
  async findPublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.taskPricingService.findPublic(id);
  }

  /**
   * POST /task-pricings/public/:id/signature
   * Upload customer signature for pricing
   * Only allows upload if pricing is not expired
   *
   * Access: PUBLIC (no authentication required)
   */
  @Post('public/:id/signature')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('signature', multerConfig))
  async uploadPublicSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo de assinatura é obrigatório.');
    }

    // Validate file type (only images allowed for signatures)
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo inválido. Apenas imagens PNG, JPEG ou WebP são permitidas.',
      );
    }

    return this.taskPricingService.uploadCustomerSignature(id, file);
  }
}
