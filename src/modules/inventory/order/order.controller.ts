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
import { multerConfig } from '@modules/common/file/config/upload.config';
import { FileService } from '@modules/common/file/file.service';
import { OrderService } from './order.service';
import { OrderItemService } from './order-item.service';
import { OrderScheduleService } from './order-schedule.service';
import { UserId } from '../../common/auth/decorators/user.decorator';
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
  orderScheduleBatchCreateSchema,
  orderScheduleBatchUpdateSchema,
  orderScheduleBatchDeleteSchema,
  orderScheduleQuerySchema,
  orderItemQuerySchema,
  orderScheduleGetByIdSchema,
  orderItemBatchCreateSchema,
  orderItemBatchUpdateSchema,
  orderItemBatchDeleteSchema,
} from '../../../schemas/order';
import type {
  OrderGetManyFormData,
  OrderCreateFormData,
  OrderUpdateFormData,
  OrderBatchCreateFormData,
  OrderBatchUpdateFormData,
  OrderBatchDeleteFormData,
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
} from '../../../types';

@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly orderItemService: OrderItemService,
    private readonly orderScheduleService: OrderScheduleService,
    private readonly fileService: FileService,
  ) {}

  // =====================
  // Order Query Operations
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(orderGetManySchema)) query: OrderGetManyFormData,
    @UserId() userId: string,
  ): Promise<OrderGetManyResponse> {
    return this.orderService.findMany(query);
  }

  // =====================
  // Order CRUD Operations
  // =====================

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(orderCreateSchema)) data: OrderCreateFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderCreateResponse> {
    return this.orderService.create(data, query.include, userId);
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
  ): Promise<OrderBatchUpdateResponse<OrderUpdateFormData>> {
    return this.orderService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(orderBatchDeleteSchema)) data: OrderBatchDeleteFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderBatchDeleteResponse> {
    return this.orderService.batchDelete(data, query.include, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderGetUniqueResponse> {
    return this.orderService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(orderUpdateSchema)) data: OrderUpdateFormData,
    @Query(new ZodQueryValidationPipe(orderQuerySchema)) query: OrderQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderUpdateResponse> {
    return this.orderService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<OrderDeleteResponse> {
    return this.orderService.delete(id, userId);
  }

  // File Upload Endpoints
  @Post(':id/upload/budgets')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadBudget(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const order = await this.orderService.findById(id, { supplier: true });
    const supplierName = order.data.supplier?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'orderBudgets',
      entityId: id,
      entityType: 'order',
      supplierName,
    });
  }

  @Post(':id/upload/invoices')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const order = await this.orderService.findById(id, { supplier: true });
    const supplierName = order.data.supplier?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'orderNfes',
      entityId: id,
      entityType: 'order',
      supplierName,
    });
  }

  @Post(':id/upload/receipts')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const order = await this.orderService.findById(id, { supplier: true });
    const supplierName = order.data.supplier?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'orderReceipts',
      entityId: id,
      entityType: 'order',
      supplierName,
    });
  }

  @Post(':id/upload/reimbursements')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadReimbursement(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const order = await this.orderService.findById(id, { supplier: true });
    const supplierName = order.data.supplier?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'orderReembolsos',
      entityId: id,
      entityType: 'order',
      supplierName,
    });
  }

  @Post(':id/upload/reimbursement-invoices')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadReimbursementInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const order = await this.orderService.findById(id, { supplier: true });
    const supplierName = order.data.supplier?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'orderNfeReembolsos',
      entityId: id,
      entityType: 'order',
      supplierName,
    });
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
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
    const updates = data.ids.map(id => ({
      id,
      data: { fulfilledAt: new Date() },
    }));
    return this.orderItemService.batchUpdate({ orderItems: updates }, query.include, userId);
  }

  @Put('batch/mark-received')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchMarkReceived(
    @Body() data: { items: Array<{ id: string; receivedQuantity: number }> },
    @Query(new ZodQueryValidationPipe(orderItemQuerySchema)) query: OrderItemQueryFormData,
    @UserId() userId: string,
  ): Promise<OrderItemBatchUpdateResponse<OrderItemUpdateFormData>> {
    const updates = data.items.map(item => ({
      id: item.id,
      data: {
        receivedQuantity: item.receivedQuantity,
        receivedAt: new Date(),
      },
    }));
    return this.orderItemService.batchUpdate({ orderItems: updates }, query.include, userId);
  }

  // =====================
  // Dynamic routes (must come after static routes)
  // =====================

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
  constructor(private readonly orderScheduleService: OrderScheduleService) {}

  // =====================
  // OrderSchedule Query Operations
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
