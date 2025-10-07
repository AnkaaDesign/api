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
import { AirbrushingService } from './airbrushing.service';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  airbrushingGetManySchema,
  airbrushingGetByIdSchema,
  airbrushingCreateSchema,
  airbrushingUpdateSchema,
  airbrushingBatchCreateSchema,
  airbrushingBatchUpdateSchema,
  airbrushingBatchDeleteSchema,
  airbrushingQuerySchema,
} from '../../../schemas/airbrushing';
import type {
  AirbrushingGetManyFormData,
  AirbrushingQueryFormData,
  AirbrushingGetByIdFormData,
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingBatchCreateFormData,
  AirbrushingBatchUpdateFormData,
  AirbrushingBatchDeleteFormData,
} from '../../../schemas/airbrushing';
import type {
  AirbrushingGetUniqueResponse,
  AirbrushingGetManyResponse,
  AirbrushingCreateResponse,
  AirbrushingUpdateResponse,
  AirbrushingDeleteResponse,
  AirbrushingBatchCreateResponse,
  AirbrushingBatchUpdateResponse,
  AirbrushingBatchDeleteResponse,
  Airbrushing,
} from '../../../types';
import { UserId } from '@modules/common/auth/decorators/user.decorator';

@Controller('airbrushings')
export class AirbrushingController {
  constructor(
    private readonly airbrushingService: AirbrushingService,
    private readonly fileService: FileService,
  ) {}

  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(airbrushingGetManySchema)) query: AirbrushingGetManyFormData,
  ): Promise<AirbrushingGetManyResponse> {
    return this.airbrushingService.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(airbrushingCreateSchema)) data: AirbrushingCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingCreateResponse> {
    return this.airbrushingService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(airbrushingBatchCreateSchema)) data: AirbrushingBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchCreateResponse<AirbrushingCreateFormData>> {
    return this.airbrushingService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  async batchUpdate(
    @Body(new ZodValidationPipe(airbrushingBatchUpdateSchema)) data: AirbrushingBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchUpdateResponse<AirbrushingUpdateFormData>> {
    return this.airbrushingService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(airbrushingBatchDeleteSchema)) data: AirbrushingBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchDeleteResponse> {
    return this.airbrushingService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
  ): Promise<AirbrushingGetUniqueResponse> {
    return this.airbrushingService.findById(id, query.include);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(airbrushingUpdateSchema)) data: AirbrushingUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingUpdateResponse> {
    return this.airbrushingService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<AirbrushingDeleteResponse> {
    return this.airbrushingService.delete(id, userId);
  }

  // File Upload Endpoints
  @Post(':id/upload/budgets')
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

    const airbrushing = await this.airbrushingService.findById(id, {
      task: { include: { customer: true } }
    });
    const customerName = airbrushing.data.task?.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'airbrushingBudgets',
      entityId: id,
      entityType: 'airbrushing',
      customerName,
    });
  }

  @Post(':id/upload/invoices')
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

    const airbrushing = await this.airbrushingService.findById(id, {
      task: { include: { customer: true } }
    });
    const customerName = airbrushing.data.task?.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'airbrushingNfes',
      entityId: id,
      entityType: 'airbrushing',
      customerName,
    });
  }

  @Post(':id/upload/receipts')
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

    const airbrushing = await this.airbrushingService.findById(id, {
      task: { include: { customer: true } }
    });
    const customerName = airbrushing.data.task?.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'airbrushingReceipts',
      entityId: id,
      entityType: 'airbrushing',
      customerName,
    });
  }

  @Post(':id/upload/reimbursements')
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

    const airbrushing = await this.airbrushingService.findById(id, {
      task: { include: { customer: true } }
    });
    const customerName = airbrushing.data.task?.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'airbrushingReembolsos',
      entityId: id,
      entityType: 'airbrushing',
      customerName,
    });
  }

  @Post(':id/upload/reimbursement-invoices')
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

    const airbrushing = await this.airbrushingService.findById(id, {
      task: { include: { customer: true } }
    });
    const customerName = airbrushing.data.task?.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'airbrushingNfeReembolsos',
      entityId: id,
      entityType: 'airbrushing',
      customerName,
    });
  }

  @Post(':id/upload/artworks')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', multerConfig))
  async uploadArtwork(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @UserId() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const airbrushing = await this.airbrushingService.findById(id, {
      task: { include: { customer: true } }
    });
    const customerName = airbrushing.data.task?.customer?.fantasyName;

    return this.fileService.createFromUpload(file, undefined, userId, {
      fileContext: 'airbrushingArtworks',
      entityId: id,
      entityType: 'airbrushing',
      customerName,
    });
  }
}
