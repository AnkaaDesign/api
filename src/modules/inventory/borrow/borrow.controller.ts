// borrow.controller.ts

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
} from '@nestjs/common';
import { BorrowService } from './borrow.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  BorrowBatchCreateResponse,
  BorrowBatchDeleteResponse,
  BorrowBatchUpdateResponse,
  BorrowCreateResponse,
  BorrowDeleteResponse,
  BorrowGetManyResponse,
  BorrowGetUniqueResponse,
  BorrowUpdateResponse,
} from '../../../types';
import {
  BorrowCreateFormData,
  BorrowUpdateFormData,
  BorrowGetManyFormData,
  BorrowBatchCreateFormData,
  BorrowBatchUpdateFormData,
  BorrowBatchDeleteFormData,
  BorrowInclude,
  BorrowQueryFormData,
  borrowCreateSchema,
  borrowBatchCreateSchema,
  borrowBatchDeleteSchema,
  borrowBatchUpdateSchema,
  borrowGetManySchema,
  borrowUpdateSchema,
  borrowQuerySchema,
  borrowGetByIdSchema,
} from '../../../schemas/borrow';

@Controller('borrows')
export class BorrowController {
  constructor(private readonly borrowService: BorrowService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(borrowGetManySchema)) query: BorrowGetManyFormData,
  ): Promise<BorrowGetManyResponse> {
    return this.borrowService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(borrowCreateSchema)) data: BorrowCreateFormData,
    @Query(new ZodQueryValidationPipe(borrowQuerySchema)) query: BorrowQueryFormData,
    @UserId() userId: string,
  ): Promise<BorrowCreateResponse> {
    return this.borrowService.create(data, query.include, userId);
  }

  // Batch Operations - Must come before dynamic :id routes
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(borrowBatchCreateSchema)) data: BorrowBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(borrowQuerySchema)) query: BorrowQueryFormData,
    @UserId() userId: string,
  ): Promise<BorrowBatchCreateResponse<BorrowCreateFormData>> {
    return this.borrowService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(borrowBatchUpdateSchema)) data: BorrowBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(borrowQuerySchema)) query: BorrowQueryFormData,
    @UserId() userId: string,
  ): Promise<BorrowBatchUpdateResponse<BorrowUpdateFormData>> {
    return this.borrowService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(borrowBatchDeleteSchema)) data: BorrowBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<BorrowBatchDeleteResponse> {
    return this.borrowService.batchDelete(data, userId);
  }

  // Dynamic routes with :id parameter - Must come after static routes
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(borrowQuerySchema)) query: BorrowQueryFormData,
  ): Promise<BorrowGetUniqueResponse> {
    return this.borrowService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(borrowUpdateSchema)) data: BorrowUpdateFormData,
    @Query(new ZodQueryValidationPipe(borrowQuerySchema)) query: BorrowQueryFormData,
    @UserId() userId: string,
  ): Promise<BorrowUpdateResponse> {
    return this.borrowService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<BorrowDeleteResponse> {
    return this.borrowService.delete(id, userId);
  }

  @Put(':id/lost')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async markAsLost(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<BorrowUpdateResponse> {
    return this.borrowService.markAsLost(id, undefined, userId);
  }
}
