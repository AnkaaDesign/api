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
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { UserId } from '../../common/auth/decorators/user.decorator';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '../../common/pipes/array-fix.pipe';
import {
  customerGetManySchema,
  customerGetByIdSchema,
  customerCreateSchema,
  customerQuickCreateSchema,
  customerUpdateSchema,
  customerBatchCreateSchema,
  customerBatchUpdateSchema,
  customerBatchDeleteSchema,
  customerQuerySchema,
  customerBatchQuerySchema,
} from '../../../schemas/customer';
import type {
  CustomerGetManyFormData,
  CustomerGetByIdFormData,
  CustomerCreateFormData,
  CustomerQuickCreateFormData,
  CustomerUpdateFormData,
  CustomerBatchCreateFormData,
  CustomerBatchUpdateFormData,
  CustomerBatchDeleteFormData,
  CustomerQueryFormData,
  CustomerBatchQueryFormData,
} from '../../../schemas/customer';
import type {
  CustomerCreateResponse,
  CustomerGetUniqueResponse,
  CustomerGetManyResponse,
  CustomerUpdateResponse,
  CustomerDeleteResponse,
  CustomerBatchCreateResponse,
  CustomerBatchUpdateResponse,
  CustomerBatchDeleteResponse,
  Customer,
} from '../../../types';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  // Basic CRUD Operations
  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(customerGetManySchema)) query: CustomerGetManyFormData,
    @UserId() userId: string,
  ): Promise<CustomerGetManyResponse> {
    return this.customerService.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(customerCreateSchema))
    data: CustomerCreateFormData,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerCreateResponse> {
    return this.customerService.create(data, query.include, userId);
  }

  @Post('quick')
  @HttpCode(HttpStatus.CREATED)
  async quickCreate(
    @Body(new ZodValidationPipe(customerQuickCreateSchema)) data: CustomerQuickCreateFormData,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerCreateResponse> {
    return this.customerService.quickCreate(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(customerBatchCreateSchema)) data: CustomerBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(customerBatchQuerySchema)) query: CustomerBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerBatchCreateResponse> {
    return this.customerService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  async batchUpdate(
    @Body(new ZodValidationPipe(customerBatchUpdateSchema)) data: CustomerBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(customerBatchQuerySchema)) query: CustomerBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerBatchUpdateResponse> {
    return this.customerService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(customerBatchDeleteSchema)) data: CustomerBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<CustomerBatchDeleteResponse> {
    return this.customerService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerGetUniqueResponse> {
    return this.customerService.findById(id, query.include);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(customerUpdateSchema))
    data: CustomerUpdateFormData,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerUpdateResponse> {
    return this.customerService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<CustomerDeleteResponse> {
    return this.customerService.delete(id, userId);
  }
}
