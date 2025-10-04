import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UsePipes,
} from '@nestjs/common';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../constants/enums';
import { PaintBrandService } from './paint-brand.service';
import {
  paintBrandGetManySchema,
  paintBrandGetByIdSchema,
  paintBrandCreateSchema,
  paintBrandUpdateSchema,
  paintBrandBatchCreateSchema,
  paintBrandBatchUpdateSchema,
  paintBrandBatchDeleteSchema,
  paintBrandQuerySchema,
} from '../../schemas/paint';
import type {
  PaintBrandGetManyFormData,
  PaintBrandGetByIdFormData,
  PaintBrandCreateFormData,
  PaintBrandUpdateFormData,
  PaintBrandBatchCreateFormData,
  PaintBrandBatchUpdateFormData,
  PaintBrandBatchDeleteFormData,
  PaintBrandQueryFormData,
} from '../../schemas/paint';

@Controller('paint-brands')
export class PaintBrandController {
  constructor(private readonly paintBrandService: PaintBrandService) {}

  // =====================
  // Standard CRUD Operations
  // =====================

  @Get()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintBrandGetManySchema))
  async findMany(@Query() query: PaintBrandGetManyFormData) {
    return this.paintBrandService.findMany(query);
  }

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodQueryValidationPipe(paintBrandGetByIdSchema))
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaintBrandGetByIdFormData,
  ) {
    return this.paintBrandService.findById(id, query.include);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintBrandCreateSchema))
  async create(
    @Body() data: PaintBrandCreateFormData,
    @Query(new ZodQueryValidationPipe(paintBrandQuerySchema)) query: PaintBrandQueryFormData,
    @UserId() userId: string,
  ) {
    return this.paintBrandService.create(data, query.include, userId);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintBrandUpdateSchema))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: PaintBrandUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintBrandQuerySchema)) query: PaintBrandQueryFormData,
    @UserId() userId: string,
  ) {
    return this.paintBrandService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    return this.paintBrandService.delete(id, userId);
  }

  // =====================
  // Batch Operations
  // =====================

  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintBrandBatchCreateSchema))
  async batchCreate(
    @Body() data: PaintBrandBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(paintBrandQuerySchema)) query: PaintBrandQueryFormData,
    @UserId() userId: string,
  ) {
    return this.paintBrandService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UsePipes(new ZodValidationPipe(paintBrandBatchUpdateSchema))
  async batchUpdate(
    @Body() data: PaintBrandBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(paintBrandQuerySchema)) query: PaintBrandQueryFormData,
    @UserId() userId: string,
  ) {
    return this.paintBrandService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(paintBrandBatchDeleteSchema))
  async batchDelete(@Body() data: PaintBrandBatchDeleteFormData, @UserId() userId: string) {
    return this.paintBrandService.batchDelete(data, userId);
  }
}
