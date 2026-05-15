import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { GoalService } from './goal.service';
import {
  ZodQueryValidationPipe,
  ZodValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@/constants/enums';
import type {
  GoalCreateResponse,
  GoalDeleteResponse,
  GoalGetManyResponse,
  GoalGetUniqueResponse,
  GoalUpdateResponse,
  GoalUpsertYearResponse,
} from '../../../types';
import {
  GoalCreateFormData,
  GoalDeleteRowFormData,
  GoalGetManyFormData,
  GoalQueryFormData,
  GoalUpdateFormData,
  GoalUpsertYearFormData,
  goalCreateSchema,
  goalDeleteRowSchema,
  goalGetManySchema,
  goalQuerySchema,
  goalUpdateSchema,
  goalUpsertYearSchema,
} from '../../../schemas/goal';

@Controller('goals')
@UseGuards(AuthGuard)
export class GoalController {
  constructor(private readonly goalService: GoalService) {}

  @Get()
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async findMany(
    @Query(new ZodQueryValidationPipe(goalGetManySchema)) query: GoalGetManyFormData,
  ): Promise<GoalGetManyResponse> {
    return this.goalService.findMany(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async create(
    @Body(new ZodValidationPipe(goalCreateSchema)) data: GoalCreateFormData,
    @Query(new ZodQueryValidationPipe(goalQuerySchema)) query: GoalQueryFormData,
  ): Promise<GoalCreateResponse> {
    return this.goalService.create(data, query.include);
  }

  // Bulk operations (must come before dynamic routes)

  @Post('upsert-year')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async upsertYear(
    @Body(new ZodValidationPipe(goalUpsertYearSchema)) data: GoalUpsertYearFormData,
  ): Promise<GoalUpsertYearResponse> {
    return this.goalService.upsertYear(data);
  }

  @Delete('row')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async deleteRow(
    @Body(new ZodValidationPipe(goalDeleteRowSchema)) data: GoalDeleteRowFormData,
  ): Promise<GoalDeleteResponse> {
    return this.goalService.deleteRow(data);
  }

  @Get(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodQueryValidationPipe(goalQuerySchema)) query: GoalQueryFormData,
  ): Promise<GoalGetUniqueResponse> {
    return this.goalService.findById(id, query.include);
  }

  @Put(':id')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(goalUpdateSchema)) data: GoalUpdateFormData,
    @Query(new ZodQueryValidationPipe(goalQuerySchema)) query: GoalQueryFormData,
  ): Promise<GoalUpdateResponse> {
    return this.goalService.update(id, data, query.include);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.HUMAN_RESOURCES)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<GoalDeleteResponse> {
    return this.goalService.delete(id);
  }
}
