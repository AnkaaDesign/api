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
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { FileService } from '@modules/common/file/file.service';
import { OrderService } from './order.service';
import { OrderItemService } from './order-item.service';
import { OrderScheduleService } from './order-schedule.service';
import { OrderScheduleScheduler } from './order-schedule.scheduler';
import { OrderAnalyticsService } from './order-analytics.service';
import { UserId, User } from '../../common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '../../common/pipes/array-fix.pipe';
import {
  orderGetManySchema,
  orderCreateSchema,
  orderUpdateSchema,
  orderBatchCreateSchema,
  orderBatchUpdateSchema,
  orderBatchDeleteSchema,
  orderQuerySchema,
  orderItemGetManySchema,
  orderItemCreateSchema,
  orderItemUpdateSchema,
  orderItemGetByIdSchema,
  orderScheduleGetManySchema,
  orderScheduleCreateSchema,
  orderScheduleUpdateSchema,
  orderGetByIdSchema,
  orderBatchPaymentSchema,
  orderScheduleBatchCreateSchema,
  orderScheduleBatchUpdateSchema,
  orderScheduleBatchDeleteSchema,
  orderScheduleQuerySchema,
  orderScheduleTriggerSchema,
  orderItemQuerySchema,
  orderScheduleGetByIdSchema,
  orderItemBatchCreateSchema,
  orderItemBatchUpdateSchema,
  orderItemBatchDeleteSchema,
} from '../../../schemas/order';
import {
  orderAnalyticsSchema,
  type OrderAnalyticsFormData,
} from '../../../schemas/order-analytics';
import type { OrderAnalyticsResponse } from '../../../types/order-analytics';
import type {
  OrderGetManyFormData,
  OrderCreateFormData,
  OrderUpdateFormData,
  OrderBatchCreateFormData,
  OrderBatchUpdateFormData,
  OrderBatchDeleteFormData,
  OrderBatchPaymentFormData,
  OrderQueryFormData,
  OrderItemGetManyFormData,
  OrderItemCreateFormData,
  OrderItemUpdateFormData,
  OrderScheduleGetManyFormData,
  OrderScheduleCreateFormData,
  OrderScheduleUpdateFormData,
  OrderScheduleBatchCreateFormData,
  OrderScheduleBatchUpdateFormData,
  OrderScheduleBatchDeleteFormData,
  OrderScheduleQueryFormData,
  OrderScheduleTriggerFormData,
  OrderItemQueryFormData,
  OrderItemBatchCreateFormData,
  OrderItemBatchUpdateFormData,
  OrderItemBatchDeleteFormData,
} from '../../../schemas/order';
import {
  OrderGetUniqueResponse,
  OrderGetManyResponse,
  OrderCreateResponse,
  OrderUpdateResponse,
  OrderDeleteResponse,
  OrderBatchCreateResponse,
  OrderBatchUpdateResponse,
  OrderBatchDeleteResponse,
  OrderItemGetUniqueResponse,
  OrderItemGetManyResponse,
  OrderItemCreateResponse,
  OrderItemUpdateResponse,
  OrderItemDeleteResponse,
  OrderItemBatchCreateResponse,
  OrderItemBatchUpdateResponse,
  OrderItemBatchDeleteResponse,
  OrderScheduleGetUniqueResponse,
  OrderScheduleGetManyResponse,
  OrderScheduleCreateResponse,
  OrderScheduleUpdateResponse,
  OrderScheduleDeleteResponse,
  OrderScheduleBatchCreateResponse,
  OrderScheduleBatchUpdateResponse,
  OrderScheduleBatchDeleteResponse,
  OrderPaymentSummaryResponse,
  PayablesResponse,
} from '../../../types';

@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly orderItemService: OrderItemService,
    private readonly orderScheduleService: OrderScheduleService,
    private readonly orderAnalyticsService: OrderAnalyticsService,
    private readonly fileService: FileService,
  ) {}

  // =====================
  // Order Analytics
  // =====================

  @Post('analytics')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
  )
  @HttpCode(HttpStatus.OK)
  async getOrderAnalytics(
    @Body(new ZodValidationPipe(orderAnalyticsSchema)) data: OrderAnalyticsFormData,
    @UserId() userId: string,
  ): Promise<OrderAnalyticsResponse> {
    return this.orderAnalyticsService.getOrderAnalytics(data);
  }

  // =====================
  // Order Query Operations
  // =====================

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(orderGetManySchema)) query: OrderGetManyFormData,
    @UserId() userId: string,
  ): Promise<OrderGetManyResponse> {
    return this.orderService.findMany(query);
  }

  // Predicted next order number (highest saved + 1), used to preview the order code
  // in the create form's PDF before the order is saved. Declared before @Get(':id')
  // so "next-number" isn't captured as an :id param.
  @Get('next-number')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.ACCOUNTING)
  async getNextNumber(): Promise<{ success: boolean; data: { nextOrderNumber: number } }> {
    const nextOrderNumber = await this.orderService.getNextOrderNumber();
    return { success: true, data: { nextOrderNumber } };
  }

  // Per-paymentStatus aggregates for the Contas a Pagar summary cards (count +
  // payable total per bucket; PAID windowed to the last 90 days). Declared
  // before @Get(':id') so "payment-summary" isn't captured as an :id param.
  @Get('payment-summary')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getPaymentSummary(): Promise<OrderPaymentSummaryResponse> {
    return this.orderService.getPaymentSummary();
  }

  // Unified payables list (orders + airbrushing painter payments + scheduled/expected).
  // Declared before @Get(':id') so "payables" isn't captured as an :id param.
  @Get('payables')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async getPayables(): Promise<PayablesResponse> {
    return this.orderService.getPayables();
  }

  // =====================
  // Order CRUD Operations
  // =====================

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
      ],
      multerConfig,
    ),
  )
  async create(
    @Body(new ZodValidationPipe(orderCreateSchema)) data: OrderCreateFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
    },
  ): Promise<OrderCreateResponse> {
    return this.orderService.create(data, query.include, userId, files);
  }

  // =====================
  // Order Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(orderBatchCreateSchema)) data: OrderBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderBatchCreateResponse<OrderCreateFormData>> {
    return this.orderService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(orderBatchUpdateSchema)) data: OrderBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
    @User('role') userRole: string,
  ): Promise<OrderBatchUpdateResponse<OrderUpdateFormData>> {
    return this.orderService.batchUpdate(data, query.include, userId, userRole);
  }

  @Delete('batch')
  // Deletion is ADMIN-only — WAREHOUSE manages orders but must never delete them.
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(orderBatchDeleteSchema)) data: OrderBatchDeleteFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderBatchDeleteResponse> {
    return this.orderService.batchDelete(data, query.include, userId);
  }

  // =====================
  // Payment workflow — batch (contas a pagar)
  // Declared BEFORE the :id routes so "batch" isn't captured as an :id param.
  // =====================

  @Put('batch/mark-awaiting-payment')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async batchMarkAwaitingPayment(
    @Body(new ZodValidationPipe(orderBatchPaymentSchema)) data: OrderBatchPaymentFormData,
    @UserId() userId: string,
  ): Promise<OrderBatchUpdateResponse<{ id: string }>> {
    return this.orderService.batchMarkAwaitingPayment(data.orderIds, userId);
  }

  @Put('batch/mark-paid')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async batchMarkPaid(
    @Body(new ZodValidationPipe(orderBatchPaymentSchema)) data: OrderBatchPaymentFormData,
    @UserId() userId: string,
  ): Promise<OrderBatchUpdateResponse<{ id: string }>> {
    return this.orderService.batchMarkPaid(data.orderIds, userId);
  }

  @Put('batch/request-payment')
  // "Requisitar Pagamento" (PENDING → AWAITING_PAYMENT) is ADMIN-only — the class has
  // no @Roles, so a lone method @Roles(ADMIN) restricts to ADMIN (see batchDelete).
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async batchRequestPayment(
    @Body(new ZodValidationPipe(orderBatchPaymentSchema)) data: OrderBatchPaymentFormData,
    @UserId() userId: string,
  ): Promise<OrderBatchUpdateResponse<{ id: string }>> {
    return this.orderService.batchRequestPayment(data.orderIds, userId);
  }

  @Put('batch/cancel-payment-request')
  // Undo of "Requisitar Pagamento" (AWAITING_PAYMENT → PENDING) — ADMIN-only.
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async batchCancelPaymentRequest(
    @Body(new ZodValidationPipe(orderBatchPaymentSchema)) data: OrderBatchPaymentFormData,
    @UserId() userId: string,
  ): Promise<OrderBatchUpdateResponse<{ id: string }>> {
    return this.orderService.batchCancelPaymentRequest(data.orderIds, userId);
  }

  // =====================
  // Payment workflow — single order (contas a pagar)
  // =====================

  @Put('installments/:installmentId/mark-paid')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async markInstallmentPaid(
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @UserId() userId: string,
  ): Promise<OrderUpdateResponse> {
    return this.orderService.markInstallmentPaid(installmentId, userId);
  }

  @Put(':id/fiscal-documents')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async linkFiscalDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { fiscalDocumentIds?: string[] },
  ): Promise<OrderUpdateResponse> {
    return this.orderService.linkFiscalDocuments(id, body?.fiscalDocumentIds ?? []);
  }

  @Put(':id/mark-awaiting-payment')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async markAwaitingPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderUpdateResponse> {
    return this.orderService.markAwaitingPayment(id, userId);
  }

  @Put(':id/mark-paid')
  // Financial-only: WAREHOUSE manages orders but never their payment side.
  @Roles(
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.ADMIN,
  )
  async markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderUpdateResponse> {
    return this.orderService.markPaid(id, userId);
  }

  @Put(':id/request-payment')
  // "Requisitar Pagamento" (PENDING → AWAITING_PAYMENT) is ADMIN-only.
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async requestPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderUpdateResponse> {
    return this.orderService.requestPayment(id, userId);
  }

  @Put(':id/cancel-payment-request')
  // Undo of "Requisitar Pagamento" (AWAITING_PAYMENT → PENDING) — ADMIN-only.
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async cancelPaymentRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderUpdateResponse> {
    return this.orderService.cancelPaymentRequest(id, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderGetUniqueResponse> {
    return this.orderService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
      ],
      multerConfig,
    ),
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(orderUpdateSchema)) data: OrderUpdateFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
    @User('role') userRole: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
    },
  ): Promise<OrderUpdateResponse> {
    return this.orderService.update(id, data, query.include, userId, files, userRole);
  }

  @Delete(':id')
  // Deletion is ADMIN-only — WAREHOUSE manages orders but must never delete them.
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderDeleteResponse> {
    return this.orderService.delete(id, userId);
  }

  // =====================
  // DEPRECATED File Upload Endpoints
  // =====================
  // These endpoints are deprecated. Use PUT /orders/:id with file fields instead.

  @Post(':id/upload/receipts')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async uploadReceipt() {
    throw new BadRequestException(
      'Este endpoint está obsoleto. Use PUT /orders/:id com campo "receipts" para enviar arquivos.',
    );
  }
}

// =====================
// OrderItem Controller
// =====================

@Controller('order-items')
export class OrderItemController {
  constructor(private readonly orderItemService: OrderItemService) {}

  // =====================
  // OrderItem Query Operations
  // =====================

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(orderItemGetManySchema)) query: OrderItemGetManyFormData,
    @UserId() userId: string,
  ): Promise<OrderItemGetManyResponse> {
    return this.orderItemService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(orderItemCreateSchema)) data: OrderItemCreateFormData,
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemCreateResponse> {
    return this.orderItemService.create(data, query.include, userId);
  }

  // =====================
  // OrderItem Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(orderItemBatchCreateSchema)) data: OrderItemBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemBatchCreateResponse<OrderItemCreateFormData>> {
    return this.orderItemService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(orderItemBatchUpdateSchema)) data: OrderItemBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemBatchUpdateResponse<OrderItemUpdateFormData>> {
    return this.orderItemService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(orderItemBatchDeleteSchema)) data: OrderItemBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<OrderItemBatchDeleteResponse> {
    return this.orderItemService.batchDelete(data, userId);
  }

  // =====================
  // Specialized Batch Operations
  // =====================

  @Put('batch/mark-fulfilled')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchMarkFulfilled(
    @Body() data: { ids: string[] },
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemBatchUpdateResponse<OrderItemUpdateFormData>> {
    if (!data || !Array.isArray(data.ids) || data.ids.length === 0) {
      throw new BadRequestException('Informe ao menos um item para marcar como recebido/feito.');
    }
    if (data.ids.some(id => typeof id !== 'string' || !id.trim())) {
      throw new BadRequestException('Lista de itens contém identificador inválido.');
    }
    const updates = data.ids.map(id => ({
      id,
      data: { fulfilledAt: new Date() },
    }));
    return this.orderItemService.batchUpdate({ orderItems: updates }, query.include, userId);
  }

  @Put('batch/mark-received')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async batchMarkReceived(
    @Body() data: { items: Array<{ id: string; receivedQuantity: number }> },
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemBatchUpdateResponse<OrderItemUpdateFormData>> {
    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      throw new BadRequestException('Informe ao menos um item para marcar como recebido.');
    }
    for (const item of data.items) {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) {
        throw new BadRequestException('Item inválido na lista de recebimento.');
      }
      const qty = Number(item.receivedQuantity);
      if (!Number.isFinite(qty) || qty < 0) {
        throw new BadRequestException('Quantidade recebida deve ser um número maior ou igual a zero.');
      }
    }
    const updates = data.items.map(item => ({
      id: item.id,
      data: {
        receivedQuantity: Number(item.receivedQuantity),
        receivedAt: new Date(),
      },
    }));
    return this.orderItemService.batchUpdate({ orderItems: updates }, query.include, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  // Linhas temporárias não vinculadas + candidatos do catálogo para conversão.
  // Declarado ANTES de @Get(':id') para não ser capturado pela rota dinâmica.
  @Get('temporary/suggestions')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  async findTemporaryItemSuggestions() {
    return this.orderItemService.findTemporaryItemSuggestions();
  }

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemGetUniqueResponse> {
    return this.orderItemService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(orderItemUpdateSchema)) data: OrderItemUpdateFormData,
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemUpdateResponse> {
    return this.orderItemService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderItemDeleteResponse> {
    return this.orderItemService.delete(id, userId);
  }
}

// =====================
// OrderSchedule Controller
// =====================

@Controller('order-schedules')
export class OrderScheduleController {
  constructor(
    private readonly orderScheduleService: OrderScheduleService,
    private readonly orderScheduleScheduler: OrderScheduleScheduler,
  ) {}

  // =====================
  // OrderSchedule Query Operations
  // =====================

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(orderScheduleGetManySchema))
    query: OrderScheduleGetManyFormData,
    @UserId() userId: string,
  ): Promise<OrderScheduleGetManyResponse> {
    return this.orderScheduleService.findMany(query);
  }

  // =====================
  // OrderSchedule CRUD Operations
  // =====================

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(orderScheduleCreateSchema))
    data: OrderScheduleCreateFormData,
    @Query(new ZodQueryValidationPipe(orderScheduleQuerySchema)) query: OrderScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderScheduleCreateResponse> {
    return this.orderScheduleService.create(data, query.include, userId);
  }

  // =====================
  // OrderSchedule Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(orderScheduleBatchCreateSchema))
    data: OrderScheduleBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(orderScheduleQuerySchema)) query: OrderScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderScheduleBatchCreateResponse<OrderScheduleCreateFormData>> {
    return this.orderScheduleService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(orderScheduleBatchUpdateSchema))
    data: OrderScheduleBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(orderScheduleQuerySchema)) query: OrderScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderScheduleBatchUpdateResponse<OrderScheduleUpdateFormData>> {
    return this.orderScheduleService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  // Deletion is ADMIN-only — WAREHOUSE manages schedules but must never delete them.
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(orderScheduleBatchDeleteSchema))
    data: OrderScheduleBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<OrderScheduleBatchDeleteResponse> {
    return this.orderScheduleService.batchDelete(data, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(orderScheduleQuerySchema)) query: OrderScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderScheduleGetUniqueResponse> {
    return this.orderScheduleService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(orderScheduleUpdateSchema))
    data: OrderScheduleUpdateFormData,
    @Query(new ZodQueryValidationPipe(orderScheduleQuerySchema)) query: OrderScheduleQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderScheduleUpdateResponse> {
    return this.orderScheduleService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  // Deletion is ADMIN-only — WAREHOUSE manages schedules but must never delete them.
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderScheduleDeleteResponse> {
    return this.orderScheduleService.delete(id, userId);
  }

  /**
   * Get calculated quantities for a schedule (preview/testing)
   */
  @Get(':id/calculated-quantities')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getCalculatedQuantities(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { itemId: string; quantity: number; reason: string; itemName: string }[];
  }> {
    try {
      const calculatedQuantities = await this.orderScheduleService.getCalculatedQuantities(id);
      return {
        success: true,
        message: `Quantidades calculadas para o agendamento ${id}.`,
        data: calculatedQuantities,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create an order from schedule with calculated quantities (manual trigger)
   */
  @Post(':id/create-order')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async createOrderFromSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    try {
      const orderData = await this.orderScheduleService.createOrderFromSchedule(id, userId);

      if (!orderData) {
        return {
          success: true,
          message: 'Nenhum pedido foi necessário. Os níveis de estoque estão adequados.',
          data: null,
        };
      }

      // For this endpoint, we return the order data without actually creating the order
      // This allows for preview/testing
      return {
        success: true,
        message: `Dados do pedido calculados para o agendamento ${id}.`,
        data: orderData,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Trigger-preview projection for the details page: per item, the quantity +
   * cost each "Executar agora" cascade mode (GAP_ONLY vs GAP_PLUS_CYCLE) will
   * create. Column totals reconcile exactly with the trigger dialog buttons.
   */
  @Get(':id/projection')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async getProjection(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ReturnType<OrderScheduleService['getScheduleProjection']>> {
    return this.orderScheduleService.getScheduleProjection(id);
  }

  /**
   * Batch expected-order-total per schedule (the projected cost when each fires
   * on its scheduled date). Powers the "expected price" column in the schedule
   * list without N per-row projection calls.
   */
  @Post('expected-totals')
  @HttpCode(HttpStatus.OK)
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getExpectedTotals(
    @Body() body: { scheduleIds?: string[] },
  ): Promise<{
    success: boolean;
    data: Array<{ id: string; expectedTotal: number; nextRun: Date | null; gapDays: number }>;
  }> {
    const data = await this.orderScheduleService.getExpectedTotals(body?.scheduleIds ?? []);
    return { success: true, data };
  }

  /**
   * Trigger a schedule NOW — actually creates the order (unlike the preview-only
   * `create-order` endpoint). `cascadeMode` controls coverage + nextRun:
   * GAP_ONLY (bridge) or GAP_PLUS_CYCLE (pull-forward).
   */
  @Post(':id/trigger')
  // Finance can materialize a scheduled (recurrent) order from Contas a Pagar
  // to then settle it — "Previsto/Recorrente → gerar pedido".
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING)
  @HttpCode(HttpStatus.CREATED)
  async triggerNow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(orderScheduleTriggerSchema)) data: OrderScheduleTriggerFormData,
    @UserId() userId: string,
  ): Promise<{ success: boolean; message: string; data: any }> {
    return this.orderScheduleScheduler.triggerNow(id, data.cascadeMode, userId);
  }

  /**
   * Finish a schedule and auto-create the next instance
   */
  @Put(':id/finish')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async finishSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderScheduleUpdateResponse> {
    return this.orderScheduleService.finishSchedule(id, userId);
  }
}
