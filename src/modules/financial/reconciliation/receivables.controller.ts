import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '@constants';
import { ReceivablesService } from './receivables.service';
import { ReceivableMatchService } from './receivable-match.service';
import { ReceivablesResponse } from '../../../types';

const matchInstallmentSchema = z.object({
  transactionId: z.string().uuid(),
  installmentId: z.string().uuid(),
});

const unmatchSchema = z.object({ transactionId: z.string().uuid() });

const allocateSchema = z.object({
  transactionId: z.string().uuid(),
  allocations: z
    .array(z.object({ installmentId: z.string().uuid(), amount: z.number().positive() }))
    .min(1),
});

@Controller('financial/receivables')
// Same finance gate as Contas a Pagar / reconciliation.
@Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.ADMIN)
export class ReceivablesController {
  constructor(
    private readonly receivablesService: ReceivablesService,
    private readonly matchService: ReceivableMatchService,
  ) {}

  /** Unified Contas a Receber list (open + recently received installments). */
  @Get()
  async getReceivables(): Promise<ReceivablesResponse> {
    return this.receivablesService.getReceivables();
  }

  /** Open installments offered as candidates to conciliate an incoming credit. */
  @Get('candidates/:transactionId')
  async candidates(@Param('transactionId') transactionId: string) {
    const data = await this.matchService.getReceivableCandidates(transactionId);
    return { success: true, message: 'Candidatos carregados.', data };
  }

  /** Identity-resolved allocation suggestion for a credit (who paid + which
   *  parcelas), ready for one-click confirmation — incl. lump-sum batches and
   *  already-paid clearance the plain candidate list can't express. */
  @Get('suggestion/:transactionId')
  async suggestion(@Param('transactionId') transactionId: string) {
    const data = await this.matchService.getReceivableSuggestion(transactionId);
    return { success: true, message: 'Sugestão carregada.', data };
  }

  /** Confirm the identity suggestion for a credit (operator one-click). */
  @Post('confirm-suggestion')
  @HttpCode(HttpStatus.OK)
  async confirmSuggestion(
    @Body(new ZodValidationPipe(unmatchSchema)) body: { transactionId: string },
    @UserId() userId: string,
  ) {
    return this.matchService.confirmReceivableSuggestion(body.transactionId, userId);
  }

  /** Manually conciliate a bank credit against an open installment. */
  @Post('match')
  @HttpCode(HttpStatus.OK)
  async match(
    @Body(new ZodValidationPipe(matchInstallmentSchema)) body: { transactionId: string; installmentId: string },
    @UserId() userId: string,
  ) {
    return this.matchService.manualMatchInstallment(body.transactionId, body.installmentId, userId);
  }

  /** Partial / multi allocation: settle one credit across one or more
   *  installments with explicit amounts (lump payment, partial receipt). */
  @Post('allocate')
  @HttpCode(HttpStatus.OK)
  async allocate(
    @Body(new ZodValidationPipe(allocateSchema))
    body: { transactionId: string; allocations: { installmentId: string; amount: number }[] },
    @UserId() userId: string,
  ) {
    return this.matchService.allocateInflow(body.transactionId, body.allocations, userId);
  }

  /** Reverse an inflow conciliation. */
  @Post('unmatch')
  @HttpCode(HttpStatus.OK)
  async unmatch(@Body(new ZodValidationPipe(unmatchSchema)) body: { transactionId: string }) {
    return this.matchService.unmatchInflow(body.transactionId);
  }

  /** Admin/manual sweep: auto-match all pending incoming credits now. */
  @Post('run-match')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async runMatch() {
    const matched = await this.matchService.matchInflowAll();
    return { success: true, message: `Conciliação de entradas executada: ${matched} pareada(s).`, data: { matched } };
  }
}
