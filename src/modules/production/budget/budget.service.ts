// api/src/modules/production/budget/budget.service.ts

import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SignatureEnvelopeService } from '@modules/common/signature/services/signature-envelope.service';
import { SignatureDeletionService } from '@modules/common/signature/services/signature-deletion.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { BudgetRepository } from './repositories/budget.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { InvoiceGenerationService } from '@modules/financial/invoice/invoice-generation.service';
import { NfseEmissionScheduler } from '@modules/integrations/nfse/nfse-emission.scheduler';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';
import { FileService } from '@modules/common/file/file.service';
import type {
  BudgetCreateFormData,
  BudgetUpdateFormData,
  BudgetGetManyFormData,
} from '@schemas/budget';
import type {
  BudgetGetManyResponse,
  BudgetGetUniqueResponse,
  BudgetCreateResponse,
  BudgetUpdateResponse,
  BudgetDeleteResponse,
  BudgetBatchCreateResponse,
  BudgetBatchUpdateResponse,
  BudgetBatchDeleteResponse,
  Budget,
} from '@types';
import {
  TASK_QUOTE_STATUS,
  TASK_STATUS,
  TASK_QUOTE_STATUS_LABELS,
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_LOG_ACTION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  INSTALLMENT_STATUS,
  BANK_SLIP_STATUS,
  INVOICE_STATUS,
  // `NFSE_STATUS` saiu com a lógica de substituição, que mudou de casa para o
  // serviço da Elotech (`supersedePreviousNfses`). `NFSE_LIVE_STATUSES` fica: a
  // reversão ainda precisa saber quais notas estão vivas na prefeitura.
  NFSE_LIVE_STATUSES,
  NFSE_READY_FOR_BOLETO_STATUSES,
  NFSE_IN_FLIGHT_STATUSES,
  BILLING_STATUS,
  BILLING_STATUS_ORDER,
} from '@constants';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import { CHANGE_TRIGGERED_BY } from '@constants';
import { logQuoteServiceChanges } from '@modules/common/changelog/utils/quote-service-changelog';
import { serializeChangelogValue } from '@modules/common/changelog/utils/serialize-changelog-value';
import { trackAndLogFieldChanges } from '@modules/common/changelog/utils/changelog-helpers';
import { normalizeDescription } from '@utils';
import { SERVICE_ORDER_TYPE, SERVICE_ORDER_STATUS } from '@constants';
import { TASK_QUOTE_STATUS_ORDER } from '@constants';
import {
  getQuoteItemToServiceOrderSync,
  type SyncServiceOrder,
} from '../../../utils/budget-service-order-sync';
import { getServiceOrderStatusOrder } from '../../../utils/sortOrder';
import { syncEmNegociacaoForQuote } from '../../../utils/em-negociacao-sync';
import {
  syncTaskLayoutsFromQuote,
  reproveNonSelectedTaskLayoutsFromQuote,
} from '../../../utils/sync-quote-task-layouts';
import { BudgetStatusCascadeService } from './budget-status-cascade.service';
import { BillingStatusCascadeService } from '@modules/financial/billing/billing-status-cascade.service';
import { recalcQuoteTotals } from '../../../utils/budget-totals';
import {
  judgeMerge,
  type MergeBlocker,
  type MergeCandidate,
  type MergeWarning,
} from '../../../utils/budget-merge-rules';
import {
  computeQuoteMoney,
  planCoverage,
  planCoverageByCustomer,
  round2,
} from '@utils/quote-money';
import {
  describePrismaFailure,
  distinctCustomerIds,
  hasMultipleCustomers,
  isSingleCustomerQuote,
  primaryTask,
  quoteTasks,
  sortQuoteTasks,
} from '@utils/quote-tasks';
import { allocateBudgetNumber } from '../../../utils/budget-number';
import {
  reconcileQuoteCustomerConfigs,
  resliceQuoteCoverage,
} from '../../../utils/budget-customer-config-sync';
import {
  BILLING_FROZEN_WHERE,
  isBillingApproved,
  isBillingFrozen,
  isQuoteMoneyLocked,
  QUOTE_VALUE_REVERTABLE_STATUSES,
  QUOTE_MONEY_LOCK_INCLUDE,
  QUOTE_SAFE_AFTER_BILLING_FIELDS,
  validateQuoteStatusChangeRole,
} from './budget.guards';
import { LIVE_INVOICE_WHERE } from '../../../utils/billing-invoice';
import { deriveInvoicePaymentState } from '@modules/financial/invoice/invoice-payment-state';
import { QUOTE_TASKS_ORDER_BY } from '@utils/quote-tasks';
import { billingDeepLinkForInvoice } from '@utils/billing-links';
import {
  abandonUnmintedNfseDocuments,
  deleteInstallmentsWithSlips,
} from '@utils/billing-teardown';
import { reconcileBillingsForQuote } from '@utils/budget-customer-config-sync';

/**
 * Compute the discount amount for a customer config based on its discount type, value, and subtotal.
 */
function computeConfigDiscount(
  subtotal: number,
  discountType?: string,
  discountValue?: number | null,
): number {
  if (!discountType || discountType === 'NONE' || !discountValue) return 0;
  if (discountType === 'PERCENTAGE')
    return Math.round(((subtotal * discountValue) / 100) * 100) / 100;
  if (discountType === 'FIXED_VALUE') return Math.min(discountValue, subtotal);
  return 0;
}

/**
 * Service for managing Budget entities
 * Handles CRUD operations, status management, and business logic
 */
@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetRepository: BudgetRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    @Inject(forwardRef(() => InvoiceGenerationService))
    private readonly invoiceGenerationService: InvoiceGenerationService,
    private readonly nfseEmissionScheduler: NfseEmissionScheduler,
    private readonly sicrediService: SicrediService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly elotechNfseService: ElotechOxyNfseService,
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly signatureEnvelopes: SignatureEnvelopeService,
    @Inject(forwardRef(() => SignatureDeletionService))
    private readonly signatureDeletion: SignatureDeletionService,
    // A cascata do ORÇAMENTO: reconcilia a O.S. "Em Negociação" e dispara o aviso
    // de contrato quitado. Não calcula mais status — isso é da cobrança.
    @Inject(forwardRef(() => BudgetStatusCascadeService))
    private readonly statusCascadeService: BudgetStatusCascadeService,
    // A cascata da COBRANÇA: deriva `Billing.status` das parcelas. É quem fecha o
    // estado depois de aprovar um faturamento, e quem o recalcula quando uma
    // aprovação falha no meio.
    private readonly billingStatusCascade: BillingStatusCascadeService,
  ) {}

  /**
   * Find many quotes with filtering, pagination, and sorting
   */
  async findMany(query: BudgetGetManyFormData): Promise<BudgetGetManyResponse> {
    try {
      // ⚠️ `GET /task-quotes` NÃO PAGINAVA.
      //
      // O zod declara `page`/`limit` (e os coage, e dá `default`), e o
      // repositório lê `skip`/`take` — ninguém traduzia entre os dois. Resultado:
      // `?page=2&limit=40` devolvia a TABELA INTEIRA, e o `meta` calculado a
      // partir de `take` indefinido dizia "página 1 de 1" sobre 722 registros.
      // Ninguém tinha percebido porque nenhuma tela consumia esta rota — a lista
      // de Orçamentos consultava tarefas.
      //
      // `skip`/`take` explícitos continuam ganhando: são o contrato de baixo
      // nível, e quem os manda sabe o que quer.
      const limit = query.take ?? query.limit ?? 20;
      const page = Math.max(1, query.page ?? 1);
      const paginated = {
        ...query,
        take: limit,
        skip: query.skip ?? (page - 1) * limit,
        // A FILA, quando ninguém pediu outra coisa.
        //
        // "Primeiro os mais antigos pendentes, depois os mais novos aprovados."
        // As duas metades correm em DIREÇÕES OPOSTAS: um pendente antigo é uma
        // proposta esquecida (o mais velho é o mais urgente), um aprovado é
        // trabalho resolvido (interessa o que acabou de entrar). `queueRank` é a
        // coluna gerada que carrega essa inversão — o instante de criação em
        // segundos, negado para APPROVED e CANCELLED — e é por isso que as duas
        // chaves podem ser `asc`.
        //
        // O padrão mora AQUI, e não só na tela, porque sem ele o Postgres
        // devolve a ordem física do heap: o app, a página pública e qualquer
        // chamada direta veriam uma lista embaralhada que muda a cada `UPDATE`.
        orderBy: query.orderBy ?? [{ statusOrder: 'asc' }, { queueRank: 'asc' }],
      };
      const result = await this.budgetRepository.findMany(paginated);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Orçamentos carregados com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error finding task quotes:', error);
      throw new InternalServerErrorException('Erro ao carregar orçamentos.');
    }
  }

  /**
   * Find unique quote by ID
   *
   * ⚠️ The repository takes `{ include }` — an OPTIONS object — not the include
   * itself. Passing the raw include here made `options?.include` undefined, so
   * every GET /task-quotes/:id silently fell back to the repository's default
   * include: no `task` and, critically, no `layoutFiles`. That is why the mobile
   * quote detail saw an empty `layoutFiles` on a quote that HAS an approved
   * layout selected and refused to approve the budget ("Selecione um layout
   * aprovado antes de aprovar o orçamento") — the client mirror of the server
   * guard fired on a payload the server never sent. Keep the wrapper.
   */
  async findUnique(id: string, include?: any): Promise<BudgetGetUniqueResponse> {
    try {
      const quote = await this.budgetRepository.findById(id, include ? { include } : undefined);

      if (!quote) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      return {
        success: true,
        data: quote,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding task quote ${id}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Find quote by task ID
   */
  async findByTaskId(taskId: string): Promise<BudgetGetUniqueResponse> {
    try {
      const quote = await this.budgetRepository.findByTaskId(taskId);

      // Return null data when no quote exists (not an error - task may not have a quote yet)
      if (!quote) {
        return {
          success: true,
          data: null,
          message: 'Nenhum orçamento encontrado para esta tarefa.',
        };
      }

      return {
        success: true,
        data: quote,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding quote for task ${taskId}:`, error);
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Create new quote
   *
   * `externalTx` existe para a criação ATÔMICA de tarefas + orçamento
   * (`TaskService.batchCreateWithQuote`). A tela de criação produzia N tarefas
   * numa requisição cada e o orçamento numa última: quando a última falhava, as
   * N tarefas ficavam órfãs e o operador recebia N avisos de sucesso seguidos de
   * um de erro — com a instrução de "criar o orçamento por uma das tarefas", que
   * deixaria os outros N-1 veículos de fora. Recebendo a transação de fora, o
   * orçamento nasce ou não nasce JUNTO com as tarefas.
   */
  async create(
    data: BudgetCreateFormData,
    userId: string,
    externalTx?: PrismaTransaction,
  ): Promise<BudgetCreateResponse> {
    try {
      // Toda leitura de validação usa a transação quando ela existe: fora dela,
      // as tarefas recém-criadas pelo mesmo `$transaction` ainda não estão
      // visíveis, e a validação de existência recusaria o próprio lote.
      const db = externalTx ?? this.prisma;
      // ═══════════════════════════════════════════════════════════════════════
      // AS TAREFAS DO ORÇAMENTO
      // ═══════════════════════════════════════════════════════════════════════
      //
      // `taskIds` é a forma nova; `taskId` continua aceito porque o app Flutter
      // instalado nos aparelhos manda o singular e não é atualizado no mesmo
      // instante que a API.
      //
      // A tela de criação já produzia N tarefas do produto cartesiano de placas
      // × números de série. O que mudou é que elas passam a compartilhar UM
      // orçamento: o Marquespan de 02/09 saiu como sessenta orçamentos (642 a
      // 701), sessenta PDFs e sessenta cerimônias de assinatura para o mesmo
      // trabalho repetido sessenta vezes.
      const taskIds =
        data.taskIds && data.taskIds.length > 0
          ? [...new Set(data.taskIds)]
          : (data as any).taskId
            ? [(data as any).taskId as string]
            : [];
      if (taskIds.length === 0) {
        throw new BadRequestException('Informe ao menos uma tarefa para o orçamento.');
      }
      const billingSplit: 'JOINT' | 'PER_TASK' | 'CUSTOM' =
        (data as any).billingSplit === 'PER_TASK'
          ? 'PER_TASK'
          : (data as any).billingSplit === 'CUSTOM'
            ? 'CUSTOM'
            : 'JOINT';

      // Carrega TODAS as tarefas: existência, vínculo prévio e o elenco de
      // responsáveis (que é a união das tarefas, não a da primeira).
      const tasks = await db.task.findMany({
        where: { id: { in: taskIds } },
        include: {
          responsibles: { select: { id: true, roles: true }, orderBy: { createdAt: 'asc' } },
          quote: { select: { budgetNumber: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      if (tasks.length !== taskIds.length) {
        const found = new Set(tasks.map(t => t.id));
        const missing = taskIds.filter(id => !found.has(id));
        throw new BadRequestException(
          missing.length === taskIds.length
            ? 'Tarefa não encontrada.'
            : `${missing.length} tarefa(s) informada(s) não foram encontradas.`,
        );
      }

      // Tarefa que JÁ tem orçamento não é revinculada em silêncio.
      //
      // Antes isto era um `task.update({ quoteId })` que sobrescrevia o vínculo,
      // e o orçamento anterior ficava sem tarefa nenhuma — um registro com
      // número, valor e talvez uma coleta de assinaturas, invisível em toda tela
      // que lista por tarefa. Com N tarefas o estrago se multiplica, então a
      // resposta passa a ser explícita: quem quer trocar apaga o antigo primeiro.
      const alreadyQuoted = tasks.filter(t => t.quoteId);
      if (alreadyQuoted.length > 0) {
        const labels = alreadyQuoted
          .slice(0, 5)
          .map(t => {
            const num = (t as any).quote?.budgetNumber;
            const who = t.serialNumber ? `#${t.serialNumber}` : (t.name ?? t.id.slice(0, 8));
            return num ? `${who} (orçamento nº ${num})` : who;
          })
          .join(', ');
        throw new BadRequestException(
          alreadyQuoted.length === 1
            ? `A tarefa ${labels} já possui orçamento. Exclua o orçamento existente antes de criar outro.`
            : `${alreadyQuoted.length} tarefas já possuem orçamento (${labels}${
                alreadyQuoted.length > 5 ? ', …' : ''
              }). Exclua os orçamentos existentes antes de criar outro.`,
        );
      }

      const task = tasks[0];

      // O PAGADOR NÃO ELEGE MAIS UM RESPONSÁVEL. Havia aqui um bloco que
      // escolhia "o melhor" responsável da tarefa e o gravava em cada fatia de
      // faturamento, para o documento ter um "À fulano". Quem responde pelo
      // orçamento é `Task.responsibles`, inteira; quem ASSINA se decide no envio
      // para assinatura. Eleger um segundo dono aqui criava uma cópia que
      // divergia da lista em silêncio.

      // Validate customerConfigs customer IDs.
      //
      // ⚠️ CLIENTES DISTINTOS, não fatias. Com lote — e com `PER_TASK` — o mesmo
      // cliente aparece K vezes em `customerConfigs`, e comparar o tamanho da
      // lista COM REPETIÇÃO contra as linhas encontradas no banco recusava o
      // orçamento inteiro com "cliente não encontrado" — sobre um cliente que
      // existe. É a mesma confusão de `configs.length` com nº de clientes que já
      // recusara a aprovação de faturamento em cinco telas.
      const customerIds = distinctCustomerIds(data.customerConfigs);
      const customers = await db.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true },
      });

      if (customers.length !== customerIds.length) {
        throw new BadRequestException(
          'Um ou mais clientes selecionados para faturamento não foram encontrados.',
        );
      }

      // NOTE: Each task has its own independent quote record.
      // When copying a quote (e.g. via copyFromTask), a new Budget is created as a deep copy.

      // Validate services exist
      if (!data.services || data.services.length === 0) {
        throw new BadRequestException('Pelo menos um serviço é obrigatório.');
      }

      // ═══════════════════════════════════════════════════════════════════════
      // DINHEIRO
      // ═══════════════════════════════════════════════════════════════════════
      //
      // `BudgetItem.amount` é o preço de UM veículo. A conta de cada
      // configuração de faturamento é `computeQuoteMoney`, a mesma que
      // `recalcQuoteTotals` usa depois e a mesma que o documento imprime — é
      // isso que faz o PDF assinado e o boleto fecharem no centavo.
      //
      // `configTotal` já vem no escopo certo, porque a conta é `por veículo ×
      // veículos COBERTOS`: o total geral quando a fatura cobre os sessenta, o de
      // um caminhão quando cobre um, o do lote quando cobre vinte.
      //
      // ⚠️ UM CLIENTE, não UMA FATURA. Um orçamento cobrado veículo a veículo tem
      // uma fatura por VEÍCULO: quatro caminhões do mesmo cliente são quatro
      // faturas, e contá-las fazia o filtro abaixo rodar — deixando as quatro com
      // ZERO serviços, porque num orçamento de um cliente só ninguém preenche
      // `invoiceToCustomerId`. Ver a nota em `utils/quote-tasks.ts`.
      const isSingleConfig = isSingleCustomerQuote(data.customerConfigs);

      // ─── O PLANO DE FATURAMENTO ──────────────────────────────────────────
      //
      // Uma entrada por FATURA a criar: o cliente, os veículos que ela cobra e o
      // dinheiro dela. `planCoverage` reparte os veículos conforme o modo; num
      // orçamento em lotes, conforme o que a tela declarou em `taskIds`.
      const plannedConfigs: Array<{
        config: (typeof data.customerConfigs)[number];
        coverage: string[];
        money: ReturnType<typeof computeQuoteMoney>;
      }> = [];

      // ⚠️ O PLANO É POR CLIENTE, NUNCA POR CONFIGURAÇÃO.
      //
      // `planCoverage` ISOLA todo veículo que nenhum lote reivindicou (é o que
      // faz o `CUSTOM` recém-declarado nascer um-por-veículo). Chamando-a uma vez
      // por CONFIGURAÇÃO, com um grupo só, cada fatia reivindicava o seu lote e
      // recebia os lotes das outras como veículos isolados: num orçamento de
      // quatro caminhões em dois lotes, cada caminhão aparecia DUAS vezes no
      // plano, e o `createMany` de `BillingTask` — cuja unicidade é global — caía
      // em P2002 ("Já existe registro com estes dados") na criação inteira.
      //
      // A EDIÇÃO sempre acertou: `reconcileQuoteCustomerConfigs` agrupa por
      // cliente e entrega TODOS os lotes dele a uma chamada só. A criação passa a
      // usar a MESMA regra, agora escrita uma vez em `planCoverageByCustomer`,
      // para que os dois caminhos não possam divergir de novo.
      for (const { config, coverage } of planCoverageByCustomer(
        data.customerConfigs,
        taskIds,
        billingSplit,
      )) {
        // Com um cliente só, TODO serviço é dele, independentemente de um
        // `invoiceToCustomerId` remanescente de quando o orçamento teve dois.
        // Filtrar ali derrubaria serviços do subtotal em silêncio.
        const assignedServices = isSingleConfig
          ? data.services || []
          : (data.services || []).filter(s => s.invoiceToCustomerId === config.customerId);
        const money = computeQuoteMoney({
          serviceAmounts: assignedServices.map(sv => sv.amount || 0),
          discountType: (config as any).discountType,
          discountValue: (config as any).discountValue,
          taskCount: taskIds.length,
          coveredTaskCount: coverage.length || undefined,
        });
        plannedConfigs.push({ config, coverage, money });
      }

      // O agregado do orçamento é SEMPRE o valor do contrato inteiro. Somar as
      // faturas dá esse número nos três modos, porque as coberturas PARTICIONAM
      // os veículos — uma fatura de sessenta, sessenta de um, ou três de vinte.
      let aggregateSubtotal = round2(
        plannedConfigs.reduce((sum, p) => sum + p.money.configSubtotal, 0),
      );
      let aggregateTotal = round2(plannedConfigs.reduce((sum, p) => sum + p.money.configTotal, 0));
      if (!isSingleConfig) {
        // Serviço sem cliente atribuído não entra em nenhuma configuração acima,
        // então o valor dele sairia do agregado. Ele entra sem desconto e
        // multiplicado pelos veículos, porque é serviço prestado em cada um. A
        // guarda de aprovação de faturamento continua barrando a aprovação
        // enquanto houver serviço sem cliente, então isto nunca chega a uma
        // fatura — é só para o rascunho não mentir na tela.
        const unassignedSum = (data.services || [])
          .filter(s => !s.invoiceToCustomerId)
          .reduce((sum, s) => sum + (s.amount || 0), 0);
        const unassignedRounded = round2(unassignedSum * taskIds.length);
        aggregateSubtotal = round2(aggregateSubtotal + unassignedRounded);
        aggregateTotal = round2(aggregateTotal + unassignedRounded);
      }

      // Create quote with items in transaction (ou DENTRO da transação de quem
      // chamou, no caminho atômico de tarefas + orçamento).
      const createInTransaction = async (tx: PrismaTransaction) => {
        // Get next budget number (auto-increment, advisory-locked against concurrent minters)
        const nextBudgetNumber = await allocateBudgetNumber(tx);

        const newQuote = await tx.budget.create({
          data: {
            budgetNumber: nextBudgetNumber,
            subtotal: aggregateSubtotal,
            total: aggregateTotal,
            expiresAt: data.expiresAt,
            status: data.status || TASK_QUOTE_STATUS.PENDING,
            statusOrder:
              TASK_QUOTE_STATUS_ORDER[
                (data.status || TASK_QUOTE_STATUS.PENDING) as TASK_QUOTE_STATUS
              ] ?? 8,
            // Guarantee Terms
            guaranteeYears: data.guaranteeYears || null,
            customGuaranteeText: data.customGuaranteeText || null,
            // Layout Files (max 2) — clone any File owned by another quote (FK on File).
            ...(data.layoutFileIds !== undefined && {
              layoutFiles: {
                connect: (
                  await this.fileService.resolveLayoutFileIdsForQuote(
                    tx,
                    null,
                    data.layoutFileIds ?? [],
                    userId,
                  )
                ).map((fid: string) => ({ id: fid })),
              },
            }),
            simultaneousTasks: data.simultaneousTasks || null,
            customForecastDays: data.customForecastDays || null,
            billingSplit,
            // O divisor dos totais acima: `aggregateTotal` é `por veículo × N`, e
            // é este N que devolve o valor de UM veículo às telas que listam
            // tarefas. Gravado aqui, na mesma linha do total que ele divide.
            vehicleCount: taskIds.length,
            // OS FATURAMENTOS NÃO NASCEM AQUI — ver o bloco logo abaixo do
            // vínculo das tarefas. `BillingTask` referencia `Task`, e neste ponto
            // as tarefas ainda não são deste orçamento.
            services: {
              create: data.services.map((service, index) => ({
                amount: service.amount || 0,
                description: service.description || '',
                observation: service.observation || null,
                position: index,
                ...(service.invoiceToCustomerId && {
                  invoiceToCustomer: { connect: { id: service.invoiceToCustomerId } },
                }),
              })),
            },
          },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            layoutFiles: { orderBy: { createdAt: 'asc' } },
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
          },
        });

        // Installments are now created at BILLING_APPROVED time, not at quote creation

        // ── O VÍNCULO É A TRAVA, E ELE É CONDICIONAL ─────────────────────────
        //
        // A guarda `alreadyQuoted` lá em cima roda FORA desta transação (ela usa
        // `db`, que só é a transação quando o chamador passou uma). Dois cliques
        // em 200 ms: os dois leem `quoteId = null`, os dois criam orçamento, e o
        // segundo `updateMany` sobrescreve o vínculo do primeiro. Sobra um Budget
        // com número queimado, pagadores, faturamentos e ZERO tarefas —
        // exatamente a forma dos 105 órfãos, e invisível em toda tela que lista
        // por tarefa. `Task.quoteId` perdeu o `@unique` na migração 1:1→1:N,
        // então o banco também não recusa.
        //
        // `quoteId: null` no `where` transforma o vínculo num compare-and-swap:
        // quem chega depois escreve ZERO linhas e a contagem denuncia. É o mesmo
        // mecanismo com que `internalApprove` reivindica cada carimbo.
        const vinculadas = await tx.task.updateMany({
          where: { id: { in: taskIds }, quoteId: null },
          data: { quoteId: newQuote.id },
        });
        if (vinculadas.count !== taskIds.length) {
          throw new BadRequestException(
            'Um dos veículos deste orçamento acabou de receber outro orçamento. ' +
              'Recarregue a tela e confira antes de criar de novo.',
          );
        }

        // ── OS FATURAMENTOS NASCEM AQUI, E OS PAGADORES DENTRO DELES ─────────
        //
        // UM `Billing` POR GRUPO DE COBERTURA — não por pagador. `JOINT` cria um
        // cobrindo os N veículos; `PER_TASK`, N de um veículo; um orçamento em
        // lotes, os lotes que a tela declarou. Quem reparte é o SERVIDOR
        // (`planCoverage`) quando o modo basta: sessenta objetos idênticos
        // viajando em cada gravação seria payload inútil e uma segunda fonte de
        // verdade. A tela só fala quando o modo NÃO basta — o caso do lote.
        //
        // DOIS PAGADORES DO MESMO RECORTE CAEM NO MESMO FATURAMENTO, com dois
        // `customerConfigs` dentro: o que difere entre eles é quem paga o quê
        // (`BudgetItem.invoiceToCustomerId`), não quais caminhões a cobrança
        // cobre. Era este colapso que a modelagem antiga não sabia fazer — ela
        // respondia "dois faturamentos" para um recorte só.
        //
        // Roda DEPOIS do vínculo das tarefas porque `BillingTask` referencia
        // `Task`, e antes disso as tarefas ainda não pertencem a este orçamento.
        const gruposDeCobertura = new Map<string, typeof plannedConfigs>();
        for (const planejado of plannedConfigs) {
          const chave = [...planejado.coverage].sort().join('|');
          const balde = gruposDeCobertura.get(chave);
          if (balde) balde.push(planejado);
          else gruposDeCobertura.set(chave, [planejado]);
        }

        for (const [, grupo] of gruposDeCobertura) {
          await tx.billing.create({
            data: {
              quote: { connect: { id: newQuote.id } },
              // A COBERTURA, gravada na mesma transação que o faturamento: um
              // faturamento sem cobertura não responde "de quais veículos é
              // isto?", e o multiplicador do valor dele cairia no orçamento
              // inteiro.
              tasks: {
                create: grupo[0].coverage.map(coveredTaskId => ({
                  task: { connect: { id: coveredTaskId } },
                })),
              },
              customerConfigs: {
                create: grupo.map(({ config, money }) => ({
                  // O pagador continua ligado ao ORÇAMENTO também: é por essa FK
                  // que as telas de tarefa e as listas chegam a ele sem passar
                  // pelo faturamento.
                  quote: { connect: { id: newQuote.id } },
                  customer: { connect: { id: config.customerId } },
                  subtotal: money.configSubtotal,
                  total: money.configTotal,
                  discountType: (config as any).discountType || 'NONE',
                  discountValue: (config as any).discountValue ?? null,
                  discountReference: (config as any).discountReference || null,
                  customPaymentText: config.customPaymentText || null,
                  generateInvoice:
                    config.generateInvoice !== undefined ? config.generateInvoice : true,
                  generateBankSlip:
                    config.generateBankSlip !== undefined ? config.generateBankSlip : true,
                  // ⚠️ `orderNumber` NÃO entra aqui. A coluna saiu do modelo na
                  // migração `20260909170000` — o pedido de compra é do VEÍCULO
                  // (`Task.customerOrderNumber`) — e `x || null` emitia a chave
                  // SEMPRE, mesmo quando o cliente não a mandava: o Prisma
                  // respondia "Unknown argument `orderNumber`" e TODA criação de
                  // orçamento morria em 500. O valor legado é traduzido para as
                  // tarefas mais abaixo (`legacyOrderNumber`).
                  paymentCondition: config.paymentCondition || null,
                  paymentConfig: (config as any).paymentConfig ?? null,
                })),
              },
            },
          });
        }

        // Rede de segurança e nada mais: idempotente, e com os faturamentos já
        // certos ela não escreve nada. Existe porque a criação é o único caminho
        // que não passa por `reconcileQuoteCustomerConfigs`, e um dia em que o
        // plano acima divergir do reconciliador é um dia em que o banco fica
        // errado em silêncio.
        await reconcileBillingsForQuote(tx, newQuote.id);

        // COMPATIBILIDADE: `customerConfigs[].orderNumber`.
        //
        // O número do pedido de compra virou campo do VEÍCULO
        // (`Task.customerOrderNumber`) — o pedido é por entrega, e um orçamento
        // cobre N caminhões. O app instalado nos aparelhos ainda o manda na
        // configuração de faturamento; aplicá-lo a todas as tarefas é exatamente
        // o efeito que ele tinha antes. Só valor preenchido conta: um `null` de
        // um cliente que não lê mais o campo não pode apagar o que a tela nova
        // gravou por veículo.
        const legacyOrderNumber = (data.customerConfigs as any[])
          .map(c => (typeof c?.orderNumber === 'string' ? c.orderNumber.trim() : ''))
          .find(v => v.length > 0);
        if (legacyOrderNumber) {
          await tx.task.updateMany({
            where: { id: { in: taskIds } },
            data: { customerOrderNumber: legacyOrderNumber },
          });
        }

        // Any layout file added straight onto the quote must also exist as an
        // APPROVED task layout (now that the task↔quote link is set). The Step-2
        // selection is authoritative: promote the selected images (re-approving a
        // re-selected REPROVED one), then reprove every non-selected task layout.
        if (data.layoutFileIds !== undefined) {
          await syncTaskLayoutsFromQuote(tx, newQuote.id, userId, true);
          await reproveNonSelectedTaskLayoutsFromQuote(tx, newQuote.id, userId);
        }

        // Log change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: newQuote.id,
          action: CHANGE_ACTION.CREATE,
          userId,
          reason: 'Criação de orçamento',
          newValue: serializeChangelogValue({
            id: newQuote.id,
            budgetNumber: nextBudgetNumber,
            subtotal: data.subtotal,
            total: data.total,
            status: data.status || TASK_QUOTE_STATUS.PENDING,
            services: data.services.map(service => ({
              description: service.description,
              amount: service.amount,
              observation: service.observation || null,
            })),
          }),
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          transaction: tx,
        });

        // =====================================================================
        // SERVIÇOS DO ORÇAMENTO → ORDENS DE SERVIÇO DE PRODUÇÃO
        //
        // A lista de serviços é UMA e vale para todos os veículos, então cada
        // veículo recebe o SEU conjunto de ordens de serviço. É literalmente o
        // trabalho a executar: os três serviços do Marquespan (Logomarca
        // Laterais, Logomarca Traseira, Aerografia Parcial) viram três O.S. em
        // cada um dos sessenta caminhões — cento e oitenta ordens, que é o
        // número de coisas que a produção de fato vai fazer.
        //
        // O laço é por TAREFA e o conjunto de O.S. existentes é lido por tarefa:
        // um único `existingSOs` compartilhado faria o segundo caminhão "já ter"
        // a O.S. que acabou de ser criada no primeiro, e cinquenta e nove
        // caminhões ficariam sem ordem nenhuma.
        // =====================================================================
        try {
          for (const targetTaskId of taskIds) {
            const existingServiceOrders = await tx.serviceOrder.findMany({
              where: { taskId: targetTaskId },
              select: { id: true, description: true, observation: true, type: true },
            });

            const existingSOs: SyncServiceOrder[] = existingServiceOrders.map((so: any) => ({
              id: so.id,
              description: so.description,
              observation: so.observation,
              type: so.type,
            }));

            for (let i = 0; i < data.services.length; i++) {
              const service = data.services[i];
              if (!service.description) continue;

              const syncResult = getQuoteItemToServiceOrderSync(
                { description: service.description, observation: service.observation || null },
                existingSOs,
              );

              if (syncResult.shouldCreateServiceOrder) {
                await tx.serviceOrder.create({
                  data: {
                    description: syncResult.serviceOrderDescription,
                    observation: syncResult.serviceOrderObservation,
                    status: SERVICE_ORDER_STATUS.PENDING as any,
                    statusOrder: getServiceOrderStatusOrder(SERVICE_ORDER_STATUS.PENDING),
                    type: SERVICE_ORDER_TYPE.PRODUCTION as any,
                    position: i,
                    task: { connect: { id: targetTaskId } },
                    createdBy: { connect: { id: userId } },
                  },
                });

                // Evita duplicata dentro do mesmo lote desta tarefa.
                existingSOs.push({
                  description: syncResult.serviceOrderDescription,
                  observation: syncResult.serviceOrderObservation,
                  type: SERVICE_ORDER_TYPE.PRODUCTION,
                });
              }
            }
          }
          this.logger.log(
            `[QUOTE→SO SYNC] Orçamento ${newQuote.budgetNumber}: ordens de serviço sincronizadas ` +
              `para ${taskIds.length} tarefa(s).`,
          );
        } catch (syncError) {
          this.logger.error('[QUOTE→SO SYNC] Error during sync:', syncError);
          // Não lança: falha de sincronia não pode desfazer a criação do orçamento.
        }

        return tx.budget.findUnique({
          where: { id: newQuote.id },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            layoutFiles: { orderBy: { createdAt: 'asc' } },
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
                installments: { orderBy: { number: 'asc' } },
                customerSignature: true,
              },
            },
          },
        });
      };

      const quote = externalTx
        ? await createInTransaction(externalTx)
        : await this.prisma.$transaction(createInTransaction);

      return {
        success: true,
        data: quote as any,
        message: 'Orçamento criado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error creating task quote:', error);
      if (error instanceof HttpException) throw error;
      // A CAUSA CHEGA À TELA quando é traduzível.
      //
      // "Erro ao criar orçamento." é tudo o que o operador via — e, num
      // orçamento multitarefa, ele recebia junto a instrução de criar o
      // orçamento por UMA das tarefas, que deixaria os outros N-1 veículos de
      // fora. Quem está com as tarefas criadas e o orçamento não precisa saber
      // se o problema é dele (registro duplicado, cliente que sumiu) ou do
      // servidor (migração pendente), porque a ação seguinte é outra em cada
      // caso. Ver `describePrismaFailure`.
      const detail = describePrismaFailure(error);
      throw new InternalServerErrorException(
        detail ? `Erro ao criar orçamento: ${detail}` : 'Erro ao criar orçamento.',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Material-change detection
  //
  // The budget detail form on web/mobile always re-submits the full quote
  // (customerConfigs + services + scalar fields), even when the user only
  // changed a Task field like truck.plate. Without filtering, every save
  // would trip STATUS_LOCKED at BILLING_APPROVED+, run the destructive
  // customerConfigs delete+recreate, and auto-revert status on no-op
  // resubmissions. We canonicalize both sides and pass through only fields
  // the caller actually changed.
  // ─────────────────────────────────────────────────────────────────────────

  /** A cobertura que o objeto de entrada DECLAROU, canônica; `null` = delegou ao modo. */
  private declaredCoverageKey(config: any): string | null {
    if (Array.isArray(config?.taskIds)) return [...config.taskIds].sort().join('|');
    if (typeof config?.taskId === 'string' && config.taskId) return config.taskId;
    return null;
  }

  /** A cobertura GRAVADA de um pagador, canônica; `null` = a consulta não a trouxe. */
  private storedCoverageKey(config: any): string | null {
    const stored = config?.billing?.tasks;
    if (!Array.isArray(stored)) return null;
    return stored
      .map((r: any) => r.taskId)
      .sort()
      .join('|');
  }

  /**
   * A RECOMPOSIÇÃO DE LOTES É ALTERAÇÃO MATERIAL.
   *
   * `canonicalizeCustomerConfig` compara TERMOS (cliente, desconto, condição), e
   * mover um caminhão do lote 1 para o lote 2 não mexe em termo nenhum: com o
   * mesmo NÚMERO de lotes e os mesmos valores, a gravação era descartada com
   * "Nenhuma alteração detectada." e `success: true`. A tela mostrava o arranjo
   * novo, o banco guardava o velho, e nada acusava.
   *
   * ⚠️ A comparação é ASSIMÉTRICA de propósito. Não declarar cobertura significa
   * "decida pelo modo" — é o que toda tela manda quando não está compondo lotes,
   * e tratá-lo como "cobertura vazia" faria todo save de um orçamento `JOINT`
   * parecer recomposição (e, num orçamento com cobrança aprovada, bater na trava
   * do dinheiro). Só o que foi DECLARADO é comparado; o que não foi, não opina.
   */
  private coverageMateriallyChanged(existing: any[], incoming: any[]): boolean {
    const declared = incoming
      .map(c => this.declaredCoverageKey(c))
      .filter((k): k is string => k !== null);
    if (declared.length === 0) return false;

    const stored = (existing || [])
      .map(c => this.storedCoverageKey(c))
      .filter((k): k is string => k !== null);
    // A consulta não trouxe a cobertura gravada: não há com o que comparar, e
    // inventar "mudou" recusaria gravações legítimas. Quem precisa da detecção
    // carrega `customerConfigs.billing.tasks` — ver o include em `update`.
    if (stored.length === 0) return false;

    const disponiveis = [...stored];
    for (const key of declared) {
      const i = disponiveis.indexOf(key);
      if (i === -1) return true;
      disponiveis.splice(i, 1);
    }
    return false;
  }

  private canonicalizeCustomerConfig(config: any): string {
    return JSON.stringify({
      customerId: config.customerId ?? null,
      subtotal: Number(config.subtotal ?? 0).toFixed(2),
      total: Number(config.total ?? 0).toFixed(2),
      discountType: config.discountType ?? 'NONE',
      discountValue: config.discountValue != null ? Number(config.discountValue).toFixed(2) : null,
      discountReference: config.discountReference ?? null,
      paymentCondition: config.paymentCondition ?? null,
      customPaymentText: config.customPaymentText ?? null,
      generateInvoice: config.generateInvoice !== false,
      generateBankSlip: config.generateBankSlip !== false,
      // `orderNumber` fora da canonicalização: a coluna não existe mais na fatia
      // (o pedido é do VEÍCULO). O registro gravado NUNCA a tem, então um app
      // antigo que ainda a manda faria todo salvamento parecer MATERIALMENTE
      // alterado — disparando o delete+recreate destrutivo das configurações e,
      // em `BILLING_APPROVED`+, batendo na trava de status.
      paymentConfig: config.paymentConfig ?? null,
    });
  }

  private customerConfigsMateriallyChanged(existing: any[], incoming: any[]): boolean {
    if (!Array.isArray(incoming)) return false;
    if ((existing?.length ?? 0) !== incoming.length) return true;
    const a = (existing || []).map(c => this.canonicalizeCustomerConfig(c)).sort();
    const b = incoming.map(c => this.canonicalizeCustomerConfig(c)).sort();
    if (a.some((v, i) => v !== b[i])) return true;
    // Mesmos termos, mesmo número de fatias — e mesmo assim pode ter mudado
    // QUEM COBRA QUEM. Ver `coverageMateriallyChanged`.
    return this.coverageMateriallyChanged(existing || [], incoming);
  }

  private canonicalizeService(service: any): string {
    return JSON.stringify({
      description: (service.description ?? '').trim(),
      amount: Number(service.amount ?? 0).toFixed(2),
      observation: service.observation ?? null,
      invoiceToCustomerId: service.invoiceToCustomerId ?? null,
    });
  }

  private servicesMateriallyChanged(existing: any[], incoming: any[]): boolean {
    if (!Array.isArray(incoming)) return false;
    if ((existing?.length ?? 0) !== incoming.length) return true;
    const a = (existing || []).map(s => this.canonicalizeService(s)).sort();
    const b = incoming.map(s => this.canonicalizeService(s)).sort();
    return a.some((v, i) => v !== b[i]);
  }

  private isScalarChanged(existing: any, incoming: any): boolean {
    if (incoming === undefined) return false;
    if (existing === incoming) return false;
    if (existing == null && incoming == null) return false;
    // Prisma Decimal compared against number
    if (existing && typeof existing === 'object' && 'toNumber' in existing) {
      return Number(existing) !== Number(incoming);
    }
    if (existing instanceof Date || incoming instanceof Date) {
      const a = existing ? new Date(existing as any).getTime() : null;
      const b = incoming ? new Date(incoming as any).getTime() : null;
      return a !== b;
    }
    return existing !== incoming;
  }

  /**
   * AS CHAVES QUE O ORÇAMENTO NÃO TEM — e que por isso nunca são "alteração".
   *
   * `Budget` não tem coluna `taskId` (a FK mudou de lado e hoje mora em
   * `Task.quoteId`), mas o zod a aceitava no corpo do update e a tela a mandava.
   * O efeito era brutal e invisível: `isScalarChanged(undefined, "<uuid>")`
   * responde SEMPRE "mudou", então `taskId` nunca era filtrado; com uma cobrança
   * aprovada, a trava do dinheiro encontrava uma chave fora da lista segura e
   * recusava a gravação INTEIRA — inclusive prorrogar `expiresAt`, que é
   * exatamente o que a lista segura existe para permitir.
   *
   * Comparar contra `undefined` não distingue "campo que não existe" de "campo
   * nulo no banco"; a lista é a única resposta honesta. Ela é uma REDE: o zod já
   * derruba `taskId`, e isto garante que a próxima chave fantasma não trave a
   * tela de novo.
   */
  private static readonly NON_QUOTE_UPDATE_KEYS = new Set<string>(['taskId']);

  /**
   * Return a copy of `data` with no-op fields stripped (where the incoming
   * value is structurally equal to the existing one). Internal callers may
   * pass `_internal = true` on update() to bypass this filter.
   */
  private filterToMaterialChanges(
    existing: any,
    data: BudgetUpdateFormData,
  ): BudgetUpdateFormData {
    const filtered: any = {};
    for (const key of Object.keys(data)) {
      const value = (data as any)[key];
      if (value === undefined) continue;
      if (BudgetService.NON_QUOTE_UPDATE_KEYS.has(key)) continue;
      if (key === 'customerConfigs') {
        if (this.customerConfigsMateriallyChanged(existing.customerConfigs || [], value)) {
          filtered[key] = value;
        }
      } else if (key === 'services') {
        if (this.servicesMateriallyChanged(existing.services || [], value)) {
          filtered[key] = value;
        }
      } else if (key === 'taskIds' || key === 'layoutFileIds') {
        // ⚠️ ESTES DOIS NÃO SÃO COLUNAS — são a projeção de uma RELAÇÃO, e por
        // isso `existing['taskIds']` é `undefined` SEMPRE.
        //
        // Caindo no ramo escalar abaixo, `isScalarChanged(undefined, [...])`
        // respondia "mudou" em toda gravação, para qualquer valor, inclusive o
        // idêntico. Como `taskIds` também não está em
        // `QUOTE_SAFE_AFTER_BILLING_FIELDS`, a trava do dinheiro via uma chave
        // fora da lista segura e recusava a requisição INTEIRA: reenviar os
        // mesmos 60 veículos só para prorrogar `expiresAt` levava 400 num
        // orçamento com cobrança aprovada. É o defeito do `taskId` singular
        // (documentado em `NON_QUOTE_UPDATE_KEYS`) reencarnado no plural — e,
        // com `layoutFileIds`, o efeito irmão: toda gravação parecia trocar o
        // layout, e desde 17/09 isso derruba a coleta de assinaturas.
        //
        // A comparação é por CONJUNTO, não por ordem: nenhuma das duas relações
        // tem posição significativa (a de veículos é ordenada por `createdAt` na
        // leitura, a de layout por `createdAt` na exibição).
        const current: string[] =
          key === 'taskIds'
            ? ((existing as any).tasks ?? []).map((t: any) => t.id)
            : ((existing as any).layoutFiles ?? []).map((f: any) => f.id);
        const incoming: string[] = Array.isArray(value) ? value : [];
        const same =
          current.length === incoming.length &&
          [...current].sort().join('|') === [...incoming].sort().join('|');
        if (!same) filtered[key] = value;
      } else {
        if (this.isScalarChanged((existing as any)[key], value)) {
          filtered[key] = value;
        }
      }
    }
    return filtered as BudgetUpdateFormData;
  }

  /**
   * Detect whether the (already-filtered) update touches money-affecting
   * fields. Used to drive auto-revert-to-PENDING when value changes happen
   * after BUDGET_APPROVED.
   */
  private hasValueAffectingChange(existing: any, data: BudgetUpdateFormData): boolean {
    if (data.services !== undefined) return true;

    // A FROTA MUDOU → O VALOR MUDOU. O total do orçamento é `por veículo × N`;
    // acrescentar ou retirar um caminhão muda o CONTRATO, e o contrato é o que o
    // cliente assinou. Sem este teste, mexer em `taskIds` mudava o valor sem
    // derrubar a aprovação nem a coleta de assinaturas em andamento — o PDF
    // assinado dizia "×4" e a cobrança saía "×5".
    const incomingTaskIds = (data as any).taskIds as string[] | undefined;
    if (Array.isArray(incomingTaskIds)) {
      const prevIds = new Set<string>(((existing.tasks ?? []) as any[]).map(t => t.id));
      const nextIds = new Set<string>(incomingTaskIds);
      if (prevIds.size !== nextIds.size) return true;
      for (const id of nextIds) if (!prevIds.has(id)) return true;
    }

    if (Array.isArray(data.customerConfigs)) {
      const existingByCustomer = new Map(
        (existing.customerConfigs || []).map((c: any) => [c.customerId, c]),
      );
      for (const incoming of data.customerConfigs as any[]) {
        const prev: any = existingByCustomer.get(incoming.customerId);
        if (!prev) return true; // new customer added → value change
        if (this.isScalarChanged(prev.subtotal, incoming.subtotal)) return true;
        if (this.isScalarChanged(prev.total, incoming.total)) return true;
        if (this.isScalarChanged(prev.discountType, incoming.discountType ?? 'NONE')) return true;
        if (this.isScalarChanged(prev.discountValue, incoming.discountValue ?? null)) return true;
      }
      // Customer was removed?
      const incomingIds = new Set((data.customerConfigs as any[]).map(c => c.customerId));
      for (const prev of existing.customerConfigs || []) {
        if (!incomingIds.has(prev.customerId)) return true;
      }
    }
    return false;
  }

  /**
   * Update existing quote.
   * @param _internal When true (called from updateStatus/internalApprove), relaxes the
   *   status-change guard for locked quotes. External callers must use the dedicated
   *   status-update endpoints for all post-billing status transitions.
   * @param actorPrivilege Sector privilege of the acting user (threaded from the
   *   controller). Used to role-gate explicit status changes through the generic
   *   update so they enforce the same per-stage roles as the dedicated /status
   *   endpoints. Ignored for internal callers.
   */
  async update(
    id: string,
    data: BudgetUpdateFormData,
    userId: string,
    _internal = false,
    actorPrivilege?: string,
  ): Promise<BudgetUpdateResponse> {
    try {
      const existing = await this.budgetRepository.findById(id, {
        include: {
          services: { orderBy: { position: 'asc' } },
          // ⚠️ A COBERTURA DE CADA PAGADOR vem junto. A detecção de mudança
          // material compara a cobertura declarada pela tela com a GRAVADA, e
          // sem esta linha o lado gravado responde "não declarada" em toda
          // gravação: um save idempotente de um orçamento em lotes pareceria
          // recomposição, e num orçamento com cobrança aprovada a trava do
          // dinheiro o recusaria.
          customerConfigs: {
            include: { billing: { select: { tasks: { select: { taskId: true } } } } },
          },
          // ⚠️ OS VEÍCULOS. Sem esta linha `existingTaskIds` sai VAZIO e leva
          // junto tudo o que depende de quantos veículos o orçamento cobre:
          // `updateVehicleCount` cai para 1 (e `computeQuoteMoney` calcula o
          // contrato como se fosse um caminhão só), `nextTaskIds` fica vazio e a
          // reconciliação de fatias, com `PER_TASK`, produz UMA fatia conjunta
          // em vez de uma por veículo — o que faz a aprovação "veículo a
          // veículo" faturar os sessenta de uma vez.
          //
          // A gravação só manda `taskIds` quando MUDA o conjunto de veículos;
          // em toda outra gravação o conjunto é o que está no banco.
          tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } },
          // Captured BEFORE the write so an UNSELECTED reference (dropped from
          // layoutFiles) can be reproved on the task layout afterwards.
          layoutFiles: true,
          // ⚠️ A TRAVA DO DINHEIRO LÊ DAQUI. Sem este include
          // `isQuoteMoneyLocked` devolve `false` e a gravação passa por cima de
          // fatura, boleto e nota já emitidos, em silêncio.
          billings: { select: { approvedAt: true, status: true } },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      const currentStatus = (existing as any).status as TASK_QUOTE_STATUS;

      // Whether the CLIENT explicitly sent a status in THIS request. Captured
      // BEFORE filterToMaterialChanges, which strips a status equal to the
      // current one. Pinning a status — even the current value — is the caller
      // signalling "keep this status", and MUST suppress the value-edit
      // auto-revert below. Otherwise editing a price on an approved quote while
      // pinning its own status is still reverted to PENDING (the no-op status is
      // stripped, the revert then sees `data.status === undefined`).
      const clientProvidedStatus = data.status !== undefined;

      // ─────────────────────────────────────────────────────────────────────
      // Strip no-op fields before any validation or write.
      //
      // The budget detail form re-submits the full quote snapshot on every
      // save (including when the user only edited a Task field like
      // truck.plate). Without this filter, those no-op resubmissions would
      // trip STATUS_LOCKED, run the destructive customerConfigs
      // delete+recreate, and emit spurious changelogs. Internal callers
      // (updateStatus, internalApprove, revertBilling, …) pass _internal
      // to skip this — they assert their writes deliberately.
      // ─────────────────────────────────────────────────────────────────────
      if (!_internal) {
        data = this.filterToMaterialChanges(existing, data);
        if (Object.keys(data).length === 0) {
          return {
            success: true,
            data: existing as any,
            message: 'Nenhuma alteração detectada.',
          };
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Auto-revert quote status when value-affecting fields change.
      //
      // Editing the deal value (services list, customerConfig money fields)
      // invalidates the customer/commercial approval. Per workflow, the
      // quote returns to PENDING so the deal is re-confirmed downstream.
      // The edit itself is NEVER blocked — only the status is flipped.
      //
      // BILLING_APPROVED+ is excluded: STATUS_LOCKED below throws on money
      // fields, forcing the user through revertBilling() first.
      // The caller can override by setting data.status explicitly.
      // ─────────────────────────────────────────────────────────────────────
      if (
        !_internal &&
        !clientProvidedStatus &&
        QUOTE_VALUE_REVERTABLE_STATUSES.includes(currentStatus) &&
        this.hasValueAffectingChange(existing, data)
      ) {
        this.logger.log(
          `[Quote Update] Auto-reverting quote ${id} from ${currentStatus} → PENDING due to value-affecting edits`,
        );
        (data as any).status = TASK_QUOTE_STATUS.PENDING;
      }

      // ─────────────────────────────────────────────────────────────────────
      // Role-gate EXPLICIT status changes through the generic update so they
      // enforce the same per-stage roles as the dedicated /status endpoints.
      // Pinning the current status (no-op) was stripped by
      // filterToMaterialChanges above and is intentionally NOT gated — pinning
      // is the designed escape to keep approval while editing values.
      // ─────────────────────────────────────────────────────────────────────
      if (
        !_internal &&
        clientProvidedStatus &&
        data.status !== undefined &&
        data.status !== currentStatus
      ) {
        validateQuoteStatusChangeRole(data.status as TASK_QUOTE_STATUS, actorPrivilege);
        // I41: also enforce the status-machine allowlist on the generic update()
        // path — not just the dedicated /status endpoint. Without this, a manual
        // PUT with a status body could jump the machine (e.g. PENDING → DUE).
        // Internal cascades/schedulers pass _internal=true and skip this guard.
        this.validateStatusTransition(currentStatus, data.status as TASK_QUOTE_STATUS);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Guard: lock pricing/customer/payment edits once the quote is locked-in
      // ─────────────────────────────────────────────────────────────────────
      // Aprovar cobrança não é mais status do orçamento — o ramo que barrava
      // `BILLING_APPROVED` aqui perdeu o alvo, e o zod já recusa o valor. O
      // endereço é `PUT /billings/:id/approve`.
      //
      // A trava agora pergunta à COBRANÇA, não ao status: num orçamento faturado
      // veículo a veículo, aprovar a primeira fatia travava os cinquenta e nove
      // que ainda nem tinham sido cobrados.
      if (isQuoteMoneyLocked((existing as any).billings)) {
        for (const key of Object.keys(data)) {
          // Ignore explicit undefined entries — only reject if the caller actually intends a change.
          if ((data as any)[key] === undefined) continue;
          if (!QUOTE_SAFE_AFTER_BILLING_FIELDS.has(key)) {
            throw new BadRequestException(
              'Após a aprovação do faturamento os valores deste orçamento não podem mais ser ' +
                'alterados: a fatura, os boletos e a nota fiscal saíram sobre o preço atual. ' +
                'Para mudar, use "Reverter Faturamento" na tela de Faturamento e grave de novo.',
            );
          }
          // Status changes on locked quotes must come through updateStatus() — never external PUT.
          if (key === 'status' && !_internal) {
            throw new BadRequestException(
              'Use o endpoint de atualização de status para alterar o status do orçamento.',
            );
          }
        }
      }

      // Validate customerConfigs customer IDs if provided
      if (data.customerConfigs && data.customerConfigs.length > 0) {
        // Distintos — ver a nota em `create`. Numa gravação de lotes esta linha
        // é a diferença entre gravar e recusar.
        const customerIds = distinctCustomerIds(data.customerConfigs);
        const customers = await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true },
        });

        if (customers.length !== customerIds.length) {
          throw new BadRequestException(
            'Um ou mais clientes selecionados para faturamento não foram encontrados.',
          );
        }

        // Sem herança de responsável — ver o mesmo corte em `create()`.
      }

      // ═══════════════════════════════════════════════════════════════════════
      // AS TAREFAS E O MODO DE FATURAMENTO DEPOIS DESTA GRAVAÇÃO
      // ═══════════════════════════════════════════════════════════════════════
      //
      // Os totais e a reconciliação de configurações dependem de QUANTOS veículos
      // o orçamento cobre e de COMO ele é faturado — e a mesma gravação pode
      // mudar as duas coisas. Resolver o estado FINAL aqui, antes de qualquer
      // conta, é o que evita calcular o total pelo número de veículos de antes.
      const existingTaskIds = ((existing as any).tasks ?? []).map((t: any) => t.id) as string[];
      const nextTaskIds =
        data.taskIds && data.taskIds.length > 0 ? [...new Set(data.taskIds)] : existingTaskIds;
      const updateVehicleCount = Math.max(1, nextTaskIds.length);
      const updateBillingSplit: 'JOINT' | 'PER_TASK' | 'CUSTOM' =
        (data as any).billingSplit === 'PER_TASK'
          ? 'PER_TASK'
          : (data as any).billingSplit === 'JOINT'
            ? 'JOINT'
            : (data as any).billingSplit === 'CUSTOM'
              ? 'CUSTOM'
              : ((existing as any).billingSplit ?? 'JOINT');

      // Compute per-customer totals from global customer discount
      if (data.customerConfigs && data.customerConfigs.length > 0) {
        // When services weren't edited (stripped by filterToMaterialChanges), fall back to the
        // existing DB services so totals are recomputed against the new customer/discount.
        const servicesToUse = data.services ?? (existing as any).services ?? [];
        // ⚠️ UM CLIENTE, não UMA FATIA — gêmea da guarda em `create`.
        const isSingleConfig = isSingleCustomerQuote(data.customerConfigs);
        for (const config of data.customerConfigs) {
          // In single-config, all services belong to the one customer regardless of invoiceToCustomerId.
          // This handles customer replacements where services may still carry the old customer's ID.
          const assignedServices = isSingleConfig
            ? servicesToUse
            : servicesToUse.filter((s: any) => s.invoiceToCustomerId === config.customerId);
          // Quantos veículos ESTA fatura cobre. Quando a tela declarou a
          // cobertura (lote), é o tamanho dela; quando não, o modo decide, e
          // `planCoverage` devolve o primeiro grupo — que é o único em `JOINT` e
          // tem tamanho 1 em `PER_TASK`.
          //
          // Este valor é provisório de propósito: `recalcQuoteTotals`, no fim da
          // MESMA transação, reescreve subtotal e total de cada fatura a partir
          // da cobertura JÁ GRAVADA. Ele existe para o agregado abaixo e para que
          // a fatia nasça com um número plausível, nunca como fonte de verdade.
          const declaredCoverage = Array.isArray((config as any).taskIds)
            ? ((config as any).taskIds as string[]).length
            : (config as any).taskId
              ? 1
              : (planCoverage(updateBillingSplit, nextTaskIds)[0]?.length ?? undefined);
          const money = computeQuoteMoney({
            serviceAmounts: assignedServices.map((sv: any) => sv.amount || 0),
            discountType: (config as any).discountType,
            discountValue: (config as any).discountValue,
            taskCount: updateVehicleCount,
            coveredTaskCount: declaredCoverage,
          });
          config.subtotal = money.configSubtotal;
          config.total = money.configTotal;
        }
      }

      // Compute aggregate subtotal/total from customerConfigs if provided. In
      // multi-config, fold unassigned-service amounts (no config = no discount)
      // into the aggregate so it matches recalcQuoteTotals. servicesToUse is the
      // same source the per-config loop summed above (data.services ?? existing).
      const computeAggregates = data.customerConfigs && data.customerConfigs.length > 0;
      // Quantas FATURAS cada configuração enviada vira. Em `PER_TASK` são N (uma
      // por veículo) e o agregado — que é o valor do contrato — multiplica por
      // elas; em `JOINT` é uma, que já carrega o total geral. Com lotes o
      // agregado provisório não fecha exatamente, e não precisa:
      // `recalcQuoteTotals` reescreve o total do orçamento a partir da cobertura
      // gravada antes de a transação fechar.
      const updateConfigCount = updateBillingSplit === 'PER_TASK' ? updateVehicleCount : 1;
      let aggregateSubtotal = computeAggregates
        ? round2(
            data.customerConfigs!.reduce(
              (sum, c) => sum + (c.subtotal || 0) * updateConfigCount,
              0,
            ),
          )
        : undefined;
      let aggregateTotal = computeAggregates
        ? round2(
            data.customerConfigs!.reduce((sum, c) => sum + (c.total || 0) * updateConfigCount, 0),
          )
        : undefined;
      if (computeAggregates && data.customerConfigs!.length >= 2) {
        const servicesForAggregate = data.services ?? (existing as any).services ?? [];
        const unassignedSum = servicesForAggregate
          .filter((s: any) => !s.invoiceToCustomerId)
          .reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
        // Vezes os veículos: é serviço prestado em cada um.
        const unassignedRounded = round2(round2(unassignedSum) * updateVehicleCount);
        aggregateSubtotal = round2((aggregateSubtotal || 0) + unassignedRounded);
        aggregateTotal = round2((aggregateTotal || 0) + unassignedRounded);
      }

      // Update quote with items in transaction
      const updated = await this.prisma.$transaction(async tx => {
        // ─── O CONJUNTO DE VEÍCULOS ──────────────────────────────────────────
        //
        // Reconciliação, não substituição: vincula as tarefas que entraram e
        // desvincula as que saíram. Acrescentar ou retirar um veículo é alteração
        // MATERIAL — muda o total e muda o objeto do contrato —, e a detecção de
        // mudança material derruba a coleta de assinaturas em andamento, que é
        // exatamente o comportamento correto.
        //
        // ⚠️ Feito ANTES de `reconcileQuoteCustomerConfigs` e de
        // `recalcQuoteTotals`: os dois contam as tarefas do banco.
        if (data.taskIds && data.taskIds.length > 0) {
          const removedTaskIds = existingTaskIds.filter(t => !nextTaskIds.includes(t));
          const addedTaskIds = nextTaskIds.filter(t => !existingTaskIds.includes(t));

          if (addedTaskIds.length > 0) {
            // Tarefa que já pertence a OUTRO orçamento não é roubada em silêncio.
            const conflicting = await tx.task.findMany({
              where: { id: { in: addedTaskIds }, quoteId: { not: null, notIn: [id] } },
              select: { id: true, serialNumber: true, quote: { select: { budgetNumber: true } } },
            });
            if (conflicting.length > 0) {
              const labels = conflicting
                .slice(0, 5)
                .map(t =>
                  t.quote?.budgetNumber
                    ? `${t.serialNumber ?? t.id.slice(0, 8)} (orçamento nº ${t.quote.budgetNumber})`
                    : (t.serialNumber ?? t.id.slice(0, 8)),
                )
                .join(', ');
              throw new BadRequestException(
                `Já existe orçamento para: ${labels}${conflicting.length > 5 ? ', …' : ''}.`,
              );
            }
            await tx.task.updateMany({
              where: { id: { in: addedTaskIds } },
              data: { quoteId: id },
            });
          }

          if (removedTaskIds.length > 0) {
            // As configurações de faturamento da tarefa retirada saem por
            // cascata (`BudgetPayer.taskId` é `onDelete: Cascade` na
            // TAREFA, não no vínculo) — então a reconciliação abaixo é quem as
            // apaga, com as guardas de boleto ativo e parcela paga.
            await tx.task.updateMany({
              where: { id: { in: removedTaskIds }, quoteId: id },
              data: { quoteId: null },
            });
            this.logger.log(
              `[QUOTE UPDATE] Orçamento ${id}: ${removedTaskIds.length} tarefa(s) desvinculada(s), ` +
                `${addedTaskIds.length} vinculada(s).`,
            );
          }
        }

        // O número pedido já é de outro orçamento? Diga QUAL, antes de escrever.
        //
        // `budgetNumber` é `@unique`, então o banco recusaria de qualquer jeito —
        // mas com um P2002 que vira "Já existe um registro com o mesmo valor
        // único (budgetNumber)". Quem está renumerando precisa saber para onde o
        // número foi, não que ele "existe". Dentro da transação porque fora dela
        // a checagem é um palpite: duas renumerações simultâneas passariam as
        // duas pela leitura e uma morreria no INSERT.
        if ((data as any).budgetNumber !== undefined) {
          const taken = await tx.budget.findFirst({
            where: { budgetNumber: (data as any).budgetNumber, id: { not: id } },
            select: { id: true, tasks: { select: { serialNumber: true }, take: 1 } },
          });
          if (taken) {
            const serial = taken.tasks[0]?.serialNumber;
            throw new BadRequestException(
              `O número ${(data as any).budgetNumber} já é de outro orçamento` +
                `${serial ? ` (veículo ${serial})` : ''}. Escolha um número livre.`,
            );
          }
        }

        const updatedQuote = await tx.budget.update({
          where: { id },
          data: {
            ...(aggregateSubtotal !== undefined && { subtotal: aggregateSubtotal }),
            ...(aggregateTotal !== undefined && { total: aggregateTotal }),
            ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt }),
            // Junto ou separado. Gravado ANTES da reconciliação de configurações
            // (que lê este valor do banco para saber quantas fatias criar) e
            // ANTES de `recalcQuoteTotals`.
            ...((data as any).billingSplit !== undefined && {
              billingSplit: updateBillingSplit as any,
            }),
            ...(data.status !== undefined && {
              status: data.status,
              statusOrder: this.getStatusOrder(data.status as TASK_QUOTE_STATUS),
            }),
            // Guarantee Terms
            ...(data.guaranteeYears !== undefined && { guaranteeYears: data.guaranteeYears }),
            ...(data.customGuaranteeText !== undefined && {
              customGuaranteeText: data.customGuaranteeText,
            }),
            // Layout Files (max 2) — `set` replaces the relation wholesale ([] clears).
            // Clone any File currently owned by ANOTHER quote so bulk-applying one
            // layout to N quotes gives each an INDEPENDENT copy (FK lives on File).
            ...(data.layoutFileIds !== undefined && {
              layoutFiles: {
                set: (
                  await this.fileService.resolveLayoutFileIdsForQuote(
                    tx,
                    id,
                    data.layoutFileIds ?? [],
                    userId,
                  )
                ).map((fid: string) => ({ id: fid })),
              },
            }),
            // O NÚMERO DO ORÇAMENTO, corrigível à mão.
            //
            // Nasce de `allocateBudgetNumber` (MAX+1, denso) e quase nunca se
            // mexe — mas "quase nunca" não é "nunca": a numeração já saiu
            // torta, e o número é a referência que o cliente usa no e-mail, no
            // pedido de compra e no comprovante do Pix. Sem esta linha o campo
            // era rastreado no changelog (`fieldsToTrack`, abaixo) e não tinha
            // como mudar — a tela oferecia uma correção que o servidor
            // descartava.
            //
            // NÃO entra em `QUOTE_SAFE_AFTER_BILLING_FIELDS` de propósito: a
            // NFS-e e o boleto emitidos CITAM este número, e renumerar depois
            // deles faria o documento fiscal apontar para um orçamento que não
            // existe mais. Com cobrança aprovada, a trava do dinheiro recusa —
            // e é o que se quer.
            ...((data as any).budgetNumber !== undefined && {
              budgetNumber: (data as any).budgetNumber,
            }),
            ...(data.simultaneousTasks !== undefined && {
              simultaneousTasks: data.simultaneousTasks,
            }),
            ...(data.customForecastDays !== undefined && {
              customForecastDays: data.customForecastDays,
            }),
            ...(data.services && {
              services: {
                deleteMany: {},
                create: data.services.map((service, index) => ({
                  amount: service.amount || 0,
                  description: service.description || '',
                  observation: service.observation || null,
                  position: index,
                  ...(service.invoiceToCustomerId && {
                    invoiceToCustomer: { connect: { id: service.invoiceToCustomerId } },
                  }),
                })),
              },
            }),
          },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            layoutFiles: { orderBy: { createdAt: 'asc' } },
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
          },
        });

        // Derive the layout file id-list so changelog tracks it as ONE field
        // (the relation itself is an array of File objects).
        const oldEntityForTracking = {
          ...(existing as any),
          layoutFileIds: ((existing as any).layoutFiles || []).map((f: any) => f.id),
        };
        const newEntityForTracking = {
          ...(updatedQuote as any),
          layoutFileIds: ((updatedQuote as any).layoutFiles || []).map((f: any) => f.id),
        };

        // Track individual field changes
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: id,
          oldEntity: oldEntityForTracking,
          newEntity: newEntityForTracking,
          fieldsToTrack: [
            'subtotal',
            'total',
            'expiresAt',
            'status',
            'guaranteeYears',
            'customGuaranteeText',
            'layoutFileIds',
            'customForecastDays',
            'budgetNumber',
            'simultaneousTasks',
          ],
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION as any,
          transaction: tx,
        });

        // Any layout file added straight onto the quote (batch "Layout do
        // Orçamento", billing editor, clones, …) must also exist as an APPROVED
        // task layout. The quote is already linked to its task here.
        if (data.layoutFileIds !== undefined) {
          // Promote the selected images to APPROVED task layouts (re-approving a
          // re-selected REPROVED one — selection is authoritative), then…
          await syncTaskLayoutsFromQuote(tx, id, userId, true);
          // …reprove EVERY non-selected APPROVED task layout of this task. The
          // approved-layout selection (Step 2 / "Layout do Orçamento") is
          // authoritative: whatever is picked stays APPROVED, all others are
          // REPROVED — unless a sibling quote still references the image. No-op
          // when the selection is empty (never mass-reprove).
          await reproveNonSelectedTaskLayoutsFromQuote(tx, id, userId);
        }

        // ═══════════════════════════════════════════════════════════════════
        // TROCAR "JUNTO OU SEPARADO" SOZINHO TAMBÉM REFATIA
        // ═══════════════════════════════════════════════════════════════════
        //
        // A reconciliação abaixo só roda quando a gravação traz
        // `customerConfigs` — e a tela de orçamento traz sempre, porque
        // reenvia o formulário inteiro. Mas `billingSplit` é editável sozinho
        // (o seletor "Faturamento dos N veículos"), e um corpo com só ele
        // deixava o orçamento afirmando `PER_TASK` com UMA fatia conjunta.
        //
        // O estrago não é cosmético: `internalApprove` por veículo procura a
        // fatia daquele caminhão, acha a conjunta — que cobre todos — e aprova
        // o faturamento dos sessenta de uma vez, emitindo sessenta notas com
        // vencimento contado de hoje. Exatamente o que a escolha "separado"
        // existe para impedir.
        //
        // Aqui as configurações de ENTRADA são as que já estão no banco, uma
        // por cliente: o que muda é o fatiamento, não os termos.
        const billingSplitChanged =
          (data as any).billingSplit !== undefined &&
          updateBillingSplit !== ((existing as any).billingSplit ?? 'JOINT');

        // ─── TROCAR O MODO DEPOIS DE FATURAR NÃO É POSSÍVEL ──────────────────
        //
        // A cobertura de uma fatura já aprovada é congelada — ela sustenta uma
        // nota fiscal autorizada e boletos registrados, e mudá-la
        // retroativamente alteraria de quais caminhões é um documento fiscal que
        // já saiu. A reconciliação respeita isso sozinha, mas em silêncio: o
        // pedido "separe os sessenta" numa `JOINT` já faturada não teria efeito
        // nenhum e a tela mostraria "separado" sobre uma fatura única. Recusar é
        // a resposta honesta, e diz o que fazer.
        //
        // O TESTE É "CONGELADA", NÃO "APROVADA". Contar só a aprovação deixava
        // passar o faturamento que tem FATURA VIVA sem carimbo — e ele existe:
        // `materializeFromQuote`, na conciliação bancária, cria
        // `Invoice{status:'ACTIVE'}` amarrada ao pagador e nunca aprova nada. A
        // reconciliação usa o critério mais largo (`hasLiveInvoice`), então a
        // troca de modo passava a guarda, rodava, e a fatia era pulada lá dentro:
        // o orçamento afirmava um modo que a cobertura contradizia — exatamente o
        // que esta guarda existe para impedir.
        if (billingSplitChanged) {
          const frozen = await tx.budgetPayer.count({
            where: {
              quoteId: id,
              OR: [
                // O MESMO critério da trava do orçamento e da reconciliação:
                // carimbo OU estado pós-aprovação. Aqui só o carimbo era lido, e
                // a cobrança liquidada por conciliação bancária (SETTLED sem
                // `approvedAt` — duas no acervo) passava por livre.
                { billing: BILLING_FROZEN_WHERE },
                { invoices: { some: { status: { not: INVOICE_STATUS.CANCELLED } } } },
              ],
            },
          });
          if (frozen > 0) {
            throw new BadRequestException(
              'Não é possível mudar a forma de faturamento: já existe faturamento aprovado ou fatura emitida neste orçamento. ' +
                'Reverta o faturamento antes de refatiar.',
            );
          }
        }
        if (data.customerConfigs === undefined && billingSplitChanged) {
          const storedConfigs = await tx.budgetPayer.findMany({
            where: { quoteId: id },
            orderBy: { createdAt: 'asc' },
          });
          const byCustomer = new Map<string, (typeof storedConfigs)[number]>();
          for (const c of storedConfigs) {
            if (!byCustomer.has(c.customerId)) byCustomer.set(c.customerId, c);
          }
          if (byCustomer.size > 0) {
            await reconcileQuoteCustomerConfigs(
              tx,
              id,
              [...byCustomer.values()].map(c => ({
                customerId: c.customerId,
                subtotal: Number(c.subtotal),
                total: Number(c.total),
                discountType: c.discountType,
                discountValue: c.discountValue != null ? Number(c.discountValue) : null,
                discountReference: c.discountReference,
                customPaymentText: c.customPaymentText,
                generateInvoice: c.generateInvoice,
                generateBankSlip: c.generateBankSlip,
                paymentCondition: c.paymentCondition,
                paymentConfig: c.paymentConfig,
              })),
              { billingSplit: updateBillingSplit, taskIds: nextTaskIds },
            );
          }
        }

        // Handle customerConfigs changes
        if (data.customerConfigs !== undefined) {
          // Reconcile by (quoteId, customerId) WITHOUT destroy-and-recreate:
          // updates existing rows in place (so issued Invoice/Installments and
          // DB-owned fields — customerSignatureId/orderNumber/paymentConfig —
          // survive), creates new customers, deletes only removed ones (blocking
          // on live financial obligations). Replaces the former deleteMany +
          // createMany, which silently wiped the signature and could cascade-
          // delete an issued invoice. Installments stay created at
          // BILLING_APPROVED time, not here.
          const {
            cancelledInvoices,
            cancelledInvoiceBillingIds,
            diff: configDiff,
          } = await reconcileQuoteCustomerConfigs(
            tx,
            id,
            data.customerConfigs as any,
            // O estado FINAL, não o do banco: a mesma gravação pode ter acabado
            // de trocar o modo de faturamento ou o conjunto de veículos, e ler do
            // banco aqui criaria as fatias erradas.
            { billingSplit: updateBillingSplit, taskIds: nextTaskIds },
          );

          // COMPATIBILIDADE: `customerConfigs[].orderNumber` (ver a mesma nota em
          // `create`). O pedido é do VEÍCULO; o app instalado ainda o manda na
          // fatia, e ali ele vale para todas as tarefas do orçamento. Um `null`
          // NÃO apaga — a tela nova escreve por veículo, e um cliente antigo que
          // não lê mais o campo mandaria nulo em toda gravação.
          const legacyOrderNumber = (data.customerConfigs as any[])
            .map(c => (typeof c?.orderNumber === 'string' ? c.orderNumber.trim() : ''))
            .find(v => v.length > 0);
          if (legacyOrderNumber) {
            await tx.task.updateMany({
              where: { quoteId: id },
              data: { customerOrderNumber: legacyOrderNumber },
            });
          }

          // Audit the per-customer billing terms. The discount lives on the config
          // row, so when it moved off Budget (migration 20260408000003) it left
          // the `fieldsToTrack` scalar allowlist behind and stopped being audited
          // entirely — a discount could be wiped with no trace beyond the derived
          // quote total. Logged against the QUOTE id so the entries surface on the
          // quote timeline, mirroring how TASK_QUOTE_SERVICE entries are anchored.
          // Names for every customer on either side of this write — used by the
          // per-field logs below AND by the customer-set log further down.
          const namedCustomerIds = [
            ...new Set([
              ...configDiff.map(d => d.customerId),
              ...((existing as any).customerConfigs || []).map((c: any) => c.customerId),
              ...(data.customerConfigs as any[]).map(c => c.customerId),
            ]),
          ].filter(Boolean);
          const configCustomers = namedCustomerIds.length
            ? await tx.customer.findMany({
                where: { id: { in: namedCustomerIds } },
                select: { id: true, fantasyName: true },
              })
            : [];
          const configCustomerNames = new Map(configCustomers.map(c => [c.id, c.fantasyName]));

          if (configDiff.length > 0) {
            for (const entry of configDiff) {
              const who = configCustomerNames.get(entry.customerId) || entry.customerId;
              const reason =
                entry.type === 'added'
                  ? entry.inherited
                    ? `Faturamento '${who}' adicionado — desconto herdado do cliente substituido`
                    : `Faturamento '${who}' adicionado ao orcamento`
                  : entry.type === 'removed'
                    ? `Faturamento '${who}' removido do orcamento`
                    : `Faturamento '${who}' — ${entry.field} alterado`;

              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK_QUOTE_CUSTOMER_CONFIG,
                entityId: id,
                action:
                  entry.type === 'added'
                    ? (CHANGE_LOG_ACTION.CREATE as any)
                    : entry.type === 'removed'
                      ? (CHANGE_LOG_ACTION.DELETE as any)
                      : (CHANGE_LOG_ACTION.UPDATE as any),
                field: entry.field ?? null,
                oldValue: entry.oldValue ?? null,
                newValue: entry.newValue ?? null,
                reason,
                metadata: {
                  customerId: entry.customerId,
                  customerName: who,
                  inherited: !!entry.inherited,
                },
                userId: userId || '',
                triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
                triggeredById: userId,
                transaction: tx,
              });
            }
          }

          // Cancelar a fatura de um pagador removido desfaz a APROVAÇÃO DA
          // COBRANÇA, não o status do orçamento — o orçamento continua aprovado,
          // porque o que foi vendido não mudou. Levantar o `approvedAt` devolve a
          // cobrança a PENDENTE e obriga o financeiro a reconferir antes de
          // reemitir fatura, boleto e NFS-e.
          // ⚠️ SÓ OS FATURAMENTOS QUE PERDERAM A FATURA. Era
          // `where: { quoteId: id }` — TODOS os do orçamento. Num orçamento de
          // sessenta caminhões, remover um pagador do lote 3 levantava o carimbo
          // dos lotes 1 e 2, que estavam faturados, com nota autorizada na
          // prefeitura e boleto registrado no Sicredi.
          //
          // E o ESTADO vai junto com o carimbo. Escrever `approvedAt: null`
          // deixando `status` em APROVADO fabrica exatamente a divergência que a
          // trava do dinheiro precisa enxergar depois: cobrança sem aprovação
          // afirmando-se aprovada. Sem parcela viva e sem carimbo, a cascata
          // (`BillingStatusCascadeService.resolve`) responde PENDENTE — é esse
          // valor que se grava, não um inventado.
          if (cancelledInvoices && cancelledInvoiceBillingIds.length > 0) {
            const desaprovadas = await (tx as any).billing.updateMany({
              where: { id: { in: cancelledInvoiceBillingIds }, approvedAt: { not: null } },
              data: {
                approvedAt: null,
                status: BILLING_STATUS.PENDING as any,
                statusOrder: BILLING_STATUS_ORDER[BILLING_STATUS.PENDING],
              },
            });
            if (desaprovadas.count > 0) {
              await tx.budget.update({
                where: { id },
                data: {
                  // O carimbo de "inteiramente faturado" cai junto: deixou de ser verdade.
                  billingApprovedAt: null,
                } as any,
              });
            }
          }

          // Clear orphaned service assignments: if a customer was removed from configs,
          // any services assigned to that customer via invoiceToCustomerId should be set to null
          const validCustomerIds = data.customerConfigs.map(c => c.customerId);
          await tx.budgetItem.updateMany({
            where: {
              quoteId: id,
              invoiceToCustomerId: {
                notIn: validCustomerIds.length > 0 ? validCustomerIds : ['__none__'],
                not: null,
              },
            },
            data: {
              invoiceToCustomerId: null,
            },
          });

          // Log customer configs change — compare by customerId to detect actual customer changes
          const oldConfigs = (existing as any).customerConfigs || [];
          const oldConfigIds =
            oldConfigs
              .map((c: any) => c.customerId)
              .sort()
              .join(', ') || 'Nenhum';
          const newConfigIds =
            data.customerConfigs
              .map((c: any) => c.customerId)
              .sort()
              .join(', ') || 'Nenhum';
          // Use names for human-readable log values
          const oldConfigNames =
            oldConfigs.map((c: any) => c.customer?.fantasyName || c.customerId).join(', ') ||
            'Nenhum';
          // Resolve the NEW side to names too. This previously mapped `customerId`
          // despite the variable name, so every entry read "Cliente A → 187bff5f-…":
          // a name replaced by a hex string, giving no hint that money had moved.
          const newConfigNames =
            data.customerConfigs
              .map((c: any) => configCustomerNames.get(c.customerId) || c.customerId)
              .join(', ') || 'Nenhum';

          if (oldConfigIds !== newConfigIds) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_QUOTE,
              entityId: id,
              action: CHANGE_LOG_ACTION.UPDATE as any,
              field: 'customerConfigs',
              oldValue: oldConfigNames,
              newValue: newConfigNames,
              userId: userId || '',
              reason: 'Atualização de configurações de clientes para faturamento',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }
        }

        // Track quote services changes (per-service granular tracking)
        if (data.services !== undefined) {
          const oldServices = (existing as any).services || [];
          const newServices = (updatedQuote as any).services || [];

          // Log per-service changes (added, removed, field updates)
          await logQuoteServiceChanges({
            changeLogService: this.changeLogService,
            quoteId: id,
            oldServices,
            newServices,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            transaction: tx,
          });

          // Also keep a bulk snapshot for backward compatibility (field: 'services_snapshot')
          const formatService = (service: any) =>
            `${service.description || ''}: R$ ${Number(service.amount || 0).toFixed(2)}`;
          const oldServicesSummary = oldServices.map(formatService).sort();
          const newServicesSummary = newServices.map(formatService).sort();
          const servicesChanged =
            oldServicesSummary.length !== newServicesSummary.length ||
            oldServicesSummary.some((s: string, i: number) => s !== newServicesSummary[i]);

          if (servicesChanged) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK_QUOTE,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'services_snapshot',
              oldValue: serializeChangelogValue({
                count: oldServices.length,
                services: oldServices.map((service: any) => ({
                  description: service.description,
                  amount: Number(service.amount),
                  observation: service.observation,
                })),
              }),
              newValue: serializeChangelogValue({
                count: newServices.length,
                services: newServices.map((service: any) => ({
                  description: service.description,
                  amount: Number(service.amount),
                  observation: service.observation,
                })),
              }),
              userId: userId || '',
              reason: 'Atualização dos serviços do orçamento (snapshot)',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: userId,
              transaction: tx,
            });
          }

          // Fix R$ 0,00 snapshot: update quoteId changelog when real amounts are set
          const allOldAmountsZero = oldServices.every(
            (service: any) => Number(service.amount) === 0,
          );
          const anyNewAmountNonZero = newServices.some(
            (service: any) => Number(service.amount) > 0,
          );

          if (allOldAmountsZero && anyNewAmountNonZero) {
            const updatedWithTask = await tx.budget.findUnique({
              where: { id },
              include: {
                tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } },
                services: { orderBy: { position: 'asc' } },
              },
            });

            const taskRef = updatedWithTask?.tasks?.[0];
            if (taskRef) {
              const quoteIdLog = await tx.changeLog.findFirst({
                where: { entityType: 'TASK', entityId: taskRef.id, field: 'quoteId' },
                orderBy: { createdAt: 'desc' },
              });
              if (quoteIdLog) {
                const realSnapshot = serializeChangelogValue({
                  id,
                  budgetNumber: (updatedWithTask as any).budgetNumber,
                  subtotal: (updatedWithTask as any).subtotal,
                  total: (updatedWithTask as any).total,
                  status: (updatedWithTask as any).status,
                  services: updatedWithTask!.services.map(service => ({
                    description: service.description,
                    amount: Number(service.amount),
                    observation: service.observation,
                  })),
                });
                await tx.changeLog.update({
                  where: { id: quoteIdLog.id },
                  data: { newValue: realSnapshot },
                });
              }
            }
          }
        }

        // =====================================================================
        // CASCADE DELETE: When quote services are removed, delete the
        // corresponding PRODUCTION service orders
        // =====================================================================
        if (data.services !== undefined) {
          const oldServices = (existing as any).services || [];
          const newServices = (updatedQuote as any).services || [];

          // Composite key: description + observation combined
          const makeKey = (desc: string | null, obs: string | null): string =>
            `${normalizeDescription(desc)}|${normalizeDescription(obs)}`;

          // Build set of composite keys in the new services
          const newKeys = new Set(
            newServices.map((s: any) => makeKey(s.description, s.observation)),
          );

          // Find composite keys that were removed (in old but not in new)
          const keysToDelete = new Set<string>();

          for (const oldSvc of oldServices) {
            const key = makeKey(oldSvc.description, oldSvc.observation);
            if (key.startsWith('|')) continue; // empty description, skip
            if (!newKeys.has(key)) {
              // Service was removed from quote
              keysToDelete.add(key);
            }
          }

          if (keysToDelete.size > 0) {
            // Get the task ID for this quote
            const quoteWithTask = await tx.budget.findUnique({
              where: { id },
              select: {
                tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } },
              },
            });
            // TODAS as tarefas: a O.S. é por veículo, e num orçamento de
            // sessenta caminhões mexer só na primeira deixaria cinquenta e nove
            // com a lista de serviços antiga.
            const syncTaskIds = (quoteWithTask?.tasks ?? []).map(t => t.id);
            const taskId = syncTaskIds[0];

            if (taskId) {
              // Find matching PRODUCTION service orders
              const productionSOs = await tx.serviceOrder.findMany({
                where: {
                  taskId,
                  type: SERVICE_ORDER_TYPE.PRODUCTION,
                },
              });

              for (const so of productionSOs) {
                const soKey = makeKey(so.description, so.observation);
                if (keysToDelete.has(soKey)) {
                  this.logger.log(
                    `[Quote Update] Deleting service order ${so.id} (${so.description}) — quote service removed`,
                  );
                  await tx.serviceOrder.delete({
                    where: { id: so.id },
                  });
                }
              }
            }
          }

          // =====================================================================
          // SYNC CREATE: When new quote services are added, create corresponding
          // PRODUCTION service orders
          // =====================================================================
          try {
            const quoteWithTask = await tx.budget.findUnique({
              where: { id },
              select: {
                tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } },
              },
            });
            const syncTaskIds = (quoteWithTask?.tasks ?? []).map(t => t.id);
            const taskId = syncTaskIds[0];

            if (taskId) {
              const existingServiceOrders = await tx.serviceOrder.findMany({
                where: { taskId: { in: syncTaskIds } },
                select: { id: true, description: true, observation: true, type: true },
              });

              const existingSOs: SyncServiceOrder[] = existingServiceOrders.map((so: any) => ({
                id: so.id,
                description: so.description,
                observation: so.observation,
                type: so.type,
              }));

              const newServices = (updatedQuote as any).services || [];

              for (let i = 0; i < newServices.length; i++) {
                const service = newServices[i];
                if (!service.description) continue;

                const syncResult = getQuoteItemToServiceOrderSync(
                  { description: service.description, observation: service.observation || null },
                  existingSOs,
                );

                if (syncResult.shouldCreateServiceOrder) {
                  this.logger.log(
                    `[QUOTE→SO SYNC] Creating PRODUCTION service order: "${syncResult.serviceOrderDescription}" for updated quote service`,
                  );

                  await tx.serviceOrder.create({
                    data: {
                      description: syncResult.serviceOrderDescription,
                      observation: syncResult.serviceOrderObservation,
                      status: SERVICE_ORDER_STATUS.PENDING as any,
                      statusOrder: getServiceOrderStatusOrder(SERVICE_ORDER_STATUS.PENDING),
                      type: SERVICE_ORDER_TYPE.PRODUCTION as any,
                      position: service.position ?? i,
                      task: { connect: { id: taskId } },
                      createdBy: { connect: { id: userId } },
                    },
                  });

                  // Add to existing SOs to prevent duplicates within the same batch
                  existingSOs.push({
                    description: syncResult.serviceOrderDescription,
                    observation: syncResult.serviceOrderObservation,
                    type: SERVICE_ORDER_TYPE.PRODUCTION,
                  });
                }
              }
            }
          } catch (syncError) {
            this.logger.error('[QUOTE→SO SYNC] Error during update sync:', syncError);
            // Don't throw - sync errors shouldn't block quote update
          }
        }

        // Authoritative, discount-aware recompute of per-config + aggregate
        // totals from the now-persisted services + configs. Single source of
        // truth — runs whenever services OR configs changed, so a services-only
        // edit (configs stripped by filterToMaterialChanges) never leaves
        // subtotal/total stale (the "detail ≠ wizard" + mis-billed-invoice bug).
        //
        // `taskIds` entra na condição junto: mudar o CONJUNTO de veículos muda o
        // multiplicador de todo total (`por veículo × N`) e a contagem
        // desnormalizada, e uma edição que só acrescenta ou retira caminhão não
        // manda serviços nem configurações. Sem esta chave, tirar um veículo de
        // sessenta deixava o contrato afirmando sessenta.
        //
        // ⚠️ `billingSplit` ENTRA NA CONDIÇÃO. Trocar "junto" por "separado" é
        // uma gravação que normalmente não traz serviço nem configuração
        // nenhuma — e ela refatia o faturamento logo acima. Sem esta chave, as
        // sessenta faturas novas nasciam copiando o `total` da conjunta: o valor
        // do CONTRATO inteiro em cada uma, sessenta vezes, congelado em
        // `Invoice.totalAmount` na aprovação seguinte.
        if (
          data.services !== undefined ||
          data.customerConfigs !== undefined ||
          data.taskIds !== undefined ||
          (data as any).billingSplit !== undefined
        ) {
          // A COBERTURA antes do total. Uma gravação que só mexe em `taskIds`
          // não passa pela reconciliação acima (ela só roda com
          // `customerConfigs` ou com troca de modo), e sem refatiar aqui o
          // caminhão acrescentado ficaria fora de toda fatura — ou o retirado
          // continuaria dentro de uma. Não toca em nenhum termo: ver
          // `resliceQuoteCoverage`.
          await resliceQuoteCoverage(tx, id, {
            billingSplit: updateBillingSplit,
            taskIds: nextTaskIds,
          });
          await recalcQuoteTotals(tx, id);
        }

        return tx.budget.findUnique({
          where: { id },
          include: {
            services: {
              orderBy: { position: 'asc' },
              include: {
                invoiceToCustomer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
              },
            },
            tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            layoutFiles: { orderBy: { createdAt: 'asc' } },
            customerConfigs: {
              include: {
                customer: {
                  select: { id: true, fantasyName: true, cnpj: true },
                },
                installments: { orderBy: { number: 'asc' } },
                customerSignature: true,
              },
            },
          },
        });
      });

      // Reconcile the "Em Negociação" SO whenever this update changed the
      // quote status (explicit caller status, or the auto-revert-to-PENDING
      // branch above triggered by value-affecting edits) OR the layout files —
      // uploading/clearing a layout flips the "has layout" check.
      if (data.status !== undefined || (data as any).layoutFileIds !== undefined) {
        await syncEmNegociacaoForQuote(this.prisma, id, userId);
      }

      // Pós-commit: se algo que o documento EXIBE mudou, a coleta de assinaturas
      // em andamento deixa de valer. O cliente assinou uma versão específica do
      // orçamento; mantê-la de pé após uma alteração material vincularia alguém a
      // um documento que se moveu por baixo dele (CC art. 431; OWASP Transaction
      // Authorization §2.6). Best-effort: nunca derruba a atualização em si.
      try {
        // Cronometrado porque este gancho JÁ foi a causa de um "Salvando" de
        // meio minuto: ele recarrega o grafo do orçamento, recalcula o snapshot
        // e, quando a alteração é material, invalida a coleta em andamento. O
        // que o tornava lento — os avisos de anulação saindo pelo transporte de
        // WhatsApp, em série, com intervalo humano entre eles — saiu do caminho
        // síncrono; a medição fica para que a próxima regressão apareça no log
        // em vez de ser deduzida.
        const startedAt = Date.now();
        const invalidated = await this.signatureEnvelopes.onQuoteContentChanged(id, userId || null);
        const elapsed = Date.now() - startedAt;

        // ── A RESPOSTA PRECISA CARREGAR O STATUS NOVO ───────────────────────
        //
        // `updated` foi montado DENTRO da transação, antes de a invalidação
        // existir. Quando ela derruba a coleta, o gancho devolve o orçamento a
        // PENDENTE por uma segunda escrita — e sem esta releitura o PUT
        // responderia "Aprovado" para a tela que acabou de salvar. O status
        // certo só apareceria no próximo refresh, que é como se descobre um
        // defeito, não como se aplica uma regra.
        //
        // Reler os três campos, e não o grafo inteiro: a reversão só toca
        // status, ordem e carimbo. Uma segunda leitura com o `include` completo
        // custaria o dobro e ainda poderia divergir do que foi montado acima.
        if (invalidated) {
          const fresh = await this.prisma.budget.findUnique({
            where: { id },
            select: { status: true, statusOrder: true, updatedAt: true },
          });
          if (fresh) Object.assign(updated as any, fresh);
        }
        if (elapsed > 1500) {
          this.logger.warn(
            `Reavaliação de assinaturas do orçamento ${id} levou ${elapsed} ms — ` +
              'o salvamento esperou por isso.',
          );
        }
      } catch (sigError) {
        this.logger.error(
          `Falha ao reavaliar assinaturas do orçamento ${id}: ${
            sigError instanceof Error ? sigError.message : sigError
          }`,
        );
      }

      return {
        success: true,
        data: updated as any,
        message: 'Orçamento atualizado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating task quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar orçamento.');
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SIMPLIFICAR ORÇAMENTO — N orçamentos de 1 veículo viram 1 de N veículos
  //
  // A tela de criação produziu um orçamento POR caminhão durante meses, e o
  // acervo herdou isso: 72 grupos de orçamentos irmãos em produção (mesmo
  // cliente, mesmo dia, mesmo total), o maior com TRINTA. São trinta números,
  // trinta PDFs e trinta cerimônias de assinatura para um negócio só.
  //
  // O que a união dá: UM documento e UMA assinatura.
  // O que ela NÃO dá: uma fatura só — ver `billingSplit` em `mergeQuotes`.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Carrega os candidatos e os reduz ao que as regras julgam.
   *
   * Uma consulta por TAREFA, não por orçamento: é a tela que seleciona veículos,
   * e quatro linhas de um orçamento de quatro são quatro tarefas do MESMO
   * orçamento. A deduplicação acontece aqui, e é ela que faz a seleção "todos os
   * veículos deste orçamento" ser inofensiva.
   */
  private async loadMergeCandidates(taskIds: string[]): Promise<{
    candidates: MergeCandidate[];
    semOrcamento: number;
  }> {
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, quoteId: true },
    });
    const semOrcamento = tasks.filter(t => !t.quoteId).length;
    const quoteIds = [...new Set(tasks.map(t => t.quoteId).filter((q): q is string => !!q))];
    if (!quoteIds.length) return { candidates: [], semOrcamento };

    const quotes = await this.prisma.budget.findMany({
      where: { id: { in: quoteIds } },
      include: {
        services: { orderBy: { position: 'asc' } },
        tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } },
        layoutFiles: { select: { id: true } },
        customerConfigs: {
          include: {
            billing: { select: { approvedAt: true, status: true } },
            invoices: { select: { status: true } },
            nfseDocuments: { select: { status: true } },
            installments: { select: { status: true, paidAmount: true } },
          },
        },
      },
    });

    // Assinatura: a fronteira que o serviço de exclusão já define. Um envelope
    // com coleta viva ou documento selado PROTEGE o orçamento — ele não some.
    const protegidos = new Set(await this.signatureDeletion.findProtectedQuoteIds(quoteIds));

    const candidates: MergeCandidate[] = quotes.map(q => ({
      id: q.id,
      budgetNumber: q.budgetNumber,
      status: String(q.status),
      billingSplit: String((q as any).billingSplit ?? 'JOINT'),
      expiresAt: q.expiresAt,
      guaranteeYears: q.guaranteeYears ?? null,
      customGuaranteeText: q.customGuaranteeText ?? null,
      customForecastDays: q.customForecastDays ?? null,
      layoutFileIds: (q as any).layoutFiles?.map((f: { id: string }) => f.id) ?? [],
      services: q.services.map(sv => ({
        description: sv.description,
        amount: Number(sv.amount),
      })),
      customerConfigs: (q as any).customerConfigs.map((c: any) => ({
        customerId: c.customerId,
        discountType: c.discountType ?? null,
        discountValue: c.discountValue != null ? Number(c.discountValue) : null,
        paymentCondition: c.paymentCondition ?? null,
        customPaymentText: c.customPaymentText ?? null,
        paymentConfig: c.paymentConfig ?? null,
        // Os TRÊS braços: a consulta acima já traz `invoices`, e sem passá-las o
        // pagador com fatura viva e carimbo levantado (resíduo de uma aprovação
        // que falhou no meio) aparecia como editável para a mescla.
        billingFrozen: isBillingFrozen({
          ...(c.billing ?? { approvedAt: null, status: null }),
          invoices: c.invoices,
        }),
        // DINHEIRO VIVO sem cobrança congelada: fatura não cancelada, nota não
        // cancelada, ou qualquer centavo recebido. São três perguntas porque são
        // três sistemas — o nosso, a prefeitura e o banco — e cada um deixa um
        // rastro que a união apagaria.
        hasLiveMoney:
          (c.invoices ?? []).some((i: any) => i.status !== 'CANCELLED') ||
          (c.nfseDocuments ?? []).some((n: any) => n.status !== 'CANCELLED') ||
          (c.installments ?? []).some((p: any) => Number(p.paidAmount ?? 0) > 0),
      })),
      taskIds: q.tasks.map(t => t.id),
      signatureProtected: protegidos.has(q.id),
    }));

    return { candidates, semOrcamento };
  }

  /**
   * A PRÉVIA — julga sem escrever nada.
   *
   * Existe porque a tela de Agenda não carrega o que decide "são iguais": a
   * linha traz o total e o cliente, não a lista de serviços, o desconto nem as
   * condições de pagamento. Sem esta rota o diálogo teria de adivinhar ou pedir
   * o grafo inteiro de N orçamentos só para desenhar um botão.
   */
  async previewMergeQuotes(taskIds: string[]): Promise<{
    success: boolean;
    data: {
      survivor: { id: string; budgetNumber: number } | null;
      absorbed: Array<{ id: string; budgetNumber: number; vehicleCount: number }>;
      vehicleCount: number;
      blockers: MergeBlocker[];
      warnings: MergeWarning[];
    };
    message: string;
  }> {
    const { candidates, semOrcamento } = await this.loadMergeCandidates(taskIds);
    const verdict = judgeMerge(candidates);

    // Veículo sem orçamento na seleção BLOQUEIA. Unir não é atribuir: dar a ele
    // o orçamento do vizinho cobraria do cliente um serviço que ninguém orçou
    // para aquele caminhão.
    if (semOrcamento > 0) {
      verdict.blockers.unshift({
        code: 'NO_QUOTE',
        message:
          `${semOrcamento} ${semOrcamento === 1 ? 'veículo selecionado não tem' : 'veículos selecionados não têm'} ` +
          'orçamento. Simplificar une orçamentos existentes — não cria um para quem não tem.',
        budgetNumbers: [],
      });
    }

    return {
      success: true,
      data: {
        survivor: verdict.survivor
          ? { id: verdict.survivor.id, budgetNumber: verdict.survivor.budgetNumber }
          : null,
        absorbed: verdict.absorbed.map(c => ({
          id: c.id,
          budgetNumber: c.budgetNumber,
          vehicleCount: c.taskIds.length,
        })),
        vehicleCount: verdict.vehicleCount,
        blockers: verdict.blockers,
        warnings: verdict.warnings,
      },
      message: verdict.blockers.length
        ? 'Estes orçamentos não podem ser unidos.'
        : `${verdict.absorbed.length + 1} orçamentos viram 1, com ${verdict.vehicleCount} veículos.`,
    };
  }

  /**
   * A UNIÃO.
   *
   * ORDEM DA TRANSAÇÃO, e ela importa:
   *
   *   1. julgar de novo (a prévia pode ter envelhecido entre a tela e o botão);
   *   2. purgar a assinatura dos ABSORVIDOS — envelopes cancelados/expirados que
   *      não protegem o orçamento, mas cujas linhas o `Cascade` levaria sem
   *      passar pela ordem de limpeza que o serviço de exclusão define;
   *   3. MOVER as tarefas para o sobrevivente;
   *   4. APAGAR os orçamentos vazios. Tem de ser DEPOIS de mover e ANTES de
   *      refatiar: `BillingTask.@@unique([taskId])` é global, então enquanto o
   *      faturamento do absorvido existir, o veículo movido ainda está coberto
   *      por ele e a cobertura nova estoura;
   *   5. refatiar a cobertura do sobrevivente com os N veículos;
   *   6. `recalcQuoteTotals` — o ÚNICO que escreve `vehicleCount`, e da mesma
   *      contagem que multiplica os totais;
   *   7. changelog no sobrevivente e em cada veículo movido.
   *
   * Pós-commit, fora da transação: reconciliar a O.S. "Em Negociação" e
   * reavaliar a assinatura do sobrevivente (acrescentar veículo é MATERIAL).
   */
  async mergeQuotes(
    taskIds: string[],
    userId: string,
    options?: { billingSplit?: string | null },
  ): Promise<{
    success: boolean;
    data: {
      survivorId: string;
      budgetNumber: number;
      absorbedBudgetNumbers: number[];
      movedTaskIds: string[];
      vehicleCount: number;
    };
    message: string;
  }> {
    const preview = await this.previewMergeQuotes(taskIds);
    if (preview.data.blockers.length) {
      throw new BadRequestException(preview.data.blockers.map(b => b.message).join(' '));
    }

    const { candidates } = await this.loadMergeCandidates(taskIds);
    const verdict = judgeMerge(candidates);
    if (!verdict.survivor || !verdict.absorbed.length) {
      throw new BadRequestException('Nada a unir.');
    }
    const survivor = verdict.survivor;
    const absorbedIds = verdict.absorbed.map(c => c.id);
    const movedTaskIds = verdict.absorbed.flatMap(c => c.taskIds);
    const allTaskIds = [...survivor.taskIds, ...movedTaskIds];

    // ── O MODO DE COBRANÇA DO RESULTADO ──────────────────────────────────────
    //
    // `PER_TASK` por padrão, decisão do dono (17/09/2026) — e não `JOINT`, que
    // seria a leitura ingênua de "virou um orçamento só".
    //
    // Quatro orçamentos de um veículo JÁ ERAM quatro faturamentos independentes,
    // com quatro números de pedido de compra possíveis e quatro notas. `JOINT`
    // colapsaria isso numa fatura só e destruiria uma capacidade que o cliente
    // usa. A união é do DOCUMENTO e da CERIMÔNIA; a cobrança continua onde
    // estava.
    const billingSplit = options?.billingSplit ?? 'PER_TASK';

    const result = await this.prisma.$transaction(
      async tx => {
        // 2. A assinatura dos absorvidos. `findProtectedQuoteIds` já garantiu
        //    (no julgamento) que nenhum deles tem coleta viva nem selo, então o
        //    que sobra aqui são envelopes cancelados, expirados e invalidados —
        //    que a purga sabe remover na ordem certa.
        await this.signatureDeletion.purgeForQuotes(tx, absorbedIds);

        // 3. Mover os veículos.
        await tx.task.updateMany({
          where: { quoteId: { in: absorbedIds } },
          data: { quoteId: survivor.id },
        });

        // 4. Apagar os orçamentos, agora vazios. O `Cascade` leva serviços,
        //    pagadores e faturamentos — todos já provados sem dinheiro vivo.
        await tx.budget.deleteMany({ where: { id: { in: absorbedIds } } });

        // 5. O modo e a validade do resultado. A validade mais DISTANTE: encurtar
        //    a de um veículo por causa da união seria decidir contra o cliente.
        const expiresAt = new Date(
          Math.max(...[survivor, ...verdict.absorbed].map(c => c.expiresAt.getTime())),
        );
        await tx.budget.update({
          where: { id: survivor.id },
          data: {
            billingSplit: billingSplit as any,
            expiresAt,
            // O documento é OUTRO: outros veículos, outro valor total, e o que
            // houvesse de assinatura nos absorvidos deixou de existir. Volta
            // para a fila de emissão do comercial.
            status: TASK_QUOTE_STATUS.PENDING,
            statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.PENDING),
          },
        });

        await resliceQuoteCoverage(tx, survivor.id, { billingSplit, taskIds: allTaskIds });

        // 6. Totais e `vehicleCount`, da mesma contagem.
        await recalcQuoteTotals(tx, survivor.id);

        // 7. A trilha. No sobrevivente, dizendo quem ele absorveu; e em cada
        //    veículo movido, dizendo de onde ele veio — sem isso o histórico do
        //    caminhão mostraria o orçamento trocando sozinho.
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: survivor.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'taskIds',
          userId,
          reason:
            `Simplificação: absorveu ${verdict.absorbed.map(c => `nº ${c.budgetNumber}`).join(', ')} ` +
            `(${movedTaskIds.length} ${movedTaskIds.length === 1 ? 'veículo' : 'veículos'}).`,
          oldValue: serializeChangelogValue(survivor.taskIds),
          newValue: serializeChangelogValue(allTaskIds),
          triggeredBy: CHANGE_TRIGGERED_BY.USER,
          triggeredById: userId,
          transaction: tx,
        });
        for (const absorvido of verdict.absorbed) {
          for (const taskId of absorvido.taskIds) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: taskId,
              action: CHANGE_ACTION.UPDATE,
              field: 'quoteId',
              userId,
              reason: `Simplificação: orçamento nº ${absorvido.budgetNumber} → nº ${survivor.budgetNumber}.`,
              oldValue: serializeChangelogValue(absorvido.id),
              newValue: serializeChangelogValue(survivor.id),
              triggeredBy: CHANGE_TRIGGERED_BY.USER,
              triggeredById: userId,
              transaction: tx,
            });
          }
        }

        return { vehicleCount: allTaskIds.length };
      },
      // Trinta orçamentos, trinta purgas de assinatura e uma reconciliação de
      // cobertura com trinta fatias. O padrão de 5 s não cobre isso.
      { timeout: 120_000 },
    );

    // Pós-commit, best-effort: nenhum dos dois pode desfazer uma união que já
    // está no banco.
    try {
      await syncEmNegociacaoForQuote(this.prisma, survivor.id, userId);
    } catch (e) {
      this.logger.error(`Falha ao reconciliar "Em Negociação" do orçamento ${survivor.id}: ${e}`);
    }
    try {
      await this.signatureEnvelopes.onQuoteContentChanged(survivor.id, userId || null);
    } catch (e) {
      this.logger.error(`Falha ao reavaliar assinaturas do orçamento ${survivor.id}: ${e}`);
    }

    return {
      success: true,
      data: {
        survivorId: survivor.id,
        budgetNumber: survivor.budgetNumber,
        absorbedBudgetNumbers: verdict.absorbed.map(c => c.budgetNumber),
        movedTaskIds,
        vehicleCount: result.vehicleCount,
      },
      message:
        `Orçamento nº ${survivor.budgetNumber} agora cobre ${result.vehicleCount} veículos. ` +
        `${verdict.absorbed.length} ${verdict.absorbed.length === 1 ? 'orçamento foi absorvido' : 'orçamentos foram absorvidos'}.`,
    };
  }

  /**
   * Delete quote
   */
  async delete(id: string, userId: string): Promise<BudgetDeleteResponse> {
    try {
      const existing = await this.prisma.budget.findUnique({
        where: { id },
        include: {
          services: { orderBy: { position: 'asc' } },
          tasks: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } },
          customerConfigs: { select: { id: true, customerId: true } },
          layoutFiles: { select: { id: true } },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Guard: cannot delete a quote that has live financial artifacts (invoices, bank slips,
      // NFS-e). Deleting would orphan records at Sicredi/Elotech and cascade-delete DB rows
      // that are referenced by external systems. Cancel all invoices first.
      // A pergunta é sobre DINHEIRO EMITIDO, e quem sabe disso é a cobrança. Antes
      // era uma lista de estados do orçamento — que num orçamento faturado
      // veículo a veículo respondia "sim" para o contrato inteiro assim que a
      // primeira fatia saía, e "não" para nenhuma depois de uma reversão parcial.
      // O MESMO critério de "congelado" das outras três guardas — carimbo OU
      // estado pós-aprovação. Só o carimbo deixava apagar o orçamento liquidado
      // por CONCILIAÇÃO (SETTLED, sem fatura e sem carimbo de onde derivar a
      // data): um contrato pago desaparecendo do sistema sem nada acusar.
      const cobrancasAprovadas = await (this.prisma as any).billing.count({
        where: { quoteId: id, ...BILLING_FROZEN_WHERE },
      });
      if (cobrancasAprovadas > 0) {
        throw new BadRequestException(
          'Não é possível deletar um orçamento com faturamento ativo. Cancele todas as faturas antes de deletar.',
        );
      }

      // Store the full quote data for changelog (enables rollback restoration)
      const quoteSnapshot = {
        id: existing.id,
        budgetNumber: existing.budgetNumber,
        subtotal: existing.subtotal,
        total: existing.total,
        expiresAt: existing.expiresAt,
        status: existing.status,
        guaranteeYears: existing.guaranteeYears,
        customGuaranteeText: existing.customGuaranteeText,
        customForecastDays: existing.customForecastDays,
        simultaneousTasks: existing.simultaneousTasks,
        layoutFileIds: ((existing as any).layoutFiles || []).map((f: any) => f.id),
        services: existing.services.map(service => ({
          description: service.description,
          amount: service.amount,
          observation: service.observation,
          position: service.position,
        })),
        customerConfigIds: existing.customerConfigs.map(c => c.customerId),
      };

      const taskId = existing.tasks?.[0]?.id;

      // Assinatura eletrônica: um orçamento com assinatura coletada ou envelope
      // selado não pode ser apagado (o documento assinado é a prova da
      // contratação — a política está em `SignatureDeletionService`). Em vez de
      // recusar com erro, a exclusão DEGRADA para cancelamento automático: o
      // orçamento vira CANCELLED (com teardown de faturamento e cancelamento das
      // cerimônias em andamento), e envelope + trilha + PDFs são preservados.
      const protectedQuoteIds = await this.signatureDeletion.findProtectedQuoteIds([id]);
      if (protectedQuoteIds.length > 0) {
        await this.cancelForTaskCancellation(
          id,
          userId,
          'Orçamento com assinatura eletrônica coletada — exclusão convertida em cancelamento para preservar o documento assinado',
        );
        return {
          success: true,
          message:
            `Orçamento nº ${existing.budgetNumber} possui assinatura eletrônica coletada e não pode ser ` +
            'excluído — foi cancelado automaticamente, preservando o documento assinado.',
        };
      }

      const purged = await this.prisma.$transaction(async tx => {
        // A trilha de auditoria é append-only por trigger; o `onDelete: Cascade`
        // de Budget → SignatureEnvelope → SignatureAuditEvent estouraria em
        // `restrict_violation` (500). A purga explícita esvazia o cascade antes
        // do delete, abrindo a válvula da migration só dentro desta transação.
        const result = await this.signatureDeletion.purgeForQuotes(tx, [id]);

        // Desvincula TODAS as tarefas antes de apagar.
        //
        // Era uma. Num orçamento de sessenta caminhões, desvincular só a
        // primeira deixaria cinquenta e nove com `quoteId` apontando para uma
        // linha apagada — e como a FK é `SetNull` sem `onDelete` declarado no
        // lado da tarefa, o `delete` abaixo falharia ou zeraria em silêncio, sem
        // registro no histórico de nenhuma delas. O `changeLog` por tarefa é o
        // que permite reconstruir depois de qual orçamento cada uma saiu.
        const unlinkTaskIds = ((existing as any).tasks ?? [])
          .map((t: any) => t.id as string)
          .filter(Boolean);
        if (unlinkTaskIds.length > 0) {
          await tx.task.updateMany({
            where: { id: { in: unlinkTaskIds } },
            data: { quoteId: null },
          });

          for (const unlinkedTaskId of unlinkTaskIds) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: unlinkedTaskId,
              action: CHANGE_ACTION.UPDATE,
              field: 'quoteId',
              oldValue: quoteSnapshot,
              newValue: null,
              userId,
              reason: 'Orçamento removido (exclusão do orçamento)',
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              transaction: tx,
            });
          }
        }

        await tx.budget.delete({ where: { id } });

        // Log the quote deletion itself
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldValue: quoteSnapshot,
          userId,
          reason: 'Exclusão de orçamento',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: userId,
          transaction: tx,
        });

        return result;
      });

      // Só depois do commit: `unlink` não faz rollback, e apagar os bytes antes
      // de o banco confirmar é exatamente como os envelopes órfãos dos
      // orçamentos #580-582 ficaram em ENOENT permanente.
      await this.signatureDeletion.unlinkFrozenDocuments(purged.frozenDocumentPaths);

      return {
        success: true,
        message: 'Orçamento deletado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error deleting task quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Erro ao deletar orçamento.');
    }
  }

  /**
   * Update quote status (approve/reject/cancel)
   */
  async updateStatus(
    id: string,
    status: TASK_QUOTE_STATUS,
    userId: string,
  ): Promise<BudgetUpdateResponse> {
    try {
      const existing = await this.budgetRepository.findById(id);

      if (!existing) {
        throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
      }

      // Validate status transition
      this.validateStatusTransition(existing.status as TASK_QUOTE_STATUS, status);

      // Liquidar deixou de ser um estado do ORÇAMENTO — quem liquida é a
      // COBRANÇA, e a liquidação manual mora em `PUT /billings/:id/settle`. Este
      // endpoint só move o ciclo do orçamento.
      await this.validateStatusPrerequisites(id, existing.status as TASK_QUOTE_STATUS, status);

      // ── VOLTAR A PENDENTE COM COBRANÇA VIVA DESFAZ SÓ A METADE ──────────────
      //
      // `status` está em `QUOTE_SAFE_AFTER_BILLING_FIELDS` — o ciclo do orçamento
      // PODE andar com a cobrança congelada, e isso está certo para cancelar (que
      // desce por `cancelForTaskCancellation`, com desmonte) e para aprovar. Mas
      // `APPROVED → PENDING` é a REPROVAÇÃO: ela devolve a proposta ao comercial
      // enquanto a fatura, o boleto no Sicredi e a NFS-e na prefeitura continuam
      // de pé. A tela passa a ler "Pendente", e `internalApprove` recusa as fatias
      // que ainda faltavam faturar — o orçamento fica preso entre dois estados.
      //
      // Quem desfaz cobrança é "Reverter Faturamento", que baixa o boleto e
      // cancela a nota antes. A frase diz isso, em vez de deixar o operador
      // descobrir pelo resultado.
      if (status === TASK_QUOTE_STATUS.PENDING) {
        const congeladas = await (this.prisma as any).billing.count({
          where: { quoteId: id, ...BILLING_FROZEN_WHERE },
        });
        if (congeladas > 0) {
          throw new BadRequestException(
            `Este orçamento tem ${congeladas} faturamento(s) já cobrado(s). Reverta o faturamento ` +
              'antes de devolver o orçamento a Pendente — a reversão dá baixa nos boletos e ' +
              'cancela as notas emitidas.',
          );
        }
      }

      // ── CANCELAR PASSA PELO DESMONTE, SEMPRE ─────────────────────────────
      //
      // Esta rota chamava `update(..., _internal = true)`, e é o `_internal` que
      // desarma a trava do dinheiro: `status` está em
      // `QUOTE_SAFE_AFTER_BILLING_FIELDS` (o ciclo do orçamento pode andar com a
      // cobrança congelada) e a segunda guarda — a que manda usar esta rota — só
      // dispara quando a chamada é externa. Resultado: um
      // `PUT /:id/status {CANCELLED}` carimbava CANCELADO num orçamento com
      // NFS-e AUTORIZADA na prefeitura e boletos REGISTRADOS no Sicredi, sem
      // tocar em nenhum dos dois. Os títulos seguiam pagáveis e a nota, ativa.
      //
      // `cancelForTaskCancellation` tem as guardas E o desmonte: exige artefato
      // confirmado antes de mexer, recusa com parcela PAGA (estorno é manual),
      // dá baixa nos boletos e confirma cada uma, cancela a NFS-e na Elotech,
      // apaga parcelas e faturas, zera o carimbo de cada faturamento e derruba a
      // cerimônia de assinatura em andamento. Sem dinheiro emitido, tudo isso é
      // no-op — e o caminho passa a ser UM só.
      //
      // O nome fala em tarefa por causa da origem (a cascata do cancelamento da
      // tarefa), mas ele não toca em tarefa nenhuma: só no orçamento e nos
      // artefatos dele. Por isso o motivo do changelog é parâmetro.
      if (status === TASK_QUOTE_STATUS.CANCELLED) {
        await this.cancelForTaskCancellation(id, userId, 'Orçamento cancelado pelo usuário');
        const cancelled = await this.budgetRepository.findById(id);
        return {
          success: true,
          data: cancelled as any,
          message: 'Orçamento cancelado com sucesso.',
        };
      }

      // Update status — pass _internal=true to bypass the external-call guard
      const updated = await this.update(id, { status }, userId, true);

      // Reconcile the "Em Negociação" COMMERCIAL ServiceOrder. Best-effort:
      // never throws into the caller's flow.
      await syncEmNegociacaoForQuote(this.prisma, id, userId);

      // Generic status route (PUT /:id/status) can advance a quote to the approval
      // state directly (bypassing budgetApprove). When that happens, notify the NEXT
      // approver (financial) that billing approval is pending. The dedicated approve
      // method emits its own *_approved key; this covers the generic path.
      if (status === TASK_QUOTE_STATUS.APPROVED) {
        await this.dispatchApprovalPendingNotification(id, status, userId);
      }

      return {
        success: true,
        data: updated.data,
        message: `Orçamento ${this.getStatusLabel(status)} com sucesso.`,
      };
    } catch (error: unknown) {
      this.logger.error(`Error updating quote status ${id}:`, error);
      throw error;
    }
  }

  /**
   * Settle a quote manually — auto-cancels open bank slips and marks all installments as PAID.
   * Used when payment was received via PIX, cash, or other non-boleto means.
   */
  /**
   * LIQUIDAÇÃO MANUAL — agora escopada à COBRANÇA.
   *
   * Era alcançada mandando `status: 'SETTLED'` para o endpoint de status do
   * ORÇAMENTO, e naquele desenho ela quitava tudo: num orçamento de sessenta
   * caminhões, liquidar o primeiro à mão marcava os sessenta como pagos, porque
   * o estado era um só. Com `billingId`, quita as parcelas daquela cobrança e de
   * nenhuma outra. Sem `billingId`, mantém o comportamento antigo (o orçamento
   * inteiro), que é o certo para o orçamento de fatura única.
   */
  async settleManually(quoteId: string, userId: string, billingId?: string | null): Promise<void> {
    // If this quote has no installments yet (e.g. BUDGET_APPROVED → SETTLED, skipping
    // BILLING_APPROVED), generate invoices+installments now so the settlement has a financial record.
    // ⚠️ ESTE ESCOPO TEM DE VALER EM TODAS AS CONSULTAS ABAIXO, não só na
    // primeira. Aplicá-lo só na pré-checagem foi o defeito: a checagem media a
    // cobrança e a liquidação varria o orçamento inteiro — marcando pagas as
    // parcelas das outras cobranças e CANCELANDO os boletos delas no Sicredi.
    // Num orçamento de sessenta caminhões, liquidar o primeiro dava baixa nos
    // duzentos e quarenta boletos.
    const configScope = billingId ? { quoteId, billingId } : { quoteId };
    const existingInstallmentCount = await this.prisma.installment.count({
      where: { customerConfig: configScope },
    });

    if (existingInstallmentCount === 0) {
      // Âncora na ordem canônica — ver `QUOTE_TASKS_ORDER_BY`.
      const task = await this.prisma.task.findFirst({
        where: { quoteId },
        select: { id: true, finishedAt: true },
        orderBy: QUOTE_TASKS_ORDER_BY,
      });

      // A linked task is required to generate the financial record. finishedAt is no
      // longer required — installment due dates anchor on now(), so a direct settle can
      // generate invoices before the task is finished.
      if (!task?.id) {
        throw new BadRequestException(
          'Não é possível liquidar este orçamento: nenhuma tarefa vinculada e ' +
            'não há parcelas a quitar.',
        );
      }

      // ⚠️ E A PRÉ-GERAÇÃO TAMBÉM É ESCOPADA. Sem `onlyConfigIds` ela criava
      // fatura e parcelas de TODOS os pagadores do orçamento — e o passo seguinte
      // as marcava pagas. Liquidar à mão uma cobrança sem parcelas quitava o
      // contrato inteiro, inventando o dinheiro que declarava recebido.
      const configsDaCobranca = await this.prisma.budgetPayer.findMany({
        where: configScope,
        select: { id: true },
      });
      const generatedInvoiceIds = await this.invoiceGenerationService.generateInvoicesForTask(
        task.id,
        userId,
        new Date(),
        {
          skipBankSlips: true,
          skipNfse: true,
          ...(billingId ? { onlyConfigIds: configsDaCobranca.map(c => c.id) } : {}),
        },
      );
      if (generatedInvoiceIds.length > 0) {
        this.logger.log(
          `[SETTLE_MANUALLY] Pre-generated ${generatedInvoiceIds.length} invoice(s) for quote ${quoteId} before settlement (no prior installments found).`,
        );
      }

      // Verify a real financial basis now exists. Generation can no-op (e.g. missing
      // paymentCondition/config) and leave zero installments — settling in that state
      // would mark the quote SETTLED with NO financial record. Block it.
      const installmentsAfterGen = await this.prisma.installment.count({
        where: { customerConfig: configScope },
      });
      if (installmentsAfterGen === 0) {
        throw new BadRequestException(
          'Não é possível liquidar este orçamento: nenhuma parcela foi gerada ' +
            '(condição de pagamento ausente ou inválida). Configure o faturamento antes de liquidar.',
        );
      }
    }

    // Track bank slips that need to be cancelled at Sicredi (after the local transaction commits)
    const slipsToCancelAtSicredi: Array<{ id: string; nossoNumero: string }> = [];

    // Track installments marked PAID in this settlement so we can emit bank_slip.paid
    // notifications AFTER the transaction commits (mirrors the webhook/reconciliation path).
    const paidNow: Array<{
      invoiceId: string | null;
      bankSlipId: string | null;
      amount: number;
      dueDate: Date;
    }> = [];

    await this.prisma.$transaction(async tx => {
      // Find all installments for this quote that aren't already PAID or CANCELLED
      const installments = await tx.installment.findMany({
        where: {
          customerConfig: configScope,
          status: { notIn: [INSTALLMENT_STATUS.PAID, 'CANCELLED' as any] },
        },
        include: {
          bankSlip: true,
        },
      });

      const now = new Date();

      for (const installment of installments) {
        // Cancel active/overdue bank slips locally; remote Sicredi cancellation is fired below.
        if (
          installment.bankSlip &&
          ![BANK_SLIP_STATUS.PAID, BANK_SLIP_STATUS.CANCELLED].includes(
            installment.bankSlip.status as BANK_SLIP_STATUS,
          )
        ) {
          await tx.bankSlip.update({
            where: { id: installment.bankSlip.id },
            data: { status: BANK_SLIP_STATUS.CANCELLED },
          });

          // Queue for Sicredi-side cancellation only if the boleto was actually registered
          // (nossoNumero is truthy and not a temporary placeholder like "TMP-<installmentId>").
          if (
            installment.bankSlip.nossoNumero &&
            !installment.bankSlip.nossoNumero.startsWith('TMP-')
          ) {
            slipsToCancelAtSicredi.push({
              id: installment.bankSlip.id,
              nossoNumero: installment.bankSlip.nossoNumero,
            });
          }
        }

        // Mark installment as PAID
        await tx.installment.update({
          where: { id: installment.id },
          data: {
            status: INSTALLMENT_STATUS.PAID,
            paidAmount: installment.amount,
            paidAt: now,
          },
        });

        paidNow.push({
          invoiceId: installment.invoiceId ?? null,
          bankSlipId: installment.bankSlip?.id ?? null,
          amount: Number(installment.amount),
          dueDate: installment.dueDate,
        });
      }

      // O ESTADO DAS FATURAS SAI DA REGRA ÚNICA, não de uma soma local.
      //
      // ⚠️ Era a SEXTA cópia da derivação — as outras cinco foram unificadas em
      // `deriveInvoicePaymentState` —, e ela errava no ponto que aquele arquivo
      // documenta: somava as parcelas CANCELADAS junto, e pelo VALOR DE FACE
      // (`paid > 0 ? paid : amount`). Três parcelas de R$ 5.000, a segunda
      // cancelada e nunca recebida: gravava `paidAmount = 15.000` e `PAID` com
      // R$ 10.000 de fato recebidos. A cascata logo em seguida relia as parcelas
      // pela regra certa e via PARCIAL — dois números sobre o mesmo dinheiro, e o
      // relatório escolhia um deles.
      //
      // Também não se força `PAID`: as parcelas acabaram de ser marcadas pagas
      // ACIMA, nesta mesma transação, então a regra chega a `PAID` sozinha quando
      // é o caso — e quando não é (uma fatura de outro pagador que o escopo
      // alcançou sem ter sido liquidada), ela diz a verdade em vez de mentir.
      const invoices = await tx.invoice.findMany({
        where: {
          customerConfig: configScope,
          status: { not: INVOICE_STATUS.CANCELLED },
        },
        include: {
          installments: { select: { status: true, paidAmount: true } },
        },
      });

      for (const invoice of invoices) {
        const derived = deriveInvoicePaymentState(invoice.installments);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: derived.status, paidAmount: derived.paidAmount },
        });
      }
    });

    // Fire Sicredi cancellations AFTER the local transaction commits.
    // We don't block the manual settlement on Sicredi failures — if the bank is down or rejects,
    // we persist the failure on the BankSlip.errorMessage so a future retry job (sicredi-boleto.scheduler)
    // can pick them up. The slip is already marked CANCELLED locally so the customer-facing UI is correct
    // even if the remote cancellation hasn't propagated yet.
    if (slipsToCancelAtSicredi.length > 0) {
      this.logger.log(
        `[SETTLE_MANUALLY] Firing Sicredi cancellation for ${slipsToCancelAtSicredi.length} bank slip(s) on quote ${quoteId}...`,
      );

      const results = await Promise.allSettled(
        slipsToCancelAtSicredi.map(slip =>
          this.sicrediService
            .cancelBoleto(slip.nossoNumero)
            .then(() => ({ slip, ok: true as const }))
            .catch(err => ({ slip, ok: false as const, err })),
        ),
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          // Should not happen since we catch above, but guard anyway.
          this.logger.error(
            `[SETTLE_MANUALLY] Unexpected promise rejection during Sicredi cancellation: ${result.reason}`,
          );
          continue;
        }

        const value = result.value as
          | { slip: { id: string; nossoNumero: string }; ok: true }
          | { slip: { id: string; nossoNumero: string }; ok: false; err: unknown };
        if (value.ok === true) {
          this.logger.log(
            `[SETTLE_MANUALLY] Sicredi cancellation OK for nossoNumero=${value.slip.nossoNumero}`,
          );
        } else {
          const err = value.err;
          const reason = err instanceof Error ? err.message : String(err ?? 'unknown error');
          this.logger.warn(
            `[SETTLE_MANUALLY] Sicredi cancellation FAILED for nossoNumero=${value.slip.nossoNumero}: ${reason}. ` +
              `Slip is CANCELLED locally; needs retry by sicredi-boleto scheduler.`,
          );

          // Persist failure on the slip so a retry job can pick it up. Schema has no dedicated
          // "needs cancellation retry" flag, so we encode it in errorMessage with a stable prefix.
          try {
            await this.prisma.bankSlip.update({
              where: { id: value.slip.id },
              data: {
                errorMessage: `Cancellation failed at Sicredi: ${reason}`,
              },
            });
          } catch (persistErr) {
            this.logger.error(
              `[SETTLE_MANUALLY] Failed to persist cancellation error on slip ${value.slip.id}: ${persistErr}`,
            );
          }
        }
      }
    }

    this.logger.log(
      `[SETTLE_MANUALLY] Quote ${quoteId} settled manually. All installments marked as PAID, open bank slips cancelled.`,
    );

    // Notify bank_slip.paid per installment settled (mirrors the Sicredi webhook path),
    // then task_quote.settled once for the whole quote. Best-effort — never breaks settlement.
    for (const paid of paidNow) {
      if (!paid.invoiceId) continue;
      await this.dispatchBankSlipPaidNotification(
        paid.invoiceId,
        paid.bankSlipId ?? paid.invoiceId,
        paid.amount,
        paid.dueDate,
      );
    }
    await this.dispatchBudgetSettledNotification(quoteId);
  }

  /**
   * Dispatch bank_slip.paid for a manually-settled installment. Mirrors the key +
   * payload + deep link used by the Sicredi webhook/reconciliation paths.
   * Best-effort — never breaks the settlement flow.
   */
  private async dispatchBankSlipPaidNotification(
    invoiceId: string,
    bankSlipId: string,
    paidAmount: number,
    dueDate: Date,
  ): Promise<void> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { fantasyName: true } },
          task: { select: { id: true, name: true, serialNumber: true } },
        },
      });
      if (!invoice) return;

      const customerName = invoice.customer?.fantasyName || 'N/A';
      const taskName = invoice.task?.name || 'N/A';
      const formattedAmount = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(Number(paidAmount));
      const formattedDueDate = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }).format(dueDate);

      // Billing detail pages (web AND the mobile faturamento screen) are keyed
      // by the TASK id, so build all links from it. The old `financial/:taskId`
      // mobile route was unparseable on mobile.
      // A fatura conjunta e o lote têm `taskId` NULO — o link ia para
      // `/detalhes/null`. `billingDeepLinkForInvoice` resolve pela COBERTURA.
      const billingLink = await billingDeepLinkForInvoice(this.prisma as any, invoice.id);
      const webUrl = billingLink.web;
      const mobileUrl = billingLink.mobile;
      const actionUrl = JSON.stringify({ web: webUrl, mobile: mobileUrl });

      await this.dispatchService.dispatchByConfiguration('bank_slip.paid', 'system', {
        entityType: 'Financial',
        entityId: invoice.id,
        action: 'paid',
        data: {
          customerName,
          taskName,
          paidAmount: formattedAmount,
          dueDate: formattedDueDate,
          invoiceId: invoice.id,
          bankSlipId,
          taskId: invoice.taskId,
        },
        overrides: {
          actionUrl,
          webUrl,
        },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao notificar pagamento de boleto (bank_slip.paid) para fatura ${invoiceId}:`,
        error,
      );
    }
  }

  /**
   * Dispatch task_quote.approval_pending to the next approver when a quote advances
   * to an approval state via the generic status route. Best-effort — never throws.
   */
  private async dispatchApprovalPendingNotification(
    quoteId: string,
    newStatus: TASK_QUOTE_STATUS,
    userId: string,
  ): Promise<void> {
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(quoteId);

      // After the budget is approved the only remaining approval is billing
      // (the separate commercial double-check step was removed).
      const nextStep = 'aprovação de faturamento';

      await this.dispatchService.dispatchByConfiguration('task_quote.approval_pending', userId, {
        entityType: 'Budget',
        entityId: taskId ?? quoteId,
        action: 'approval_pending',
        data: { quoteLabel, nextStep },
        overrides: {
          title: 'Aprovação Pendente',
          body: `O orçamento ${quoteLabel} aguarda ${nextStep}.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        'Falha ao notificar aprovação pendente (task_quote.approval_pending):',
        error,
      );
    }
  }

  /**
   * Dispatch task_quote.settled when a quote is settled manually.
   * Best-effort — never breaks the settlement flow.
   */
  private async dispatchBudgetSettledNotification(quoteId: string): Promise<void> {
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(quoteId);
      await this.dispatchService.dispatchByConfiguration('task_quote.settled', 'system', {
        entityType: 'Budget',
        entityId: taskId ?? quoteId,
        action: 'settled',
        data: { quoteLabel },
        overrides: {
          title: 'Pagamento Liquidado',
          body: `O orçamento ${quoteLabel} foi totalmente liquidado. Todas as parcelas estão pagas.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar liquidação de orçamento (task_quote.settled):', error);
    }
  }

  /**
   * TODOS OS RESPONSÁVEIS DO CLIENTE ASSINARAM. Falta a contra-assinatura da Ankaa.
   *
   * Chamado pela cerimônia (`setOnCustomerSideSigned`), nunca por rota. Escreve
   * `SIGNED`, que é o estado que a lista de Orçamentos usa para responder à
   * pergunta "o que está parado esperando a gente?".
   *
   * POR QUE O ESTADO PRECISAVA EXISTIR
   *   Entre a assinatura do cliente e a nossa podem passar dias — o cliente
   *   assina na sexta à noite, quem contra-assina volta na segunda. Nesse
   *   intervalo o orçamento era `PENDING`, exatamente igual a um criado naquela
   *   manhã e ainda não enviado. Quem abria a lista para achar o que travou não
   *   tinha como distinguir "o cliente nem viu" de "só falta a nossa caneta".
   *
   * NÃO USA `updateStatus`: a máquina de transição é um catálogo de mudanças
   * MANUAIS, e esta não é uma. Vai pelo `update(..., _internal: true)`, como o
   * cascateamento de parcelas.
   */
  async markSigned(quoteId: string, userId: string = 'system'): Promise<void> {
    const existing = await this.prisma.budget.findUnique({
      where: { id: quoteId },
      select: { status: true },
    });
    if (!existing) return;

    // SÓ DE PENDING.
    //
    // Um orçamento já aprovado, faturado ou cancelado não volta para "assinado"
    // porque uma assinatura atrasada chegou: `APPROVED` é posterior a este
    // estado, e regredir apagaria a aprovação. Cancelado, então, é pior —
    // reviveria na lista de quem vende um negócio que morreu.
    if (existing.status !== TASK_QUOTE_STATUS.PENDING) {
      this.logger.log(
        `Orçamento ${quoteId} não foi marcado como assinado: está em ${existing.status}.`,
      );
      return;
    }

    await this.update(quoteId, { status: TASK_QUOTE_STATUS.SIGNED }, userId, true);

    await syncEmNegociacaoForQuote(this.prisma, quoteId, userId);

    // O aviso de contra-assinatura para QUEM ASSINA pela Ankaa sai da própria
    // cerimônia (`notifyAnkaaSigner`, com link). Este é o aviso de SETOR: o
    // comercial e a administração precisam ver na lista de notificações que há
    // um orçamento fechado do lado do cliente esperando a nossa assinatura.
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(quoteId);
      await this.dispatchService.dispatchByConfiguration('task_quote.signed', userId, {
        entityType: 'Budget',
        entityId: taskId ?? quoteId,
        action: 'signed',
        data: { quoteLabel },
        overrides: {
          title: 'Orçamento Assinado pelo Cliente',
          body: `O orçamento ${quoteLabel} foi assinado por todos os responsáveis do cliente e aguarda a contra-assinatura da Ankaa.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar orçamento assinado (task_quote.signed):', error);
    }
  }

  /**
   * A VALIDADE VENCEU SEM TODAS AS ASSINATURAS.
   *
   * Chamado pela varredura de expiração (`setOnEnvelopeExpired`). O orçamento
   * vai para `EXPIRED` — rotulado "Aguardando Reanálise" — e o comercial é
   * avisado de que há um valor para rever.
   *
   * O DEFEITO QUE ISTO FECHA
   *   `SignatureEnvelope` expirava de hora em hora desde sempre; o ORÇAMENTO
   *   nunca. Ele ficava PENDING para sempre, misturado aos recém-criados em toda
   *   lista, filtro e relatório, e ninguém era avisado. Na prática a validade era
   *   um texto no PDF: impedia assinar (`assertSignable`) e não movia mais nada.
   *
   * SÓ DE PENDING, pelas mesmas razões de `markSigned` — com uma a mais: um
   * orçamento em `SIGNED` não chega aqui porque a varredura o exclui de
   * propósito (o cliente aceitou dentro do prazo; o que falta é nosso).
   */
  async markExpiredBySignature(quoteId: string, userId: string = 'system'): Promise<void> {
    const existing = await this.prisma.budget.findUnique({
      where: { id: quoteId },
      select: { status: true, expiresAt: true },
    });
    if (!existing) return;

    if (existing.status !== TASK_QUOTE_STATUS.PENDING) {
      this.logger.log(
        `Orçamento ${quoteId} não foi marcado como vencido: está em ${existing.status}.`,
      );
      return;
    }

    await this.update(quoteId, { status: TASK_QUOTE_STATUS.EXPIRED }, userId, true);

    await syncEmNegociacaoForQuote(this.prisma, quoteId, userId);

    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(quoteId);
      const expiredOn = existing.expiresAt.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      });
      await this.dispatchService.dispatchByConfiguration('task_quote.expired', userId, {
        entityType: 'Budget',
        entityId: taskId ?? quoteId,
        action: 'expired',
        data: { quoteLabel, expiredOn },
        overrides: {
          title: 'Orçamento Vencido — Reanalisar',
          body: `A validade do orçamento ${quoteLabel} venceu em ${expiredOn} sem todas as assinaturas. Revise o valor e reemita a proposta.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar orçamento vencido (task_quote.expired):', error);
    }
  }

  /**
   * O CLIENTE RECUSOU E NÃO SOBROU NINGUÉM DO LADO DELE PARA ASSINAR.
   *
   * Gêmeo de `markExpiredBySignature`, e pelo mesmo raciocínio: a cerimônia sabe
   * que a coleta morreu, e só o dono do orçamento sabe o que isso significa para
   * o estado dele. Sem ouvinte registrado o envelope ia a `REFUSED` e o orçamento
   * ficava em `PENDING` — 9 assim no acervo, indistinguíveis de um orçamento
   * criado naquela manhã, na mesma lista e na mesma cor.
   *
   * ⚠️ O DESTINO É `EXPIRED` ("Aguardando Reanálise"), e não um estado
   * "recusado". Não existe estado de recusa, e criar um seria duplicar o que
   * `EXPIRED` já significa: a proposta parou, o valor volta para o comercial
   * rever. É exatamente para onde o vencimento aponta, e a recusa é a mesma
   * situação chegando por outra porta — com a vantagem de trazer um MOTIVO.
   *
   * ⚠️ VIA `update(..., _internal = true)`, não `updateStatus`: `PENDING →
   * EXPIRED` não está na lista de transições MANUAIS, e não deve estar — ninguém
   * digita "vencido". `markExpiredBySignature` faz igual, pela mesma razão.
   *
   * @param reason O motivo que o cliente escreveu. É a única informação que a
   *   recusa acrescenta: sem ele, quem recebe o aviso sabe que parou e não sabe o
   *   que negociar.
   */
  async markRefusedBySignature(
    quoteId: string,
    reason: string,
    userId: string = 'system',
  ): Promise<void> {
    const existing = await this.prisma.budget.findUnique({
      where: { id: quoteId },
      select: { status: true },
    });
    if (!existing) return;

    // SÓ DE PENDING — a mesma guarda do vencimento. Um orçamento já aprovado,
    // faturado ou cancelado não regride porque uma recusa atrasada chegou.
    if (existing.status !== TASK_QUOTE_STATUS.PENDING) {
      this.logger.log(
        `Orçamento ${quoteId} não foi marcado para reanálise após a recusa: está em ${existing.status}.`,
      );
      return;
    }

    await this.update(quoteId, { status: TASK_QUOTE_STATUS.EXPIRED }, userId, true);

    await syncEmNegociacaoForQuote(this.prisma, quoteId, userId);

    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(quoteId);
      const motivo = reason?.trim() || 'sem motivo informado';
      await this.dispatchService.dispatchByConfiguration('task_quote.refused', userId, {
        entityType: 'Budget',
        entityId: taskId ?? quoteId,
        action: 'refused',
        data: { quoteLabel, reason: motivo },
        overrides: {
          title: 'Orçamento Recusado — Reanalisar',
          body: `O cliente recusou o orçamento ${quoteLabel}. Motivo: ${motivo}. Revise o valor e reemita a proposta.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error('Falha ao notificar orçamento recusado (task_quote.refused):', error);
    }
  }

  /**
   * AS ASSINATURAS CAÍRAM PORQUE O ORÇAMENTO MUDOU — ele volta para pendente.
   *
   * Um orçamento APROVADO ou ASSINADO afirma que alguém concordou com AQUELE
   * documento. Quando uma alteração material derruba a coleta, o documento
   * aceito deixou de existir — e o status ficava de pé. A tela mostrava
   * "Aprovado" ao lado do aviso "as assinaturas foram invalidadas porque o
   * orçamento mudou": duas frases contraditórias no mesmo cartão, e a de cima
   * era a que o resto do sistema lia.
   *
   * ⚠️ POR QUE NÃO BASTAVA O AUTO-REVERT QUE JÁ EXISTIA em `update()`: aquele
   * dispara por `hasValueAffectingChange` — lista de serviços e campos de
   * dinheiro do pagador. Trocar o LAYOUT não mexe em valor nenhum e mesmo assim
   * é material para a assinatura: é a imagem que o cliente aprovou. Foi
   * exatamente o nº 973, em 17/09/2026. As duas regras convivem porque
   * respondem a perguntas diferentes — "o preço mudou?" e "o documento aceito
   * mudou?" — e esta segunda tem a autoridade certa, que é o próprio motor de
   * assinatura dizendo que invalidou.
   *
   * A LISTA DE ESTADOS É A MESMA (`QUOTE_VALUE_REVERTABLE_STATUSES`), de
   * propósito: o destino é o mesmo, só o gatilho difere. Duas listas para a
   * mesma regra divergiriam na primeira edição.
   *
   * ⚠️ NÃO REVERTE COM O DINHEIRO TRAVADO. Uma cobrança aprovada tem NFS-e na
   * prefeitura e boleto no Sicredi emitidos contra este orçamento; devolvê-lo a
   * PENDENTE afirmaria que nada foi acordado enquanto os títulos seguem
   * pagáveis. Aí a saída é `revertBilling`, que desmonta os artefatos, e o log
   * sai como aviso porque é uma situação que alguém precisa olhar.
   *
   * Sem recursão: `update` reavalia as assinaturas ao final, mas o envelope já
   * é `INVALIDATED` quando esta linha roda, e `onQuoteContentChanged` só procura
   * `RUNNING` e `COMPLETED`.
   */
  async markInvalidatedBySignature(
    quoteId: string,
    reason: string,
    userId: string = 'system',
  ): Promise<void> {
    const existing = await this.prisma.budget.findUnique({
      where: { id: quoteId },
      select: { status: true, ...QUOTE_MONEY_LOCK_INCLUDE },
    });
    if (!existing) return;

    const currentStatus = existing.status as TASK_QUOTE_STATUS;
    if (!QUOTE_VALUE_REVERTABLE_STATUSES.includes(currentStatus)) {
      this.logger.log(
        `Orçamento ${quoteId} seguiu em ${currentStatus} após a invalidação das assinaturas: ` +
          'o estado não regride a partir daí.',
      );
      return;
    }

    if (isQuoteMoneyLocked(existing.billings)) {
      this.logger.warn(
        `Orçamento ${quoteId} teve as assinaturas invalidadas mas CONTINUA em ${currentStatus}: ` +
          'há cobrança aprovada. Reverta o faturamento antes de reemitir a proposta.',
      );
      return;
    }

    await this.update(quoteId, { status: TASK_QUOTE_STATUS.PENDING }, userId, true);

    await syncEmNegociacaoForQuote(this.prisma, quoteId, userId);

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_QUOTE,
      entityId: quoteId,
      action: CHANGE_ACTION.ROLLBACK,
      field: 'status',
      oldValue: currentStatus,
      newValue: TASK_QUOTE_STATUS.PENDING,
      // O motivo do motor de assinatura, palavra por palavra: é a mesma frase
      // que o signatário recebeu por e-mail e que a tela mostra. Reescrevê-la
      // aqui faria a trilha e o aviso contarem histórias parecidas mas
      // diferentes sobre o mesmo ato.
      reason: `Assinaturas invalidadas — ${reason}`,
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
      triggeredById: userId,
      userId,
    });

    this.logger.log(
      `Orçamento ${quoteId} voltou de ${currentStatus} para PENDENTE: as assinaturas foram invalidadas.`,
    );
  }

  /**
   * Commercial approves the budget.
   *
   * This is the single commercial approval gate. Once the budget is approved
   * (blue "Orçamento Aprovado" badge) the commercial sector is done — there is
   * no separate second commercial double-check. From this state financial can
   * approve billing directly, regardless of whether the task is finished yet.
   */
  async budgetApprove(id: string, userId: string): Promise<BudgetUpdateResponse> {
    // Required-layout gate: a budget can only be approved once an approved layout
    // (Budget.layoutFiles) has been selected in Step 2. This gates ONLY the
    // manual commercial approval; the automated Em Negociação auto-approval path
    // writes the status directly (service-order.service) and is intentionally not
    // subject to this gate.
    const quoteForGate = await this.prisma.budget.findUnique({
      where: { id },
      select: { layoutFiles: { select: { id: true } } },
    });
    if (!quoteForGate || (quoteForGate.layoutFiles || []).length === 0) {
      throw new BadRequestException('Selecione um layout aprovado antes de aprovar o orçamento.');
    }

    const result = await this.updateStatus(id, TASK_QUOTE_STATUS.APPROVED, userId);

    // Budget approved -> notify financial that billing can now be approved.
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(id);
      await this.dispatchService.dispatchByConfiguration('task_quote.budget_approved', userId, {
        entityType: 'Budget',
        entityId: taskId ?? id,
        action: 'budget_approved',
        data: { quoteLabel },
        overrides: {
          title: 'Orçamento Aprovado', // o EVENTO, não o nome do estado (que agora é só "Aprovado")
          body: `O orçamento ${quoteLabel} foi aprovado e já está pronto para aprovação de faturamento.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(taskId
            ? {
                webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
              }
            : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        'Falha ao notificar aprovação de orçamento (task_quote.budget_approved):',
        error,
      );
    }

    return result;
  }

  /** Best-effort human label for a quote — uses the linked task serial/name when
   *  available, falling back to the short quote id. Also returns the linked task
   *  id so notification deep links (keyed by taskId) can be built. Never throws. */
  private async buildQuoteLabel(
    quoteId: string,
  ): Promise<{ label: string; taskId: string | null }> {
    try {
      // Âncora na ordem canônica: o rótulo do orçamento e o deep link das
      // notificações precisam citar sempre o MESMO veículo.
      const task = await this.prisma.task.findFirst({
        where: { quoteId },
        select: { id: true, name: true, serialNumber: true },
        orderBy: QUOTE_TASKS_ORDER_BY,
      });
      if (task?.serialNumber) {
        return {
          label: task.name ? `#${task.serialNumber} (${task.name})` : `#${task.serialNumber}`,
          taskId: task.id,
        };
      }
      if (task?.name) return { label: task.name, taskId: task.id };
      if (task?.id) return { label: quoteId.slice(-8).toUpperCase(), taskId: task.id };
    } catch {
      // ignore — fall through to id
    }
    return { label: quoteId.slice(-8).toUpperCase(), taskId: null };
  }

  /**
   * Manually reconcile the "Em Negociação" SO for the task tied to this quote.
   * Recovery path: a task can land in a stuck state if a status change happened
   * before the sync logic existed (or before a bug fix). This endpoint replays
   * the reconciliation without requiring a status transition.
   */
  async syncEmNegociacao(id: string, userId: string): Promise<{ success: true; message: string }> {
    const tasks = await this.prisma.task.findMany({
      where: { quoteId: id },
      select: { id: true },
    });
    if (tasks.length === 0) {
      throw new NotFoundException(`Tarefa para o orçamento ${id} não encontrada.`);
    }
    // TODAS as tarefas do orçamento — é justamente o conserto que este endpoint
    // de recuperação existe para aplicar nos orçamentos que ficaram tortos.
    await syncEmNegociacaoForQuote(this.prisma, id, userId);
    return {
      success: true,
      message:
        tasks.length === 1
          ? 'Em Negociação reconciliada.'
          : `Em Negociação reconciliada em ${tasks.length} tarefas.`,
    };
  }

  /**
   * Commercial/admin final approval — triggers invoice + NFS-e generation
   */
  /**
   * Aprovação do faturamento — a que emite fatura, NFS-e e boletos.
   *
   * @param sliceTaskId  A FATIA a faturar, quando o orçamento cobra veículo a
   *   veículo (`billingSplit = PER_TASK`). Omitido fatura TUDO o que ainda não
   *   foi faturado, que é o comportamento de `JOINT` — onde existe uma fatia só —
   *   e é também o "faturar os sessenta de uma vez".
   *
   * COMO O ESTADO SE MOVE COM FATIAS
   *   Os sessenta caminhões do Marquespan não terminam no mesmo dia, então o
   *   orçamento passa meses parcialmente faturado. O STATUS DO ORÇAMENTO não
   *   descreve isso e não tenta: ele entra em `APPROVED` e fica. Quem tem ciclo
   *   de pagamento é a COBRANÇA — `Billing.status`, escrito só por
   *   `BillingStatusCascadeService` a partir das parcelas —, e é por isso que
   *   uma fatia paga e outra vencida no mesmo orçamento são duas linhas com dois
   *   estados. (`BILLING_APPROVED`/`UPCOMING`/`DUE`/`PARTIAL` como status de
   *   orçamento não existem mais.)
   *
   *   `Budget.billingApprovedAt` só é gravado quando o ÚLTIMO faturamento
   *   fecha — é ele que significa "este orçamento está inteiramente faturado", e
   *   `Billing.approvedAt` responde faturamento a faturamento.
   */
  /**
   * Quantas cobranças deste orçamento ainda não foram aprovadas.
   *
   * Existe para a rota "aprovar tudo" saber se há o que desambiguar: com UMA
   * pendente, aprovar tudo e aprovar aquela são o mesmo ato.
   */
  async countPendingBillings(quoteId: string): Promise<number> {
    // ⚠️ PENDENTE É O QUE NÃO ESTÁ CONGELADO — e congelado não é só ter carimbo.
    //
    // `approvedAt: null` sozinho conta como pendente a cobrança LIQUIDADA POR
    // CONCILIAÇÃO, que nunca teve fatura de onde derivar a data (orçamentos 34,
    // 216, 287, 347, 351 e 309 do acervo). O contador alimenta o "aprovar tudo",
    // então a conta mentia e a aprovação tentava refaturar dinheiro já recebido.
    // `BILLING_FROZEN_WHERE` é `isBillingApproved` em SQL — os dois braços que a
    // linha do `Billing` responde, que é o que "pendente para aprovar" quer dizer.
    return (this.prisma as any).billing.count({
      where: { quoteId, NOT: BILLING_FROZEN_WHERE },
    });
  }

  async internalApprove(
    id: string,
    userId: string,
    sliceTaskId?: string | null,
    /**
     * O FATURAMENTO a aprovar, pelo id dele.
     *
     * É o endereçamento próprio, e tem precedência sobre `sliceTaskId`: um
     * faturamento é uma entidade, e apontar para ela não depende de escolher um
     * de seus veículos como representante. `sliceTaskId` continua aceito porque
     * o app e os links antigos ainda endereçam por veículo.
     */
    billingId?: string | null,
  ): Promise<BudgetUpdateResponse> {
    this.logger.log(
      `[INTERNAL_APPROVE] Starting internal approval for quote ${id} by user ${userId}` +
        (billingId
          ? ` (faturamento ${billingId})`
          : sliceTaskId
            ? ` (fatia da tarefa ${sliceTaskId})`
            : ''),
    );

    // 1. Validate the quote exists and prerequisites are met
    const existing = await this.budgetRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Orçamento com ID ${id} não encontrado.`);
    }

    // ── OS FATURAMENTOS DESTE ORÇAMENTO ───────────────────────────────────────
    //
    // A pergunta é feita ao FATURAMENTO, não ao pagador. Antes eram os pagadores
    // que carregavam `billingApprovedAt`, e com dois pagadores do mesmo recorte
    // havia duas datas para um evento só — sempre escritas juntas pelo mesmo
    // `updateMany`, porque o evento sempre foi um.
    const quoteBillings = (await (this.prisma as any).billing.findMany({
      where: { quoteId: id },
      select: {
        id: true,
        approvedAt: true,
        // ⚠️ O ESTADO VEM JUNTO, e não é enfeite: há cobrança LIQUIDADA sem
        // carimbo (conciliação bancária, sem fatura de onde derivar a data). Sem
        // `status` no select, `isBillingApproved` responderia pelo carimbo apenas —
        // que é exatamente a cegueira que fazia "Aprovar" emitir NFS-e e boleto
        // novos sobre dinheiro já recebido.
        status: true,
        tasks: { select: { taskId: true } },
        customerConfigs: { select: { id: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    })) as Array<{
      id: string;
      approvedAt: Date | null;
      status: string | null;
      tasks: Array<{ taskId: string }>;
      customerConfigs: Array<{ id: string }>;
    }>;

    // Alvo desta aprovação, em três endereçamentos possíveis:
    //
    //   · POR FATURAMENTO (`billingId`) — o endereço próprio, e o que a tela nova
    //     usa: `/financeiro/faturamento/:billingId` aprova aquela cobrança e
    //     nenhuma outra, sem ambiguidade nenhuma.
    //   · POR VEÍCULO (`sliceTaskId`) — o endereçamento anterior, mantido porque
    //     o app e os links antigos ainda o usam. A pergunta é de COBERTURA, não
    //     de igualdade: aprovar o caminhão 37 fecha o faturamento do lote 21–60,
    //     porque é ele que cobra o 37 — e fecha os quarenta de uma vez, que é o
    //     que o lote significa.
    //   · SEM ENDEREÇO — todos os faturamentos ainda pendentes. É o "faturar os
    //     sessenta de uma vez".
    const targetBillings = quoteBillings.filter(b => {
      // Já aprovada não entra — nem por carimbo, nem por ESTADO pós-aprovação. É
      // `isBillingApproved`, os dois braços que a linha do `Billing` responde, e
      // usá-lo aqui é o que impede reaprovar uma cobrança liquidada por
      // conciliação. NÃO é `isBillingFrozen`: o terceiro braço daquele ("tem
      // fatura viva") transformaria o resíduo de uma aprovação que falhou no meio
      // — fatura viva, carimbo levantado — em cobrança inaprovável, que é
      // exatamente o beco que a pessoa precisa sair clicando "Aprovar" de novo.
      if (isBillingApproved(b)) return false;
      if (billingId) return b.id === billingId;
      if (!sliceTaskId) return true;
      // Faturamento sem cobertura é o orçamento que nasceu antes do vínculo das
      // tarefas: não há o que restringir, e recusá-lo deixaria a aprovação sem
      // fatura nenhuma.
      if (b.tasks.length === 0) return true;
      return b.tasks.some(row => row.taskId === sliceTaskId);
    });

    const targetConfigs = targetBillings.flatMap(b => b.customerConfigs);

    if (targetBillings.length === 0) {
      const jaAprovado =
        billingId && quoteBillings.some(b => b.id === billingId && isBillingApproved(b));
      if (billingId && !jaAprovado) {
        throw new NotFoundException(`Faturamento ${billingId} não pertence ao orçamento ${id}.`);
      }
      throw new BadRequestException(
        billingId
          ? 'Este faturamento já foi aprovado.'
          : sliceTaskId
            ? 'Este veículo já teve o faturamento aprovado.'
            : 'Todas as fatias deste orçamento já tiveram o faturamento aprovado.',
      );
    }

    if (targetConfigs.length === 0) {
      throw new BadRequestException(
        'Este faturamento não tem nenhum pagador — não há o que faturar. ' +
          'Defina quem recebe a cobrança antes de aprovar.',
      );
    }

    // ── A GUARDA DE STATUS ────────────────────────────────────────────────────
    //
    // UMA regra agora, e a mesma para a primeira fatia e para a sexagésima: só se
    // fatura orçamento APROVADO.
    //
    // Antes eram duas, e a segunda existia só para contornar a primeira. Aprovar
    // faturamento era uma TRANSIÇÃO do orçamento (BUDGET_APPROVED →
    // BILLING_APPROVED), então a segunda fatia encontrava o orçamento fora de
    // BUDGET_APPROVED e era recusada com "o orçamento não está mais no status
    // Orçamento Aprovado" — verdade e irrelevante. O contorno era uma lista dos
    // estados de cobrança em que faturar de novo era aceitável.
    //
    // Com o estado do pagamento no `Billing`, o orçamento fica em APPROVED e não
    // sai de lá. A pergunta "posso faturar?" volta a ser sobre o orçamento, e a
    // pergunta "esta cobrança já foi faturada?" é do `Billing.approvedAt`, logo
    // abaixo, no claim.
    const isFirstApproval = quoteBillings.every(b => !b.approvedAt);
    if ((existing.status as TASK_QUOTE_STATUS) !== TASK_QUOTE_STATUS.APPROVED) {
      throw new BadRequestException(
        `Não é possível faturar um orçamento em "${this.getStatusLabel(
          existing.status as TASK_QUOTE_STATUS,
        )}". Aprove o orçamento antes de aprovar o faturamento.`,
      );
    }

    // ── E A COLETA DE ASSINATURAS AINDA VALE? ────────────────────────────────
    //
    // O status do orçamento NÃO responde isso, e é aqui que a diferença aparece.
    // A guarda que conhece a assinatura mora na transição `→ APPROVED`
    // (`validateStatusPrerequisites`) — e ela é pulada exatamente onde importa:
    // `markInvalidatedBySignature` NÃO devolve a PENDENTE um orçamento com
    // dinheiro travado (só emite um aviso no log, de propósito, porque há NFS-e
    // e boleto na rua). Então o orçamento permanece APPROVED, nenhuma transição
    // acontece, e a guarda nunca roda de novo.
    //
    // O caso que abriu isto: orçamento PER_TASK de 60 veículos, lote 1 aprovado
    // (dinheiro travado). Trocam o layout → envelope INVALIDATED → o orçamento
    // continua APPROVED → os lotes 2..60 seguem aprováveis, cada um emitindo
    // nota municipal e boleto contra um contrato cujas assinaturas foram
    // anuladas. Faturar é ATO NOVO, e cada ato novo precisa perguntar de novo.
    //
    // RUNNING também barra: uma coleta EM ANDAMENTO é o orçamento dizendo que
    // ainda está colhendo a aceitação: emitir nota no meio da cerimônia fatura
    // um contrato que ninguém terminou de aceitar.
    //
    // SÓ MORDE QUEM TEVE COLETA. Orçamento que nunca foi à assinatura — a maioria
    // — não tem envelope nenhum e continua faturável como hoje.
    const ultimoEnvelope = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId: id },
      orderBy: { createdAt: 'desc' },
      select: { status: true, invalidatedReason: true },
    });
    if (
      ultimoEnvelope &&
      (ultimoEnvelope.status === 'INVALIDATED' ||
        ultimoEnvelope.status === 'REFUSED' ||
        ultimoEnvelope.status === 'RUNNING')
    ) {
      const motivo =
        ultimoEnvelope.status === 'INVALIDATED'
          ? 'As assinaturas deste orçamento foram invalidadas por uma alteração' +
            (ultimoEnvelope.invalidatedReason
              ? ` (${ultimoEnvelope.invalidatedReason.replace(/^Alteração em:\s*/, '')})`
              : '') +
            '.'
          : ultimoEnvelope.status === 'REFUSED'
            ? 'A coleta de assinaturas deste orçamento foi RECUSADA pelo cliente.'
            : 'A coleta de assinaturas deste orçamento ainda está em andamento.';
      throw new BadRequestException(
        `${motivo} Não é possível emitir nota fiscal e boleto contra um contrato sem aceitação ` +
          'válida. Conclua (ou reemita) a assinatura antes de aprovar o faturamento.',
      );
    }
    // Os pré-requisitos da COBRANÇA — condição de pagamento, dados do pagador,
    // valor a cobrar.
    //
    // ⚠️ DUAS CORREÇÕES NESTA CHAMADA.
    //
    // (1) ESCOPO. A verificação era do ORÇAMENTO inteiro: aprovar o lote 1 era
    //     recusado por um CEP faltando no pagador do lote 3 — um erro que não se
    //     podia obedecer sem mexer em quem não estava sendo faturado. Agora ela
    //     olha só os pagadores DESTA aprovação.
    //
    // (2) FREQUÊNCIA. Rodava só `if (isFirstApproval)`, com o argumento de que as
    //     fatias seguintes herdavam um conjunto já conferido. Não herdam: entre a
    //     primeira e a segunda aprovação a tela edita pagador, troca condição de
    //     pagamento e acrescenta cliente. Da segunda em diante NADA era validado
    //     — é o que deixava uma cobrança ser aprovada com pagador que a geração
    //     não sabe faturar.
    await this.validateBillingApprovalPrerequisites(
      id,
      targetConfigs.map(c => c.id),
    );

    // Capture billing approval time now — used as the base date for installment due date calculation.
    // "First payment in N days" counts from this moment, not from task.finishedAt.
    const approvalDate = new Date();

    // O orçamento estará INTEIRAMENTE faturado ao fim desta aprovação?
    // ⚠️ NÃO calcule aqui se esta aprovação FECHA o orçamento.
    //
    // A conta óbvia — "os alvos são todos os que faltavam" — é lida ANTES do claim,
    // e duas aprovações simultâneas de cobranças DIFERENTES do mesmo orçamento leem
    // as duas o mesmo "faltam dois". As duas concluem que não fecham, as duas
    // gravam o seu carimbo, e o orçamento termina INTEIRAMENTE faturado com
    // `billingApprovedAt` nulo — o carimbo do contrato se perde sem que nenhuma das
    // duas tenha errado. É janela estreita (exige simultaneidade real), mas o
    // prejuízo é silencioso: `avgSalesCycleDays` e os filtros por período de
    // faturamento passam a ignorar aquele contrato para sempre.
    //
    // A pergunta é respondida DEPOIS do claim, contando quem sobrou — e aí a
    // resposta é a mesma independentemente da ordem em que as duas terminem.
    const fechaOOrcamento = async (): Promise<boolean> =>
      (await (this.prisma as any).billing.count({
        where: { quoteId: id, approvedAt: null },
      })) === 0;

    const pedidos = targetBillings.map(b => b.id);

    // 2. Claim ATÔMICO da transição.
    //
    // O CLAIM É DA COBRANÇA, sempre — inclusive na primeira. Antes a primeira
    // aprovação reivindicava o STATUS DO ORÇAMENTO e as seguintes reivindicavam o
    // carimbo da fatia: duas condições de corrida diferentes para o mesmo evento,
    // e a primeira protegia a coisa errada (duas requisições aprovando
    // faturamentos DIFERENTES do mesmo orçamento disputavam um campo que não era
    // de nenhuma das duas).
    //
    // ⚠️ UMA COBRANÇA POR VEZ, e o resultado É a lista do que se ganhou.
    //
    // Era um `updateMany` sobre todos os alvos que só recusava `count === 0`.
    // Com alvos SOBREPOSTOS (duas chamadas sem endereço, ou uma sem endereço e
    // outra por veículo) o claim PARCIAL passava: a chamada seguia adiante
    // gerando fatura, nota e boleto para `targetBillingIds` INTEIROS — inclusive
    // a cobrança que a outra requisição acabara de reivindicar. E o desfazer
    // identificava "o que esta tentativa carimbou" por `approvedAt: approvalDate`
    // — um instante de milissegundo que duas chamadas simultâneas compartilham,
    // de modo que o rollback de uma levantava o carimbo da outra. Provado em 14
    // rodadas: 2 terminaram com cobrança tendo fatura e boleto VIVOS e
    // `approvedAt` NULO.
    //
    // Reivindicando uma a uma, `count === 1` é prova de posse daquela linha, e a
    // LISTA das ganhas — não um timestamp — é o token do desfazer. O escopo desta
    // aprovação passa a ser exatamente o que ela reivindicou: quem perdeu uma
    // cobrança para outra requisição simplesmente não a fatura, e quem ganhou a
    // fatura uma vez só.
    const targetBillingIds: string[] = [];
    for (const candidato of pedidos) {
      const ganho = await (this.prisma as any).billing.updateMany({
        where: { id: candidato, approvedAt: null },
        data: { approvedAt: approvalDate },
      });
      if (ganho.count === 1) targetBillingIds.push(candidato);
    }
    if (targetBillingIds.length === 0) {
      throw new BadRequestException(
        'Este faturamento já foi aprovado por outra requisição simultânea.',
      );
    }
    if (targetBillingIds.length < pedidos.length) {
      this.logger.warn(
        `[INTERNAL_APPROVE] ${pedidos.length - targetBillingIds.length} de ${pedidos.length} ` +
          `cobrança(s) do orçamento ${id} já haviam sido reivindicadas por outra requisição — ` +
          'esta aprovação segue apenas com as que ganhou.',
      );
    }
    // O escopo da GERAÇÃO segue o claim, não o pedido: faturar um pagador de uma
    // cobrança que esta chamada não reivindicou emitiria a segunda nota fiscal do
    // mesmo serviço.
    const claimedBillings = targetBillings.filter(b => targetBillingIds.includes(b.id));
    const claimedConfigs = claimedBillings.flatMap(b => b.customerConfigs);
    // `Budget.billingApprovedAt` significa "orçamento INTEIRAMENTE faturado" —
    // e continua sendo do orçamento, porque é sobre o contrato, não sobre uma
    // cobrança. Num orçamento de sessenta caminhões ele é gravado quando o
    // sexagésimo fecha.
    if (await fechaOOrcamento()) {
      await this.prisma.budget.update({
        where: { id },
        data: { billingApprovedAt: approvalDate } as any,
      });
    }

    // Emissão de fatura, NFS-e e boleto. Se qualquer coisa falhar, o `catch`
    // levanta os carimbos DESTA tentativa (ver ali) — o status do orçamento não
    // se move, porque aprovar cobrança deixou de mexer nele.
    try {
      // A tarefa de ENTRADA da geração: a fatia pedida quando há uma, senão a
      // primeira do orçamento. Ela serve de contexto (data de conclusão de
      // fallback, `supersedePreviousNfses`); quais configurações faturar é
      // decidido por `onlyTaskIds`, não por ela.
      const quoteTaskRows = await this.prisma.task.findMany({
        where: { quoteId: id },
        select: { id: true, name: true, serialNumber: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const task = sliceTaskId
        ? (quoteTaskRows.find(t => t.id === sliceTaskId) ?? quoteTaskRows[0])
        : quoteTaskRows[0];

      this.logger.log(
        `[INTERNAL_APPROVE] Task lookup result: ${task ? `found task ${task.id} (${task.name} #${task.serialNumber}) de ${quoteTaskRows.length} tarefa(s)` : 'NO TASK FOUND'}`,
      );

      if (!task) {
        throw new InternalServerErrorException(
          `Nenhuma tarefa encontrada para o orçamento ${id}. Não é possível gerar faturas.`,
        );
      }

      // O ESCOPO É A LISTA DE PAGADORES DAS COBRANÇAS REIVINDICADAS — exata, sem
      // inferência. É exatamente o dado que responde "quais faturas esta
      // aprovação emite".
      const onlyConfigIdsDaCobranca = claimedConfigs.map(c => c.id);

      this.logger.log(
        `[INTERNAL_APPROVE] Escopo da geração: ${onlyConfigIdsDaCobranca.length} pagador(es) ` +
          `de ${claimedBillings.length} faturamento(s).`,
      );
      this.logger.log(`[INTERNAL_APPROVE] Triggering invoice generation for task ${task.id}...`);
      const { invoiceIds, skippedConfigs } =
        await this.invoiceGenerationService.generateInvoicesForTaskDetailed(
          task.id,
          userId,
          approvalDate,
          // O VEÍCULO PEDIDO. Sem isto, aprovar o caminhão 1 de um orçamento
          // cobrado veículo a veículo emitiria as sessenta faturas, as sessenta
          // notas fiscais e os duzentos e quarenta boletos de uma vez — exatamente
          // o que "veículo a veículo" existe para não fazer.
          //
          // ⚠️ DUAS CORREÇÕES MORAM NESTA LINHA.
          //
          // Era `sliceTaskId ? { onlyTaskIds: [sliceTaskId] } : undefined`. O
          // primeiro buraco apareceu quando a tela passou a endereçar por cobrança:
          // em `PUT /billings/:id/approve` o `sliceTaskId` é NULO, o escopo saía
          // `undefined`, e a geração faturava TODAS as configurações pendentes do
          // orçamento — aprovar o caminhão 1 de sessenta emitia as sessenta notas e
          // os sessenta boletos.
          //
          // O segundo estava na correção: escopar pela COBERTURA ainda dá a volta
          // pelo veículo, e cobrança sem cobertura declarada escapa do filtro (a
          // migration do faturamento-entidade criou uma para todo orçamento anterior
          // a 13/09). Endereçar os PAGADORES fecha os dois, e vale nos três modos
          // porque é do conjunto de pagadores que o modo é feito.
          { onlyConfigIds: onlyConfigIdsDaCobranca },
        );
      this.logger.log(
        `[INTERNAL_APPROVE] Invoice generation complete: ${invoiceIds.length} invoice(s) created [${invoiceIds.join(', ')}]`,
      );

      // ⚠️ A PERGUNTA É "FATUROU TODO MUNDO?", NÃO "FATUROU ALGUÉM?".
      //
      // Era `invoiceIds.length === 0`, e isso deixava passar o caso que de fato
      // acontece: com dois pagadores na cobrança, um com condição de pagamento
      // que a geração sabe traduzir e outro sem, sai UMA fatura, a guarda aprova,
      // o carimbo fica de pé — e a cobrança termina APROVADA com um pagador que
      // nunca foi cobrado, sem nota, sem boleto e sem parcela. A conferência é
      // contra o ESCOPO pedido.
      //
      // `skippedConfigs` vem do próprio gerador e já traz o NOME e o MOTIVO de
      // cada pulo (ver `SkippedBillingConfig`); a contagem logo abaixo é a rede
      // para um pulo que algum dia escape da lista.
      if (skippedConfigs.length > 0) {
        const quem = skippedConfigs.map(c => `"${c.customerName}" — ${c.reason}`).join('; ');
        throw new InternalServerErrorException(
          `O faturamento não emitiu fatura para ${skippedConfigs.length} pagador(es): ${quem}. ` +
            'Nenhum pagador da cobrança pode ficar de fora — corrija e tente de novo.',
        );
      }
      if (invoiceIds.length < onlyConfigIdsDaCobranca.length) {
        throw new InternalServerErrorException(
          invoiceIds.length === 0
            ? `Nenhuma fatura foi gerada para o orçamento ${id}. Verifique a configuração de faturamento.`
            : `Foram geradas ${invoiceIds.length} fatura(s) para ${onlyConfigIdsDaCobranca.length} ` +
                'pagador(es) desta cobrança. Nenhum pagador pode ficar sem fatura — verifique a ' +
                'configuração de faturamento e tente de novo.',
        );
      }

      // Emit NfSe FIRST (awaited) so the NfSe number is available for seuNumero on the bank slip.
      // For invoices with generateInvoice=false no NfseDocument exists, so this is a no-op for them.
      this.logger.log(
        `[INTERNAL_APPROVE] Emitting NfSe for ${invoiceIds.length} invoice(s) before registering bank slips...`,
      );
      try {
        await this.nfseEmissionScheduler.emitNfseForInvoices(invoiceIds);
      } catch (nfseError) {
        this.logger.warn(`[INTERNAL_APPROVE] NfSe emission error: ${nfseError}`);
      }

      // The new note now exists, so a note left alive by an earlier revert finally HAS a
      // substituta to cite — request its cancellation. Strictly best-effort: a failure here
      // must never block the boletos below. Coupling a fiscal cancellation to the billing
      // pipeline is what produced the original deadlock, and it is not repeated.
      try {
        await this.supersedePreviousNfses(id, invoiceIds);
      } catch (supersedeError) {
        this.logger.warn(
          `[INTERNAL_APPROVE] Falha ao substituir NFS-e anterior(es): ${supersedeError}`,
        );
      }

      // Only register bank slips for invoices that are ready:
      //   (a) generateInvoice=false — no NFS-e required, seuNumero uses truck plate
      //   (b) generateInvoice=true  — a note with a usable number exists at the prefeitura
      // Invoices in (b) that failed NFS-e keep their bank slips in CREATING state.
      // The bank slip scheduler picks them up once the NFS-e scheduler retries and authorizes.
      //
      // The gate reads NFSE_READY_FOR_BOLETO_STATUSES, not the bare 'AUTHORIZED' it used to:
      // a note whose cancellation the fiscal REJECTED (CANCEL_REJECTED) is as alive as an
      // authorized one, and buildSeuNumero already accepts it (it excludes only CANCELLED).
      // Demanding 'AUTHORIZED' here stranded three boletos of "Tati Minas 8,50" in CREATING
      // with a TMP- nossoNumero forever, which in turn blocked every later revert.
      const [authorizedNfse, noNfseRequired] = await Promise.all([
        this.prisma.nfseDocument.findMany({
          where: {
            invoiceId: { in: invoiceIds },
            status: { in: [...NFSE_READY_FOR_BOLETO_STATUSES] },
            nfseNumber: { not: null },
          },
          select: { invoiceId: true },
        }),
        this.prisma.invoice.findMany({
          where: {
            id: { in: invoiceIds },
            customerConfig: { generateInvoice: false },
          },
          select: { id: true },
        }),
      ]);
      const readyForBoleto = [
        ...new Set([...authorizedNfse.map(n => n.invoiceId), ...noNfseRequired.map(i => i.id)]),
      ];
      const blockedCount = invoiceIds.length - readyForBoleto.length;
      if (blockedCount > 0) {
        this.logger.warn(
          `[INTERNAL_APPROVE] ${blockedCount} invoice(s) skipped bank slip registration (NFS-e not yet authorized). Bank slip scheduler will retry after NFS-e succeeds.`,
        );
      }

      // Register bank slips AFTER NfSe — buildSeuNumero will find authorized NfseDocument.
      if (readyForBoleto.length > 0) {
        this.logger.log(
          `[INTERNAL_APPROVE] Registering bank slips at Sicredi for ${readyForBoleto.length} invoice(s)...`,
        );
        try {
          await this.invoiceGenerationService.registerBankSlipsAtSicredi(readyForBoleto);
        } catch (boletoError) {
          this.logger.warn(
            `[INTERNAL_APPROVE] Some bank slips failed to register at Sicredi (will be retried by scheduler): ${boletoError}`,
          );
        }
      }

      // (O carimbo das cobranças já foi gravado no CLAIM, uma a uma — é ele que
      // resolve a corrida. Havia aqui um segundo `updateMany` re-carimbando "o que
      // sobrou nulo", herdado de quando a primeira aprovação reivindicava o status
      // do ORÇAMENTO em vez das cobranças. Hoje ele não carimba nada: depois do
      // claim nenhum alvo está nulo. Ficava afirmando, no comentário, uma mecânica
      // que já não existe.)

      // O ESTADO É RECALCULADO, NUNCA DIGITADO.
      //
      // Aqui havia uma transição automática do ORÇAMENTO para "A Vencer", e ela
      // só podia rodar na primeira aprovação — porque na segunda ela apagaria um
      // vencido legítimo (parcela do caminhão 1 em atraso) só porque o caminhão 2
      // acabou de ser faturado. Era um remendo para um estado que estava na
      // entidade errada.
      //
      // "A Vencer" deixou de existir: aprovada e cobrada, a cobrança fica em
      // APROVADO, que já quer dizer isso. E quem decide o estado de cada
      // `Billing` é a cascata, lendo as parcelas — uma cobrança paga e outra
      // vencida no mesmo orçamento agora são duas linhas com dois estados, que é
      // o que sempre foram na vida real.
      await this.billingStatusCascade.recomputeForQuote(id);
    } catch (error) {
      this.logger.error(
        `[INTERNAL_APPROVE] Failed during invoice generation/transition for quote ${id}: ${error}`,
      );
      if (error instanceof Error) {
        this.logger.error(`[INTERNAL_APPROVE] Stack trace: ${error.stack}`);
      }

      // ─── DESFAZER EXATAMENTE O QUE ESTA TENTATIVA FEZ ─────────────────────
      //
      // O rollback antigo forçava `BUDGET_APPROVED` CEGAMENTE. Num orçamento de
      // sessenta caminhões, falhar ao aprovar o 31º rebaixava o orçamento INTEIRO
      // para "Orçamento Aprovado" — com trinta já faturados, boletos registrados no
      // Sicredi e notas autorizadas na prefeitura. A tela passava a mentir sobre
      // dinheiro que existe. E os carimbos de fatia reivindicados logo acima
      // ficavam de pé, de modo que a tentativa seguinte respondia "esta fatia já
      // teve o faturamento aprovado" sobre um caminhão que nunca foi faturado.
      //
      // O desfazer é escopado à tentativa: as cobranças que ELA reivindicou.
      //
      // ⚠️ O TOKEN É A LISTA DO CLAIM, NÃO O TIMESTAMP. Era
      // `approvedAt: approvalDate` — "o que esta chamada carimbou" —, e
      // `approvalDate` é um instante de milissegundo que duas chamadas
      // simultâneas compartilham: o rollback de uma levantava o carimbo da outra,
      // que tinha acabado de emitir nota e boleto. `targetBillingIds` é o que
      // esta chamada ganhou linha a linha, e nenhuma outra pode tê-lo ganhado.
      try {
        const unclaimed = await (this.prisma as any).billing.updateMany({
          where: { id: { in: targetBillingIds } },
          data: {
            approvedAt: null,
            // O estado acompanha o carimbo: um rollback que levanta a aprovação e
            // deixa `status` em APROVADO fabrica a cobrança que se afirma cobrada
            // sem ter sido — e essa é a forma que nem aprova nem reverte.
            status: BILLING_STATUS.PENDING as any,
            statusOrder: BILLING_STATUS_ORDER[BILLING_STATUS.PENDING],
          },
        });
        if (unclaimed.count > 0) {
          this.logger.warn(
            `[INTERNAL_APPROVE] Rollback: ${unclaimed.count} carimbo(s) de faturamento levantado(s).`,
          );
        }

        // O status do orçamento NÃO precisa mais ser desfeito: esta aprovação não
        // o moveu. Ele entrou em APPROVED e continua em APPROVED — que é o
        // estado certo de um orçamento aprovado cuja cobrança falhou.
        //
        // O que cai é o carimbo de "inteiramente faturado", se esta tentativa o
        // escreveu: deixá-lo de pé afirmaria que os sessenta caminhões estão
        // faturados por causa de uma emissão que não aconteceu, e envenenaria
        // `avgSalesCycleDays`.
        // O carimbo do contrato é RE-DERIVADO, não desfeito. Zerá-lo porque "esta
        // tentativa o escreveu" apagaria o carimbo que uma aprovação simultânea
        // acabou de gravar legitimamente; o que vale é a pergunta de agora, com o
        // claim desta tentativa já levantado.
        if (!(await fechaOOrcamento())) {
          await this.prisma.budget.update({
            where: { id },
            data: { billingApprovedAt: null } as any,
          });
        }
        // E o estado das cobranças volta a ser derivado do que de fato existe.
        await this.billingStatusCascade.recomputeForQuote(id);

        this.logger.warn(
          isFirstApproval
            ? `[INTERNAL_APPROVE] Rollback: nenhuma cobrança do orçamento ${id} ficou aprovada.`
            : `[INTERNAL_APPROVE] Rollback: as cobranças já aprovadas do orçamento ${id} foram preservadas; só o carimbo desta tentativa caiu.`,
        );
      } catch (rollbackError) {
        this.logger.error(
          `[INTERNAL_APPROVE] CRITICAL: Failed to rollback quote ${id}: ${rollbackError}`,
        );
      }

      // Propagate the error to the client
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Falha ao gerar as faturas. Nenhuma cobrança ficou aprovada — corrija e tente de novo. Erro: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const refreshed = await this.budgetRepository.findById(id);

    // Billing approved (invoices + NFS-e emitted) -> notify commercial/financial/admin.
    try {
      const { label: quoteLabel, taskId } = await this.buildQuoteLabel(id);
      // ── O AVISO LEVA À COBRANÇA, NÃO AO ORÇAMENTO ─────────────────────────
      //
      // O link ia para `/financeiro/orcamento/detalhes/<taskId>` — a tela da
      // PROPOSTA, de um dos sessenta caminhões, escolhido como âncora. Quem
      // recebe "Faturamento Aprovado" quer ver a COBRANÇA que acabou de sair: a
      // fatura, as parcelas, o boleto. Endereçar por `billingId` é a rota
      // própria dela, e existe desde que o faturamento virou entidade.
      //
      // Com mais de uma cobrança nesta aprovação o link vai para a primeira e o
      // texto diz quantas são — um link não pode apontar para duas telas, e
      // dizer o número é melhor do que apontar para a errada.
      const cobrancaAlvo = targetBillingIds[0] ?? null;
      const quantas = targetBillingIds.length;
      const fraseFaturas =
        quantas === 1 ? 'a fatura foi gerada' : `${quantas} cobranças foram faturadas`;
      await this.dispatchService.dispatchByConfiguration('task_quote.billing_approved', userId, {
        entityType: 'Budget',
        entityId: taskId ?? id,
        action: 'billing_approved',
        data: { quoteLabel },
        overrides: {
          title: 'Faturamento Aprovado',
          body: `O faturamento do orçamento ${quoteLabel} foi aprovado e ${fraseFaturas}.`,
          relatedEntityType: 'TASK_QUOTE',
          ...(cobrancaAlvo
            ? {
                webUrl: `/financeiro/faturamento/detalhes/${cobrancaAlvo}`,
                mobileUrl: `/(tabs)/financeiro/faturamento/detalhes/${cobrancaAlvo}`,
              }
            : taskId
              ? {
                  webUrl: `/financeiro/orcamento/detalhes/${taskId}`,
                  mobileUrl: `/(tabs)/financeiro/orcamento/detalhes/${taskId}`,
                }
              : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        'Falha ao notificar faturamento aprovado (task_quote.billing_approved):',
        error,
      );
    }

    return {
      success: true,
      data: refreshed as any,
      message: 'Faturamento do orçamento aprovado com sucesso.',
    };
  }

  /**
   * Guard shared by every billing teardown (revert / cancel-by-task): refuse to touch anything
   * until each boleto and each NFS-e this task produced is CONFIRMED in its own system.
   *
   * Registration at Sicredi and emission at Elotech are both ASYNCHRONOUS — the bank answers a
   * registration with `MOVIMENTO_ENVIADO`, not with a live title. Tearing down while one is
   * still in flight deletes our only pointer to a document that then goes live at the bank or
   * the prefeitura, with nothing left in Ankaa to find it by. That is exactly how boleto
   * 600003389 (task "Adel Coco 15,50", #38771) survived a revert as a live VENCIDO title of
   * R$ 10.512,00 — 37 seconds elapsed between registration and the revert, the baixa was
   * refused because the title did not exist yet, and the row was deleted anyway.
   *
   * Throws BadRequestException listing every blocker; the operator retries once the external
   * systems have settled.
   *
   * @param taskId Task whose billing artifacts are being verified
   * @param action Infinitive used in the error message ("reverter o faturamento", …)
   */
  /**
   * Fecha o ciclo da substituição fiscal — DELEGADO.
   *
   * A lógica inteira mora em `ElotechOxyNfseService.supersedePreviousNfses`, e
   * mora lá porque é fiscal: quem sabe o que a prefeitura aceita como
   * substituta é o serviço que fala com ela.
   *
   * ⚠️ O QUE MUDOU AO MUDAR DE CASA. A versão que vivia aqui escolhia UMA
   * substituta para a rodada inteira (`findFirst` com o maior número entre todas
   * as faturas emitidas) e mandava cancelar TODA nota órfã do ORÇAMENTO citando
   * ela. Num orçamento com várias cobranças isso cancelava a nota de uma
   * cobrança que ninguém refaturou, citando a nota de OUTRA — outro veículo,
   * outro valor, outra empresa; e dentro da mesma cobrança, cancelava a nota do
   * pagador 1 citando a do pagador 2. Cancelar citando substituta errada é erro
   * IRREVERSÍVEL na prefeitura. O pareamento agora é POR PAGADOR
   * (`customerConfigId`), e na dúvida não cancela.
   *
   * Best-effort por desenho: o chamador engole falhas, e o cron
   * `nfse-cancellation-reconcile` retoma o que ficar pela metade.
   *
   * @param quoteId    Orçamento cujas notas de ciclos anteriores serão substituídas
   * @param invoiceIds Faturas criadas pela aprovação que acabou de rodar
   */
  private async supersedePreviousNfses(quoteId: string, invoiceIds: string[]): Promise<void> {
    await this.elotechNfseService.supersedePreviousNfses(quoteId, invoiceIds);
  }

  /**
   * TODA FATURA DESTE ORÇAMENTO — pela COBERTURA, nunca por `Invoice.taskId`.
   *
   * `Invoice.taskId` só é preenchido quando a fatura cobre UM veículo
   * (`sliceAnchorTaskId`): numa fatura conjunta ou de lote ele é NULO de
   * propósito, porque a fatura não é de nenhum dos sessenta caminhões em
   * particular. Escopar a desmontagem por ele — como toda a reversão fazia —
   * significa que num orçamento conjunto NADA é encontrado: o `deleteMany`
   * apaga zero linhas, a guarda de parcela paga não vê a parcela paga, e a baixa
   * no Sicredi não baixa nada. A tela dizia "faturamento revertido" enquanto a
   * fatura, as parcelas e os boletos registrados continuavam vivos.
   *
   * O ramo por `task` fica para o acervo: fatura antiga sem `customerConfigId`.
   */
  private invoicesOfQuote(quoteId: string, billingId?: string | null) {
    // ESCOPADO À COBRANÇA quando ela é dita. O ramo por `task` cai fora nesse
    // caso, e cai de propósito: fatura de acervo, sem `customerConfigId`, não
    // pertence a faturamento nenhum — atribuí-la a este seria apagar a fatura de
    // outra cobrança ao reverter esta.
    if (billingId) return { customerConfig: { quoteId, billingId } } as any;
    return { OR: [{ customerConfig: { quoteId } }, { task: { quoteId } }] } as any;
  }

  private async assertBillingArtifactsConfirmed(
    quoteId: string,
    action: string,
    billingId?: string | null,
  ): Promise<void> {
    const blockers: string[] = [];

    // ─── Boletos ───────────────────────────────────────────────────────────
    // Mesmo escopo de `baixarBoletosAndConfirm`: a parcela SEM fatura (pendurada
    // direto no pagador, como a conciliação as cria) também tem boleto, e um
    // título em voo ali ficava invisível para esta asserção.
    const slips = await this.prisma.bankSlip.findMany({
      where: {
        installment: {
          OR: [
            { invoice: this.invoicesOfQuote(quoteId, billingId) },
            {
              invoiceId: null,
              customerConfig: { quoteId, ...(billingId ? { billingId } : {}) },
            },
          ],
        },
      },
      select: {
        nossoNumero: true,
        status: true,
        updatedAt: true,
        installment: { select: { number: true } },
      },
    });

    // A slip that NEVER reached the bank has nothing to strand: no title exists at Sicredi to
    // baixar, so deleting the row loses nothing. This is provable from the write protocol, not
    // assumed — every one of the four sites that writes CREATING also writes a `TMP-`
    // nossoNumero in the same statement (invoice-generation.service.ts:264,568 and
    // invoice.controller.ts:463,484), and the ONLY transition out of CREATING toward the bank
    // is the atomic CAS to REGISTERING (invoice-generation.service.ts:743, this scheduler's
    // :365). createBoleto is therefore never called on a CREATING slip.
    const neverSent = (s: (typeof slips)[number]) =>
      !s.nossoNumero || s.nossoNumero.startsWith('TMP-') || s.nossoNumero.startsWith('ERR-');

    // REGISTERING is the genuinely ambiguous state: a call may be in flight right now. It is
    // bounded, though — the reaper in sicredi-boleto.scheduler.ts demotes REGISTERING older
    // than 10 minutes to ERROR — so blocking on it is a finite wait, not a deadlock.
    const REGISTERING_STALE_MS = 10 * 60 * 1000;
    const inFlight = (s: (typeof slips)[number]) =>
      s.status === BANK_SLIP_STATUS.REGISTERING &&
      s.updatedAt.getTime() > Date.now() - REGISTERING_STALE_MS;

    // The old predicate blocked on CREATING and on any `TMP-` nossoNumero. Both were wrong in
    // the same direction: they blocked precisely the slips that provably do NOT exist at the
    // bank, making the billing permanently unrevertable once a boleto failed to register — the
    // Tati Minas deadlock. Worse, the `TMP-` clause also recaptured ERROR slips (the error path
    // leaves nossoNumero at `TMP-`), silently defeating the exclusion of REJECTED/ERROR that
    // the comment below deliberately documents.
    const awaitingRegistration = (s: (typeof slips)[number]) =>
      inFlight(s) || (!neverSent(s) && s.status === BANK_SLIP_STATUS.CREATING);

    for (const slip of slips.filter(awaitingRegistration)) {
      blockers.push(
        `O boleto da parcela ${slip.installment.number} está sendo registrado no Sicredi ` +
          `agora (${slip.status}). Aguarde cerca de 10 minutos e tente ${action} novamente.`,
      );
    }

    // Titles we believe are live (ACTIVE/OVERDUE) must be readable at the bank. One we cannot
    // read is one we cannot safely baixar — and deleting its row would hide it forever. A bank
    // outage blocks the teardown, which is the point: it is transient, and tearing down blind
    // is what strands titles.
    //
    // REJECTED/ERROR are deliberately NOT checked here. Registration failed for those, so
    // demanding a confirmation the bank can never give would deadlock the revert permanently
    // (the very trap documented for NFS-e cancellation below). They are probed instead, one by
    // one, in baixarBoletosAndConfirm.
    const liveSlips = slips.filter(
      s =>
        !awaitingRegistration(s) &&
        (s.status === BANK_SLIP_STATUS.ACTIVE || s.status === BANK_SLIP_STATUS.OVERDUE),
    );
    const slipChecks = await Promise.allSettled(
      liveSlips.map(s => this.sicrediService.queryBoleto(s.nossoNumero)),
    );
    slipChecks.forEach((outcome, i) => {
      const slip = liveSlips[i];
      if (outcome.status === 'rejected') {
        const detail =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        blockers.push(
          `Não foi possível confirmar o boleto ${slip.nossoNumero} no Sicredi (${detail}). ` +
            `Sem essa confirmação não é seguro ${action}.`,
        );
      } else if (!outcome.value?.situacao) {
        blockers.push(
          `O Sicredi não informou a situação do boleto ${slip.nossoNumero}. ` +
            `Sem essa confirmação não é seguro ${action}.`,
        );
      }
    });

    // ─── NFS-e ─────────────────────────────────────────────────────────────
    //
    // VÁRIOS elos, porque nenhum sozinho alcança todas. A nota de um ciclo
    // revertido perde a FATURA (`invoiceId` vira nulo) e, se for conjunta, nunca
    // teve TAREFA. Sem os elos largos, uma nota viva de um faturamento já
    // revertido não era conferida na prefeitura antes de desmontar o seguinte.
    //
    // ⚠️ MAS O ESCOPO SEGUE A COBRANÇA QUANDO ELA É DITA. Dos três ramos
    // originais, só o da FATURA respeitava `billingId`; `{ quoteId }` e
    // `{ task: { quoteId } }` eram do orçamento INTEIRO. O efeito: uma nota
    // travada (em emissão, ou ilegível na Elotech) de UMA cobrança congelava a
    // reversão das outras cinquenta e nove — cobranças que não têm nada a ver com
    // ela e cujos artefatos estão todos confirmados.
    //
    // Escopado, os elos viram: a fatura daquela cobrança, o PAGADOR daquela
    // cobrança (`customerConfigId`, o elo que sobrevive à reversão) e o VEÍCULO
    // coberto por ela. Sem `billingId`, a pergunta é do orçamento e os elos
    // largos voltam — é o caminho do cancelamento do orçamento inteiro.
    const nfseWhere = billingId
      ? {
          OR: [
            { invoice: this.invoicesOfQuote(quoteId, billingId) },
            { customerConfig: { billingId } },
            { task: { billingEntry: { billingId } } },
          ],
        }
      : {
          OR: [{ quoteId }, { invoice: this.invoicesOfQuote(quoteId) }, { task: { quoteId } }],
        };
    const nfses = await this.prisma.nfseDocument.findMany({
      where: nfseWhere as any,
      select: { id: true, status: true, nfseNumber: true, elotechNfseId: true },
    });
    const label = (n: (typeof nfses)[number]) => `NFS-e ${n.nfseNumber ?? '(sem número)'}`;

    // An emission genuinely in flight could race a note into existence after we delete its record.
    for (const nfse of nfses.filter(n => n.status === 'PENDING' || n.status === 'PROCESSING')) {
      blockers.push(
        `A ${label(nfse)} ainda está em emissão (${nfse.status}). ` +
          `Aguarde a conclusão da emissão antes de ${action}.`,
      );
    }

    // Notes we believe are LIVE at the prefeitura must be readable there. Already-CANCELLED
    // notes are deliberately excluded: they are dead, cannot come back to life, and demanding
    // a confirmation Elotech might not give for an old note would deadlock the teardown.
    const liveStatuses = ['AUTHORIZED', 'CANCEL_REQUESTED', 'CANCEL_REJECTED'];
    const emitted = nfses.filter(n => liveStatuses.includes(n.status));

    for (const nfse of emitted.filter(n => !n.elotechNfseId)) {
      blockers.push(
        `A ${label(nfse)} está como ${nfse.status} mas não tem o id da Elotech, ` +
          `então a nota não pode ser confirmada na prefeitura antes de ${action}.`,
      );
    }

    const checkableNfses = emitted.filter(n => n.elotechNfseId);
    const nfseChecks = await Promise.allSettled(
      checkableNfses.map(n => this.elotechNfseService.getCancellationStatus(n.elotechNfseId!)),
    );
    nfseChecks.forEach((outcome, i) => {
      const nfse = checkableNfses[i];
      if (outcome.status === 'rejected') {
        const detail =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        blockers.push(
          `Não foi possível confirmar a ${label(nfse)} na Elotech (${detail}). ` +
            `Sem essa confirmação não é seguro ${action}.`,
        );
      } else if (
        String(outcome.value?.notaSituacao ?? 'DESCONHECIDA').toUpperCase() === 'DESCONHECIDA'
      ) {
        blockers.push(
          `A Elotech não informou a situação da ${label(nfse)}. ` +
            `Sem essa confirmação não é seguro ${action}.`,
        );
      }
    });

    if (blockers.length > 0) {
      this.logger.warn(
        `[BILLING_TEARDOWN] Bloqueado para o orçamento ${quoteId}: ${blockers.join(' | ')}`,
      );
      throw new BadRequestException(blockers.join(' '));
    }
  }

  /**
   * Baixa every live boleto of a task at Sicredi and CONFIRM each one actually went down.
   *
   * The baixa PATCH is asynchronous (HTTP 202 `MOVIMENTO_ENVIADO`), so a 2xx proves only that
   * the instruction was queued. Each title is re-read until the bank reports `BAIXADO …`.
   *
   * Confirmed slips are marked CANCELLED locally right away, so the work already done survives
   * a later failure and a retry only targets what is left. Returns the slips that could NOT be
   * confirmed — the caller must NOT delete those rows.
   */
  private async baixarBoletosAndConfirm(
    quoteId: string,
    /** A cobrança, quando a baixa é de uma só. Ausente = todos os boletos do orçamento. */
    billingId?: string | null,
  ): Promise<Array<{ nossoNumero: string; detail: string }>> {
    // ⚠️ O ESCOPO TEM DE ALCANÇAR A PARCELA SEM FATURA.
    //
    // `invoicesOfQuote` pergunta pelo lado da FATURA, e há parcela pendurada
    // direto no pagador (`invoiceId` nulo) — é assim que a conciliação as cria.
    // O orçamento 309, em produção, tem duas dessas com dois boletos OVERDUE
    // VIVOS no Sicredi: pelo escopo antigo a baixa não os encontrava, e o
    // cancelamento seguia adiante deixando dois títulos pagáveis no banco.
    //
    // Quando `billingId` é dito, o recorte da cobrança vale para os dois lados —
    // baixar o boleto de outro faturamento seria o defeito oposto.
    const activeSlips = await this.prisma.bankSlip.findMany({
      where: {
        installment: {
          OR: [
            { invoice: this.invoicesOfQuote(quoteId, billingId) },
            {
              invoiceId: null,
              customerConfig: {
                quoteId,
                ...(billingId ? { billingId } : {}),
              },
            },
          ],
        },
        status: { notIn: [BANK_SLIP_STATUS.CANCELLED, BANK_SLIP_STATUS.PAID] },
      },
      select: { id: true, nossoNumero: true, status: true },
    });
    if (activeSlips.length === 0) return [];

    const results = await Promise.allSettled(
      activeSlips.map(async slip => {
        // A slip that never reached the bank has no title to baixar — its nossoNumero is still
        // the local `TMP-`/`ERR-` placeholder, so cancelBoleto would call Sicredi with an id
        // the bank has never seen, fail, and abort the whole teardown. Short-circuit it.
        // (Same invariant proven in assertBillingArtifactsConfirmed: CREATING is always
        // pre-bank, because the CAS to REGISTERING is the only door to createBoleto.)
        if (
          !slip.nossoNumero ||
          slip.nossoNumero.startsWith('TMP-') ||
          slip.nossoNumero.startsWith('ERR-')
        ) {
          this.logger.log(
            `[BILLING_TEARDOWN] Boleto ${slip.nossoNumero || '(sem número)'} (${slip.status}) ` +
              `nunca foi registrado no Sicredi; nada a baixar, registro liberado para exclusão.`,
          );
          return { slip, situacao: null };
        }

        // REJECTED/ERROR mean the registration itself failed, so there may be no title to
        // baixar. Probe first: if the bank does not know it, there is nothing to strand and
        // the row can go — blocking on it forever would make the billing unrevertable.
        if (slip.status === BANK_SLIP_STATUS.REJECTED || slip.status === BANK_SLIP_STATUS.ERROR) {
          let probed: string | null = null;
          try {
            probed = (await this.sicrediService.queryBoleto(slip.nossoNumero))?.situacao ?? null;
          } catch (err) {
            this.logger.warn(
              `[BILLING_TEARDOWN] Boleto ${slip.nossoNumero} (${slip.status}) não existe no ` +
                `Sicredi (${err}); registro liberado para exclusão.`,
            );
            return { slip, situacao: null };
          }
          const upper = (probed ?? '').toUpperCase();
          if (!probed || upper.startsWith('BAIXADO')) return { slip, situacao: probed };
          // The title IS live despite the local status — fall through and baixa it.
          this.logger.warn(
            `[BILLING_TEARDOWN] Boleto ${slip.nossoNumero} está ${slip.status} localmente mas ` +
              `consta como "${probed}" no Sicredi; dando baixa antes de excluir.`,
          );
        }

        // ── "JÁ BAIXADO" É O SUCESSO, NÃO A FALHA ────────────────────────────
        //
        // `cancelBoleto` LANÇA quando o Sicredi recusa a instrução, e uma das
        // recusas é `0078 — Instrução inválida: título já baixado`. A exceção
        // subia, `Promise.allSettled` a registrava como falha e o desmonte
        // inteiro era recusado — por um título que já estava exatamente no
        // estado que se queria alcançar. Um beco: a baixa nunca ia conseguir.
        //
        // Medido em produção (17/09, orçamento nº 309): os dois boletos vinham
        // OVERDUE no nosso banco e BAIXADOS no Sicredi, e o cancelamento
        // recusava para sempre.
        //
        // A resposta não sai de ler a mensagem de erro — sai de PERGUNTAR ao
        // banco, que é a única fonte que decide. Baixado: o objetivo está
        // cumprido. Liquidado/pago: dinheiro entrou entre a guarda e a baixa, e
        // aí o erro original é o menor dos problemas. Qualquer outra coisa: o
        // erro sobe como antes.
        try {
          await this.sicrediService.cancelBoleto(slip.nossoNumero);
        } catch (err) {
          let jaEsta: string | null = null;
          try {
            jaEsta = (await this.sicrediService.queryBoleto(slip.nossoNumero))?.situacao ?? null;
          } catch {
            throw err;
          }
          const upper = (jaEsta ?? '').toUpperCase();
          if (upper.startsWith('BAIXADO')) {
            this.logger.log(
              `[BILLING_TEARDOWN] Boleto ${slip.nossoNumero}: o Sicredi recusou a instrução ` +
                `(${err instanceof Error ? err.message : err}) porque o título JÁ consta ` +
                `"${jaEsta}". Baixa considerada cumprida.`,
            );
            return { slip, situacao: jaEsta };
          }
          if (upper.startsWith('LIQUIDADO') || upper.startsWith('PAGO')) {
            throw new Error(`o título consta como ${jaEsta} no Sicredi (pagamento recebido)`);
          }
          throw err;
        }

        // Poll until the bank reflects the baixa. ~11s worst case, run in parallel per slip.
        let situacao: string | null = null;
        for (const waitMs of [1500, 3000, 3000, 3000]) {
          await new Promise(resolve => setTimeout(resolve, waitMs));
          try {
            situacao = (await this.sicrediService.queryBoleto(slip.nossoNumero))?.situacao ?? null;
          } catch (err) {
            this.logger.warn(
              `[BILLING_TEARDOWN] Falha ao reconsultar o boleto ${slip.nossoNumero}: ${err}`,
            );
            continue;
          }
          const upper = (situacao ?? '').toUpperCase();
          if (upper.startsWith('BAIXADO')) return { slip, situacao };
          // Paid between the guard and the baixa — real money, never delete this.
          if (upper.startsWith('LIQUIDADO') || upper.startsWith('PAGO')) {
            throw new Error(`o título consta como ${situacao} no Sicredi (pagamento recebido)`);
          }
        }
        throw new Error(`o Sicredi ainda reporta a situação "${situacao ?? 'desconhecida'}"`);
      }),
    );

    const failures: Array<{ nossoNumero: string; detail: string }> = [];
    for (const [i, outcome] of results.entries()) {
      const slip = activeSlips[i];
      if (outcome.status === 'fulfilled') {
        // Persist the confirmed baixa immediately so a retry skips this slip.
        await this.prisma.bankSlip.update({
          where: { id: slip.id },
          data: {
            status: BANK_SLIP_STATUS.CANCELLED,
            sicrediStatus: outcome.value.situacao,
            lastSyncAt: new Date(),
          },
        });
        this.logger.log(
          `[BILLING_TEARDOWN] Boleto ${slip.nossoNumero} baixado e confirmado (${outcome.value.situacao}).`,
        );
      } else {
        const detail =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        this.logger.error(
          `[BILLING_TEARDOWN] Boleto ${slip.nossoNumero} NÃO foi baixado: ${detail}. ` +
            `O registro será preservado.`,
        );
        await this.prisma.bankSlip.update({
          where: { id: slip.id },
          data: {
            errorMessage: `Baixa não confirmada no Sicredi: ${detail}`.slice(0, 500),
            errorCount: { increment: 1 },
            lastSyncAt: new Date(),
          },
        });
        failures.push({ nossoNumero: slip.nossoNumero, detail });
      }
    }
    return failures;
  }

  /**
   * Revert billing approval — undo internalApprove when all bank slips and NFS-e are cancelled.
   * Deletes the invoices (cascading installments, bank slips, NFS-e docs) and reverts the
   * quote status back to BUDGET_APPROVED so the operator can re-approve after corrections.
   *
   * Nothing is deleted until every boleto is confirmed baixado at Sicredi — see
   * {@link assertBillingArtifactsConfirmed} and {@link baixarBoletosAndConfirm}.
   */
  async revertBillingApproval(
    id: string,
    userId: string,
    /**
     * A COBRANÇA a reverter. Ausente = todas as do orçamento.
     *
     * ⚠️ Sem este parâmetro a reversão era sempre do contrato inteiro: num
     * orçamento de três lotes, reverter o lote 3 apagava fatura, parcela e boleto
     * dos lotes 1 e 2 e levantava os três carimbos. Só não destruía quando havia
     * parcela paga, porque aí a guarda barrava tudo.
     */
    billingId?: string | null,
  ): Promise<BudgetUpdateResponse> {
    this.logger.log(
      `[REVERT_BILLING] Revertendo ${billingId ? `a cobrança ${billingId}` : 'TODAS as cobranças'} ` +
        `do orçamento ${id} (usuário ${userId})`,
    );

    const existing = await this.budgetRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Orçamento ${id} não encontrado.`);
    }

    // REVERTER O QUE? A pergunta é da cobrança, e a resposta é "alguma aprovada".
    //
    // Era uma lista de quatro estados do ORÇAMENTO, e ela errava nos dois
    // sentidos: recusava reverter um orçamento LIQUIDADO (estorno depois de pago
    // é exatamente um caso de reversão) e aceitava reverter um orçamento em
    // "Faturamento Aprovado" cujas cobranças já tivessem sido todas revertidas.
    //
    // ⚠️ E "aprovada" é CONGELADA, não "com carimbo". Há cobrança em estado
    // pós-aprovação SEM `approvedAt` — liquidada por conciliação bancária, sem
    // fatura de onde derivar a data. Perguntando só pelo carimbo, essas ficavam
    // num beco: a trava do dinheiro (que usa `isBillingFrozen`) as considera
    // cobradas e manda reverter, e a reversão respondia "não há o que reverter".
    const cobrancasAprovadas = await (this.prisma as any).billing.count({
      where: { quoteId: id, ...BILLING_FROZEN_WHERE, ...(billingId ? { id: billingId } : {}) },
    });
    if (cobrancasAprovadas === 0) {
      throw new BadRequestException(
        billingId
          ? 'Este faturamento não está aprovado — não há o que reverter.'
          : 'Não há faturamento aprovado neste orçamento para reverter.',
      );
    }

    // A tarefa ÂNCORA — a primeira na ordem canônica. Serve só de contexto para
    // `syncEmNegociacaoForTask`; o que se desmonta é escopado pelo ORÇAMENTO
    // (ver `invoicesOfQuote`). Sem `orderBy` a escolha mudava entre duas
    // leituras, e âncora que anda é como o mesmo orçamento passa a apontar para
    // caminhões diferentes.
    const task = await this.prisma.task.findFirst({
      where: { quoteId: id },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!task) throw new NotFoundException(`Tarefa para o orçamento ${id} não encontrada.`);

    // Nothing may be torn down until every boleto is registered at Sicredi and every NFS-e is
    // emitted at Elotech — an artifact still in flight would go live AFTER we deleted the row
    // that points at it. This also subsumes the old PROCESSING/PENDING NFS-e check.
    await this.assertBillingArtifactsConfirmed(id, 'reverter o faturamento', billingId);

    // Notes still LIVE at the prefeitura, for the record kept below. Lidas pelos
    // DOIS lados: uma nota órfã de um ciclo anterior tem `invoiceId` nulo e só
    // responde pela TAREFA; uma nota conjunta tem `taskId` nulo e só responde
    // pela FATURA. Ler um lado só perde exatamente a que mais importa.
    const authorizedNfses = await this.prisma.nfseDocument.findMany({
      where: {
        // TODAS as notas deste orçamento. Era `taskId: task.id` — uma tarefa só,
        // e por `findFirst` sem ordem. Numa nota CONJUNTA `NfseDocument.taskId` é
        // nulo (a nota não é de nenhum dos caminhões), então a leitura antiga
        // perdia exatamente a nota que mais importa.
        // Escopado à cobrança quando ela é dita: uma nota conjunta de OUTRO
        // faturamento não pode bloquear (nem ser levada por) a reversão deste.
        OR: billingId
          ? [{ invoice: this.invoicesOfQuote(id, billingId) }]
          : [{ quoteId: id }, { task: { quoteId: id } }, { invoice: this.invoicesOfQuote(id) }],
        status: { in: [...NFSE_LIVE_STATUSES] },
        elotechNfseId: { not: null },
      },
      select: { id: true, nfseNumber: true, elotechNfseId: true },
    });

    // Verify no installment has been paid
    // ⚠️ "PAGA" NÃO É SÓ `status: PAID`. Um boleto quitado A MENOS (o cliente
    // pagou R$ 4.000 de uma parcela de R$ 10.000) deixa a parcela em PENDING com
    // `paidAmount > 0` — o webhook do Sicredi e o cron de conciliação escrevem
    // o valor sem promover o estado. A guarda que olhava só o estado deixava
    // passar, e o desmonte apagava a parcela E o `BankSlip`: o dinheiro recebido
    // sumia sem deixar linha em lugar nenhum.
    const paidInstallments = await this.prisma.installment.findMany({
      where: {
        invoice: this.invoicesOfQuote(id, billingId),
        OR: [{ status: { in: ['PAID'] } }, { paidAmount: { gt: 0 } }],
      },
      select: { id: true },
    });
    if (paidInstallments.length > 0) {
      throw new BadRequestException(
        `Existem ${paidInstallments.length} parcela(s) com pagamento registrado. Não é possível ` +
          'reverter um faturamento com dinheiro recebido — inclusive pagamento parcial.',
      );
    }

    // Baixa every live boleto at Sicredi and CONFIRM it BEFORE touching the NFS-e. A slip whose
    // baixa could not be confirmed keeps its row (and its invoice/installment) — deleting it
    // would leave a payable title at the bank that Ankaa can no longer see. The revert aborts
    // instead; the slips already confirmed are marked CANCELLED, so a retry only chases what is
    // left. This runs first precisely so an abort here cannot leave a cancelled NF sitting on an
    // otherwise intact faturamento.
    const unconfirmedSlips = await this.baixarBoletosAndConfirm(id, billingId);
    if (unconfirmedSlips.length > 0) {
      throw new BadRequestException(
        `Não foi possível confirmar a baixa no Sicredi de ${unconfirmedSlips.length} boleto(s): ` +
          unconfirmedSlips.map(s => `${s.nossoNumero} (${s.detail})`).join('; ') +
          `. O faturamento foi mantido para que o(s) título(s) não fique(m) em aberto sem ` +
          `registro no sistema. Tente novamente em alguns minutos ou dê baixa manualmente no Sicredi.`,
      );
    }

    // The revert does NOT cancel the NFS-e. This is deliberate and is the fix for the whole
    // class of incident: a cancellation requested here has no substitute note to cite, because
    // the substitute only exists after re-billing — which cannot happen until the revert
    // completes. The prefeitura of Ibiporã rejects exactly that ("Realizar nova solicitação de
    // cancelamento, informando o MOTIVO do cancelamento e o NÚMERO da nota fiscal substituta"),
    // leaving the note in CANCEL_REJECTED with nobody told and nothing able to move it.
    //
    // A fiscal document is never destroyed before its replacement exists. So the note simply
    // STAYS: alive at the prefeitura, still linked to the task (invoiceId goes null by FK
    // SetNull, taskId is durable), fully visible on the task's NFS-e history. The next billing
    // approval mints a NEW note and supersedePreviousNfses() then cancels this one citing that
    // new number as substituta — the two-step substitution this municipality forces on us.
    if (authorizedNfses.length > 0) {
      for (const nfse of authorizedNfses) {
        this.logger.log(
          `[REVERT_BILLING] NFS-e #${nfse.nfseNumber} permanece ATIVA na prefeitura e vinculada ` +
            `à tarefa ${task.id}. Será substituída e cancelada quando o faturamento for ` +
            `aprovado novamente (citando a nova nota como substituta).`,
        );
      }
    }

    await this.prisma.$transaction(async tx => {
      // Boletos primeiro, parcelas depois — `BankSlip.installment` é `Restrict`.
      await deleteInstallmentsWithSlips(tx, { invoice: this.invoicesOfQuote(id, billingId) });
      // Delete invoices. NfseDocuments are NOT cascaded — their invoiceId is set null (FK
      // SetNull) and they remain linked to the task as permanent NFS-e history. Only notes
      // confirmed CANCELLED at the prefeitura reach this point (the guard above blocks revert
      // while any note is still active), so no active fiscal document is ever stranded.
      // A nota que NUNCA foi cunhada morre com a fatura — ver
      // `abandonUnmintedNfseDocuments`. Sem isto, um `NfseDocument` PENDENTE
      // criado entre a guarda de artefatos e esta transação (um clique em "Emitir
      // NFS-e") perde a fatura por `SetNull` e some para sempre num beco: a
      // varredura não o emite, o vigia de notas órfãs não o vê, e o histórico
      // fiscal da tarefa o mostra "Pendente" eternamente.
      const abandonadas = await abandonUnmintedNfseDocuments(
        tx,
        this.invoicesOfQuote(id, billingId),
        'Faturamento revertido antes de a nota ser emitida — nenhuma NFS-e chegou a existir na prefeitura.',
      );
      if (abandonadas > 0) {
        this.logger.log(
          `[REVERT_BILLING] ${abandonadas} NFS-e pendente(s) sem nota na prefeitura marcada(s) como cancelada(s).`,
        );
      }
      await tx.invoice.deleteMany({ where: this.invoicesOfQuote(id, billingId) });
      // ── O CARIMBO DE CADA FATURAMENTO VOLTA A ZERO ──────────────────────
      //
      // `Billing.approvedAt` é o que responde "este faturamento já foi
      // aprovado?", e é por ele que `internalApprove` decide se a aprovação é a
      // PRIMEIRA. Deixá-lo de pé depois de reverter tornava o orçamento
      // IMPOSSÍVEL de refaturar: a aprovação seguinte encontrava todos os
      // faturamentos carimbados, não sobrava alvo, e a resposta era "Todas as
      // fatias deste orçamento já tiveram o faturamento aprovado" sobre um
      // orçamento que acabou de voltar para Orçamento Aprovado.
      await (tx as any).billing.updateMany({
        where: { quoteId: id, ...(billingId ? { id: billingId } : {}) },
        data: {
          approvedAt: null,
          // O ESTADO VAI JUNTO COM O CARIMBO — a janela entre os dois é o defeito.
          // A cascata roda DEPOIS da transação e engole erro por cobrança: morrer
          // ali deixava `status` pós-aprovação com `approvedAt` nulo, e essa
          // combinação fecha as TRÊS portas de uma vez (não é alvo de aprovação,
          // não é revertível, não volta a Pendente). Gravando PENDENTE aqui, a
          // falha da cascata deixa um estado COERENTE; ela só refina depois.
          status: BILLING_STATUS.PENDING as any,
          statusOrder: BILLING_STATUS_ORDER[BILLING_STATUS.PENDING],
        },
      });
      // O status do ORÇAMENTO não é revertido porque ele não foi movido: aprovar
      // faturamento deixou de mexer nele. O que cai é o carimbo de "inteiramente
      // faturado" — deixá-lo de pé afirmaria que os sessenta caminhões estão
      // faturados depois de a cobrança ter sido desmontada, e envenenaria o
      // `avgSalesCycleDays`.
      await tx.budget.update({
        where: { id },
        data: { billingApprovedAt: null } as any,
      });
    });

    // ⚠️ E o ESTADO das cobranças tem de ser recalculado. Sem isto elas ficariam
    // lendo "Aprovado"/"Liquidado" com `approvedAt` nulo e sem parcela nenhuma —
    // o carimbo some, o estado fica, e a tela mostra um faturamento aprovado que
    // não existe mais. A cascata as devolve a PENDENTE.
    await this.billingStatusCascade.recomputeForQuote(id);

    this.logger.log(
      `[REVERT_BILLING] Faturamentos do orçamento ${id} desfeitos: fatura, parcelas e boletos apagados, carimbos levantados e estado recalculado.`,
    );

    // Direct prisma write above bypasses updateStatus — reconcile explicitly.
    // Status moves stay within ≥ BUDGET_APPROVED so this is usually a no-op
    // for Em Negociação, but kept for symmetry with other status-change paths.
    // Escopado pelo ORÇAMENTO, como tudo que esta reversão desmonta: a tarefa
    // âncora acima é só contexto de log, não o alcance do que mudou.
    await syncEmNegociacaoForQuote(this.prisma, id, userId);

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_QUOTE,
      entityId: id,
      action: CHANGE_ACTION.ROLLBACK,
      field: 'status',
      oldValue: existing.status,
      newValue: TASK_QUOTE_STATUS.APPROVED,
      reason: 'Faturamento revertido pelo operador',
      triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
      triggeredById: userId,
      userId,
    });

    const refreshed = await this.budgetRepository.findById(id);
    return {
      success: true,
      data: refreshed as any,
      message:
        'Faturamento revertido com sucesso. As cobranças voltaram para Pendente; o orçamento segue aprovado.',
    };
  }

  /**
   * Cancel a quote because its task was cancelled. Sets the quote to CANCELLED
   * and tears down any billing it produced (delete invoices/installments, baixa
   * active boletos at Sicredi, cancel active NFS-e at Elotech) — mirroring
   * revertBillingApproval but ending at CANCELLED instead of BUDGET_APPROVED, and
   * accepting ANY non-cancelled source status (a draft quote simply flips to
   * CANCELLED with no fiscal records to tear down).
   *
   * Refuses (throws) when an installment is already PAID or an NFS-e emission is
   * in flight — those represent real money / in-flight state and must be handled
   * manually. Idempotent: a no-op if the quote is already CANCELLED.
   *
   * Called from the task-cancel cascade POST-commit (external Sicredi/Elotech
   * calls cannot run inside the task's transaction).
   */
  async cancelForTaskCancellation(
    id: string,
    userId: string,
    changeLogReason = 'Orçamento cancelado automaticamente pelo cancelamento da tarefa',
  ): Promise<void> {
    const existing = await this.budgetRepository.findById(id);
    if (!existing) {
      this.logger.warn(`[CANCEL_QUOTE] Quote ${id} not found; nothing to cancel.`);
      return;
    }
    if (existing.status === TASK_QUOTE_STATUS.CANCELLED) {
      await this.cancelRunningEnvelopes(id, userId);
      return; // idempotent
    }

    // ── SÓ QUANDO FOI O ÚLTIMO VEÍCULO ATIVO ─────────────────────────────────
    //
    // A cascata dispara quando UMA tarefa entra em CANCELADA, e isso era correto
    // enquanto um orçamento tinha uma tarefa. Com o multitarefa virou defeito:
    // cancelar o caminhão 1 de quatro cancelava o ORÇAMENTO INTEIRO — e com ele o
    // desmonte da cobrança dos outros três, que ninguém pediu para cancelar.
    //
    // A pergunta certa é "sobrou algum veículo ATIVO?". Tarefa apagada nem conta
    // (sumiu da tabela), e é por isso que a mesma guarda serve ao caminho da
    // exclusão: zero tarefas também é zero tarefas ativas.
    //
    // Sai em silêncio de propósito: não é erro nem recusa, é a cascata
    // concluindo que ainda não é hora. Quem cancelou o caminhão não precisa ser
    // avisado de que o orçamento dos outros três segue de pé.
    const activeVehicles = await this.prisma.task.count({
      where: { quoteId: id, status: { not: TASK_STATUS.CANCELLED } },
    });
    if (activeVehicles > 0) {
      this.logger.log(
        `[CANCEL_QUOTE] Orçamento ${id} mantido: ${activeVehicles} veículo(s) ainda ativo(s).`,
      );
      return;
    }

    const task = await this.prisma.task.findFirst({
      where: { quoteId: id },
      select: { id: true },
    });
    const taskId = task?.id ?? null;

    // ── O DESMONTE É DO ORÇAMENTO, NÃO DA TAREFA ─────────────────────────────
    //
    // Este bloco inteiro vivia dentro de `if (taskId)` — e NADA dentro dele
    // precisa da tarefa: `assertBillingArtifactsConfirmed`, a guarda de parcela
    // paga, `baixarBoletosAndConfirm` e a varredura de NFS-e são todas escopadas
    // pelo ORÇAMENTO (`invoicesOfQuote`). O `taskId` só serve de contexto para o
    // `syncEmNegociacaoForTask` lá embaixo.
    //
    // ⚠️ E o orçamento SEM veículo é exatamente o caso que a condição excluía.
    // Medido em produção (17/09/2026): dos 105 órfãos, 104 estão limpos — mas o
    // nº 309 tem DUAS parcelas com DOIS boletos OVERDUE, vivos no Sicredi. Pelo
    // caminho antigo ele seria carimbado CANCELADO com os dois títulos ainda
    // pagáveis no banco, que é precisamente o desfecho que este método existe
    // para impedir. Sem artefato nenhum, tudo aqui é no-op.
    {
      // Every boleto must be registered at Sicredi and every NFS-e emitted at Elotech before
      // anything is torn down — an artifact still in flight would go live after we delete the
      // row that points at it. Subsumes the old PROCESSING/PENDING NFS-e check.
      await this.assertBillingArtifactsConfirmed(id, 'cancelar o orçamento');

      // Real money received → cannot silently cancel; needs manual estorno.
      // Pela COBERTURA: numa fatura conjunta `Invoice.taskId` é nulo, e a guarda
      // por tarefa deixava passar um orçamento com parcela PAGA.
      // Mesma regra da reversão: pagamento PARCIAL também é dinheiro recebido.
      // Ver a nota em `revert`.
      //
      // ⚠️ E ALCANÇA A PARCELA SEM FATURA. `invoicesOfQuote` é escopo por FATURA,
      // e há parcela pendurada direto no pagador (`invoiceId` nulo) — é assim que
      // a conciliação as cria, e é a forma do orçamento 309. Perguntar só pelo
      // lado da fatura deixava essas invisíveis para a guarda.
      const paidInstallments = await this.prisma.installment.findMany({
        where: {
          OR: [
            { invoice: this.invoicesOfQuote(id) },
            { customerConfig: { quoteId: id } },
          ],
          AND: [{ OR: [{ status: { in: ['PAID'] } }, { paidAmount: { gt: 0 } }] }],
        },
        select: { id: true },
      });
      if (paidInstallments.length > 0) {
        throw new BadRequestException(
          `Existem ${paidInstallments.length} parcela(s) com pagamento registrado. Não é possível ` +
            `cancelar um orçamento com dinheiro recebido — trate o estorno manualmente.`,
        );
      }

      // Baixa the active boletos and confirm each one BEFORE touching the NFS-e. An unconfirmed
      // baixa aborts the cancellation rather than deleting the row of a title still payable at
      // the bank — and running it first keeps an abort from leaving a cancelled NF behind.
      const unconfirmedSlips = await this.baixarBoletosAndConfirm(id);
      if (unconfirmedSlips.length > 0) {
        throw new BadRequestException(
          `Não foi possível confirmar a baixa no Sicredi de ${unconfirmedSlips.length} boleto(s): ` +
            unconfirmedSlips.map(s => `${s.nossoNumero} (${s.detail})`).join('; ') +
            `. O faturamento foi mantido para que o(s) título(s) não fique(m) em aberto sem ` +
            `registro no sistema. Tente novamente em alguns minutos ou dê baixa manualmente no Sicredi.`,
        );
      }

      // Best-effort cancel active NFS-e at Elotech (AUTHORIZED / CANCEL_REJECTED
      // are both still live at the prefeitura). A note left active is logged and
      // stays linked to the task (invoiceId→null) — never lost.
      const authorizedNfses = await this.prisma.nfseDocument.findMany({
        where: {
          OR: [{ quoteId: id }, { invoice: this.invoicesOfQuote(id) }, { task: { quoteId: id } }],
          status: { in: ['AUTHORIZED', 'CANCEL_REJECTED'] },
          elotechNfseId: { not: null },
        },
        select: { id: true, nfseNumber: true },
      });
      if (authorizedNfses.length > 0) {
        const outcomes = await Promise.allSettled(
          authorizedNfses.map(n =>
            this.elotechNfseService.cancelNfse(
              n.id,
              'Cancelamento automático por cancelamento da tarefa.',
              1,
            ),
          ),
        );
        outcomes.forEach((o, i) => {
          if (!(o.status === 'fulfilled' && o.value?.cancelled)) {
            this.logger.warn(
              `[CANCEL_QUOTE] NFS-e #${authorizedNfses[i].nfseNumber} segue ATIVA após ` +
                `cancelamento da tarefa; permanece vinculada à tarefa — cancele-a manualmente se necessário.`,
            );
          }
        });
      }
    }

    await this.prisma.$transaction(async tx => {
      // Delete installments (cascades bank slips) + invoices. NfseDocuments are
      // NOT cascaded — invoiceId is SetNull and they remain linked to the task
      // as permanent fiscal history. Escopo pela COBERTURA: ver `invoicesOfQuote`.
      //
      // ⚠️ SEM `if (taskId)`, e alcançando a parcela SEM FATURA — pela mesma razão
      // do bloco de guardas acima: o desmonte é do ORÇAMENTO. O nº 309, sem
      // veículo e com duas parcelas penduradas direto no pagador, ficava com as
      // parcelas em aberto depois de o orçamento ser carimbado como cancelado.
      //
      // A guarda de dinheiro já rodou e já recusou se houvesse pagamento; o
      // predicado é repetido aqui pelo mesmo motivo de sempre — a consulta que
      // APAGA usa o mesmo critério da que RECUSA.
      await deleteInstallmentsWithSlips(tx, {
        OR: [{ invoice: this.invoicesOfQuote(id) }, { customerConfig: { quoteId: id } }],
        AND: [{ status: { not: 'PAID' }, paidAmount: { lte: 0 } }],
      });
      // Mesmo gesto da reversão: a nota que nunca foi cunhada não sobrevive à
      // fatura. As AUTORIZADAS já foram tratadas acima (cancelamento na Elotech) e
      // não entram aqui — a dupla trava `nfseNumber`/`elotechNfseId` as protege.
      const abandonadasNoCancelamento = await abandonUnmintedNfseDocuments(
        tx,
        this.invoicesOfQuote(id),
        'Orçamento cancelado antes de a nota ser emitida — nenhuma NFS-e chegou a existir na prefeitura.',
      );
      if (abandonadasNoCancelamento > 0) {
        this.logger.log(
          `[CANCEL_QUOTE] ${abandonadasNoCancelamento} NFS-e pendente(s) sem nota na prefeitura ` +
            `marcada(s) como cancelada(s).`,
        );
      }
      await tx.invoice.deleteMany({ where: this.invoicesOfQuote(id) });
      // O carimbo de cada faturamento volta a zero — mesma razão da reversão.
      await (tx as any).billing.updateMany({
        where: { quoteId: id },
        data: {
          approvedAt: null,
          // O ESTADO VAI JUNTO COM O CARIMBO — a janela entre os dois é o defeito.
          // A cascata roda DEPOIS da transação e engole erro por cobrança: morrer
          // ali deixava `status` pós-aprovação com `approvedAt` nulo, e essa
          // combinação fecha as TRÊS portas de uma vez (não é alvo de aprovação,
          // não é revertível, não volta a Pendente). Gravando PENDENTE aqui, a
          // falha da cascata deixa um estado COERENTE; ela só refina depois.
          status: BILLING_STATUS.PENDING as any,
          statusOrder: BILLING_STATUS_ORDER[BILLING_STATUS.PENDING],
        },
      });
      await tx.budget.update({
        where: { id },
        data: {
          status: TASK_QUOTE_STATUS.CANCELLED,
          statusOrder: this.getStatusOrder(TASK_QUOTE_STATUS.CANCELLED),
          billingApprovedAt: null,
        } as any,
      });
    });

    // ── O ESTADO DAS COBRANÇAS TEM DE ACOMPANHAR ─────────────────────────────
    //
    // A transação acima zera `Billing.approvedAt` e carimba o orçamento como
    // CANCELADO, mas `Billing.status` é PERSISTIDO e tem um escritor só: a
    // cascata. Sem esta chamada ele fica no valor antigo — e a primeira regra da
    // cascata (`BillingStatusCascadeService.resolve`) diz justamente que
    // orçamento cancelado cancela as cobranças dele.
    //
    // ⚠️ MEDIDO EM PRODUÇÃO (17/09/2026): 23 cobranças ficaram "Pendente" em
    // orçamentos cancelados no mesmo dia — 23 linhas na lista de Faturamento
    // convidando o financeiro a cobrar contrato que não existe mais. O lote de
    // 16/09 (51 linhas) está CANCELLED porque veio pelo backfill da migração, não
    // por este caminho: o defeito só aparece quando o cancelamento roda pelo
    // código, que é o que passou a acontecer.
    //
    // Fora da transação e depois dela, como as outras cascatas: ela abre a
    // própria escrita e precisa LER o orçamento já cancelado para decidir.
    await this.billingStatusCascade.recomputeForQuote(id);

    await syncEmNegociacaoForQuote(this.prisma, id, userId);

    // Uma cerimônia de assinatura em andamento não pode sobreviver ao orçamento
    // cancelado: o link continuaria assinável e o scheduler de expiração seguiria
    // varrendo o envelope. O cancelamento preserva a trilha (evento
    // ENVELOPE_CANCELLED na cadeia de auditoria) e as assinaturas já colhidas.
    await this.cancelRunningEnvelopes(id, userId);

    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.TASK_QUOTE,
      entityId: id,
      action: CHANGE_ACTION.UPDATE,
      field: 'status',
      oldValue: existing.status,
      newValue: TASK_QUOTE_STATUS.CANCELLED,
      reason: changeLogReason,
      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
      triggeredById: userId,
      userId,
    });

    this.logger.log(
      `[CANCEL_QUOTE] Quote ${id} cancelled (was ${existing.status}): ${changeLogReason}`,
    );
  }

  /**
   * Cancela toda cerimônia RUNNING do orçamento — best-effort: uma falha aqui
   * não pode desfazer um cancelamento de orçamento já commitado.
   */
  private async cancelRunningEnvelopes(quoteId: string, userId: string): Promise<void> {
    const running = await this.prisma.signatureEnvelope.findMany({
      where: { quoteId, status: 'RUNNING' },
      select: { id: true, verificationCode: true },
    });
    for (const envelope of running) {
      try {
        await this.signatureEnvelopes.cancel(envelope.id, userId, {
          ipAddress: null,
          userAgent: null,
        });
        this.logger.log(
          `[CANCEL_QUOTE] Envelope ${envelope.verificationCode} cancelado junto com o orçamento ${quoteId}.`,
        );
      } catch (error) {
        this.logger.error(
          `[CANCEL_QUOTE] Falha ao cancelar envelope ${envelope.verificationCode} do orçamento ${quoteId}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  }

  /**
   * @deprecated O número do pedido é do VEÍCULO (`Task.customerOrderNumber`).
   *
   * Continua aqui porque o app instalado nos aparelhos ainda chama esta rota, e
   * recusá-la deixaria o campo sem escrita em campo. O que ela faz mudou: grava
   * o mesmo número em TODAS as tarefas do orçamento — que é o comportamento que
   * ela sempre teve na prática, agora dito com todas as letras. Para escrever o
   * pedido de UM caminhão, use `PUT /tasks/:id` com `customerOrderNumber`.
   *
   * O `customerId` deixou de ter efeito: o pedido não é mais por cliente. Ele
   * segue no corpo (o app o manda) e serve só para verificar que o cliente
   * pertence mesmo a este orçamento.
   */
  async updateCustomerConfigOrderNumber(
    quoteId: string,
    customerId: string | null,
    orderNumber: string | null,
    taskId?: string | null,
  ): Promise<{ success: true; message: string }> {
    // O cliente ainda é aceito (o app instalado o manda) e serve de guarda: o
    // número pertence ao orçamento daquele cliente, não a um orçamento qualquer.
    if (customerId) {
      const configs = await this.prisma.budgetPayer.count({
        where: { quoteId, customerId },
      });
      if (configs === 0) {
        throw new NotFoundException('Configuração de cliente não encontrada para este orçamento.');
      }
    }

    // ─── UM VEÍCULO, OU TODOS ────────────────────────────────────────────────
    //
    // O pedido de compra é da ENTREGA: às vezes é o mesmo para os sessenta
    // caminhões, às vezes muda a cada um. Com `taskId` a escrita é do veículo
    // pedido — e a guarda garante que ele é DESTE orçamento, senão o app poderia
    // carimbar o pedido no caminhão de outro contrato.
    //
    // Sem `taskId` a escrita é em todos, que é o comportamento do app instalado
    // (ele mandava só o cliente) e continua sendo a leitura certa do que ele
    // pede: "o pedido deste orçamento".
    if (taskId) {
      const belongs = await this.prisma.task.count({ where: { id: taskId, quoteId } });
      if (belongs === 0) {
        throw new BadRequestException('A tarefa informada não pertence a este orçamento.');
      }
      await this.prisma.task.update({
        where: { id: taskId },
        data: { customerOrderNumber: orderNumber || null },
      });
      return { success: true, message: 'Número do pedido atualizado com sucesso.' };
    }

    const updated = await this.prisma.task.updateMany({
      where: { quoteId },
      data: { customerOrderNumber: orderNumber || null },
    });

    return {
      success: true,
      message:
        updated.count > 1
          ? `Número do pedido aplicado aos ${updated.count} veículos do orçamento.`
          : 'Número do pedido atualizado com sucesso.',
    };
  }

  /**
   * Get approved price for a task
   */
  async getApprovedPriceForTask(taskId: string): Promise<number> {
    const quote = await this.budgetRepository.findApprovedByTaskId(taskId);
    return quote?.total || 0;
  }

  /**
   * Find expired quotes and optionally mark them
   */
  async findAndMarkExpired(): Promise<Budget[]> {
    try {
      const expired = await this.budgetRepository.findExpired();

      this.logger.log(`Found ${expired.length} expired quotes`);

      return expired;
    } catch (error: unknown) {
      this.logger.error('Error finding expired quotes:', error);
      throw new InternalServerErrorException('Erro ao buscar orçamentos expirados.');
    }
  }

  /**
   * Find suggestion: most recent quote matching task name, customer, truck category, and implement type.
   * All four fields must match exactly.
   */
  async findSuggestion(params: {
    name: string;
    customerId: string;
    category: string;
    implementType: string;
  }) {
    try {
      const suggestion = await this.budgetRepository.findSuggestion(params);

      if (!suggestion) {
        return {
          success: true,
          data: null,
          message: 'Nenhuma sugestão encontrada.',
        };
      }

      return {
        success: true,
        data: suggestion,
        message: 'Sugestão encontrada com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error('Error finding suggestion:', error);
      throw new InternalServerErrorException('Erro ao buscar sugestão.');
    }
  }

  // =====================
  // PUBLIC METHODS (No Authentication Required)
  // =====================

  /**
   * Find quote for public view (customer budget page)
   * Only returns data if quote is not expired (unless ignoreExpiration is true)
   * @param id - Quote ID
   * @param ignoreExpiration - If true, returns quote even if expired (for authenticated users)
   */
  async findPublic(id: string, ignoreExpiration = false): Promise<BudgetGetUniqueResponse> {
    try {
      // Public-facing select clause — DB-layer enforcement (preferred over post-fetch masking).
      // Sensitive fields explicitly NOT selected: BankSlip.barcode/linhaDigitavel/pixQrCode/
      // nossoNumero/sicrediStatus/errorMessage/liquidationData/pdfFileId, NfseDocument numbering
      // and URLs, responsibleUser (entire user record), createdById/updatedById, internal status reasons.
      const quote = await this.prisma.budget.findUnique({
        where: { id },
        select: {
          id: true,
          subtotal: true,
          total: true,
          expiresAt: true,
          status: true,
          guaranteeYears: true,
          customGuaranteeText: true,
          customForecastDays: true,
          simultaneousTasks: true,
          budgetNumber: true,
          // JUNTO OU SEPARADO — a página pública LÊ este campo.
          //
          // Sem ele a página assume `JOINT` (o padrão do cliente) e um orçamento
          // `PER_TASK` é exibido errado nos dois pontos que mais importam: a
          // frase das parcelas fala do total quando deveria falar de cada
          // veículo, e `computeQuoteMoney` devolve o total geral onde deveria
          // devolver o unitário. É a página em que o cliente APROVA — aprovar
          // uma coisa e receber outra é a classe de defeito que este campo
          // existe para impedir.
          billingSplit: true,
          createdAt: true,
          updatedAt: true,
          layoutFiles: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, filename: true, originalName: true, mimetype: true, size: true },
          },
          services: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              description: true,
              observation: true,
              amount: true,
              position: true,
              // The FK itself — without it the public budget/dossiê pages cannot
              // tell WHICH customer a service bills to, so their per-customer
              // links (/cliente/:customerId/...) fall back to showing everything.
              invoiceToCustomerId: true,
              invoiceToCustomer: {
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true, cpf: true },
              },
            },
          },
          customerConfigs: {
            select: {
              id: true,
              // The FK itself — the public budget/dossiê pages match the
              // /cliente/:customerId/... URL against it to decide whether they
              // render one customer's view or the "Completo" one. Without it
              // nothing ever matches and every per-customer link renders
              // Completo.
              customerId: true,
              // A COBERTURA — de quais veículos esta fatura é. A página pública é
              // onde o cliente CONFERE antes de assinar: num orçamento em lotes,
              // sem isto ele leria "3 faturas" sem saber qual caminhão está em
              // qual, que é justamente o que o lote resolve.
              billing: {
                select: {
                  id: true,
                  approvedAt: true,
                  tasks: {
                    select: { taskId: true },
                    orderBy: [{ task: { createdAt: 'asc' } }, { taskId: 'asc' }],
                  },
                },
              },
              subtotal: true,
              total: true,
              discountType: true,
              discountValue: true,
              discountReference: true,
              customPaymentText: true,
              generateInvoice: true,
              generateBankSlip: true,
              paymentCondition: true,
              paymentConfig: true,
              customer: {
                // O QUADRO DO TOMADOR. Não é só nome e documento: a seção
                // "Faturamento" imprime inscrição estadual, municipal e o
                // endereço completo — é o cadastro que a prefeitura exige na
                // NFS-e, posto no documento para o cliente CONFERIR antes de
                // aprovar. Sem estes campos no `select` a página mostrava "—"
                // em todas as linhas de um cliente que tem tudo preenchido, e
                // nada acusava: ausência não é erro de tipo.
                //
                // Não são dados sensíveis — são os do próprio cliente, que ele
                // já conhece e está ali para verificar.
                select: {
                  id: true,
                  corporateName: true,
                  fantasyName: true,
                  cnpj: true,
                  cpf: true,
                  stateRegistration: true,
                  municipalRegistration: true,
                  streetType: true,
                  address: true,
                  addressNumber: true,
                  addressComplement: true,
                  neighborhood: true,
                  city: true,
                  state: true,
                  zipCode: true,
                },
              },
              customerSignature: {
                select: { id: true, filename: true, originalName: true, mimetype: true },
              },
              installments: {
                orderBy: { number: 'asc' },
                select: {
                  id: true,
                  number: true,
                  amount: true,
                  dueDate: true,
                  status: true,
                  paymentMethod: true,
                  // Bank slip: ONLY surface non-sensitive presentation fields. No barcode/PIX/
                  // nossoNumero/sicrediStatus/errorMessage/liquidationData/pdfFileId.
                  bankSlip: {
                    select: {
                      id: true,
                      status: true,
                      dueDate: true,
                      amount: true,
                      type: true,
                    },
                  },
                },
              },
              // Invoice: public-relevant status fields plus the AUTHORIZED NFSe ids
              // so the dossier page can render the NFSe PDFs from /nfse/public/:id/pdf.
              // `invoices` (plural) + filtro da VIVA: a relação sempre foi 1:N no banco
              // (a viva mais as canceladas dos ciclos anteriores) e o público não deve
              // ver ciclo cancelado. Ver `utils/billing-invoice.ts`.
              invoices: {
                where: LIVE_INVOICE_WHERE,
                select: {
                  id: true,
                  status: true,
                  totalAmount: true,
                  paidAmount: true,
                  nfseDocuments: {
                    where: { status: 'AUTHORIZED', elotechNfseId: { not: null } },
                    select: { id: true, status: true, elotechNfseId: true, nfseNumber: true },
                  },
                },
              },
            },
          },
          tasks: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              serialNumber: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              // O PEDIDO DE COMPRA DO CLIENTE, deste veículo. A página pública e o
              // relatório de serviço o imprimem no quadro do tomador — é o número
              // pelo qual o cliente reconhece a compra. Ele lia
              // `customerConfigs[].orderNumber`, uma coluna que já não existe, e
              // o quadro saía sem a linha. Não é dado sensível: veio do cliente.
              customerOrderNumber: true,
              customer: {
                select: { id: true, corporateName: true, fantasyName: true, cnpj: true, cpf: true },
              },
              responsibles: {
                select: { id: true, name: true, roles: true },
                orderBy: { createdAt: 'asc' },
              },
              truck: {
                select: {
                  id: true,
                  plate: true,
                  chassisNumber: true,
                  category: true,
                  implementType: true,
                },
              },
              serviceOrders: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  description: true,
                  status: true,
                  type: true,
                  position: true,
                  startedAt: true,
                  finishedAt: true,
                  checkinFiles: { select: { id: true, filename: true, originalName: true } },
                  checkoutFiles: { select: { id: true, filename: true, originalName: true } },
                },
              },
            },
          },
        },
      });

      if (!quote) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if quote is expired (skip check if user is authenticated)
      const now = new Date();
      if (!ignoreExpiration && new Date(quote.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou e não está mais disponível para visualização.',
        );
      }

      return {
        success: true,
        data: quote as any,
        message: 'Orçamento carregado com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error finding public quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao carregar orçamento.');
    }
  }

  /**
   * Upload customer signature for quote (public endpoint)
   * Only allows upload if quote is not expired
   */
  async uploadCustomerSignature(
    id: string,
    file: Express.Multer.File,
    customerConfigId?: string,
  ): Promise<BudgetUpdateResponse> {
    try {
      const quote = await this.prisma.budget.findUnique({
        where: { id },
        include: {
          customerConfigs: {
            include: { customerSignature: true },
          },
        },
      });

      if (!quote) {
        throw new NotFoundException('Orçamento não encontrado.');
      }

      // Check if quote is expired
      const now = new Date();
      if (new Date(quote.expiresAt) < now) {
        throw new BadRequestException(
          'Este orçamento expirou. Não é possível enviar a assinatura.',
        );
      }

      // Security (A10): the public link carries no dedicated access token (the
      // unguessable quote UUID is the capability), so the strongest available
      // server-side check is a STATUS gate — signatures are only accepted while
      // the quote is actually awaiting the customer's approval (PENDING) or
      // re-signing right after it (BUDGET_APPROVED). From BILLING_APPROVED
      // onward the deal is internally locked and an anonymous signature upload
      // must not alter it.
      const signatureAllowedStatuses: TASK_QUOTE_STATUS[] = [
        TASK_QUOTE_STATUS.PENDING,
        TASK_QUOTE_STATUS.APPROVED,
      ];
      if (!signatureAllowedStatuses.includes(quote.status as TASK_QUOTE_STATUS)) {
        throw new BadRequestException('Este orçamento não está aguardando assinatura do cliente.');
      }

      // Find the target customer config
      const targetConfig = customerConfigId
        ? quote.customerConfigs.find(c => c.id === customerConfigId)
        : quote.customerConfigs[0];

      if (!targetConfig) {
        throw new BadRequestException('Configuração de cliente não encontrada.');
      }

      // Create file record for signature
      const signatureFile = await this.prisma.file.create({
        data: {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          path: file.path,
          size: file.size,
        },
      });

      // Update customer config with signature
      await this.prisma.budgetPayer.update({
        where: { id: targetConfig.id },
        data: {
          customerSignatureId: signatureFile.id,
        },
      });

      // Delete old signature file if it exists
      if (targetConfig.customerSignature) {
        await this.prisma.file
          .delete({
            where: { id: targetConfig.customerSignature.id },
          })
          .catch(() => {
            // Ignore errors when deleting old file
          });
      }

      // Re-fetch the full quote
      const updated = await this.prisma.budget.findUnique({
        where: { id },
        include: {
          services: true,
          layoutFiles: { orderBy: { createdAt: 'asc' } },
          customerConfigs: {
            include: {
              customer: { select: { id: true, fantasyName: true, cnpj: true } },
              customerSignature: true,
            },
          },
          tasks: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: {
              customer: true,
            },
          },
        },
      });

      // Log signature changelog
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.TASK_QUOTE,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'customerSignatureId',
        oldValue: targetConfig.customerSignatureId || null,
        newValue: signatureFile.id,
        userId: null,
        reason: 'Assinatura do cliente enviada',
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
        triggeredById: null,
      });

      this.logger.log(`Customer signature uploaded for quote ${id}, config ${targetConfig.id}`);

      return {
        success: true,
        data: updated as any,
        message: 'Assinatura enviada com sucesso.',
      };
    } catch (error: unknown) {
      this.logger.error(`Error uploading signature for quote ${id}:`, error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao enviar assinatura.');
    }
  }

  /**
   * Validate status transition
   * @private
   */
  private validateStatusTransition(
    currentStatus: TASK_QUOTE_STATUS,
    newStatus: TASK_QUOTE_STATUS,
  ): void {
    // Human-readable PT-BR labels for user-facing messages (never leak raw enums).
    const label = (s: TASK_QUOTE_STATUS) => TASK_QUOTE_STATUS_LABELS[s] ?? s;

    if (currentStatus === newStatus) {
      throw new BadRequestException(`O status já é "${label(currentStatus)}".`);
    }

    // Explicit allowlist for manual status changes via the /status endpoint.
    //
    // Scheduler-driven cascades (UPCOMING↔DUE↔PARTIAL on installment events)
    // bypass this via direct prisma.budget.update — the scheduler is the
    // authoritative source for those transitions. This allowlist covers
    // operator-initiated overrides (admin corrections, chargebacks, manual
    // re-cycles when the scheduler hasn't caught up or made a wrong call).
    //
    // Mirrors web/src/utils/permissions/quote-permissions.ts VALID_TRANSITIONS
    // exactly — drift here breaks the UI (advertised transitions returning 400).
    //
    // ─────────────────────────────────────────────────────────────────────────
    // O GRAFO ENCOLHEU PARA QUATRO ARESTAS, e o que sobrou é o ciclo do
    // ORÇAMENTO. Antes ele descrevia também o do pagamento — BILLING_APPROVED →
    // UPCOMING → PARTIAL/DUE → SETTLED, com as voltas de estorno. Nada disso é
    // transição de orçamento: é a cobrança andando, e a cobrança agora é o
    // `Billing`, cujo estado NINGUÉM digita — `BillingStatusCascadeService` o
    // deriva das parcelas.
    //
    // Some com isso uma classe inteira de bug que este grafo tinha por
    // construção: um orçamento com duas cobranças, uma paga e outra vencida,
    // precisava escolher UMA aresta. Escolhia a última que rodasse.
    //
    // ⚠️ `APPROVED` é terminal para frente: dele só se volta (PENDING) ou se
    // cancela. Não há "aprovar faturamento" aqui — isso é `PUT
    // /billings/:id/approve`, que não mexe no status do orçamento.
    const ALLOWED: Record<TASK_QUOTE_STATUS, TASK_QUOTE_STATUS[]> = {
      [TASK_QUOTE_STATUS.PENDING]: [TASK_QUOTE_STATUS.APPROVED, TASK_QUOTE_STATUS.CANCELLED],
      // SIGNED é escrito pela CERIMÔNIA (grupo do cliente completo), nunca à
      // mão — por isso não é destino de ninguém aqui. O que esta linha declara
      // é como se SAI dele: aprovar (a contra-assinatura aconteceu, ou o
      // operador aprova à mão porque ela travou), voltar para PENDING (o
      // cliente desistiu, ou o valor foi editado e as assinaturas caíram) e
      // cancelar. EXPIRED não está na lista de propósito: uma vez que o cliente
      // aceitou dentro do prazo, o relógio deixa de correr contra ele — o que
      // falta é nosso. Ver `SignatureExpiryScheduler`.
      [TASK_QUOTE_STATUS.SIGNED]: [
        TASK_QUOTE_STATUS.APPROVED,
        TASK_QUOTE_STATUS.PENDING,
        TASK_QUOTE_STATUS.CANCELLED,
      ],
      // Vencido sem todas as assinaturas. O comercial reanalisa o valor: ou
      // reformula (o que já devolve o orçamento a PENDING pelo auto-revert de
      // edição de valor), ou estende a validade, ou cancela. Não vai direto
      // para APPROVED — aprovar sem assinatura é exatamente o que a cerimônia
      // existe para impedir.
      [TASK_QUOTE_STATUS.EXPIRED]: [TASK_QUOTE_STATUS.PENDING, TASK_QUOTE_STATUS.CANCELLED],
      // APPROVED → PENDING existe para o caminho de cancelamento mais comum: o
      // cliente desiste antes de haver cobrança. Depois que alguma cobrança foi
      // aprovada, `isQuoteMoneyLocked` barra a edição e o caminho é
      // /revert-billing, que limpa boleto e NFS-e antes.
      [TASK_QUOTE_STATUS.APPROVED]: [TASK_QUOTE_STATUS.PENDING, TASK_QUOTE_STATUS.CANCELLED],
      // Terminal — a quote is cancelled when its task is cancelled. Re-quoting
      // creates a new quote rather than transitioning out of CANCELLED.
      [TASK_QUOTE_STATUS.CANCELLED]: [],
    };

    const allowed = ALLOWED[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Não é possível alterar o status de "${label(currentStatus)}" para "${label(newStatus)}".`,
      );
    }
  }

  /**
   * Validate prerequisites for a status transition.
   * Ensures required data exists before allowing certain status changes.
   * @private
   */
  private async validateStatusPrerequisites(
    quoteId: string,
    currentStatus: TASK_QUOTE_STATUS,
    newStatus: TASK_QUOTE_STATUS,
  ): Promise<void> {
    // ⚠️ O DESTINO, NÃO A TRANSIÇÃO.
    //
    // Era `switch` sobre `PENDING->APPROVED`, e isso deixava passar o caminho que
    // a assinatura eletrônica usa: `PENDING → SIGNED → APPROVED`. Chegando por
    // ali, um orçamento sem pagador nenhum era aprovado sem nada conferir — e
    // orçamento APROVADO sem pagador não pode ser faturado, não pode ser
    // liquidado e não sai mais da fila. Há dois assim no acervo (nº 54 e nº 291).
    //
    // A pergunta não é de que estado se vem: é se este orçamento tem a quem
    // cobrar. Ela vale para todo caminho que chegue em APROVADO.
    if (newStatus === TASK_QUOTE_STATUS.APPROVED) {
      // ── NÃO SE APROVA SOBRE UMA COLETA QUE ACABOU DE CAIR ──────────────────
      //
      // Quando uma alteração material derruba as assinaturas, o gancho
      // `markInvalidatedBySignature` devolve o orçamento a PENDENTE — e essa
      // parte funciona. O que a desfazia era a gravação seguinte: o assistente
      // manda o valor e, logo depois, replica pelo endpoint de status o alvo que
      // o SELETOR carrega desde a abertura da página. O seletor ainda dizia
      // "Aprovado" porque era esse o estado quando a tela abriu, e o orçamento
      // voltava a aprovado um segundo depois de ter sido revertido.
      //
      // Medido em produção (orçamento nº 984, 17/09 20:05): a reversão registrou
      // sucesso às 20:05:32 e a reaprovação gravou às 20:05:33, com notificação
      // de "aguarda aprovação de faturamento" para o financeiro.
      //
      // A pergunta é do DOMÍNIO, não da tela: um orçamento APROVADO afirma que
      // alguém concordou com AQUELE documento. Se o documento aceito morreu e
      // nada foi colhido depois, não há o que a aprovação esteja afirmando.
      // Vale para todo caminho que chegue em APROVADO — inclusive o replay.
      //
      // Só morde quem TEVE coleta: orçamento aprovado sem nunca ter ido à
      // assinatura (a maioria) não passa por aqui.
      const ultimoEnvelope = await this.prisma.signatureEnvelope.findFirst({
        where: { quoteId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, invalidatedReason: true },
      });
      if (ultimoEnvelope?.status === 'INVALIDATED') {
        throw new BadRequestException(
          'As assinaturas deste orçamento foram invalidadas por uma alteração' +
            (ultimoEnvelope.invalidatedReason
              ? ` (${ultimoEnvelope.invalidatedReason.replace(/^Alteração em:\s*/, '')})`
              : '') +
            '. Reenvie para assinatura e colha a aceitação antes de aprovar de novo.',
        );
      }

      // Must have at least one customerConfig with total > 0
      const configs = await this.prisma.budgetPayer.findMany({
        where: { quoteId },
        select: { total: true },
      });

      if (configs.length === 0) {
        throw new BadRequestException(
          'É necessário ter pelo menos uma configuração de cliente antes de avançar o status.',
        );
      }

      const hasPositiveTotal = configs.some(c => Number(c.total) > 0);
      if (!hasPositiveTotal) {
        throw new BadRequestException(
          'Pelo menos uma configuração de cliente deve ter um valor total maior que zero.',
        );
      }
    }
  }

  /**
   * OS PRÉ-REQUISITOS PARA APROVAR UMA COBRANÇA.
   *
   * Era o caso `APPROVED -> BILLING_APPROVED` do switch de transições, e saiu de
   * lá porque a transição não existe mais: aprovar faturamento deixou de mexer no
   * status do orçamento. A VERIFICAÇÃO, porém, vale inteira — é ela que impede
   * emitir nota e boleto sem condição de pagamento, sem CNPJ do pagador, ou sobre
   * um serviço que ninguém terminou.
   *
   * Os três casos que ficavam logo abaixo dela — A VENCER→PARCIAL, PARCIAL→PAGO e
   * PAGO→PARCIAL — foram apagados e não substituídos: eram pré-requisitos de
   * transições que ninguém mais digita. O estado da cobrança é DERIVADO das
   * parcelas por `BillingStatusCascadeService`, e um estado derivado não precisa
   * ser autorizado, só calculado.
   */
  private async validateBillingApprovalPrerequisites(
    quoteId: string,
    /**
     * OS PAGADORES DESTA APROVAÇÃO. Omitido = todos os do orçamento.
     *
     * A verificação era sempre do orçamento inteiro, e num orçamento faturado
     * veículo a veículo isso significa recusar a aprovação do lote 1 por um CEP
     * faltando no pagador do lote 3 — um erro impossível de obedecer sem mexer em
     * quem não está sendo faturado agora.
     */
    onlyConfigIds?: readonly string[] | null,
  ): Promise<void> {
    const escopo =
      onlyConfigIds && onlyConfigIds.length > 0
        ? { quoteId, id: { in: [...onlyConfigIds] } }
        : { quoteId };
    // Each customerConfig must have valid paymentCondition or paymentConfig; task must be finished
    const configs = await this.prisma.budgetPayer.findMany({
      where: escopo,
      select: {
        id: true,
        customerId: true,
        total: true,
        paymentCondition: true,
        paymentConfig: true,
        customPaymentText: true,
        customer: {
          select: {
            fantasyName: true,
            corporateName: true,
            cnpj: true,
            cpf: true,
            address: true,
            addressNumber: true,
            neighborhood: true,
            city: true,
            state: true,
            zipCode: true,
          },
        },
      },
    });

    if (configs.length === 0) {
      throw new BadRequestException(
        'É necessário ter pelo menos uma configuração de cliente antes de aprovar internamente.',
      );
    }

    // Billing approval no longer requires the task to be finished. Installment
    // due dates are anchored on the billing-approval moment (approvalDate passed
    // to internalApprove/generateInvoicesForTask), NOT on task.finishedAt, so
    // invoices/boletos can be generated at any gate once the budget is approved.

    // Validate services: none may have negative amounts
    const services = await this.prisma.budgetItem.findMany({
      where: { quoteId },
      select: { id: true, description: true, amount: true, invoiceToCustomerId: true },
    });

    const negativeAmountServices = services.filter(s => Number(s.amount) < 0);
    if (negativeAmountServices.length > 0) {
      throw new BadRequestException(
        `Os seguintes serviços possuem valor negativo: ${negativeAmountServices.map(s => `"${s.description}"`).join(', ')}. Os serviços não podem ter valor negativo para faturamento.`,
      );
    }

    // Multi-customer: all services must have invoiceToCustomerId
    //
    // ⚠️ Contando FATIAS, esta guarda recusava o orçamento `PER_TASK`
    // inteiro — e o erro era impossível de obedecer: "Faturar Para" só
    // aparece com mais de um CLIENTE, então não havia onde atribuir nada.
    //
    // A pergunta é do ORÇAMENTO, não do escopo desta aprovação: "há mais de um
    // cliente a repartir estes serviços?" não muda porque se está faturando um
    // lote de cada vez. Lida do escopo, uma cobrança de um pagador só num
    // orçamento de dois clientes pularia a guarda e faturaria serviço que
    // pertence ao outro.
    const quoteCustomers = await this.prisma.budgetPayer.findMany({
      where: { quoteId },
      select: { customerId: true },
    });
    if (hasMultipleCustomers(quoteCustomers)) {
      // ⚠️ "SEM CLIENTE" INCLUI APONTAR PARA QUEM NÃO PAGA ESTE ORÇAMENTO.
      //
      // A guarda perguntava só por `invoiceToCustomerId` nulo. Um serviço marcado
      // para um cliente que não é (ou deixou de ser) pagador não casa com fatia
      // nenhuma: ele não entra em fatura alguma, e antes desta rodada também não
      // entrava em total nenhum. Passava aqui, e o orçamento era faturado por
      // menos do que a soma dos próprios serviços.
      const pagadores = new Set(quoteCustomers.map(c => c.customerId));
      const unassigned = services.filter(
        s => !s.invoiceToCustomerId || !pagadores.has(s.invoiceToCustomerId),
      );
      if (unassigned.length > 0) {
        throw new BadRequestException(
          `Os seguintes serviços não possuem um cliente PAGADOR atribuído: ${unassigned.map(s => `"${s.description}"`).join(', ')}. Quando há múltiplos clientes, todo serviço deve apontar para um dos clientes do faturamento.`,
        );
      }
    }

    for (const config of configs) {
      const customerName =
        config.customer?.fantasyName || config.customer?.corporateName || 'Cliente';
      const isCustomPayment = config.paymentCondition === 'CUSTOM';
      const hasPaymentConfig = !!(config as any).paymentConfig;

      // ── A VALIDAÇÃO RECUSA EXATAMENTE O QUE O GERADOR NÃO SABE FAZER ───────
      //
      // Os geradores de parcela vivem em `InvoiceGenerationService`
      // (`generateInstallmentsFromCondition` e `...FromPaymentConfig`) e começam
      // os dois por `if (total <= 0) return []`.
      // Zero parcelas = nenhuma fatura para este pagador — e a aprovação seguia
      // adiante e carimbava a cobrança assim mesmo. O acervo tem 11 pagadores
      // pendentes nesse estado: aprová-los produz cobrança APROVADA sem fatura,
      // sem boleto e sem nota, que não dá para faturar nem para liquidar.
      //
      // Recusar aqui, com nome, é a resposta honesta: um pagador de R$ 0,00 não
      // é uma cobrança, é uma linha que alguém esqueceu de preencher.
      if (Number(config.total ?? 0) <= 0) {
        throw new BadRequestException(
          `O faturamento do cliente "${customerName}" está com valor total de R$ 0,00. ` +
            'Não há o que cobrar: defina o valor (ou remova este pagador) antes de aprovar.',
        );
      }

      if (!config.paymentCondition && !hasPaymentConfig) {
        throw new BadRequestException(
          `A condição de pagamento não foi definida para o cliente "${customerName}".`,
        );
      }

      // Custom payment uses free-text description.
      //
      // `CUSTOM` é ACEITO — e agora isso é verdade dos dois lados. O gerador
      // passou a produzir UMA parcela no valor total para a condição
      // personalizada (o combinado é sobre COMO se paga, não sobre SE se deve),
      // então o que a validação exige é o mínimo que essa parcela precisa: o
      // texto do combinado e um valor positivo (conferido acima). Antes a
      // validação abençoava `CUSTOM` e o gerador devolvia zero parcelas — 41
      // pagadores pendentes presos entre as duas respostas.
      if (isCustomPayment) {
        if (!config.customPaymentText?.trim()) {
          throw new BadRequestException(
            `O cliente "${customerName}" possui condição de pagamento personalizada, mas não tem o texto de pagamento preenchido. ` +
              'Descreva o combinado (ex.: "à vista no PIX", "50% na entrega") — é ele que vira a parcela.',
          );
        }
        continue;
      }

      // Validate customer NFS-e required fields
      const c = config.customer;
      if (!c) continue;
      const missing: string[] = [];
      if (!c.cnpj && !c.cpf) missing.push('CNPJ ou CPF');
      if (!c.fantasyName?.trim()) missing.push('Nome Fantasia');
      if (!c.corporateName?.trim()) missing.push('Razão Social');
      if (!c.address?.trim()) missing.push('Logradouro');
      if (!c.addressNumber?.trim()) missing.push('Número');
      if (!c.neighborhood?.trim()) missing.push('Bairro');
      if (!c.city?.trim()) missing.push('Cidade');
      if (!c.state?.trim()) missing.push('Estado');
      if (!c.zipCode?.trim()) missing.push('CEP');
      if (missing.length > 0) {
        throw new BadRequestException(
          `O cliente "${customerName}" possui dados incompletos para emissão de NFS-e. Campos faltantes: ${missing.join(', ')}.`,
        );
      }
    }

    // Sum-divergence check: warn (but don't block) when sum(config.total) != quote.total.
    // This can happen legitimately due to discounts or manual adjustments, so we only log.
    // A hard block would prevent intentional partial-invoicing or courtesy adjustments.
    {
      const configTotals = await this.prisma.budgetPayer.findMany({
        where: { quoteId },
        select: { total: true },
      });
      const sumConfigTotals = configTotals.reduce((acc, c) => acc + Number(c.total), 0);
      const quoteRecord = await this.prisma.budget.findUnique({
        where: { id: quoteId },
        select: { total: true },
      });
      const quoteTotal = Number(quoteRecord?.total ?? 0);
      const diff = Math.abs(sumConfigTotals - quoteTotal);
      if (diff > 0.02) {
        this.logger.warn(
          `[BILLING_APPROVE] Sum of customerConfig totals (${sumConfigTotals.toFixed(2)}) differs from quote.total (${quoteTotal.toFixed(2)}) by ${diff.toFixed(2)} for quoteId=${quoteId}. This may be intentional (discounts/adjustments) but verify before proceeding.`,
        );
      }
    }
  }

  /**
   * Get Portuguese label for status
   * @private
   */
  private getStatusLabel(status: TASK_QUOTE_STATUS): string {
    const labels: Record<string, string> = {
      [TASK_QUOTE_STATUS.PENDING]: 'salvo como pendente',
      [TASK_QUOTE_STATUS.SIGNED]: 'assinado pelo cliente',
      [TASK_QUOTE_STATUS.EXPIRED]: 'marcado para reanálise',
      [TASK_QUOTE_STATUS.APPROVED]: 'aprovado',
    };

    return labels[status] || 'atualizado';
  }

  /**
   * Get sort order for a given status
   */
  private getStatusOrder(status: TASK_QUOTE_STATUS): number {
    return TASK_QUOTE_STATUS_ORDER[status] || 1;
  }
}
