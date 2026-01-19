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
import { CHANGE_TRIGGERED_BY, CHANGE_ACTION, ENTITY_TYPE, SECTOR_PRIVILEGES } from '../../../constants/enums';
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

    // Aerografia não tem campos únicos para validar
  }

  /**
   * Buscar muitas aerografias com filtros
   */
  async findMany(query: AirbrushingGetManyFormData, userRole?: string): Promise<AirbrushingGetManyResponse> {
    try {
      const result = await this.airbrushingRepository.findMany(query);

      // Filter artworks based on user role for each airbrushing
      // Only COMMERCIAL, DESIGNER, LOGISTIC, and ADMIN can see all artworks
      // Others can only see APPROVED artworks
      if (userRole) {
        const canSeeAllArtworks = [
          'COMMERCIAL',
          'DESIGNER',
          'LOGISTIC',
          'ADMIN',
        ].includes(userRole);

        if (!canSeeAllArtworks) {
          result.data = result.data.map(airbrushing => {
            if (airbrushing.artworks) {
              return {
                ...airbrushing,
                artworks: airbrushing.artworks.filter(
                  artwork => artwork.status === 'APPROVED' || artwork.status === null,
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
  async findById(id: string, include?: AirbrushingInclude, userRole?: string): Promise<AirbrushingGetUniqueResponse> {
    try {
      const airbrushing = await this.airbrushingRepository.findById(id, { include });

      if (!airbrushing) {
        throw new NotFoundException('Aerografia não encontrada.');
      }

      // Filter artworks based on user role
      // Only COMMERCIAL, DESIGNER, LOGISTIC, and ADMIN can see all artworks
      // Others can only see APPROVED artworks
      if (airbrushing.artworks && userRole) {
        const canSeeAllArtworks = [
          'COMMERCIAL',
          'DESIGNER',
          'LOGISTIC',
          'ADMIN',
        ].includes(userRole);

        if (!canSeeAllArtworks) {
          airbrushing.artworks = airbrushing.artworks.filter(
            artwork => artwork.status === 'APPROVED' || artwork.status === null,
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
      artworks?: Express.Multer.File[];
    },
  ): Promise<AirbrushingCreateResponse> {
    try {
      const airbrushing = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.validateAirbrushing(data, undefined, tx);

        // Criar a aerografia
        const newAirbrushing = await this.airbrushingRepository.createWithTransaction(tx, data, {
          include,
        });

        // Process file uploads if provided
        if (files && (files.receipts?.length || files.invoices?.length || files.artworks?.length)) {
          await this.processAirbrushingFileUploads(newAirbrushing.id, files, userId, tx);
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
      artworks?: Express.Multer.File[];
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

        // Extract artworkStatuses from data before removing it
        const artworkStatuses = (data as any).artworkStatuses as Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'> | undefined;
        this.logger.log(`[Airbrushing Update] artworkStatuses received: ${JSON.stringify(artworkStatuses)}`);

        // Process file uploads if provided and get new file IDs
        let newFileIds = {
          receiptIds: [] as string[],
          invoiceIds: [] as string[],
          artworkIds: [] as string[],
        };
        if (files && (files.receipts?.length || files.invoices?.length || files.artworks?.length)) {
          newFileIds = await this.processAirbrushingFileUploads(id, files, userId, tx);
        }

        // Combine existing fileIds from data with newly uploaded file IDs
        const combinedReceiptIds = [...(data.receiptIds || []), ...newFileIds.receiptIds];
        const combinedInvoiceIds = [...(data.invoiceIds || []), ...newFileIds.invoiceIds];
        const combinedArtworkFileIds = [...(data.artworkIds || []), ...newFileIds.artworkIds];

        // CRITICAL: Convert File IDs to Artwork entity IDs
        // artworkIds from frontend are File IDs, but the artworks relation expects Artwork entity IDs
        let artworkEntityIds: string[] = [];
        if (combinedArtworkFileIds.length > 0) {
          artworkEntityIds = await this.convertFileIdsToArtworkIds(
            combinedArtworkFileIds,
            id,
            artworkStatuses,
            userRole,
            tx,
          );
          this.logger.log(`[Airbrushing Update] Converted ${combinedArtworkFileIds.length} File IDs to ${artworkEntityIds.length} Artwork entity IDs`);
        }

        // Build update data with converted artwork IDs (removing artworkStatuses as it's not a Prisma field)
        const updateData = {
          ...data,
          receiptIds: combinedReceiptIds,
          invoiceIds: combinedInvoiceIds,
          // Use converted Artwork entity IDs, not File IDs
          artworkIds: artworkEntityIds,
        };
        // Remove artworkStatuses from updateData as it's not a Prisma field
        delete (updateData as any).artworkStatuses;

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

            // Criar a aerografia
            const newAirbrushing = await this.airbrushingRepository.createWithTransaction(
              tx,
              airbrushingData,
              { include },
            );
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
      artworks?: Express.Multer.File[];
    },
    userId?: string,
    tx?: PrismaTransaction,
  ): Promise<{ receiptIds: string[]; invoiceIds: string[]; artworkIds: string[] }> {
    const transaction = tx || this.prisma;
    const receiptIds: string[] = [];
    const invoiceIds: string[] = [];
    const artworkIds: string[] = [];

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

      // Process artwork files - NOTE: With Artwork entity, we just create Files here
      // The Artwork entities will be created by the caller
      if (files.artworks && files.artworks.length > 0) {
        for (const file of files.artworks) {
          const fileRecord = await this.fileService.createFromUploadWithTransaction(
            transaction,
            file,
            'tasksArtworks',
            userId,
            {
              entityId: airbrushingId,
              entityType: 'AIRBRUSHING',
              customerName,
            },
          );
          artworkIds.push(fileRecord.id);
        }
      }
    } catch (error) {
      this.logger.error('Erro ao processar upload de arquivos da aerografia:', error);
      throw error;
    }

    return { receiptIds, invoiceIds, artworkIds };
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
      // NOTE: artworks are now handled via the Artwork entity, not direct File relations
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
   * Helper: Check if user can approve/reprove artworks
   * Only COMMERCIAL and ADMIN users can change artwork status
   */
  private canApproveArtworks(userRole?: string): boolean {
    const allowedRoles = [SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.ADMIN];
    return userRole ? allowedRoles.includes(userRole as any) : false;
  }

  /**
   * Convert File IDs to Artwork entity IDs
   * Creates Artwork entities if they don't exist for the given File IDs
   * @param fileIds - Array of File IDs
   * @param airbrushingId - Airbrushing ID for creating new Artwork records
   * @param artworkStatuses - Map of File ID to artwork status
   * @param userRole - User role for permission checking
   * @param tx - Prisma transaction
   * @returns Array of Artwork IDs
   */
  private async convertFileIdsToArtworkIds(
    fileIds: string[],
    airbrushingId: string,
    artworkStatuses?: Record<string, 'DRAFT' | 'APPROVED' | 'REPROVED'>,
    userRole?: string,
    tx?: PrismaTransaction,
  ): Promise<string[]> {
    const prisma = tx || this.prisma;
    const artworkIds: string[] = [];

    // Debug: Log permission check info
    const hasApprovalPermission = this.canApproveArtworks(userRole);
    this.logger.log(
      `[convertFileIdsToArtworkIds] Permission check: userRole=${userRole}, canApproveArtworks=${hasApprovalPermission}`,
    );
    this.logger.log(
      `[convertFileIdsToArtworkIds] Processing ${fileIds.length} files with statuses: ${JSON.stringify(artworkStatuses)}`,
    );

    for (const fileId of fileIds) {
      // Check if an Artwork record already exists for this file and airbrushing
      let artwork = await prisma.artwork.findFirst({
        where: {
          fileId,
          airbrushingId,
        },
      });

      // Determine the status to use
      const requestedStatus = artworkStatuses?.[fileId];
      const status = requestedStatus || 'DRAFT'; // Default to DRAFT for new uploads

      this.logger.log(
        `[convertFileIdsToArtworkIds] File ${fileId}: found=${!!artwork}, currentStatus=${artwork?.status}, requestedStatus=${requestedStatus}`,
      );

      if (!artwork) {
        // Create new Artwork with the provided or default status
        // If status is APPROVED/REPROVED, check permissions
        if (status !== 'DRAFT' && !hasApprovalPermission) {
          this.logger.warn(
            `[convertFileIdsToArtworkIds] User without approval permission tried to create artwork with status ${status}. Using DRAFT instead.`,
          );
          artwork = await prisma.artwork.create({
            data: {
              fileId,
              status: 'DRAFT', // Force DRAFT if user doesn't have permission
              airbrushingId,
            },
          });
        } else {
          artwork = await prisma.artwork.create({
            data: {
              fileId,
              status,
              airbrushingId,
            },
          });
        }
        this.logger.log(
          `[convertFileIdsToArtworkIds] Created new Artwork record ${artwork.id} for File ${fileId} with status ${artwork.status}`,
        );
      } else if (requestedStatus && artwork.status !== requestedStatus) {
        // Update existing Artwork status if it changed
        const oldStatus = artwork.status;
        // Check permissions for status changes
        if (!hasApprovalPermission) {
          this.logger.warn(
            `[convertFileIdsToArtworkIds] User without approval permission (role=${userRole}) tried to change artwork status from ${oldStatus} to ${requestedStatus}. Ignoring.`,
          );
        } else {
          artwork = await prisma.artwork.update({
            where: { id: artwork.id },
            data: { status: requestedStatus },
          });
          this.logger.log(
            `[convertFileIdsToArtworkIds] ✅ Updated Artwork ${artwork.id} status from ${oldStatus} to ${requestedStatus}`,
          );
        }
      } else {
        // Log why we're not updating
        if (!requestedStatus) {
          this.logger.log(
            `[convertFileIdsToArtworkIds] No status change for File ${fileId}: requestedStatus is undefined`,
          );
        } else {
          this.logger.log(
            `[convertFileIdsToArtworkIds] No status change for File ${fileId}: current status (${artwork.status}) already matches requested (${requestedStatus})`,
          );
        }
      }

      artworkIds.push(artwork.id);
    }

    return artworkIds;
  }
}
