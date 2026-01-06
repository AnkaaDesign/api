// vacation.controller.ts

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
import { VacationService } from './vacation.service';
import { User, UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import type {
  VacationBatchCreateResponse,
  VacationBatchDeleteResponse,
  VacationBatchUpdateResponse,
  VacationCreateResponse,
  VacationDeleteResponse,
  VacationGetManyResponse,
  VacationGetUniqueResponse,
  VacationUpdateResponse,
  Vacation,
} from '../../../types';
import type {
  VacationCreateFormData,
  VacationUpdateFormData,
  VacationGetManyFormData,
  VacationBatchCreateFormData,
  VacationBatchUpdateFormData,
  VacationBatchDeleteFormData,
  VacationQueryFormData,
  VacationGetByIdFormData,
} from '../../../schemas';
import {
  vacationCreateSchema,
  vacationBatchCreateSchema,
  vacationBatchDeleteSchema,
  vacationBatchUpdateSchema,
  vacationGetManySchema,
  vacationUpdateSchema,
  vacationGetByIdSchema,
  vacationQuerySchema,
} from '../../../schemas';

@Controller('vacations')
export class VacationController {
  constructor(private readonly vacationService: VacationService) {}

  // Basic CRUD Operations
  @Get()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findMany(
    @Query(new ZodQueryValidationPipe(vacationGetManySchema)) query: VacationGetManyFormData,
    @UserId() userId: string,
  ): Promise<VacationGetManyResponse> {
    return this.vacationService.findMany(query);
  }

  // User-specific endpoint (must be before dynamic :id route)
  @Get('my-vacations')
  @Roles(
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.WAREHOUSE,
    SECTOR_PRIVILEGES.MAINTENANCE,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.HUMAN_RESOURCES,
    SECTOR_PRIVILEGES.EXTERNAL,
  )
  async getMyVacations(
    @Query(new ZodQueryValidationPipe(vacationGetManySchema)) query: VacationGetManyFormData,
    @UserId() userId: string,
  ): Promise<VacationGetManyResponse> {
    // Users can only see their own vacations
    const filteredQuery: VacationGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        userId,
      },
    };
    return this.vacationService.findMany(filteredQuery);
  }

  // Team-specific endpoint for leaders (must be before dynamic :id route)
  @Get('team-vacations')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async getTeamVacations(
    @Query(new ZodQueryValidationPipe(vacationGetManySchema)) query: VacationGetManyFormData,
    @UserId() userId: string,
  ): Promise<VacationGetManyResponse> {
    // Get the user's managed sector
    const userWithSector = await this.vacationService.getUserManagedSector(userId);

    // If user doesn't manage a sector, return empty result
    if (!userWithSector?.managedSectorId) {
      return {
        success: true,
        message: 'Nenhuma férias encontrada',
        data: [],
        meta: {
          totalRecords: 0,
          page: 1,
          take: query.limit || 25,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    // Filter vacations by users in the managed sector
    const filteredQuery: VacationGetManyFormData = {
      ...query,
      where: {
        ...query.where,
        user: {
          sectorId: userWithSector.managedSectorId,
        },
      },
    };
    return this.vacationService.findMany(filteredQuery);
  }

  @Post()
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(vacationCreateSchema)) data: VacationCreateFormData,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationCreateResponse> {
    return this.vacationService.create(data, query.include, userId);
  }

  // Batch Operations (must come before dynamic routes)
  @Post('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async batchCreate(
    @Body(new ZodValidationPipe(vacationBatchCreateSchema)) data: VacationBatchCreateFormData,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationBatchCreateResponse<VacationCreateFormData>> {
    return this.vacationService.batchCreate(data, query.include, userId);
  }

  @Put('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async batchUpdate(
    @Body(new ZodValidationPipe(vacationBatchUpdateSchema)) data: VacationBatchUpdateFormData,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationBatchUpdateResponse<VacationUpdateFormData>> {
    return this.vacationService.batchUpdate(data, query.include, userId);
  }

  @Delete('batch')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Body(new ZodValidationPipe(vacationBatchDeleteSchema)) data: VacationBatchDeleteFormData,
    @UserId() userId: string,
  ): Promise<VacationBatchDeleteResponse> {
    return this.vacationService.batchDelete(data, userId);
  }

  // Dynamic routes (must come after static routes)
  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationGetUniqueResponse> {
    return this.vacationService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(vacationUpdateSchema)) data: VacationUpdateFormData,
    @Query(new ZodQueryValidationPipe(vacationQuerySchema)) query: VacationQueryFormData,
    @UserId() userId: string,
  ): Promise<VacationUpdateResponse> {
    return this.vacationService.update(id, data, query.include, userId);
  }

  @Delete(':id')
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<VacationDeleteResponse> {
    return this.vacationService.delete(id, userId);
  }
}
