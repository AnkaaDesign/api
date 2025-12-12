// external-withdrawal.controller.ts

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
import { ExternalWithdrawalService } from './external-withdrawal.service';
import { ExternalWithdrawalItemService } from './external-withdrawal-item.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  ExternalWithdrawal,
  ExternalWithdrawalItem,
  ExternalWithdrawalBatchCreateResponse,
  ExternalWithdrawalBatchDeleteResponse,
  ExternalWithdrawalBatchUpdateResponse,
  ExternalWithdrawalCreateResponse,
  ExternalWithdrawalDeleteResponse,
  ExternalWithdrawalGetManyResponse,
  ExternalWithdrawalGetUniqueResponse,
  ExternalWithdrawalUpdateResponse,
  ExternalWithdrawalItemBatchCreateResponse,
  ExternalWithdrawalItemBatchDeleteResponse,
  ExternalWithdrawalItemBatchUpdateResponse,
  ExternalWithdrawalItemCreateResponse,
  ExternalWithdrawalItemDeleteResponse,
  ExternalWithdrawalItemGetManyResponse,
  ExternalWithdrawalItemGetUniqueResponse,
  ExternalWithdrawalItemUpdateResponse,
} from '../../../types';
import {
  ExternalWithdrawalCreateFormData,
  ExternalWithdrawalUpdateFormData,
  ExternalWithdrawalGetManyFormData,
  ExternalWithdrawalBatchCreateFormData,
  ExternalWithdrawalBatchUpdateFormData,
  ExternalWithdrawalBatchDeleteFormData,
  ExternalWithdrawalInclude,
  ExternalWithdrawalQueryFormData,
  ExternalWithdrawalItemCreateFormData,
  ExternalWithdrawalItemUpdateFormData,
  ExternalWithdrawalItemGetManyFormData,
  ExternalWithdrawalItemBatchCreateFormData,
  ExternalWithdrawalItemBatchUpdateFormData,
  ExternalWithdrawalItemBatchDeleteFormData,
  ExternalWithdrawalItemInclude,
  ExternalWithdrawalItemQueryFormData,
  externalWithdrawalCreateSchema,
  externalWithdrawalBatchCreateSchema,
  externalWithdrawalBatchDeleteSchema,
  externalWithdrawalBatchUpdateSchema,
  externalWithdrawalGetManySchema,
  externalWithdrawalUpdateSchema,
  externalWithdrawalQuerySchema,
  externalWithdrawalGetByIdSchema,
  externalWithdrawalItemCreateSchema,
  externalWithdrawalItemBatchCreateSchema,
  externalWithdrawalItemBatchDeleteSchema,
  externalWithdrawalItemBatchUpdateSchema,
  externalWithdrawalItemGetManySchema,
  externalWithdrawalItemUpdateSchema,
  externalWithdrawalItemQuerySchema,
  externalWithdrawalItemGetByIdSchema,
} from '../../../schemas';

@Controller('external-withdrawals')
export class ExternalWithdrawalController {
  constructor(private readonly externalWithdrawalService: ExternalWithdrawalService) {}

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
    @Query(new ZodQueryValidationPipe(externalWithdrawalGetManySchema))
    query: ExternalWithdrawalGetManyFormData,
  ): Promise<ExternalWithdrawalGetManyResponse> {
    return this.externalWithdrawalService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
    @Body(new ZodValidationPipe(externalWithdrawalCreateSchema))
    data: ExternalWithdrawalCreateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalQuerySchema))
    query: ExternalWithdrawalQueryFormData,
    @UserId() userId: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalWithdrawalCreateResponse> {
    console.log('[EXTERNAL WITHDRAWAL CONTROLLER] CREATE - Files received:', files ? 'YES' : 'NO');
    if (files) {
      Object.entries(files).forEach(([key, fileArray]) => {
        if (fileArray && fileArray.length > 0) {
          console.log(
            `[EXTERNAL WITHDRAWAL CONTROLLER] ${key} (${fileArray.length} files):`,
            fileArray.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype })),
          );
        }
      });
    }
    return this.externalWithdrawalService.create(data, query.include, userId, files);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(externalWithdrawalBatchCreateSchema))
    data: ExternalWithdrawalBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalQuerySchema))
    query: ExternalWithdrawalQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalBatchCreateResponse<ExternalWithdrawalCreateFormData>> {
    return this.externalWithdrawalService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(externalWithdrawalBatchUpdateSchema))
    data: ExternalWithdrawalBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalQuerySchema))
    query: ExternalWithdrawalQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalBatchUpdateResponse<ExternalWithdrawalUpdateFormData>> {
    return this.externalWithdrawalService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(externalWithdrawalBatchDeleteSchema))
    data: ExternalWithdrawalBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalBatchDeleteResponse> {
    return this.externalWithdrawalService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
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
    @Query(new ZodQueryValidationPipe(externalWithdrawalQuerySchema))
    query: ExternalWithdrawalQueryFormData,
  ): Promise<ExternalWithdrawalGetUniqueResponse> {
    return this.externalWithdrawalService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
    @Body(new ZodValidationPipe(externalWithdrawalUpdateSchema))
    data: ExternalWithdrawalUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalQuerySchema))
    query: ExternalWithdrawalQueryFormData,
    @UserId() userId: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalWithdrawalUpdateResponse> {
    console.log('[EXTERNAL WITHDRAWAL CONTROLLER] UPDATE - Files received:', files ? 'YES' : 'NO');
    if (files) {
      Object.entries(files).forEach(([key, fileArray]) => {
        if (fileArray && fileArray.length > 0) {
          console.log(
            `[EXTERNAL WITHDRAWAL CONTROLLER] ${key} (${fileArray.length} files):`,
            fileArray.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype })),
          );
        }
      });
    }
    return this.externalWithdrawalService.update(id, data, query.include, userId, files);
  }

  @Patch(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
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
    @Body(new ZodValidationPipe(externalWithdrawalUpdateSchema))
    data: ExternalWithdrawalUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalQuerySchema))
    query: ExternalWithdrawalQueryFormData,
    @UserId() userId: string,
    @UploadedFiles()
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
    },
  ): Promise<ExternalWithdrawalUpdateResponse> {
    console.log('[EXTERNAL WITHDRAWAL CONTROLLER] PATCH - Files received:', files ? 'YES' : 'NO');
    if (files) {
      Object.entries(files).forEach(([key, fileArray]) => {
        if (fileArray && fileArray.length > 0) {
          console.log(
            `[EXTERNAL WITHDRAWAL CONTROLLER] ${key} (${fileArray.length} files):`,
            fileArray.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype })),
          );
        }
      });
    }
    return this.externalWithdrawalService.update(id, data, query.include, userId, files);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalDeleteResponse> {
    return this.externalWithdrawalService.delete(id, userId);
  }
}

@Controller('external-withdrawal-items')
export class ExternalWithdrawalItemController {
  constructor(private readonly externalWithdrawalItemService: ExternalWithdrawalItemService) {}

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
    @Query(new ZodQueryValidationPipe(externalWithdrawalItemGetManySchema))
    query: ExternalWithdrawalItemGetManyFormData,
  ): Promise<ExternalWithdrawalItemGetManyResponse> {
    return this.externalWithdrawalItemService.findMany(query);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(externalWithdrawalItemCreateSchema))
    data: ExternalWithdrawalItemCreateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalItemQuerySchema))
    query: ExternalWithdrawalItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalItemCreateResponse> {
    return this.externalWithdrawalItemService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(externalWithdrawalItemBatchCreateSchema))
    data: ExternalWithdrawalItemBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalItemQuerySchema))
    query: ExternalWithdrawalItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalItemBatchCreateResponse<ExternalWithdrawalItemCreateFormData>> {
    return this.externalWithdrawalItemService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body() rawData: any,
    @Query(new ZodQueryValidationPipe(externalWithdrawalItemQuerySchema))
    query: ExternalWithdrawalItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalItemBatchUpdateResponse<ExternalWithdrawalItemUpdateFormData>> {
    // Fix array serialization issue at controller level
    let fixedData = rawData;
    if (
      rawData.externalWithdrawalItems &&
      typeof rawData.externalWithdrawalItems === 'object' &&
      !Array.isArray(rawData.externalWithdrawalItems)
    ) {
      const keys = Object.keys(rawData.externalWithdrawalItems);
      const isNumericKeys = keys.every(k => /^\d+$/.test(k));
      if (isNumericKeys) {
        fixedData = {
          ...rawData,
          externalWithdrawalItems: Object.values(rawData.externalWithdrawalItems),
        };
      }
    }

    // Now validate the fixed data
    const validationPipe = new ZodValidationPipe(externalWithdrawalItemBatchUpdateSchema);
    const validatedData = await validationPipe.transform(fixedData, {
      type: 'body',
      metatype: undefined,
    });

    return this.externalWithdrawalItemService.batchUpdate(
      validatedData as ExternalWithdrawalItemBatchUpdateFormData,
      query.include,
      userId,
    );
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(externalWithdrawalItemBatchDeleteSchema))
    data: ExternalWithdrawalItemBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalItemBatchDeleteResponse> {
    return this.externalWithdrawalItemService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
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
    @Query(new ZodQueryValidationPipe(externalWithdrawalItemQuerySchema))
    query: ExternalWithdrawalItemQueryFormData,
  ): Promise<ExternalWithdrawalItemGetUniqueResponse> {
    return this.externalWithdrawalItemService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(externalWithdrawalItemUpdateSchema))
    data: ExternalWithdrawalItemUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalItemQuerySchema))
    query: ExternalWithdrawalItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalItemUpdateResponse> {
    return this.externalWithdrawalItemService.update(id, data, query.include, userId);
  }

  @Patch(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async partialUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(externalWithdrawalItemUpdateSchema))
    data: ExternalWithdrawalItemUpdateFormData,
    @Query(new ZodQueryValidationPipe(externalWithdrawalItemQuerySchema))
    query: ExternalWithdrawalItemQueryFormData,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalItemUpdateResponse> {
    return this.externalWithdrawalItemService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<ExternalWithdrawalItemDeleteResponse> {
    return this.externalWithdrawalItemService.delete(id, userId);
  }
}
