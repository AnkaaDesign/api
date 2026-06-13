// dependent.service.ts
// Dependentes do colaborador (dedução IRRF / salário-família).
// Regras: CPF (quando informado) é único por colaborador; o cálculo de IRRF da
// folha usa count(Dependent where irrfDeduction=true) quando há dependentes
// cadastrados, com fallback para User.dependentsCount (transição).

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  trackAndLogFieldChanges,
  logEntityChange,
} from '@modules/common/changelog/utils/changelog-helpers';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../constants';
import type {
  Dependent,
  DependentGetManyResponse,
  DependentGetUniqueResponse,
  DependentCreateResponse,
  DependentUpdateResponse,
  DependentDeleteResponse,
  DependentBatchCreateResponse,
  DependentBatchUpdateResponse,
  DependentBatchDeleteResponse,
} from '../../../types';
import type {
  DependentGetManyFormData,
  DependentCreateFormData,
  DependentUpdateFormData,
  DependentBatchCreateFormData,
  DependentBatchUpdateFormData,
  DependentBatchDeleteFormData,
  DependentInclude,
} from '../../../schemas';

const DEPENDENT_TRACKED_FIELDS = [
  'userId',
  'name',
  'cpf',
  'birthDate',
  'relationship',
  'irrfDeduction',
  'salarioFamilia',
  'notes',
];

@Injectable()
export class DependentService {
  private readonly logger = new Logger(DependentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  private async dependentValidation(
    data: Partial<DependentCreateFormData | DependentUpdateFormData>,
    tx?: PrismaTransaction,
    existingId?: string,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.userId) {
      const user = await transaction.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        throw new NotFoundException('Colaborador não encontrado.');
      }
    }

    if (data.birthDate && data.birthDate > new Date()) {
      throw new BadRequestException('A data de nascimento não pode estar no futuro.');
    }

    // CPF único por colaborador (quando informado)
    if (data.cpf) {
      let userId = data.userId;
      if (!userId && existingId) {
        const existing = await transaction.dependent.findUnique({ where: { id: existingId } });
        userId = existing?.userId;
      }
      if (userId) {
        const duplicate = await transaction.dependent.findFirst({
          where: {
            userId,
            cpf: data.cpf,
            ...(existingId ? { id: { not: existingId } } : {}),
          },
        });
        if (duplicate) {
          throw new BadRequestException(
            'Já existe um dependente com este CPF para o colaborador.',
          );
        }
      }
    }
  }

  async findMany(query: DependentGetManyFormData): Promise<DependentGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || { createdAt: 'desc' };

      const [totalRecords, dependents] = await Promise.all([
        this.prisma.dependent.count({ where }),
        this.prisma.dependent.findMany({
          where,
          orderBy,
          include: query.include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.max(Math.ceil(totalRecords / take), 1);

      return {
        success: true,
        message: 'Dependentes carregados com sucesso.',
        data: dependents as unknown as Dependent[],
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar dependentes:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar dependentes. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: DependentInclude): Promise<DependentGetUniqueResponse> {
    try {
      const dependent = await this.prisma.dependent.findUnique({ where: { id }, include });

      if (!dependent) {
        throw new NotFoundException('Dependente não encontrado.');
      }

      return {
        success: true,
        message: 'Dependente carregado com sucesso.',
        data: dependent as unknown as Dependent,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar dependente por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar dependente. Por favor, tente novamente.',
      );
    }
  }

  async create(
    data: DependentCreateFormData,
    include?: DependentInclude,
    userId?: string,
  ): Promise<DependentCreateResponse> {
    try {
      const dependent = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.dependentValidation(data, tx);

        const newDependent = await tx.dependent.create({
          data: data as any,
          include,
        });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.DEPENDENT,
          entityId: newDependent.id,
          action: CHANGE_ACTION.CREATE,
          entity: newDependent,
          reason: 'Dependente cadastrado',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newDependent;
      });

      return {
        success: true,
        message: 'Dependente criado com sucesso.',
        data: dependent as unknown as Dependent,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar dependente:', error);
      throw new InternalServerErrorException(
        'Erro ao criar dependente. Por favor, tente novamente.',
      );
    }
  }

  async update(
    id: string,
    data: DependentUpdateFormData,
    include?: DependentInclude,
    userId?: string,
  ): Promise<DependentUpdateResponse> {
    try {
      const dependent = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.dependent.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Dependente não encontrado.');
        }

        await this.dependentValidation(data, tx, id);

        const updated = await tx.dependent.update({
          where: { id },
          data: data as any,
          include,
        });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.DEPENDENT,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: DEPENDENT_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Dependente atualizado com sucesso.',
        data: dependent as unknown as Dependent,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar dependente:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar dependente. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<DependentDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const dependent = await tx.dependent.findUnique({ where: { id } });

        if (!dependent) {
          throw new NotFoundException('Dependente não encontrado.');
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.DEPENDENT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: dependent,
          reason: 'Dependente excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.dependent.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Dependente excluído com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir dependente:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir dependente. Por favor, tente novamente.',
      );
    }
  }

  async batchCreate(
    data: DependentBatchCreateFormData,
    include?: DependentInclude,
    userId?: string,
  ): Promise<DependentBatchCreateResponse<DependentCreateFormData>> {
    try {
      const success: Dependent[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: DependentCreateFormData;
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, itemData] of data.dependents.entries()) {
          try {
            await this.dependentValidation(itemData, tx);

            const created = await tx.dependent.create({
              data: itemData as any,
              include,
            });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.DEPENDENT,
              entityId: created.id,
              action: CHANGE_ACTION.CREATE,
              entity: created,
              reason: 'Dependente cadastrado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            success.push(created as unknown as Dependent);
          } catch (error: any) {
            failed.push({
              index,
              error: error?.message || 'Erro ao criar dependente.',
              data: itemData,
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 dependente criado com sucesso'
          : `${success.length} dependentes criados com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na criação de dependentes em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar dependentes em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: DependentBatchUpdateFormData,
    include?: DependentInclude,
    userId?: string,
  ): Promise<DependentBatchUpdateResponse<DependentUpdateFormData>> {
    try {
      const success: Dependent[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: DependentUpdateFormData & { id: string };
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, update] of data.dependents.entries()) {
          try {
            const existing = await tx.dependent.findUnique({ where: { id: update.id } });
            if (!existing) {
              throw new NotFoundException('Dependente não encontrado.');
            }

            await this.dependentValidation(update.data, tx, update.id);

            const updated = await tx.dependent.update({
              where: { id: update.id },
              data: update.data as any,
              include,
            });

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.DEPENDENT,
              entityId: update.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: DEPENDENT_TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            success.push(updated as unknown as Dependent);
          } catch (error: any) {
            failed.push({
              index,
              id: update.id,
              error: error?.message || 'Erro ao atualizar dependente.',
              data: { ...update.data, id: update.id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 dependente atualizado com sucesso'
          : `${success.length} dependentes atualizados com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na atualização de dependentes em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar dependentes em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: DependentBatchDeleteFormData,
    userId?: string,
  ): Promise<DependentBatchDeleteResponse> {
    try {
      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.dependentIds.entries()) {
          try {
            const dependent = await tx.dependent.findUnique({ where: { id } });

            if (!dependent) {
              throw new NotFoundException('Dependente não encontrado.');
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.DEPENDENT,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: dependent,
              reason: 'Dependente excluído em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });

            await tx.dependent.delete({ where: { id } });
            success.push({ id, deleted: true });
          } catch (error: any) {
            failed.push({
              index,
              id,
              error: error?.message || 'Erro ao excluir dependente.',
              data: { id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 dependente excluído com sucesso'
          : `${success.length} dependentes excluídos com sucesso`;
      const failureMessage = failed.length > 0 ? `, ${failed.length} falharam` : '';

      return {
        success: true,
        message: `${successMessage}${failureMessage}`,
        data: {
          success,
          failed,
          totalProcessed: success.length + failed.length,
          totalSuccess: success.length,
          totalFailed: failed.length,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro na exclusão de dependentes em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir dependentes em lote. Por favor, tente novamente.',
      );
    }
  }
}
