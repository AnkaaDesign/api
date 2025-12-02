import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  EconomicActivity,
  EconomicActivityGetUniqueResponse,
  EconomicActivityGetManyResponse,
  EconomicActivityCreateResponse,
  EconomicActivityUpdateResponse,
  EconomicActivityDeleteResponse,
  EconomicActivityBatchCreateResponse,
  EconomicActivityBatchUpdateResponse,
  EconomicActivityBatchDeleteResponse,
} from '../../../types';
import {
  EconomicActivityCreateFormData,
  EconomicActivityUpdateFormData,
  EconomicActivityGetManyFormData,
  EconomicActivityGetByIdFormData,
  EconomicActivityBatchCreateFormData,
  EconomicActivityBatchUpdateFormData,
  EconomicActivityBatchDeleteFormData,
  EconomicActivityInclude,
} from '../../../schemas/economic-activity';

@Injectable()
export class EconomicActivityService {
  private readonly logger = new Logger(EconomicActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find many economic activities
   */
  async findMany(query: EconomicActivityGetManyFormData): Promise<EconomicActivityGetManyResponse> {
    const { where, orderBy, include, skip, take } = query;

    const [data, total] = await Promise.all([
      this.prisma.economicActivity.findMany({
        where,
        orderBy,
        include,
        skip,
        take,
      }),
      this.prisma.economicActivity.count({ where }),
    ]);

    return {
      success: true,
      message: 'Atividades econômicas recuperadas com sucesso',
      data,
      meta: {
        totalRecords: total,
        page: skip && take ? Math.floor(skip / take) + 1 : 1,
        take: take || total,
        totalPages: take ? Math.ceil(total / take) : 1,
        hasNextPage: skip && take ? skip + take < total : false,
        hasPreviousPage: skip ? skip > 0 : false,
      },
    };
  }

  /**
   * Find one economic activity by ID
   */
  async findOne(
    id: string,
    query?: EconomicActivityGetByIdFormData,
  ): Promise<EconomicActivityGetUniqueResponse> {
    const economicActivity = await this.prisma.economicActivity.findUnique({
      where: { id },
      include: query?.include,
    });

    if (!economicActivity) {
      throw new NotFoundException('Atividade econômica não encontrada');
    }

    return {
      success: true,
      message: 'Atividade econômica recuperada com sucesso',
      data: economicActivity,
    };
  }

  /**
   * Create a new economic activity
   */
  async create(
    data: EconomicActivityCreateFormData,
    include?: EconomicActivityInclude,
  ): Promise<EconomicActivityCreateResponse> {
    // Check if code already exists
    const existing = await this.prisma.economicActivity.findUnique({
      where: { code: data.code },
      include,
    });

    if (existing) {
      // Return existing record instead of throwing error (idempotent)
      return {
        success: true,
        message: 'Atividade econômica já existe',
        data: existing,
      };
    }

    const economicActivity = await this.prisma.economicActivity.create({
      data: {
        code: data.code,
        description: data.description,
      },
      include,
    });

    return {
      success: true,
      message: 'Atividade econômica criada com sucesso',
      data: economicActivity,
    };
  }

  /**
   * Update an economic activity
   */
  async update(
    id: string,
    data: EconomicActivityUpdateFormData,
    include?: EconomicActivityInclude,
  ): Promise<EconomicActivityUpdateResponse> {
    // Check if exists
    const existing = await this.prisma.economicActivity.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Atividade econômica não encontrada');
    }

    // Check if code is being changed and if it's already in use
    if (data.code && data.code !== existing.code) {
      const codeInUse = await this.prisma.economicActivity.findUnique({
        where: { code: data.code },
      });

      if (codeInUse) {
        throw new BadRequestException('Código CNAE já está em uso');
      }
    }

    const economicActivity = await this.prisma.economicActivity.update({
      where: { id },
      data,
      include,
    });

    return {
      success: true,
      message: 'Atividade econômica atualizada com sucesso',
      data: economicActivity,
    };
  }

  /**
   * Delete an economic activity
   */
  async delete(id: string): Promise<EconomicActivityDeleteResponse> {
    // Check if exists
    const existing = await this.prisma.economicActivity.findUnique({
      where: { id },
      include: { customers: true },
    });

    if (!existing) {
      throw new NotFoundException('Atividade econômica não encontrada');
    }

    // Check if has customers
    if (existing.customers && existing.customers.length > 0) {
      throw new BadRequestException(
        'Não é possível excluir uma atividade econômica com clientes vinculados',
      );
    }

    await this.prisma.economicActivity.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Atividade econômica excluída com sucesso',
    };
  }

  /**
   * Batch create economic activities
   */
  async batchCreate(
    data: EconomicActivityBatchCreateFormData,
    include?: EconomicActivityInclude,
  ): Promise<EconomicActivityBatchCreateResponse<EconomicActivityCreateFormData>> {
    const success: EconomicActivity[] = [];
    const failed: Array<{
      index: number;
      id?: string;
      error: string;
      errorCode?: string;
      data: EconomicActivityCreateFormData;
    }> = [];

    for (let i = 0; i < data.economicActivities.length; i++) {
      try {
        const response = await this.create(data.economicActivities[i], include);
        if (response.data) {
          success.push(response.data);
        }
      } catch (error) {
        failed.push({
          index: i,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
          data: data.economicActivities[i],
        });
      }
    }

    return {
      success: failed.length === 0,
      message: `${success.length} atividade(s) criada(s)${failed.length > 0 ? `, ${failed.length} falharam` : ''}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }

  /**
   * Batch update economic activities
   */
  async batchUpdate(
    data: EconomicActivityBatchUpdateFormData,
    include?: EconomicActivityInclude,
  ): Promise<EconomicActivityBatchUpdateResponse<EconomicActivityUpdateFormData & { id: string }>> {
    const success: EconomicActivity[] = [];
    const failed: Array<{
      index: number;
      id: string;
      error: string;
      errorCode?: string;
      data: EconomicActivityUpdateFormData & { id: string };
    }> = [];

    for (let i = 0; i < data.economicActivities.length; i++) {
      const item = data.economicActivities[i];
      try {
        const response = await this.update(item.id, item.data, include);
        if (response.data) {
          success.push(response.data);
        }
      } catch (error) {
        failed.push({
          index: i,
          id: item.id,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
          data: { ...item.data, id: item.id },
        });
      }
    }

    return {
      success: failed.length === 0,
      message: `${success.length} atividade(s) atualizada(s)${failed.length > 0 ? `, ${failed.length} falharam` : ''}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }

  /**
   * Batch delete economic activities
   */
  async batchDelete(
    data: EconomicActivityBatchDeleteFormData,
  ): Promise<EconomicActivityBatchDeleteResponse> {
    const success: Array<{ id: string; deleted: boolean }> = [];
    const failed: Array<{
      index: number;
      id: string;
      error: string;
      errorCode?: string;
      data: { id: string };
    }> = [];

    for (let i = 0; i < data.economicActivityIds.length; i++) {
      const id = data.economicActivityIds[i];
      try {
        await this.delete(id);
        success.push({ id, deleted: true });
      } catch (error) {
        failed.push({
          index: i,
          id,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
          data: { id },
        });
      }
    }

    return {
      success: failed.length === 0,
      message: `${success.length} atividade(s) excluída(s)${failed.length > 0 ? `, ${failed.length} falharam` : ''}`,
      data: {
        success,
        failed,
        totalProcessed: success.length + failed.length,
        totalSuccess: success.length,
        totalFailed: failed.length,
      },
    };
  }
}
