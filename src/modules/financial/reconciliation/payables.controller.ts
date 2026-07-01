import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '@constants';
import { PayablesService } from './payables.service';
import { RecurrentPayableService } from '../recurrent-payable/recurrent-payable.service';
import { PayablesResponse } from '../../../types';

// Unified settle facade. PAYROLL settles the folha competence batch;
// RECURRENT_PAYABLE settles a materialized monthly occurrence (VARIABLE bills
// carry the user-typed real amount). Orders/airbrushing keep their own
// endpoints; taxes/13º/férias settle via reconciliation/HR pages.
const payablesSettleSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('PAYROLL'),
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    amount: z.number().nullable().optional(),
  }),
  z.object({
    source: z.literal('RECURRENT_PAYABLE'),
    occurrenceId: z.string().uuid(),
    paidAmount: z.number().nonnegative().nullable().optional(),
    paymentMethod: z.enum(['PIX', 'BANK_SLIP', 'CREDIT_CARD']).nullable().optional(),
  }),
]);
type PayablesSettleDto = z.infer<typeof payablesSettleSchema>;

@Controller('financial/payables')
// Financial-only: WAREHOUSE has no access to the Contas a Pagar / payables side.
@Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.ADMIN)
export class PayablesController {
  constructor(
    private readonly payablesService: PayablesService,
    private readonly recurrentPayableService: RecurrentPayableService,
  ) {}

  /**
   * Unified Contas a Pagar list: orders + airbrushing + schedules + taxes + folha + 13º/férias + recorrentes + recurrent payables.
   * `competence` (YYYY-MM) scopes the recurrent occurrences to the selected month;
   * omit for the current month. A past competence loads existing rows read-only.
   */
  @Get()
  async getPayables(@Query('competence') competence?: string): Promise<PayablesResponse> {
    return this.payablesService.getPayables(competence);
  }

  /** Settle facade — payroll competence month or a recurrent-payable occurrence. */
  @Post('settle')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.ADMIN)
  async settle(@Body(new ZodValidationPipe(payablesSettleSchema)) data: PayablesSettleDto, @UserId() userId: string) {
    if (data.source === 'RECURRENT_PAYABLE') {
      return this.recurrentPayableService.markOccurrencePaid(data.occurrenceId, {
        paidAmount: data.paidAmount,
        paymentMethod: data.paymentMethod,
        userId,
      });
    }
    return this.payablesService.markPayrollMonthPaid(data.year, data.month, data.amount ?? null, userId);
  }
}
