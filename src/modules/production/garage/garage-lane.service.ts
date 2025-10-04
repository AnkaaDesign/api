import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  GarageLaneRepository,
  PrismaTransaction,
} from './repositories/garage-lane/garage-lane.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import type {
  GarageLaneBatchCreateResponse,
  GarageLaneBatchDeleteResponse,
  GarageLaneBatchUpdateResponse,
  GarageLaneCreateResponse,
  GarageLaneDeleteResponse,
  GarageLaneGetManyResponse,
  GarageLaneGetUniqueResponse,
  GarageLaneUpdateResponse,
} from '../../../types';
import { GarageLane } from '../../../types';
import type {
  GarageLaneCreateFormData,
  GarageLaneUpdateFormData,
  GarageLaneGetManyFormData,
  GarageLaneBatchCreateFormData,
  GarageLaneBatchUpdateFormData,
  GarageLaneBatchDeleteFormData,
  GarageLaneInclude,
} from '../../../schemas/garage';

@Injectable()
export class GarageLaneService {
  private readonly logger = new Logger(GarageLaneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly garageLaneRepository: GarageLaneRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar entidade completa para garage lane
   */
  private async garageLaneValidation(
    data: Partial<GarageLaneCreateFormData | GarageLaneUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar se a garagem existe e obter informações
    let garage: any = null;
    if ('garageId' in data && data.garageId) {
      garage = await transaction.garage.findUnique({
        where: { id: data.garageId },
        include: {
          lanes: true,
        },
      });
      if (!garage) {
        throw new NotFoundException('Garagem não encontrada.');
      }
    } else if (existingId) {
      // Para updates, pegar a garagem atual se não for fornecida
      const existingLane = await transaction.garageLane.findUnique({
        where: { id: existingId },
        include: { garage: { include: { lanes: true } } },
      });
      if (existingLane) {
        garage = existingLane.garage;
      }
    }

    // Validar dimensões positivas e razoáveis
    if (data.width !== undefined) {
      if (data.width <= 0) {
        throw new BadRequestException('Largura deve ser maior que zero.');
      }
      if (data.width < 2.5) {
        throw new BadRequestException('Largura mínima da faixa é 2.5 metros.');
      }
      if (data.width > 10) {
        throw new BadRequestException('Largura máxima da faixa é 10 metros.');
      }
    }

    if (data.length !== undefined) {
      if (data.length <= 0) {
        throw new BadRequestException('Comprimento deve ser maior que zero.');
      }
      if (data.length < 10) {
        throw new BadRequestException('Comprimento mínimo da faixa é 10 metros.');
      }
      if (data.length > 200) {
        throw new BadRequestException('Comprimento máximo da faixa é 200 metros.');
      }
    }

    // Validar posições
    if (data.xPosition !== undefined && data.xPosition < 0) {
      throw new BadRequestException('Posição X não pode ser negativa.');
    }

    if (data.yPosition !== undefined && data.yPosition < 0) {
      throw new BadRequestException('Posição Y não pode ser negativa.');
    }

    // Validar que as posições estão dentro dos limites da garagem
    if (
      garage &&
      (data.xPosition !== undefined ||
        data.yPosition !== undefined ||
        data.width !== undefined ||
        data.length !== undefined)
    ) {
      let currentLane: any = null;
      if (existingId) {
        currentLane = await transaction.garageLane.findUnique({
          where: { id: existingId },
        });
      }

      const xPos = data.xPosition ?? currentLane?.xPosition ?? 0;
      const yPos = data.yPosition ?? currentLane?.yPosition ?? 0;
      const width = data.width ?? currentLane?.width ?? 0;
      const length = data.length ?? currentLane?.length ?? 0;

      // Verificar se a faixa está dentro dos limites da garagem
      if (xPos + width > garage.width) {
        throw new BadRequestException(
          `A faixa excede a largura da garagem. ` +
            `Posição X (${xPos}) + Largura da faixa (${width}) = ${xPos + width}m, ` +
            `mas a garagem tem apenas ${garage.width}m de largura.`,
        );
      }

      if (yPos + length > garage.length) {
        throw new BadRequestException(
          `A faixa excede o comprimento da garagem. ` +
            `Posição Y (${yPos}) + Comprimento da faixa (${length}) = ${yPos + length}m, ` +
            `mas a garagem tem apenas ${garage.length}m de comprimento.`,
        );
      }
    }

    // Validar sobreposição de faixas na mesma garagem
    if (
      garage &&
      (data.xPosition !== undefined ||
        data.yPosition !== undefined ||
        data.width !== undefined ||
        data.length !== undefined)
    ) {
      let currentLane: any = null;
      if (existingId) {
        currentLane = await transaction.garageLane.findUnique({
          where: { id: existingId },
        });
      }

      const xPos = data.xPosition ?? currentLane?.xPosition ?? 0;
      const yPos = data.yPosition ?? currentLane?.yPosition ?? 0;
      const width = data.width ?? currentLane?.width ?? 0;
      const length = data.length ?? currentLane?.length ?? 0;

      // Verificar sobreposição com outras faixas (colisão retangular)
      const overlappingLanes = await transaction.garageLane.findMany({
        where: {
          garageId: garage.id,
          ...(existingId && { NOT: { id: existingId } }),
          AND: [
            { xPosition: { lt: xPos + width } }, // Direita da outra faixa está à direita do início desta
            {
              OR: [
                { xPosition: { gte: xPos } }, // Início da outra faixa está à direita ou no mesmo ponto
                {
                  AND: [
                    { xPosition: { lt: xPos } },
                    { NOT: { xPosition: { lt: xPos - width } } }, // Fim da outra faixa está à direita do início desta
                  ],
                },
              ],
            },
            { yPosition: { lt: yPos + length } }, // Fundo da outra faixa está abaixo do topo desta
            {
              OR: [
                { yPosition: { gte: yPos } }, // Topo da outra faixa está abaixo ou no mesmo ponto
                {
                  AND: [
                    { yPosition: { lt: yPos } },
                    { NOT: { yPosition: { lt: yPos - length } } }, // Fundo da outra faixa está abaixo do topo desta
                  ],
                },
              ],
            },
          ],
        },
        include: {
          parkingSpots: true,
        },
      });

      if (overlappingLanes.length > 0) {
        const overlappingInfo = overlappingLanes
          .map(
            (lane: GarageLane & { parkingSpots: any[] }) =>
              `Faixa ${lane.id.substring(0, 8)} na posição (${lane.xPosition}, ${lane.yPosition}) com dimensões ${lane.width}x${lane.length}m`,
          )
          .join('; ');

        throw new BadRequestException(
          `A faixa se sobrepõe com ${overlappingLanes.length} faixa(s) existente(s) na garagem: ${overlappingInfo}`,
        );
      }
    }

    // Validar capacidade máxima de faixas na garagem
    if (garage && !existingId) {
      const maxLanes = Math.floor((garage.width * garage.length) / 100); // Máximo baseado em área (100m² por faixa)
      if (garage.lanes.length >= maxLanes) {
        throw new BadRequestException(
          `A garagem já atingiu sua capacidade máxima estimada de ${maxLanes} faixas ` +
            `baseada em sua área de ${garage.width * garage.length}m².`,
        );
      }
    }

    // Validar que faixas com vagas não podem mudar de garagem
    if (existingId && 'garageId' in data && data.garageId) {
      const existingLane = await transaction.garageLane.findUnique({
        where: { id: existingId },
        include: { parkingSpots: true },
      });

      if (
        existingLane &&
        existingLane.parkingSpots.length > 0 &&
        existingLane.garageId !== data.garageId
      ) {
        throw new BadRequestException(
          `Não é possível mover uma faixa com ${existingLane.parkingSpots.length} vaga(s) para outra garagem. ` +
            `Remova todas as vagas antes de mover a faixa.`,
        );
      }
    }
  }

  /**
   * Buscar muitas faixas com filtros
   */
  async findMany(query: GarageLaneGetManyFormData): Promise<GarageLaneGetManyResponse> {
    try {
      const result = await this.garageLaneRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Faixas carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar faixas:', error);
      throw new InternalServerErrorException('Erro ao buscar faixas. Por favor, tente novamente.');
    }
  }

  /**
   * Buscar uma faixa por ID
   */
  async findById(id: string, include?: GarageLaneInclude): Promise<GarageLaneGetUniqueResponse> {
    try {
      const garageLane = await this.garageLaneRepository.findById(id, { include });

      if (!garageLane) {
        throw new NotFoundException('Faixa não encontrada.');
      }

      return { success: true, data: garageLane, message: 'Faixa carregada com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar faixa por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar faixa. Por favor, tente novamente.');
    }
  }

  /**
   * Criar nova faixa
   */
  async create(
    data: GarageLaneCreateFormData,
    include?: GarageLaneInclude,
    userId?: string,
  ): Promise<GarageLaneCreateResponse> {
    try {
      const garageLane = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.garageLaneValidation(data, undefined, tx);

        // Criar a faixa
        const newGarageLane = await this.garageLaneRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.GARAGE_LANE,
          entityId: newGarageLane.id,
          action: CHANGE_ACTION.CREATE,
          entity: newGarageLane,
          reason: 'Faixa criada',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        return newGarageLane;
      });

      return {
        success: true,
        message: 'Faixa criada com sucesso.',
        data: garageLane,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar faixa:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar faixa. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar faixa
   */
  async update(
    id: string,
    data: GarageLaneUpdateFormData,
    include?: GarageLaneInclude,
    userId?: string,
  ): Promise<GarageLaneUpdateResponse> {
    try {
      const updatedGarageLane = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar faixa existente
        const existingGarageLane = await this.garageLaneRepository.findByIdWithTransaction(tx, id);

        if (!existingGarageLane) {
          throw new NotFoundException('Faixa não encontrada.');
        }

        // Validar entidade completa
        await this.garageLaneValidation(data, id, tx);

        // Atualizar a faixa
        const updatedGarageLane = await this.garageLaneRepository.updateWithTransaction(
          tx,
          id,
          data,
          { include },
        );

        // Track field-level changes
        const fieldsToTrack = ['width', 'length', 'xPosition', 'yPosition', 'garageId'];

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.GARAGE_LANE,
          entityId: id,
          oldEntity: existingGarageLane,
          newEntity: updatedGarageLane,
          fieldsToTrack,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        // Track when lanes become occupied/unoccupied
        // Commented out: isOccupied property doesn't exist in GarageLane model
        // if (data.hasOwnProperty('isOccupied') && existingGarageLane.isOccupied !== updatedGarageLane.isOccupied) {
        //   const status = updatedGarageLane.isOccupied ? 'ocupada' : 'desocupada';
        //   await this.changeLogService.logChange({
        //     entityType: ENTITY_TYPE.GARAGE_LANE,
        //     entityId: id,
        //     action: CHANGE_ACTION.UPDATE,
        //     field: 'occupancy_status',
        //     oldValue: existingGarageLane.isOccupied ? 'ocupada' : 'desocupada',
        //     newValue: status,
        //     reason: `Faixa ficou ${status}`,
        //     triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
        //     triggeredById: id,
        //     userId: userId || '',
        //     transaction: tx,
        //   });
        // }

        return updatedGarageLane;
      });

      return {
        success: true,
        message: 'Faixa atualizada com sucesso.',
        data: updatedGarageLane,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar faixa:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar faixa. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir faixa
   */
  async delete(id: string, userId?: string): Promise<GarageLaneDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const garageLane = await this.garageLaneRepository.findByIdWithTransaction(tx, id);

        if (!garageLane) {
          throw new NotFoundException('Faixa não encontrada.');
        }

        // Verificar se há vagas associadas
        const parkingSpots = await tx.parkingSpot.count({
          where: { garageLaneId: id },
        });

        if (parkingSpots > 0) {
          throw new BadRequestException('Não é possível excluir a faixa pois há vagas associadas.');
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.GARAGE_LANE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: garageLane,
          reason: 'Faixa excluída',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        await this.garageLaneRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Faixa excluída com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir faixa:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao excluir faixa. Por favor, tente novamente.');
    }
  }

  /**
   * Criar múltiplas faixas
   */
  async batchCreate(
    data: GarageLaneBatchCreateFormData,
    include?: GarageLaneInclude,
    userId?: string,
  ): Promise<GarageLaneBatchCreateResponse<GarageLaneCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: GarageLane[] = [];
        const failedCreations: any[] = [];

        // Processar cada faixa individualmente para validação detalhada
        for (let index = 0; index < data.garageLanes.length; index++) {
          const garageLaneData = data.garageLanes[index];
          try {
            // Validar entidade completa
            await this.garageLaneValidation(garageLaneData, undefined, tx);

            // Criar a faixa
            const newGarageLane = await this.garageLaneRepository.createWithTransaction(
              tx,
              garageLaneData,
              { include },
            );
            successfulCreations.push(newGarageLane);

            // Registrar no changelog
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.GARAGE_LANE,
              entityId: newGarageLane.id,
              action: CHANGE_ACTION.CREATE,
              entity: newGarageLane,
              reason: 'Faixa criada em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || '',
              transaction: tx,
            });
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar faixa.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: garageLaneData,
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
          ? '1 faixa criada com sucesso'
          : `${result.totalCreated} faixas criadas com sucesso`;
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
        'Erro ao criar faixas em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplas faixas
   */
  async batchUpdate(
    data: GarageLaneBatchUpdateFormData,
    include?: GarageLaneInclude,
    userId?: string,
  ): Promise<GarageLaneBatchUpdateResponse<GarageLaneUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: GarageLane[] = [];
        const failedUpdates: any[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.garageLanes.length; index++) {
          const { id, data: updateData } = data.garageLanes[index];
          try {
            // Buscar faixa existente
            const existingGarageLane = await this.garageLaneRepository.findByIdWithTransaction(
              tx,
              id,
            );
            if (!existingGarageLane) {
              throw new NotFoundException('Faixa não encontrada.');
            }

            // Validar entidade completa
            await this.garageLaneValidation(updateData, id, tx);

            // Atualizar a faixa
            const updatedGarageLane = await this.garageLaneRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedGarageLane);

            // Track field-level changes
            const fieldsToTrack = ['width', 'length', 'xPosition', 'yPosition', 'garageId'];

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.GARAGE_LANE,
              entityId: id,
              oldEntity: existingGarageLane,
              newEntity: updatedGarageLane,
              fieldsToTrack,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar faixa.',
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
          ? '1 faixa atualizada com sucesso'
          : `${result.totalUpdated} faixas atualizadas com sucesso`;
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
        'Erro ao atualizar faixas em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete garage lanes
   */
  async batchDelete(
    data: GarageLaneBatchDeleteFormData,
    userId?: string,
  ): Promise<GarageLaneBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar faixas antes de excluir para o changelog
        const garageLanes = await this.garageLaneRepository.findByIdsWithTransaction(
          tx,
          data.garageLaneIds,
        );

        // Verificar se há vagas associadas a alguma faixa
        const lanesWithSpots = await tx.parkingSpot.groupBy({
          by: ['garageLaneId'],
          where: {
            garageLaneId: { in: data.garageLaneIds },
          },
          _count: true,
        });

        if (lanesWithSpots.length > 0) {
          throw new BadRequestException(
            'Não é possível excluir faixas que possuem vagas associadas.',
          );
        }

        // Registrar exclusões
        for (const garageLane of garageLanes) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.GARAGE_LANE,
            entityId: garageLane.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: garageLane,
            reason: 'Faixa excluída em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || '',
            transaction: tx,
          });
        }

        return this.garageLaneRepository.deleteManyWithTransaction(tx, data.garageLaneIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 faixa excluída com sucesso'
          : `${result.totalDeleted} faixas excluídas com sucesso`;
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
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro interno do servidor na exclusão em lote. Tente novamente.',
      );
    }
  }
}
