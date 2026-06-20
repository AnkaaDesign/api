// warehouse-location.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  WarehouseLocationRepository,
  PrismaTransaction,
} from './repositories/warehouse-location.repository';
import type {
  WarehouseLocationBatchCreateResponse,
  WarehouseLocationBatchDeleteResponse,
  WarehouseLocationBatchUpdateResponse,
  WarehouseLocationCreateResponse,
  WarehouseLocationDeleteResponse,
  WarehouseLocationGetManyResponse,
  WarehouseLocationGetUniqueResponse,
  WarehouseLocationUpdateResponse,
} from '../../../types';
import type {
  WarehouseLocationCreateFormData,
  WarehouseLocationUpdateFormData,
  WarehouseLocationGetManyFormData,
  WarehouseLocationBatchCreateFormData,
  WarehouseLocationBatchUpdateFormData,
  WarehouseLocationBatchDeleteFormData,
  WarehouseLocationInclude,
} from '../../../schemas/warehouse-location';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';

// NOTE: changelog writes require WAREHOUSE_LOCATION in the Prisma ChangeLogEntityType
// enum (migration 20260619040000) — without it every create/update/delete 500s.
@Injectable()
export class WarehouseLocationService {
  private readonly logger = new Logger(WarehouseLocationService.name);

  private readonly FIELDS_TO_TRACK = ['name', 'section', 'code', 'description', 'isActive'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouseLocationRepository: WarehouseLocationRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar localização (código único)
   */
  private async validate(
    data: Partial<WarehouseLocationCreateFormData | WarehouseLocationUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    // Código deve ser único quando fornecido
    if (data.code) {
      const existingByCode = await this.warehouseLocationRepository.findByCode(data.code, tx);
      if (existingByCode && existingByCode.id !== existingId) {
        throw new BadRequestException('Código já está em uso por outra localização.');
      }
    }
  }

  async findMany(
    query: WarehouseLocationGetManyFormData,
  ): Promise<WarehouseLocationGetManyResponse> {
    try {
      const result = await this.warehouseLocationRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Localizações carregadas com sucesso',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar localizações:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar localizações. Por favor, tente novamente.',
      );
    }
  }

  async findById(
    id: string,
    include?: WarehouseLocationInclude,
  ): Promise<WarehouseLocationGetUniqueResponse> {
    try {
      const location = await this.warehouseLocationRepository.findById(id, { include });

      if (!location) {
        throw new NotFoundException('Localização não encontrada.');
      }

      return { success: true, data: location, message: 'Localização carregada com sucesso' };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar localização por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar localização. Por favor, tente novamente.',
      );
    }
  }

  async create(
    data: WarehouseLocationCreateFormData,
    include?: WarehouseLocationInclude,
    userId?: string,
  ): Promise<WarehouseLocationCreateResponse> {
    try {
      const location = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.validate(data, undefined, tx);

        const newLocation = await this.warehouseLocationRepository.createWithTransaction(tx, data, {
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.WAREHOUSE_LOCATION,
          entityId: newLocation.id,
          action: CHANGE_ACTION.CREATE,
          entity: newLocation,
          reason: `Nova localização cadastrada: ${data.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newLocation;
      });

      return {
        success: true,
        message: 'Localização criada com sucesso',
        data: location,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao criar localização:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao criar localização. Por favor, tente novamente.',
      );
    }
  }

  async update(
    id: string,
    data: WarehouseLocationUpdateFormData,
    include?: WarehouseLocationInclude,
    userId?: string,
  ): Promise<WarehouseLocationUpdateResponse> {
    try {
      const updatedLocation = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existingLocation = await this.warehouseLocationRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingLocation) {
          throw new NotFoundException(
            'Localização não encontrada. Verifique se o ID está correto.',
          );
        }

        await this.validate(data, id, tx);

        const updatedLocation = await this.warehouseLocationRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.WAREHOUSE_LOCATION,
          entityId: id,
          oldEntity: existingLocation,
          newEntity: updatedLocation,
          fieldsToTrack: this.FIELDS_TO_TRACK,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedLocation;
      });

      return {
        success: true,
        message: 'Localização atualizada com sucesso',
        data: updatedLocation,
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao atualizar localização:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar localização. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<WarehouseLocationDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const location = await this.warehouseLocationRepository.findByIdWithTransaction(tx, id);

        if (!location) {
          throw new NotFoundException(
            'Localização não encontrada. Verifique se o ID está correto.',
          );
        }

        // Items linked to this location are unlinked (FK set null) automatically
        // by Prisma since the relation is optional; no items are deleted.
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.WAREHOUSE_LOCATION,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: location,
          reason: `Localização excluída: ${location.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await this.warehouseLocationRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Localização excluída com sucesso',
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao excluir localização:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir localização. Por favor, tente novamente.',
      );
    }
  }

  async batchCreate(
    data: WarehouseLocationBatchCreateFormData,
    include?: WarehouseLocationInclude,
    userId?: string,
  ): Promise<WarehouseLocationBatchCreateResponse<WarehouseLocationCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const validationResults: Array<{
          index: number;
          location: WarehouseLocationCreateFormData;
          error?: string;
        }> = [];

        for (let i = 0; i < data.warehouseLocations.length; i++) {
          const location = data.warehouseLocations[i];
          try {
            await this.validate(location, undefined, tx);
            validationResults.push({ index: i, location });
          } catch (error: unknown) {
            validationResults.push({
              index: i,
              location,
              error: error instanceof Error ? error.message : 'Erro ao validar localização.',
            });
          }
        }

        const validLocations = validationResults.filter(r => !r.error).map(r => r.location);
        const invalidLocations = validationResults.filter(r => r.error);

        const result = await this.warehouseLocationRepository.createManyWithTransaction(
          tx,
          validLocations,
          { include },
        );

        const finalFailed = [
          ...invalidLocations.map(r => ({
            index: r.index,
            data: r.location,
            error: r.error!,
            errorCode: 'VALIDATION_ERROR' as const,
          })),
          ...result.failed,
        ];

        for (const location of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.WAREHOUSE_LOCATION,
            entityId: location.id,
            action: CHANGE_ACTION.CREATE,
            entity: location,
            reason: 'Localização criada em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return {
          success: result.success,
          failed: finalFailed,
          totalCreated: result.totalCreated,
          totalFailed: finalFailed.length,
        };
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 localização criada com sucesso'
          : `${result.totalCreated} localizações criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: 'id' in error ? (error as any).id : undefined,
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
    } catch (error: unknown) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar localizações em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: WarehouseLocationBatchUpdateFormData,
    include?: WarehouseLocationInclude,
    userId?: string,
  ): Promise<WarehouseLocationBatchUpdateResponse<WarehouseLocationUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const validationResults: Array<{
          index: number;
          id: string;
          data: WarehouseLocationUpdateFormData;
          error?: string;
        }> = [];

        for (let i = 0; i < data.warehouseLocations.length; i++) {
          const update = data.warehouseLocations[i];
          try {
            await this.validate(update.data, update.id, tx);
            validationResults.push({ index: i, id: update.id, data: update.data });
          } catch (error: unknown) {
            validationResults.push({
              index: i,
              id: update.id,
              data: update.data,
              error: error instanceof Error ? error.message : 'Erro ao validar localização.',
            });
          }
        }

        const validUpdates = validationResults
          .filter(r => !r.error)
          .map(r => ({ id: r.id, data: r.data }));
        const invalidUpdates = validationResults.filter(r => r.error);

        const result = await this.warehouseLocationRepository.updateManyWithTransaction(
          tx,
          validUpdates,
          { include },
        );

        const finalFailed = [
          ...invalidUpdates.map(r => ({
            index: r.index,
            id: r.id,
            data: { ...r.data, id: r.id },
            error: r.error!,
            errorCode: 'VALIDATION_ERROR' as const,
          })),
          ...result.failed,
        ];

        for (const updateData of validUpdates) {
          const oldLocation = await this.warehouseLocationRepository.findByIdWithTransaction(
            tx,
            updateData.id,
          );
          const updatedLocation = result.success.find(s => s.id === updateData.id);

          if (oldLocation && updatedLocation) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.WAREHOUSE_LOCATION,
              entityId: updateData.id,
              oldEntity: oldLocation,
              newEntity: updatedLocation,
              fieldsToTrack: this.FIELDS_TO_TRACK,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return {
          success: result.success,
          failed: finalFailed,
          totalUpdated: result.totalUpdated,
          totalFailed: finalFailed.length,
        };
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 localização atualizada com sucesso'
          : `${result.totalUpdated} localizações atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
          index: error.index || index,
          id: error.id,
          error: error.error,
          errorCode: error.errorCode,
          data: { ...error.data, id: error.id || '' },
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
    } catch (error: unknown) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar localizações em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: WarehouseLocationBatchDeleteFormData,
    userId?: string,
  ): Promise<WarehouseLocationBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const locations = await this.warehouseLocationRepository.findByIdsWithTransaction(
          tx,
          data.warehouseLocationIds,
        );

        for (const location of locations) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.WAREHOUSE_LOCATION,
            entityId: location.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: location,
            reason: 'Localização excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.warehouseLocationRepository.deleteManyWithTransaction(
          tx,
          data.warehouseLocationIds,
        );
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 localização excluída com sucesso'
          : `${result.totalDeleted} localizações excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      const batchOperationResult = {
        success: result.success,
        failed: result.failed.map((error, index) => ({
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
    } catch (error: unknown) {
      this.logger.error('Erro na exclusão em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir localizações em lote. Por favor, tente novamente.',
      );
    }
  }
}
