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
  Req,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { TaskPricingService } from './task-pricing.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { SECTOR_PRIVILEGES, TASK_PRICING_STATUS } from '@constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  taskPricingCreateSchema,
  taskPricingUpdateSchema,
  taskPricingGetManySchema,
  taskPricingQuerySchema,
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
  constructor(
    private readonly taskPricingService: TaskPricingService,
    private readonly jwtService: JwtService,
  ) {}

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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
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
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
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
   * Access: FINANCIAL, ADMIN, COMMERCIAL
   * Note: FINANCIAL cannot set INTERNAL_APPROVED (only ADMIN/COMMERCIAL can)
   */
  @Put(':id/status')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    @UserId() userId: string,
    @Req() req: Request,
  ) {
    const validStatuses = Object.values(TASK_PRICING_STATUS);
    if (!validStatuses.includes(status as any)) {
      throw new BadRequestException('Status inválido');
    }

    // FINANCIAL cannot set INTERNAL_APPROVED — only ADMIN/COMMERCIAL can
    if (status === TASK_PRICING_STATUS.INTERNAL_APPROVED) {
      const userPrivilege = (req as any).user?.role;
      if (userPrivilege === SECTOR_PRIVILEGES.FINANCIAL) {
        throw new BadRequestException(
          'Setor financeiro não pode aprovar internamente. Apenas Admin ou Comercial.',
        );
      }
      return this.taskPricingService.internalApprove(id, userId);
    }

    return this.taskPricingService.updateStatus(id, status as TASK_PRICING_STATUS, userId);
  }

  /**
   * PUT /task-pricings/:id/budget-approve
   * Customer approved the budget (PENDING → BUDGET_APPROVED)
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id/budget-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async budgetApprove(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskPricingService.budgetApprove(id, userId);
  }

  /**
   * PUT /task-pricings/:id/verify
   * Financial verifies pricing structure (BUDGET_APPROVED → VERIFIED)
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/verify')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async verify(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskPricingService.verify(id, userId);
  }

  /**
   * PUT /task-pricings/:id/internal-approve
   * Commercial/admin final approval → triggers invoices + NFS-e (VERIFIED → INTERNAL_APPROVED)
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id/internal-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async internalApprove(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskPricingService.internalApprove(id, userId);
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
  async delete(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
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
   * - For authenticated users: returns pricing even if expired
   * - For non-authenticated users: only returns if not expired
   *
   * Access: PUBLIC (authentication optional)
   */
  @Get('public/:id')
  @Public()
  async findPublic(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    // Check if user is authenticated (optional auth)
    let isAuthenticated = false;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_SECRET,
        });
        isAuthenticated = true;
      } catch {
        // Invalid token, treat as unauthenticated
      }
    }

    return this.taskPricingService.findPublic(id, isAuthenticated);
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
    @Query('customerConfigId') customerConfigId?: string,
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

    return this.taskPricingService.uploadCustomerSignature(id, file, customerConfigId);
  }
}
