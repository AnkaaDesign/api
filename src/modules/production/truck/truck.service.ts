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
import { TruckRepository, PrismaTransaction } from './repositories/truck.repository';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { hasValueChanged } from '@modules/common/changelog/utils/serialize-changelog-value';
import {
  convertToBatchOperationResult,
  generateBatchMessage,
} from '@modules/common/utils/batch-operation.utils';
import {
  TruckGetManyFormData,
  TruckCreateFormData,
  TruckUpdateFormData,
  TruckBatchCreateFormData,
  TruckBatchUpdateFormData,
  TruckBatchDeleteFormData,
  TruckInclude,
} from '../../../schemas/truck';
import {
  Truck,
  TruckGetUniqueResponse,
  TruckGetManyResponse,
  TruckCreateResponse,
  TruckUpdateResponse,
  TruckDeleteResponse,
  TruckBatchCreateResponse,
  TruckBatchUpdateResponse,
  TruckBatchDeleteResponse,
  BatchError,
} from '../../../types';

@Injectable()
export class TruckService {
  private readonly logger = new Logger(TruckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly truckRepository: TruckRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar truck completo
   */
  private async validateTruck(
    data: Partial<TruckCreateFormData | TruckUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar se a task existe e não está associada a outro caminhão
    if ('taskId' in data && data.taskId) {
      const task = await transaction.task.findUnique({
        where: { id: data.taskId },
        select: {
          id: true,
          plate: true,
          name: true,
        },
      });

      if (!task) {
        throw new NotFoundException('Tarefa não encontrada.');
      }

      // Verificar se a task já está associada a outro caminhão
      const existingTruck = await transaction.truck.findFirst({
        where: {
          taskId: data.taskId,
          ...(existingId && { NOT: { id: existingId } }),
        },
      });
      if (existingTruck) {
        throw new BadRequestException('Esta tarefa já está associada a outro caminhão.');
      }

      // Verificar unicidade da placa se existir
      if (task.plate) {
        const truckWithSamePlate = await this.truckRepository.findByLicensePlateWithTransaction(
          transaction,
          task.plate,
        );
        if (truckWithSamePlate && truckWithSamePlate.id !== existingId) {
          throw new BadRequestException(`Já existe um caminhão com a placa ${task.plate}.`);
        }
      }
    }

    // Validar se a garagem existe
    if ('garageId' in data && data.garageId) {
      const garageExists = await transaction.garage.findUnique({
        where: { id: data.garageId },
      });
      if (!garageExists) {
        throw new NotFoundException('Garagem não encontrada.');
      }
    }


    // Validar posições se fornecidas
    if (
      'xPosition' in data &&
      data.xPosition !== undefined &&
      data.xPosition !== null &&
      data.xPosition < 0
    ) {
      throw new BadRequestException('Posição X não pode ser negativa.');
    }

    if (
      'yPosition' in data &&
      data.yPosition !== undefined &&
      data.yPosition !== null &&
      data.yPosition < 0
    ) {
      throw new BadRequestException('Posição Y não pode ser negativa.');
    }
  }

  /**
   * Buscar muitos caminhões com filtros
   */
  async findMany(query: TruckGetManyFormData): Promise<TruckGetManyResponse> {
    try {
      const result = await this.truckRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Caminhões carregados com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao buscar caminhões:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar caminhões. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um caminhão por ID
   */
  async findById(id: string, include?: TruckInclude): Promise<TruckGetUniqueResponse> {
    try {
      const truck = await this.truckRepository.findById(id, { include });

      if (!truck) {
        throw new NotFoundException('Caminhão não encontrado.');
      }

      return { success: true, data: truck, message: 'Caminhão carregado com sucesso.' };
    } catch (error) {
      this.logger.error('Erro ao buscar caminhão por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao buscar caminhão. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar novo caminhão
   */
  async create(
    data: TruckCreateFormData,
    include?: TruckInclude,
    userId?: string | null,
  ): Promise<TruckCreateResponse> {
    try {
      const truck = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.validateTruck(data, undefined, tx);

        // Criar o caminhão
        const newTruck = await this.truckRepository.createWithTransaction(tx, data, { include });

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TRUCK,
          entityId: newTruck.id,
          action: CHANGE_ACTION.CREATE,
          entity: newTruck,
          reason: 'Novo caminhão cadastrado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        return newTruck;
      });

      return {
        success: true,
        message: 'Caminhão criado com sucesso.',
        data: truck,
      };
    } catch (error) {
      this.logger.error('Erro ao criar caminhão:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar caminhão. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar caminhão
   */
  async update(
    id: string,
    data: TruckUpdateFormData,
    include?: TruckInclude,
    userId?: string | null,
  ): Promise<TruckUpdateResponse> {
    try {
      const updatedTruck = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar caminhão existente
        const existingTruck = await this.truckRepository.findByIdWithTransaction(tx, id);

        if (!existingTruck) {
          throw new NotFoundException('Caminhão não encontrado.');
        }

        // Validar entidade completa
        await this.validateTruck(data, id, tx);

        // Atualizar o caminhão
        const updatedTruck = await this.truckRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Track field-level changes
        const fieldsToTrack = [
          'xPosition',
          'yPosition',
          'taskId',
          'garageId',
        ];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TRUCK,
          entityId: id,
          oldEntity: existingTruck,
          newEntity: updatedTruck,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Special tracking for vehicle movements (garage changes)
        if ('garageId' in data) {
          const oldGarageId = existingTruck.garageId;
          const newGarageId = data.garageId;

          if (oldGarageId !== newGarageId) {
            await this.changeLogService.logChange({
              entityType: ENTITY_TYPE.TRUCK,
              entityId: id,
              action: CHANGE_ACTION.UPDATE,
              field: 'vehicle_movement',
              oldValue: { from_garage: oldGarageId },
              newValue: { to_garage: newGarageId },
              reason: `Veículo movido de garagem ${oldGarageId || 'sem garagem'} para ${newGarageId || 'sem garagem'}`,
              triggeredBy: CHANGE_TRIGGERED_BY.VEHICLE_MOVEMENT,
              triggeredById: id,
              userId: userId || null,
              transaction: tx,
            });
          }
        }

        // Special tracking for position changes
        if (
          ('xPosition' in data || 'yPosition' in data) &&
          hasValueChanged(
            { x: existingTruck.xPosition, y: existingTruck.yPosition },
            { x: updatedTruck.xPosition, y: updatedTruck.yPosition },
          )
        ) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.TRUCK,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'parking_position',
            oldValue: { x: existingTruck.xPosition, y: existingTruck.yPosition },
            newValue: { x: updatedTruck.xPosition, y: updatedTruck.yPosition },
            reason: `Posição de estacionamento atualizada`,
            triggeredBy: CHANGE_TRIGGERED_BY.PARKING_ASSIGNMENT,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return updatedTruck;
      });

      return {
        success: true,
        message: 'Caminhão atualizado com sucesso.',
        data: updatedTruck,
      };
    } catch (error) {
      this.logger.error('Erro ao atualizar caminhão:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar caminhão. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir caminhão
   */
  async delete(id: string, userId?: string | null): Promise<TruckDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const truck = await this.truckRepository.findByIdWithTransaction(tx, id);

        if (!truck) {
          throw new NotFoundException('Caminhão não encontrado.');
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.TRUCK,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: truck,
          reason: 'Caminhão excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        await this.truckRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Caminhão excluído com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao excluir caminhão:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir caminhão. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplos caminhões
   */
  async batchCreate(
    data: TruckBatchCreateFormData,
    include?: TruckInclude,
    userId?: string | null,
  ): Promise<TruckBatchCreateResponse<TruckCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: Truck[] = [];
        const failedCreations: BatchError<TruckCreateFormData>[] = [];

        // Processar cada caminhão individualmente para validação detalhada
        for (let index = 0; index < data.trucks.length; index++) {
          const truckData = data.trucks[index];
          try {
            // Validar entidade completa
            await this.validateTruck(truckData, undefined, tx);

            // Criar o caminhão
            const newTruck = await this.truckRepository.createWithTransaction(tx, truckData, {
              include,
            });
            successfulCreations.push(newTruck);

            // Registrar no changelog
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.TRUCK,
              entityId: newTruck.id,
              action: CHANGE_ACTION.CREATE,
              entity: newTruck,
              reason: 'Caminhão criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || '',
              transaction: tx,
            });
          } catch (error) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar caminhão.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: truckData,
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

      const batchOperationResult = convertToBatchOperationResult<Truck, TruckCreateFormData>(
        result,
      );
      const message = generateBatchMessage(
        'criado',
        result.totalCreated,
        result.totalFailed,
        'caminhão',
      );

      return {
        success: true,
        message: message,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar caminhões em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplos caminhões
   */
  async batchUpdate(
    data: TruckBatchUpdateFormData,
    include?: TruckInclude,
    userId?: string | null,
  ): Promise<TruckBatchUpdateResponse<TruckUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: Truck[] = [];
        const failedUpdates: BatchError<TruckUpdateFormData & { id: string }>[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.trucks.length; index++) {
          const { id, data: updateData } = data.trucks[index];
          try {
            // Buscar caminhão existente
            const existingTruck = await this.truckRepository.findByIdWithTransaction(tx, id);
            if (!existingTruck) {
              throw new NotFoundException('Caminhão não encontrado.');
            }

            // Validar entidade completa
            await this.validateTruck(updateData, id, tx);

            // Atualizar o caminhão
            const updatedTruck = await this.truckRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedTruck);

            // Track field-level changes
            const fieldsToTrack = [
              'xPosition',
              'yPosition',
              'taskId',
              'garageId',
            ];

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.TRUCK,
              entityId: id,
              oldEntity: existingTruck,
              newEntity: updatedTruck,
              fieldsToTrack,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          } catch (error) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar caminhão.',
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

      const batchOperationResult = convertToBatchOperationResult<
        Truck,
        TruckUpdateFormData & { id: string }
      >(result);
      const message = generateBatchMessage(
        'atualizado',
        result.totalUpdated,
        result.totalFailed,
        'caminhão',
      );

      return {
        success: true,
        message: message,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar caminhões em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete trucks
   */
  async batchDelete(
    data: TruckBatchDeleteFormData,
    userId?: string | null,
  ): Promise<TruckBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar caminhões antes de excluir para o changelog
        const trucks = await this.truckRepository.findByIdsWithTransaction(tx, data.truckIds);

        // Registrar exclusões
        for (const truck of trucks) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.TRUCK,
            entityId: truck.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: truck,
            reason: 'Caminhão excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || '',
            transaction: tx,
          });
        }

        return this.truckRepository.deleteManyWithTransaction(tx, data.truckIds);
      });

      const batchOperationResult = convertToBatchOperationResult<
        { id: string; deleted: boolean },
        { id: string }
      >(result);
      const message = generateBatchMessage(
        'excluído',
        result.totalDeleted,
        result.totalFailed,
        'caminhão',
      );

      return {
        success: true,
        message: message,
        data: batchOperationResult,
      };
    } catch (error) {
      this.logger.error('Erro na exclusão em lote:', error);
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }
}
