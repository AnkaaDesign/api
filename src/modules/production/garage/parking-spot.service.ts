import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ParkingSpotRepository,
  PrismaTransaction,
} from './repositories/parking-spot/parking-spot.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import type {
  ParkingSpotBatchCreateResponse,
  ParkingSpotBatchDeleteResponse,
  ParkingSpotBatchUpdateResponse,
  ParkingSpotCreateResponse,
  ParkingSpotDeleteResponse,
  ParkingSpotGetManyResponse,
  ParkingSpotGetUniqueResponse,
  ParkingSpotUpdateResponse,
} from '../../../types';
import { ParkingSpot } from '../../../types';
import type {
  ParkingSpotCreateFormData,
  ParkingSpotUpdateFormData,
  ParkingSpotGetManyFormData,
  ParkingSpotBatchCreateFormData,
  ParkingSpotBatchUpdateFormData,
  ParkingSpotBatchDeleteFormData,
  ParkingSpotInclude,
} from '../../../schemas/garage';

@Injectable()
export class ParkingSpotService {
  private readonly logger = new Logger(ParkingSpotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parkingSpotRepository: ParkingSpotRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar entidade completa para parking spot
   */
  private async parkingSpotValidation(
    data: Partial<ParkingSpotCreateFormData | ParkingSpotUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar se a garage lane existe e obter informações da lane
    let garageLane: any = null;
    if ('garageLaneId' in data && data.garageLaneId) {
      garageLane = await transaction.garageLane.findUnique({
        where: { id: data.garageLaneId },
        include: {
          parkingSpots: true,
          garage: true,
        },
      });
      if (!garageLane) {
        throw new NotFoundException('Faixa da garagem não encontrada.');
      }
    } else if (existingId) {
      // Para updates, pegar a lane atual se não for fornecida
      const existingSpot = await transaction.parkingSpot.findUnique({
        where: { id: existingId },
        include: { garageLane: { include: { parkingSpots: true, garage: true } } },
      });
      if (existingSpot) {
        garageLane = existingSpot.garageLane;
      }
    }

    // Validar nome único dentro da mesma garage lane
    if (data.name !== undefined && garageLane) {
      const existingName = await transaction.parkingSpot.findFirst({
        where: {
          name: data.name,
          garageLaneId: garageLane.id,
          ...(existingId && { NOT: { id: existingId } }),
        },
      });
      if (existingName) {
        throw new BadRequestException(`Nome da vaga '${data.name}' já está em uso nesta faixa.`);
      }
    }

    // Validar capacidade da lane - verificar se não excede o limite de vagas
    if (garageLane && !existingId) {
      // Calcular quantas vagas cabem na lane baseado no comprimento
      const spotLength = data.length || 12.5; // Comprimento padrão de 12.5m
      const maxSpots = Math.floor(garageLane.length / spotLength);
      const currentSpots = garageLane.parkingSpots.length;

      if (currentSpots >= maxSpots) {
        throw new BadRequestException(
          `A faixa já atingiu sua capacidade máxima de ${maxSpots} vagas. ` +
            `Comprimento da faixa: ${garageLane.length}m, comprimento da vaga: ${spotLength}m.`,
        );
      }
    }

    // Validar comprimento da vaga em relação ao comprimento da lane
    if (data.length !== undefined && garageLane) {
      if (data.length > garageLane.length) {
        throw new BadRequestException(
          `Comprimento da vaga (${data.length}m) não pode ser maior que o comprimento da faixa (${garageLane.length}m).`,
        );
      }

      // Para updates, verificar se o novo comprimento não causará problemas
      if (existingId) {
        const totalSpots =
          garageLane.parkingSpots.filter((s: any) => s.id !== existingId).length + 1;
        const requiredLength = totalSpots * data.length;
        if (requiredLength > garageLane.length) {
          throw new BadRequestException(
            `Alterar o comprimento para ${data.length}m excederia a capacidade da faixa. ` +
              `${totalSpots} vagas x ${data.length}m = ${requiredLength}m necessários, mas a faixa tem apenas ${garageLane.length}m.`,
          );
        }
      }
    }

    // Validar comprimento positivo e razoável
    if (data.length !== undefined) {
      if (data.length <= 0) {
        throw new BadRequestException('Comprimento deve ser maior que zero.');
      }
      if (data.length < 5) {
        throw new BadRequestException('Comprimento mínimo da vaga é 5 metros.');
      }
      if (data.length > 25) {
        throw new BadRequestException('Comprimento máximo da vaga é 25 metros.');
      }
    }

    // Validar padrões de nomenclatura
    if (data.name !== undefined) {
      const namePattern = /^[A-Z0-9\-]+$/;
      if (!namePattern.test(data.name)) {
        throw new BadRequestException(
          'Nome da vaga deve conter apenas letras maiúsculas, números e hífens (ex: A-01, B-02, ESPECIAL-1).',
        );
      }
    }
  }

  /**
   * Buscar muitas vagas com filtros
   */
  async findMany(query: ParkingSpotGetManyFormData): Promise<ParkingSpotGetManyResponse> {
    try {
      const result = await this.parkingSpotRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Vagas carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar vagas:', error);
      throw new InternalServerErrorException('Erro ao buscar vagas. Por favor, tente novamente.');
    }
  }

  /**
   * Buscar uma vaga por ID
   */
  async findById(id: string, include?: ParkingSpotInclude): Promise<ParkingSpotGetUniqueResponse> {
    try {
      const parkingSpot = await this.parkingSpotRepository.findById(id, { include });

      if (!parkingSpot) {
        throw new NotFoundException('Vaga não encontrada.');
      }

      return { success: true, data: parkingSpot, message: 'Vaga carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar vaga por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar vaga. Por favor, tente novamente.');
    }
  }

  /**
   * Criar nova vaga
   */
  async create(
    data: ParkingSpotCreateFormData,
    include?: ParkingSpotInclude,
    userId?: string,
  ): Promise<ParkingSpotCreateResponse> {
    try {
      const parkingSpot = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.parkingSpotValidation(data, undefined, tx);

        // Criar a vaga
        const newParkingSpot = await this.parkingSpotRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PARKING_SPOT,
          entityId: newParkingSpot.id,
          action: CHANGE_ACTION.CREATE,
          entity: newParkingSpot,
          reason: 'Nova vaga de estacionamento criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        return newParkingSpot;
      });

      return {
        success: true,
        message: 'Vaga criada com sucesso.',
        data: parkingSpot,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar vaga:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar vaga. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar vaga
   */
  async update(
    id: string,
    data: ParkingSpotUpdateFormData,
    include?: ParkingSpotInclude,
    userId?: string,
  ): Promise<ParkingSpotUpdateResponse> {
    try {
      const updatedParkingSpot = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar vaga existente
        const existingParkingSpot = await this.parkingSpotRepository.findByIdWithTransaction(
          tx,
          id,
        );

        if (!existingParkingSpot) {
          throw new NotFoundException('Vaga não encontrada.');
        }

        // Validar entidade completa
        await this.parkingSpotValidation(data, id, tx);

        // Atualizar a vaga
        const updatedParkingSpot = await this.parkingSpotRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Track field-level changes
        const fieldsToTrack = ['name', 'length', 'garageLaneId'];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PARKING_SPOT,
          entityId: id,
          oldEntity: existingParkingSpot,
          newEntity: updatedParkingSpot,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedParkingSpot;
      });

      return {
        success: true,
        message: 'Vaga atualizada com sucesso.',
        data: updatedParkingSpot,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar vaga:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao atualizar vaga. Por favor, tente novamente.');
    }
  }

  /**
   * Excluir vaga
   */
  async delete(id: string, userId?: string): Promise<ParkingSpotDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const parkingSpot = await this.parkingSpotRepository.findByIdWithTransaction(tx, id);

        if (!parkingSpot) {
          throw new NotFoundException('Vaga não encontrada.');
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.PARKING_SPOT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: parkingSpot,
          reason: 'Vaga de estacionamento excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        await this.parkingSpotRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Vaga excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir vaga:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao excluir vaga. Por favor, tente novamente.');
    }
  }

  /**
   * Criar múltiplas vagas
   */
  async batchCreate(
    data: ParkingSpotBatchCreateFormData,
    include?: ParkingSpotInclude,
    userId?: string,
  ): Promise<ParkingSpotBatchCreateResponse<ParkingSpotCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: ParkingSpot[] = [];
        const failedCreations: any[] = [];

        // Processar cada vaga individualmente para validação detalhada
        for (let index = 0; index < data.parkingSpots.length; index++) {
          const parkingSpotData = data.parkingSpots[index];
          try {
            // Validar entidade completa
            await this.parkingSpotValidation(parkingSpotData, undefined, tx);

            // Criar a vaga
            const newParkingSpot = await this.parkingSpotRepository.createWithTransaction(
              tx,
              parkingSpotData,
              { include },
            );
            successfulCreations.push(newParkingSpot);

            // Registrar no changelog
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PARKING_SPOT,
              entityId: newParkingSpot.id,
              action: CHANGE_ACTION.CREATE,
              entity: newParkingSpot,
              reason: 'Vaga criada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || '',
              transaction: tx,
            });
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar vaga.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: parkingSpotData,
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
          ? '1 vaga criada com sucesso'
          : `${result.totalCreated} vagas criadas com sucesso`;
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
        'Erro ao criar vagas em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas vagas
   */
  async batchUpdate(
    data: ParkingSpotBatchUpdateFormData,
    include?: ParkingSpotInclude,
    userId?: string,
  ): Promise<ParkingSpotBatchUpdateResponse<ParkingSpotUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: ParkingSpot[] = [];
        const failedUpdates: any[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.parkingSpots.length; index++) {
          const { id, data: updateData } = data.parkingSpots[index];
          try {
            // Buscar vaga existente
            const existingParkingSpot = await this.parkingSpotRepository.findByIdWithTransaction(
              tx,
              id,
            );
            if (!existingParkingSpot) {
              throw new NotFoundException('Vaga não encontrada.');
            }

            // Validar entidade completa
            await this.parkingSpotValidation(updateData, id, tx);

            // Atualizar a vaga
            const updatedParkingSpot = await this.parkingSpotRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedParkingSpot);

            // Track field-level changes
            const fieldsToTrack = ['name', 'length', 'garageLaneId'];

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.PARKING_SPOT,
              entityId: id,
              oldEntity: existingParkingSpot,
              newEntity: updatedParkingSpot,
              fieldsToTrack,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar vaga.',
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
          ? '1 vaga atualizada com sucesso'
          : `${result.totalUpdated} vagas atualizadas com sucesso`;
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
        'Erro ao atualizar vagas em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete parking spots
   */
  async batchDelete(
    data: ParkingSpotBatchDeleteFormData,
    userId?: string,
  ): Promise<ParkingSpotBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar vagas antes de excluir para o changelog
        const parkingSpots = await this.parkingSpotRepository.findByIdsWithTransaction(
          tx,
          data.parkingSpotIds,
        );

        // Registrar exclusões
        for (const parkingSpot of parkingSpots) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.PARKING_SPOT,
            entityId: parkingSpot.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: parkingSpot,
            reason: 'Vaga excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || '',
            transaction: tx,
          });
        }

        return this.parkingSpotRepository.deleteManyWithTransaction(tx, data.parkingSpotIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 vaga excluída com sucesso'
          : `${result.totalDeleted} vagas excluídas com sucesso`;
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
}
