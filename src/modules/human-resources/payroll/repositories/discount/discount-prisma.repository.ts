import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { DiscountRepository } from './discount.repository';
import type { PrismaTransaction } from '@modules/common/base/base.repository';
import type {
  DiscountCreateFormData,
  DiscountUpdateFormData,
} from '../../../../../schemas/discount';
import type { Discount } from '../../../../../types';

@Injectable()
export class DiscountPrismaRepository extends DiscountRepository {
  private readonly logger = new Logger(DiscountPrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(data: DiscountCreateFormData, tx?: PrismaTransaction): Promise<Discount> {
    const client = tx || this.prisma;

    try {
      const discount = await client.payrollDiscount.create({
        data: {
          percentage: data.percentage,
          value: data.value,
          reference: data.reference,
          payrollId: data.payrollId,
        },
      });

      return this.mapToEntity(discount);
    } catch (error) {
      this.logger.error(`Erro ao criar desconto: ${error.message}`, error.stack);
      throw error;
    }
  }

  async update(
    id: string,
    data: DiscountUpdateFormData,
    tx?: PrismaTransaction,
  ): Promise<Discount> {
    const client = tx || this.prisma;

    try {
      const discount = await client.payrollDiscount.update({
        where: { id },
        data: {
          ...(data.percentage !== undefined && { percentage: data.percentage }),
          ...(data.value !== undefined && { value: data.value }),
          ...(data.reference !== undefined && { reference: data.reference }),
        },
      });

      return this.mapToEntity(discount);
    } catch (error) {
      this.logger.error(`Erro ao atualizar desconto ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findById(id: string): Promise<Discount | null> {
    try {
      const discount = await this.prisma.payrollDiscount.findUnique({
        where: { id },
      });

      return discount ? this.mapToEntity(discount) : null;
    } catch (error) {
      this.logger.error(`Erro ao buscar desconto ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findMany(options: any): Promise<any> {
    try {
      const {
        where,
        orderBy = [{ createdAt: 'asc' }],
        skip = 0,
        take = 20,
      } = options || {};

      const [total, data] = await Promise.all([
        this.prisma.payrollDiscount.count({ where }),
        this.prisma.payrollDiscount.findMany({
          where,
          orderBy,
          skip,
          take,
        }),
      ]);

      const page = Math.floor(skip / take) + 1;
      const totalPages = Math.ceil(total / take);

      return {
        data: data.map(item => this.mapToEntity(item)),
        meta: {
          totalRecords: total,
          page,
          take,
          totalPages,
          hasNextPage: skip + take < total,
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar descontos: ${error.message}`, error.stack);
      throw error;
    }
  }

  async delete(id: string, tx?: PrismaTransaction): Promise<void> {
    const client = tx || this.prisma;

    try {
      await client.payrollDiscount.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Erro ao deletar desconto ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findByPayroll(payrollId: string): Promise<Discount[]> {
    try {
      const discounts = await this.prisma.payrollDiscount.findMany({
        where: { payrollId },
        orderBy: { createdAt: 'asc' },
      });

      return discounts.map(discount => this.mapToEntity(discount));
    } catch (error) {
      this.logger.error(
        `Erro ao buscar descontos por folha ${payrollId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async deleteMany(ids: string[], tx?: PrismaTransaction): Promise<void> {
    const client = tx || this.prisma;

    try {
      await client.payrollDiscount.deleteMany({
        where: { id: { in: ids } },
      });
    } catch (error) {
      this.logger.error(`Erro ao deletar descontos: ${error.message}`, error.stack);
      throw error;
    }
  }

  async count(where?: any): Promise<number> {
    try {
      return await this.prisma.payrollDiscount.count({ where });
    } catch (error) {
      this.logger.error(`Erro ao contar descontos: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createMany(data: DiscountCreateFormData[], tx?: PrismaTransaction): Promise<Discount[]> {
    const client = tx || this.prisma;

    try {
      const results: Discount[] = [];

      for (const discount of data) {
        const result = await this.create(discount, client);
        results.push(result);
      }

      return results;
    } catch (error) {
      this.logger.error(`Erro ao criar descontos em lote: ${error.message}`, error.stack);
      throw error;
    }
  }

  private mapToEntity(databaseEntity: any): Discount {
    return {
      ...databaseEntity,
      percentage: databaseEntity.percentage ? Number(databaseEntity.percentage) : null,
      value: databaseEntity.value ? Number(databaseEntity.value) : null,
    } as Discount;
  }
}
