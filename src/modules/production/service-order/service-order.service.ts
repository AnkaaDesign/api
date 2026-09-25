import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { assertCanUpdateServiceOrder } from './service-order.permissions';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  ServiceOrderGetUniqueResponse,
  ServiceOrderGetManyResponse,
  ServiceOrderCreateResponse,
  ServiceOrderUpdateResponse,
  ServiceOrderDeleteResponse,
  ServiceOrderBatchCreateResponse,
  ServiceOrderBatchUpdateResponse,
  ServiceOrderBatchDeleteResponse,
} from '../../../types';
import { ServiceOrderRepository } from './repositories/service-order/service-order.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  ServiceOrderCreateFormData,
  ServiceOrderUpdateFormData,
  ServiceOrderGetManyFormData,
  ServiceOrderInclude,
  ServiceOrderBatchCreateFormData,
  ServiceOrderBatchUpdateFormData,
  ServiceOrderBatchDeleteFormData,
} from '../../../schemas/serviceOrder';
import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
  TASK_STATUS,
  TASK_QUOTE_STATUS,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import {
  getTaskUpdateForServiceOrderStatusChange,
  isStatusRollback,
  calculateCorrectTaskStatus,
  areCommercialServiceOrdersComplete,
} from '../../../utils/task-service-order-sync';
import { getTaskStatusOrder } from '../../../utils/sortOrder';
import {
  SERVICE_ORDER_STATUS_ORDER,
  TASK_QUOTE_STATUS_ORDER,
} from '../../../constants/sortOrders';
import {
  getServiceOrderToQuoteSync,
  makeDescObsKey,
  type SyncQuoteItem,
} from '../../../utils/budget-service-order-sync';
import { recalcQuoteTotals } from '../../../utils/budget-totals';
import { isQuoteMoneyLocked } from '../budget/budget.guards';
import {
  getServiceDescriptionsByType,
  SERVICE_DESCRIPTIONS_BY_TYPE,
} from '../../../constants/service-descriptions';
import { calculateWorkingSeconds } from '../../../utils/working-hours';
import { BillingStatusCascadeService } from '@modules/financial/billing/billing-status-cascade.service';
import { SignatureEnvelopeService } from '@modules/common/signature/services/signature-envelope.service';

@Injectable()
export class ServiceOrderService {
  private readonly logger = new Logger(ServiceOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceOrderRepository: ServiceOrderRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly eventEmitter: EventEmitter2,
    // QUEM ESCREVE `Billing.status`. Cancelar ou restaurar um orçamento muda o
    // que as cobranças dele valem, e o estado delas é DERIVADO — sem recalcular
    // aqui, o cancelamento deixava a cobrança no estado anterior e a restauração
    // a deixava CANCELADA para sempre (a varredura diária não varre orçamento
    // cancelado). `BillingStatusModule` só depende do Prisma; não fecha ciclo.
    private readonly billingStatusCascade: BillingStatusCascadeService,
    // QUEM SABE SE O DOCUMENTO ASSINADO AINDA DESCREVE ESTE ORÇAMENTO.
    //
    // Este arquivo ESPELHA a O.S. de produção na lista de serviços do orçamento
    // — cria, renomeia e apaga `BudgetItem`, e recalcula os totais. Até
    // 18/09/2026 fazia tudo isso sem dizer uma palavra ao motor de assinatura:
    // renomear a O.S. "Pintura lateral" para "Pintura lateral e traseira" num
    // orçamento ASSINADO E SELADO reescrevia a linha (a descrição e o subtotal
    // estão dentro do recorte material), e o envelope continuava CONCLUÍDO. O
    // PDF selado e o banco passavam a descrever contratos diferentes, sem uma
    // linha na trilha.
    //
    // `forwardRef` dos dois lados: `SignatureModule` puxa integrações grandes
    // (NFS-e, Sicredi) e o custo de um ciclo futuro é um boot quebrado.
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly signatureEnvelopes: SignatureEnvelopeService,
  ) {}

  /**
   * Desfaz a cascata disparada pelo cancelamento da ÚLTIMA ordem de serviço
   * COMMERCIAL de uma tarefa.
   *
   * O cancelamento em cascata derruba, além da tarefa, o orçamento e TODAS as
   * demais ordens de serviço. O caminho de volta ("Restaurar" a OS comercial)
   * só devolvia o status da TAREFA — orçamento e OSs continuavam CANCELLED, e
   * não havia botão capaz de trazê-los de volta. Um clique errado num combobox
   * sem confirmação virava, na prática, uma tarefa destruída (caso Fricarne,
   * 28/08/2026).
   *
   * A cascata não é gravada em lote em lugar nenhum, mas cada linha dela vai ao
   * ChangeLog com `triggeredById` = id da OS comercial e `triggeredBy` =
   * SYSTEM_GENERATED, tudo dentro da mesma transação. É esse par, recortado pela
   * janela de tempo da entrada da TAREFA, que identifica o lote — e funciona
   * também para cascatas antigas, anteriores a este código.
   */
  private async restoreCascadeFromCommercialCancel(
    tx: PrismaTransaction,
    taskId: string,
    commercialServiceOrderId: string,
    userId: string | null,
  ): Promise<string[]> {
    /**
     * Os ORÇAMENTOS que voltaram do CANCELADO nesta restauração.
     *
     * Devolvidos porque as COBRANÇAS deles continuam CANCELADAS até alguém
     * recalcular, e ninguém recalculava: `Billing.status` é derivado do status
     * do orçamento, a varredura diária não varre orçamento cancelado, e este
     * método roda dentro de uma transação — a cascata tem de rodar depois do
     * commit, no chamador.
     */
    const orcamentosRestaurados: string[] = [];
    // Entrada da TAREFA gerada pela cascata: âncora temporal do lote.
    const taskCascadeEntry = await tx.changeLog.findFirst({
      where: {
        entityType: ENTITY_TYPE.TASK,
        entityId: taskId,
        field: 'status',
        triggeredById: commercialServiceOrderId,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (!taskCascadeEntry) return;

    // A cascata inteira roda numa transação; segundos de folga cobrem o relógio.
    const from = new Date(taskCascadeEntry.createdAt.getTime() - 5000);
    const to = new Date(taskCascadeEntry.createdAt.getTime() + 5000);

    const cascadeEntries = await tx.changeLog.findMany({
      where: {
        entityType: { in: [ENTITY_TYPE.SERVICE_ORDER, ENTITY_TYPE.TASK_QUOTE] },
        field: 'status',
        triggeredById: commercialServiceOrderId,
        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
        createdAt: { gte: from, lte: to },
        // A própria OS comercial é reativada pelo update do usuário.
        NOT: { entityId: commercialServiceOrderId },
      },
      orderBy: { createdAt: 'asc' },
      select: { entityType: true, entityId: true, oldValue: true },
    });

    for (const entry of cascadeEntries) {
      const previousStatus =
        typeof entry.oldValue === 'string' ? entry.oldValue : String(entry.oldValue ?? '');
      if (!previousStatus) continue;

      if (entry.entityType === ENTITY_TYPE.SERVICE_ORDER) {
        const statusOrder = SERVICE_ORDER_STATUS_ORDER[previousStatus];
        if (statusOrder === undefined) continue;

        // Só volta o que a cascata derrubou: quem já foi mexido depois, fica.
        const current = await tx.serviceOrder.findUnique({
          where: { id: entry.entityId },
          select: { id: true, status: true, type: true },
        });
        if (!current || current.status !== SERVICE_ORDER_STATUS.CANCELLED) continue;

        await tx.serviceOrder.update({
          where: { id: current.id },
          data: { status: previousStatus as SERVICE_ORDER_STATUS, statusOrder },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: current.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: SERVICE_ORDER_STATUS.CANCELLED,
          newValue: previousStatus,
          reason: `Ordem de serviço ${current.type} restaurada automaticamente pois a ordem de serviço comercial foi reativada`,
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: commercialServiceOrderId,
          userId: userId || '',
          transaction: tx,
        });
      } else {
        const statusOrder = TASK_QUOTE_STATUS_ORDER[previousStatus as TASK_QUOTE_STATUS];
        if (statusOrder === undefined) continue;

        const current = await tx.budget.findUnique({
          where: { id: entry.entityId },
          select: { id: true, status: true },
        });
        if (!current || current.status !== TASK_QUOTE_STATUS.CANCELLED) continue;

        await tx.budget.update({
          where: { id: current.id },
          data: { status: previousStatus as TASK_QUOTE_STATUS, statusOrder },
        });

        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK_QUOTE,
          entityId: current.id,
          action: CHANGE_ACTION.UPDATE,
          field: 'status',
          oldValue: TASK_QUOTE_STATUS.CANCELLED,
          newValue: previousStatus,
          reason:
            'Orçamento restaurado automaticamente pois a ordem de serviço comercial foi reativada',
          triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
          triggeredById: commercialServiceOrderId,
          userId: userId || '',
          transaction: tx,
        });

        orcamentosRestaurados.push(current.id);
      }
    }

    if (cascadeEntries.length > 0) {
      this.logger.log(
        `[COMMERCIAL ROLLBACK] Restored ${cascadeEntries.length} cascade-cancelled records for task ${taskId}` +
          (orcamentosRestaurados.length > 0
            ? ` (${orcamentosRestaurados.length} orçamento(s) — cobranças serão recalculadas após o commit)`
            : ''),
      );
    }

    return orcamentosRestaurados;
  }

  /**
   * EXISTE FATURAMENTO VIVO NESTE ORÇAMENTO?
   *
   * ⚠️ A pergunta é do ORÇAMENTO, nunca da TAREFA. A guarda perguntava
   * `invoice.findFirst({ taskId })` — e `Invoice.taskId` é NULO de propósito
   * numa fatura CONJUNTA ou de LOTE (ela não é de nenhum dos sessenta implementos
   * em particular, ver `sliceAnchorTaskId`). Resultado: no caso mais caro —
   * orçamento conjunto, fatura emitida, boletos registrados, NFS-e autorizada —
   * a guarda não encontrava nada e o cancelamento em cascata passava por cima de
   * tudo, deixando documento fiscal vivo pendurado em tarefa CANCELADA.
   *
   * É o mesmo buraco que `cancelQuote` já fechou trocando o escopo por tarefa
   * pelo escopo por orçamento (`invoicesOfQuote` em `budget.service.ts`), e
   * a forma aqui é a mesma: pela COBERTURA (`customerConfig.quoteId`) com o ramo
   * por `task` mantido para a fatura de acervo, anterior ao `customerConfigId`.
   */
  private async hasLiveBillingForTask(tx: PrismaTransaction, taskId: string): Promise<boolean> {
    const quoteRow = await tx.task.findUnique({
      where: { id: taskId },
      select: { quoteId: true },
    });

    const live = await tx.invoice.findFirst({
      where: {
        status: { not: 'CANCELLED' },
        ...(quoteRow?.quoteId
          ? { OR: [{ customerConfig: { quoteId: quoteRow.quoteId } }, { taskId }] }
          : { taskId }),
      },
      select: { id: true },
    });

    return !!live;
  }

  /**
   * Convert a string to Title Case (first letter of each word capitalized)
   * Handles Portuguese prepositions (de, da, do, das, dos, na, no, nas, nos, e, em)
   */
  private toTitleCase(str: string): string {
    if (!str) return str;

    // Portuguese prepositions that should stay lowercase (unless at the start)
    const lowercaseWords = new Set([
      'de',
      'da',
      'do',
      'das',
      'dos',
      'na',
      'no',
      'nas',
      'nos',
      'e',
      'em',
      'para',
      'com',
    ]);

    return str
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (!word) return word;
        // Keep prepositions lowercase unless it's the first word
        if (index > 0 && lowercaseWords.has(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  /**
   * Create a new service order
   */
  async create(
    data: ServiceOrderCreateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
  ): Promise<ServiceOrderCreateResponse> {
    try {
      // Validate task exists
      const taskExists = await this.prisma.task.findUnique({
        where: { id: data.taskId },
      });

      if (!taskExists) {
        throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
      }

      // Validate assignedTo user exists if provided
      if (data.assignedToId) {
        const userExists = await this.prisma.user.findUnique({
          where: { id: data.assignedToId },
        });

        if (!userExists) {
          throw new NotFoundException(
            'Usuário atribuído não encontrado. Verifique se o ID está correto.',
          );
        }
      }

      // ORÇAMENTOS CUJA LISTA DE SERVIÇOS FOI REESCRITA por este espelho. O motor
      // de assinatura precisa saber — ver `notifyQuoteContentChanged`.
      const quotesContentChanged = new Set<string>();

      const serviceOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get task's current service orders before creating new one
        const taskWithServices = await tx.task.findUnique({
          where: { id: data.taskId },
          include: {
            serviceOrders: {
              select: {
                description: true,
                status: true,
                startedAt: true,
                finishedAt: true,
              },
            },
          },
        });

        const oldServices = taskWithServices?.serviceOrders || [];

        // Create the service order with createdById
        // Convert description to Title Case for consistency
        const createData: any = {
          ...data,
          description: this.toTitleCase(data.description),
          createdById: userId || '',
        };

        // Auto-complete new SOs added to COMPLETED tasks
        if (taskWithServices?.status === TASK_STATUS.COMPLETED) {
          this.logger.log(
            `[AUTO-COMPLETE SO] Task ${data.taskId} is COMPLETED, auto-completing new service order`,
          );
          createData.status = SERVICE_ORDER_STATUS.COMPLETED;
          createData.statusOrder = 4;
          createData.startedAt = new Date();
          createData.startedById = userId || '';
          createData.lastStartedAt = new Date();
          createData.finishedAt = new Date();
          createData.completedById = userId || '';
        }

        // Auto-set timing for SOs created directly as IN_PROGRESS
        if (createData.status === SERVICE_ORDER_STATUS.IN_PROGRESS) {
          if (!createData.startedAt) {
            createData.startedAt = new Date();
            createData.startedById = createData.startedById || userId || '';
          }
          if (!createData.lastStartedAt) {
            createData.lastStartedAt = new Date();
          }
        }

        const created = await this.serviceOrderRepository.createWithTransaction(tx, createData, {
          include,
        });

        // Log the creation
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: created.id,
          action: CHANGE_ACTION.CREATE,
          entity: created,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          reason: 'Ordem de serviço criada',
          transaction: tx,
        });

        // Build new services array by adding the created service order
        const serializeServices = (services: any[]) => {
          return services.map((s: any) => ({
            description: s.description,
            status: s.status,
            ...(s.startedAt && { startedAt: s.startedAt }),
            ...(s.finishedAt && { finishedAt: s.finishedAt }),
          }));
        };

        // Add the newly created service order to the old services array
        const newServices = [
          ...oldServices,
          {
            description: created.description,
            status: created.status,
            startedAt: created.startedAt,
            finishedAt: created.finishedAt,
          },
        ];

        // Log task serviceOrders field change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.TASK,
          entityId: data.taskId,
          action: CHANGE_ACTION.UPDATE,
          field: 'serviceOrders',
          oldValue: serializeServices(oldServices),
          newValue: serializeServices(newServices),
          reason: `Ordem de serviço adicionada (${oldServices.length} → ${newServices.length})`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: data.taskId,
          userId: userId || '',
          transaction: tx,
        });

        // =====================================================================
        // SYNC: Production Service Order → Task Quote Item
        // When a PRODUCTION service order is created, automatically create
        // a corresponding quote item (description + observation → item description)
        // =====================================================================
        if (created.type === SERVICE_ORDER_TYPE.PRODUCTION) {
          try {
            // Get task's quote information
            const taskWithQuote = await tx.task.findUnique({
              where: { id: data.taskId },
              include: {
                quote: {
                  include: {
                    services: true,
                    // A trava do dinheiro precisa das cobranças; ver abaixo.
                    billings: { select: { approvedAt: true, status: true } },
                  },
                },
              },
            });

            // ⛔ Orçamento com cobrança aprovada não ganha linha nova. Acrescentar
            // um serviço aqui recalcularia o total de um contrato cuja NFS-e já
            // foi autorizada e cujo boleto já foi registrado — a O.S. de produção
            // é criada, mas o dinheiro do contrato não se mexe mais.
            if (taskWithQuote?.quote && isQuoteMoneyLocked(taskWithQuote.quote.billings)) {
              this.logger.log(
                `[SO→QUOTE SYNC] Skipped: quote ${taskWithQuote.quote.id} já tem cobrança aprovada`,
              );
            } else if (taskWithQuote?.quote) {
              const existingQuoteItems: SyncQuoteItem[] = (taskWithQuote.quote.services || []).map(
                (item: any) => ({
                  id: item.id,
                  description: item.description,
                  observation: item.observation,
                  amount: item.amount,
                }),
              );

              // Check if we should create a quote item
              const syncResult = getServiceOrderToQuoteSync(
                {
                  id: created.id,
                  description: created.description,
                  observation: created.observation,
                  type: created.type,
                },
                existingQuoteItems,
              );

              if (syncResult.shouldCreateQuoteItem) {
                this.logger.log(
                  `[SO→QUOTE SYNC] Creating quote item: "${syncResult.quoteItemDescription}" for SO "${created.description}"`,
                );

                await tx.budgetItem.create({
                  data: {
                    quoteId: taskWithQuote.quote.id,
                    description: syncResult.quoteItemDescription,
                    observation: syncResult.quoteItemObservation,
                    amount: syncResult.quoteItemAmount,
                  },
                });

                // Recalculate quote totals (discount-aware, keeps the aggregate
                // Budget and every BudgetPayer in sync). A naive
                // subtotal=total=sum here wiped customer discounts and left the
                // configs drifting from the aggregate.
                await recalcQuoteTotals(tx, taskWithQuote.quote.id);
                quotesContentChanged.add(taskWithQuote.quote.id);

                this.logger.log(
                  `[SO→QUOTE SYNC] Quote item created. Recalculated totals for quote ${taskWithQuote.quote.id}`,
                );
              } else {
                this.logger.log(`[SO→QUOTE SYNC] Skipped: ${syncResult.reason}`);
              }
            } else {
              this.logger.log(`[SO→QUOTE SYNC] Skipped: Task ${data.taskId} has no quote`);
            }
          } catch (syncError) {
            this.logger.error('[SO→QUOTE SYNC] Error during sync:', syncError);
            // Don't throw - sync errors shouldn't block service order creation
          }
        }

        return created;
      });

      // Commitado: o orçamento já tem a linha nova, então o motor de assinatura
      // lê a verdade e não a lista anterior.
      await this.notifyQuoteContentChanged(quotesContentChanged, userId);

      // Emit events after successful creation
      this.eventEmitter.emit('service_order.created', {
        serviceOrder,
        userId,
      });

      // If service order is assigned, emit assignment event
      if (serviceOrder.assignedToId) {
        this.eventEmitter.emit('service_order.assigned', {
          serviceOrder,
          userId,
          assignedToId: serviceOrder.assignedToId,
        });
      }

      return {
        success: true,
        message: 'Ordem de serviço criada com sucesso.',
        data: serviceOrder,
      };
    } catch (error) {
      this.logger.error('Erro ao criar ordem de serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing service order
   */
  async update(
    id: string,
    data: ServiceOrderUpdateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
    userPrivilege?: string,
    isTeamLeader?: boolean,
  ): Promise<ServiceOrderUpdateResponse> {
    try {
      const serviceOrderExists = await this.serviceOrderRepository.findById(id);
      if (!serviceOrderExists) {
        throw new NotFoundException(
          'Ordem de serviço não encontrada. Verifique se o ID está correto.',
        );
      }

      // Check permissions before allowing update
      if (userId && userPrivilege) {
        const isStatusChange =
          data.status !== undefined && data.status !== serviceOrderExists.status;
        assertCanUpdateServiceOrder(
          serviceOrderExists,
          userId,
          userPrivilege,
          data.status as SERVICE_ORDER_STATUS,
          isStatusChange,
          isTeamLeader,
        );
      }

      // If updating taskId, validate it exists
      if (data.taskId) {
        const taskExists = await this.prisma.task.findUnique({
          where: { id: data.taskId },
        });

        if (!taskExists) {
          throw new NotFoundException('Tarefa não encontrada. Verifique se o ID está correto.');
        }
      }

      // If updating assignedToId, validate user exists
      if (data.assignedToId) {
        const userExists = await this.prisma.user.findUnique({
          where: { id: data.assignedToId },
        });

        if (!userExists) {
          throw new NotFoundException(
            'Usuário atribuído não encontrado. Verifique se o ID está correto.',
          );
        }
      }

      // Track if task was auto-started for event emission after transaction
      let taskAutoStarted: {
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      } | null = null;
      // Track if task was auto-transitioned to WAITING_PRODUCTION for event emission after transaction
      let taskAutoTransitionedToWaitingProduction: {
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      } | null = null;
      // Track if task was auto-completed for event emission after transaction
      let taskAutoCompleted: {
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      } | null = null;
      // Track if task was rolled back for event emission after transaction
      let taskRolledBack: {
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      } | null = null;
      // ORÇAMENTOS CUJAS COBRANÇAS PRECISAM SER RECALCULADAS depois do commit.
      //
      // `Billing.status` é DERIVADO do status do orçamento e das parcelas, e
      // cancelar ou restaurar um orçamento muda a primeira metade dessa conta.
      // Nada aqui recalculava: cancelar deixava as cobranças no estado anterior,
      // e restaurar as deixava CANCELADAS PARA SEMPRE — a varredura diária
      // (`budget-payment.scheduler.ts`) não varre orçamento cancelado, então
      // não havia nem caminho lento que consertasse depois.
      //
      // Depois do COMMIT, e não dentro da transação: a cascata lê por outra
      // conexão e enxergaria o status ANTIGO do orçamento, devolvendo exatamente
      // o estado que acabamos de mudar.
      const billingQuotesToRecompute = new Set<string>();
      // ORÇAMENTOS CUJA LISTA DE SERVIÇOS FOI REESCRITA por este espelho. O motor
      // de assinatura precisa saber — ver `notifyQuoteContentChanged`.
      const quotesContentChanged = new Set<string>();

      const serviceOrder = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const oldData = serviceOrderExists;

        // Build the update data with automatic user tracking based on status changes
        // Convert description to Title Case if provided
        const updateData: any = {
          ...data,
          ...(data.description && { description: this.toTitleCase(data.description) }),
        };

        const now = new Date();

        // ── IN_PROGRESS (any entry: first start, resume from PAUSED, rejection from WAITING_APPROVE/COMPLETED) ──
        if (
          data.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
          oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS
        ) {
          if (!oldData.startedById) {
            updateData.startedById = userId || null;
            updateData.startedAt = now;
          }
          // Always refresh lastStartedAt so the live timer has the correct session origin
          updateData.lastStartedAt = now;

          if (oldData.status === SERVICE_ORDER_STATUS.PAUSED) {
            updateData.pausedById = null;
            updateData.pausedAt = null;
          }

          if (
            oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE ||
            oldData.status === SERVICE_ORDER_STATUS.COMPLETED
          ) {
            if (oldData.status === SERVICE_ORDER_STATUS.COMPLETED) {
              updateData.completedById = null;
              updateData.finishedAt = null;
            }
          }
        }

        // ── WAITING_APPROVE (artwork submission — worker stops, accumulate time) ──
        if (
          data.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
          oldData.status === SERVICE_ORDER_STATUS.IN_PROGRESS
        ) {
          const sessionStart = oldData.lastStartedAt ?? oldData.startedAt;
          if (sessionStart) {
            const worked = calculateWorkingSeconds(sessionStart, now);
            updateData.totalActiveTimeSeconds = (oldData.totalActiveTimeSeconds ?? 0) + worked;
            this.logger.log(
              `[TIMING] SO ${id}: WAITING_APPROVE accumulate ${worked}s (total ${updateData.totalActiveTimeSeconds}s)`,
            );
          }
        }

        // ── WAITING_APPROVE exit (approval or rejection) ──
        if (
          oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
          data.status &&
          data.status !== SERVICE_ORDER_STATUS.WAITING_APPROVE
        ) {
          if (
            data.status === SERVICE_ORDER_STATUS.COMPLETED ||
            data.status === SERVICE_ORDER_STATUS.IN_PROGRESS
          ) {
            if (!oldData.approvedById) {
              updateData.approvedById = userId || null;
              updateData.approvedAt = now;
            }
          }
        }

        // ── PAUSED (accumulate working time for this session) ──
        if (
          data.status === SERVICE_ORDER_STATUS.PAUSED &&
          oldData.status !== SERVICE_ORDER_STATUS.PAUSED
        ) {
          updateData.pausedById = userId || null;
          updateData.pausedAt = now;
          const sessionStart = oldData.lastStartedAt ?? oldData.startedAt;
          if (sessionStart) {
            const worked = calculateWorkingSeconds(sessionStart, now);
            updateData.totalActiveTimeSeconds = (oldData.totalActiveTimeSeconds ?? 0) + worked;
            this.logger.log(
              `[TIMING] SO ${id}: PAUSED accumulate ${worked}s (total ${updateData.totalActiveTimeSeconds}s)`,
            );
          }
        }

        // ── COMPLETED ──
        if (
          data.status === SERVICE_ORDER_STATUS.COMPLETED &&
          oldData.status !== SERVICE_ORDER_STATUS.COMPLETED
        ) {
          if (!oldData.completedById) {
            updateData.completedById = userId || null;
            updateData.finishedAt = now;
          }
          if (!oldData.startedById) {
            updateData.startedById = userId || null;
            updateData.startedAt = updateData.finishedAt ?? now;
          }

          // Clear any lingering pause state (completing from PAUSED)
          if (oldData.pausedAt) {
            updateData.pausedAt = null;
            updateData.pausedById = null;
          }

          // Accumulate working time only when the SO was actively running at completion
          // (PAUSED state already accumulated its time at pause; WAITING_APPROVE did so at submission)
          if (
            oldData.status === SERVICE_ORDER_STATUS.IN_PROGRESS ||
            (oldData.status !== SERVICE_ORDER_STATUS.PAUSED &&
              oldData.status !== SERVICE_ORDER_STATUS.WAITING_APPROVE)
          ) {
            const sessionStart = oldData.lastStartedAt ?? oldData.startedAt;
            if (sessionStart) {
              const worked = calculateWorkingSeconds(sessionStart, updateData.finishedAt ?? now);
              if (worked > 0) {
                updateData.totalActiveTimeSeconds = (oldData.totalActiveTimeSeconds ?? 0) + worked;
                this.logger.log(
                  `[TIMING] SO ${id}: COMPLETED accumulate ${worked}s (total ${updateData.totalActiveTimeSeconds}s)`,
                );
              }
            }
          }
        }

        // ── PENDING rollback (full reset) ──
        if (
          data.status === SERVICE_ORDER_STATUS.PENDING &&
          oldData.status !== SERVICE_ORDER_STATUS.PENDING
        ) {
          this.logger.log(
            `[SERVICE ORDER ROLLBACK] Clearing all dates for SO ${id}: ${oldData.status} → PENDING`,
          );
          updateData.startedById = null;
          updateData.startedAt = null;
          updateData.approvedById = null;
          updateData.approvedAt = null;
          updateData.completedById = null;
          updateData.finishedAt = null;
          updateData.pausedById = null;
          updateData.pausedAt = null;
          updateData.lastStartedAt = null;
          updateData.totalActiveTimeSeconds = 0;
        }

        const updated = await this.serviceOrderRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          {
            include,
          },
        );

        // Track field-level changes - include new fields
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: id,
          oldEntity: oldData,
          newEntity: updated,
          fieldsToTrack: [
            'status',
            'description',
            'observation',
            'taskId',
            'startedAt',
            'startedById',
            'approvedAt',
            'approvedById',
            'finishedAt',
            'completedById',
            'type',
            'assignedToId',
          ],
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Auto-start task when PRODUCTION service order is started and task is waiting for production
        // This ensures the task workflow progresses automatically when work begins
        // NOTE: Only PRODUCTION type service orders trigger task auto-start, not ARTWORK
        if (
          data.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
          oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS &&
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true },
          });

          // If task is WAITING_PRODUCTION, auto-start it
          if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
            this.logger.log(
              `[AUTO-START] Service order ${id} started, auto-starting task ${task.id} (WAITING_PRODUCTION → IN_PRODUCTION)`,
            );

            await tx.task.update({
              where: { id: task.id },
              data: {
                status: TASK_STATUS.IN_PRODUCTION,
                startedAt: new Date(),
              },
            });

            // Log the auto-start in changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: task.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'status',
              oldValue: TASK_STATUS.WAITING_PRODUCTION,
              newValue: TASK_STATUS.IN_PRODUCTION,
              reason: `Tarefa iniciada automaticamente quando ordem de serviço "${updated.description}" foi iniciada`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });

            // Track for event emission after transaction commits
            taskAutoStarted = {
              taskId: task.id,
              oldStatus: TASK_STATUS.WAITING_PRODUCTION,
              newStatus: TASK_STATUS.IN_PRODUCTION,
            };
          }
        }

        // Auto-transition task from PREPARATION to WAITING_PRODUCTION when at least one ARTWORK
        // service order is COMPLETED AND all COMMERCIAL service orders are concluded.
        // Triggered by either an artwork or a commercial SO completing. The commercial gate only
        // blocks the AUTOMATIC transition — an explicit "Disponibilizar para produção" bypasses it.
        if (
          data.status === SERVICE_ORDER_STATUS.COMPLETED &&
          oldData.status !== SERVICE_ORDER_STATUS.COMPLETED &&
          (updated.type === SERVICE_ORDER_TYPE.ARTWORK ||
            updated.type === SERVICE_ORDER_TYPE.COMMERCIAL)
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true },
          });

          // Only proceed if task is in PREPARATION status
          if (task && task.status === TASK_STATUS.PREPARATION) {
            // Evaluate the full preparation gate over the task's service orders
            // (the just-updated SO is already visible inside this transaction)
            const taskServiceOrders = await tx.serviceOrder.findMany({
              where: { taskId: updated.taskId },
              select: { id: true, status: true, type: true },
            });

            const anyArtworkCompleted = taskServiceOrders.some(
              so =>
                so.type === SERVICE_ORDER_TYPE.ARTWORK &&
                so.status === SERVICE_ORDER_STATUS.COMPLETED,
            );
            const allCommercialCompleted = areCommercialServiceOrdersComplete(
              taskServiceOrders.map(so => ({
                status: so.status as SERVICE_ORDER_STATUS,
                type: so.type as SERVICE_ORDER_TYPE,
              })),
            );

            if (anyArtworkCompleted && allCommercialCompleted) {
              this.logger.log(
                `[AUTO-TRANSITION] ${updated.type} service order ${id} completed for task ${task.id} (artwork done, commercial done), transitioning PREPARATION → WAITING_PRODUCTION`,
              );

              await tx.task.update({
                where: { id: task.id },
                data: {
                  status: TASK_STATUS.WAITING_PRODUCTION,
                  statusOrder: 2, // WAITING_PRODUCTION statusOrder
                },
              });

              // Log the auto-transition in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: TASK_STATUS.PREPARATION,
                newValue: TASK_STATUS.WAITING_PRODUCTION,
                reason: `Tarefa liberada automaticamente para produção quando ordem de serviço ${updated.type === SERVICE_ORDER_TYPE.COMMERCIAL ? 'comercial' : 'de arte'} "${updated.description}" foi concluída`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskAutoTransitionedToWaitingProduction = {
                taskId: task.id,
                oldStatus: TASK_STATUS.PREPARATION,
                newStatus: TASK_STATUS.WAITING_PRODUCTION,
              };
            } else {
              this.logger.log(
                `[AUTO-TRANSITION] Task ${task.id} stays in PREPARATION (artwork completed: ${anyArtworkCompleted}, commercial completed: ${allCommercialCompleted})`,
              );
            }
          }
        }

        // NOTE: Task is NO LONGER auto-completed when all production SOs finish.
        // Only the logistics sector can finish/complete tasks manually.

        // =====================================================================
        // AUTO-COMPLETE TASK WHEN SERVICE ORDER IS CANCELLED
        // When a PRODUCTION service order is cancelled, check if all remaining
        // active (non-cancelled) production orders are completed - if so, complete the task
        // =====================================================================
        if (
          data.status === SERVICE_ORDER_STATUS.CANCELLED &&
          oldData.status !== SERVICE_ORDER_STATUS.CANCELLED &&
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true, finishedAt: true },
          });

          // Only proceed if task is in IN_PRODUCTION or WAITING_PRODUCTION status
          if (
            task &&
            (task.status === TASK_STATUS.IN_PRODUCTION ||
              task.status === TASK_STATUS.WAITING_PRODUCTION)
          ) {
            // Get all PRODUCTION service orders for this task
            const productionServiceOrders = await tx.serviceOrder.findMany({
              where: {
                taskId: updated.taskId,
                type: SERVICE_ORDER_TYPE.PRODUCTION,
              },
              select: { id: true, status: true },
            });

            // Filter out CANCELLED orders - they don't block task completion
            const activeProductionOrders = productionServiceOrders.filter(
              so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
            );

            // Check if there are any active (non-cancelled) production service orders
            const hasActiveProductionOrders = activeProductionOrders.length > 0;

            // If ALL production orders are now cancelled, rollback task (not cancel - only COMMERCIAL cancellation cancels task)
            if (!hasActiveProductionOrders && productionServiceOrders.length > 0) {
              // If task is IN_PRODUCTION, rollback to WAITING_PRODUCTION
              if (task.status === TASK_STATUS.IN_PRODUCTION) {
                this.logger.log(
                  `[ROLLBACK TASK ON ALL PRODUCTION SO CANCEL] All ${productionServiceOrders.length} PRODUCTION service orders cancelled for task ${task.id}, rolling back to WAITING_PRODUCTION`,
                );

                const oldTaskStatus = task.status as TASK_STATUS;
                await tx.task.update({
                  where: { id: task.id },
                  data: {
                    status: TASK_STATUS.WAITING_PRODUCTION,
                    statusOrder: 2, // WAITING_PRODUCTION statusOrder
                    startedAt: null, // Clear start date on rollback
                  },
                });

                // Log the task rollback in changelog
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: oldTaskStatus,
                  newValue: TASK_STATUS.WAITING_PRODUCTION,
                  reason: `Tarefa retornada para aguardando produção pois todas as ${productionServiceOrders.length} ordens de serviço de produção foram canceladas`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });

                // Track for event emission after transaction commits
                taskAutoCompleted = {
                  taskId: task.id,
                  oldStatus: oldTaskStatus,
                  newStatus: TASK_STATUS.WAITING_PRODUCTION,
                };
              }
              // If task is not IN_PRODUCTION, don't change task status
            }
            // NOTE: Task is NO LONGER auto-completed when remaining active SOs are all completed.
            // Only the logistics sector can finish/complete tasks manually.
          }
        }

        // =====================================================================
        // AUTO-CANCEL TASK WHEN ALL COMMERCIAL SERVICE ORDERS ARE CANCELLED
        // When a COMMERCIAL service order is cancelled, check if ALL commercial
        // orders are now cancelled - if so, cancel task and all other service orders
        // =====================================================================
        if (
          data.status === SERVICE_ORDER_STATUS.CANCELLED &&
          oldData.status !== SERVICE_ORDER_STATUS.CANCELLED &&
          updated.type === SERVICE_ORDER_TYPE.COMMERCIAL
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true },
          });

          // Only proceed if task is not already cancelled
          if (task && task.status !== TASK_STATUS.CANCELLED) {
            // Get all COMMERCIAL service orders for this task
            const commercialServiceOrders = await tx.serviceOrder.findMany({
              where: {
                taskId: updated.taskId,
                type: SERVICE_ORDER_TYPE.COMMERCIAL,
              },
              select: { id: true, status: true },
            });

            // Filter out CANCELLED orders
            const activeCommercialOrders = commercialServiceOrders.filter(
              so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
            );

            // If ALL commercial orders are now cancelled, cancel the task and all other service orders
            if (activeCommercialOrders.length === 0 && commercialServiceOrders.length > 0) {
              this.logger.log(
                `[AUTO-CANCEL TASK ON ALL COMMERCIAL SO CANCEL] All ${commercialServiceOrders.length} COMMERCIAL service orders cancelled for task ${task.id}, cancelling task and all remaining service orders`,
              );

              // I18: never strand live billing. If the quote already produced
              // non-cancelled fiscal records (Invoice / boletos / NFS-e), an
              // implicit auto-cancel here would leave them live on a CANCELLED
              // task. Block and require the operator to revert the billing first —
              // never destroy fiscal documents as a side effect of cancelling a
              // negotiation service order.
              // Escopo por ORÇAMENTO — ver `hasLiveBillingForTask`.
              if (await this.hasLiveBillingForTask(tx, task.id)) {
                throw new BadRequestException(
                  'Não é possível cancelar a tarefa: o faturamento já foi aprovado (existem faturas, boletos ou NFS-e ativos). Reverta o faturamento antes de cancelar as ordens de serviço comerciais.',
                );
              }

              // The guard above ensured no live billing, so cascade-cancel the
              // (draft) quote with a clean status flip — keeps task and quote in
              // sync when the task is auto-cancelled.
              const quoteForCancel = await tx.task.findUnique({
                where: { id: task.id },
                select: { quote: { select: { id: true, status: true } } },
              });
              const qfc = (quoteForCancel as any)?.quote;
              if (qfc && qfc.status !== TASK_QUOTE_STATUS.CANCELLED) {
                await tx.budget.update({
                  where: { id: qfc.id },
                  data: {
                    status: TASK_QUOTE_STATUS.CANCELLED,
                    statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.CANCELLED],
                  },
                });
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK_QUOTE,
                  entityId: qfc.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: qfc.status,
                  newValue: TASK_QUOTE_STATUS.CANCELLED,
                  reason: 'Orçamento cancelado automaticamente pelo cancelamento da tarefa',
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });
                // Orçamento cancelado cancela as cobranças dele — mas quem
                // escreve `Billing.status` é a cascata, depois do commit.
                billingQuotesToRecompute.add(qfc.id);
              }

              const oldTaskStatus = task.status as TASK_STATUS;
              await tx.task.update({
                where: { id: task.id },
                data: {
                  status: TASK_STATUS.CANCELLED,
                  statusOrder: 5, // CANCELLED statusOrder
                },
              });

              // Cancel all remaining non-cancelled service orders (PRODUCTION, COMMERCIAL, ARTWORK, LOGISTIC)
              const otherServiceOrders = await tx.serviceOrder.findMany({
                where: {
                  taskId: task.id,
                  status: { not: SERVICE_ORDER_STATUS.CANCELLED },
                },
                select: { id: true, status: true, type: true },
              });

              for (const otherSO of otherServiceOrders) {
                await tx.serviceOrder.update({
                  where: { id: otherSO.id },
                  data: {
                    status: SERVICE_ORDER_STATUS.CANCELLED,
                    statusOrder: 5,
                  },
                });

                // Log each service order cancellation
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.SERVICE_ORDER,
                  entityId: otherSO.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: otherSO.status,
                  newValue: SERVICE_ORDER_STATUS.CANCELLED,
                  reason: `Ordem de serviço ${otherSO.type} cancelada automaticamente pois todas as ordens de serviço comerciais foram canceladas`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });
              }

              // Log the task cancellation in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: oldTaskStatus,
                newValue: TASK_STATUS.CANCELLED,
                reason: `Tarefa cancelada automaticamente pois todas as ${commercialServiceOrders.length} ordens de serviço comerciais foram canceladas`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskAutoCompleted = {
                taskId: task.id,
                oldStatus: oldTaskStatus,
                newStatus: TASK_STATUS.CANCELLED,
              };
            }
          }
        }

        // =====================================================================
        // ROLLBACK SYNC: COMMERCIAL Service Order Un-Cancelled → Task Status Rollback
        // When a COMMERCIAL service order goes from CANCELLED to any other status,
        // check if task should rollback from CANCELLED to the correct status based on
        // all service orders (ARTWORK + PRODUCTION)
        // =====================================================================
        if (
          data.status &&
          data.status !== SERVICE_ORDER_STATUS.CANCELLED &&
          oldData.status === SERVICE_ORDER_STATUS.CANCELLED &&
          updated.type === SERVICE_ORDER_TYPE.COMMERCIAL
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true },
          });

          // Only rollback if task is currently CANCELLED
          if (task && task.status === TASK_STATUS.CANCELLED) {
            // Desfaz o RESTO da cascata (orçamento + demais OSs) antes de
            // recalcular: o status correto da tarefa depende das OSs restauradas.
            const orcamentosRestaurados = await this.restoreCascadeFromCommercialCancel(
              tx,
              task.id,
              id,
              userId || null,
            );
            // O orçamento voltou do CANCELADO; as cobranças dele não voltam
            // sozinhas. Ver `billingQuotesToRecompute`.
            for (const qid of orcamentosRestaurados) billingQuotesToRecompute.add(qid);

            // Get all service orders for this task to calculate correct status
            const allServiceOrders = await tx.serviceOrder.findMany({
              where: { taskId: updated.taskId },
              select: { id: true, status: true, type: true },
            });

            // Calculate the correct task status based on all service orders
            const correctStatus = calculateCorrectTaskStatus(
              allServiceOrders.map(so => ({
                status: so.status as SERVICE_ORDER_STATUS,
                type: so.type as SERVICE_ORDER_TYPE,
              })),
            );

            this.logger.log(
              `[COMMERCIAL ROLLBACK] Commercial service order ${id} un-cancelled (${oldData.status} → ${data.status}), rolling back task ${task.id} from CANCELLED to ${correctStatus}`,
            );

            const oldTaskStatus = task.status as TASK_STATUS;
            const newStatusOrder =
              correctStatus === TASK_STATUS.PREPARATION
                ? 1
                : correctStatus === TASK_STATUS.WAITING_PRODUCTION
                  ? 2
                  : correctStatus === TASK_STATUS.IN_PRODUCTION
                    ? 3
                    : correctStatus === TASK_STATUS.COMPLETED
                      ? 4
                      : 5;

            await tx.task.update({
              where: { id: task.id },
              data: {
                status: correctStatus,
                statusOrder: newStatusOrder,
              },
            });

            // Log the rollback in changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TASK,
              entityId: task.id,
              action: CHANGE_ACTION.UPDATE,
              field: 'status',
              oldValue: oldTaskStatus,
              newValue: correctStatus,
              reason: `Tarefa retornada para ${correctStatus === TASK_STATUS.PREPARATION ? 'preparação' : correctStatus === TASK_STATUS.WAITING_PRODUCTION ? 'aguardando produção' : correctStatus === TASK_STATUS.IN_PRODUCTION ? 'em produção' : 'concluída'} pois ordem de serviço comercial foi reativada`,
              triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
              triggeredById: id,
              userId: userId || '',
              transaction: tx,
            });

            // Track for event emission after transaction commits
            taskRolledBack = {
              taskId: task.id,
              oldStatus: oldTaskStatus,
              newStatus: correctStatus,
            };
          }
        }

        // =====================================================================
        // ROLLBACK SYNC: ARTWORK Service Order Rollback → Task Status Rollback
        // When an ARTWORK service order goes backwards from COMPLETED, check if task
        // should rollback from WAITING_PRODUCTION to PREPARATION
        // Only rollback if NO artwork service orders remain completed
        // =====================================================================
        if (
          updated.type === SERVICE_ORDER_TYPE.ARTWORK &&
          data.status &&
          oldData.status === SERVICE_ORDER_STATUS.COMPLETED &&
          data.status !== SERVICE_ORDER_STATUS.COMPLETED
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true },
          });

          // Only rollback if task is currently in WAITING_PRODUCTION
          if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
            // Get all ARTWORK service orders to check if any are still completed
            const artworkServiceOrders = await tx.serviceOrder.findMany({
              where: {
                taskId: updated.taskId,
                type: SERVICE_ORDER_TYPE.ARTWORK,
              },
              select: { id: true, status: true },
            });

            // Only rollback task if NO artwork SOs remain completed
            // If at least one artwork is still completed, keep task in WAITING_PRODUCTION
            const anyArtworkCompleted = artworkServiceOrders.some(
              so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
            );

            if (!anyArtworkCompleted) {
              this.logger.log(
                `[ARTWORK ROLLBACK] Artwork service order ${id} rolled back from COMPLETED to ${data.status}, no artwork orders remain completed, rolling back task ${task.id} from WAITING_PRODUCTION to PREPARATION`,
              );

              await tx.task.update({
                where: { id: task.id },
                data: {
                  status: TASK_STATUS.PREPARATION,
                  statusOrder: 1, // PREPARATION statusOrder
                },
              });

              // Log the rollback in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: TASK_STATUS.WAITING_PRODUCTION,
                newValue: TASK_STATUS.PREPARATION,
                reason: `Tarefa retornada para preparação pois nenhuma ordem de serviço de arte permanece concluída`,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskRolledBack = {
                taskId: task.id,
                oldStatus: TASK_STATUS.WAITING_PRODUCTION,
                newStatus: TASK_STATUS.PREPARATION,
              };
            }
          }
        }

        // =====================================================================
        // ROLLBACK SYNC: Service Order Status Rollback → Task Status Rollback
        // When a production service order goes backwards, sync task status accordingly
        // =====================================================================
        if (
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION &&
          data.status &&
          isStatusRollback(
            oldData.status as SERVICE_ORDER_STATUS,
            data.status as SERVICE_ORDER_STATUS,
          )
        ) {
          // Get the task with its current status
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true, finishedAt: true },
          });

          if (task) {
            // Get ALL service orders for this task to determine the new task status
            const allServiceOrders = await tx.serviceOrder.findMany({
              where: { taskId: updated.taskId },
              select: { id: true, status: true, type: true },
            });

            // Use the sync utility to determine if task needs to be updated
            const taskUpdate = getTaskUpdateForServiceOrderStatusChange(
              allServiceOrders.map(so => ({
                id: so.id,
                status: so.status as SERVICE_ORDER_STATUS,
                type: so.type as SERVICE_ORDER_TYPE,
              })),
              updated.id,
              oldData.status as SERVICE_ORDER_STATUS,
              data.status as SERVICE_ORDER_STATUS,
              task.status as TASK_STATUS,
            );

            if (taskUpdate && taskUpdate.shouldUpdate && taskUpdate.newTaskStatus) {
              this.logger.log(
                `[SO→TASK ROLLBACK] Service order ${id} rolled back ${oldData.status} → ${data.status}, updating task ${task.id}: ${task.status} → ${taskUpdate.newTaskStatus}`,
              );

              const taskUpdateData: any = {
                status: taskUpdate.newTaskStatus,
                statusOrder: getTaskStatusOrder(taskUpdate.newTaskStatus),
              };

              // Handle date fields based on update flags
              if (taskUpdate.setStartedAt && !task.startedAt) {
                taskUpdateData.startedAt = new Date();
              }
              if (taskUpdate.setFinishedAt && !task.finishedAt) {
                taskUpdateData.finishedAt = new Date();
              }
              if (taskUpdate.clearStartedAt) {
                taskUpdateData.startedAt = null;
              }
              if (taskUpdate.clearFinishedAt) {
                taskUpdateData.finishedAt = null;
              }

              await tx.task.update({
                where: { id: task.id },
                data: taskUpdateData,
              });

              // Log the rollback in changelog
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.TASK,
                entityId: task.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'status',
                oldValue: task.status,
                newValue: taskUpdate.newTaskStatus,
                reason: taskUpdate.reason,
                triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                triggeredById: id,
                userId: userId || '',
                transaction: tx,
              });

              // Track for event emission after transaction commits
              taskRolledBack = {
                taskId: task.id,
                oldStatus: task.status as TASK_STATUS,
                newStatus: taskUpdate.newTaskStatus as TASK_STATUS,
              };
            }
          }
        }

        // =====================================================================
        // COMPREHENSIVE TASK STATUS SYNC (Catch-all)
        // After all specific sync checks, verify the task status is correct
        // based on all production service orders. This handles edge cases
        // that might be missed by the specific conditions above.
        // =====================================================================
        if (
          updated.type === SERVICE_ORDER_TYPE.PRODUCTION &&
          data.status &&
          !taskAutoCompleted && // Don't re-check if already auto-completed
          !taskRolledBack // Don't re-check if already rolled back
        ) {
          const task = await tx.task.findUnique({
            where: { id: updated.taskId },
            select: { id: true, status: true, startedAt: true, finishedAt: true },
          });

          if (
            task &&
            task.status !== TASK_STATUS.PREPARATION &&
            task.status !== TASK_STATUS.CANCELLED
          ) {
            // Get all service orders for this task
            const allServiceOrders = await tx.serviceOrder.findMany({
              where: { taskId: updated.taskId },
              select: { id: true, status: true, type: true },
            });

            // Filter production service orders and exclude CANCELLED
            const activeProductionOrders = allServiceOrders
              .filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION)
              .filter(so => so.status !== SERVICE_ORDER_STATUS.CANCELLED);

            if (activeProductionOrders.length > 0) {
              const allPending = activeProductionOrders.every(
                so => so.status === SERVICE_ORDER_STATUS.PENDING,
              );
              const anyInProgress = activeProductionOrders.some(
                so => so.status === SERVICE_ORDER_STATUS.IN_PROGRESS,
              );
              const anyCompleted = activeProductionOrders.some(
                so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
              );

              let expectedStatus: TASK_STATUS | null = null;

              // NOTE: Task is NOT auto-completed when all production SOs finish.
              // Only PRODUCTION_MANAGER or ADMIN can manually finish/complete tasks.
              if (anyInProgress || anyCompleted) {
                expectedStatus = TASK_STATUS.IN_PRODUCTION;
              } else if (allPending) {
                expectedStatus = TASK_STATUS.WAITING_PRODUCTION;
              }

              // If expected status differs from current, update the task (but never auto-complete)
              if (
                expectedStatus &&
                expectedStatus !== task.status &&
                task.status !== TASK_STATUS.COMPLETED
              ) {
                this.logger.log(
                  `[COMPREHENSIVE SYNC] Task ${task.id} status mismatch: current=${task.status}, expected=${expectedStatus}. Updating...`,
                );

                const taskUpdateData: any = {
                  status: expectedStatus,
                  statusOrder: getTaskStatusOrder(expectedStatus),
                };

                // Handle dates based on status change
                if (expectedStatus === TASK_STATUS.IN_PRODUCTION) {
                  if (!task.startedAt) taskUpdateData.startedAt = new Date();
                } else if (expectedStatus === TASK_STATUS.WAITING_PRODUCTION) {
                  taskUpdateData.startedAt = null;
                  taskUpdateData.finishedAt = null;
                }

                await tx.task.update({
                  where: { id: task.id },
                  data: taskUpdateData,
                });

                // Log the sync in changelog
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.TASK,
                  entityId: task.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'status',
                  oldValue: task.status,
                  newValue: expectedStatus,
                  reason: `Status da tarefa sincronizado automaticamente com base nas ordens de serviço de produção`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                  triggeredById: id,
                  userId: userId || '',
                  transaction: tx,
                });

                taskRolledBack = {
                  taskId: task.id,
                  oldStatus: task.status as TASK_STATUS,
                  newStatus: expectedStatus,
                };
              }
            }
          }
        }

        // I11: keep the mirrored priced quote line in sync with this SO edit
        // (description/observation rename or PRODUCTION type change). Non-fatal —
        // never roll back the SO update on a sync hiccup.
        try {
          const newType = (data.type ?? serviceOrderExists.type) as string;
          const newDescription =
            data.description !== undefined ? data.description : serviceOrderExists.description;
          const newObservation =
            data.observation !== undefined
              ? data.observation
              : (serviceOrderExists as any).observation;
          await this.syncQuoteServiceForUpdatedSO(
            tx,
            serviceOrderExists as any,
            {
              id,
              taskId: (updated as any).taskId,
              type: newType,
              description: newDescription ?? null,
              observation: newObservation ?? null,
            },
            quotesContentChanged,
          );
        } catch (syncError) {
          this.logger.error(
            `[SO→Quote sync] Failed to sync quote line for updated SO ${id} (non-fatal):`,
            syncError,
          );
        }

        return updated;
      });

      // A lista de serviços mudou? Então o documento que o cliente assinou pode
      // já não descrever este orçamento. Antes do recálculo das cobranças, que é
      // best-effort e não deve atrasar esta pergunta.
      await this.notifyQuoteContentChanged(quotesContentChanged, userId);

      // AGORA o orçamento já está commitado, e a cascata lê a verdade nova.
      // Best-effort: recalcular estado derivado nunca pode derrubar a resposta
      // de uma atualização de O.S. que já foi gravada.
      for (const quoteId of billingQuotesToRecompute) {
        try {
          await this.billingStatusCascade.recomputeForQuote(quoteId);
        } catch (cascadeError) {
          this.logger.error(
            `[BILLING CASCADE] Falha ao recalcular as cobranças do orçamento ${quoteId}:`,
            cascadeError,
          );
        }
      }

      // Emit events after successful update
      // Check if status changed
      if (serviceOrderExists.status !== serviceOrder.status) {
        this.eventEmitter.emit('service_order.status.changed', {
          serviceOrder,
          oldStatus: serviceOrderExists.status,
          newStatus: serviceOrder.status,
          userId,
        });

        // If status changed to COMPLETED
        if (serviceOrder.status === SERVICE_ORDER_STATUS.COMPLETED) {
          this.eventEmitter.emit('service_order.completed', {
            serviceOrder,
            userId,
          });
        }

        // If status changed to WAITING_APPROVE and type is ARTWORK
        if (
          serviceOrder.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
          serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK
        ) {
          this.eventEmitter.emit('service_order.artwork_waiting_approval', {
            serviceOrder,
            userId,
          });
        }
      }

      // Check if assignedToId changed
      if (serviceOrderExists.assignedToId !== serviceOrder.assignedToId) {
        // If assigned to someone new (or reassigned)
        if (serviceOrder.assignedToId) {
          this.eventEmitter.emit('service_order.assigned', {
            serviceOrder,
            userId,
            assignedToId: serviceOrder.assignedToId,
            previousAssignedToId: serviceOrderExists.assignedToId,
          });
        }
      }

      // NOTE: the legacy 'service_order.assigned_user_updated' emit was removed
      // (2026-06-11 audit) — the event had no listener and no notification config.

      // Emit observation change event if observation changed
      if (serviceOrderExists.observation !== serviceOrder.observation) {
        this.eventEmitter.emit('service_order.observation.changed', {
          serviceOrder,
          oldObservation: serviceOrderExists.observation,
          newObservation: serviceOrder.observation,
          userId,
        });
      }

      // Emit task status changed event if task was auto-started
      if (taskAutoStarted) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoStarted.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the auto-start
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoStarted.oldStatus,
            newStatus: taskAutoStarted.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-START] Emitted task.status.changed event for task ${taskAutoStarted.taskId}`,
          );
        }
      }

      // Emit task status changed event if task was auto-transitioned to WAITING_PRODUCTION
      if (taskAutoTransitionedToWaitingProduction) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoTransitionedToWaitingProduction.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the auto-transition
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoTransitionedToWaitingProduction.oldStatus,
            newStatus: taskAutoTransitionedToWaitingProduction.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-TRANSITION] Emitted task.status.changed event for task ${taskAutoTransitionedToWaitingProduction.taskId} (PREPARATION → WAITING_PRODUCTION)`,
          );

          // NOTE: We previously emitted task.created here, but this was REMOVED because the
          // task.status.changed event already triggers 'task.ready_for_production' notification
          // via the TaskListener.handleTaskStatusChanged() method. Emitting task.created caused
          // DUPLICATE notifications for production users.
        }
      }

      // Emit task status changed event if task was auto-completed
      if (taskAutoCompleted) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoCompleted.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the auto-complete
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoCompleted.oldStatus,
            newStatus: taskAutoCompleted.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-COMPLETE TASK] Emitted task.status.changed event for task ${taskAutoCompleted.taskId} (${taskAutoCompleted.oldStatus} → ${taskAutoCompleted.newStatus})`,
          );
        }
      }

      // Emit task status changed event if task was rolled back
      if (taskRolledBack) {
        // Get the updated task with user info for the event
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskRolledBack.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        // Get the user who triggered the rollback
        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskRolledBack.oldStatus,
            newStatus: taskRolledBack.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[SO→TASK ROLLBACK] Emitted task.status.changed event for task ${taskRolledBack.taskId} (${taskRolledBack.oldStatus} → ${taskRolledBack.newStatus})`,
          );
        }
      }

      return {
        success: true,
        message: 'Ordem de serviço atualizada com sucesso.',
        data: serviceOrder,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar ordem de serviço:', error);
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * AVISA O MOTOR DE ASSINATURA DE QUE A LISTA DE SERVIÇOS MUDOU.
   *
   * Chamado DEPOIS DO COMMIT, sempre — `onQuoteContentChanged` remonta o recorte
   * canônico do orçamento lendo o banco por outra conexão, e de dentro da
   * transação ele enxergaria a lista ANTIGA e concluiria que nada mudou. É o
   * mesmo motivo (e o mesmo desenho) de `billingQuotesToRecompute`.
   *
   * Best-effort, como os demais ganchos pós-commit deste arquivo: a O.S. já está
   * gravada, e uma falha aqui não pode derrubar a resposta. O que se perde no
   * pior caso é a invalidação — que a próxima escrita no orçamento reavalia,
   * porque a comparação é contra o hash congelado e não contra um evento.
   */
  private async notifyQuoteContentChanged(
    quoteIds: Iterable<string>,
    userId?: string | null,
  ): Promise<void> {
    for (const quoteId of quoteIds) {
      try {
        await this.signatureEnvelopes.onQuoteContentChanged(quoteId, userId || null);
      } catch (error) {
        this.logger.error(
          `[SO→Quote sync] Falha ao reavaliar as assinaturas do orçamento ${quoteId} ` +
            '(a linha de serviço JÁ foi gravada):',
          error,
        );
      }
    }
  }

  /**
   * I11: When a PRODUCTION service order is DELETED directly via the SO module
   * (not through the task form), keep its mirrored priced BudgetItem line in
   * sync. Without this the quote line is orphaned and the quote totals keep
   * counting a line whose SO no longer exists (money drift). Mirrors the task-form
   * cascade (task.service.ts): removes the line ONLY when no other live PRODUCTION
   * SO still references the same desc+observation key, then recomputes both money
   * layers. Structural changes are limited to quotes que ainda podem mudar de
   * preço — estado de rascunho E sem cobrança aprovada — para que uma linha já
   * faturada nunca seja apagada em silêncio.
   */
  private async cascadeRemoveQuoteServiceForDeletedSO(
    tx: PrismaTransaction,
    deletedSO: {
      id: string;
      taskId: string | null;
      type: string;
      description: string | null;
      observation?: string | null;
    },
    /** Orçamentos escritos aqui, para o gancho de assinatura pós-commit. */
    touched?: Set<string>,
  ): Promise<void> {
    if (
      deletedSO.type !== SERVICE_ORDER_TYPE.PRODUCTION ||
      !deletedSO.description ||
      !deletedSO.taskId
    ) {
      return;
    }

    const task: any = await tx.task.findUnique({
      where: { id: deletedSO.taskId },
      select: {
        serviceOrders: {
          select: { id: true, type: true, description: true, observation: true, status: true },
        },
        quote: {
          select: {
            id: true,
            status: true,
            // ⚠️ `isQuoteMoneyLocked` devolve `false` sem este include.
            billings: { select: { approvedAt: true, status: true } },
            services: { select: { id: true, description: true, observation: true } },
          },
        },
      },
    });
    if (!task?.quote) return;
    if (
      task.quote.status !== TASK_QUOTE_STATUS.PENDING &&
      task.quote.status !== TASK_QUOTE_STATUS.APPROVED
    ) {
      return;
    }
    // ⛔ E A TRAVA DO DINHEIRO. O par de status acima já não separa rascunho de
    // faturado: `APPROVED` é o último estado do ORÇAMENTO e um contrato com
    // NFS-e autorizada continua nele. Sem esta linha, apagar uma O.S. de
    // produção apagaria a linha de serviço e recalcularia o total de um contrato
    // já cobrado — e como a escrita é direta pelo `tx`, nenhuma outra trava roda.
    if (isQuoteMoneyLocked(task.quote.billings)) {
      this.logger.log(
        `[SO→Quote sync] Linha de serviço preservada no orçamento ${task.quote.id}: há cobrança aprovada (O.S. ${deletedSO.id} apagada).`,
      );
      return;
    }

    const soKey = makeDescObsKey(deletedSO.description, deletedSO.observation ?? null);

    // Another live PRODUCTION SO still mirrors this exact line → keep the line.
    const remainingKeys = new Set<string>(
      task.serviceOrders
        .filter(
          (so: any) =>
            so.id !== deletedSO.id &&
            so.type === SERVICE_ORDER_TYPE.PRODUCTION &&
            so.description &&
            so.status !== SERVICE_ORDER_STATUS.CANCELLED,
        )
        .map((so: any) => makeDescObsKey(so.description, so.observation)),
    );
    if (remainingKeys.has(soKey)) return;

    const toDelete = task.quote.services.filter(
      (s: any) => makeDescObsKey(s.description, s.observation) === soKey,
    );
    if (toDelete.length === 0) return;

    await tx.budgetItem.deleteMany({
      where: { id: { in: toDelete.map((s: any) => s.id) } },
    });
    await recalcQuoteTotals(tx, task.quote.id);
    touched?.add(task.quote.id);
    this.logger.log(
      `[SO→Quote sync] Removed ${toDelete.length} orphaned quote service line(s) after deleting PRODUCTION SO ${deletedSO.id}; recomputed totals.`,
    );
  }

  /**
   * I11: When a PRODUCTION service order is UPDATED directly (description /
   * observation / type) via the SO module, keep its mirrored priced
   * BudgetItem line in sync. A desc/obs edit RENAMES the line (re-aligning
   * the desc+observation key the quote↔SO sync dedups on — otherwise the line is
   * orphaned and the next sync creates a duplicate). A type change into/out of
   * PRODUCTION creates/removes the mirror.
   *
   * ⛔ NADA DISSO ACONTECE NUM ORÇAMENTO COM COBRANÇA APROVADA. Antes bastava o
   * estado de rascunho (`PENDING`/`APPROVED`) para separar o que ainda
   * podia mudar; hoje `APPROVED` é o último estado do ORÇAMENTO e um contrato
   * com NFS-e autorizada continua nele. Nem o renomear passa: o texto da linha
   * já foi impresso na nota, e mudá-lo aqui faria o sistema discordar do
   * documento fiscal.
   */
  private async syncQuoteServiceForUpdatedSO(
    tx: PrismaTransaction,
    oldSO: { type: string; description: string | null; observation?: string | null },
    updatedSO: {
      id: string;
      taskId: string | null;
      type: string;
      description: string | null;
      observation?: string | null;
    },
    /** Orçamentos escritos aqui, para o gancho de assinatura pós-commit. */
    touched?: Set<string>,
  ): Promise<void> {
    if (!updatedSO.taskId) return;
    const wasProduction = oldSO.type === SERVICE_ORDER_TYPE.PRODUCTION;
    const isProduction = updatedSO.type === SERVICE_ORDER_TYPE.PRODUCTION;
    if (!wasProduction && !isProduction) return;

    const task: any = await tx.task.findUnique({
      where: { id: updatedSO.taskId },
      select: {
        serviceOrders: {
          select: { id: true, type: true, description: true, observation: true, status: true },
        },
        quote: {
          select: {
            id: true,
            status: true,
            // ⚠️ `isQuoteMoneyLocked` devolve `false` sem este include.
            billings: { select: { approvedAt: true, status: true } },
            services: { select: { id: true, description: true, observation: true } },
          },
        },
      },
    });
    if (!task?.quote) return;
    // Contrato com dinheiro na rua não se reescreve — nem a estrutura, nem o
    // texto. Sai antes de qualquer `deleteMany`/`updateMany`/`recalcQuoteTotals`,
    // que aqui correm direto pelo `tx` e não passam por trava nenhuma.
    if (isQuoteMoneyLocked(task.quote.billings)) {
      this.logger.log(
        `[SO→Quote sync] Orçamento ${task.quote.id} intocado (O.S. ${updatedSO.id}): há cobrança aprovada.`,
      );
      return;
    }
    const isDraft =
      task.quote.status === TASK_QUOTE_STATUS.PENDING ||
      task.quote.status === TASK_QUOTE_STATUS.APPROVED;

    const newDescription = (updatedSO.description || '').trim();
    const newObservation = (updatedSO.observation || '').trim() || null;
    const oldKey = oldSO.description
      ? makeDescObsKey(oldSO.description, oldSO.observation ?? null)
      : null;
    const newKey = newDescription ? makeDescObsKey(newDescription, newObservation) : null;

    const keyMatches = (s: any, key: string) => makeDescObsKey(s.description, s.observation) === key;

    // Case 1 — PRODUCTION → PRODUCTION with a changed desc/obs key: rename the line.
    if (wasProduction && isProduction) {
      if (!oldKey || !newKey || oldKey === newKey) return;
      const matches = task.quote.services.filter((s: any) => keyMatches(s, oldKey));
      if (matches.length === 0) return;
      const newKeyExists = task.quote.services.some((s: any) => keyMatches(s, newKey));
      if (newKeyExists) {
        // The renamed-to line already exists → the old line is now a duplicate.
        if (isDraft) {
          await tx.budgetItem.deleteMany({
            where: { id: { in: matches.map((m: any) => m.id) } },
          });
          await recalcQuoteTotals(tx, task.quote.id);
          touched?.add(task.quote.id);
        }
        return;
      }
      await tx.budgetItem.updateMany({
        where: { id: { in: matches.map((m: any) => m.id) } },
        data: { description: newDescription, observation: newObservation },
      });
      await recalcQuoteTotals(tx, task.quote.id);
      touched?.add(task.quote.id);
      this.logger.log(
        `[SO→Quote sync] Renamed ${matches.length} quote service line(s) to match updated PRODUCTION SO ${updatedSO.id}.`,
      );
      return;
    }

    // Case 2 — PRODUCTION → non-PRODUCTION: remove the mirror (draft only), guarded.
    if (wasProduction && !isProduction) {
      if (!isDraft || !oldKey) return;
      const remainingKeys = new Set<string>(
        task.serviceOrders
          .filter(
            (so: any) =>
              so.id !== updatedSO.id &&
              so.type === SERVICE_ORDER_TYPE.PRODUCTION &&
              so.description &&
              so.status !== SERVICE_ORDER_STATUS.CANCELLED,
          )
          .map((so: any) => makeDescObsKey(so.description, so.observation)),
      );
      if (remainingKeys.has(oldKey)) return;
      const matches = task.quote.services.filter((s: any) => keyMatches(s, oldKey));
      if (matches.length === 0) return;
      await tx.budgetItem.deleteMany({
        where: { id: { in: matches.map((m: any) => m.id) } },
      });
      await recalcQuoteTotals(tx, task.quote.id);
      touched?.add(task.quote.id);
      return;
    }

    // Case 3 — non-PRODUCTION → PRODUCTION: create the mirror if missing (draft only).
    if (!wasProduction && isProduction) {
      if (!isDraft || !newKey) return;
      const exists = task.quote.services.some((s: any) => keyMatches(s, newKey));
      if (exists) return;
      await tx.budgetItem.create({
        data: {
          quoteId: task.quote.id,
          description: newDescription,
          observation: newObservation,
          amount: 0,
        },
      });
      await recalcQuoteTotals(tx, task.quote.id);
      touched?.add(task.quote.id);
      return;
    }
  }

  /**
   * Delete a service order
   */
  async delete(id: string, userId?: string): Promise<ServiceOrderDeleteResponse> {
    try {
      const serviceOrderExists = await this.serviceOrderRepository.findById(id);
      if (!serviceOrderExists) {
        throw new NotFoundException(
          'Ordem de serviço não encontrada. Verifique se o ID está correto.',
        );
      }

      // ORÇAMENTOS CUJA LISTA DE SERVIÇOS FOI REESCRITA por este espelho. O motor
      // de assinatura precisa saber — ver `notifyQuoteContentChanged`.
      const quotesContentChanged = new Set<string>();

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Delete the service order
        await this.serviceOrderRepository.deleteWithTransaction(tx, id);

        // Log the deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE_ORDER,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: serviceOrderExists,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          reason: 'Ordem de serviço excluída',
          transaction: tx,
        });

        // I11: remove the orphaned mirrored quote line (and recompute totals) when
        // a PRODUCTION SO is deleted directly. Non-fatal — a sync hiccup must not
        // block the deletion.
        try {
          await this.cascadeRemoveQuoteServiceForDeletedSO(
            tx,
            serviceOrderExists as any,
            quotesContentChanged,
          );
        } catch (syncError) {
          this.logger.error(
            `[SO→Quote sync] Failed to remove quote line for deleted SO ${id} (non-fatal):`,
            syncError,
          );
        }
      });

      await this.notifyQuoteContentChanged(quotesContentChanged, userId);

      return {
        success: true,
        message: 'Ordem de serviço excluída com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir ordem de serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Find a single service order by ID
   */
  async findById(
    id: string,
    include?: ServiceOrderInclude,
  ): Promise<ServiceOrderGetUniqueResponse> {
    try {
      const serviceOrder = await this.serviceOrderRepository.findById(id, { include });

      if (!serviceOrder) {
        throw new NotFoundException(
          'Ordem de serviço não encontrada. Verifique se o ID está correto.',
        );
      }

      return {
        success: true,
        message: 'Ordem de serviço encontrada com sucesso.',
        data: serviceOrder,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar ordem de serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar a ordem de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Find many service orders with pagination
   */
  async findMany(query: ServiceOrderGetManyFormData): Promise<ServiceOrderGetManyResponse> {
    try {
      const result = await this.serviceOrderRepository.findMany(query);

      return {
        success: true,
        message: 'Ordens de serviço carregadas com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar ordens de serviço:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar as ordens de serviço. Tente novamente.',
      );
    }
  }

  /**
   * Get service order descriptions from enums
   * Used for combobox in the task edit form
   * Optionally filtered by type and search term
   */
  async getUniqueDescriptions(
    type?: string,
    search?: string,
    limit: number = 50,
  ): Promise<{ success: boolean; message: string; data: string[] }> {
    try {
      let descriptions: string[] = [];

      // Get descriptions from enums based on type
      if (type && SERVICE_DESCRIPTIONS_BY_TYPE[type as SERVICE_ORDER_TYPE]) {
        descriptions = [...getServiceDescriptionsByType(type as SERVICE_ORDER_TYPE)];
      } else {
        // If no type specified, return all descriptions from all types
        descriptions = Object.values(SERVICE_DESCRIPTIONS_BY_TYPE).flat();
        // Remove duplicates (e.g., "OUTROS" appears in all types)
        descriptions = [...new Set(descriptions)];
      }

      // Filter by search term if provided
      if (search && search.trim()) {
        const searchLower = search.trim().toLowerCase();
        descriptions = descriptions.filter(d => d.toLowerCase().includes(searchLower));
      }

      // Sort alphabetically and apply limit
      descriptions = descriptions.sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, limit);

      return {
        success: true,
        message: 'Descrições carregadas com sucesso.',
        data: descriptions,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar descrições:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar descrições. Tente novamente.',
      );
    }
  }

  /**
   * Batch create service orders
   */
  async batchCreate(
    data: ServiceOrderBatchCreateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
  ): Promise<ServiceOrderBatchCreateResponse<ServiceOrderCreateFormData>> {
    try {
      // Validate all task IDs exist
      const taskIds = Array.from(new Set(data.serviceOrders.map(item => item.taskId)));
      const tasks = await this.prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, status: true },
      });

      const existingTaskIds = new Set(tasks.map(t => t.id));
      const completedTaskIds = new Set(
        tasks.filter(t => t.status === TASK_STATUS.COMPLETED).map(t => t.id),
      );
      const invalidItems = data.serviceOrders.filter(item => !existingTaskIds.has(item.taskId));

      if (invalidItems.length > 0) {
        throw new BadRequestException(
          `As seguintes tarefas não foram encontradas: ${invalidItems.map(i => i.taskId).join(', ')}`,
        );
      }

      // Validate all assignedTo user IDs exist if provided
      const userIdsToValidate = new Set<string>();
      data.serviceOrders.forEach(item => {
        if (item.assignedToId) {
          userIdsToValidate.add(item.assignedToId);
        }
      });

      if (userIdsToValidate.size > 0) {
        const users = await this.prisma.user.findMany({
          where: { id: { in: Array.from(userIdsToValidate) } },
          select: { id: true },
        });

        const existingUserIds = new Set(users.map(u => u.id));
        const invalidUserIds = Array.from(userIdsToValidate).filter(id => !existingUserIds.has(id));

        if (invalidUserIds.length > 0) {
          throw new BadRequestException(
            `Os seguintes usuários não foram encontrados: ${invalidUserIds.join(', ')}`,
          );
        }
      }

      // ORÇAMENTOS CUJA LISTA DE SERVIÇOS FOI REESCRITA por este espelho. O motor
      // de assinatura precisa saber — ver `notifyQuoteContentChanged`.
      const quotesContentChanged = new Set<string>();

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Convert all descriptions to Title Case and add createdById
        // Auto-complete SOs for COMPLETED tasks
        const serviceOrdersWithTitleCase = data.serviceOrders.map(so => {
          const base: any = {
            ...so,
            description: this.toTitleCase(so.description),
            createdById: so.createdById || userId || '',
          };

          if (completedTaskIds.has(so.taskId)) {
            this.logger.log(
              `[AUTO-COMPLETE SO] Task ${so.taskId} is COMPLETED, auto-completing batch SO "${so.description}"`,
            );
            base.status = SERVICE_ORDER_STATUS.COMPLETED;
            base.statusOrder = 4;
            base.startedAt = new Date();
            base.startedById = userId || '';
            base.finishedAt = new Date();
            base.completedById = userId || '';
          }

          return base;
        });

        const batchResult = await this.serviceOrderRepository.createManyWithTransaction(
          tx,
          serviceOrdersWithTitleCase,
          { include },
        );

        // Log all successful creations
        for (const serviceOrder of batchResult.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.SERVICE_ORDER,
            entityId: serviceOrder.id,
            action: CHANGE_ACTION.CREATE,
            entity: serviceOrder,
            userId: userId || '',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            reason: 'Ordem de serviço criada em lote',
            transaction: tx,
          });
        }

        // Sync PRODUCTION service orders to quote items (same logic as single create)
        const productionSOs = batchResult.success.filter(
          (so: any) => so.type === SERVICE_ORDER_TYPE.PRODUCTION,
        );

        if (productionSOs.length > 0) {
          const taskIdsForSync = Array.from(new Set(productionSOs.map((so: any) => so.taskId as string)));

          const tasksWithQuotes = await tx.task.findMany({
            where: { id: { in: taskIdsForSync } },
            include: {
              quote: {
                include: {
                  services: true,
                  // Sem as cobranças a trava do dinheiro não roda — ver o laço abaixo.
                  billings: { select: { approvedAt: true, status: true } },
                },
              },
            },
          });

          const budgetMap = new Map(tasksWithQuotes.map((t: any) => [t.id, t]));

          // Track in-memory so multiple SOs for the same quote don't create duplicates
          const quoteItemsMap = new Map<string, SyncQuoteItem[]>();
          for (const task of tasksWithQuotes) {
            if ((task as any).quote) {
              quoteItemsMap.set(
                (task as any).quote.id,
                ((task as any).quote.services || []).map((item: any) => ({
                  id: item.id,
                  description: item.description,
                  observation: item.observation,
                  amount: item.amount,
                })),
              );
            }
          }

          for (const so of productionSOs) {
            try {
              const task = budgetMap.get((so as any).taskId);
              if (!(task as any)?.quote) {
                this.logger.log(
                  `[SO→QUOTE SYNC] Batch: Skipped "${(so as any).description}" — task has no quote`,
                );
                continue;
              }
              // ⛔ Mesma trava do caminho avulso: contrato com cobrança aprovada
              // não recebe linha nova nem tem o total recalculado.
              if (isQuoteMoneyLocked((task as any).quote.billings)) {
                this.logger.log(
                  `[SO→QUOTE SYNC] Batch: Skipped "${(so as any).description}" — orçamento ${(task as any).quote.id} já tem cobrança aprovada`,
                );
                continue;
              }

              const quoteId = (task as any).quote.id;
              const existingQuoteItems = quoteItemsMap.get(quoteId) || [];

              const syncResult = getServiceOrderToQuoteSync(
                {
                  id: (so as any).id,
                  description: (so as any).description,
                  observation: (so as any).observation,
                  type: (so as any).type,
                },
                existingQuoteItems,
              );

              if (syncResult.shouldCreateQuoteItem) {
                this.logger.log(
                  `[SO→QUOTE SYNC] Batch: Creating quote item "${syncResult.quoteItemDescription}" for SO "${(so as any).description}"`,
                );

                const createdItem = await tx.budgetItem.create({
                  data: {
                    quoteId,
                    description: syncResult.quoteItemDescription,
                    observation: syncResult.quoteItemObservation,
                    amount: syncResult.quoteItemAmount,
                  },
                });

                // Track the new item so subsequent SOs for the same quote don't duplicate it
                existingQuoteItems.push({
                  id: createdItem.id,
                  description: createdItem.description,
                  observation: createdItem.observation,
                  amount: Number(createdItem.amount),
                });

                // Discount-aware recalc: keeps the aggregate Budget and every
                // BudgetPayer consistent (a naive subtotal=total=sum
                // wiped discounts and drifted the configs).
                await recalcQuoteTotals(tx, quoteId);
                quotesContentChanged.add(quoteId);

                this.logger.log(
                  `[SO→QUOTE SYNC] Batch: Quote item created. Recalculated totals for quote ${quoteId}`,
                );
              } else {
                this.logger.log(
                  `[SO→QUOTE SYNC] Batch: Skipped "${(so as any).description}" — ${syncResult.reason}`,
                );
              }
            } catch (syncError) {
              this.logger.error(
                `[SO→QUOTE SYNC] Batch: Error syncing SO "${(so as any).description}":`,
                syncError,
              );
              // Don't throw — sync errors must not block service order creation
            }
          }
        }

        return batchResult;
      });

      await this.notifyQuoteContentChanged(quotesContentChanged, userId);

      // Emit events for all successfully created service orders
      // This must happen AFTER the transaction completes successfully
      for (const serviceOrder of result.success) {
        // Emit creation event
        this.eventEmitter.emit('service_order.created', {
          serviceOrder,
          userId,
        });

        // If service order is assigned, emit assignment event
        if (serviceOrder.assignedToId) {
          this.eventEmitter.emit('service_order.assigned', {
            serviceOrder,
            userId,
            assignedToId: serviceOrder.assignedToId,
          });
        }
      }

      // Convert BatchCreateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalCreated + result.totalFailed,
        totalSuccess: result.totalCreated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${result.totalCreated} ordens de serviço criadas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao criar ordens de serviço em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar as ordens de serviço em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch update service orders
   */
  async batchUpdate(
    data: ServiceOrderBatchUpdateFormData,
    include?: ServiceOrderInclude,
    userId?: string,
  ): Promise<ServiceOrderBatchUpdateResponse<ServiceOrderUpdateFormData>> {
    try {
      // Get all service orders to update
      const ids = data.serviceOrders.map(item => item.id);
      const existingServiceOrders = await this.serviceOrderRepository.findByIds(ids);
      const existingMap = new Map(existingServiceOrders.map(so => [so.id, so]));

      // Validate all IDs exist
      const missingIds = ids.filter(id => !existingMap.has(id));
      if (missingIds.length > 0) {
        throw new BadRequestException(
          `As seguintes ordens de serviço não foram encontradas: ${missingIds.join(', ')}`,
        );
      }

      // Validate task IDs if being updated
      const taskIdsToValidate = new Set<string>();
      data.serviceOrders.forEach(item => {
        if (item.data.taskId) {
          taskIdsToValidate.add(item.data.taskId);
        }
      });

      if (taskIdsToValidate.size > 0) {
        const tasks = await this.prisma.task.findMany({
          where: { id: { in: Array.from(taskIdsToValidate) } },
          select: { id: true },
        });

        const existingTaskIds = new Set(tasks.map(t => t.id));
        const invalidTaskIds = Array.from(taskIdsToValidate).filter(id => !existingTaskIds.has(id));

        if (invalidTaskIds.length > 0) {
          throw new BadRequestException(
            `As seguintes tarefas não foram encontradas: ${invalidTaskIds.join(', ')}`,
          );
        }
      }

      // Validate assignedTo user IDs if being updated
      const userIdsToValidate = new Set<string>();
      data.serviceOrders.forEach(item => {
        if (item.data.assignedToId) {
          userIdsToValidate.add(item.data.assignedToId);
        }
      });

      if (userIdsToValidate.size > 0) {
        const users = await this.prisma.user.findMany({
          where: { id: { in: Array.from(userIdsToValidate) } },
          select: { id: true },
        });

        const existingUserIds = new Set(users.map(u => u.id));
        const invalidUserIds = Array.from(userIdsToValidate).filter(id => !existingUserIds.has(id));

        if (invalidUserIds.length > 0) {
          throw new BadRequestException(
            `Os seguintes usuários não foram encontrados: ${invalidUserIds.join(', ')}`,
          );
        }
      }

      // Process each update to apply automatic timestamp logic (same as single update)
      const updates = data.serviceOrders.map(item => {
        const oldData = existingMap.get(item.id);
        if (!oldData) {
          return { id: item.id, data: item.data };
        }

        const updateData: any = {
          ...item.data,
          // Convert description to Title Case if provided
          ...(item.data.description && { description: this.toTitleCase(item.data.description) }),
        };

        const batchNow = new Date();

        // ── IN_PROGRESS ──
        if (
          updateData.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
          oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS
        ) {
          if (!oldData.startedById) {
            updateData.startedById = userId || null;
            updateData.startedAt = batchNow;
          }
          updateData.lastStartedAt = batchNow;

          if (oldData.status === SERVICE_ORDER_STATUS.PAUSED) {
            updateData.pausedById = null;
            updateData.pausedAt = null;
          }
          if (
            oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE ||
            oldData.status === SERVICE_ORDER_STATUS.COMPLETED
          ) {
            if (oldData.status === SERVICE_ORDER_STATUS.COMPLETED) {
              updateData.completedById = null;
              updateData.finishedAt = null;
            }
          }
        }

        // ── WAITING_APPROVE (submission — accumulate time) ──
        if (
          updateData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
          oldData.status === SERVICE_ORDER_STATUS.IN_PROGRESS
        ) {
          const sessionStart = oldData.lastStartedAt ?? oldData.startedAt;
          if (sessionStart) {
            const worked = calculateWorkingSeconds(sessionStart, batchNow);
            updateData.totalActiveTimeSeconds = (oldData.totalActiveTimeSeconds ?? 0) + worked;
          }
        }

        // ── WAITING_APPROVE exit ──
        if (
          oldData.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
          updateData.status &&
          updateData.status !== SERVICE_ORDER_STATUS.WAITING_APPROVE
        ) {
          if (
            updateData.status === SERVICE_ORDER_STATUS.COMPLETED ||
            updateData.status === SERVICE_ORDER_STATUS.IN_PROGRESS
          ) {
            if (!oldData.approvedById) {
              updateData.approvedById = userId || null;
              updateData.approvedAt = batchNow;
            }
          }
        }

        // ── PAUSED (accumulate time) ──
        if (
          updateData.status === SERVICE_ORDER_STATUS.PAUSED &&
          oldData.status !== SERVICE_ORDER_STATUS.PAUSED
        ) {
          updateData.pausedById = userId || null;
          updateData.pausedAt = batchNow;
          const sessionStart = oldData.lastStartedAt ?? oldData.startedAt;
          if (sessionStart) {
            const worked = calculateWorkingSeconds(sessionStart, batchNow);
            updateData.totalActiveTimeSeconds = (oldData.totalActiveTimeSeconds ?? 0) + worked;
          }
        }

        // ── COMPLETED ──
        if (
          updateData.status === SERVICE_ORDER_STATUS.COMPLETED &&
          oldData.status !== SERVICE_ORDER_STATUS.COMPLETED
        ) {
          if (!oldData.completedById) {
            updateData.completedById = userId || null;
            updateData.finishedAt = batchNow;
          }
          if (!oldData.startedById) {
            updateData.startedById = userId || null;
            updateData.startedAt = updateData.finishedAt || batchNow;
          }
          if (oldData.pausedAt) {
            updateData.pausedAt = null;
            updateData.pausedById = null;
          }
          if (
            oldData.status === SERVICE_ORDER_STATUS.IN_PROGRESS ||
            (oldData.status !== SERVICE_ORDER_STATUS.PAUSED &&
              oldData.status !== SERVICE_ORDER_STATUS.WAITING_APPROVE)
          ) {
            const sessionStart = oldData.lastStartedAt ?? oldData.startedAt;
            if (sessionStart) {
              const worked = calculateWorkingSeconds(sessionStart, updateData.finishedAt ?? batchNow);
              if (worked > 0) {
                updateData.totalActiveTimeSeconds = (oldData.totalActiveTimeSeconds ?? 0) + worked;
              }
            }
          }
        }

        // ── PENDING rollback ──
        if (
          updateData.status === SERVICE_ORDER_STATUS.PENDING &&
          oldData.status !== SERVICE_ORDER_STATUS.PENDING
        ) {
          updateData.startedById = null;
          updateData.startedAt = null;
          updateData.approvedById = null;
          updateData.approvedAt = null;
          updateData.completedById = null;
          updateData.finishedAt = null;
          updateData.pausedById = null;
          updateData.pausedAt = null;
          updateData.lastStartedAt = null;
          updateData.totalActiveTimeSeconds = 0;
        }

        return { id: item.id, data: updateData };
      });

      // Track auto-started tasks for event emission after transaction
      const tasksAutoStarted: Array<{
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      }> = [];
      // Track tasks auto-transitioned to WAITING_PRODUCTION for event emission after transaction
      const tasksAutoTransitionedToWaitingProduction: Array<{
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      }> = [];
      // Track tasks auto-completed for event emission after transaction
      const tasksAutoCompleted: Array<{
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      }> = [];
      // Track tasks rolled back for event emission after transaction
      const tasksRolledBack: Array<{
        taskId: string;
        oldStatus: TASK_STATUS;
        newStatus: TASK_STATUS;
      }> = [];
      // Paridade com o caminho de atualização única: orçamentos cujas cobranças
      // precisam ser recalculadas DEPOIS do commit. Ver o comentário de lá.
      const billingQuotesToRecompute = new Set<string>();
      // ORÇAMENTOS CUJA LISTA DE SERVIÇOS FOI REESCRITA por este espelho. O motor
      // de assinatura precisa saber — ver `notifyQuoteContentChanged`.
      const quotesContentChanged = new Set<string>();

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.serviceOrderRepository.updateManyWithTransaction(
          tx,
          updates,
          { include },
        );

        // Log all successful updates with complete field tracking
        for (const serviceOrder of batchResult.success) {
          const oldData = existingMap.get(serviceOrder.id);
          if (oldData) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE_ORDER,
              entityId: serviceOrder.id,
              oldEntity: oldData,
              newEntity: serviceOrder,
              fieldsToTrack: [
                'status',
                'description',
                'observation',
                'taskId',
                'startedAt',
                'startedById',
                'approvedAt',
                'approvedById',
                'finishedAt',
                'completedById',
                'type',
                'assignedToId',
              ],
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // I11: keep the mirrored priced quote line in sync with this SO's
            // description/observation/type edit (parity with single update).
            try {
              await this.syncQuoteServiceForUpdatedSO(
                tx,
                oldData as any,
                {
                  id: serviceOrder.id,
                  taskId: (serviceOrder as any).taskId,
                  type: (serviceOrder as any).type,
                  description: (serviceOrder as any).description ?? null,
                  observation: (serviceOrder as any).observation ?? null,
                },
                quotesContentChanged,
              );
            } catch (syncError) {
              this.logger.error(
                `[SO→Quote sync] Failed to sync quote line for batch-updated SO ${serviceOrder.id} (non-fatal):`,
                syncError,
              );
            }

            // Auto-start task when PRODUCTION service order is started and task is waiting for production
            // NOTE: Only PRODUCTION type service orders trigger task auto-start, not ARTWORK
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.IN_PROGRESS &&
              oldData.status !== SERVICE_ORDER_STATUS.IN_PROGRESS &&
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION
            ) {
              // Check if this task was already auto-started in this batch
              const alreadyStarted = tasksAutoStarted.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyStarted) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true },
                });

                if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
                  this.logger.log(
                    `[AUTO-START BATCH] Service order ${serviceOrder.id} started, auto-starting task ${task.id}`,
                  );

                  await tx.task.update({
                    where: { id: task.id },
                    data: {
                      status: TASK_STATUS.IN_PRODUCTION,
                      startedAt: new Date(),
                    },
                  });

                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: TASK_STATUS.WAITING_PRODUCTION,
                    newValue: TASK_STATUS.IN_PRODUCTION,
                    reason: `Tarefa iniciada automaticamente quando ordem de serviço "${serviceOrder.description}" foi iniciada (batch)`,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: serviceOrder.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  tasksAutoStarted.push({
                    taskId: task.id,
                    oldStatus: TASK_STATUS.WAITING_PRODUCTION,
                    newStatus: TASK_STATUS.IN_PRODUCTION,
                  });
                }
              }
            }

            // Auto-transition task from PREPARATION to WAITING_PRODUCTION when at least one ARTWORK
            // service order is COMPLETED AND all COMMERCIAL service orders are concluded.
            // Triggered by either an artwork or a commercial SO completing.
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.COMPLETED &&
              oldData.status !== SERVICE_ORDER_STATUS.COMPLETED &&
              (serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK ||
                serviceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL)
            ) {
              // Check if this task was already auto-transitioned in this batch
              const alreadyTransitioned = tasksAutoTransitionedToWaitingProduction.some(
                t => t.taskId === serviceOrder.taskId,
              );
              if (!alreadyTransitioned) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true },
                });

                // Only proceed if task is in PREPARATION status
                if (task && task.status === TASK_STATUS.PREPARATION) {
                  // Evaluate the full preparation gate over the task's service orders
                  // (updates from this batch are already visible inside the transaction)
                  const taskServiceOrders = await tx.serviceOrder.findMany({
                    where: { taskId: serviceOrder.taskId },
                    select: { id: true, status: true, type: true },
                  });

                  const anyArtworkCompleted = taskServiceOrders.some(
                    so =>
                      so.type === SERVICE_ORDER_TYPE.ARTWORK &&
                      so.status === SERVICE_ORDER_STATUS.COMPLETED,
                  );
                  const allCommercialCompleted = areCommercialServiceOrdersComplete(
                    taskServiceOrders.map(so => ({
                      status: so.status as SERVICE_ORDER_STATUS,
                      type: so.type as SERVICE_ORDER_TYPE,
                    })),
                  );

                  if (anyArtworkCompleted && allCommercialCompleted) {
                    this.logger.log(
                      `[AUTO-TRANSITION BATCH] ${serviceOrder.type} service order ${serviceOrder.id} completed for task ${task.id} (artwork done, commercial done), transitioning PREPARATION → WAITING_PRODUCTION`,
                    );

                    await tx.task.update({
                      where: { id: task.id },
                      data: {
                        status: TASK_STATUS.WAITING_PRODUCTION,
                        statusOrder: 2, // WAITING_PRODUCTION statusOrder
                      },
                    });

                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: TASK_STATUS.PREPARATION,
                      newValue: TASK_STATUS.WAITING_PRODUCTION,
                      reason: `Tarefa liberada automaticamente para produção quando ordem de serviço ${serviceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL ? 'comercial' : 'de arte'} "${serviceOrder.description}" foi concluída (batch)`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksAutoTransitionedToWaitingProduction.push({
                      taskId: task.id,
                      oldStatus: TASK_STATUS.PREPARATION,
                      newStatus: TASK_STATUS.WAITING_PRODUCTION,
                    });
                  } else {
                    this.logger.log(
                      `[AUTO-TRANSITION BATCH] Task ${task.id} stays in PREPARATION (artwork completed: ${anyArtworkCompleted}, commercial completed: ${allCommercialCompleted})`,
                    );
                  }
                }
              }
            }

            // NOTE: Task is NOT auto-completed when all production SOs finish.
            // Only PRODUCTION_MANAGER or ADMIN can manually finish/complete tasks.

            // =====================================================================
            // ROLLBACK TASK WHEN ALL PRODUCTION SERVICE ORDERS ARE CANCELLED (BATCH)
            // =====================================================================
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.CANCELLED &&
              oldData.status !== SERVICE_ORDER_STATUS.CANCELLED &&
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION
            ) {
              // Check if this task was already auto-completed in this batch
              const alreadyCompleted = tasksAutoCompleted.some(
                t => t.taskId === serviceOrder.taskId,
              );
              if (!alreadyCompleted) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true, finishedAt: true },
                });

                // Only proceed if task is in IN_PRODUCTION or WAITING_PRODUCTION status
                if (
                  task &&
                  (task.status === TASK_STATUS.IN_PRODUCTION ||
                    task.status === TASK_STATUS.WAITING_PRODUCTION)
                ) {
                  // Get all PRODUCTION service orders for this task
                  const productionServiceOrders = await tx.serviceOrder.findMany({
                    where: {
                      taskId: serviceOrder.taskId,
                      type: SERVICE_ORDER_TYPE.PRODUCTION,
                    },
                    select: { id: true, status: true },
                  });

                  // Filter out CANCELLED orders - they don't block task completion
                  const activeProductionOrders = productionServiceOrders.filter(
                    so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
                  );

                  // If ALL production orders are now cancelled, rollback task (not cancel - only COMMERCIAL cancellation cancels task)
                  if (activeProductionOrders.length === 0 && productionServiceOrders.length > 0) {
                    // If task is IN_PRODUCTION, rollback to WAITING_PRODUCTION
                    if (task.status === TASK_STATUS.IN_PRODUCTION) {
                      this.logger.log(
                        `[ROLLBACK TASK ON ALL PRODUCTION SO CANCEL BATCH] All ${productionServiceOrders.length} PRODUCTION service orders cancelled for task ${task.id}, rolling back to WAITING_PRODUCTION`,
                      );

                      const oldTaskStatus = task.status as TASK_STATUS;
                      await tx.task.update({
                        where: { id: task.id },
                        data: {
                          status: TASK_STATUS.WAITING_PRODUCTION,
                          statusOrder: 2, // WAITING_PRODUCTION statusOrder
                          startedAt: null, // Clear start date on rollback
                        },
                      });

                      // Log the task rollback in changelog
                      await this.changeLogService.logChange({
                        entityType: ENTITY_TYPE.TASK,
                        entityId: task.id,
                        action: CHANGE_ACTION.UPDATE,
                        field: 'status',
                        oldValue: oldTaskStatus,
                        newValue: TASK_STATUS.WAITING_PRODUCTION,
                        reason: `Tarefa retornada para aguardando produção pois todas as ${productionServiceOrders.length} ordens de serviço de produção foram canceladas (batch)`,
                        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                        triggeredById: serviceOrder.id,
                        userId: userId || '',
                        transaction: tx,
                      });

                      tasksAutoCompleted.push({
                        taskId: task.id,
                        oldStatus: oldTaskStatus,
                        newStatus: TASK_STATUS.WAITING_PRODUCTION,
                      });
                    }
                    // NOTE: Task is NOT auto-completed when remaining production SOs are all completed.
                    // Only PRODUCTION_MANAGER or ADMIN can manually finish/complete tasks.
                  }
                }
              }
            }

            // =====================================================================
            // AUTO-CANCEL TASK WHEN ALL COMMERCIAL SERVICE ORDERS ARE CANCELLED (BATCH)
            // When a COMMERCIAL service order is cancelled, check if ALL commercial
            // orders are now cancelled - if so, cancel task and all other service orders
            // =====================================================================
            if (
              serviceOrder.status === SERVICE_ORDER_STATUS.CANCELLED &&
              oldData.status !== SERVICE_ORDER_STATUS.CANCELLED &&
              serviceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL
            ) {
              // Check if this task was already auto-cancelled in this batch
              const alreadyCancelled = tasksAutoCompleted.some(
                t => t.taskId === serviceOrder.taskId && t.newStatus === TASK_STATUS.CANCELLED,
              );
              if (!alreadyCancelled) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true },
                });

                // Only proceed if task is not already cancelled
                if (task && task.status !== TASK_STATUS.CANCELLED) {
                  // Get all COMMERCIAL service orders for this task
                  const commercialServiceOrders = await tx.serviceOrder.findMany({
                    where: {
                      taskId: serviceOrder.taskId,
                      type: SERVICE_ORDER_TYPE.COMMERCIAL,
                    },
                    select: { id: true, status: true },
                  });

                  // Filter out CANCELLED orders
                  const activeCommercialOrders = commercialServiceOrders.filter(
                    so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
                  );

                  // If ALL commercial orders are now cancelled, cancel the task and all other service orders
                  if (activeCommercialOrders.length === 0 && commercialServiceOrders.length > 0) {
                    this.logger.log(
                      `[AUTO-CANCEL TASK ON ALL COMMERCIAL SO CANCEL BATCH] All ${commercialServiceOrders.length} COMMERCIAL service orders cancelled for task ${task.id}, cancelling task and all remaining service orders`,
                    );

                    // I18: never strand live billing (parity with single update).
                    // Escopo por ORÇAMENTO — ver `hasLiveBillingForTask`.
                    if (await this.hasLiveBillingForTask(tx, task.id)) {
                      throw new BadRequestException(
                        'Não é possível cancelar a tarefa: o faturamento já foi aprovado (existem faturas, boletos ou NFS-e ativos). Reverta o faturamento antes de cancelar as ordens de serviço comerciais.',
                      );
                    }

                    // The guard above ensured no live billing, so cascade-cancel
                    // the (draft) quote with a clean status flip (parity with the
                    // single-update path).
                    const quoteForCancel = await tx.task.findUnique({
                      where: { id: task.id },
                      select: { quote: { select: { id: true, status: true } } },
                    });
                    const qfc = (quoteForCancel as any)?.quote;
                    if (qfc && qfc.status !== TASK_QUOTE_STATUS.CANCELLED) {
                      await tx.budget.update({
                        where: { id: qfc.id },
                        data: {
                          status: TASK_QUOTE_STATUS.CANCELLED,
                          statusOrder: TASK_QUOTE_STATUS_ORDER[TASK_QUOTE_STATUS.CANCELLED],
                        },
                      });
                      await this.changeLogService.logChange({
                        entityType: ENTITY_TYPE.TASK_QUOTE,
                        entityId: qfc.id,
                        action: CHANGE_ACTION.UPDATE,
                        field: 'status',
                        oldValue: qfc.status,
                        newValue: TASK_QUOTE_STATUS.CANCELLED,
                        reason: 'Orçamento cancelado automaticamente pelo cancelamento da tarefa',
                        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                        triggeredById: serviceOrder.id,
                        userId: userId || '',
                        transaction: tx,
                      });
                      // As cobranças deste orçamento caem junto — a cascata
                      // escreve o estado delas depois do commit.
                      billingQuotesToRecompute.add(qfc.id);
                    }

                    const oldTaskStatus = task.status as TASK_STATUS;
                    await tx.task.update({
                      where: { id: task.id },
                      data: {
                        status: TASK_STATUS.CANCELLED,
                        statusOrder: 5, // CANCELLED statusOrder
                      },
                    });

                    // Cancel all remaining non-cancelled service orders (PRODUCTION, COMMERCIAL, ARTWORK, LOGISTIC)
                    const otherServiceOrders = await tx.serviceOrder.findMany({
                      where: {
                        taskId: task.id,
                        status: { not: SERVICE_ORDER_STATUS.CANCELLED },
                      },
                      select: { id: true, status: true, type: true },
                    });

                    for (const otherSO of otherServiceOrders) {
                      await tx.serviceOrder.update({
                        where: { id: otherSO.id },
                        data: {
                          status: SERVICE_ORDER_STATUS.CANCELLED,
                          statusOrder: 5,
                        },
                      });

                      // Log each service order cancellation
                      await this.changeLogService.logChange({
                        entityType: ENTITY_TYPE.SERVICE_ORDER,
                        entityId: otherSO.id,
                        action: CHANGE_ACTION.UPDATE,
                        field: 'status',
                        oldValue: otherSO.status,
                        newValue: SERVICE_ORDER_STATUS.CANCELLED,
                        reason: `Ordem de serviço ${otherSO.type} cancelada automaticamente pois todas as ordens de serviço comerciais foram canceladas (batch)`,
                        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                        triggeredById: serviceOrder.id,
                        userId: userId || '',
                        transaction: tx,
                      });
                    }

                    // Log the task cancellation in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: oldTaskStatus,
                      newValue: TASK_STATUS.CANCELLED,
                      reason: `Tarefa cancelada automaticamente pois todas as ${commercialServiceOrders.length} ordens de serviço comerciais foram canceladas (batch)`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksAutoCompleted.push({
                      taskId: task.id,
                      oldStatus: oldTaskStatus,
                      newStatus: TASK_STATUS.CANCELLED,
                    });
                  }
                }
              }
            }

            // =====================================================================
            // ROLLBACK SYNC: COMMERCIAL Service Order Un-Cancelled → Task Status Rollback (BATCH)
            // When a COMMERCIAL service order goes from CANCELLED to any other status,
            // check if task should rollback from CANCELLED to the correct status based on
            // all service orders (ARTWORK + PRODUCTION)
            // =====================================================================
            if (
              serviceOrder.status !== SERVICE_ORDER_STATUS.CANCELLED &&
              oldData.status === SERVICE_ORDER_STATUS.CANCELLED &&
              serviceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL
            ) {
              // Check if this task was already rolled back in this batch
              const alreadyRolledBack = tasksRolledBack.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyRolledBack) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true },
                });

                // Only rollback if task is currently CANCELLED
                if (task && task.status === TASK_STATUS.CANCELLED) {
                  // Get all service orders for this task to calculate correct status
                  const allServiceOrders = await tx.serviceOrder.findMany({
                    where: { taskId: serviceOrder.taskId },
                    select: { id: true, status: true, type: true },
                  });

                  // Calculate the correct task status based on all service orders
                  const correctStatus = calculateCorrectTaskStatus(
                    allServiceOrders.map(so => ({
                      status: so.status as SERVICE_ORDER_STATUS,
                      type: so.type as SERVICE_ORDER_TYPE,
                    })),
                  );

                  this.logger.log(
                    `[COMMERCIAL ROLLBACK BATCH] Commercial service order ${serviceOrder.id} un-cancelled (${oldData.status} → ${serviceOrder.status}), rolling back task ${task.id} from CANCELLED to ${correctStatus}`,
                  );

                  const oldTaskStatus = task.status as TASK_STATUS;
                  const newStatusOrder =
                    correctStatus === TASK_STATUS.PREPARATION
                      ? 1
                      : correctStatus === TASK_STATUS.WAITING_PRODUCTION
                        ? 2
                        : correctStatus === TASK_STATUS.IN_PRODUCTION
                          ? 3
                          : correctStatus === TASK_STATUS.COMPLETED
                            ? 4
                            : 5;

                  await tx.task.update({
                    where: { id: task.id },
                    data: {
                      status: correctStatus,
                      statusOrder: newStatusOrder,
                    },
                  });

                  // Log the rollback in changelog
                  await this.changeLogService.logChange({
                    entityType: ENTITY_TYPE.TASK,
                    entityId: task.id,
                    action: CHANGE_ACTION.UPDATE,
                    field: 'status',
                    oldValue: oldTaskStatus,
                    newValue: correctStatus,
                    reason: `Tarefa retornada para ${correctStatus === TASK_STATUS.PREPARATION ? 'preparação' : correctStatus === TASK_STATUS.WAITING_PRODUCTION ? 'aguardando produção' : correctStatus === TASK_STATUS.IN_PRODUCTION ? 'em produção' : 'concluída'} pois ordem de serviço comercial foi reativada (batch)`,
                    triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                    triggeredById: serviceOrder.id,
                    userId: userId || '',
                    transaction: tx,
                  });

                  tasksRolledBack.push({
                    taskId: task.id,
                    oldStatus: oldTaskStatus,
                    newStatus: correctStatus,
                  });
                }
              }
            }

            // =====================================================================
            // ROLLBACK SYNC: ARTWORK Service Order Rollback → Task Status Rollback
            // When an ARTWORK service order goes backwards from COMPLETED, check if task
            // should rollback from WAITING_PRODUCTION to PREPARATION
            // Only rollback if NO artwork service orders remain completed
            // =====================================================================
            if (
              serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK &&
              oldData.status === SERVICE_ORDER_STATUS.COMPLETED &&
              serviceOrder.status !== SERVICE_ORDER_STATUS.COMPLETED
            ) {
              // Check if this task was already rolled back in this batch
              const alreadyRolledBack = tasksRolledBack.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyRolledBack) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true },
                });

                // Only rollback if task is currently in WAITING_PRODUCTION
                if (task && task.status === TASK_STATUS.WAITING_PRODUCTION) {
                  // Get all ARTWORK service orders to check if any are still completed
                  const artworkServiceOrders = await tx.serviceOrder.findMany({
                    where: {
                      taskId: serviceOrder.taskId,
                      type: SERVICE_ORDER_TYPE.ARTWORK,
                    },
                    select: { id: true, status: true },
                  });

                  // Only rollback task if NO artwork SOs remain completed
                  // If at least one artwork is still completed, keep task in WAITING_PRODUCTION
                  const anyArtworkCompleted = artworkServiceOrders.some(
                    so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
                  );

                  if (!anyArtworkCompleted) {
                    this.logger.log(
                      `[ARTWORK ROLLBACK BATCH] Artwork service order ${serviceOrder.id} rolled back from COMPLETED to ${serviceOrder.status}, no artwork orders remain completed, rolling back task ${task.id} from WAITING_PRODUCTION to PREPARATION`,
                    );

                    await tx.task.update({
                      where: { id: task.id },
                      data: {
                        status: TASK_STATUS.PREPARATION,
                        statusOrder: 1, // PREPARATION statusOrder
                      },
                    });

                    // Log the rollback in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: TASK_STATUS.WAITING_PRODUCTION,
                      newValue: TASK_STATUS.PREPARATION,
                      reason: `Tarefa retornada para preparação pois nenhuma ordem de serviço de arte permanece concluída (batch)`,
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksRolledBack.push({
                      taskId: task.id,
                      oldStatus: TASK_STATUS.WAITING_PRODUCTION,
                      newStatus: TASK_STATUS.PREPARATION,
                    });
                  }
                }
              }
            }

            // =====================================================================
            // ROLLBACK SYNC: Service Order Status Rollback → Task Status Rollback
            // When a production service order goes backwards, sync task status accordingly
            // =====================================================================
            if (
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION &&
              isStatusRollback(
                oldData.status as SERVICE_ORDER_STATUS,
                serviceOrder.status as SERVICE_ORDER_STATUS,
              )
            ) {
              // Check if this task was already rolled back in this batch
              const alreadyRolledBack = tasksRolledBack.some(t => t.taskId === serviceOrder.taskId);
              if (!alreadyRolledBack) {
                // Get the task with its current status
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true, finishedAt: true },
                });

                if (task) {
                  // Get ALL service orders for this task to determine the new task status
                  const allServiceOrders = await tx.serviceOrder.findMany({
                    where: { taskId: serviceOrder.taskId },
                    select: { id: true, status: true, type: true },
                  });

                  // Use the sync utility to determine if task needs to be updated
                  const taskUpdate = getTaskUpdateForServiceOrderStatusChange(
                    allServiceOrders.map(so => ({
                      id: so.id,
                      status: so.status as SERVICE_ORDER_STATUS,
                      type: so.type as SERVICE_ORDER_TYPE,
                    })),
                    serviceOrder.id,
                    oldData.status as SERVICE_ORDER_STATUS,
                    serviceOrder.status as SERVICE_ORDER_STATUS,
                    task.status as TASK_STATUS,
                  );

                  if (taskUpdate && taskUpdate.shouldUpdate && taskUpdate.newTaskStatus) {
                    this.logger.log(
                      `[SO→TASK ROLLBACK BATCH] Service order ${serviceOrder.id} rolled back ${oldData.status} → ${serviceOrder.status}, updating task ${task.id}: ${task.status} → ${taskUpdate.newTaskStatus}`,
                    );

                    const taskUpdateData: any = {
                      status: taskUpdate.newTaskStatus,
                      statusOrder: getTaskStatusOrder(taskUpdate.newTaskStatus),
                    };

                    // Handle date fields based on update flags
                    if (taskUpdate.setStartedAt && !task.startedAt) {
                      taskUpdateData.startedAt = new Date();
                    }
                    if (taskUpdate.setFinishedAt && !task.finishedAt) {
                      taskUpdateData.finishedAt = new Date();
                    }
                    if (taskUpdate.clearStartedAt) {
                      taskUpdateData.startedAt = null;
                    }
                    if (taskUpdate.clearFinishedAt) {
                      taskUpdateData.finishedAt = null;
                    }

                    await tx.task.update({
                      where: { id: task.id },
                      data: taskUpdateData,
                    });

                    // Log the rollback in changelog
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.TASK,
                      entityId: task.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: 'status',
                      oldValue: task.status,
                      newValue: taskUpdate.newTaskStatus,
                      reason: taskUpdate.reason + ' (batch)',
                      triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                      triggeredById: serviceOrder.id,
                      userId: userId || '',
                      transaction: tx,
                    });

                    tasksRolledBack.push({
                      taskId: task.id,
                      oldStatus: task.status as TASK_STATUS,
                      newStatus: taskUpdate.newTaskStatus as TASK_STATUS,
                    });
                  }
                }
              }
            }

            // =====================================================================
            // COMPREHENSIVE TASK STATUS SYNC (Catch-all) - BATCH
            // After all specific sync checks, verify the task status is correct
            // based on all production service orders. This handles edge cases
            // that might be missed by the specific conditions above.
            // =====================================================================
            if (
              serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION &&
              oldData.status !== serviceOrder.status // Only when status changed
            ) {
              // Check if this task was already handled by another sync block
              const alreadyHandled =
                tasksAutoCompleted.some(t => t.taskId === serviceOrder.taskId) ||
                tasksRolledBack.some(t => t.taskId === serviceOrder.taskId);

              if (!alreadyHandled) {
                const task = await tx.task.findUnique({
                  where: { id: serviceOrder.taskId },
                  select: { id: true, status: true, startedAt: true, finishedAt: true },
                });

                if (
                  task &&
                  task.status !== TASK_STATUS.PREPARATION &&
                  task.status !== TASK_STATUS.CANCELLED
                ) {
                  // Get all service orders for this task
                  const allServiceOrders = await tx.serviceOrder.findMany({
                    where: { taskId: serviceOrder.taskId },
                    select: { id: true, status: true, type: true },
                  });

                  // Filter production service orders and exclude CANCELLED
                  const activeProductionOrders = allServiceOrders
                    .filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION)
                    .filter(so => so.status !== SERVICE_ORDER_STATUS.CANCELLED);

                  if (activeProductionOrders.length > 0) {
                    const allPending = activeProductionOrders.every(
                      so => so.status === SERVICE_ORDER_STATUS.PENDING,
                    );
                    const anyInProgress = activeProductionOrders.some(
                      so => so.status === SERVICE_ORDER_STATUS.IN_PROGRESS,
                    );
                    const anyCompleted = activeProductionOrders.some(
                      so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
                    );

                    let expectedStatus: TASK_STATUS | null = null;

                    // NOTE: Task is NOT auto-completed when all production SOs finish.
                    // Only PRODUCTION_MANAGER or ADMIN can manually finish/complete tasks.
                    if (anyInProgress || anyCompleted) {
                      expectedStatus = TASK_STATUS.IN_PRODUCTION;
                    } else if (allPending) {
                      expectedStatus = TASK_STATUS.WAITING_PRODUCTION;
                    }

                    // If expected status differs from current, update the task (but never auto-complete)
                    if (
                      expectedStatus &&
                      expectedStatus !== task.status &&
                      task.status !== TASK_STATUS.COMPLETED
                    ) {
                      this.logger.log(
                        `[COMPREHENSIVE SYNC BATCH] Task ${task.id} status mismatch: current=${task.status}, expected=${expectedStatus}. Updating...`,
                      );

                      const taskUpdateData: any = {
                        status: expectedStatus,
                        statusOrder: getTaskStatusOrder(expectedStatus),
                      };

                      // Handle dates based on status change
                      if (expectedStatus === TASK_STATUS.IN_PRODUCTION) {
                        if (!task.startedAt) taskUpdateData.startedAt = new Date();
                      } else if (expectedStatus === TASK_STATUS.WAITING_PRODUCTION) {
                        taskUpdateData.startedAt = null;
                        taskUpdateData.finishedAt = null;
                      }

                      await tx.task.update({
                        where: { id: task.id },
                        data: taskUpdateData,
                      });

                      // Log the sync in changelog
                      await this.changeLogService.logChange({
                        entityType: ENTITY_TYPE.TASK,
                        entityId: task.id,
                        action: CHANGE_ACTION.UPDATE,
                        field: 'status',
                        oldValue: task.status,
                        newValue: expectedStatus,
                        reason: `Status da tarefa sincronizado automaticamente com base nas ordens de serviço de produção (batch)`,
                        triggeredBy: CHANGE_TRIGGERED_BY.SYSTEM_GENERATED,
                        triggeredById: serviceOrder.id,
                        userId: userId || '',
                        transaction: tx,
                      });

                      tasksRolledBack.push({
                        taskId: task.id,
                        oldStatus: task.status as TASK_STATUS,
                        newStatus: expectedStatus,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        return batchResult;
      });

      await this.notifyQuoteContentChanged(quotesContentChanged, userId);

      // Commitado: as cobranças dos orçamentos cancelados neste lote podem ser
      // recalculadas com a verdade nova. Best-effort, como no caminho único.
      for (const quoteId of billingQuotesToRecompute) {
        try {
          await this.billingStatusCascade.recomputeForQuote(quoteId);
        } catch (cascadeError) {
          this.logger.error(
            `[BILLING CASCADE] Falha ao recalcular as cobranças do orçamento ${quoteId} (batch):`,
            cascadeError,
          );
        }
      }

      // Emit events for successful updates
      for (const serviceOrder of result.success) {
        const oldData = existingMap.get(serviceOrder.id);
        if (!oldData) continue;

        // Emit status.changed event if status changed
        if (oldData.status !== serviceOrder.status) {
          this.eventEmitter.emit('service_order.status.changed', {
            serviceOrder,
            oldStatus: oldData.status,
            newStatus: serviceOrder.status,
            userId,
          });

          // If status changed to COMPLETED
          if (serviceOrder.status === SERVICE_ORDER_STATUS.COMPLETED) {
            this.eventEmitter.emit('service_order.completed', {
              serviceOrder,
              userId,
            });
          }

          // If status changed to WAITING_APPROVE and type is ARTWORK
          if (
            serviceOrder.status === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
            serviceOrder.type === SERVICE_ORDER_TYPE.ARTWORK
          ) {
            this.eventEmitter.emit('service_order.artwork_waiting_approval', {
              serviceOrder,
              userId,
            });
          }
        }

        // Emit assigned event if assignedToId changed (skip unassignment —
        // mirrors the truthiness guard in the single-update path)
        if (oldData.assignedToId !== serviceOrder.assignedToId) {
          if (serviceOrder.assignedToId) {
            this.eventEmitter.emit('service_order.assigned', {
              serviceOrder,
              userId,
              assignedToId: serviceOrder.assignedToId,
              previousAssignedToId: oldData.assignedToId,
            });
            // NOTE: the legacy 'service_order.assigned_user_updated' emit was removed
            // (2026-06-11 audit) — the event had no listener and no notification config.
          }
        }

        // Emit observation change event if observation changed
        if (oldData.observation !== serviceOrder.observation) {
          this.eventEmitter.emit('service_order.observation.changed', {
            serviceOrder,
            oldObservation: oldData.observation,
            newObservation: serviceOrder.observation,
            userId,
          });
        }
      }

      // Emit task status changed events for auto-started tasks
      for (const taskAutoStarted of tasksAutoStarted) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoStarted.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoStarted.oldStatus,
            newStatus: taskAutoStarted.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-START BATCH] Emitted task.status.changed event for task ${taskAutoStarted.taskId}`,
          );
        }
      }

      // Emit task status changed events for tasks auto-transitioned to WAITING_PRODUCTION
      for (const taskAutoTransitioned of tasksAutoTransitionedToWaitingProduction) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoTransitioned.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoTransitioned.oldStatus,
            newStatus: taskAutoTransitioned.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-TRANSITION BATCH] Emitted task.status.changed event for task ${taskAutoTransitioned.taskId} (PREPARATION → WAITING_PRODUCTION)`,
          );

          // NOTE: We previously emitted task.created here, but this was REMOVED because the
          // task.status.changed event already triggers 'task.ready_for_production' notification
          // via the TaskListener.handleTaskStatusChanged() method. Emitting task.created caused
          // DUPLICATE notifications for production users.
        }
      }

      // Emit task status changed events for tasks auto-completed
      for (const taskAutoComplete of tasksAutoCompleted) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskAutoComplete.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskAutoComplete.oldStatus,
            newStatus: taskAutoComplete.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[AUTO-COMPLETE TASK BATCH] Emitted task.status.changed event for task ${taskAutoComplete.taskId} (${taskAutoComplete.oldStatus} → COMPLETED)`,
          );
        }
      }

      // Emit task status changed events for tasks rolled back
      for (const taskRollback of tasksRolledBack) {
        const updatedTask = await this.prisma.task.findUnique({
          where: { id: taskRollback.taskId },
          select: {
            id: true,
            name: true,
            implement: { select: { serialNumber: true } },
            status: true,
            sectorId: true,
          },
        });

        const changedByUser = userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true },
            })
          : null;

        if (updatedTask) {
          this.eventEmitter.emit('task.status.changed', {
            task: updatedTask,
            oldStatus: taskRollback.oldStatus,
            newStatus: taskRollback.newStatus,
            changedBy: changedByUser || { id: 'system', name: 'Sistema' },
          });

          this.logger.log(
            `[SO→TASK ROLLBACK BATCH] Emitted task.status.changed event for task ${taskRollback.taskId} (${taskRollback.oldStatus} → ${taskRollback.newStatus})`,
          );
        }
      }

      // Convert BatchUpdateResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${result.totalUpdated} ordens de serviço atualizadas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar ordens de serviço em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar as ordens de serviço em lote. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete service orders
   */
  async batchDelete(
    data: ServiceOrderBatchDeleteFormData,
    userId?: string,
  ): Promise<ServiceOrderBatchDeleteResponse> {
    try {
      // Get all service orders to delete
      const existingServiceOrders = await this.serviceOrderRepository.findByIds(
        data.serviceOrderIds,
      );
      const existingMap = new Map(existingServiceOrders.map(so => [so.id, so]));

      // Validate all IDs exist
      const missingIds = data.serviceOrderIds.filter(id => !existingMap.has(id));
      if (missingIds.length > 0) {
        throw new BadRequestException(
          `As seguintes ordens de serviço não foram encontradas: ${missingIds.join(', ')}`,
        );
      }

      // ORÇAMENTOS CUJA LISTA DE SERVIÇOS FOI REESCRITA por este espelho. O motor
      // de assinatura precisa saber — ver `notifyQuoteContentChanged`.
      const quotesContentChanged = new Set<string>();

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const batchResult = await this.serviceOrderRepository.deleteManyWithTransaction(
          tx,
          data.serviceOrderIds,
        );

        // Log all successful deletions
        for (const { id } of batchResult.success) {
          const oldData = existingMap.get(id);
          if (oldData) {
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE_ORDER,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: oldData,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              reason: 'Ordem de serviço excluída em lote',
              transaction: tx,
            });

            // I11: remove the orphaned mirrored quote line + recompute totals for
            // each batch-deleted PRODUCTION SO (parity with single delete).
            try {
              await this.cascadeRemoveQuoteServiceForDeletedSO(
                tx,
                oldData as any,
                quotesContentChanged,
              );
            } catch (syncError) {
              this.logger.error(
                `[SO→Quote sync] Failed to remove quote line for batch-deleted SO ${id} (non-fatal):`,
                syncError,
              );
            }
          }
        }

        return batchResult;
      });

      await this.notifyQuoteContentChanged(quotesContentChanged, userId);

      // Convert BatchDeleteResult to BatchOperationResult
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index !== undefined ? error.index : index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: error.data,
        })),
        totalProcessed: result.totalDeleted + result.totalFailed,
        totalSuccess: result.totalDeleted,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${result.totalDeleted} ordens de serviço excluídas com sucesso${result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : ''}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro ao excluir ordens de serviço em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir as ordens de serviço em lote. Tente novamente.',
      );
    }
  }
}
