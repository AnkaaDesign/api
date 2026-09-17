import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  ParseUUIDPipe,
  ParseBoolPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingStatusCascadeService } from './billing-status-cascade.service';
import { TaskQuoteService } from '@modules/production/task-quote/task-quote.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { SECTOR_PRIVILEGES } from '@constants';

/**
 * O FATURAMENTO TEM ENDEREÇO PRÓPRIO.
 *
 * Antes desta rota, cobrança só se abria por veículo — e num orçamento de quatro
 * caminhões cobrados um a um, os quatro abriam a MESMA página, que então
 * desenhava "Fatura 1 · 2 · 3 · 4" lado a lado. Não era defeito de tela: não
 * havia quatro endereços porque não havia quatro coisas.
 *
 * `GET /billings/:id` é a quarta coisa. `GET /billings/by-task/:taskId` é a
 * ponte que mantém de pé todo link antigo — o web, os dois apps e as
 * notificações endereçam por tarefa, e `BillingTask.@@unique([taskId])` garante
 * que a resposta é uma só.
 */
@Controller('billings')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly taskQuoteService: TaskQuoteService,
    private readonly billingStatusCascade: BillingStatusCascadeService,
  ) {}

  /**
   * GET /billings
   * A lista de COBRANÇAS — uma linha por cobrança, não por veículo.
   *
   * `approved=false&deliveredOnly=true` é a fila que o financeiro nunca teve:
   * o que já foi entregue e ainda não foi cobrado.
   */
  @Get()
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findMany(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(40), ParseIntPipe) limit: number,
    @Query('quoteId') quoteId?: string,
    @Query('customerId') customerId?: string,
    @Query('approved') approved?: string,
    @Query('deliveredOnly') deliveredOnly?: string,
    @Query('statuses') statuses?: string,
    @Query('orderBy') orderBy?: string,
    @Query('orderDir') orderDir?: string,
  ) {
    return this.billingService.findMany({
      page,
      limit,
      quoteId: quoteId || undefined,
      customerId: customerId || undefined,
      approved: approved === undefined || approved === '' ? undefined : approved === 'true',
      deliveredOnly: deliveredOnly === 'true',
      // Lista separada por vírgula, como o resto dos filtros da casa.
      statuses: statuses ? statuses.split(',').map(v => v.trim()).filter(Boolean) : undefined,
      orderBy: (orderBy as any) || undefined,
      orderDir: (orderDir as any) || undefined,
    });
  }

  /** GET /billings/quote/:quoteId — as cobranças de um orçamento, em ordem. */
  @Get('quote/:quoteId')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findByQuote(@Param('quoteId', ParseUUIDPipe) quoteId: string) {
    return this.billingService.findByQuote(quoteId);
  }

  /**
   * GET /billings/by-task/:taskId — A PONTE.
   *
   * Declarada ANTES de `:id` de propósito: o Nest casa rotas na ordem em que são
   * declaradas, e `by-task` cairia dentro de `:id` se viesse depois (falhando no
   * `ParseUUIDPipe` com uma mensagem que não explica nada).
   */
  @Get('by-task/:taskId')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findByTask(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.billingService.findByTask(taskId);
  }

  /** GET /billings/:id — uma cobrança, com as irmãs para o navegador. */
  @Get(':id')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.findById(id);
  }

  /**
   * PUT /billings/:id/approve
   * Aprova ESTA cobrança — emite a fatura, a NFS-e e os boletos dela, e de
   * nenhuma outra.
   *
   * Substitui `PUT /task-quotes/:id/internal-approve/:taskId`, que endereçava a
   * cobrança por um de seus veículos. A rota antiga continua de pé para o app e
   * os links existentes; as duas chegam no mesmo lugar.
   */
  @Put(':id/approve')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async approve(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    const quoteId = await this.billingService.quoteIdOf(id);
    return this.taskQuoteService.internalApprove(quoteId, userId, null, id);
  }

  /**
   * PUT /billings/:id/settle
   * Liquida ESTA cobrança à mão: marca as parcelas dela como pagas e cancela os
   * boletos abertos.
   *
   * Substitui o caminho antigo, que era mandar `status: 'SETTLED'` para o
   * endpoint de status do ORÇAMENTO. Naquele desenho, liquidar o primeiro de
   * sessenta caminhões marcava os sessenta — o estado era um só. Aqui o escopo é
   * a cobrança, e nenhuma outra é tocada.
   */
  @Put(':id/settle')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async settle(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    const quoteId = await this.billingService.quoteIdOf(id);
    await this.taskQuoteService.settleManually(quoteId, userId, id);
    await this.billingStatusCascade.recomputeBilling(id);
    return { success: true, message: 'Faturamento liquidado com sucesso.' };
  }

  /**
   * PUT /billings/:id/revert
   * Desfaz ESTA cobrança: apaga a fatura, as parcelas e os boletos dela, baixa os
   * títulos no Sicredi e levanta o carimbo de aprovação — sem tocar nas outras.
   *
   * Substitui, para o caso de uma cobrança, o `PUT /task-quotes/:id/revert-billing`,
   * que sempre desmontou o orçamento INTEIRO: num orçamento de três lotes,
   * reverter o lote 3 apagava fatura e boleto dos lotes 1 e 2. A rota do orçamento
   * continua de pé para "reverter tudo".
   */
  @Put(':id/revert')
  @Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL)
  async revert(@Param('id', ParseUUIDPipe) id: string, @UserId() userId: string) {
    const quoteId = await this.billingService.quoteIdOf(id);
    return this.taskQuoteService.revertBillingApproval(quoteId, userId, id);
  }

  /**
   * GET /billings/:id/frozen
   * Esta cobrança pode ser recomposta? Existe para a tela DESABILITAR o que o
   * servidor vai recusar, em vez de deixar o usuário descobrir pelo toast.
   */
  @Get(':id/frozen')
  @Roles(
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.ACCOUNTING,
  )
  async frozen(@Param('id', ParseUUIDPipe) id: string) {
    const frozen = await this.billingService.isFrozen(id);
    return {
      success: true,
      message: frozen
        ? 'Faturamento congelado: já aprovado ou com fatura emitida.'
        : 'Faturamento aberto.',
      data: { frozen },
    };
  }
}
