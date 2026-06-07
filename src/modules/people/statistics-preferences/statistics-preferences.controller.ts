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
import { StatisticsPreferencesService } from './statistics-preferences.service';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import {
  ZodValidationPipe,
  ZodQueryValidationPipe,
} from '@modules/common/pipes/zod-validation.pipe';
import {
  statisticsPreferencesGetSchema,
  statisticsPageConfigUpsertSchema,
  statisticsPresetCreateSchema,
  statisticsPresetUpdateSchema,
} from '../../../schemas/statistics-preferences';
import type {
  StatisticsPreferencesGetFormData,
  StatisticsPageConfigUpsertFormData,
  StatisticsPresetCreateFormData,
  StatisticsPresetUpdateFormData,
} from '../../../schemas/statistics-preferences';
import type {
  StatisticsPreferencesGetResponse,
  StatisticsPageConfigUpsertResponse,
  StatisticsPresetCreateResponse,
  StatisticsPresetUpdateResponse,
  StatisticsPresetDeleteResponse,
} from '../../../types';

@Controller('statistics-preferences')
export class StatisticsPreferencesController {
  constructor(private readonly statisticsPreferencesService: StatisticsPreferencesService) {}

  /**
   * Get the current user's statistics preferences (last-seen configs + presets).
   * Optionally scoped to a single page via ?pageKey=
   */
  @Get('me')
  async getMine(
    @Query(new ZodQueryValidationPipe(statisticsPreferencesGetSchema))
    query: StatisticsPreferencesGetFormData,
    @UserId() userId: string,
  ): Promise<StatisticsPreferencesGetResponse> {
    return this.statisticsPreferencesService.getMine(userId, query.pageKey);
  }

  /**
   * Upsert the last-seen config for a statistics page (auto-persist).
   */
  @Put('me/page-config')
  async upsertPageConfig(
    @Body(new ZodValidationPipe(statisticsPageConfigUpsertSchema))
    data: StatisticsPageConfigUpsertFormData,
    @UserId() userId: string,
  ): Promise<StatisticsPageConfigUpsertResponse> {
    return this.statisticsPreferencesService.upsertPageConfig(userId, data);
  }

  /**
   * Create a named preset for a statistics page.
   */
  @Post('me/presets')
  @HttpCode(HttpStatus.CREATED)
  async createPreset(
    @Body(new ZodValidationPipe(statisticsPresetCreateSchema))
    data: StatisticsPresetCreateFormData,
    @UserId() userId: string,
  ): Promise<StatisticsPresetCreateResponse> {
    return this.statisticsPreferencesService.createPreset(userId, data);
  }

  /**
   * Update a preset (rename and/or overwrite config).
   */
  @Put('me/presets/:id')
  async updatePreset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(statisticsPresetUpdateSchema))
    data: StatisticsPresetUpdateFormData,
    @UserId() userId: string,
  ): Promise<StatisticsPresetUpdateResponse> {
    return this.statisticsPreferencesService.updatePreset(userId, id, data);
  }

  /**
   * Delete a preset.
   */
  @Delete('me/presets/:id')
  async deletePreset(
    @Param('id', ParseUUIDPipe) id: string,
    @UserId() userId: string,
  ): Promise<StatisticsPresetDeleteResponse> {
    return this.statisticsPreferencesService.deletePreset(userId, id);
  }
}
