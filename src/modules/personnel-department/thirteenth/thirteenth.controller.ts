// thirteenth.controller.ts
// 13º salário (gratificação natalina — Departamento Pessoal / Contabilidade).

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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import { SECTOR_PRIVILEGES } from '../../../constants';
import { ThirteenthService } from './thirteenth.service';
import {
  thirteenthCreateSchema,
  thirteenthGenerateSchema,
  thirteenthGetManySchema,
  thirteenthPayInstallmentSchema,
  thirteenthQuerySchema,
  thirteenthUpdateSchema,
} from './dto/thirteenth.dto';
import type {
  ThirteenthCreateFormData,
  ThirteenthDeleteResponse,
  ThirteenthDocumentResponse,
  ThirteenthGenerateFormData,
  ThirteenthGenerateResponse,
  ThirteenthGetManyFormData,
  ThirteenthGetManyResponse,
  ThirteenthGetUniqueResponse,
  ThirteenthMutationResponse,
  ThirteenthPayInstallmentFormData,
  ThirteenthQueryFormData,
  ThirteenthUpdateFormData,
} from './dto/thirteenth.dto';

@Controller('thirteenths')
@UseGuards(AuthGuard)
@Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
export class ThirteenthController {
  constructor(private readonly thirteenthService: ThirteenthService) {}

  // ---- List ----
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(thirteenthGetManySchema))
    query: ThirteenthGetManyFormData,
  ): Promise<ThirteenthGetManyResponse> {
    return this.thirteenthService.findMany(query);
  }

  // ---- Batch generation (static — before dynamic :id) ----
  @Post('generate')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async generate(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(thirteenthGenerateSchema))
    data: ThirteenthGenerateFormData,
  ): Promise<ThirteenthGenerateResponse> {
    return this.thirteenthService.generateForYear(data);
  }

  // ---- Create ----
  @Post()
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(thirteenthCreateSchema))
    data: ThirteenthCreateFormData,
    @Query(new ZodQueryValidationPipe(thirteenthQuerySchema))
    query: ThirteenthQueryFormData,
  ): Promise<ThirteenthMutationResponse> {
    return this.thirteenthService.create(data, query.include);
  }

  // ---- Read by id ----
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(thirteenthQuerySchema))
    query: ThirteenthQueryFormData,
  ): Promise<ThirteenthGetUniqueResponse> {
    return this.thirteenthService.findById(id, query.include);
  }

  // ---- Payable installment documents ----
  @Get(':id/document/first')
  @ReadRateLimit()
  async firstInstallmentDocument(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ThirteenthDocumentResponse> {
    return this.thirteenthService.getInstallmentDocument(id, 1);
  }

  @Get(':id/document/second')
  @ReadRateLimit()
  async secondInstallmentDocument(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ThirteenthDocumentResponse> {
    return this.thirteenthService.getInstallmentDocument(id, 2);
  }

  // ---- Update ----
  @Put(':id')
  @WriteRateLimit()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(thirteenthUpdateSchema))
    data: ThirteenthUpdateFormData,
    @Query(new ZodQueryValidationPipe(thirteenthQuerySchema))
    query: ThirteenthQueryFormData,
  ): Promise<ThirteenthMutationResponse> {
    return this.thirteenthService.update(id, data, query.include);
  }

  // ---- Pay installments (status transitions) ----
  @Post(':id/pay/first')
  @WriteRateLimit()
  async payFirst(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(thirteenthPayInstallmentSchema))
    data: ThirteenthPayInstallmentFormData,
  ): Promise<ThirteenthMutationResponse> {
    return this.thirteenthService.payFirstInstallment(id, data);
  }

  @Post(':id/pay/second')
  @WriteRateLimit()
  async paySecond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(thirteenthPayInstallmentSchema))
    data: ThirteenthPayInstallmentFormData,
  ): Promise<ThirteenthMutationResponse> {
    return this.thirteenthService.paySecondInstallment(id, data);
  }

  // ---- Delete (ADMIN only) ----
  @Delete(':id')
  @WriteRateLimit()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<ThirteenthDeleteResponse> {
    return this.thirteenthService.delete(id);
  }
}
