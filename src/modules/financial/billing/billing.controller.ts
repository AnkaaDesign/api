import {
  BadRequestException,
  Controller,
  Get,
  Put,
  Param,
  Query,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { BillingService, BILLING_ORDER_BY } from './billing.service';
import type { BillingDateRange, BillingNumberRange, BillingOrderDir } from './billing.service';
import { BillingStatusCascadeService } from './billing-status-cascade.service';
import { BudgetService } from '@modules/production/budget/budget.service';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { BILLING_STATUS, SECTOR_PRIVILEGES, TASK_QUOTE_STATUS } from '@constants';

/**
 * OS ÚNICOS `orderBy` QUE ESTA ROTA ACEITA — a lista vem do serviço
 * (`BILLING_ORDER_BY_FIELDS`), que é quem sabe traduzir cada chave para o Prisma.
 *
 * A validação é curta de propósito: o valor iria direto para o `orderBy` do
 * Prisma, e um nome de campo que não existe não vira 400 — vira 500, porque o erro
 * nasce lá dentro do driver. Validar aqui é o que separa "pedido inválido" de
 * "servidor quebrado", e é a mesma razão de `statuses` ser conferido contra o enum.
 *
 * Ter UMA fonte (o mapa do serviço) é o que impede o defeito clássico destes três
 * lugares que precisam concordar: o whitelist aceitava um nome que o mapa não
 * traduzia, e a tela recebia 500 numa ordenação que o 400 dizia ser válida.
 */
const BILLING_ORDER_DIR = ['asc', 'desc'] as const;

/**
 * LISTA DE FILTRO: `chave=a,b` ou `chave[]=a&chave[]=b`.
 *
 * As duas formas chegam da tela — o `DataTable` serializa arrays em colchetes e os
 * links salvos carregam a vírgula. Aceitar só uma fazia o filtro ser ignorado em
 * silêncio, que na lista de faturamento significa mostrar tudo como se nada
 * estivesse marcado.
 */
function parseList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const out = raw.map(v => String(v).trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

/**
 * BOOLEANO DE QUERY STRING — e por que comparar com `'true'` não bastava.
 *
 * O parser de query da aplicação (`main.ts`) converte `'true'`/`'false'` em
 * booleanos DE VERDADE antes de o Nest ver o valor. O código antigo fazia
 * `approved === 'true'` sobre um `true` booleano: dava `false`. Ou seja
 * `?approved=true` listava exatamente o contrário do pedido (o que ainda NÃO fora
 * faturado), e `?deliveredOnly=true` nunca filtrou nada — dois filtros ligados na
 * tela e desligados no servidor, sem erro em lugar nenhum.
 */
function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

/** Objeto de query — `chave[min]=1` (colchetes), `chave.min=1` (ponto) ou JSON. */
function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const raw = String(value).trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseDate(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Data inválida em ${label}: ${String(value)}.`);
  }
  return date;
}

/**
 * FAIXA DE DATAS. Aceita `from`/`to` (como a tela escreve) e `gte`/`lte` (como o
 * Prisma escreve) porque os dois vocabulários circulam nos filtros salvos — um
 * deles ser ignorado é o filtro sumir sem aviso.
 */
function parseDateRange(value: unknown, label: string): BillingDateRange | undefined {
  const obj = parseObject(value);
  if (!obj) return undefined;
  const from = parseDate(obj.from ?? obj.gte ?? obj.start, `${label}.from`);
  const to = parseDate(obj.to ?? obj.lte ?? obj.end, `${label}.to`);
  return from || to ? { from, to } : undefined;
}

function parseNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(String(value).replace(',', '.').trim());
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`Número inválido em ${label}: ${String(value)}.`);
  }
  return n;
}

/** Faixa numérica. `min`/`max` da tela, `gte`/`lte` do Prisma — as duas valem. */
function parseNumberRange(value: unknown, label: string): BillingNumberRange | undefined {
  const obj = parseObject(value);
  if (!obj) return undefined;
  const min = parseNumber(obj.min ?? obj.gte, `${label}.min`);
  const max = parseNumber(obj.max ?? obj.lte, `${label}.max`);
  return min !== undefined || max !== undefined ? { min, max } : undefined;
}

/**
 * Confere uma lista de filtro contra o enum dela.
 *
 * Sem isto o valor ia cru para o `where.status.in` e o Prisma respondia com erro
 * de validação de enum, que o filtro global traduz em 500: o cliente pedia errado
 * e a culpa aparecia como se fosse do servidor.
 */
function assertEnumList(values: string[] | undefined, allowed: string[], label: string): void {
  if (!values?.length) return;
  const invalid = values.filter(v => !allowed.includes(v));
  if (invalid.length > 0) {
    throw new BadRequestException(
      `${label} inválido: ${invalid.join(', ')}. Valores aceitos: ${allowed.join(', ')}.`,
    );
  }
}

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
    private readonly budgetService: BudgetService,
    private readonly billingStatusCascade: BillingStatusCascadeService,
  ) {}

  /**
   * GET /billings
   * A lista de COBRANÇAS — uma linha por cobrança, não por veículo.
   *
   * `approved=false&deliveredOnly=true` é a fila que o financeiro nunca teve:
   * o que já foi entregue e ainda não foi cobrado.
   *
   * ⚠️ `quoteStatuses` não tem padrão, e a tela de Faturamento TEM de mandá-lo.
   * `Billing` nasce junto com o orçamento, não na aprovação: sem esse filtro, a
   * lista traz cobrança de orçamento PENDING que ninguém assinou e de EXPIRED que
   * voltou ao comercial para reanálise do preço — faturar um deles é cobrar um
   * valor que ainda não foi vendido. Quem pede `?quoteId=` é a exceção, e por isso
   * o filtro é opcional.
   *
   * Todo parâmetro além de `page`/`limit` é opcional, e o que não vier não filtra.
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
    @Query('customerId') customerId?: unknown,
    @Query('approved') approved?: unknown,
    @Query('deliveredOnly') deliveredOnly?: unknown,
    @Query('statuses') statuses?: unknown,
    @Query('quoteStatuses') quoteStatuses?: unknown,
    @Query('searchingFor') searchingFor?: unknown,
    @Query('budgetNumber') budgetNumber?: unknown,
    @Query('customerIds') customerIds?: unknown,
    @Query('taskCustomerIds') taskCustomerIds?: unknown,
    @Query('totalRange') totalRange?: unknown,
    @Query('hasOrderNumber') hasOrderNumber?: unknown,
    @Query('dueDateRange') dueDateRange?: unknown,
    @Query('finishedDateRange') finishedDateRange?: unknown,
    @Query('billingApprovedRange') billingApprovedRange?: unknown,
    @Query('createdAtRange') createdAtRange?: unknown,
    @Query('orderBy') orderBy?: unknown,
    @Query('orderDir') orderDir?: unknown,
  ) {
    const parsedStatuses = parseList(statuses);
    assertEnumList(
      parsedStatuses,
      Object.values(BILLING_STATUS) as string[],
      'Estado de faturamento',
    );

    const parsedQuoteStatuses = parseList(quoteStatuses);
    assertEnumList(
      parsedQuoteStatuses,
      Object.values(TASK_QUOTE_STATUS) as string[],
      'Estado de orçamento',
    );

    // ORDENAÇÃO EM LISTA, porque o padrão da tela tem DUAS chaves (o estado da
    // cobrança e, dentro dele, a data). A rota aceitava uma só e descartava a
    // segunda em silêncio — a lista chegava ordenada por um critério que ninguém
    // pediu, e ninguém tinha como perceber. Cada entrada pode trazer a direção
    // colada (`budgetNumber:desc`); `orderDir` pareia por posição, e uma direção
    // sozinha vale para todas as chaves.
    const orderFields: string[] = [];
    const orderDirs: BillingOrderDir[] = [];
    const rawDirs = parseList(orderDir) ?? [];
    const rawFields = parseList(orderBy) ?? [];

    rawFields.forEach((entry, index) => {
      const [field, inlineDir] = entry.split(':').map(part => part.trim());
      if (!BILLING_ORDER_BY.includes(field)) {
        throw new BadRequestException(
          `Ordenação inválida: ${field}. Valores aceitos: ${BILLING_ORDER_BY.join(', ')}. ` +
            'Nome, identificador, cliente e valor não são ordenáveis nesta lista: ' +
            'os três primeiros vêm dos veículos cobertos (vários por cobrança) e o ' +
            'valor é a soma dos pagadores — nenhum é coluna do faturamento.',
        );
      }
      const dir = (inlineDir || rawDirs[index] || rawDirs[0] || 'asc').toLowerCase();
      if (!BILLING_ORDER_DIR.includes(dir as BillingOrderDir)) {
        throw new BadRequestException(
          `Direção de ordenação inválida: ${dir}. Valores aceitos: ${BILLING_ORDER_DIR.join(', ')}.`,
        );
      }
      orderFields.push(field);
      orderDirs.push(dir as BillingOrderDir);
    });

    // Sem `orderBy` mas com `orderDir` — a direção sozinha ainda governa o padrão.
    if (orderFields.length === 0 && rawDirs.length > 0) {
      const dir = rawDirs[0].toLowerCase();
      if (!BILLING_ORDER_DIR.includes(dir as BillingOrderDir)) {
        throw new BadRequestException(
          `Direção de ordenação inválida: ${dir}. Valores aceitos: ${BILLING_ORDER_DIR.join(', ')}.`,
        );
      }
      orderDirs.push(dir as BillingOrderDir);
    }

    const search = searchingFor === undefined ? undefined : String(searchingFor).trim();

    // O número do orçamento é `Int` no banco. Um "984,5" digitado por engano viraria
    // um decimal que o Prisma recusa lá dentro — 500 por um filtro mal preenchido.
    const parsedBudgetNumber = parseNumber(
      budgetNumber === undefined ? undefined : String(budgetNumber).replace(/^#/, ''),
      'budgetNumber',
    );
    if (parsedBudgetNumber !== undefined && !Number.isInteger(parsedBudgetNumber)) {
      throw new BadRequestException(
        `Número de orçamento inválido: ${String(budgetNumber)}. Informe um número inteiro.`,
      );
    }

    return this.billingService.findMany({
      page,
      limit,
      quoteId: quoteId || undefined,
      customerId: customerId ? String(customerId) : undefined,
      approved: parseBool(approved),
      deliveredOnly: parseBool(deliveredOnly) ?? false,
      statuses: parsedStatuses,
      quoteStatuses: parsedQuoteStatuses,
      searchingFor: search || undefined,
      budgetNumber: parsedBudgetNumber,
      customerIds: parseList(customerIds),
      taskCustomerIds: parseList(taskCustomerIds),
      totalRange: parseNumberRange(totalRange, 'totalRange'),
      hasOrderNumber: parseBool(hasOrderNumber),
      dueDateRange: parseDateRange(dueDateRange, 'dueDateRange'),
      finishedDateRange: parseDateRange(finishedDateRange, 'finishedDateRange'),
      billingApprovedRange: parseDateRange(billingApprovedRange, 'billingApprovedRange'),
      createdAtRange: parseDateRange(createdAtRange, 'createdAtRange'),
      orderBy: orderFields.length > 0 ? orderFields : undefined,
      orderDir: orderDirs.length > 0 ? orderDirs : undefined,
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
    return this.budgetService.internalApprove(quoteId, userId, null, id);
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
    await this.budgetService.settleManually(quoteId, userId, id);
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
    return this.budgetService.revertBillingApproval(quoteId, userId, id);
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
