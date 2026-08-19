import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '@constants';
import { ReceivablesService } from './receivables.service';
import { ReceivableMatchService } from './receivable-match.service';
import { ReceivableTaskMatchService } from './receivable-task-match.service';
import { taskMatchSchema } from './dto/task-match.dto';
import { ReceivablesResponse, TaskMatchAllocationInput } from '../../../types';

const matchInstallmentSchema = z.object({
  transactionId: z.string().uuid(),
  installmentId: z.string().uuid(),
});

const unmatchSchema = z.object({ transactionId: z.string().uuid() });

const externalClearanceSchema = z.object({
  installmentId: z.string().uuid(),
  cleared: z.boolean().default(true),
  note: z.string().trim().max(500).optional().nullable(),
});

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
    private readonly taskMatchService: ReceivableTaskMatchService,
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

  /**
   * Declare a receipt reconciled with NO bank line behind it — the case of money
   * paid into a partner's personal account, where the confirming statement line
   * will never exist because it was never our account.
   *
   * ADMIN/ACCOUNTING only, narrower than this controller's class-level gate:
   * FINANCIAL records and collects receipts, but asserting that money arrived
   * somewhere we cannot see is an accounting call, and nothing in the system can
   * contradict it afterwards.
   */
  @Post('external-clearance')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.ACCOUNTING)
  async setExternalClearance(
    @Body(new ZodValidationPipe(externalClearanceSchema))
    body: { installmentId: string; cleared: boolean; note?: string | null },
    @UserId() userId: string,
  ) {
    return this.receivablesService.setExternalClearance(
      body.installmentId,
      body.cleared,
      body.note,
      userId,
    );
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

  /**
   * Tasks offered as conciliation targets for a credit — including tasks that
   * have NO quote, which the installment candidate list structurally cannot
   * see (no quote → no invoice → no parcela → nothing to anchor a match to).
   *
   * Without `search` the list is identity-derived (who paid, by CNPJ/CPF or
   * counterparty name). With `search` the operator overrides identity and looks
   * the task up by name, série, placa, chassi or cliente.
   */
  @Get('task-candidates/:transactionId')
  async taskCandidates(
    @Param('transactionId') transactionId: string,
    @Query('search') search?: string,
  ) {
    const data = await this.taskMatchService.getTaskCandidates(transactionId, search);
    return { success: true, message: 'Tarefas candidatas carregadas.', data };
  }

  /**
   * Conciliate a credit against one or more tasks, creating the orçamento /
   * fatura / parcela chain for whichever tasks are missing it, then allocating
   * the money onto the resulting parcelas. The quote's own status is left to
   * the ordinary cascade, which lands it on PARTIAL or SETTLED.
   */
  @Post('match-task')
  @HttpCode(HttpStatus.OK)
  async matchTask(
    // Body typed by hand rather than via `z.infer`: the API compiles with
    // `strict: false`, under which zod widens every field to optional.
    @Body(new ZodValidationPipe(taskMatchSchema))
    body: { transactionId: string; allocations: TaskMatchAllocationInput[]; notes?: string },
    @UserId() userId: string,
  ) {
    return this.taskMatchService.matchTasks(
      body.transactionId,
      body.allocations,
      userId,
      body.notes,
    );
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
