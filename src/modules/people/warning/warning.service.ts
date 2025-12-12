// warning.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { WarningRepository, PrismaTransaction } from './repositories/warning.repository';
import { FileService } from '@modules/common/file/file.service';
import { unlinkSync, existsSync } from 'fs';
import {
  WarningBatchCreateResponse,
  WarningBatchDeleteResponse,
  WarningBatchUpdateResponse,
  WarningCreateResponse,
  WarningDeleteResponse,
  WarningGetManyResponse,
  WarningGetUniqueResponse,
  WarningUpdateResponse,
} from '../../../types';
import { Meta, UpdateData } from '../../../types';
import {
  WarningCreateFormData,
  WarningUpdateFormData,
  WarningGetManyFormData,
  WarningBatchCreateFormData,
  WarningBatchUpdateFormData,
  WarningBatchDeleteFormData,
  WarningInclude,
} from '../../../schemas';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  WARNING_SEVERITY,
  WARNING_CATEGORY,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants';

@Injectable()
export class WarningService {
  private readonly logger = new Logger(WarningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warningRepository: WarningRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Get user's managed sector for team-based filtering
   */
  async getUserManagedSector(userId: string): Promise<{ managedSectorId: string | null } | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          managedSector: {
            select: { id: true }
          }
        },
      });
      return user ? { managedSectorId: user.managedSector?.id || null } : null;
    } catch (error: any) {
      this.logger.error('Error fetching user managed sector:', error);
      return null;
    }
  }

  /**
   * Buscar muitas advertências com filtros
   */
  async findMany(query: WarningGetManyFormData): Promise<WarningGetManyResponse> {
    try {
      const result = await this.warningRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Advertências carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar advertências:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar advertências. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar uma advertência por ID
   */
  async findById(id: string, include?: WarningInclude): Promise<WarningGetUniqueResponse> {
    try {
      const warning = await this.warningRepository.findById(id, { include });

      if (!warning) {
        throw new NotFoundException('Advertência não encontrada.');
      }

      return { success: true, data: warning, message: 'Advertência carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar advertência por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar advertência. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Validar entidade completa
   */
  private async warningValidation(
    data: Partial<WarningCreateFormData | WarningUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar colaborador
    if (data.collaboratorId) {
      const collaborator = await transaction.user.findUnique({
        where: { id: data.collaboratorId },
      });
      if (!collaborator) {
        throw new NotFoundException('Colaborador não encontrado.');
      }
    }

    // Validar supervisor se fornecido
    if (data.supervisorId) {
      const supervisor = await transaction.user.findUnique({ where: { id: data.supervisorId } });
      if (!supervisor) {
        throw new NotFoundException('Supervisor não encontrado.');
      }
    }

    // Validar severidade
    if (
      data.severity &&
      !Object.values(WARNING_SEVERITY).includes(data.severity as WARNING_SEVERITY)
    ) {
      throw new BadRequestException('Severidade inválida.');
    }

    // Validar categoria
    if (
      data.category &&
      !Object.values(WARNING_CATEGORY).includes(data.category as WARNING_CATEGORY)
    ) {
      throw new BadRequestException('Categoria inválida.');
    }

    // Validar campos obrigatórios para criação
    if (!existingId && !data.collaboratorId) {
      throw new BadRequestException('O colaborador é obrigatório.');
    }
  }

  /**
   * Process attachment files for warning
   */
  private async processAttachmentFiles(
    attachments: Express.Multer.File[],
    warningId: string,
    employeeName: string,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    try {
      for (const file of attachments) {
        await this.fileService.createFromUploadWithTransaction(tx, file, 'warning', userId, {
          entityId: warningId,
          entityType: 'WARNING',
          userName: employeeName,
        });
      }
      this.logger.log(
        `${attachments.length} attachment file(s) processed for warning ${warningId}`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to process attachment files: ${error.message}`);
      throw error;
    }
  }

  /**
   * Criar uma nova advertência
   */
  async create(
    data: WarningCreateFormData,
    include?: WarningInclude,
    userId?: string,
    attachments?: Express.Multer.File[],
  ): Promise<WarningCreateResponse> {
    try {
      const warning = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.warningValidation(data, undefined, tx);

        // Criar a advertência
        const newWarning = await this.warningRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.WARNING,
          entityId: newWarning.id,
          action: CHANGE_ACTION.CREATE,
          entity: newWarning,
          reason: `Advertência criada: ${data.severity} - ${data.reason}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        // Process attachment files if provided
        if (attachments && attachments.length > 0) {
          // Get collaborator info for file context
          const collaborator = await tx.user.findUnique({
            where: { id: data.collaboratorId },
            select: { name: true },
          });

          const employeeName = collaborator?.name || 'Unknown';

          try {
            await this.processAttachmentFiles(attachments, newWarning.id, employeeName, tx, userId);
          } catch (fileError: any) {
            this.logger.error(`Attachment file processing failed: ${fileError.message}`);
            // Clean up temp files
            attachments.forEach(file => {
              if (existsSync(file.path)) {
                unlinkSync(file.path);
              }
            });
            throw new BadRequestException('Erro ao processar arquivos anexos.');
          }
        }

        return newWarning;
      });

      return {
        success: true,
        message: 'Advertência criada com sucesso.',
        data: warning,
      };
    } catch (error: any) {
      // Clean up uploaded files on error
      if (attachments && attachments.length > 0) {
        attachments.forEach(file => {
          if (existsSync(file.path)) {
            try {
              unlinkSync(file.path);
            } catch (cleanupError) {
              this.logger.warn(`Failed to cleanup uploaded file: ${file.path}`);
            }
          }
        });
      }

      this.logger.error('Erro ao criar advertência:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar advertência. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar uma advertência
   */
  async update(
    id: string,
    data: WarningUpdateFormData,
    include?: WarningInclude,
    userId?: string,
    attachments?: Express.Multer.File[],
  ): Promise<WarningUpdateResponse> {
    try {
      const updatedWarning = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar advertência existente
        const existingWarning = await this.warningRepository.findByIdWithTransaction(tx, id, {
          include: { witness: true },
        });

        if (!existingWarning) {
          throw new NotFoundException('Advertência não encontrada.');
        }

        // Validar entidade completa
        await this.warningValidation(data, id, tx);

        // Atualizar a advertência
        const updatedWarning = await this.warningRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Rastrear mudanças em campos individuais
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.WARNING,
          entityId: id,
          oldEntity: existingWarning,
          newEntity: updatedWarning,
          fieldsToTrack: [
            'severity',
            'reason',
            'description',
            'date',
            'collaboratorId',
            'supervisorId',
          ],
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Rastrear mudanças nas testemunhas se houver
        const oldWitnessIds = existingWarning.witness?.map((w: any) => w.id).sort() || [];
        const newWitnessIds = updatedWarning.witness?.map((w: any) => w.id).sort() || [];

        if (JSON.stringify(oldWitnessIds) !== JSON.stringify(newWitnessIds)) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.WARNING,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'witness',
            oldValue: oldWitnessIds,
            newValue: newWitnessIds,
            reason: 'Testemunhas atualizadas',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        // Process attachment files if provided (add new attachments)
        if (attachments && attachments.length > 0) {
          // Get collaborator info for file context
          const collaboratorId = data.collaboratorId || existingWarning.collaboratorId;
          const collaborator = await tx.user.findUnique({
            where: { id: collaboratorId },
            select: { name: true },
          });

          const employeeName = collaborator?.name || 'Unknown';

          try {
            await this.processAttachmentFiles(attachments, id, employeeName, tx, userId);
          } catch (fileError: any) {
            this.logger.error(`Attachment file processing failed: ${fileError.message}`);
            // Clean up temp files
            attachments.forEach(file => {
              if (existsSync(file.path)) {
                unlinkSync(file.path);
              }
            });
            throw new BadRequestException('Erro ao processar arquivos anexos.');
          }
        }

        return updatedWarning;
      });

      return {
        success: true,
        message: 'Advertência atualizada com sucesso.',
        data: updatedWarning,
      };
    } catch (error: any) {
      // Clean up uploaded files on error
      if (attachments && attachments.length > 0) {
        attachments.forEach(file => {
          if (existsSync(file.path)) {
            try {
              unlinkSync(file.path);
            } catch (cleanupError) {
              this.logger.warn(`Failed to cleanup uploaded file: ${file.path}`);
            }
          }
        });
      }

      this.logger.error('Erro ao atualizar advertência:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar advertência. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir uma advertência
   */
  async delete(id: string, userId?: string): Promise<WarningDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const warning = await this.warningRepository.findByIdWithTransaction(tx, id);

        if (!warning) {
          throw new NotFoundException('Advertência não encontrada.');
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.WARNING,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: warning,
          reason: 'Advertência excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await this.warningRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Advertência excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir advertência:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir advertência. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplas advertências
   */
  async batchCreate(
    data: WarningBatchCreateFormData,
    include?: WarningInclude,
    userId?: string,
  ): Promise<WarningBatchCreateResponse<WarningCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const result = await this.warningRepository.createManyWithTransaction(tx, data.warnings, {
          include,
        });

        // Registrar criações bem-sucedidas
        for (const warning of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.WARNING,
            entityId: warning.id,
            action: CHANGE_ACTION.CREATE,
            entity: warning,
            reason: 'Advertência criada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 advertência criada com sucesso'
          : `${result.totalCreated} advertências criadas com sucesso`;
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
        'Erro ao criar advertências em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas advertências
   */
  async batchUpdate(
    data: WarningBatchUpdateFormData,
    include?: WarningInclude,
    userId?: string,
  ): Promise<WarningBatchUpdateResponse<WarningUpdateFormData>> {
    try {
      const updates: UpdateData<WarningUpdateFormData>[] = data.warnings.map(warning => ({
        id: warning.id,
        data: warning.data,
      }));

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar advertências existentes antes de atualizar para comparação
        const existingWarnings = await this.warningRepository.findByIdsWithTransaction(
          tx,
          updates.map(u => u.id),
          { include: { witness: true } },
        );
        const existingWarningsMap = new Map(existingWarnings.map(w => [w.id, w]));

        const result = await this.warningRepository.updateManyWithTransaction(tx, updates, {
          include,
        });

        // Registrar atualizações bem-sucedidas com rastreamento de campos
        for (const warning of result.success) {
          const existingWarning = existingWarningsMap.get(warning.id);
          if (existingWarning) {
            // Rastrear mudanças em campos individuais
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.WARNING,
              entityId: warning.id,
              oldEntity: existingWarning,
              newEntity: warning,
              fieldsToTrack: [
                'severity',
                'reason',
                'description',
                'date',
                'collaboratorId',
                'supervisorId',
              ],
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            // Rastrear mudanças nas testemunhas se houver
            const oldWitnessIds = existingWarning.witness?.map((w: any) => w.id).sort() || [];
            const newWitnessIds = warning.witness?.map((w: any) => w.id).sort() || [];

            if (JSON.stringify(oldWitnessIds) !== JSON.stringify(newWitnessIds)) {
              await this.changeLogService.logChange({
                entityType: ENTITY_TYPE.WARNING,
                entityId: warning.id,
                action: CHANGE_ACTION.UPDATE,
                field: 'witness',
                oldValue: oldWitnessIds,
                newValue: newWitnessIds,
                reason: 'Testemunhas atualizadas em lote',
                triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                triggeredById: warning.id,
                userId: userId || null,
                transaction: tx,
              });
            }
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 advertência atualizada com sucesso'
          : `${result.totalUpdated} advertências atualizadas com sucesso`;
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
        'Erro ao atualizar advertências em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir múltiplas advertências
   */
  async batchDelete(
    data: WarningBatchDeleteFormData,
    userId?: string,
  ): Promise<WarningBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar advertências antes de excluir para o changelog
        const warnings = await this.warningRepository.findByIdsWithTransaction(tx, data.warningIds);

        // Registrar exclusões
        for (const warning of warnings) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.WARNING,
            entityId: warning.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: warning,
            reason: 'Advertência excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.warningRepository.deleteManyWithTransaction(tx, data.warningIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 advertência excluída com sucesso'
          : `${result.totalDeleted} advertências excluídas com sucesso`;
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
    } catch (error: any) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir advertências em lote. Por favor, tente novamente.',
      );
    }
  }
}
