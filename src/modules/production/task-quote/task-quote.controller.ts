// api/src/modules/production/task-quote/task-quote.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
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
  Header,
  Req,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { TaskQuoteService } from './task-quote.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId, User } from '@modules/common/auth/decorators/user.decorator';
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
 * - COMMERCIAL: Can create, edit, view all quotes, and do commercial approval
 * - FINANCIAL: Can view all, do financial verification and billing approval
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
   * Explicit status changes are role-gated per stage inside the service
   * (same roles as the dedicated /status endpoints).
   */
  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskQuoteUpdateSchema))
    data: TaskQuoteUpdateFormData,
    @UserId() userId: string,
    @User('role') userPrivilege: string,
  ) {
    return this.taskQuoteService.update(id, data, userId, false, userPrivilege);
  }

  /**
   * PUT /task-quotes/:id/status
   * Update quote status
   *
   * Access: FINANCIAL, ADMIN, COMMERCIAL
   * Note: COMMERCIAL cannot set BILLING_APPROVED (only ADMIN/FINANCIAL can)
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

    // COMMERCIAL cannot set BILLING_APPROVED — only ADMIN/FINANCIAL can
    if (status === TASK_QUOTE_STATUS.BILLING_APPROVED) {
      const userPrivilege = (req as any).user?.role;
      if (userPrivilege === SECTOR_PRIVILEGES.COMMERCIAL) {
        throw new BadRequestException(
          'Setor comercial não pode aprovar faturamento. Apenas Admin ou Financeiro.',
        );
      }
      return this.taskQuoteService.internalApprove(id, userId);
    }

    return this.taskQuoteService.updateStatus(id, status as TASK_QUOTE_STATUS, userId);
  }

  /**
   * PUT /task-quotes/:id/budget-approve
   * Commercial approves the budget (PENDING → BUDGET_APPROVED).
   * This is the single commercial approval gate — there is no separate
   * second commercial double-check before billing.
   *
   * Access: COMMERCIAL, ADMIN
   */
  @Put(':id/budget-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL)
  async budgetApprove(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.budgetApprove(id, userId);
  }

  /**
   * PUT /task-quotes/:id/internal-approve
   * Financial/admin final approval → triggers invoices + NFS-e (BUDGET_APPROVED → BILLING_APPROVED).
   * Requires the linked task to be COMPLETED.
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/internal-approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async internalApprove(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.internalApprove(id, userId);
  }

  /**
   * PUT /task-quotes/:id/revert-billing
   * Revert billing approval back to BUDGET_APPROVED — requires all bank slips and NFS-e cancelled.
   *
   * Access: FINANCIAL, ADMIN
   */
  @Put(':id/revert-billing')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async revertBillingApproval(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.revertBillingApproval(id, userId);
  }

  /**
   * POST /task-quotes/:id/sync-em-negociacao
   * Force a reconciliation of the "Em Negociação" SO against current quote/artwork
   * state. Idempotent — safe to call any time to recover from a stuck state.
   *
   * Access: ADMIN, FINANCIAL, COMMERCIAL
   */
  @Post(':id/sync-em-negociacao')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  async syncEmNegociacao(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.taskQuoteService.syncEmNegociacao(id, userId);
  }

  /**
   * PATCH /task-quotes/:id/customer-config-order-number
   * Update only the orderNumber field on a CustomerConfig.
   * Safe to call on locked quotes (BILLING_APPROVED+) — skips the financial obligation guard
   * because orderNumber is metadata used in NFS-e discriminacao, not a financial value.
   *
   * Access: FINANCIAL, COMMERCIAL, ADMIN
   */
  @Patch(':id/customer-config-order-number')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL)
  @HttpCode(HttpStatus.OK)
  async updateCustomerConfigOrderNumber(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { customerId: string; orderNumber: string | null },
  ) {
    if (!body.customerId) {
      throw new BadRequestException('customerId é obrigatório.');
    }
    return this.taskQuoteService.updateCustomerConfigOrderNumber(id, body.customerId, body.orderNumber ?? null);
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
  // Belt-and-suspenders cache busting — public dossier/budget data must always be
  // 100% fresh because customers see it through long-lived shareable links and
  // any intermediate proxy/CDN must NEVER cache the body.
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate, private')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @Header('Surrogate-Control', 'no-store')
  @Header('Vary', '*')
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
   *
   * Access: PUBLIC (no authentication required). There is no dedicated share
   * token — the unguessable quote UUID is the link capability (same as
   * GET public/:id). The service therefore enforces the strongest available
   * checks: the quote must NOT be expired and must be in a signature-pending
   * status (PENDING or BUDGET_APPROVED); uploads are rejected otherwise.
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
