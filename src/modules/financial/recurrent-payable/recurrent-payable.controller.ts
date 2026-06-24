import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { SECTOR_PRIVILEGES } from '@constants';
import { RecurrentPayableService } from './recurrent-payable.service';
import { RecurrentPayableScheduler } from './recurrent-payable.scheduler';
import {
  createRecurrentPayableSchema,
  CreateRecurrentPayableDto,
  markOccurrencePaidSchema,
  MarkOccurrencePaidDto,
  updateRecurrentPayableSchema,
  UpdateRecurrentPayableDto,
} from './dto/recurrent-payable.dto';

@Controller('financial/recurrent-payables')
// Same finance gate as the unified Contas a Pagar.
@Roles(SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.ACCOUNTING, SECTOR_PRIVILEGES.ADMIN)
export class RecurrentPayableController {
  constructor(
    private readonly service: RecurrentPayableService,
    private readonly scheduler: RecurrentPayableScheduler,
  ) {}

  @Get()
  async list(@Query('isActive') isActive?: string) {
    const filter = isActive === undefined ? {} : { isActive: isActive === 'true' };
    return this.service.list(filter);
  }

  /** Per-bill monthly dashboard for the unified Recorrentes page. `competence`
   *  is YYYY-MM; defaults to the current SP competence. */
  @Get('monthly')
  async monthly(@Query('competence') competence?: string) {
    const comp = /^\d{4}-\d{2}$/.test(competence ?? '')
      ? (competence as string)
      : this.service.currentCompetence();
    return this.service.monthlyView(comp);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createRecurrentPayableSchema)) dto: CreateRecurrentPayableDto,
    @UserId() userId: string,
  ) {
    return this.service.create(dto, userId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRecurrentPayableSchema)) dto: UpdateRecurrentPayableDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /** Mark a materialized occurrence paid. VARIABLE bills require `paidAmount`. */
  @Post('occurrences/:occurrenceId/pay')
  @HttpCode(HttpStatus.OK)
  async payOccurrence(
    @Param('occurrenceId') occurrenceId: string,
    @Body(new ZodValidationPipe(markOccurrencePaidSchema)) dto: MarkOccurrencePaidDto,
    @UserId() userId: string,
  ) {
    return this.service.markOccurrencePaid(occurrenceId, {
      paidAmount: dto.paidAmount,
      paymentMethod: dto.paymentMethod,
      userId,
    });
  }

  /** Admin/manual trigger to materialize due occurrences now (mirrors the cron). */
  @Post('run-due')
  @HttpCode(HttpStatus.OK)
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async runDue() {
    const result = await this.scheduler.runDue();
    return { success: true, message: 'Materialização executada.', data: result };
  }
}
