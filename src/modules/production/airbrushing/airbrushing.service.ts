import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { AirbrushingRepository, PrismaTransaction } from './repositories/airbrushing.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FileService } from '@modules/common/file/file.service';
import { FileReferenceService } from '@modules/common/file/services/file-reference.service';
import {
  CHANGE_TRIGGERED_BY,
  CHANGE_ACTION,
  ENTITY_TYPE,
  SECTOR_PRIVILEGES,
  AIRBRUSHING_STATUS,
  AIRBRUSHING_PAYMENT_STATUS,
  AIRBRUSHING_DUE_DATE_RULE,
  LAYOUT_STATUS,
} from '../../../constants/enums';
import { resolveAirbrushingDueDate } from '../../../utils/airbrushing';
import { PainterNfseService } from '@modules/integrations/nfse/painter/painter-nfse.service';
import type {
  AirbrushingBatchCreateResponse,
  AirbrushingBatchDeleteResponse,
  AirbrushingBatchUpdateResponse,
  AirbrushingCreateResponse,
  AirbrushingDeleteResponse,
  AirbrushingGetManyResponse,
  AirbrushingGetUniqueResponse,
  AirbrushingUpdateResponse,
} from '../../../types';
import { Airbrushing } from '../../../types';
import type {
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingGetManyFormData,
  AirbrushingBatchCreateFormData,
  AirbrushingBatchUpdateFormData,
  AirbrushingBatchDeleteFormData,
  AirbrushingInclude,
} from '../../../schemas/airbrushing';

@Injectable()
export class AirbrushingService {
  private readonly logger = new Logger(AirbrushingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly airbrushingRepository: AirbrushingRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
    private readonly fileReferenceService: FileReferenceService,
    private readonly painterNfseService: PainterNfseService,
  ) {}

  /**
   * Registra a intenção de emitir a NFS-e do aerografista quando a aerografia
   * chega a COMPLETED.
   *
   * Precisa ser chamado em TODO caminho que conclui uma aerografia, e são muitos:
   * update, batchUpdate, create e batchCreate aqui, mais dois `tx.airbrushing.*`
   * crus dentro de TaskService. Esquecer um deles significa aerografia concluída
   * sem nota e sem nenhum sinal de que faltou.
   *
   * Grava só a INTENÇÃO, dentro da transação da conclusão. A chamada à SEFIN é
   * feita depois do commit, pelo emissor — chamada de rede dentro de transação
   * Prisma segura conexão do pool pelo tempo da rede.
   */
  private async registerNfseIntent(
    tx: PrismaTransaction,
    params: {
      airbrushingId: string;
      painterId: string | null | undefined;
      previousStatus: string | null;
      nextStatus: string | null | undefined;
    },
  ): Promise<void> {
    if (params.nextStatus !== AIRBRUSHING_STATUS.COMPLETED) return;

    await this.painterNfseService.registerIntent(tx, {
      airbrushingId: params.airbrushingId,
      painterId: params.painterId ?? null,
      resetFailed: params.previousStatus !== AIRBRUSHING_STATUS.COMPLETED,
    });
  }

  /**
   * Dispara a emissão das notas já com a transação COMMITADA.
   *
   * A trava mestra, o "nunca dentro de transação" e o engolir da falha vivem em
   * `PainterNfseService.flushAfterCompletion` — um lugar só, porque o TaskService
   * conclui aerografia por fora daqui e precisa se comportar igual. O que sobra
   * aqui é a pergunta local: esta operação CONCLUIU alguma coisa?
   */
  private async flushNfseEmissions(
    airbrushingIds: string[],
    status?: string | null,
  ): Promise<void> {
    if (status !== AIRBRUSHING_STATUS.COMPLETED) return;
    await this.painterNfseService.flushAfterCompletion(airbrushingIds);
  }

  /**
   * Validar entidade completa
   */
  private async validateAirbrushing(
    data: Partial<AirbrushingCreateFormData | AirbrushingUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar se a tarefa existe
    if (data.taskId) {
      const taskExists = await transaction.task.findUnique({
        where: { id: data.taskId },
      });
      if (!taskExists) {
        throw new NotFoundException('Tarefa não encontrada.');
      }
    }

    // Validar se o pintor existe
    if (data.painterId) {
      const painterExists = await transaction.user.findUnique({
        where: { id: data.painterId },
      });
      if (!painterExists) {
        throw new NotFoundException('Pintor não encontrado.');
      }
    }

    // Validar status de pagamento: só pode ser diferente de PENDING quando a aerografia estiver concluída
    let existingAirbrushing: { status: string; paymentStatus: string } | null = null;
    if (existingId) {
      existingAirbrushing = await transaction.airbrushing.findUnique({
        where: { id: existingId },
        select: { status: true, paymentStatus: true },
      });
    }

    // Security: the gate uses the PERSISTED status, not the incoming payload —
    // otherwise a single request with { status: COMPLETED, paymentStatus: PAID }
    // satisfies its own precondition. The airbrushing must already be COMPLETED
    // in the database before the payment status can move away from PENDING.
    const persistedStatus = existingAirbrushing?.status ?? null;
    const persistedPaymentStatus =
      existingAirbrushing?.paymentStatus ?? AIRBRUSHING_PAYMENT_STATUS.PENDING;

    const paymentStatusChanging =
      data.paymentStatus !== undefined && data.paymentStatus !== persistedPaymentStatus;

    if (
      paymentStatusChanging &&
      data.paymentStatus !== AIRBRUSHING_PAYMENT_STATUS.PENDING &&
      persistedStatus !== AIRBRUSHING_STATUS.COMPLETED
    ) {
      throw new BadRequestException(
        'O status de pagamento só pode ser alterado quando a aerografia estiver concluída.',
      );
    }

    // A non-PENDING payment status may never coexist with a non-COMPLETED
    // airbrushing (blocks un-completing a paid airbrushing without first
    // resetting the payment).
    const effectiveStatus = data.status ?? persistedStatus ?? AIRBRUSHING_STATUS.PREPARATION;
    const effectivePaymentStatus = data.paymentStatus ?? persistedPaymentStatus;

    if (
      effectivePaymentStatus !== AIRBRUSHING_PAYMENT_STATUS.PENDING &&
      effectiveStatus !== AIRBRUSHING_STATUS.COMPLETED
    ) {
      throw new BadRequestException(
        'O status de pagamento só pode ser alterado quando a aerografia estiver concluída.',
      );
    }

    // Aerografia não tem campos únicos para validar
  }

  /**
   * Transições de status permitidas ao pintor (SECTOR_PRIVILEGES.AIRBRUSHING).
   *
   * The painter owns the work, not the schedule: they may start a job that was
   * released to the floor, conclude it, and reopen a job they concluded by
   * mistake. Moving a job into (or out of) Em Preparação / Aguardando Produção,
   * and cancelling, stay with admin/commercial.
   */
  private static readonly PAINTER_STATUS_TRANSITIONS: Record<string, AIRBRUSHING_STATUS[]> = {
    [AIRBRUSHING_STATUS.WAITING_PRODUCTION]: [AIRBRUSHING_STATUS.IN_PRODUCTION],
    [AIRBRUSHING_STATUS.IN_PRODUCTION]: [AIRBRUSHING_STATUS.COMPLETED],
    [AIRBRUSHING_STATUS.COMPLETED]: [AIRBRUSHING_STATUS.IN_PRODUCTION],
  };

  private assertPainterStatusTransition(currentStatus: string, nextStatus: unknown): void {
    // No status in the payload, or a no-op write — nothing to gate.
    if (nextStatus === undefined || nextStatus === null || nextStatus === currentStatus) return;

    if (currentStatus === AIRBRUSHING_STATUS.PREPARATION) {
      throw new BadRequestException(
        'Esta aerografia ainda não foi disponibilizada para produção. Peça ao setor comercial ou a um administrador para liberá-la.',
      );
    }

    const allowed = AirbrushingService.PAINTER_STATUS_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(nextStatus as AIRBRUSHING_STATUS)) {
      throw new BadRequestException(
        'O pintor só pode iniciar ou concluir a aerografia. Solicite a alteração ao setor comercial ou a um administrador.',
      );
    }
  }

  /**
   * Preenche startedAt/finishedAt a partir da transição de status (espelha o
   * [AUTO-FILL] de Task). Mutates `updateData` in place.
   */
  private applyStatusTimestamps(
    /** null na criação: não há status anterior com que comparar. */
    existing: { status: string; startedAt?: Date | null; finishedAt?: Date | null } | null,
    updateData: Record<string, any>,
  ): void {
    const nextStatus = updateData.status;
    if (!nextStatus || nextStatus === existing?.status) return;

    const stampStart = () => {
      if (!existing?.startedAt && updateData.startedAt === undefined) {
        updateData.startedAt = new Date();
      }
    };

    if (nextStatus === AIRBRUSHING_STATUS.IN_PRODUCTION) {
      stampStart();
    }

    if (nextStatus === AIRBRUSHING_STATUS.COMPLETED) {
      if (!existing?.finishedAt && updateData.finishedAt === undefined) {
        updateData.finishedAt = new Date();
      }
      // A job completed without ever passing through Em Produção still needs a start.
      stampStart();
    } else if (
      existing?.status === AIRBRUSHING_STATUS.COMPLETED &&
      existing.finishedAt &&
      updateData.finishedAt === undefined
    ) {
      // Reabrir uma aerografia LIMPA o término. Sem isso, finalizar por engano no dia T
      // e refinalizar de verdade em T+30 mantinha finishedAt = T (o carimbo acima só
      // grava quando finishedAt está vazio), e applyDueDate — que roda logo depois e
      // deriva o vencimento do término — reemitia o vencimento antigo: a linha nascia
      // em Contas a Pagar já vencida. Limpar aqui faz o próximo COMPLETED carimbar
      // término novo e, com ele, o vencimento correto.
      updateData.finishedAt = null;
    }
  }

  /**
   * Estado de vencimento resultante de mesclar o payload com o que está persistido.
   * Num update parcial a regra e o campo que ela consome chegam em requisições
   * diferentes, então nem o zod nem o payload sozinho conseguem julgar coerência —
   * só a mescla consegue.
   */
  private mergeDueDateConfig(
    existing: Record<string, any> | null,
    data: Record<string, any>,
  ): {
    dueDateRule: AIRBRUSHING_DUE_DATE_RULE;
    paymentTermDays: number | null;
    dueDayOfMonth: number | null;
    dueDate: Date | null;
    finishReference: Date | null;
  } {
    const pick = <T>(key: string): T =>
      (data[key] !== undefined ? data[key] : (existing?.[key] ?? null)) as T;

    return {
      dueDateRule:
        pick<AIRBRUSHING_DUE_DATE_RULE>('dueDateRule') ?? AIRBRUSHING_DUE_DATE_RULE.DAYS_AFTER_FINISH,
      paymentTermDays: pick<number | null>('paymentTermDays'),
      dueDayOfMonth: pick<number | null>('dueDayOfMonth'),
      dueDate: pick<Date | null>('dueDate'),
      finishReference: pick<Date | null>('finishedAt') ?? pick<Date | null>('finishDate'),
    };
  }

  /**
   * Uma regra sem o campo que ela consome produziria um vencimento nulo silencioso —
   * a aerografia sumiria da coluna Vencimento sem que ninguém soubesse por quê.
   * Falha alto, no momento da escrita.
   */
  private assertDueDateConfig(config: ReturnType<AirbrushingService['mergeDueDateConfig']>): void {
    if (config.dueDateRule === AIRBRUSHING_DUE_DATE_RULE.DAY_OF_MONTH && !config.dueDayOfMonth) {
      throw new BadRequestException(
        'Informe o dia do vencimento (1 a 31) para usar a regra de dia fixo do mês.',
      );
    }

    if (config.dueDateRule === AIRBRUSHING_DUE_DATE_RULE.FIXED_DATE && !config.dueDate) {
      throw new BadRequestException(
        'Informe a data de vencimento para usar a regra de data específica.',
      );
    }
  }

  /**
   * Materializa `dueDate` em `updateData` a partir da regra de vencimento.
   *
   * Roda em TODA escrita, e não só na conclusão, para que o vencimento acompanhe
   * sozinho o término do serviço, uma correção posterior de `finishedAt` ou uma
   * troca de regra — Contas a Pagar então só lê a coluna, sem recalcular nada.
   * Enquanto a aerografia não terminou, a referência é o término PREVISTO, de modo
   * que a linha já aparece com uma previsão de vencimento; quando ela é concluída,
   * o `finishedAt` real assume e a data se firma.
   *
   * FIXED_DATE é a exceção deliberada: a data é do usuário, não uma função do
   * término, então é gravada como veio e nunca recalculada.
   */
  private applyDueDate(existing: Record<string, any> | null, updateData: Record<string, any>): void {
    const config = this.mergeDueDateConfig(existing, updateData);
    this.assertDueDateConfig(config);

    if (config.dueDateRule === AIRBRUSHING_DUE_DATE_RULE.FIXED_DATE) return;

    updateData.dueDate = resolveAirbrushingDueDate(config, config.finishReference);
  }

  /**
   * Quais layouts este papel pode receber.
   *
   * - Comercial/design/logística/gestão/admin enxergam tudo, inclusive reprovados —
   *   é com eles que a aprovação acontece.
   * - O AEROGRAFISTA recebe aprovados E rascunhos, mas NUNCA um reprovado. O
   *   rascunho é deliberado: o pintor precisa se programar antes da arte fechar, e o
   *   app marca esse arquivo com a tarja "não liberada para produção". Um layout
   *   REPROVADO não é uma prévia, é uma arte descartada — mandá-lo para a oficina é
   *   como mandar produzir o que o cliente recusou.
   * - Todo o resto (incl. PRODUÇÃO) só recebe APROVADO, igual aos layouts de tarefa.
   *
   * `status === null` é tolerado como aprovado por causa de linhas antigas anteriores
   * à coluna de status.
   */
  private filterLayoutsForRole<T extends { layouts?: any[] | null }>(entity: T, userRole?: string): T {
    if (!userRole || !entity.layouts) return entity;

    const FULL_ACCESS_ROLES = [
      SECTOR_PRIVILEGES.COMMERCIAL,
      SECTOR_PRIVILEGES.DESIGNER,
      SECTOR_PRIVILEGES.LOGISTIC,
      SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
      SECTOR_PRIVILEGES.ADMIN,
    ] as string[];

    if (FULL_ACCESS_ROLES.includes(userRole)) return entity;

    const visible =
      userRole === SECTOR_PRIVILEGES.AIRBRUSHING
        ? entity.layouts.filter(layout => layout.status !== LAYOUT_STATUS.REPROVED)
        : entity.layouts.filter(
            layout => layout.status === LAYOUT_STATUS.APPROVED || layout.status === null,
          );

    return { ...entity, layouts: visible };
  }

  /**
   * Recorta a NFS-e ao que este usuário pode ver.
   *
   * O include `nfse` é legítimo (a TABELA da web tem coluna de status da nota),
   * mas `GET /airbrushings/:id` está aberto a 13 papéis enquanto o endpoint
   * dedicado `GET /airbrushings/:id/nfse` só admite quatro. Sem este recorte,
   * pedir `?include={"nfse":true}` contornava aquele gate e entregava dado
   * fiscal — chave de acesso, valor, CNPJ do prestador — para PRODUÇÃO,
   * ESTOQUE, MANUTENÇÃO e até EXTERNO.
   *
   * O aerografista vê a NOTA DELE: ela é emitida no CNPJ dele, ele é o
   * prestador. Ver a de outro pintor continua fora — é a mesma regra de posse
   * que já vale para recibos e notas fiscais anexadas.
   */
  private filterNfseForRole<T extends { nfse?: any; painterId?: string | null }>(
    entity: T,
    userRole?: string,
    userId?: string,
  ): T {
    if (!entity || entity.nfse === undefined || entity.nfse === null) return entity;

    const FINANCE_ROLES = [
      SECTOR_PRIVILEGES.ADMIN,
      SECTOR_PRIVILEGES.ACCOUNTING,
      SECTOR_PRIVILEGES.FINANCIAL,
      SECTOR_PRIVILEGES.COMMERCIAL,
    ] as string[];

    if (userRole && FINANCE_ROLES.includes(userRole)) return entity;

    const isOwnPainter =
      userRole === SECTOR_PRIVILEGES.AIRBRUSHING &&
      !!userId &&
      !!entity.painterId &&
      entity.painterId === userId;
    if (isOwnPainter) return entity;

    return { ...entity, nfse: undefined };
  }

  /**
   * Buscar muitas aerografias com filtros
   */
  async findMany(
    query: AirbrushingGetManyFormData,
    userRole?: string,
    userId?: string,
  ): Promise<AirbrushingGetManyResponse> {
    try {
      const result = await this.airbrushingRepository.findMany(query);

      // Recorta os layouts ao que este papel pode ver — ver filterLayoutsForRole.
      if (userRole) {
        result.data = result.data.map(airbrushing =>
          this.filterLayoutsForRole(airbrushing, userRole),
        );
      }
      // A NFS-e é recortada SEMPRE, mesmo sem papel conhecido: na dúvida, dado
      // fiscal não sai.
      result.data = result.data.map(airbrushing =>
        this.filterNfseForRole(airbrushing, userRole, userId),
      );

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Aerografias carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar aerografias:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar aerografias. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar uma aerografia por ID
   */
  async findById(
    id: string,
    include?: AirbrushingInclude,
    userRole?: string,
    userId?: string,
  ): Promise<AirbrushingGetUniqueResponse> {
    try {
      const airbrushing = await this.airbrushingRepository.findById(id, { include });

      if (!airbrushing) {
        throw new NotFoundException('Aerografia não encontrada.');
      }

      // Recorta os layouts ao que este papel pode ver — ver filterLayoutsForRole.
      const withLayouts = userRole ? this.filterLayoutsForRole(airbrushing, userRole) : airbrushing;
      // A NFS-e é recortada SEMPRE, mesmo sem papel conhecido: na dúvida, dado
      // fiscal não sai.
      const visible = this.filterNfseForRole(withLayouts, userRole, userId);

      return { success: true, data: visible, message: 'Aerografia carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar aerografia por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar nova aerografia
   */
  async create(
    data: AirbrushingCreateFormData,
    include?: AirbrushingInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      layouts?: Express.Multer.File[];
    },
    userRole?: string,
  ): Promise<AirbrushingCreateResponse> {
    try {
      const airbrushing = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.validateAirbrushing(data, undefined, tx);

        // Extract layoutStatuses (not a Prisma field) before create
        const layoutStatuses = (data as any).layoutStatuses as
          | Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>
          | undefined;

        // Criar já como COMPLETED é permitido pelo zod, e este caminho nunca
        // chamava applyStatusTimestamps: a aerografia nascia concluída SEM
        // finishedAt. Sem término não há competência para a NFS-e nem
        // vencimento em Contas a Pagar.
        this.applyStatusTimestamps(null, data as Record<string, any>);

        // Materializa o vencimento já na criação, para que uma aerografia com
        // término previsto apareça em Contas a Pagar com a previsão certa.
        this.applyDueDate(null, data as Record<string, any>);

        // Criar a aerografia (layouts são tratadas separadamente abaixo)
        let newAirbrushing = await this.airbrushingRepository.createWithTransaction(tx, data, {
          include,
        });

        // Process file uploads if provided. Receipts/invoices are linked inside;
        // uploaded layout files come back as File IDs to convert into Layouts.
        let uploadedLayoutFileIds: string[] = [];
        if (files && (files.receipts?.length || files.invoices?.length || files.layouts?.length)) {
          const uploaded = await this.processAirbrushingFileUploads(
            newAirbrushing.id,
            files,
            userId,
            tx,
          );
          uploadedLayoutFileIds = uploaded.layoutIds;
        }

        // CRITICAL: convert layout File IDs (payload + uploads) into Layout
        // entities linked to this airbrushing. Without this, art uploaded at
        // creation would be an orphaned File with no Layout row (mirrors update()).
        const layoutFileIds = [...(data.layoutIds || []), ...uploadedLayoutFileIds];
        if (layoutFileIds.length > 0) {
          await this.convertFileIdsToLayoutIds(
            layoutFileIds,
            newAirbrushing.id,
            layoutStatuses,
            userRole,
            tx,
          );
          // Re-fetch so the response reflects the newly created layouts + files
          const refreshed = await this.airbrushingRepository.findByIdWithTransaction(
            tx,
            newAirbrushing.id,
            { include },
          );
          if (refreshed) newAirbrushing = refreshed;
        }

        // NFS-e do aerografista: o zod permite criar uma aerografia já com
        // status COMPLETED, então este caminho também conclui.
        await this.registerNfseIntent(tx, {
          airbrushingId: newAirbrushing.id,
          painterId: (newAirbrushing as any).painterId,
          previousStatus: null,
          nextStatus: (newAirbrushing as any).status,
        });

        // Registrar no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.AIRBRUSHING,
          entityId: newAirbrushing.id,
          action: CHANGE_ACTION.CREATE,
          field: null,
          oldValue: null,
          newValue: newAirbrushing,
          reason: 'Aerografia criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: newAirbrushing.id,
          userId: userId || null,
          transaction: tx,
        });

        return newAirbrushing;
      });

      // Emissão FORA da transação — ver flushNfseEmissions. Criar já concluída é
      // uma conclusão como outra qualquer: sem este flush a intenção ficava
      // registrada e a nota só saía na varredura seguinte, enquanto o mesmo
      // status vindo por `update` emitia na hora.
      await this.flushNfseEmissions([(airbrushing as any).id], (airbrushing as any)?.status);

      return {
        success: true,
        message: 'Aerografia criada com sucesso.',
        data: airbrushing,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar aerografia:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar aerografia
   */
  async update(
    id: string,
    data: AirbrushingUpdateFormData,
    include?: AirbrushingInclude,
    userId?: string,
    files?: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      layouts?: Express.Multer.File[];
    },
    userRole?: string,
  ): Promise<AirbrushingUpdateResponse> {
    try {
      const updatedAirbrushing = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar aerografia existente
        const existingAirbrushing = await this.airbrushingRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingAirbrushing) {
          throw new NotFoundException('Aerografia não encontrada.');
        }

        // Validar entidade completa
        await this.validateAirbrushing(data, id, tx);

        // Extract layoutStatuses from data before removing it
        const layoutStatuses = (data as any).layoutStatuses as
          | Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>
          | undefined;
        this.logger.log(
          `[Airbrushing Update] layoutStatuses received: ${JSON.stringify(layoutStatuses)}`,
        );

        // AIRBRUSHING (painters) may only drive the job's workflow. The @Roles gate lets
        // the role reach this endpoint; this restricts what it can write to
        // status/startedAt/finishedAt. Files and every money/relation field are ignored,
        // so a painter can start/finish a job but never touch price, paymentStatus,
        // painterId, or attachments — even via a hand-crafted request.
        const isPainterRestricted = userRole === SECTOR_PRIVILEGES.AIRBRUSHING;

        // Process file uploads if provided and get new file IDs
        let newFileIds = {
          receiptIds: [] as string[],
          invoiceIds: [] as string[],
          layoutIds: [] as string[],
        };
        if (
          !isPainterRestricted &&
          files &&
          (files.receipts?.length || files.invoices?.length || files.layouts?.length)
        ) {
          newFileIds = await this.processAirbrushingFileUploads(id, files, userId, tx);
        }

        // Build update data. layoutStatuses is not a Prisma field.
        const updateData: any = { ...data };
        delete updateData.layoutStatuses;

        if (isPainterRestricted) {
          const PAINTER_WRITABLE_FIELDS = new Set(['status', 'startedAt', 'finishedAt']);
          for (const key of Object.keys(updateData)) {
            if (!PAINTER_WRITABLE_FIELDS.has(key)) {
              delete updateData[key];
            }
          }
        }

        // Releasing a job to the floor ("Disponibilizar para Produção") is an
        // admin/commercial decision — a painter may only drive the work itself.
        // The @Roles gate + the field strip above already keep painters off every
        // other column; this keeps them off the release gate too, so a painter
        // cannot self-release a job that is still being prepared (nor pull a
        // released one back).
        if (isPainterRestricted) {
          this.assertPainterStatusTransition(existingAirbrushing.status, updateData.status);
        }

        // Auto-stamp the actual start/finish timestamps from the status transition —
        // mirrors the task's [AUTO-FILL] behaviour so "Iniciado em"/"Finalizado em"
        // are populated by simply advancing the job. An explicitly supplied value
        // always wins; an already-stamped timestamp is never overwritten.
        this.applyStatusTimestamps(existingAirbrushing, updateData);

        // Recalcula o vencimento DEPOIS do carimbo de finishedAt acima — é
        // justamente concluir a aerografia que fixa a data ("vence 3 dias após o
        // término"). Roda também no caminho do pintor: ele não escreve nenhum campo
        // de vencimento, mas o `finishedAt` que ele acabou de carimbar é a
        // referência da regra, então a data precisa acompanhar.
        this.applyDueDate(existingAirbrushing as Record<string, any>, updateData);

        // File-relation reconciliation must be INTENT-BASED. The repository maps every
        // provided *Ids array to a Prisma `set` (a full replace). A partial update — e.g. an
        // inline status/painter/price/paymentStatus edit from the detail page — provides none
        // of these arrays, so the relations must be left untouched. Reconciling
        // unconditionally would push `set: []` and wipe every attached receipt/invoice/layout.
        // Only reconcile a collection when the payload explicitly provided its IDs OR new files
        // of that type were uploaded in this request.
        await this.reconcileFileRelations(tx, id, data, updateData, {
          newFileIds,
          layoutStatuses,
          userRole,
          skipAll: isPainterRestricted,
          logPrefix: '[Airbrushing Update]',
        });

        // Atualizar a aerografia
        const updatedAirbrushing = await this.airbrushingRepository.updateWithTransaction(
          tx,
          id,
          updateData,
          { include },
        );

        // NFS-e do aerografista: registra a intenção quando esta atualização
        // concluiu a aerografia. Caminho da tela de detalhe e do app do pintor.
        await this.registerNfseIntent(tx, {
          airbrushingId: id,
          painterId: (updatedAirbrushing as any).painterId,
          previousStatus: existingAirbrushing.status,
          nextStatus: (updatedAirbrushing as any).status,
        });

        // Registrar mudanças no changelog
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.AIRBRUSHING,
          entityId: id,
          action: CHANGE_ACTION.UPDATE,
          field: null,
          oldValue: existingAirbrushing,
          newValue: updatedAirbrushing,
          reason: 'Aerografia atualizada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        return updatedAirbrushing;
      });

      // Emissão FORA da transação — ver flushNfseEmissions.
      await this.flushNfseEmissions([id], (updatedAirbrushing as any)?.status);

      return {
        success: true,
        message: 'Aerografia atualizada com sucesso.',
        data: updatedAirbrushing,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar aerografia:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Anexar comprovante(s) de pagamento a uma aerografia — APPEND-ONLY.
   *
   * Payment-side counterpart of `PUT /orders/:id/receipts`: Contas a Pagar settles a
   * painter's aerografia and indexes the comprovante without going through the generic
   * PUT :id. That matters for correctness, not just for roles: the generic update maps
   * any provided `receiptIds` to a Prisma `set` (full replace), so a caller that uploads
   * a receipt WITHOUT first hydrating the existing ones — which the payables list, that
   * only holds a PayableRow, never has — would detach every comprovante already
   * attached. Here the files are simply connected (see saveFileTostorage), so whatever
   * is attached stays attached.
   */
  async attachReceipts(
    id: string,
    files: { receipts?: Express.Multer.File[] } | undefined,
    userId?: string,
  ): Promise<AirbrushingUpdateResponse> {
    try {
      const airbrushing = await this.prisma.airbrushing.findUnique({ where: { id } });
      if (!airbrushing) {
        throw new NotFoundException('Aerografia não encontrada.');
      }

      if (files?.receipts?.length) {
        // saveFileTostorage requires a transaction (file row + relation connect).
        await this.prisma.$transaction(async (tx: PrismaTransaction) => {
          await this.processAirbrushingFileUploads(id, { receipts: files.receipts }, userId, tx);
        });
      }

      return {
        success: true,
        message: 'Comprovante anexado à aerografia.',
        data: airbrushing as unknown as Airbrushing,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Erro ao anexar comprovante à aerografia ${id}:`, error);
      throw new InternalServerErrorException(
        'Erro ao anexar comprovante. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Desanexar UM comprovante da aerografia — contrapartida exata de `attachReceipts`.
   *
   * Existe para que trocar/remover comprovante NÃO precise passar pelo PUT :id com
   * `receiptIds`: aquele caminho mapeia para um `set` do Prisma (substituição total),
   * então exige que o chamador tenha a lista inteira hidratada — quem só segura uma
   * linha do Contas a Pagar nunca tem — e um payload montado com estado velho apaga
   * anexos silenciosamente. Aqui a intenção é uma só e o alvo é explícito.
   *
   * DESANEXA, não apaga: o registro File continua, e o varredor de órfãos recolhe
   * depois se ninguém mais apontar para ele. Apagar aqui destruiria um documento que
   * pode estar em uso por outra entidade.
   */
  async detachReceipt(
    id: string,
    fileId: string,
    userId?: string,
  ): Promise<AirbrushingUpdateResponse> {
    try {
      const airbrushing = await this.prisma.airbrushing.findUnique({
        where: { id },
        include: { receipts: { select: { id: true } } },
      });
      if (!airbrushing) {
        throw new NotFoundException('Aerografia não encontrada.');
      }

      // 404 em vez de no-op silencioso: pedir para remover um comprovante que não está
      // ali quase sempre é a tela operando em cima de estado velho.
      if (!airbrushing.receipts.some(r => r.id === fileId)) {
        throw new NotFoundException('Comprovante não encontrado nesta aerografia.');
      }

      const updated = await this.prisma.airbrushing.update({
        where: { id },
        data: { receipts: { disconnect: { id: fileId } } },
      });

      this.logger.log(
        `Comprovante ${fileId} desanexado da aerografia ${id}${userId ? ` por ${userId}` : ''}`,
      );

      return {
        success: true,
        message: 'Comprovante removido da aerografia.',
        data: updated as unknown as Airbrushing,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Erro ao remover comprovante da aerografia ${id}:`, error);
      throw new InternalServerErrorException(
        'Erro ao remover comprovante. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir aerografia
   */
  /**
   * (table, column) pairs of every FK that points at File.id, read from the Postgres
   * catalog rather than hand-listed.
   *
   * File has ~35 back-relations. A hand-written "is this file still in use?" check would
   * silently rot the day someone adds relation 36 — and the failure mode is deleting a file
   * that is still referenced. Asking the catalog keeps the check correct by construction.
   * Cached per process: the schema cannot change while the app runs.
   */
  /**
   * True when anything OTHER than the airbrushing being deleted still points at this File.
   *
   * Delegates to FileReferenceService — the same check the file-delete endpoints and the
   * organizer use. This method used to carry its own private copy of the FK-catalog logic
   * (plus the explicit quoteLayoutId check), which is exactly the kind of duplication that
   * let the 2026-06 purge use a DIFFERENT, incomplete definition of "orphan".
   */
  private async fileHasOtherReferences(
    tx: PrismaTransaction,
    fileId: string,
    airbrushingId: string,
  ): Promise<boolean> {
    // Ignore this airbrushing's OWN links — they are what we are tearing down.
    return this.fileReferenceService.hasReferences(fileId, {
      transaction: tx,
      exclude: [
        { table: '_AIRBRUSHING_RECEIPTS', ownerColumn: 'A', ownerId: airbrushingId },
        { table: '_AIRBRUSHING_INVOICES', ownerColumn: 'A', ownerId: airbrushingId },
        { table: 'Layout', ownerColumn: 'airbrushingId', ownerId: airbrushingId },
      ],
    });
  }

  /**
   * Release an airbrushing's files before the row (and its cascades) disappear.
   *
   * Two distinct problems this solves:
   *
   *  1. SHARED LAYOUTS WERE BEING DESTROYED. Layout.airbrushingId is onDelete: Cascade, so
   *     deleting an airbrushing deletes its Layout rows outright — including any Layout that
   *     is ALSO connected to tasks through the TaskLayouts join table, silently removing the
   *     layout from those tasks. Such layouts are detached (airbrushingId = null) instead, so
   *     the cascade cannot reach them and the tasks keep their art.
   *  2. FILES AND BYTES WERE LEAKING. delete() never touched files, so the File rows became
   *     unreachable orphans and their bytes stayed on disk forever — and because
   *     'Aerografias' is in FileCleanupSchedulerService.sambaExcludedFolders, the nightly
   *     orphan reaper never walks that tree to reclaim them.
   *
   * Deletion is deliberately conservative: a file is removed only when nothing outside this
   * airbrushing still references it (checked against the live FK catalog), and any error in
   * that check keeps the file.
   */
  private async cleanUpAirbrushingFiles(
    tx: PrismaTransaction,
    airbrushingId: string,
    _userId?: string,
  ): Promise<Array<{ id: string; path: string }>> {
    const owned = await tx.airbrushing.findUnique({
      where: { id: airbrushingId },
      select: {
        layouts: {
          select: { id: true, fileId: true, tasks: { select: { id: true }, take: 1 } },
        },
        receipts: { select: { id: true } },
        invoices: { select: { id: true } },
      },
    });
    if (!owned) return [];

    // (1) Protect layouts shared with tasks from the cascade.
    const sharedLayoutIds = owned.layouts
      .filter(l => (l.tasks?.length ?? 0) > 0)
      .map(l => l.id);
    if (sharedLayoutIds.length > 0) {
      await tx.layout.updateMany({
        where: { id: { in: sharedLayoutIds } },
        data: { airbrushingId: null },
      });
      this.logger.log(
        `[Airbrushing Delete] Detached ${sharedLayoutIds.length} task-linked layout(s) from airbrushing ${airbrushingId} so the cascade cannot delete them.`,
      );
    }

    // (2) Reclaim files that nothing else references.
    const candidateFileIds = [
      ...owned.layouts.filter(l => (l.tasks?.length ?? 0) === 0).map(l => l.fileId),
      ...owned.receipts.map(f => f.id),
      ...owned.invoices.map(f => f.id),
    ];

    const purge: Array<{ id: string; path: string }> = [];
    for (const fileId of new Set(candidateFileIds)) {
      if (await this.fileHasOtherReferences(tx, fileId, airbrushingId)) {
        this.logger.log(
          `[Airbrushing Delete] Keeping file ${fileId} — still referenced outside airbrushing ${airbrushingId}.`,
        );
        continue;
      }
      try {
        const file = await tx.file.findUnique({ where: { id: fileId }, select: { path: true } });
        // Dono explicito ANTES do arquivo. Antes isto contava com o cascade de
        // Layout.fileId, mas o gatilho file_no_delete_when_referenced roda BEFORE DELETE:
        // naquele instante a linha Layout ainda existe e o arquivo ainda esta "em uso".
        // Apagar o Layout primeiro deixa a ordem honesta -- e a trava continua valendo
        // para todo mundo, em vez de abrir excecao para este caminho.
        await tx.layout.deleteMany({ where: { fileId } });
        await tx.file.delete({ where: { id: fileId } });
        if (file?.path) purge.push({ id: fileId, path: file.path });
      } catch (error: any) {
        // Never fail the airbrushing deletion over a file cleanup problem.
        this.logger.error(`[Airbrushing Delete] Failed to delete file ${fileId}: ${error.message}`);
      }
    }

    if (purge.length > 0) {
      this.logger.log(
        `[Airbrushing Delete] Removed ${purge.length} exclusively-owned file row(s) for airbrushing ${airbrushingId}; bytes purged after commit.`,
      );
    }

    // Bytes are deleted only AFTER the transaction commits — an unlink cannot be rolled
    // back, so purging inside the tx would destroy files that a later rollback restores
    // rows for.
    return purge;
  }

  async delete(id: string, userId?: string): Promise<AirbrushingDeleteResponse> {
    try {
      let filesToPurge: Array<{ id: string; path: string }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const airbrushing = await this.airbrushingRepository.findByIdWithTransaction(tx, id);

        if (!airbrushing) {
          throw new NotFoundException('Aerografia não encontrada.');
        }

        filesToPurge = await this.cleanUpAirbrushingFiles(tx, id, userId);

        // Registrar exclusão
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.AIRBRUSHING,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          field: null,
          oldValue: airbrushing,
          newValue: null,
          reason: 'Aerografia excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });

        await this.airbrushingRepository.deleteWithTransaction(tx, id);
      });

      // Post-commit: the DB rows are gone for good, so the bytes and thumbnails can go too.
      // Best-effort — a failure here leaves recoverable garbage, never a broken record.
      for (const file of filesToPurge) {
        await this.fileService.purgePhysicalFile(file.path, file.id);
      }

      return {
        success: true,
        message: 'Aerografia excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir aerografia:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir aerografia. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplas aerografias
   */
  async batchCreate(
    data: AirbrushingBatchCreateFormData,
    include?: AirbrushingInclude,
    userId?: string,
    userRole?: string,
  ): Promise<AirbrushingBatchCreateResponse<AirbrushingCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: Airbrushing[] = [];
        const failedCreations: any[] = [];

        // Processar cada aerografia individualmente para validação detalhada
        for (let index = 0; index < data.airbrushings.length; index++) {
          const airbrushingData = data.airbrushings[index];
          try {
            // Validar entidade completa
            await this.validateAirbrushing(airbrushingData, undefined, tx);

            // Mesmas correções do create() individual — este caminho fala com o
            // repositório direto e não herda nada dele.
            this.applyStatusTimestamps(null, airbrushingData as Record<string, any>);
            this.applyDueDate(null, airbrushingData as Record<string, any>);

            // Criar a aerografia (layouts tratadas separadamente abaixo)
            let newAirbrushing = await this.airbrushingRepository.createWithTransaction(
              tx,
              airbrushingData,
              { include },
            );

            // Convert layout File IDs into Layout entities linked to this
            // airbrushing (batch has no multipart uploads — payload IDs only).
            if (airbrushingData.layoutIds && airbrushingData.layoutIds.length > 0) {
              await this.convertFileIdsToLayoutIds(
                airbrushingData.layoutIds,
                newAirbrushing.id,
                (airbrushingData as any).layoutStatuses,
                userRole,
                tx,
              );
              const refreshed = await this.airbrushingRepository.findByIdWithTransaction(
                tx,
                newAirbrushing.id,
                { include },
              );
              if (refreshed) newAirbrushing = refreshed;
            }

            successfulCreations.push(newAirbrushing);

            // NFS-e do aerografista — mesmo motivo do create() individual.
            await this.registerNfseIntent(tx, {
              airbrushingId: newAirbrushing.id,
              painterId: (newAirbrushing as any).painterId,
              previousStatus: null,
              nextStatus: (newAirbrushing as any).status,
            });

            // Registrar no changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.AIRBRUSHING,
              entityId: newAirbrushing.id,
              action: CHANGE_ACTION.CREATE,
              field: null,
              oldValue: null,
              newValue: newAirbrushing,
              reason: 'Aerografia criada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              triggeredById: newAirbrushing.id,
              userId: userId || null,
              transaction: tx,
            });
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar aerografia.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: airbrushingData,
            });
          }
        }

        return {
          success: successfulCreations,
          failed: failedCreations,
          totalCreated: successfulCreations.length,
          totalFailed: failedCreations.length,
        };
      });

      // Emissão FORA da transação — ver flushNfseEmissions. Mesmo critério do
      // batchUpdate: só as que ficaram concluídas nesta operação.
      await this.flushNfseEmissions(
        result.success
          .filter((a: any) => a?.status === AIRBRUSHING_STATUS.COMPLETED)
          .map((a: any) => a.id),
        AIRBRUSHING_STATUS.COMPLETED,
      );

      const successMessage =
        result.totalCreated === 1
          ? '1 aerografia criada com sucesso'
          : `${result.totalCreated} aerografias criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchCreateResult to BatchOperationResult format
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
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar aerografias em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas aerografias
   */
  async batchUpdate(
    data: AirbrushingBatchUpdateFormData,
    include?: AirbrushingInclude,
    userId?: string,
    userRole?: string,
  ): Promise<AirbrushingBatchUpdateResponse<AirbrushingUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: Airbrushing[] = [];
        const failedUpdates: any[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.airbrushings.length; index++) {
          const { id, data: updateData } = data.airbrushings[index];
          try {
            // Buscar aerografia existente
            const existingAirbrushing = await this.airbrushingRepository.findByIdWithTransaction(
              tx,
              id,
            );
            if (!existingAirbrushing) {
              throw new NotFoundException('Aerografia não encontrada.');
            }

            // Validar entidade completa
            await this.validateAirbrushing(updateData, id, tx);

            // BATCH IS A BULK *SCALAR* EDIT SURFACE — it never rewrites file relations.
            //
            // This endpoint is JSON-only, so it cannot carry an upload: the only thing it
            // could ever do to an attachment list is DESTROY entries. An operation that can
            // only destroy, applied to N entities at once, is how 15 airbrushings lost every
            // layout in a week — one task-edit save shipped `layoutIds: []` per row and the
            // repository turned each into `layouts: { set: [] }`. Nothing distinguishes "the
            // user removed the files" from "the client built an empty snapshot", so the
            // ambiguity is removed instead of arbitrated: attachment changes belong to the
            // single PUT /airbrushings/:id, which owns the upload + reconciliation path.
            const batchUpdateData: any = { ...updateData };
            const droppedRelations = ['receiptIds', 'invoiceIds', 'layoutIds', 'layoutStatuses']
              .filter(k => batchUpdateData[k] !== undefined);
            for (const k of droppedRelations) delete batchUpdateData[k];
            if (droppedRelations.length > 0) {
              this.logger.warn(
                `[Airbrushing BatchUpdate] Ignoring file-relation fields for airbrushing ${id}: ` +
                  `${droppedRelations.join(', ')}. Attachments must be changed through ` +
                  `PUT /airbrushings/:id — the batch endpoint only edits scalar fields.`,
              );
            }

            // O batch fala com o repositório direto, então precisa repetir o que
            // update() faz. Sem isto, "Finalizar" em lote pela tabela concluía a
            // aerografia SEM carimbar finishedAt — e um término sem data nunca
            // produz vencimento, deixando a linha de Contas a Pagar sem Vencimento.
            this.applyStatusTimestamps(existingAirbrushing, batchUpdateData);
            this.applyDueDate(existingAirbrushing as Record<string, any>, batchUpdateData);

            // Atualizar a aerografia
            const updatedAirbrushing = await this.airbrushingRepository.updateWithTransaction(
              tx,
              id,
              batchUpdateData,
              { include },
            );
            successfulUpdates.push(updatedAirbrushing);

            // NFS-e do aerografista — este é o caminho do "Finalizar" em lote
            // pela tabela, que conclui várias aerografias de uma vez. Dispara
            // uma vez POR LINHA.
            await this.registerNfseIntent(tx, {
              airbrushingId: id,
              painterId: (updatedAirbrushing as any).painterId,
              previousStatus: existingAirbrushing.status,
              nextStatus: (updatedAirbrushing as any).status,
            });

            // Registrar no changelog
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.AIRBRUSHING,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: null,
              oldValue: existingAirbrushing,
              newValue: updatedAirbrushing,
              reason: 'Aerografia atualizada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar aerografia.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: { id, ...updateData },
            });
          }
        }

        return {
          success: successfulUpdates,
          failed: failedUpdates,
          totalUpdated: successfulUpdates.length,
          totalFailed: failedUpdates.length,
        };
      });

      // Emissão FORA da transação — ver flushNfseEmissions. Só as que ficaram
      // concluídas nesta operação.
      const completedIds = result.success
        .filter((a: any) => a?.status === AIRBRUSHING_STATUS.COMPLETED)
        .map((a: any) => a.id);
      await this.flushNfseEmissions(completedIds, AIRBRUSHING_STATUS.COMPLETED);

      const successMessage =
        result.totalUpdated === 1
          ? '1 aerografia atualizada com sucesso'
          : `${result.totalUpdated} aerografias atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchUpdateResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: {
            ...error.data,
            id: error.id || '',
          },
        })),
        totalProcessed: result.totalUpdated + result.totalFailed,
        totalSuccess: result.totalUpdated,
        totalFailed: result.totalFailed,
      };

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar aerografias em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete airbrushings
   */
  async batchDelete(
    data: AirbrushingBatchDeleteFormData,
    userId?: string,
  ): Promise<AirbrushingBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar aerografias antes de excluir para o changelog
        const airbrushings = await this.airbrushingRepository.findByIdsWithTransaction(
          tx,
          data.airbrushingIds,
        );

        // Registrar exclusões
        for (const airbrushing of airbrushings) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.AIRBRUSHING,
            entityId: airbrushing.id,
            action: CHANGE_ACTION.DELETE,
            field: null,
            oldValue: airbrushing,
            newValue: null,
            reason: 'Aerografia excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            triggeredById: airbrushing.id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.airbrushingRepository.deleteManyWithTransaction(tx, data.airbrushingIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 aerografia excluída com sucesso'
          : `${result.totalDeleted} aerografias excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error: any, index: number) => ({
          index: error.index || index,
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
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  /**
   * Process airbrushing file uploads
   * Returns object with arrays of newly created file IDs for each file type
   */
  private async processAirbrushingFileUploads(
    airbrushingId: string,
    files: {
      receipts?: Express.Multer.File[];
      invoices?: Express.Multer.File[];
      layouts?: Express.Multer.File[];
    },
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<{ receiptIds: string[]; invoiceIds: string[]; layoutIds: string[] }> {
    const transaction = tx || this.prisma;
    const receiptIds: string[] = [];
    const invoiceIds: string[] = [];
    const layoutIds: string[] = [];

    try {
      // Get airbrushing with task and customer info for folder organization
      const airbrushing = await transaction.airbrushing.findUnique({
        where: { id: airbrushingId },
        include: {
          task: {
            include: {
              customer: true,
            },
          },
        },
      });

      if (!airbrushing) {
        throw new NotFoundException('Aerografia não encontrada');
      }

      const customerName = airbrushing.task?.customer?.fantasyName;

      // Process receipt files
      if (files.receipts && files.receipts.length > 0) {
        for (const file of files.receipts) {
          const fileRecord = await this.saveFileTostorage(
            file,
            'airbrushingReceipts',
            airbrushingId,
            'airbrushing_receipt',
            customerName,
            userId,
            transaction,
          );
          receiptIds.push(fileRecord.id);
        }
      }

      // Process invoice files
      if (files.invoices && files.invoices.length > 0) {
        for (const file of files.invoices) {
          const fileRecord = await this.saveFileTostorage(
            file,
            'airbrushingInvoices',
            airbrushingId,
            'airbrushing_invoice',
            customerName,
            userId,
            transaction,
          );
          invoiceIds.push(fileRecord.id);
        }
      }

      // Process layout files - NOTE: With Layout entity, we just create Files here
      // The Layout entities will be created by the caller.
      // Context is 'airbrushingLayouts' (→ Clientes/{cliente}/Aerografias/Layouts/{PDFs|Imagens})
      // so airbrushing layouts sit alongside the airbrushing's own Comprovantes/Notas
      // Fiscais instead of being mixed into the task's Layouts folder. Must match the
      // context used by task.service.ts on the task-create/update/copy paths.
      if (files.layouts && files.layouts.length > 0) {
        for (const file of files.layouts) {
          const fileRecord = await this.fileService.createFromUploadWithTransaction(
            transaction,
            file,
            'airbrushingLayouts',
            userId,
            {
              entityId: airbrushingId,
              entityType: 'AIRBRUSHING',
              customerName,
            },
          );
          layoutIds.push(fileRecord.id);
        }
      }
    } catch (error) {
      this.logger.error('Erro ao processar upload de arquivos da aerografia:', error);
      throw error;
    }

    return { receiptIds, invoiceIds, layoutIds };
  }

  /**
   * Save file to storage and link to airbrushing
   */
  private async saveFileTostorage(
    file: Express.Multer.File,
    fileContext: string,
    entityId: string,
    entityType: string,
    customerName?: string,
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<any> {
    if (!tx) {
      throw new InternalServerErrorException('Transaction is required for file upload');
    }

    try {
      // Use centralized file service to create file with proper transaction handling
      const fileRecord = await this.fileService.createFromUploadWithTransaction(
        tx,
        file,
        fileContext as any,
        userId,
        {
          entityId,
          entityType,
          customerName,
        },
      );

      // Connect the file to the airbrushing using the appropriate relation
      // NOTE: layouts are now handled via the Layout entity, not direct File relations
      if (entityType === 'airbrushing_receipt') {
        await tx.file.update({
          where: { id: fileRecord.id },
          data: {
            airbrushingReceipts: { connect: { id: entityId } },
          },
        });
      } else if (entityType === 'airbrushing_invoice') {
        await tx.file.update({
          where: { id: fileRecord.id },
          data: {
            airbrushingInvoices: { connect: { id: entityId } },
          },
        });
      }

      this.logger.log(`Saved and linked file ${file.originalname} to airbrushing ${entityId}`);
      return fileRecord;
    } catch (error) {
      this.logger.error(`Error saving file to storage:`, error);
      throw error;
    }
  }

  /**
   * Reconcile the receipt/invoice/layout file relations of an airbrushing update.
   *
   * THE SINGLE PLACE where an airbrushing's file relations may be rewritten. Every
   * write path (single update, batch update) MUST go through here — a payload that
   * reaches the repository with a raw `*Ids` array bypasses three invariants at once:
   *
   *  1. INTENT. The repository maps any provided `*Ids` array to a Prisma `set` (a full
   *     replace), so an *absent* array must stay absent. A partial update (inline
   *     status/painter/price edit) provides none of them and must leave the relations
   *     untouched — pushing `set: []` silently detaches every attached file.
   *  2. ID DOMAIN. `layoutIds` from clients are FILE ids; the `layouts` relation stores
   *     LAYOUT entity ids. They must be converted (creating/adopting Layout rows) first,
   *     or Prisma is handed ids that do not exist in the target table.
   *  3. EXPLICIT CLEAR. Emptying a relation is a destructive, irreversible-looking
   *     operation, so it is only ever performed when this method decided the payload
   *     genuinely carries that intent — signalled downstream via `_allowRelationClear`.
   *
   * Mutates `updateData` in place: sets the reconciled arrays, deletes the ones that must
   * not be touched, and strips `layoutStatuses` (not a Prisma field).
   */
  private async reconcileFileRelations(
    tx: PrismaTransaction,
    id: string,
    data: any,
    updateData: any,
    opts: {
      newFileIds?: { receiptIds: string[]; invoiceIds: string[]; layoutIds: string[] };
      layoutStatuses?: Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>;
      userRole?: string;
      skipAll?: boolean;
      logPrefix: string;
    },
  ): Promise<void> {
    const newFileIds = opts.newFileIds ?? { receiptIds: [], invoiceIds: [], layoutIds: [] };

    // layoutStatuses drives Layout.status but is not a column on Airbrushing — reaching
    // the repository with it makes Prisma reject the whole write with an unknown-arg error.
    delete updateData.layoutStatuses;

    // A relation is reconciled only when the payload explicitly provided its IDs OR new
    // files of that type were uploaded in this request. Anything else: leave it alone.
    const reconcile = {
      receipts: !opts.skipAll && (data.receiptIds !== undefined || newFileIds.receiptIds.length > 0),
      invoices: !opts.skipAll && (data.invoiceIds !== undefined || newFileIds.invoiceIds.length > 0),
      layouts: !opts.skipAll && (data.layoutIds !== undefined || newFileIds.layoutIds.length > 0),
    };

    if (reconcile.receipts) {
      updateData.receiptIds = [...(data.receiptIds || []), ...newFileIds.receiptIds];
    } else {
      delete updateData.receiptIds;
    }

    if (reconcile.invoices) {
      updateData.invoiceIds = [...(data.invoiceIds || []), ...newFileIds.invoiceIds];
    } else {
      delete updateData.invoiceIds;
    }

    if (reconcile.layouts) {
      const combinedLayoutFileIds = [...(data.layoutIds || []), ...newFileIds.layoutIds];
      let layoutEntityIds: string[] = [];
      if (combinedLayoutFileIds.length > 0) {
        layoutEntityIds = await this.convertFileIdsToLayoutIds(
          combinedLayoutFileIds,
          id,
          opts.layoutStatuses,
          opts.userRole,
          tx,
        );
        this.logger.log(
          `${opts.logPrefix} Converted ${combinedLayoutFileIds.length} File IDs to ${layoutEntityIds.length} Layout entity IDs`,
        );
      }
      updateData.layoutIds = layoutEntityIds;
    } else {
      delete updateData.layoutIds;

      // Aprovar/reprovar um layout pela tela de detalhe manda APENAS
      // `layoutStatuses` — de propósito, para não reescrever a relação (o
      // repositório usa `set`, que apagaria os anexos). Só que o guarda acima
      // condiciona a aplicação dos status à presença de `layoutIds`, então o
      // mapa era descartado, o update saía vazio e o servidor respondia 200 com
      // "atualizada com sucesso": toast de sucesso e nada mudava.
      //
      // Aqui os status são aplicados de forma INDEPENDENTE da reconciliação. O
      // retorno é descartado e `layoutIds` continua fora do updateData, então a
      // relação permanece intocada.
      const statusFileIds = Object.keys(opts.layoutStatuses ?? {});
      if (!opts.skipAll && statusFileIds.length > 0) {
        const updated = await this.convertFileIdsToLayoutIds(
          statusFileIds,
          id,
          opts.layoutStatuses,
          opts.userRole,
          tx,
        );
        this.logger.log(
          `${opts.logPrefix} Applied layout status changes for ${updated.length} layout(s) without touching the relation`,
        );
      }
    }

    // Tell the repository that the arrays surviving above are a deliberate, complete
    // snapshot — including an empty one, which is the caller asking to detach everything.
    // Without this marker the repository refuses to empty a relation (see its mapper).
    const clearing = (['receiptIds', 'invoiceIds', 'layoutIds'] as const).filter(
      k => Array.isArray(updateData[k]) && updateData[k].length === 0,
    );
    if (clearing.length === 0) return;

    updateData._allowRelationClear = true;

    // A clear that detaches nothing is noise; one that detaches real rows is the exact
    // event that went unnoticed for weeks (files stay on disk, the Layout row just loses
    // its airbrushingId, and nothing in the UI says so). Count what is actually about to
    // be lost and log it at ERROR so it is greppable/alertable after the fact.
    const current = await tx.airbrushing.findUnique({
      where: { id },
      select: {
        _count: { select: { receipts: true, invoices: true, layouts: true } },
      },
    });
    const counts: Record<string, number> = {
      receiptIds: current?._count.receipts ?? 0,
      invoiceIds: current?._count.invoices ?? 0,
      layoutIds: current?._count.layouts ?? 0,
    };
    const destructive = clearing.filter(k => counts[k] > 0);
    if (destructive.length > 0) {
      this.logger.error(
        `${opts.logPrefix} DETACHING FILES from airbrushing ${id}: ` +
          destructive.map(k => `${k}=${counts[k]}→0`).join(', ') +
          '. This is only correct if the user actually removed those files; if it fired on a ' +
          'save that never touched them, the caller sent a stale/unhydrated snapshot.',
      );
    }
  }

  /**
   * Helper: Check if user can approve/reprove layouts
   * Only COMMERCIAL and ADMIN users can change layout status
   */
  private canApproveLayouts(userRole?: string): boolean {
    const allowedRoles = [SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN];
    return userRole ? allowedRoles.includes(userRole as any) : false;
  }

  /**
   * Convert File IDs to Layout entity IDs
   * Creates Layout entities if they don't exist for the given File IDs
   * @param fileIds - Array of File IDs
   * @param airbrushingId - Airbrushing ID for creating new Layout records
   * @param layoutStatuses - Map of File ID to layout status
   * @param userRole - User role for permission checking
   * @param tx - Prisma transaction
   * @returns Array of Layout IDs
   */
  private async convertFileIdsToLayoutIds(
    fileIds: string[],
    airbrushingId: string,
    layoutStatuses?: Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>,
    userRole?: string,
    tx?: PrismaTransaction,
  ): Promise<string[]> {
    const prisma = tx || this.prisma;
    const layoutIds: string[] = [];

    // Debug: Log permission check info
    const hasApprovalPermission = this.canApproveLayouts(userRole);
    this.logger.log(
      `[convertFileIdsToLayoutIds] Permission check: userRole=${userRole}, canApproveLayouts=${hasApprovalPermission}`,
    );
    this.logger.log(
      `[convertFileIdsToLayoutIds] Processing ${fileIds.length} files with statuses: ${JSON.stringify(layoutStatuses)}`,
    );

    for (const rawFileId of fileIds) {
      let fileId = rawFileId;
      // fileId is GLOBALLY @unique on Layout, so look up by fileId alone. Looking up by
      // (fileId + airbrushingId) would miss an existing Layout that is currently detached
      // (airbrushingId=null, e.g. removed from this airbrushing earlier) or attached to a
      // different airbrushing — and the fallback create() would then violate the fileId
      // unique constraint (P2002 → 500).
      let layout: any = await prisma.layout.findUnique({
        where: { fileId },
        include: { tasks: { select: { id: true }, take: 1 } },
      });

      // OWNERSHIP: because fileId is unique and airbrushingId is a single FK, a File backs
      // exactly ONE airbrushing layout. Re-pointing an already-owned Layout at this
      // airbrushing silently STEALS it from its current owner, so clone the file and give
      // this airbrushing its own copy instead. Only a genuinely free Layout (no airbrushing,
      // no task links) is adopted — that is the re-attach-what-you-just-removed case.
      // Mirrors task.service.ts convertFileIdsToLayoutIds; keep the two in sync.
      if (layout) {
        const ownedByOtherAirbrushing =
          !!layout.airbrushingId && layout.airbrushingId !== airbrushingId;
        const ownedByTask = (layout.tasks?.length ?? 0) > 0;

        if (ownedByOtherAirbrushing || ownedByTask) {
          const current = await prisma.airbrushing.findUnique({
            where: { id: airbrushingId },
            select: { task: { select: { customer: { select: { fantasyName: true } } } } },
          });
          const clonedFileId = await this.fileService.cloneFile(
            prisma as PrismaTransaction,
            fileId,
            'airbrushingLayouts',
            undefined,
            current?.task?.customer?.fantasyName ?? undefined,
          );
          this.logger.warn(
            `[convertFileIdsToLayoutIds] File ${fileId} already backs Layout ${layout.id} ` +
              `(${ownedByOtherAirbrushing ? `owned by airbrushing ${layout.airbrushingId}` : 'linked to a task'}). ` +
              `Cloned to File ${clonedFileId} for airbrushing ${airbrushingId} instead of reassigning it.`,
          );
          fileId = clonedFileId;
          layout = null;
        }
      }

      // Determine the status to use. The map is keyed by the File ID the CLIENT sent,
      // so it must be read with `rawFileId` — a file cloned just above has a brand-new
      // id that appears nowhere in the payload, and looking it up would silently drop
      // the status the user picked.
      const requestedStatus = layoutStatuses?.[rawFileId] ?? layoutStatuses?.[fileId];
      const status = requestedStatus || 'DRAFT'; // Default to DRAFT for new uploads

      this.logger.log(
        `[convertFileIdsToLayoutIds] File ${fileId}: found=${!!layout}, currentStatus=${layout?.status}, requestedStatus=${requestedStatus}`,
      );

      if (!layout) {
        // Create new Layout with the provided or default status
        // If status is APPROVED/REPROVED, check permissions
        if (status !== 'DRAFT' && !hasApprovalPermission) {
          this.logger.warn(
            `[convertFileIdsToLayoutIds] User without approval permission tried to create layout with status ${status}. Using DRAFT instead.`,
          );
          layout = await prisma.layout.create({
            data: {
              fileId,
              status: 'DRAFT', // Force DRAFT if user doesn't have permission
              airbrushingId,
            },
          });
        } else {
          layout = await prisma.layout.create({
            data: {
              fileId,
              status,
              airbrushingId,
            },
          });
        }
        this.logger.log(
          `[convertFileIdsToLayoutIds] Created new Layout record ${layout.id} for File ${fileId} with status ${layout.status}`,
        );
      } else {
        // A Layout already exists for this file. Adopt it onto THIS airbrushing if it isn't
        // already (it may have been detached or belong to another airbrushing) and apply any
        // permitted status change. Never create a second row — fileId is unique.
        const needsAdopt = layout.airbrushingId !== airbrushingId;
        const wantsStatusChange = !!requestedStatus && layout.status !== requestedStatus;

        if (wantsStatusChange && !hasApprovalPermission) {
          // Recusa EXPLÍCITA em vez de ignorar em silêncio. Antes o servidor
          // engolia a tentativa e respondia 200, e o interceptor do axios
          // transformava isso em "Sucesso" — o usuário via um toast verde e o
          // status não mudava. Mentir sobre o resultado é pior do que negar.
          throw new BadRequestException(
            'Apenas os setores Comercial e Administrador podem aprovar ou reprovar layouts.',
          );
        }

        const applyStatusChange = wantsStatusChange && hasApprovalPermission;
        if (needsAdopt || applyStatusChange) {
          const oldStatus = layout.status;
          layout = await prisma.layout.update({
            where: { id: layout.id },
            data: {
              ...(needsAdopt ? { airbrushingId } : {}),
              ...(applyStatusChange ? { status: requestedStatus } : {}),
            },
          });
          this.logger.log(
            `[convertFileIdsToLayoutIds] ✅ Reconciled Layout ${layout.id} (adopt=${needsAdopt}, status ${oldStatus}→${layout.status})`,
          );
        } else {
          this.logger.log(
            `[convertFileIdsToLayoutIds] No change for File ${fileId}: already on airbrushing ${airbrushingId} with status ${layout.status}`,
          );
        }
      }

      layoutIds.push(layout.id);
    }

    return layoutIds;
  }
}
