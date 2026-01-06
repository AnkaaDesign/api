// supplier.controller.ts

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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { SupplierService } from './supplier.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import type {
  SupplierBatchCreateResponse,
  SupplierBatchDeleteResponse,
  SupplierBatchUpdateResponse,
  SupplierCreateResponse,
  SupplierDeleteResponse,
  SupplierGetManyResponse,
  SupplierGetUniqueResponse,
  SupplierUpdateResponse,
} from '../../../types';
import type {
  SupplierCreateFormData,
  SupplierUpdateFormData,
  SupplierGetManyFormData,
  SupplierBatchCreateFormData,
  SupplierBatchUpdateFormData,
  SupplierBatchDeleteFormData,
  SupplierQueryFormData,
  SupplierGetByIdFormData,
} from '../../../schemas/supplier';
import {
  supplierCreateSchema,
  supplierBatchCreateSchema,
  supplierBatchDeleteSchema,
  supplierBatchUpdateSchema,
  supplierGetManySchema,
  supplierUpdateSchema,
  supplierGetByIdSchema,
  supplierQuerySchema,
} from '../../../schemas/supplier';

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(supplierGetManySchema)) query: SupplierGetManyFormData,
    @UserId() userId: string,
  ): Promise<SupplierGetManyResponse> {
    return this.supplierService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('logo', multerConfig))
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(supplierCreateSchema))
    data: SupplierCreateFormData,
    @UploadedFile() logo: Express.Multer.File | undefined,
    @Query(new ZodQueryValidationPipe(supplierQuerySchema)) query: SupplierQueryFormData,
    @UserId() userId: string,
  ): Promise<SupplierCreateResponse> {
    return this.supplierService.create(data, query.include, userId, logo);
  }

  // Batch Operations - Must come before dynamic routes
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(supplierBatchCreateSchema)) data: SupplierBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(supplierQuerySchema)) query: SupplierQueryFormData,
    @UserId() userId: string,
  ): Promise<SupplierBatchCreateResponse<SupplierCreateFormData>> {
    return this.supplierService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(supplierBatchUpdateSchema)) data: SupplierBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(supplierQuerySchema)) query: SupplierQueryFormData,
    @UserId() userId: string,
  ): Promise<SupplierBatchUpdateResponse<SupplierUpdateFormData>> {
    return this.supplierService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(supplierBatchDeleteSchema)) data: SupplierBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<SupplierBatchDeleteResponse> {
    return this.supplierService.batchDelete(data, userId);
  }

  // Dynamic routes - Must come after static routes
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(supplierQuerySchema)) query: SupplierQueryFormData,
    @UserId() userId: string,
  ): Promise<SupplierGetUniqueResponse> {
    return this.supplierService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(FileInterceptor('logo', multerConfig))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(supplierUpdateSchema))
    data: SupplierUpdateFormData,
    @UploadedFile() logo: Express.Multer.File | undefined,
    @Query(new ZodQueryValidationPipe(supplierQuerySchema)) query: SupplierQueryFormData,
    @UserId() userId: string,
  ): Promise<SupplierUpdateResponse> {
    return this.supplierService.update(id, data, query.include, userId, logo);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<SupplierDeleteResponse> {
    return this.supplierService.delete(id, userId);
  }
}
