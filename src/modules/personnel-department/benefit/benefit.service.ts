// benefit.service.ts
// Benefícios (Departamento Pessoal) — catálogo de benefícios da empresa.

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
  Benefit,
  BenefitGetManyResponse,
  BenefitGetUniqueResponse,
  BenefitCreateResponse,
  BenefitUpdateResponse,
  BenefitDeleteResponse,
  BenefitBatchCreateResponse,
  BenefitBatchUpdateResponse,
  BenefitBatchDeleteResponse,
} from '../../../types';
import type {
  BenefitGetManyFormData,
  BenefitCreateFormData,
  BenefitUpdateFormData,
  BenefitBatchCreateFormData,
  BenefitBatchUpdateFormData,
  BenefitBatchDeleteFormData,
  BenefitInclude,
} from '../../../schemas';

const BENEFIT_TRACKED_FIELDS = [
  'kind',
  'name',
  'provider',
  'defaultValue',
  'defaultEmployeeDiscountPercent',
  'isActive',
  'notes',
];

@Injectable()
export class BenefitService {
  private readonly logger = new Logger(BenefitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Validar benefício (nome único)
   */
  private async benefitValidation(
    data: Partial<BenefitCreateFormData | BenefitUpdateFormData>,
    existingId?: string,
    tx?: PrismaTransaction,
  ): Promise<void> {
    const transaction = tx || this.prisma;

    if (data.name) {
      const existing = await transaction.benefit.findFirst({
        where: {
          name: data.name,
          ...(existingId ? { id: { not: existingId } } : {}),
        },
      });
      if (existing) {
        throw new BadRequestException('Já existe um benefício com este nome.');
      }
    }
  }

  async findMany(query: BenefitGetManyFormData): Promise<BenefitGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit && query.limit > 0 ? query.limit : 20;
      const skip = (page - 1) * take;
      const where = query.where || {};
      const orderBy = query.orderBy || { name: 'asc' };

      const [totalRecords, benefits] = await Promise.all([
        this.prisma.benefit.count({ where }),
        this.prisma.benefit.findMany({
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
        message: 'Benefícios carregados com sucesso.',
        data: benefits as unknown as Benefit[],
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
      this.logger.error('Erro ao buscar benefícios:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar benefícios. Por favor, tente novamente.',
      );
    }
  }

  async findById(id: string, include?: BenefitInclude): Promise<BenefitGetUniqueResponse> {
    try {
      const benefit = await this.prisma.benefit.findUnique({ where: { id }, include });

      if (!benefit) {
        throw new NotFoundException('Benefício não encontrado.');
      }

      return {
        success: true,
        message: 'Benefício carregado com sucesso.',
        data: benefit as unknown as Benefit,
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar benefício por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar benefício. Por favor, tente novamente.',
      );
    }
  }

  async create(
    data: BenefitCreateFormData,
    include?: BenefitInclude,
    userId?: string,
  ): Promise<BenefitCreateResponse> {
    try {
      const benefit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        await this.benefitValidation(data, undefined, tx);

        const newBenefit = await tx.benefit.create({ data: data as any, include });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BENEFIT,
          entityId: newBenefit.id,
          action: CHANGE_ACTION.CREATE,
          entity: newBenefit,
          reason: `Benefício criado: ${data.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        return newBenefit;
      });

      return {
        success: true,
        message: 'Benefício criado com sucesso.',
        data: benefit as unknown as Benefit,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao criar benefício:', error);
      throw new InternalServerErrorException('Erro ao criar benefício. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: BenefitUpdateFormData,
    include?: BenefitInclude,
    userId?: string,
  ): Promise<BenefitUpdateResponse> {
    try {
      const benefit = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.benefit.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Benefício não encontrado.');
        }

        await this.benefitValidation(data, id, tx);

        const updated = await tx.benefit.update({ where: { id }, data: data as any, include });

        await trackAndLogFieldChanges({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BENEFIT,
          entityId: id,
          oldEntity: existing,
          newEntity: updated,
          fieldsToTrack: BENEFIT_TRACKED_FIELDS,
          userId: userId || null,
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          transaction: tx,
        });

        return updated;
      });

      return {
        success: true,
        message: 'Benefício atualizado com sucesso.',
        data: benefit as unknown as Benefit,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar benefício:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar benefício. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string, userId?: string): Promise<BenefitDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const benefit = await tx.benefit.findUnique({
          where: { id },
          include: { enrollments: { select: { id: true } } },
        });

        if (!benefit) {
          throw new NotFoundException('Benefício não encontrado.');
        }

        if (benefit.enrollments.length > 0) {
          throw new BadRequestException(
            'Não é possível excluir um benefício com adesões vinculadas. Encerre as adesões primeiro.',
          );
        }

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.BENEFIT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: benefit,
          reason: 'Benefício excluído',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });

        await tx.benefit.delete({ where: { id } });
      });

      return {
        success: true,
        message: 'Benefício excluído com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao excluir benefício:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir benefício. Por favor, tente novamente.',
      );
    }
  }

  async batchCreate(
    data: BenefitBatchCreateFormData,
    include?: BenefitInclude,
    userId?: string,
  ): Promise<BenefitBatchCreateResponse<BenefitCreateFormData>> {
    try {
      const success: Benefit[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: BenefitCreateFormData;
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, benefitData] of data.benefits.entries()) {
          try {
            await this.benefitValidation(benefitData, undefined, tx);

            const newBenefit = await tx.benefit.create({ data: benefitData as any, include });

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.BENEFIT,
              entityId: newBenefit.id,
              action: CHANGE_ACTION.CREATE,
              entity: newBenefit,
              reason: 'Benefício criado em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
              userId: userId || null,
              transaction: tx,
            });

            success.push(newBenefit as unknown as Benefit);
          } catch (error: any) {
            failed.push({
              index,
              error: error?.message || 'Erro ao criar benefício.',
              data: benefitData,
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 benefício criado com sucesso'
          : `${success.length} benefícios criados com sucesso`;
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
      this.logger.error('Erro na criação de benefícios em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao criar benefícios em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchUpdate(
    data: BenefitBatchUpdateFormData,
    include?: BenefitInclude,
    userId?: string,
  ): Promise<BenefitBatchUpdateResponse<BenefitUpdateFormData>> {
    try {
      const success: Benefit[] = [];
      const failed: Array<{
        index: number;
        id?: string;
        error: string;
        data: BenefitUpdateFormData & { id: string };
      }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, update] of data.benefits.entries()) {
          try {
            const existing = await tx.benefit.findUnique({ where: { id: update.id } });
            if (!existing) {
              throw new NotFoundException('Benefício não encontrado.');
            }

            await this.benefitValidation(update.data, update.id, tx);

            const updated = await tx.benefit.update({
              where: { id: update.id },
              data: update.data as any,
              include,
            });

            await trackAndLogFieldChanges({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.BENEFIT,
              entityId: update.id,
              oldEntity: existing,
              newEntity: updated,
              fieldsToTrack: BENEFIT_TRACKED_FIELDS,
              userId: userId || null,
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_UPDATE,
              transaction: tx,
            });

            success.push(updated as unknown as Benefit);
          } catch (error: any) {
            failed.push({
              index,
              id: update.id,
              error: error?.message || 'Erro ao atualizar benefício.',
              data: { ...update.data, id: update.id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 benefício atualizado com sucesso'
          : `${success.length} benefícios atualizados com sucesso`;
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
      this.logger.error('Erro na atualização de benefícios em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar benefícios em lote. Por favor, tente novamente.',
      );
    }
  }

  async batchDelete(
    data: BenefitBatchDeleteFormData,
    userId?: string,
  ): Promise<BenefitBatchDeleteResponse> {
    try {
      const success: Array<{ id: string; deleted: boolean }> = [];
      const failed: Array<{ index: number; id?: string; error: string; data: { id: string } }> = [];

      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        for (const [index, id] of data.benefitIds.entries()) {
          try {
            const benefit = await tx.benefit.findUnique({
              where: { id },
              include: { enrollments: { select: { id: true } } },
            });

            if (!benefit) {
              throw new NotFoundException('Benefício não encontrado.');
            }

            if (benefit.enrollments.length > 0) {
              throw new BadRequestException(
                'Não é possível excluir um benefício com adesões vinculadas.',
              );
            }

            await logEntityChange({
              changeLogService: this.changeLogService,
              entityType: ENTITY_TYPE.BENEFIT,
              entityId: id,
              action: CHANGE_ACTION.DELETE,
              oldEntity: benefit,
              reason: 'Benefício excluído em lote',
              triggeredBy: CHANGE_TRIGGERED_BY.BATCH_DELETE,
              userId: userId || null,
              transaction: tx,
            });

            await tx.benefit.delete({ where: { id } });
            success.push({ id, deleted: true });
          } catch (error: any) {
            failed.push({
              index,
              id,
              error: error?.message || 'Erro ao excluir benefício.',
              data: { id },
            });
          }
        }
      });

      const successMessage =
        success.length === 1
          ? '1 benefício excluído com sucesso'
          : `${success.length} benefícios excluídos com sucesso`;
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
      this.logger.error('Erro na exclusão de benefícios em lote:', error);
      throw new InternalServerErrorException(
        'Erro ao excluir benefícios em lote. Por favor, tente novamente.',
      );
    }
  }
}
