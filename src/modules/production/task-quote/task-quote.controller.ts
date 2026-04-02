// api/src/modules/production/task-quote/task-quote.controller.ts

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
import { TaskQuoteService } from './task-quote.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { SECTOR_PRIVILEGES, TASK_QUOTE_STATUS } from '@constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  taskQuoteCreateSchema,
  taskQuoteUpdateSchema,
  taskQuoteGetManySchema,
  taskQuoteQuerySchema,
} from '@schemas/task-quote';
import type {
  TaskQuoteCreateFormData,
  TaskQuoteUpdateFormData,
  TaskQuoteGetManyFormData,
} from '@schemas/task-quote';

/**
 * Controller for TaskQuote endpoints
 * Handles HTTP requests for quote management
 *
 * Access Control:
 * - COMMERCIAL: Can create, edit, view all quotes
 * - FINANCIAL: Can view all, approve/reject quotes
 * - ADMIN: Full access to everything
 */
@Controller('task-quotes')
export class TaskQuoteController {
  constructor(
    private readonly taskQuoteService: TaskQuoteService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * GET /task-quotes
   * List all quotes with filtering and pagination
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
    @Query(new ZodQueryValidationPipe(taskQuoteGetManySchema))
    query: TaskQuoteGetManyFormData,
  ) {
    return this.taskQuoteService.findMany(query);
  }

  /**
   * GET /task-quotes/suggest
   * Find the most recent quote matching task name, customer, truck category, and implement type.
   * Used to pre-fill services when creating a new budget.
   *
   * Query params: name, customerId, category, implementType (all required)
   */
  @Get('suggest')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async findSuggestion(
    @Query('name') name: string,
    @Query('customerId') customerId: string,
    @Query('category') category: string,
    @Query('implementType') implementType: string,
  ) {
    if (!name || !customerId || !category || !implementType) {
      throw new BadRequestException(
        'Todos os campos são obrigatórios: name, customerId, category, implementType.',
      );
    }
    return this.taskQuoteService.findSuggestion({ name, customerId, category, implementType });
  }

  /**
   * GET /task-quotes/:id
   * Get single quote by ID
   */
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findUnique(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(taskQuoteQuerySchema)) query: any,
  ) {
    return this.taskQuoteService.findUnique(id, query.include);
  }

  /**
   * GET /task-quotes/task/:taskId
   * Get quote for specific task
   */
  @Get('task/:taskId')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findByTaskId(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.taskQuoteService.findByTaskId(taskId);
  }

  /**
   * POST /task-quotes
   * Create new quote
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(taskQuoteCreateSchema))
    data: TaskQuoteCreateFormData,
    @UserId() userId: string,
  ) {
    return this.taskQuoteService.create(data, userId);
  }

  /**
   * PUT /task-quotes/:id
   * Update existing quote
   *
   * Access: FINANCIAL, COMMERCIAL, ADMIN
   */
  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskQuoteUpdateSchema))
    data: TaskQuoteUpdateFormData,
    @UserId() userId: string,
  ) {
    return this.taskQuoteService.update(id, data, userId);
  }

  /**
   * PUT /task-quotes/:id/status
   * Update quote status
   *
   * Access: FINANCIAL, ADMIN, COMMERCIAL
   * Note: FINANCIAL cannot set BILLING_APPROVED (only ADMIN/COMMERCIAL can)
   */
  @Put(':id/status')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    @UserId() userId: string,
    @Req() req: Request,
  ) {
    const validStatuses = Object.values(TASK_QUOTE_STATUS);
    if (!validStatuses.includes(status as any)) {
      throw new BadRequestException('Status inválido');
    }

    // FINANCIAL cannot set BILLING_APPROVED — only ADMIN/COMMERCIAL can
    if (status === TASK_QUOTE_STATUS.BILLING_APPROVED) {
      const userPrivilege = (req as any).user?.role;
      if (userPrivilege === SECTOR_PRIVILEGES.FINANCIAL) {
        throw new BadRequestException(
          'Setor financeiro não pode aprovar internamente. Apenas Admin ou Comercial.',
        );
      }
      return this.taskQuoteService.internalApprove(id, userId);
    }

    return this.taskQuoteService.updateStatus(id, status as TASK_QUOTE_STATUS, userId);
  }

  /**
   * PUT /task-quotes/:id/budget-approve
   * Customer approved the budget (PENDING → BUDGET_APPROVED)
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id/budget-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async budgetApprove(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.budgetApprove(id, userId);
  }

  /**
   * PUT /task-quotes/:id/verify
   * Financial verifies quote structure (BUDGET_APPROVED → VERIFIED_BY_FINANCIAL)
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/verify')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async verify(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.verify(id, userId);
  }

  /**
   * PUT /task-quotes/:id/internal-approve
   * Commercial/admin final approval → triggers invoices + NFS-e (VERIFIED_BY_FINANCIAL → BILLING_APPROVED)
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id/internal-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async internalApprove(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.internalApprove(id, userId);
  }

  /**
   * DELETE /task-quotes/:id
   * Delete quote
   *
   * Access: ADMIN only
   */
  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.delete(id, userId);
  }

  /**
   * GET /task-quotes/expired/list
   * Get all expired quotes
   *
   * Access: FINANCIAL, ADMIN
   */
  @Get('expired/list')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async findExpired() {
    const expired = await this.taskQuoteService.findAndMarkExpired();
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
   * GET /task-quotes/public/:id
   * Get quote for public view (customer budget page)
   * - For authenticated users: returns quote even if expired
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

    return this.taskQuoteService.findPublic(id, isAuthenticated);
  }

  /**
   * POST /task-quotes/public/:id/signature
   * Upload customer signature for quote
   * Only allows upload if quote is not expired
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

    return this.taskQuoteService.uploadCustomerSignature(id, file, customerConfigId);
  }
}
