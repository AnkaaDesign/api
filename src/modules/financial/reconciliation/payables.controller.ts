import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '@constants';
import { PayablesService } from './payables.service';
import { PayablesResponse } from '../../../types';

const payablesSettleSchema = z.object({
  // Only PAYROLL settles server-side here; orders/airbrushing use their own
  // endpoints, taxes/recurrents/13º/férias settle via reconciliation/HR pages.
  source: z.literal('PAYROLL'),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  amount: z.number().nullable().optional(),
});
type PayablesSettleDto = z.infer<typeof payablesSettleSchema>;

@Controller('financial/payables')
@Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.ADMIN)
export class PayablesController {
  constructor(private readonly payablesService: PayablesService) {}

  /** Unified Contas a Pagar list: orders + airbrushing + schedules + taxes + folha + 13º/férias + recorrentes. */
  @Get()
  async getPayables(): Promise<PayablesResponse> {
    return this.payablesService.getPayables();
  }

  /** Settle facade — currently the payroll competence month (folha batch). */
  @Post('settle')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.ADMIN)
  async settle(@Body(new ZodValidationPipe(payablesSettleSchema)) data: PayablesSettleDto, @UserId() userId: string) {
    return this.payablesService.markPayrollMonthPaid(data.year, data.month, data.amount ?? null, userId);
  }
}
