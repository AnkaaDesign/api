import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, GoalMetric } from '@prisma/client';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import type {
  Goal,
  GoalCreateResponse,
  GoalDeleteResponse,
  GoalGetManyResponse,
  GoalGetUniqueResponse,
  GoalUpdateResponse,
  GoalUpsertYearResponse,
} from '../../../types';
import type {
  GoalCreateFormData,
  GoalDeleteRowFormData,
  GoalGetManyFormData,
  GoalInclude,
  GoalUpdateFormData,
  GoalUpsertYearFormData,
} from '../../../schemas/goal';
import { SECTOR_SCOPED_GOAL_METRICS } from '../../../constants/enums';

type GoalRow = Prisma.GoalGetPayload<{ include: { sector: true } }>;

@Injectable()
export class GoalService {
  private readonly logger = new Logger(GoalService.name);

  constructor(private readonly prisma: PrismaService) {}

  private mapInclude(include?: GoalInclude): Prisma.GoalInclude | undefined {
    if (!include) return undefined;
    const mapped: Prisma.GoalInclude = {};
    if (include.sector !== undefined) {
      mapped.sector = include.sector as any;
    }
    return mapped;
  }

  private toEntity(row: GoalRow): Goal {
    return {
      ...row,
      targetValue: row.targetValue ? Number(row.targetValue) : 0,
    } as unknown as Goal;
  }

  private validateMetricSectorPair(metric: GoalMetric | string, sectorId?: string | null) {
    const requiresSector = (SECTOR_SCOPED_GOAL_METRICS as readonly string[]).includes(metric as string);
    if (requiresSector && !sectorId) {
      throw new BadRequestException('Setor é obrigatório para esta métrica.');
    }
    if (!requiresSector && sectorId) {
      throw new BadRequestException('Esta métrica não é por setor.');
    }
  }

  async findMany(query: GoalGetManyFormData): Promise<GoalGetManyResponse> {
    try {
      const { where, orderBy, include, page = 1, limit = 100, skip } = query as any;
      const take = limit;
      const offset = skip ?? Math.max(0, (page - 1) * take);

      const [total, rows] = await Promise.all([
        this.prisma.goal.count({ where }),
        this.prisma.goal.findMany({
          where,
          orderBy: orderBy ?? [{ year: 'asc' }, { month: 'asc' }, { metric: 'asc' }],
          skip: offset,
          take,
          include: this.mapInclude(include),
        }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / take));

      return {
        success: true,
        data: rows.map(r => this.toEntity(r as GoalRow)),
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        message: 'Metas carregadas com sucesso.',
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar metas:', error);
      throw new InternalServerErrorException('Erro ao buscar metas. Por favor, tente novamente.');
    }
  }

  async findById(id: string, include?: GoalInclude): Promise<GoalGetUniqueResponse> {
    try {
      const row = await this.prisma.goal.findUnique({
        where: { id },
        include: this.mapInclude(include),
      });
      if (!row) {
        throw new NotFoundException('Meta não encontrada.');
      }
      return {
        success: true,
        data: this.toEntity(row as GoalRow),
        message: 'Meta carregada com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao buscar meta:', error);
      throw new InternalServerErrorException('Erro ao buscar meta. Por favor, tente novamente.');
    }
  }

  async create(data: GoalCreateFormData, include?: GoalInclude): Promise<GoalCreateResponse> {
    this.validateMetricSectorPair(data.metric, data.sectorId ?? null);
    try {
      const row = await this.prisma.goal.create({
        data: {
          metric: data.metric as GoalMetric,
          year: data.year,
          month: data.month,
          targetValue: new Prisma.Decimal(data.targetValue),
          sectorId: data.sectorId ?? null,
        },
        include: this.mapInclude(include),
      });
      return {
        success: true,
        data: this.toEntity(row as GoalRow),
        message: 'Meta criada com sucesso.',
      };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          'Já existe uma meta para esta combinação de métrica, ano, mês e setor.',
        );
      }
      this.logger.error('Erro ao criar meta:', error);
      throw new InternalServerErrorException('Erro ao criar meta. Por favor, tente novamente.');
    }
  }

  async update(
    id: string,
    data: GoalUpdateFormData,
    include?: GoalInclude,
  ): Promise<GoalUpdateResponse> {
    try {
      const existing = await this.prisma.goal.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Meta não encontrada.');
      }
      const row = await this.prisma.goal.update({
        where: { id },
        data: {
          ...(data.targetValue !== undefined && {
            targetValue: new Prisma.Decimal(data.targetValue),
          }),
        },
        include: this.mapInclude(include),
      });
      return {
        success: true,
        data: this.toEntity(row as GoalRow),
        message: 'Meta atualizada com sucesso.',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar meta:', error);
      throw new InternalServerErrorException(
        'Erro ao atualizar meta. Por favor, tente novamente.',
      );
    }
  }

  async delete(id: string): Promise<GoalDeleteResponse> {
    try {
      const existing = await this.prisma.goal.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Meta não encontrada.');
      }
      await this.prisma.goal.delete({ where: { id } });
      return { success: true, message: 'Meta excluída com sucesso.' };
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao excluir meta:', error);
      throw new InternalServerErrorException('Erro ao excluir meta. Por favor, tente novamente.');
    }
  }

  /**
   * Upsert every month of a single (metric, year, sectorId) row in one
   * transaction. `targetValue === null` means "remove the goal for that month".
   */
  async upsertYear(data: GoalUpsertYearFormData): Promise<GoalUpsertYearResponse> {
    this.validateMetricSectorPair(data.metric, data.sectorId ?? null);
    try {
      const result = await this.prisma.$transaction(async tx => {
        const existing = await tx.goal.findMany({
          where: {
            metric: data.metric as GoalMetric,
            year: data.year,
            sectorId: data.sectorId ?? null,
          },
        });

        const existingByMonth = new Map(existing.map(g => [g.month, g]));
        const created: GoalRow[] = [];
        const updated: GoalRow[] = [];
        const deleted: string[] = [];

        for (const value of data.values) {
          const prior = existingByMonth.get(value.month);

          if (value.targetValue === null || value.targetValue === undefined) {
            if (prior) {
              await tx.goal.delete({ where: { id: prior.id } });
              deleted.push(prior.id);
            }
            continue;
          }

          if (prior) {
            const row = await tx.goal.update({
              where: { id: prior.id },
              data: { targetValue: new Prisma.Decimal(value.targetValue) },
            });
            updated.push(row as GoalRow);
          } else {
            const row = await tx.goal.create({
              data: {
                metric: data.metric as GoalMetric,
                year: data.year,
                month: value.month,
                targetValue: new Prisma.Decimal(value.targetValue),
                sectorId: data.sectorId ?? null,
              },
            });
            created.push(row as GoalRow);
          }
        }

        return { created, updated, deleted };
      });

      return {
        success: true,
        message: 'Metas salvas com sucesso.',
        data: {
          created: result.created.map(r => this.toEntity(r)),
          updated: result.updated.map(r => this.toEntity(r)),
          deleted: result.deleted,
        },
      };
    } catch (error: any) {
      this.logger.error('Erro ao salvar metas do ano:', error);
      throw new InternalServerErrorException('Erro ao salvar metas. Por favor, tente novamente.');
    }
  }

  async deleteRow(data: GoalDeleteRowFormData): Promise<GoalDeleteResponse> {
    try {
      const result = await this.prisma.goal.deleteMany({
        where: {
          metric: data.metric as GoalMetric,
          year: data.year,
          sectorId: data.sectorId ?? null,
        },
      });
      return {
        success: true,
        message:
          result.count === 0
            ? 'Nenhuma meta encontrada para remover.'
            : `${result.count} meta(s) removida(s).`,
      };
    } catch (error: any) {
      this.logger.error('Erro ao remover linha de metas:', error);
      throw new InternalServerErrorException('Erro ao remover metas. Por favor, tente novamente.');
    }
  }
}
