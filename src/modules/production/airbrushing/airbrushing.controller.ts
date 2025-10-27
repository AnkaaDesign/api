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
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
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
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

@Controller('airbrushings')
export class AirbrushingController {
  constructor(
    private readonly airbrushingService: AirbrushingService,
  ) {}

  @Get()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findMany(
    @Query(new ZodQueryValidationPipe(airbrushingGetManySchema)) query: AirbrushingGetManyFormData,
  ): Promise<AirbrushingGetManyResponse> {
    return this.airbrushingService.findMany(query);
  }

  @Post()
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'receipts', maxCount: 10 },
      { name: 'invoices', maxCount: 10 },
      { name: 'artworks', maxCount: 10 },
    ], multerConfig)
  )
  async create(
    @Body(new ZodValidationPipe(airbrushingCreateSchema)) data: AirbrushingCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
    },
  ): Promise<AirbrushingCreateResponse> {
    console.log('[AIRBRUSHING CONTROLLER] CREATE - Files received:', files ? 'YES' : 'NO');
    if (files) {
      Object.entries(files).forEach(([key, fileArray]) => {
        if (fileArray && fileArray.length > 0) {
          console.log(`[AIRBRUSHING CONTROLLER] ${key} (${fileArray.length} files):`,
            fileArray.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype })));
        }
      });
    }
    return this.airbrushingService.create(data, query.include, userId, files);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(airbrushingBatchCreateSchema)) data: AirbrushingBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchCreateResponse<AirbrushingCreateFormData>> {
    return this.airbrushingService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async batchUpdate(
    @Body(new ZodValidationPipe(airbrushingBatchUpdateSchema)) data: AirbrushingBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchUpdateResponse<AirbrushingUpdateFormData>> {
    return this.airbrushingService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(airbrushingBatchDeleteSchema)) data: AirbrushingBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<AirbrushingBatchDeleteResponse> {
    return this.airbrushingService.batchDelete(data, userId);
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
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
  ): Promise<AirbrushingGetUniqueResponse> {
    return this.airbrushingService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'receipts', maxCount: 10 },
      { name: 'invoices', maxCount: 10 },
      { name: 'artworks', maxCount: 10 },
    ], multerConfig)
  )
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(airbrushingUpdateSchema)) data: AirbrushingUpdateFormData,
    @Query(new ZodQueryValidationPipe(airbrushingQuerySchema)) query: AirbrushingQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      artworks?: Express.Multer.File[];
    },
  ): Promise<AirbrushingUpdateResponse> {
    console.log('[AIRBRUSHING CONTROLLER] UPDATE - Files received:', files ? 'YES' : 'NO');
    if (files) {
      Object.entries(files).forEach(([key, fileArray]) => {
        if (fileArray && fileArray.length > 0) {
          console.log(`[AIRBRUSHING CONTROLLER] ${key} (${fileArray.length} files):`,
            fileArray.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype })));
        }
      });
    }
    return this.airbrushingService.update(id, data, query.include, userId, files);
  }

  @Delete(':id')
  @Roles(
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LEADER,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<AirbrushingDeleteResponse> {
    return this.airbrushingService.delete(id, userId);
  }
}
