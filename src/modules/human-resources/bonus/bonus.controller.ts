// bonus.controller.ts

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
} from '@nestjs/common';
import { BonusService } from './bonus.service';
import { AuthGuard } from '@modules/common/auth/auth.guard';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../../common/pipes/zod-validation.pipe';
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
  constructor(
    private readonly bonusService: BonusService,
  ) {}

  /**
   * Get live payroll data with bonus calculations for a period
   * This endpoint provides real-time bonus calculations without saving to database
   */
  @Get('payroll-data')
  async getPayrollData(
    @Query() query: { year?: string; month?: string; includeInactive?: boolean },
    @Request() req: any,
  ) {
    const year = query.year || new Date().getFullYear().toString();
    const month = query.month || (new Date().getMonth() + 1).toString();

    const payrollData = await this.bonusService.getPayrollData({
      year,
      month,
      includeInactive: query.includeInactive || false,
    }, req.user?.id);

    return {
      success: true,
      message: 'Dados de folha de pagamento calculados com sucesso.',
      data: payrollData,
    };
  }

  /**
   * Get many bonuses
   */
  @Get()
  async findMany(
    @Query(new ZodQueryValidationPipe(bonusGetManyFormDataSchema)) query: BonusGetManyFormData,
  ) {
    return this.bonusService.findMany(query);
  }

  /**
   * Get bonus by ID
   */
  @Get(':id')
  async findById(
    @Param('id') id: string,
    @Query(new ZodQueryValidationPipe(bonusGetByIdSchema)) query: BonusGetByIdFormData,
    @Request() req: any,
  ) {
    const bonus = await this.bonusService.findById(id, query.include, req.user?.id);
    return {
      success: true,
      data: bonus,
      message: 'Bônus carregado com sucesso.',
    };
  }

  /**
   * Create bonus
   */
  @Post()
  @UsePipes(new ZodValidationPipe(bonusCreateSchema))
  async create(
    @Body() data: BonusCreateFormData,
    @Request() req: any,
  ) {
    const result = await this.bonusService.create(data, req.user?.id);
    return {
      success: true,
      data: result,
      message: 'Bônus criado com sucesso.',
    };
  }

  /**
   * Update bonus
   */
  @Put(':id')
  @UsePipes(new ZodValidationPipe(bonusUpdateSchema))
  async update(
    @Param('id') id: string,
    @Body() data: BonusUpdateFormData,
    @Request() req: any,
  ) {
    const result = await this.bonusService.update(id, data, req.user?.id);
    return {
      success: true,
      data: result,
      message: 'Bônus atualizado com sucesso.',
    };
  }

  /**
   * Delete bonus
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    await this.bonusService.delete(id, req.user?.id);
  }

  /**
   * Batch create bonuses
   */
  @Post('batch')
  @UsePipes(new ZodValidationPipe(bonusBatchCreateSchema))
  async batchCreate(
    @Body() data: BonusBatchCreateFormData,
    @Request() req: any,
  ) {
    const result = await this.bonusService.batchCreate({ bonuses: data.bonuses! }, req.user?.id);
    return {
      success: true,
      data: result,
      message: `Criação em lote: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas.`,
    };
  }

  /**
   * Batch update bonuses
   */
  @Put('batch')
  @UsePipes(new ZodValidationPipe(bonusBatchUpdateSchema))
  async batchUpdate(
    @Body() data: BonusBatchUpdateFormData,
    @Request() req: any,
  ) {
    const result = await this.bonusService.batchUpdate({ bonuses: data.bonuses!.map(b => ({ id: b.id!, data: b.data! })) }, req.user?.id);
    return {
      success: true,
      data: result,
      message: `Atualização em lote: ${result.totalSuccess} sucessos, ${result.totalFailed} falhas.`,
    };
  }

  /**
   * Batch delete bonuses
   */
  @Delete('batch')
  @UsePipes(new ZodValidationPipe(bonusBatchDeleteSchema))
  @HttpCode(HttpStatus.NO_CONTENT)
  async batchDelete(
    @Body() data: BonusBatchDeleteFormData,
    @Request() req: any,
  ) {
    await this.bonusService.batchDelete({ ids: data.ids! }, req.user?.id);
  }

  /**
   * Create bonus discount
   */
  @Post(':id/discounts')
  @UsePipes(new ZodValidationPipe(discountCreateSchema))
  async createDiscount(
    @Param('id') bonusId: string,
    @Body() body: z.infer<typeof discountCreateSchema>,
    @Request() req: any,
  ) {
    return this.bonusService.createDiscount(bonusId, { reason: body.reason!, percentage: body.percentage! }, req.user?.id);
  }

  /**
   * Delete bonus discount
   */
  @Delete('discounts/:discountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDiscount(
    @Param('discountId') discountId: string,
    @Request() req: any,
  ) {
    return this.bonusService.deleteDiscount(discountId, req.user?.id);
  }
}
