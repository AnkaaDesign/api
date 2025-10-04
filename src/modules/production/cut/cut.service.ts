// apps/api/src/modules/production/cut/cut.service.ts

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { NotificationService } from '@modules/common/notification/notification.service';
import { CutRepository, PrismaTransaction } from './repositories/cut/cut.repository';
import {
  Cut,
  CutGetUniqueResponse,
  CutGetManyResponse,
  CutCreateResponse,
  CutUpdateResponse,
  CutDeleteResponse,
  CutBatchCreateResponse,
  CutBatchUpdateResponse,
  CutBatchDeleteResponse,
  CutBatchCreateData,
  CutBatchUpdateData,
} from '../../../types';
import {
  CutCreateFormData,
  CutUpdateFormData,
  CutQueryFormData,
  CutGetManyFormData,
  CutBatchCreateFormData,
  CutBatchUpdateFormData,
  CutBatchDeleteFormData,
} from '../../../schemas/cut';
import {
  CHANGE_ACTION,
  CUT_TYPE,
  CUT_STATUS,
  CUT_ORIGIN,
  CUT_REQUEST_REASON,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
} from '../../../constants/enums';
import { CUT_STATUS_ORDER } from '../../../constants/sortOrders';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
  extractEssentialFields,
  getEssentialFields,
} from '@modules/common/changelog/utils/changelog-helpers';

@Injectable()
export class CutService {
  private readonly logger = new Logger(CutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cutRepository: CutRepository,
    private readonly changeLogService: ChangeLogService,
    private readonly notificationService: NotificationService,
  ) {}

  // =====================
  // VALIDATION HELPERS
  // =====================

  private async cutValidation(
    data: Partial<CutCreateFormData | CutUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validate cut type
    if (data.type) {
      if (!Object.values(CUT_TYPE).includes(data.type)) {
        throw new BadRequestException('Tipo de corte inválido.');
      }
    }

    // Validate cut origin
    if (data.origin) {
      if (!Object.values(CUT_ORIGIN).includes(data.origin)) {
        throw new BadRequestException('Origem do corte inválida.');
      }
    }

    // Validate cut request reason (if provided)
    if (data.reason !== undefined && data.reason !== null) {
      if (!Object.values(CUT_REQUEST_REASON).includes(data.reason)) {
        throw new BadRequestException('Motivo da solicitação inválido.');
      }
    }

    // Validate file exists and has proper properties
    if (data.fileId) {
      const file = await transaction.file.findUnique({
        where: { id: data.fileId },
      });

      if (!file) {
        throw new BadRequestException('Arquivo não encontrado.');
      }

      // Check file extension for cut files
      const allowedExtensions = ['.svg', '.dxf', '.ai', '.pdf', '.cdr', '.eps'];
      const hasValidExtension = allowedExtensions.some(ext =>
        file.filename.toLowerCase().endsWith(ext),
      );

      if (!hasValidExtension) {
        throw new BadRequestException(
          `Arquivo deve ser um dos tipos: ${allowedExtensions.join(', ')}`,
        );
      }
    }

    // Validate task exists (if taskId is provided)
    if (data.taskId) {
      const task = await transaction.task.findUnique({
        where: { id: data.taskId },
      });

      if (!task) {
        throw new BadRequestException('Tarefa não encontrada.');
      }
    }

    // Validate parent cut exists (if parentCutId is provided)
    if (data.parentCutId) {
      const parentCut = await transaction.cut.findUnique({
        where: { id: data.parentCutId },
      });

      if (!parentCut) {
        throw new BadRequestException('Corte pai não encontrado.');
      }

      // Prevent circular references
      if (existingId && data.parentCutId === existingId) {
        throw new BadRequestException('Um corte não pode ser pai de si mesmo.');
      }
    }

    // Validate cut status
    if (data.status) {
      if (!Object.values(CUT_STATUS).includes(data.status)) {
        throw new BadRequestException('Status do corte inválido.');
      }
    }

    // Validate cut dimensions based on type
    if (data.type === CUT_TYPE.VINYL) {
      // Vinyl specific validations could go here
      // For example, max dimensions, material checks, etc.
    } else if (data.type === CUT_TYPE.STENCIL) {
      // Stencil specific validations could go here
    }
  }

  // =====================
  // CUT QUERY OPERATIONS
  // =====================

  async getUnique(
    id: string,
    include?: CutQueryFormData['include'],
  ): Promise<CutGetUniqueResponse> {
    try {
      const cut = await this.cutRepository.findById(id, include ? { include } : undefined);

      if (!cut) {
        throw new NotFoundException('Corte não encontrado.');
      }

      return {
        success: true,
        message: 'Corte encontrado com sucesso',
        data: cut,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar corte:', error);
      throw new InternalServerErrorException('Erro ao buscar corte. Por favor, tente novamente.');
    }
  }

  async getMany(query: CutGetManyFormData = {}): Promise<CutGetManyResponse> {
    try {
      const result = await this.cutRepository.findMany(query);

      return {
        success: true,
        message: 'Cortes encontrados com sucesso',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar cortes:', error);
      throw new InternalServerErrorException('Erro ao buscar cortes. Por favor, tente novamente.');
    }
  }

  // =====================
  // CUT CRUD OPERATIONS
  // =====================

  async create(
    data: CutCreateFormData,
    include?: CutQueryFormData['include'],
    userId?: string,
  ): Promise<CutCreateResponse> {
    try {
      // Validate cut data
      await this.cutValidation(data);

      // Use transaction to create cut
      const result = await this.prisma.$transaction(async tx => {
        // Create the cut
        const cut = await this.cutRepository.createWithTransaction(
          tx,
          data,
          include ? { include } : undefined,
        );

        // Note: Removed logic to create cut items since CutItem model doesn't exist

        // Create changelog entry for cut
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUT,
          entityId: cut.id,
          action: CHANGE_ACTION.CREATE,
          entity: extractEssentialFields(cut, getEssentialFields(ENTITY_TYPE.CUT) as (keyof Cut)[]),
          reason: 'Novo corte criado',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Return cut
        return cut;
      });

      return {
        success: true,
        message: 'Corte criado com sucesso',
        data: result,
      };
    } catch (error) {
      this.logger.error('Erro ao criar corte:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar corte. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: CutUpdateFormData,
    include?: CutQueryFormData['include'],
    userId?: string,
  ): Promise<CutUpdateResponse> {
    try {
      const result = await this.prisma.$transaction(async tx => {
        const existing = await this.cutRepository.findByIdWithTransaction(tx, id);
        if (!existing) {
          throw new NotFoundException('Corte não encontrado.');
        }

        // Validate cut data
        await this.cutValidation(data, id, tx);

        const cut = await this.cutRepository.updateWithTransaction(
          tx,
          id,
          data,
          include ? { include } : undefined,
        );

        // Track field changes
        const fieldsToTrack = [
          'type',
          'fileId',
          'taskId',
          'origin',
          'reason',
          'parentCutId',
          'status',
          'startedAt',
          'completedAt',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUT,
          entityId: cut.id,
          oldEntity: existing,
          newEntity: cut,
          fieldsToTrack,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return cut;
      });

      return {
        success: true,
        message: 'Corte atualizado com sucesso',
        data: result,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar corte:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar corte. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<CutDeleteResponse> {
    try {
      await this.prisma.$transaction(async tx => {
        const existing = await this.cutRepository.findByIdWithTransaction(tx, id);
        if (!existing) {
          throw new NotFoundException('Corte não encontrado.');
        }

        // Create changelog entry before deletion
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.CUT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: extractEssentialFields(
            existing,
            getEssentialFields(ENTITY_TYPE.CUT) as (keyof Cut)[],
          ),
          reason: 'Corte excluído',
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        await this.cutRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Corte removido com sucesso',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao remover corte:', error);
      throw new InternalServerErrorException('Erro ao remover corte. Por favor, tente novamente.');
    }
  }

  // =====================
  // CUT BATCH OPERATIONS
  // =====================

  async batchCreate(
    data: CutBatchCreateFormData,
    userId?: string,
  ): Promise<CutBatchCreateResponse<CutBatchCreateData>> {
    try {
      const result = await this.prisma.$transaction(async tx => {
        const successfulCreations: any[] = [];
        const failedCreations: any[] = [];

        // Process each cut individually for validation and changelog tracking
        for (let index = 0; index < data.cuts.length; index++) {
          const cutData = data.cuts[index];
          try {
            // Validate cut data
            await this.cutValidation(cutData, undefined, tx);

            // Create the cut
            const newCut = await this.cutRepository.createWithTransaction(tx, cutData);
            successfulCreations.push(newCut);

            // Create changelog entry
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.CUT,
              entityId: newCut.id,
              action: CHANGE_ACTION.CREATE,
              entity: extractEssentialFields(
                newCut,
                getEssentialFields(ENTITY_TYPE.CUT) as (keyof Cut)[],
              ),
              reason: 'Corte criado em lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              transaction: tx,
            });
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar corte.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: cutData,
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
          ? '1 corte criado com sucesso'
          : `${result.totalCreated} cortes criados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success: result.success,
          failed: result.failed,
          totalProcessed: data.cuts.length,
          totalSuccess: result.totalCreated,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao criar cortes em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar cortes em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: CutBatchUpdateFormData,
    userId?: string,
  ): Promise<CutBatchUpdateResponse<CutBatchUpdateData>> {
    try {
      const result = await this.prisma.$transaction(async tx => {
        const successfulUpdates: any[] = [];
        const failedUpdates: any[] = [];

        // Process each update individually for validation and field tracking
        for (let index = 0; index < data.cuts.length; index++) {
          const { id, ...updateData } = data.cuts[index];
          try {
            // Fetch existing cut
            const existingCut = await this.cutRepository.findByIdWithTransaction(tx, id);
            if (!existingCut) {
              throw new NotFoundException('Corte não encontrado.');
            }

            // Validate cut data
            await this.cutValidation(updateData, id, tx);

            // Update the cut
            const updatedCut = await this.cutRepository.updateWithTransaction(tx, id, updateData);
            successfulUpdates.push(updatedCut);

            // Track field changes
            const fieldsToTrack = [
              'type',
              'fileId',
              'taskId',
              'origin',
              'reason',
              'parentCutId',
              'status',
              'startedAt',
              'completedAt',
            ];
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.CUT,
              entityId: id,
              oldEntity: existingCut,
              newEntity: updatedCut,
              fieldsToTrack,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar corte.',
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
          ? '1 corte atualizado com sucesso'
          : `${result.totalUpdated} cortes atualizados com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success: result.success,
          failed: result.failed,
          totalProcessed: data.cuts.length,
          totalSuccess: result.totalUpdated,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar cortes em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar cortes em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: CutBatchDeleteFormData,
    userId?: string,
  ): Promise<CutBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async tx => {
        // Fetch all cuts before deletion for changelog
        const cuts = await this.cutRepository.findByIdsWithTransaction(tx, data.cutIds);

        // Create a map for easy lookup
        const cutsMap = new Map(cuts.map(cut => [cut.id, cut]));

        const successfulDeletes: any[] = [];
        const failedDeletes: any[] = [];

        for (let index = 0; index < data.cutIds.length; index++) {
          const id = data.cutIds[index];
          try {
            const cut = cutsMap.get(id);
            if (!cut) {
              throw new NotFoundException('Corte não encontrado.');
            }

            // Create changelog entry before deletion
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.CUT,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: extractEssentialFields(
                cut,
                getEssentialFields(ENTITY_TYPE.CUT) as (keyof Cut)[],
              ),
              reason: 'Corte removido em lote',
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              transaction: tx,
            });

            await this.cutRepository.deleteWithTransaction(tx, id);
            successfulDeletes.push({ id });
          } catch (error: any) {
            failedDeletes.push({
              index,
              id,
              error: error.message || 'Erro ao remover corte.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: { id },
            });
          }
        }

        return {
          success: successfulDeletes,
          failed: failedDeletes,
          totalDeleted: successfulDeletes.length,
          totalFailed: failedDeletes.length,
        };
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 corte removido com sucesso'
          : `${result.totalDeleted} cortes removidos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success: result.success,
          failed: result.failed,
          totalProcessed: data.cutIds.length,
          totalSuccess: result.totalDeleted,
          totalFailed: result.totalFailed,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao remover cortes em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao remover cortes em lote. Por favor, tente novamente.',
      );
    }
  }
}
