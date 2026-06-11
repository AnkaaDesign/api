// external-operation.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Patch,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { ExternalOperationService } from './external-operation.service';
import { ExternalOperationItemService } from './external-operation-item.service';
import { User, UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  ExternalOperation,
  ExternalOperationItem,
  ExternalOperationBatchCreateResponse,
  ExternalOperationBatchDeleteResponse,
  ExternalOperationBatchUpdateResponse,
  ExternalOperationCreateResponse,
  ExternalOperationDeleteResponse,
  ExternalOperationGetManyResponse,
  ExternalOperationGetUniqueResponse,
  ExternalOperationUpdateResponse,
  ExternalOperationItemBatchCreateResponse,
  ExternalOperationItemBatchDeleteResponse,
  ExternalOperationItemBatchUpdateResponse,
  ExternalOperationItemCreateResponse,
  ExternalOperationItemDeleteResponse,
  ExternalOperationItemGetManyResponse,
  ExternalOperationItemGetUniqueResponse,
  ExternalOperationItemUpdateResponse,
} from '../../../types';
import {
  ExternalOperationCreateFormData,
  ExternalOperationUpdateFormData,
  ExternalOperationGetManyFormData,
  ExternalOperationBatchCreateFormData,
  ExternalOperationBatchUpdateFormData,
  ExternalOperationBatchDeleteFormData,
  ExternalOperationInclude,
  ExternalOperationQueryFormData,
  ExternalOperationItemCreateFormData,
  ExternalOperationItemUpdateFormData,
  ExternalOperationItemGetManyFormData,
  ExternalOperationItemBatchCreateFormData,
  ExternalOperationItemBatchUpdateFormData,
  ExternalOperationItemBatchDeleteFormData,
  ExternalOperationItemInclude,
  ExternalOperationItemQueryFormData,
  externalOperationCreateSchema,
  externalOperationBatchCreateSchema,
  externalOperationBatchDeleteSchema,
  externalOperationBatchUpdateSchema,
  externalOperationGetManySchema,
  externalOperationUpdateSchema,
  externalOperationQuerySchema,
  externalOperationGetByIdSchema,
  externalOperationItemCreateSchema,
  externalOperationItemBatchCreateSchema,
  externalOperationItemBatchDeleteSchema,
  externalOperationItemBatchUpdateSchema,
  externalOperationItemGetManySchema,
  externalOperationItemUpdateSchema,
  externalOperationItemQuerySchema,
  externalOperationItemGetByIdSchema,
} from '../../../schemas';

@Controller('external-operations')
export class ExternalOperationController {
  constructor(private readonly externalOperationService: ExternalOperationService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(externalOperationGetManySchema))
    query: ExternalOperationGetManyFormData,
  ): Promise<ExternalOperationGetManyResponse> {
    return this.externalOperationService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
      ],
      multerConfig,
    ),
  )
  async create(
    @Body(new ZodValidationPipe(externalOperationCreateSchema))
    data: ExternalOperationCreateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationQuerySchema))
    query: ExternalOperationQueryFormData,
    @UserId() userId: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalOperationCreateResponse> {
    return this.externalOperationService.create(data, query.include, userId, files);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(externalOperationBatchCreateSchema))
    data: ExternalOperationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationQuerySchema))
    query: ExternalOperationQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationBatchCreateResponse<ExternalOperationCreateFormData>> {
    return this.externalOperationService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(externalOperationBatchUpdateSchema))
    data: ExternalOperationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationQuerySchema))
    query: ExternalOperationQueryFormData,
    @UserId() userId: string,
    @User('role') userPrivilege: string,
  ): Promise<ExternalOperationBatchUpdateResponse<ExternalOperationUpdateFormData>> {
    return this.externalOperationService.batchUpdate(data, query.include, userId, userPrivilege);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(externalOperationBatchDeleteSchema))
    data: ExternalOperationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationBatchDeleteResponse> {
    return this.externalOperationService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(externalOperationQuerySchema))
    query: ExternalOperationQueryFormData,
  ): Promise<ExternalOperationGetUniqueResponse> {
    return this.externalOperationService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
      ],
      multerConfig,
    ),
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(externalOperationUpdateSchema))
    data: ExternalOperationUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationQuerySchema))
    query: ExternalOperationQueryFormData,
    @UserId() userId: string,
    @User('role') userPrivilege: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalOperationUpdateResponse> {
    return this.externalOperationService.update(
      id,
      data,
      query.include,
      userId,
      files,
      userPrivilege,
    );
  }

  @Patch(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'receipts', maxCount: 10 },
        { name: 'invoices', maxCount: 10 },
      ],
      multerConfig,
    ),
  )
  async partialUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(externalOperationUpdateSchema))
    data: ExternalOperationUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationQuerySchema))
    query: ExternalOperationQueryFormData,
    @UserId() userId: string,
    @User('role') userPrivilege: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalOperationUpdateResponse> {
    return this.externalOperationService.update(
      id,
      data,
      query.include,
      userId,
      files,
      userPrivilege,
    );
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ExternalOperationDeleteResponse> {
    return this.externalOperationService.delete(id, userId);
  }

  // Billing — manual (re)trigger of the invoice/NFS-e/boleto pipeline
  // (recovery path for CHARGED withdrawals whose pipeline failed or legacy rows)
  @Post(':id/generate-billing')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async generateBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ExternalOperationUpdateResponse> {
    return this.externalOperationService.generateBilling(id, userId);
  }
}

@Controller('external-operation-items')
export class ExternalOperationItemController {
  constructor(private readonly externalOperationItemService: ExternalOperationItemService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(externalOperationItemGetManySchema))
    query: ExternalOperationItemGetManyFormData,
  ): Promise<ExternalOperationItemGetManyResponse> {
    return this.externalOperationItemService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(externalOperationItemCreateSchema))
    data: ExternalOperationItemCreateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationItemQuerySchema))
    query: ExternalOperationItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationItemCreateResponse> {
    return this.externalOperationItemService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(externalOperationItemBatchCreateSchema))
    data: ExternalOperationItemBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationItemQuerySchema))
    query: ExternalOperationItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationItemBatchCreateResponse<ExternalOperationItemCreateFormData>> {
    return this.externalOperationItemService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body() rawData: any,
    @Query(new ZodQueryValidationPipe(externalOperationItemQuerySchema))
    query: ExternalOperationItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationItemBatchUpdateResponse<ExternalOperationItemUpdateFormData>> {
    // Fix array serialization issue at controller level
    let fixedData = rawData;
    if (
      rawData.externalOperationItems &&
      typeof rawData.externalOperationItems === 'object' &&
      !Array.isArray(rawData.externalOperationItems)
    ) {
      const keys = Object.keys(rawData.externalOperationItems);
      const isNumericKeys = keys.every(k => /^\d+$/.test(k));
      if (isNumericKeys) {
        fixedData = {
          ...rawData,
          externalOperationItems: Object.values(rawData.externalOperationItems),
        };
      }
    }

    // Now validate the fixed data
    const validationPipe = new ZodValidationPipe(externalOperationItemBatchUpdateSchema);
    const validatedData = await validationPipe.transform(fixedData, {
      type: 'body',
      metatype: undefined,
    });

    return this.externalOperationItemService.batchUpdate(
      validatedData as ExternalOperationItemBatchUpdateFormData,
      query.include,
      userId,
    );
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(externalOperationItemBatchDeleteSchema))
    data: ExternalOperationItemBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationItemBatchDeleteResponse> {
    return this.externalOperationItemService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(externalOperationItemQuerySchema))
    query: ExternalOperationItemQueryFormData,
  ): Promise<ExternalOperationItemGetUniqueResponse> {
    return this.externalOperationItemService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(externalOperationItemUpdateSchema))
    data: ExternalOperationItemUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationItemQuerySchema))
    query: ExternalOperationItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationItemUpdateResponse> {
    return this.externalOperationItemService.update(id, data, query.include, userId);
  }

  @Patch(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async partialUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(externalOperationItemUpdateSchema))
    data: ExternalOperationItemUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalOperationItemQuerySchema))
    query: ExternalOperationItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalOperationItemUpdateResponse> {
    return this.externalOperationItemService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ExternalOperationItemDeleteResponse> {
    return this.externalOperationItemService.delete(id, userId);
  }
}
