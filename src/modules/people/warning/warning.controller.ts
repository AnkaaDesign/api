// warning.controller.ts

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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '@modules/common/file/config/upload.config';
import { WarningService } from './warning.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { ArrayFixPipe } from '@modules/common/pipes/array-fix.pipe';
import type {
  WarningBatchCreateResponse,
  WarningBatchDeleteResponse,
  WarningBatchUpdateResponse,
  WarningCreateResponse,
  WarningDeleteResponse,
  WarningGetManyResponse,
  WarningGetUniqueResponse,
  WarningUpdateResponse,
  Warning,
} from '../../../types';
import type {
  WarningCreateFormData,
  WarningUpdateFormData,
  WarningGetManyFormData,
  WarningBatchCreateFormData,
  WarningBatchUpdateFormData,
  WarningBatchDeleteFormData,
  WarningQueryFormData,
  WarningGetByIdFormData,
  WarningBatchQueryFormData,
} from '../../../schemas';
import {
  warningCreateSchema,
  warningBatchCreateSchema,
  warningBatchDeleteSchema,
  warningBatchUpdateSchema,
  warningGetManySchema,
  warningUpdateSchema,
  warningGetByIdSchema,
  warningQuerySchema,
  warningBatchQuerySchema,
} from '../../../schemas';

@Controller('warnings')
export class WarningController {
  constructor(private readonly warningService: WarningService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
  ): Promise<WarningGetManyResponse> {
    return this.warningService.findMany(query);
  }

  // User-specific endpoint (must be before dynamic :id route)
  @Get('my-warnings')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,

    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
  )
  async getMyWarnings(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
    @UserId() userId: string,
  ): Promise<WarningGetManyResponse> {
    // Users can only see warnings where they are the collaborator
    const filteredQuery: WarningGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        collaboratorId: userId,
      },
    };
    return this.warningService.findMany(filteredQuery);
  }

  // Team warnings endpoint for team leaders (must be before dynamic :id route)
  @Get('team-warnings')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async getTeamWarnings(
    @Query(new ZodQueryValidationPipe(warningGetManySchema)) query: WarningGetManyFormData,
    @UserId() userId: string,
  ): Promise<WarningGetManyResponse> {
    // Get the user's managed sector to filter team members
    const userWithSector = await this.warningService.getUserManagedSector(userId);

    if (!userWithSector?.managedSectorId) {
      // User is not a team leader, return empty result
      return {
        success: true,
        message: 'Nenhuma advertência encontrada',
        data: [],
        meta: {
          page: 1,
          totalPages: 0,
          take: query.limit || 25,
          totalRecords: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    // Filter warnings by collaborators in the leader's managed sector
    const filteredQuery: WarningGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        collaborator: {
          sectorId: userWithSector.managedSectorId,
        },
      },
    };
    return this.warningService.findMany(filteredQuery);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('attachments', 10, multerConfig))
  async create(
    @Body(new ArrayFixPipe(), new ZodValidationPipe(warningCreateSchema))
    data: WarningCreateFormData,
    @Query(new ZodQueryValidationPipe(warningQuerySchema)) query: WarningQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() attachments?: Express.Multer.File[],
  ): Promise<WarningCreateResponse> {
    return this.warningService.create(data, query.include, userId, attachments);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(warningBatchCreateSchema)) data: WarningBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(warningBatchQuerySchema)) query: WarningBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WarningBatchCreateResponse<WarningCreateFormData>> {
    return this.warningService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(warningBatchUpdateSchema)) data: WarningBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(warningBatchQuerySchema)) query: WarningBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WarningBatchUpdateResponse<WarningUpdateFormData>> {
    return this.warningService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(warningBatchDeleteSchema)) data: WarningBatchDeleteFormData,
    @Query(new ZodQueryValidationPipe(warningBatchQuerySchema)) query: WarningBatchQueryFormData,
    @UserId() userId: string,
  ): Promise<WarningBatchDeleteResponse> {
    return this.warningService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(warningQuerySchema)) query: WarningQueryFormData,
  ): Promise<WarningGetUniqueResponse> {
    return this.warningService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @UseInterceptors(FilesInterceptor('attachments', 10, multerConfig))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ArrayFixPipe(), new ZodValidationPipe(warningUpdateSchema))
    data: WarningUpdateFormData,
    @Query(new ZodQueryValidationPipe(warningQuerySchema)) query: WarningQueryFormData,
    @UserId() userId: string,
    @UploadedFiles() attachments?: Express.Multer.File[],
  ): Promise<WarningUpdateResponse> {
    return this.warningService.update(id, data, query.include, userId, attachments);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<WarningDeleteResponse> {
    return this.warningService.delete(id, userId);
  }
}
