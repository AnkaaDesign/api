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
import {
  CHANGE_TRIGGERED_BY,
  CHANGE_ACTION,
  ENTITY_TYPE,
  SECTOR_PRIVILEGES,
  AIRBRUSHING_STATUS,
  AIRBRUSHING_PAYMENT_STATUS,
} from '../../../constants/enums';
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
  ) {}

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
    existing: { status: string; startedAt?: Date | null; finishedAt?: Date | null },
    updateData: Record<string, any>,
  ): void {
    const nextStatus = updateData.status;
    if (!nextStatus || nextStatus === existing.status) return;

    const stampStart = () => {
      if (!existing.startedAt && updateData.startedAt === undefined) {
        updateData.startedAt = new Date();
      }
    };

    if (nextStatus === AIRBRUSHING_STATUS.IN_PRODUCTION) {
      stampStart();
    }

    if (nextStatus === AIRBRUSHING_STATUS.COMPLETED) {
      if (!existing.finishedAt && updateData.finishedAt === undefined) {
        updateData.finishedAt = new Date();
      }
      // A job completed without ever passing through Em Produção still needs a start.
      stampStart();
    }
  }

  /**
   * Buscar muitas aerografias com filtros
   */
  async findMany(
    query: AirbrushingGetManyFormData,
    userRole?: string,
  ): Promise<AirbrushingGetManyResponse> {
    try {
      const result = await this.airbrushingRepository.findMany(query);

      // Filter layouts based on user role for each airbrushing
      // Only COMMERCIAL, DESIGNER, LOGISTIC, PRODUCTION_MANAGER, and ADMIN can see all layouts
      // Others can only see APPROVED layouts
      if (userRole) {
        const canSeeAllLayouts = [
          'COMMERCIAL',
          'DESIGNER',
          'LOGISTIC',
          'PRODUCTION_MANAGER',
          'ADMIN',
          // Painters own the airbrushing work — they must see all its layouts (which carry
          // no approval workflow and are always DRAFT), not just APPROVED ones.
          'AIRBRUSHING',
        ].includes(userRole);

        if (!canSeeAllLayouts) {
          result.data = result.data.map(airbrushing => {
            if (airbrushing.layouts) {
              return {
                ...airbrushing,
                layouts: airbrushing.layouts.filter(
                  layout => layout.status === 'APPROVED' || layout.status === null,
                ),
              };
            }
            return airbrushing;
          });
        }
      }

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
  ): Promise<AirbrushingGetUniqueResponse> {
    try {
      const airbrushing = await this.airbrushingRepository.findById(id, { include });

      if (!airbrushing) {
        throw new NotFoundException('Aerografia não encontrada.');
      }

      // Filter layouts based on user role
      // Only COMMERCIAL, DESIGNER, LOGISTIC, PRODUCTION_MANAGER, and ADMIN can see all layouts
      // Others can only see APPROVED layouts
      if (airbrushing.layouts && userRole) {
        const canSeeAllLayouts = [
          'COMMERCIAL',
          'DESIGNER',
          'LOGISTIC',
          'PRODUCTION_MANAGER',
          'ADMIN',
          // Painters own the airbrushing work — they must see all its layouts (which carry
          // no approval workflow and are always DRAFT), not just APPROVED ones.
          'AIRBRUSHING',
        ].includes(userRole);

        if (!canSeeAllLayouts) {
          airbrushing.layouts = airbrushing.layouts.filter(
            layout => layout.status === 'APPROVED' || layout.status === null,
          );
        }
      }

      return { success: true, data: airbrushing, message: 'Aerografia carregada com sucesso.' };
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
  private fileReferenceColumns: Array<{ table: string; column: string }> | null = null;

  private async getFileReferenceColumns(
    tx: PrismaTransaction,
  ): Promise<Array<{ table: string; column: string }>> {
    if (this.fileReferenceColumns) return this.fileReferenceColumns;

    const rows = await tx.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND ccu.table_name = 'File'
        AND ccu.column_name = 'id'
    `;

    this.fileReferenceColumns = rows.map(r => ({ table: r.table_name, column: r.column_name }));
    return this.fileReferenceColumns;
  }

  /**
   * True when anything OTHER than the airbrushing being deleted still points at this File.
   * Errs on the side of "referenced" — any failure means we keep the file.
   */
  private async fileHasOtherReferences(
    tx: PrismaTransaction,
    fileId: string,
    airbrushingId: string,
  ): Promise<boolean> {
    try {
      // The catalog query below finds FKs pointing AT File.id. File.quoteLayoutId points the
      // other way (File -> TaskQuote), so it is invisible there — check it explicitly, or a
      // file that is also a quote layout could be deleted out from under the quote.
      const self = await tx.file.findUnique({
        where: { id: fileId },
        select: { quoteLayoutId: true },
      });
      if (self?.quoteLayoutId) return true;

      const columns = await this.getFileReferenceColumns(tx);

      for (const { table, column } of columns) {
        // Identifiers come from the catalog, not from user input.
        let sql = `SELECT 1 FROM "${table}" WHERE "${column}" = $1`;
        const params: any[] = [fileId];

        // Ignore this airbrushing's OWN links — they are what we are tearing down.
        if (table === '_AIRBRUSHING_RECEIPTS' || table === '_AIRBRUSHING_INVOICES') {
          sql += ` AND "A" <> $2`;
          params.push(airbrushingId);
        } else if (table === 'Layout') {
          sql += ` AND ("airbrushingId" IS DISTINCT FROM $2)`;
          params.push(airbrushingId);
        }

        const hit = await tx.$queryRawUnsafe<Array<{ '?column?': number }>>(
          `${sql} LIMIT 1`,
          ...params,
        );
        if (hit.length > 0) return true;
      }
      return false;
    } catch (error: any) {
      this.logger.error(
        `[Airbrushing Delete] Reference check failed for file ${fileId}: ${error.message}. Keeping the file.`,
      );
      return true;
    }
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
        // Deleting the File row cascades its Layout row and its join-table entries.
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

            // Atualizar a aerografia
            const updatedAirbrushing = await this.airbrushingRepository.updateWithTransaction(
              tx,
              id,
              batchUpdateData,
              { include },
            );
            successfulUpdates.push(updatedAirbrushing);

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

      // Determine the status to use
      const requestedStatus = layoutStatuses?.[fileId];
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
          this.logger.warn(
            `[convertFileIdsToLayoutIds] User without approval permission (role=${userRole}) tried to change layout status from ${layout.status} to ${requestedStatus}. Ignoring status change.`,
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
