// bonus.controller.ts
// Clean implementation - Regular CRUD + Live calculation endpoints

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UsePipes,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { BonusService } from './bonus.service';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReadRateLimit, WriteRateLimit } from '@modules/common/throttler/throttler.decorators';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  bonusGetManyFormDataSchema,
  bonusGetByIdSchema,
  bonusCreateSchema,
  bonusUpdateSchema,
  bonusBatchCreateSchema,
  bonusBatchUpdateSchema,
  bonusBatchDeleteSchema,
  BonusGetManyFormData,
  BonusGetByIdFormData,
  BonusCreateFormData,
  BonusUpdateFormData,
  BonusBatchCreateFormData,
  BonusBatchUpdateFormData,
  BonusBatchDeleteFormData,
} from '../../../schemas';

// Temporary validation schemas
import { z } from 'zod';

const discountCreateSchema = z.object({
  reason: z.string().min(1, 'Motivo é obrigatório'),
  percentage: z.number().min(0).max(100),
});

@Controller('bonus')
@UseGuards(AuthGuard)
export class BonusController {
  constructor(private readonly bonusService: BonusService) {}

  // =====================
  // Regular CRUD Operations (like any other entity)
  // =====================

  /**
   * Get many bonuses - Standard entity list
   * Returns data from database, automatically includes live calculations for current period
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get()
  @ReadRateLimit()
  async findMany(
    @Query(new ZodQueryValidationPipe(bonusGetManyFormDataSchema)) query: BonusGetManyFormData,
    @UserId() userId: string,
  ) {
    // Use the new method that handles live calculations automatically
    return this.bonusService.getBonusesWithLiveCalculation({
      where: query.where,
      skip: query.skip,
      take: query.take,
      include: query.include,
      orderBy: query.orderBy,
    });
  }

  /**
   * Get bonus by ID - Standard entity retrieval
   * Supports both database UUIDs and composite live IDs (live-{userId}-{year}-{month})
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get(':id')
  @ReadRateLimit()
  async findById(
    @Param('id') id: string,
    @Query(new ZodQueryValidationPipe(bonusGetByIdSchema)) query: BonusGetByIdFormData,
    @UserId() userId: string,
  ) {
    const bonus = await this.bonusService.findByIdOrLive(id, query.include, userId);
    return {
      success: true,
      data: bonus,
      message: 'Bônus carregado com sucesso.',
    };
  }

  /**
   * Create bonus - Standard entity creation
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Post()
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(bonusCreateSchema))
  async create(@Body() data: BonusCreateFormData, @UserId() userId: string) {
    const result = await this.bonusService.create(data, userId);
    return {
      success: true,
      data: result,
      message: 'Bônus criado com sucesso.',
    };
  }

  /**
   * Update bonus - Standard entity update
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Put(':id')
  @WriteRateLimit()
  @UsePipes(new ZodValidationPipe(bonusUpdateSchema))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: BonusUpdateFormData,
    @UserId() userId: string,
  ) {
    const result = await this.bonusService.update(id, data, userId);
    return {
      success: true,
      data: result,
      message: 'Bônus atualizado com sucesso.',
    };
  }

  /**
   * Delete bonus - Standard entity deletion
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Delete(':id')
  @WriteRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    await this.bonusService.delete(id, userId);
  }

  // =====================
  // Batch Operations
  // =====================

  /**
   * Batch create bonuses
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Post('batch')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(bonusBatchCreateSchema))
  async batchCreate(@Body() data: BonusBatchCreateFormData, @UserId() userId: string) {
    const result = await this.bonusService.batchCreate({ bonuses: data.bonuses! }, userId);
    return {
      success: true,
      data: result,
      message: `Criação em lote: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas.`,
    };
  }

  /**
   * Batch update bonuses
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Put('batch')
  @WriteRateLimit()
  @UsePipes(new ZodValidationPipe(bonusBatchUpdateSchema))
  async batchUpdate(@Body() data: BonusBatchUpdateFormData, @UserId() userId: string) {
    const result = await this.bonusService.batchUpdate(
      { updates: data.updates!.map(b => ({ id: b.id!, data: b.data! })) },
      userId,
    );
    return {
      success: true,
      data: result,
      message: `Atualização em lote: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas.`,
    };
  }

  /**
   * Batch delete bonuses
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Delete('batch')
  @WriteRateLimit()
  @UsePipes(new ZodValidationPipe(bonusBatchDeleteSchema))
  @HttpCode(HttpStatus.NO_CONTENT)
  async batchDelete(@Body() data: BonusBatchDeleteFormData, @UserId() userId: string) {
    await this.bonusService.batchDelete({ ids: data.ids! }, userId);
  }

  // =====================
  // Live Calculation Endpoints
  // =====================

  /**
   * Get lightweight period task stats for the bonus simulation.
   * Returns only task counts and averages WITHOUT Secullum integration.
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get('period-stats/:year/:month')
  async getPeriodTaskStats(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    const stats = await this.bonusService.getPeriodTaskStats(year, month);
    return { success: true, data: stats };
  }

  /**
   * Get live bonus calculations for a specific period
   * Calculates bonuses in real-time without saving to database
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get('live/:year/:month')
  @ReadRateLimit()
  async getLiveCalculations(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @UserId() userId: string,
  ) {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    const liveData = await this.bonusService.calculateLiveBonuses(year, month);
    return {
      success: true,
      data: liveData,
      message: 'Cálculos de bônus ao vivo obtidos com sucesso.',
    };
  }

  /**
   * Get live bonus calculation for a specific user in a period
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get('live/:userId/:year/:month')
  @ReadRateLimit()
  async getLiveCalculationForUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @UserId() userId: string,
  ) {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    const liveBonus = await this.bonusService.calculateLiveBonusForUser(targetUserId, year, month);
    return {
      success: true,
      data: liveBonus,
      message: liveBonus
        ? 'Cálculo de bônus ao vivo obtido com sucesso.'
        : 'Usuário não elegível para bônus neste período.',
    };
  }

  /**
   * Calculate and save bonuses for a period
   */
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @Post('calculate/:year/:month')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  async calculateAndSaveBonuses(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @UserId() userId: string,
  ) {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    const result = await this.bonusService.calculateAndSaveBonuses(
      year.toString(),
      month.toString(),
      userId,
    );
    return {
      success: true,
      data: result,
      message: `Bônus calculados: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas.`,
    };
  }

  /**
   * Fix all existing bonuses with netBonus=0.
   * This is a maintenance endpoint to fix legacy data where netBonus was never properly calculated.
   * Should only need to be run once.
   */
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @Post('fix-net-bonus')
  @WriteRateLimit()
  @HttpCode(HttpStatus.OK)
  async fixAllBonusesWithZeroNetBonus(@UserId() userId: string) {
    const result = await this.bonusService.fixAllBonusesWithZeroNetBonus();
    return {
      success: true,
      data: result,
      message: `Correção concluída: ${result.totalFixed}/${result.totalChecked} bônus corrigidos.`,
    };
  }

  // =====================
  // Filtering Endpoints
  // =====================

  /**
   * Get bonuses by user
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get('user/:userId')
  @ReadRateLimit()
  async findByUser(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Query(new ZodQueryValidationPipe(bonusGetManyFormDataSchema)) query: BonusGetManyFormData,
    @UserId() userId: string,
  ) {
    return this.bonusService.getBonusesWithLiveCalculation({
      where: {
        ...query.where,
        userId: targetUserId,
      },
      skip: query.skip,
      take: query.take,
      include: query.include,
      orderBy: query.orderBy,
    });
  }

  /**
   * Get bonuses by month
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get('month/:year/:month')
  @ReadRateLimit()
  async findByMonth(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Query(new ZodQueryValidationPipe(bonusGetManyFormDataSchema)) query: BonusGetManyFormData,
    @UserId() userId: string,
  ) {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    return this.bonusService.getBonusesWithLiveCalculation({
      where: {
        ...query.where,
        year,
        month,
      },
      skip: query.skip,
      take: query.take,
      include: query.include,
      orderBy: query.orderBy,
    });
  }

  /**
   * Get bonus by user and month
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get('user/:userId/month/:year/:month')
  @ReadRateLimit()
  async findByUserAndMonth(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @UserId() userId: string,
  ) {
    // Validate month and year
    if (month < 1 || month > 12) {
      throw new Error('Mês deve estar entre 1 e 12');
    }
    if (year < 2020 || year > 2030) {
      throw new Error('Ano deve estar entre 2020 e 2030');
    }

    return this.bonusService.getBonusesWithLiveCalculation({
      where: {
        year,
        month,
        userId: targetUserId,
      },
    });
  }

  // =====================
  // Discount Management
  // =====================

  /**
   * Create bonus discount
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Post(':id/discounts')
  @WriteRateLimit()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(discountCreateSchema))
  async createDiscount(
    @Param('id', ParseUUIDPipe) bonusId: string,
    @Body() body: z.infer<typeof discountCreateSchema>,
    @UserId() userId: string,
  ) {
    return this.bonusService.createDiscount(
      bonusId,
      { reason: body.reason!, percentage: body.percentage! },
      userId,
    );
  }

  /**
   * Delete bonus discount
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Delete('discounts/:discountId')
  @WriteRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDiscount(
    @Param('discountId', ParseUUIDPipe) discountId: string,
    @UserId() userId: string,
  ) {
    return this.bonusService.deleteDiscount(discountId, userId);
  }

  // =====================
  // Calculation Details (for debugging/transparency)
  // =====================

  /**
   * Get bonus calculation details for a given performance level
   */
  @Roles(SECTOR_PRIVILEGES.HUMAN_RESOURCES, SECTOR_PRIVILEGES.ADMIN)
  @Get('calculation-details/:performanceLevel')
  @ReadRateLimit()
  async getCalculationDetails(
    @Param('performanceLevel', ParseIntPipe) performanceLevel: number,
    @Query('weightedTaskCount') weightedTaskCount?: string,
  ) {
    const details = this.bonusService.getBonusCalculationDetails(
      performanceLevel,
      weightedTaskCount ? parseFloat(weightedTaskCount) : undefined,
    );
    return {
      success: true,
      data: details,
      message: 'Detalhes do cálculo de bônus obtidos com sucesso.',
    };
  }
}
