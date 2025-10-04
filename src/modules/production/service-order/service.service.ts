import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ServiceRepository } from './repositories/service/service.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  trackFieldChanges,
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { CHANGE_TRIGGERED_BY, ENTITY_TYPE, CHANGE_ACTION } from '../../../constants/enums';
import type {
  ServiceBatchCreateResponse,
  ServiceBatchDeleteResponse,
  ServiceBatchUpdateResponse,
  ServiceCreateResponse,
  ServiceDeleteResponse,
  ServiceGetManyResponse,
  ServiceGetUniqueResponse,
  ServiceUpdateResponse,
} from '../../../types';
import { Service } from '../../../types';
import type {
  ServiceCreateFormData,
  ServiceUpdateFormData,
  ServiceGetManyFormData,
  ServiceBatchCreateFormData,
  ServiceBatchUpdateFormData,
  ServiceBatchDeleteFormData,
  ServiceInclude,
} from '../../../schemas/service';

@Injectable()
export class ServiceService {
  private readonly logger = new Logger(ServiceService.name);

  // Define fields to track for service changes
  // Define fields to track for service changes
  private readonly SERVICE_FIELDS_TO_TRACK = ['name', 'description', 'price', 'status'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceRepository: ServiceRepository,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar entidade completa
   */
  private async serviceValidation(
    data: Partial<ServiceCreateFormData | ServiceUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    // Validar descrição única
    if (data.description) {
      const existingDescription = await transaction.service.findFirst({
        where: {
          description: data.description,
          ...(existingId && { NOT: { id: existingId } }),
        },
      });
      if (existingDescription) {
        throw new BadRequestException('Descrição do serviço já está em uso.');
      }
    }
  }

  /**
   * Buscar muitos serviços com filtros
   */
  async findMany(query: ServiceGetManyFormData): Promise<ServiceGetManyResponse> {
    try {
      const result = await this.serviceRepository.findMany(query);

      return {
        success: true,
        data: result.data,
        meta: result.meta,
        message: 'Serviços carregados com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar serviços:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar serviços. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um serviço por ID
   */
  async findById(id: string, include?: ServiceInclude): Promise<ServiceGetUniqueResponse> {
    try {
      const service = await this.serviceRepository.findById(id, { include });

      if (!service) {
        throw new NotFoundException('Serviço não encontrado.');
      }

      return { success: true, data: service, message: 'Serviço carregado com sucesso.' };
    } catch (error: any) {
      this.logger.error('Erro ao buscar serviço por ID:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao buscar serviço. Por favor, tente novamente.');
    }
  }

  /**
   * Criar novo serviço
   */
  async create(
    data: ServiceCreateFormData,
    include?: ServiceInclude,
    userId?: string,
  ): Promise<ServiceCreateResponse> {
    try {
      const service = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Validar entidade completa
        await this.serviceValidation(data, undefined, tx);

        // Criar o serviço
        const newService = await this.serviceRepository.createWithTransaction(tx, data, {
          include,
        });

        // Registrar criação no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE,
          entityId: newService.id,
          action: CHANGE_ACTION.CREATE,
          entity: newService,
          reason: 'Novo serviço criado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        return newService;
      });

      return {
        success: true,
        message: 'Serviço criado com sucesso.',
        data: service,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar serviço:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao criar serviço. Por favor, tente novamente.');
    }
  }

  /**
   * Atualizar serviço
   */
  async update(
    id: string,
    data: ServiceUpdateFormData,
    include?: ServiceInclude,
    userId?: string,
  ): Promise<ServiceUpdateResponse> {
    try {
      const updatedService = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar serviço existente
        const existingService = await this.serviceRepository.findByIdWithTransaction(tx, id);

        if (!existingService) {
          throw new NotFoundException('Serviço não encontrado.');
        }

        // Validar entidade completa
        await this.serviceValidation(data, id, tx);

        // Atualizar o serviço
        const updatedService = await this.serviceRepository.updateWithTransaction(tx, id, data, {
          include,
        });

        // Registrar mudanças individuais de campos no changelog
        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE,
          entityId: id,
          oldEntity: existingService,
          newEntity: updatedService,
          fieldsToTrack: this.SERVICE_FIELDS_TO_TRACK,
          userId: userId || '',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updatedService;
      });

      return {
        success: true,
        message: 'Serviço atualizado com sucesso.',
        data: updatedService,
      };
    } catch (error: any) {
      this.logger.error('Erro ao atualizar serviço:', error);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao atualizar serviço. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Excluir serviço
   */
  async delete(id: string, userId?: string): Promise<ServiceDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const service = await this.serviceRepository.findByIdWithTransaction(tx, id);

        if (!service) {
          throw new NotFoundException('Serviço não encontrado.');
        }

        // Registrar exclusão no changelog
        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SERVICE,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: service,
          reason: 'Serviço excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || '',
          transaction: tx,
        });

        await this.serviceRepository.deleteWithTransaction(tx, id);
      });

      return {
        success: true,
        message: 'Serviço excluído com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao excluir serviço:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Erro ao excluir serviço. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Criar múltiplos serviços
   */
  async batchCreate(
    data: ServiceBatchCreateFormData,
    include?: ServiceInclude,
    userId?: string,
  ): Promise<ServiceBatchCreateResponse<ServiceCreateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulCreations: Service[] = [];
        const failedCreations: any[] = [];

        // Processar cada serviço individualmente para validação detalhada
        for (let index = 0; index < data.services.length; index++) {
          const serviceData = data.services[index];
          try {
            // Validar entidade completa
            await this.serviceValidation(serviceData, undefined, tx);

            // Criar o serviço
            const newService = await this.serviceRepository.createWithTransaction(tx, serviceData, {
              include,
            });
            successfulCreations.push(newService);

            // Registrar criação no changelog
            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE,
              entityId: newService.id,
              action: CHANGE_ACTION.CREATE,
              entity: newService,
              reason: 'Serviço criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || '',
              transaction: tx,
            });
          } catch (error: any) {
            failedCreations.push({
              index,
              error: error.message || 'Erro ao criar serviço.',
              errorCode: error.name || 'UNKNOWN_ERROR',
              data: serviceData,
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
          ? '1 serviço criado com sucesso'
          : `${result.totalCreated} serviços criados com sucesso`;
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
        'Erro ao criar serviços em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar múltiplos serviços
   */
  async batchUpdate(
    data: ServiceBatchUpdateFormData,
    include?: ServiceInclude,
    userId?: string,
  ): Promise<ServiceBatchUpdateResponse<ServiceUpdateFormData>> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const successfulUpdates: Service[] = [];
        const failedUpdates: any[] = [];

        // Processar cada atualização individualmente para validação detalhada
        for (let index = 0; index < data.services.length; index++) {
          const { id, data: updateData } = data.services[index];
          try {
            // Buscar serviço existente
            const existingService = await this.serviceRepository.findByIdWithTransaction(tx, id);
            if (!existingService) {
              throw new NotFoundException('Serviço não encontrado.');
            }

            // Validar entidade completa
            await this.serviceValidation(updateData, id, tx);

            // Atualizar o serviço
            const updatedService = await this.serviceRepository.updateWithTransaction(
              tx,
              id,
              updateData,
              { include },
            );
            successfulUpdates.push(updatedService);

            // Registrar mudanças individuais de campos no changelog
            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.SERVICE,
              entityId: id,
              oldEntity: existingService,
              newEntity: updatedService,
              fieldsToTrack: this.SERVICE_FIELDS_TO_TRACK,
              userId: userId || '',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });
          } catch (error: any) {
            failedUpdates.push({
              index,
              id,
              error: error.message || 'Erro ao atualizar serviço.',
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
          ? '1 serviço atualizado com sucesso'
          : `${result.totalUpdated} serviços atualizados com sucesso`;
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
        'Erro ao atualizar serviços em lote. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Batch delete services
   */
  async batchDelete(
    data: ServiceBatchDeleteFormData,
    userId?: string,
  ): Promise<ServiceBatchDeleteResponse> {
    try {
      const result = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        // Buscar serviços antes de excluir para o changelog
        const services = await this.serviceRepository.findByIdsWithTransaction(tx, data.serviceIds);

        // Registrar exclusões no changelog
        for (const service of services) {
          await logEntityChange({
            changeLogService: this.changeLogService,
            entityType: ENTITY_TYPE.SERVICE,
            entityId: service.id,
            action: CHANGE_ACTION.DELETE,
            oldEntity: service,
            reason: 'Serviço excluído em lote',
            triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
            userId: userId || '',
            transaction: tx,
          });
        }

        return this.serviceRepository.deleteManyWithTransaction(tx, data.serviceIds);
      });

      const successMessage =
        result.totalDeleted === 1
          ? '1 serviço excluído com sucesso'
          : `${result.totalDeleted} serviços excluídos com sucesso`;
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
