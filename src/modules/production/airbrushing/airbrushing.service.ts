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
    const effectiveStatus = data.status ?? persistedStatus ?? AIRBRUSHING_STATUS.PENDING;
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

        // File-relation reconciliation must be INTENT-BASED. The repository maps every
        // provided *Ids array to a Prisma `set` (a full replace). A partial update — e.g. an
        // inline status/painter/price/paymentStatus edit from the detail page — provides none
        // of these arrays, so the relations must be left untouched. Reconciling
        // unconditionally would push `set: []` and wipe every attached receipt/invoice/layout.
        // Only reconcile a collection when the payload explicitly provided its IDs OR new files
        // of that type were uploaded in this request.
        const reconcileReceipts =
          !isPainterRestricted && (data.receiptIds !== undefined || newFileIds.receiptIds.length > 0);
        const reconcileInvoices =
          !isPainterRestricted && (data.invoiceIds !== undefined || newFileIds.invoiceIds.length > 0);
        const reconcileLayouts =
          !isPainterRestricted && (data.layoutIds !== undefined || newFileIds.layoutIds.length > 0);

        if (reconcileReceipts) {
          updateData.receiptIds = [...(data.receiptIds || []), ...newFileIds.receiptIds];
        } else {
          delete updateData.receiptIds;
        }

        if (reconcileInvoices) {
          updateData.invoiceIds = [...(data.invoiceIds || []), ...newFileIds.invoiceIds];
        } else {
          delete updateData.invoiceIds;
        }

        if (reconcileLayouts) {
          // layoutIds from the client are File IDs; the layouts relation expects Layout entity
          // IDs. Convert (creating/looking up Layout rows) before handing them to the repository.
          const combinedLayoutFileIds = [...(data.layoutIds || []), ...newFileIds.layoutIds];
          let layoutEntityIds: string[] = [];
          if (combinedLayoutFileIds.length > 0) {
            layoutEntityIds = await this.convertFileIdsToLayoutIds(
              combinedLayoutFileIds,
              id,
              layoutStatuses,
              userRole,
              tx,
            );
            this.logger.log(
              `[Airbrushing Update] Converted ${combinedLayoutFileIds.length} File IDs to ${layoutEntityIds.length} Layout entity IDs`,
            );
          }
          // Use converted Layout entity IDs, not File IDs.
          updateData.layoutIds = layoutEntityIds;
        } else {
          delete updateData.layoutIds;
        }

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
  async delete(id: string, userId?: string): Promise<AirbrushingDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const airbrushing = await this.airbrushingRepository.findByIdWithTransaction(tx, id);

        if (!airbrushing) {
          throw new NotFoundException('Aerografia não encontrada.');
        }

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

            // Atualizar a aerografia
            const updatedAirbrushing = await this.airbrushingRepository.updateWithTransaction(
              tx,
              id,
              updateData,
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
      // The Layout entities will be created by the caller
      if (files.layouts && files.layouts.length > 0) {
        for (const file of files.layouts) {
          const fileRecord = await this.fileService.createFromUploadWithTransaction(
            transaction,
            file,
            'tasksLayouts',
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

    for (const fileId of fileIds) {
      // fileId is GLOBALLY @unique on Layout, so look up by fileId alone. Looking up by
      // (fileId + airbrushingId) would miss an existing Layout that is currently detached
      // (airbrushingId=null, e.g. removed from this airbrushing earlier) or attached to a
      // different airbrushing — and the fallback create() would then violate the fileId
      // unique constraint (P2002 → 500). Task links live in the separate TaskLayouts join
      // table and are independent of airbrushingId, so adopting is safe.
      let layout = await prisma.layout.findUnique({ where: { fileId } });

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
