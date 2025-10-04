// sector.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { SectorRepository, PrismaTransaction } from './repositories/sector.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_TRIGGERED_BY,
  SECTOR_PRIVILEGES,
  ENTITY_TYPE,
  CHANGE_ACTION,
} from '../../../constants/enums';
import type {
  SectorBatchCreateResponse,
  SectorBatchDeleteResponse,
  SectorBatchUpdateResponse,
  SectorCreateResponse,
  SectorDeleteResponse,
  SectorGetManyResponse,
  SectorGetUniqueResponse,
  SectorUpdateResponse,
} from '../../../types';
import { Meta, UpdateData } from '../../../types';
import type {
  SectorCreateFormData,
  SectorUpdateFormData,
  SectorGetManyFormData,
  SectorBatchCreateFormData,
  SectorBatchUpdateFormData,
  SectorBatchDeleteFormData,
  SectorInclude,
} from '../../../schemas/sector';

@Injectable()
export class SectorService {
  private readonly logger = new Logger(SectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sectorRepository: SectorRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar setor completo
   */
  private async validateSector(
    data: Partial<SectorCreateFormData | SectorUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar nome único
    if (data.name) {
      const existingWithName = await transaction.sector.findFirst({
        where: {
          name: data.name,
          ...(existingId && { id: { not: existingId } }),
        },
      });

      if (existingWithName) {
        throw new BadRequestException('Nome do setor já está em uso.');
      }
    }

    // Validar privilégio se fornecido
    if ('privileges' in data && data.privileges) {
      // Validar que o privilégio é válido (já validado pelo schema)
      // Aqui podemos adicionar validações adicionais se necessário

      // Exemplo: verificar se o nível de privilégio está dentro dos limites
      const privilegeValues = Object.values(SECTOR_PRIVILEGES);
      if (!privilegeValues.includes(data.privileges as SECTOR_PRIVILEGES)) {
        throw new BadRequestException('Privilégio inválido.');
      }
    }
  }

  /**
   * Buscar muitos setores com filtros
   */
  async findMany(query: SectorGetManyFormData): Promise<SectorGetManyResponse> {
    try {
      const result = await this.sectorRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Setores carregados com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar setores:', error);
      throw new InternalServerErrorException('Erro ao buscar setores. Por favor, tente novamente.');
    }
  }

  /**
   * Buscar um setor por ID
   */
  async findById(id: string, include?: SectorInclude): Promise<SectorGetUniqueResponse> {
    try {
      const sector = await this.sectorRepository.findById(id, { include });

      if (!sector) {
        throw new NotFoundException('Setor não encontrado.');
      }

      return { success: true, data: sector, message: 'Setor carregado com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar setor por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar setor. Por favor, tente novamente.');
    }
  }

  /**
   * Criar novo setor
   */
  async create(
    data: SectorCreateFormData,
    include?: SectorInclude,
    userId?: string,
  ): Promise<SectorCreateResponse> {
    try {
      const sector = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.validateSector(data, undefined, tx);

        // Criar o setor
        const newSector = await this.sectorRepository.createWithTransaction(tx, data, { include });

        // Registrar no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SECTOR,
          entityId: newSector.id,
          action: CHANGE_ACTION.CREATE,
          entity: newSector,
          reason: 'Novo setor criado no sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newSector;
      });

      return {
        success: true,
        message: 'Setor criado com sucesso.',
        data: sector,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar setor:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar setor. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar setor
   */
  async update(
    id: string,
    data: SectorUpdateFormData,
    include?: SectorInclude,
    userId?: string,
  ): Promise<SectorUpdateResponse> {
    try {
      const updatedSector = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar setor existente
        const existingSector = await this.sectorRepository.findByIdWithTransaction(tx, id);

        if (!existingSector) {
          throw new NotFoundException('Setor não encontrado.');
        }

        // Validar entidade completa
        await this.validateSector(data, id, tx);

        // Atualizar o setor
        const updatedSector = await this.sectorRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Registrar mudanças no changelog com rastreamento de campos
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SECTOR,
          entityId: id,
          oldEntity: existingSector,
          newEntity: updatedSector,
          fieldsToTrack: ['name', 'privileges'], // Rastrear apenas campos atualizáveis
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedSector;
      });

      return {
        success: true,
        message: 'Setor atualizado com sucesso.',
        data: updatedSector,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar setor:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar setor. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir setor
   */
  async delete(id: string, userId?: string): Promise<SectorDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const sector = await this.sectorRepository.findByIdWithTransaction(tx, id);

        if (!sector) {
          throw new NotFoundException('Setor não encontrado.');
        }

        // Verificar dependências com contagem de relacionamentos
        const [userCount, taskCount] = await Promise.all([
          tx.user.count({ where: { sectorId: id } }),
          tx.task.count({ where: { sectorId: id } }),
        ]);

        if (userCount > 0) {
          throw new BadRequestException(
            `Não é possível excluir setor que possui ${userCount} usuário(s) vinculado(s)`,
          );
        }

        if (taskCount > 0) {
          throw new BadRequestException(
            `Não é possível excluir setor que possui ${taskCount} tarefa(s) vinculada(s)`,
          );
        }

        // Registrar exclusão
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SECTOR,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: sector,
          reason: 'Setor excluído do sistema',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await this.sectorRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Setor excluído com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir setor:', error);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao excluir setor. Por favor, tente novamente.');
    }
  }

  /**
   * Criar múltiplos setores
   */
  async batchCreate(
    data: SectorBatchCreateFormData,
    include?: SectorInclude,
    userId?: string,
  ): Promise<SectorBatchCreateResponse<SectorCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar cada setor individualmente
        const validationErrors: Array<{
          index: number;
          data: SectorCreateFormData;
          error: string;
          errorCode: string;
        }> = [];

        for (let i = 0; i < data.sectors.length; i++) {
          try {
            await this.validateSector(data.sectors[i], undefined, tx);
          } catch (error: any) {
            validationErrors.push({
              index: i,
              data: data.sectors[i],
              error: error.message || 'Erro de validação.',
              errorCode: 'VALIDATION_ERROR',
            });
          }
        }

        // Se houver erros de validação, processar apenas os itens válidos
        const validSectors = data.sectors.filter(
          (_, index) => !validationErrors.some(error => error.index === index),
        );

        let result;
        if (validSectors.length > 0) {
          result = await this.sectorRepository.createManyWithTransaction(tx, validSectors, {
            include,
          });

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

        // Registrar criações bem-sucedidas
        for (const sector of result.success) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.SECTOR,
            entityId: sector.id,
            action: CHANGE_ACTION.CREATE,
            entity: sector,
            reason: 'Setor criado em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return result;
      });

      const successMessage =
        result.totalCreated === 1
          ? '1 setor criado com sucesso'
          : `${result.totalCreated} setores criados com sucesso`;
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
        message: `${successMessage}${failureMessage}.`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na criação em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar setores em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplos setores
   */
  async batchUpdate(
    data: SectorBatchUpdateFormData,
    include?: SectorInclude,
    userId?: string,
  ): Promise<SectorBatchUpdateResponse<SectorUpdateFormData>> {
    try {
      const updates: UpdateData<SectorUpdateFormData>[] = data.sectors.map(sector => ({
        id: sector.id,
        data: sector.data,
      }));

      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar restrições de unicidade para cada atualização
        const validationErrors: Array<{
          index: number;
          id: string;
          data: SectorUpdateFormData;
          error: string;
          errorCode: string;
        }> = [];

        // Buscar setores existentes para validação
        const existingSectors = await this.sectorRepository.findByIdsWithTransaction(
          tx,
          updates.map(u => u.id),
        );

        for (let i = 0; i < updates.length; i++) {
          const update = updates[i];
          const existingSector = existingSectors.find(s => s.id === update.id);

          if (!existingSector) {
            validationErrors.push({
              index: i,
              id: update.id,
              data: update.data,
              error: 'Setor não encontrado.',
              errorCode: 'NOT_FOUND',
            });
            continue;
          }

          // Validar entidade completa
          try {
            await this.validateSector(update.data, update.id, tx);
          } catch (error: any) {
            validationErrors.push({
              index: i,
              id: update.id,
              data: update.data,
              error: error.message || 'Erro de validação.',
              errorCode: 'VALIDATION_ERROR',
            });
          }
        }

        // Se houver erros de validação, processar apenas os itens válidos
        const validUpdates = updates.filter(
          (_, index) => !validationErrors.some(error => error.index === index),
        );

        let result;
        if (validUpdates.length > 0) {
          result = await this.sectorRepository.updateManyWithTransaction(tx, validUpdates, {
            include,
          });

          // Adicionar os erros de validação aos resultados
          if (validationErrors.length > 0) {
            result.failed.push(...validationErrors);
            result.totalFailed += validationErrors.length;
          }
        } else {
          // Se todos falharam na validação
          result = {
            success: [],
            failed: validationErrors,
            totalUpdated: 0,
            totalFailed: validationErrors.length,
          };
        }

        // Registrar atualizações bem-sucedidas com rastreamento de campos
        for (const sector of result.success) {
          // Encontrar o setor original para comparação
          const originalSector = existingSectors.find(s => s.id === sector.id);
          if (originalSector) {
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SECTOR,
              entityId: sector.id,
              oldEntity: originalSector,
              newEntity: sector,
              fieldsToTrack: ['name', 'privileges'],
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          }
        }

        return result;
      });

      const successMessage =
        result.totalUpdated === 1
          ? '1 setor atualizado com sucesso'
          : `${result.totalUpdated} setores atualizados com sucesso`;
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
        message: `${successMessage}${failureMessage}.`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na atualização em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar setores em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir múltiplos setores
   */
  async batchDelete(
    data: SectorBatchDeleteFormData,
    userId?: string,
  ): Promise<SectorBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar setores antes de excluir para o changelog
        const sectors = await this.sectorRepository.findByIdsWithTransaction(tx, data.sectorIds);

        // Verificar dependências de forma otimizada
        const dependencyChecks = await Promise.all(
          data.sectorIds.map(async id => {
            const [userCount, taskCount] = await Promise.all([
              tx.user.count({ where: { sectorId: id } }),
              tx.task.count({ where: { sectorId: id } }),
            ]);
            return { id, userCount, taskCount };
          }),
        );

        const sectorsWithDependencies = dependencyChecks.filter(
          check => check.userCount > 0 || check.taskCount > 0,
        );

        if (sectorsWithDependencies.length > 0) {
          const errorMessages = sectorsWithDependencies.map(check => {
            const sector = sectors.find(s => s.id === check.id);
            const deps: string[] = [];
            if (check.userCount > 0) deps.push(`${check.userCount} usuário(s)`);
            if (check.taskCount > 0) deps.push(`${check.taskCount} tarefa(s)`);
            return `${sector?.name || check.id}: ${deps.join(', ')}`;
          });
          throw new BadRequestException(
            `Não é possível excluir setores com dependências:\n${errorMessages.join('\n')}`,
          );
        }

        // Registrar exclusões
        for (const sector of sectors) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.SECTOR,
            entityId: sector.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: sector,
            reason: 'Setor excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || null,
            transaction: tx,
          });
        }

        return this.sectorRepository.deleteManyWithTransaction(tx, data.sectorIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 setor excluído com sucesso'
          : `${result.totalDeleted} setores excluídos com sucesso`;
      const failureMessage = result.totalFailed > 0 ? `, ${result.totalFailed} falharam` : '';

      // Convert BatchDeleteResult to BatchOperationResult format
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
        message: `${successMessage}${failureMessage}.`,
        data: batchOperationResult,
      };
    } catch (error: any) {
      this.logger.error('Erro na exclusão em lote:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir setores em lote. Por favor, tente novamente.',
      );
    }
  }
}
