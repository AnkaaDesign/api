import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import { hasValueChanged } from '@modules/common/changelog/utils/serialize-changelog-value';
import {
  Garage,
  GarageGetUniqueResponse,
  GarageGetManyResponse,
  GarageCreateResponse,
  GarageUpdateResponse,
  GarageDeleteResponse,
  GarageBatchCreateResponse,
  GarageBatchUpdateResponse,
  GarageBatchDeleteResponse,
} from '../../../types';
import { GarageRepository, PrismaTransaction } from './repositories/garage/garage.repository';
import {
  GarageCreateFormData,
  GarageUpdateFormData,
  GarageGetManyFormData,
  GarageBatchCreateFormData,
  GarageBatchUpdateFormData,
  GarageBatchDeleteFormData,
  GarageInclude,
  GarageOrderBy,
} from '../../../schemas/garage';

@Injectable()
export class GarageService {
  private readonly logger = new Logger(GarageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly garageRepository: GarageRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Ensure the virtual "Patio" garage exists
   */
  async ensureVirtualPatioGarage(): Promise<void> {
    try {
      const existingPatio = await this.prisma.garage.findFirst({
        where: {
          name: 'Patio',
          isVirtual: true,
        },
      });

      if (!existingPatio) {
        this.logger.log('Creating virtual Patio garage...');
        await this.prisma.garage.create({
          data: {
            name: 'Patio',
            width: 0,
            length: 0,
            isVirtual: true,
          },
        });
        this.logger.log('Virtual Patio garage created successfully');
      }
    } catch (error) {
      this.logger.error('Error ensuring Patio garage exists:', error);
      // Don't throw - this should not prevent the service from starting
    }
  }

  /**
   * Validar restrições de unicidade
   */
  private async validateUniqueConstraints(
    tx: PrismaTransaction,
    data: { name?: string },
    excludeId?: string,
  ): Promise<void> {
    if (!data.name) return; // Skip validation if no name provided
    // Verificar unicidade do nome
    const whereClause = excludeId
      ? { name: data.name, NOT: { id: excludeId } }
      : { name: data.name };

    const existingWithName = await tx.garage.findFirst({
      where: whereClause,
    });

    if (existingWithName) {
      throw new BadRequestException('Nome da garagem já está em uso');
    }
  }

  // =====================
  // GARAGE OPERATIONS
  // =====================

  /**
   * Create a new garage
   */
  async create(
    data: GarageCreateFormData,
    include?: GarageInclude,
    userId?: string,
  ): Promise<GarageCreateResponse> {
    try {
      const garage = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar restrições de unicidade
        await this.validateUniqueConstraints(tx, data);

        // Create the garage
        const newGarage = await this.garageRepository.createWithTransaction(tx, data, { include });

        // Log the creation
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.GARAGE,
          entityId: newGarage.id,
          action: CHANGE_ACTION.CREATE,
          field: null,
          oldValue: null,
          newValue: newGarage,
          reason: 'Garagem criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: newGarage.id,
          userId: userId || null,
          transaction: tx,
        });

        return newGarage;
      });

      return {
        success: true,
        message: 'Garagem criada com sucesso.',
        data: garage,
      };
    } catch (error) {
      this.logger.error('Erro ao criar garagem:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao criar a garagem. Tente novamente.',
      );
    }
  }

  /**
   * Batch create garages
   */
  async batchCreate(
    data: { garages: GarageCreateFormData[] },
    include?: GarageInclude,
    userId?: string,
  ): Promise<GarageBatchCreateResponse<GarageCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar restrições de unicidade para cada garagem
        const validationErrors: Array<{
          index: number;
          data: GarageCreateFormData;
          error: string;
          errorCode: string;
        }> = [];

        for (let i = 0; i < data.garages.length; i++) {
          try {
            await this.validateUniqueConstraints(tx, data.garages[i]);
          } catch (error: any) {
            validationErrors.push({
              index: i,
              data: data.garages[i],
              error: error.message || 'Erro de validação',
              errorCode: 'VALIDATION_ERROR',
            });
          }
        }

        // Se houver erros de validação, processar apenas os itens válidos
        const validGarages = data.garages.filter(
          (_, index) => !validationErrors.some(error => error.index === index),
        );

        let result;
        if (validGarages.length > 0) {
          result = await this.garageRepository.createManyWithTransaction(tx, validGarages, {
            include,
          });

          // Log successful creations
          for (const garage of result.success) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.GARAGE,
              entityId: garage.id,
              action: CHANGE_ACTION.CREATE,
              field: null,
              oldValue: null,
              newValue: garage,
              reason: 'Garagem criada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              triggeredById: garage.id,
              userId: userId || null,
              transaction: tx,
            });
          }

          // Adicionar os erros de validação aos resultados
          if (validationErrors.length > 0) {
            result.failed.push(
              ...validationErrors.map(error => ({
                ...error,
                id: undefined,
              })),
            );
            result.totalFailed += validationErrors.length;
          }
        } else {
          // Se todos falharam na validação
          result = {
            success: [],
            failed: validationErrors.map(error => ({
              ...error,
              id: undefined,
            })),
            totalCreated: 0,
            totalFailed: validationErrors.length,
          };
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 garagem criada com sucesso'
          : `${result.totalCreated} garagens criadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

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
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote de garagens:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor na criação em lote. Tente novamente.',
      );
    }
  }

  /**
   * Update an existing garage
   */
  async update(
    id: string,
    data: GarageUpdateFormData,
    include?: GarageInclude,
    userId?: string,
  ): Promise<GarageUpdateResponse> {
    try {
      const updatedGarage = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Check if garage exists
        const existingGarage = await this.garageRepository.findByIdWithTransaction(tx, id);
        if (!existingGarage) {
          throw new NotFoundException('Garagem não encontrada. Verifique se o ID está correto.');
        }

        // Validar restrições de unicidade se o nome estiver sendo alterado
        if (data.name && data.name !== existingGarage.name) {
          await this.validateUniqueConstraints(tx, { name: data.name }, id);
        }

        // Update the garage
        const updated = await this.garageRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Registrar mudanças no changelog - track individual field changes
        const fieldsToTrack = Object.keys(data) as Array<keyof GarageUpdateFormData>;

        // Track changes for each field individually
        for (const field of fieldsToTrack) {
          const oldValue = existingGarage[field as keyof typeof existingGarage];
          const newValue = updated[field as keyof typeof updated];

          // Only log if the value actually changed
          if (hasValueChanged(oldValue, newValue)) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.GARAGE,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: field,
              oldValue: oldValue,
              newValue: newValue,
              reason: `Campo ${String(field)} atualizado`,
              triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        // Special tracking for capacity changes (if lanes are modified)
        if ('lanes' in data || 'width' in data || 'length' in data) {
          const oldCapacity = existingGarage.width * existingGarage.length;
          const newCapacity = updated.width * updated.length;

          if (oldCapacity !== newCapacity) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.GARAGE,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'capacity',
              oldValue: {
                area: oldCapacity,
                width: existingGarage.width,
                length: existingGarage.length,
              },
              newValue: { area: newCapacity, width: updated.width, length: updated.length },
              reason: `Capacidade da garagem alterada de ${oldCapacity}m² para ${newCapacity}m²`,
              triggeredBy: CHANGE_TRIGGERED_BY.GARAGE_CAPACITY_CHANGE,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        return updated;
      });

      return {
        success: true,
        message: 'Garagem atualizada com sucesso.',
        data: updatedGarage,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar garagem:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao atualizar a garagem. Tente novamente.',
      );
    }
  }

  /**
   * Batch update garages
   */
  async batchUpdate(
    data: { garages: { id: string; data: GarageUpdateFormData }[] },
    include?: GarageInclude,
    userId?: string,
  ): Promise<GarageBatchUpdateResponse<GarageUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar restrições de unicidade para cada atualização
        const validationErrors: Array<{
          index: number;
          id: string;
          data: GarageUpdateFormData;
          error: string;
          errorCode: string;
        }> = [];

        // Buscar garagens existentes para validação
        const existingGarages = await this.garageRepository.findByIdsWithTransaction(
          tx,
          data.garages.map((g: { id: string; data: GarageUpdateFormData }) => g.id),
        );

        for (let i = 0; i < data.garages.length; i++) {
          const garage = data.garages[i];
          const existingGarage = existingGarages.find((g: Garage) => g.id === garage.id);

          if (!existingGarage) {
            validationErrors.push({
              index: i,
              id: garage.id,
              data: garage.data,
              error: 'Garagem não encontrada',
              errorCode: 'NOT_FOUND',
            });
            continue;
          }

          // Validar apenas se o nome estiver sendo alterado
          if (garage.data.name && garage.data.name !== existingGarage.name) {
            try {
              await this.validateUniqueConstraints(tx, { name: garage.data.name }, garage.id);
            } catch (error: any) {
              validationErrors.push({
                index: i,
                id: garage.id,
                data: garage.data,
                error: error.message || 'Erro de validação',
                errorCode: 'VALIDATION_ERROR',
              });
            }
          }
        }

        // Se houver erros de validação, processar apenas os itens válidos
        const validGarages = data.garages.filter(
          (_, index) => !validationErrors.some(error => error.index === index),
        );

        let result;
        if (validGarages.length > 0) {
          result = await this.garageRepository.updateManyWithTransaction(tx, validGarages, {
            include,
          });

          // Log successful updates with field-level tracking
          for (const garage of result.success) {
            const existingGarage = existingGarages.find((g: Garage) => g.id === garage.id);
            if (existingGarage) {
              // Find the update data for this garage
              const updateData = validGarages.find(
                (g: { id: string; data: GarageUpdateFormData }) => g.id === garage.id,
              )?.data;
              if (updateData) {
                const fieldsToTrack = Object.keys(updateData) as Array<keyof GarageUpdateFormData>;

                for (const field of fieldsToTrack) {
                  const oldValue = existingGarage[field as keyof typeof existingGarage];
                  const newValue = garage[field as keyof typeof garage];

                  // Only log if the value actually changed
                  if (hasValueChanged(oldValue, newValue)) {
                    await this.changeLogService.logChange({
                      entityType: ENTITY_TYPE.GARAGE,
                      entityId: garage.id,
                      action: CHANGE_ACTION.UPDATE,
                      field: field,
                      oldValue: oldValue,
                      newValue: newValue,
                      reason: `Campo ${String(field)} atualizado em lote`,
                      triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
                      triggeredById: garage.id,
                      userId: userId || null,
                      transaction: tx,
                    });
                  }
                }
              }
            }
          }

          // Adicionar os erros de validação aos resultados
          if (validationErrors.length > 0) {
            result.failed.push(
              ...validationErrors.map(error => ({
                ...error,
              })),
            );
            result.totalFailed += validationErrors.length;
          }
        } else {
          // Se todos falharam na validação
          result = {
            success: [],
            failed: validationErrors.map(error => ({
              ...error,
            })),
            totalUpdated: 0,
            totalFailed: validationErrors.length,
          };
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 garagem atualizada com sucesso'
          : `${result.totalUpdated} garagens atualizadas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

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
        message: `${successMessage}${failureMessage}`,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote de garagens:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na atualização em lote. Tente novamente.',
      );
    }
  }

  /**
   * Delete a garage
   */
  async delete(id: string, userId?: string): Promise<GarageDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const garage = await this.garageRepository.findByIdWithTransaction(tx, id, {
          include: { trucks: true },
        });
        if (!garage) {
          throw new NotFoundException('Garagem não encontrada. Verifique se o ID está correto.');
        }

        // Check if garage has trucks assigned
        if (garage.trucks && garage.trucks.length > 0) {
          throw new BadRequestException(
            `Não é possível excluir a garagem pois ela possui ${garage.trucks.length} caminhão(ões) alocado(s). Realoque os caminhões antes de excluir.`,
          );
        }

        // Prevent deletion of virtual garage
        if (garage.isVirtual) {
          throw new BadRequestException(
            'Não é possível excluir uma garagem virtual. Garagens virtuais são gerenciadas automaticamente pelo sistema.',
          );
        }

        await this.garageRepository.deleteWithTransaction(tx, id);

        // Log the deletion
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.GARAGE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          field: null,
          oldValue: garage,
          newValue: null,
          reason: 'Garagem excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          triggeredById: id,
          userId: userId || null,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Garagem excluída com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir garagem:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao excluir a garagem. Tente novamente.',
      );
    }
  }

  /**
   * Batch delete garages
   */
  async batchDelete(
    data: GarageBatchDeleteFormData,
    userId?: string,
  ): Promise<GarageBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Get garages before deletion for logging
        const garages = await this.garageRepository.findByIdsWithTransaction(tx, data.garageIds);

        // Delete garages
        const deleteResult = await this.garageRepository.deleteManyWithTransaction(
          tx,
          data.garageIds,
        );

        // Log deletions
        for (const garage of garages) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.GARAGE,
            entityId: garage.id,
            action: CHANGE_ACTION.DELETE,
            field: null,
            oldValue: garage,
            newValue: null,
            reason: 'Garagem excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            triggeredById: garage.id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return deleteResult;
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 garagem excluída com sucesso'
          : `${result.totalDeleted} garagens excluídas com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult
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
      this.logger.error('Erro na exclusão em lote de garagens:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }

  /**
   * Find a garage by ID
   */
  async findById(id: string, include?: GarageInclude): Promise<GarageGetUniqueResponse> {
    try {
      const garage = await this.garageRepository.findById(id, { include });

      if (!garage) {
        throw new NotFoundException('Garagem não encontrada. Verifique se o ID está correto.');
      }

      return {
        success: true,
        message: 'Garagem carregada com sucesso.',
        data: garage,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar garagem por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar a garagem. Tente novamente.',
      );
    }
  }

  /**
   * Find many garages with filtering
   */
  async findMany(query: GarageGetManyFormData): Promise<GarageGetManyResponse> {
    try {
      // Ensure virtual Patio garage exists
      await this.ensureVirtualPatioGarage();

      const params = {
        where: query.where || {},
        page: query.page,
        take: query.limit,
        orderBy: query.orderBy as GarageOrderBy,
        include: query.include as GarageInclude,
      };

      const result = await this.garageRepository.findMany(params);

      return {
        success: true,
        message: 'Garagens carregadas com sucesso.',
        data: result.data,
        meta: result.meta,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar garagens:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor ao buscar as garagens. Tente novamente.',
      );
    }
  }
}
