// salary-adjustment.service.ts
// Reajustes salariais (Departamento Pessoal) — unified history of salary adjustments.
// The apply flow reuses the MonetaryValue current-flag pattern from position.service.ts.

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
import { logEntityChange } from '@modules/common/changelog/utils/changelog-helpers';
import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ENTITY_TYPE,
  SALARY_ADJUSTMENT_TYPE,
} from '../../../constants/enums';
import { SALARY_ADJUSTMENT_TYPE_LABELS } from '../../../constants';
import type {
  SalaryAdjustment,
  SalaryAdjustmentApplyResponse,
  SalaryAdjustmentApplyResult,
  SalaryAdjustmentApplyResultItem,
  SalaryAdjustmentDeleteResponse,
  SalaryAdjustmentGetManyResponse,
  SalaryAdjustmentGetUniqueResponse,
  SalaryAdjustmentUpdateResponse,
} from '../../../types';
import type {
  SalaryAdjustmentApplyFormData,
  SalaryAdjustmentGetManyFormData,
  SalaryAdjustmentInclude,
  SalaryAdjustmentUpdateFormData,
} from '../../../schemas';

const DEFAULT_INCLUDE = {
  appliedBy: { include: { position: true, sector: true } },
  items: { include: { position: true } },
} as const;

export interface SalaryAdjustmentApplyCoreResult {
  adjustment: SalaryAdjustment | null;
  results: SalaryAdjustmentApplyResultItem[];
  totalSuccess: number;
  totalFailed: number;
  /** How many of the requested positions actually exist (for legacy responses). */
  foundCount: number;
}

@Injectable()
export class SalaryAdjustmentService {
  private readonly logger = new Logger(SalaryAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Buscar muitos reajustes salariais com filtros
   */
  async findMany(query: SalaryAdjustmentGetManyFormData): Promise<SalaryAdjustmentGetManyResponse> {
    try {
      const page = query.page && query.page > 0 ? query.page : 1;
      const take = query.limit ?? 20;
      const skip = (page - 1) * take;

      const where = (query.where as any) || {};
      const orderBy = (query.orderBy as any) || { effectiveDate: 'desc' };
      const include = (query.include as any) || DEFAULT_INCLUDE;

      const [totalRecords, data] = await Promise.all([
        this.prisma.salaryAdjustment.count({ where }),
        this.prisma.salaryAdjustment.findMany({
          where,
          orderBy,
          include,
          skip,
          take,
        }),
      ]);

      const totalPages = Math.ceil(totalRecords / take) || 1;

      return {
        success: true,
        message: 'Reajustes salariais carregados com sucesso.',
        data: data as unknown as SalaryAdjustment[],
        meta: {
          totalRecords,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error: unknown) {
      this.logger.error('Erro ao buscar reajustes salariais:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar reajustes salariais. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Buscar um reajuste salarial por ID
   */
  async findById(
    id: string,
    include?: SalaryAdjustmentInclude,
  ): Promise<SalaryAdjustmentGetUniqueResponse> {
    try {
      const adjustment = await this.prisma.salaryAdjustment.findUnique({
        where: { id },
        include: (include as any) || DEFAULT_INCLUDE,
      });

      if (!adjustment) {
        throw new NotFoundException('Reajuste salarial não encontrado.');
      }

      return {
        success: true,
        message: 'Reajuste salarial carregado com sucesso.',
        data: adjustment as unknown as SalaryAdjustment,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao buscar reajuste salarial por ID:', error);
      throw new InternalServerErrorException(
        'Erro ao buscar reajuste salarial. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Núcleo do reajuste — usado pelo endpoint POST /salary-adjustments/apply e
   * pelo POST /positions/batch-adjust-salaries (via PositionService), para que
   * todos os reajustes apareçam no histórico unificado.
   *
   * Em UMA transação: lê o MonetaryValue atual de cada cargo, calcula o novo
   * valor (percentual ou personalizado), troca as flags `current` e cria o novo
   * MonetaryValue (padrão exato de batchAdjustSalaries), cria SalaryAdjustment +
   * SalaryAdjustmentItem e registra changelogs de POSITION e SALARY_ADJUSTMENT.
   * Cargos sem remuneração atual são pulados e reportados.
   */
  async applyCore(
    data: SalaryAdjustmentApplyFormData,
    userId?: string,
    triggeredBy: CHANGE_TRIGGERED_BY = CHANGE_TRIGGERED_BY.USER_ACTION,
  ): Promise<SalaryAdjustmentApplyCoreResult> {
    const percentage = data.percentage ?? null;

    if (percentage !== null && (percentage < -100 || percentage > 1000)) {
      throw new BadRequestException('Percentual deve estar entre -100% e 1000%');
    }

    if (percentage === null && (!data.customValues || data.customValues.length === 0)) {
      throw new BadRequestException(
        'Informe um percentual ou valores personalizados por cargo.',
      );
    }

    const positionIds = [...new Set(data.positionIds)];
    const customMap = new Map<string, number>(
      (data.customValues || []).map(cv => [cv.positionId, cv.newValue]),
    );

    const positions = await this.prisma.position.findMany({
      where: { id: { in: positionIds } },
      include: {
        remunerations: {
          where: { current: true },
          orderBy: { createdAt: 'desc' as const },
          take: 1,
        },
      },
    });
    const positionMap = new Map(positions.map(p => [p.id, p]));

    const results: SalaryAdjustmentApplyResultItem[] = [];

    // Posições inexistentes — reportar sem abortar o lote
    for (const positionId of positionIds) {
      if (!positionMap.has(positionId)) {
        results.push({
          positionId,
          positionName: positionId,
          success: false,
          error: 'Cargo não encontrado',
        });
      }
    }

    if (positions.length === 0) {
      return {
        adjustment: null,
        results,
        totalSuccess: 0,
        totalFailed: results.length,
        foundCount: 0,
      };
    }

    const adjustment = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
      const items: Array<{ positionId: string; previousValue: number; newValue: number }> = [];

      for (const positionId of positionIds) {
        const position = positionMap.get(positionId);
        if (!position) continue;

        try {
          const currentSalary = position.remunerations?.[0]?.value ?? 0;

          if (currentSalary === 0) {
            // Espelha batchAdjustSalaries: pula e reporta cargos sem remuneração atual
            results.push({
              positionId: position.id,
              positionName: position.name,
              success: false,
              error: 'Cargo não possui remuneração definida',
            });
            continue;
          }

          let newValue: number;
          if (percentage !== null) {
            newValue = currentSalary + currentSalary * (percentage / 100);
          } else {
            const customValue = customMap.get(position.id);
            if (customValue === undefined) {
              results.push({
                positionId: position.id,
                positionName: position.name,
                success: false,
                error: 'Valor personalizado não informado para o cargo',
              });
              continue;
            }
            newValue = customValue;
          }

          if (newValue < 0) {
            results.push({
              positionId: position.id,
              positionName: position.name,
              success: false,
              error: 'Remuneração não pode ser negativa',
            });
            continue;
          }

          // Padrão MonetaryValue current-flag (position.service.ts batchAdjustSalaries)
          await tx.monetaryValue.updateMany({
            where: { positionId: position.id, current: true },
            data: { current: false },
          });

          await tx.monetaryValue.create({
            data: {
              positionId: position.id,
              value: newValue,
              current: true,
            },
          });

          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.POSITION,
            entityId: position.id,
            action: CHANGE_ACTION.UPDATE,
            field: 'remuneration',
            oldValue: currentSalary.toFixed(2),
            newValue: newValue.toFixed(2),
            reason:
              percentage !== null
                ? `Reajuste de ${percentage}%`
                : `Reajuste salarial (${SALARY_ADJUSTMENT_TYPE_LABELS[(data.type as SALARY_ADJUSTMENT_TYPE) || SALARY_ADJUSTMENT_TYPE.OTHER]}) com valor personalizado`,
            triggeredBy,
            triggeredById: position.id,
            userId: userId || null,
            transaction: tx,
          });

          items.push({
            positionId: position.id,
            previousValue: currentSalary,
            newValue,
          });

          results.push({
            positionId: position.id,
            positionName: position.name,
            success: true,
            previousValue: currentSalary,
            newValue,
            adjustment: newValue - currentSalary,
            percentageApplied: percentage,
          });
        } catch (error: any) {
          this.logger.error(`Erro ao reajustar cargo ${position.id}:`, error);
          results.push({
            positionId: position.id,
            positionName: position.name,
            success: false,
            error: error.message || 'Erro ao reajustar remuneração',
          });
        }
      }

      if (items.length === 0) {
        return null;
      }

      const created = await tx.salaryAdjustment.create({
        data: {
          type: (data.type as any) || SALARY_ADJUSTMENT_TYPE.OTHER,
          percentage,
          effectiveDate: data.effectiveDate || new Date(),
          note: data.note ?? null,
          appliedById: userId || null,
          items: { create: items },
        },
        include: DEFAULT_INCLUDE as any,
      });

      await logEntityChange({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.SALARY_ADJUSTMENT,
        entityId: created.id,
        action: CHANGE_ACTION.CREATE,
        entity: created,
        reason:
          percentage !== null
            ? `Reajuste de ${percentage}% aplicado a ${items.length} cargo(s)`
            : `Reajuste salarial com valores personalizados aplicado a ${items.length} cargo(s)`,
        triggeredBy,
        userId: userId || null,
        transaction: tx,
      });

      return created;
    });

    const totalSuccess = results.filter(r => r.success).length;
    const totalFailed = results.length - totalSuccess;

    return {
      adjustment: adjustment as unknown as SalaryAdjustment | null,
      results,
      totalSuccess,
      totalFailed,
      foundCount: positions.length,
    };
  }

  /**
   * Aplicar reajuste salarial — POST /salary-adjustments/apply
   */
  async apply(
    data: SalaryAdjustmentApplyFormData,
    userId?: string,
  ): Promise<SalaryAdjustmentApplyResponse> {
    try {
      const core = await this.applyCore(data, userId);

      if (core.foundCount === 0) {
        return {
          success: false,
          message: 'Nenhum cargo encontrado para ajuste',
          data: {
            salaryAdjustment: null,
            totalSuccess: 0,
            totalFailed: core.totalFailed,
            results: core.results,
          },
        };
      }

      const successMessage =
        core.totalSuccess === 1
          ? '1 cargo reajustado com sucesso'
          : `${core.totalSuccess} cargos reajustados com sucesso`;
      const failureMessage = core.totalFailed > 0 ? `, ${core.totalFailed} falharam` : '';

      const result: SalaryAdjustmentApplyResult = {
        salaryAdjustment: core.adjustment,
        totalSuccess: core.totalSuccess,
        totalFailed: core.totalFailed,
        results: core.results,
      };

      return {
        success: core.totalSuccess > 0,
        message: `${successMessage}${failureMessage}.`,
        data: result,
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Erro ao aplicar reajuste salarial:', error);
      throw new InternalServerErrorException(
        'Erro ao aplicar reajuste salarial. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Atualizar reajuste salarial (apenas a observação — os efeitos monetários são
   * histórico imutável)
   */
  async update(
    id: string,
    data: SalaryAdjustmentUpdateFormData,
    include?: SalaryAdjustmentInclude,
    userId?: string,
  ): Promise<SalaryAdjustmentUpdateResponse> {
    try {
      const updated = await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.salaryAdjustment.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Reajuste salarial não encontrado.');
        }

        const updated = await tx.salaryAdjustment.update({
          where: { id },
          data: { note: data.note ?? null },
          include: (include as any) || DEFAULT_INCLUDE,
        });

        if (existing.note !== (data.note ?? null)) {
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.SALARY_ADJUSTMENT,
            entityId: id,
            action: CHANGE_ACTION.UPDATE,
            field: 'note',
            oldValue: existing.note,
            newValue: data.note ?? null,
            reason: 'Observação do reajuste atualizada',
            triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
            triggeredById: id,
            userId: userId || null,
            transaction: tx,
          });
        }

        return updated;
      });

      return {
        success: true,
        message: 'Reajuste salarial atualizado com sucesso.',
        data: updated as unknown as SalaryAdjustment,
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao atualizar reajuste salarial:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar reajuste salarial. Por favor, tente novamente.',
      );
    }
  }

  /**
   * Deletar reajuste salarial (remove apenas o registro do histórico — NÃO
   * reverte as remunerações aplicadas)
   */
  async delete(id: string, userId?: string): Promise<SalaryAdjustmentDeleteResponse> {
    try {
      await this.prisma.$transaction(async (tx: PrismaTransaction) => {
        const existing = await tx.salaryAdjustment.findUnique({
          where: { id },
          include: { items: true },
        });

        if (!existing) {
          throw new NotFoundException('Reajuste salarial não encontrado.');
        }

        await tx.salaryAdjustment.delete({ where: { id } });

        await logEntityChange({
          changeLogService: this.changeLogService,
          entityType: ENTITY_TYPE.SALARY_ADJUSTMENT,
          entityId: id,
          action: CHANGE_ACTION.DELETE,
          oldEntity: existing,
          reason: 'Reajuste salarial excluído do histórico',
          triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
          userId: userId || null,
          transaction: tx,
        });
      });

      return {
        success: true,
        message: 'Reajuste salarial deletado com sucesso.',
      };
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Erro ao deletar reajuste salarial:', error);
      throw new InternalServerErrorException(
        'Erro ao deletar reajuste salarial. Por favor, tente novamente.',
      );
    }
  }
}
