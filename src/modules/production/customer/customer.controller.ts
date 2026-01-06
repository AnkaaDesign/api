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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { CustomerService } from './customer.service';
import { UserId } from '../../common/auth/decorators/user.decorator';
import { Roles } from '../../common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
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
  customerMergeSchema,
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
  CustomerMergeFormData,
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
  CustomerMergeResponse,
  Customer,
} from '../../../types';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,

    SECTOR_PRIVILEGES.ADMIN,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(customerGetManySchema)) query: CustomerGetManyFormData,
    @UserId() userId: string,
  ): Promise<CustomerGetManyResponse> {
    return this.customerService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('logo', multerConfig))
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(customerCreateSchema))
    data: CustomerCreateFormData,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
    @UploadedFile() logo?: Express.Multer.File,
  ): Promise<CustomerCreateResponse> {
    return this.customerService.create(data, query.include, userId, logo);
  }

  @Post('quick')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
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
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(customerBatchCreateSchema)) data: CustomerBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(customerBatchQuerySchema)) query: CustomerBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerBatchCreateResponse> {
    return this.customerService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(customerBatchUpdateSchema)) data: CustomerBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(customerBatchQuerySchema)) query: CustomerBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerBatchUpdateResponse> {
    return this.customerService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(customerBatchDeleteSchema)) data: CustomerBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<CustomerBatchDeleteResponse> {
    return this.customerService.batchDelete(data, userId);
  }

  @Post('merge')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async merge(
    @Body(new ZodValidationPipe(customerMergeSchema)) data: CustomerMergeFormData,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerMergeResponse> {
    return this.customerService.merge(data, query.include, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,

    SECTOR_PRIVILEGES.ADMIN,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
  ): Promise<CustomerGetUniqueResponse> {
    return this.customerService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(FileInterceptor('logo', multerConfig))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(customerUpdateSchema))
    data: CustomerUpdateFormData,
    @Query(new ZodQueryValidationPipe(customerQuerySchema)) query: CustomerQueryFormData,
    @UserId() userId: string,
    @UploadedFile() logo?: Express.Multer.File,
  ): Promise<CustomerUpdateResponse> {
    return this.customerService.update(id, data, query.include, userId, logo);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<CustomerDeleteResponse> {
    return this.customerService.delete(id, userId);
  }
}
