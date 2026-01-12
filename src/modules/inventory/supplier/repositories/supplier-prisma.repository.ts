// repositories/supplier-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Supplier } from '../../../../types';
import {
  SupplierCreateFormData,
  SupplierUpdateFormData,
  SupplierInclude,
  SupplierOrderBy,
  SupplierWhere,
} from '../../../../schemas/supplier';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { SupplierRepository } from './supplier.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';

@Injectable()
export class SupplierPrismaRepository
  extends BaseStringPrismaRepository<
    Supplier,
    SupplierCreateFormData,
    SupplierUpdateFormData,
    SupplierInclude,
    SupplierOrderBy,
    SupplierWhere,
    Prisma.SupplierGetPayload<{ include: any }>,
    Prisma.SupplierCreateInput,
    Prisma.SupplierUpdateInput,
    Prisma.SupplierInclude,
    Prisma.SupplierOrderByWithRelationInput,
    Prisma.SupplierWhereInput
  >
  implements SupplierRepository
{
  protected readonly logger = new Logger(SupplierPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Supplier {
    return {
      id: databaseEntity.id,
      fantasyName: databaseEntity.fantasyName,
      cnpj: databaseEntity.cnpj,
      corporateName: databaseEntity.corporateName,
      email: databaseEntity.email,
      streetType: databaseEntity.streetType,
      address: databaseEntity.address,
      addressNumber: databaseEntity.addressNumber,
      addressComplement: databaseEntity.addressComplement,
      neighborhood: databaseEntity.neighborhood,
      city: databaseEntity.city,
      state: databaseEntity.state,
      zipCode: databaseEntity.zipCode,
      site: databaseEntity.site,
      phones: databaseEntity.phones || [],
      pix: databaseEntity.pix,
      tags: databaseEntity.tags || [],
      logoId: databaseEntity.logoId,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      // Relations
      logo: databaseEntity.logo,
      items: databaseEntity.items,
      orders: databaseEntity.orders,
      orderRules: databaseEntity.orderRules,
      // Count aggregations
      _count: databaseEntity._count,
    };
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: SupplierCreateFormData,
  ): Prisma.SupplierCreateInput {
    const { logoId, ...rest } = formData;

    // Validate required fields
    if (!formData.fantasyName) {
      throw new Error('Fantasy name is required for creating a supplier');
    }

    const createInput: Prisma.SupplierCreateInput = {
      ...rest,
      fantasyName: formData.fantasyName!, // Ensure fantasyName is provided (validated above)
      phones: formData.phones || [],
    };

    if (logoId) {
      createInput.logo = { connect: { id: logoId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: SupplierUpdateFormData,
  ): Prisma.SupplierUpdateInput {
    const { logoId, ...rest } = formData;

    const updateInput: Prisma.SupplierUpdateInput = {
      ...rest,
    };

    if (logoId !== undefined) {
      updateInput.logo = logoId ? { connect: { id: logoId } } : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: SupplierInclude,
  ): Prisma.SupplierInclude | undefined {
    if (!include) return undefined;

    // Handle _count specially as it's a Prisma feature
    const { _count, ...rest } = include as any;

    const prismaInclude: any = { ...rest };

    // If _count is requested, add it to the Prisma include
    if (_count) {
      prismaInclude._count = _count;
    }

    return prismaInclude as Prisma.SupplierInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: SupplierOrderBy,
  ): Prisma.SupplierOrderByWithRelationInput | undefined {
    return orderBy as Prisma.SupplierOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(where?: SupplierWhere): Prisma.SupplierWhereInput | undefined {
    return where as Prisma.SupplierWhereInput;
  }

  protected getDefaultInclude(): Prisma.SupplierInclude {
    return {
      logo: true,
      // Don't load items by default, use _count instead for better performance
      orders: {
        take: 5,
        orderBy: { createdAt: 'desc' },
      },
      _count: {
        select: {
          items: true,
          orders: true,
          orderRules: true,
        },
      },
    } as any;
  }

  // =====================
  // Override required transaction methods from base class
  // =====================

  async createWithTransaction(
    transaction: PrismaTransaction,
    data: SupplierCreateFormData,
    options?: CreateOptions<SupplierInclude>,
  ): Promise<Supplier> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.supplier.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar fornecedor', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<SupplierInclude>,
  ): Promise<Supplier | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.supplier.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar fornecedor por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<SupplierInclude>,
  ): Promise<Supplier[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.supplier.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar fornecedores por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<SupplierOrderBy, SupplierWhere, SupplierInclude>,
  ): Promise<FindManyResult<Supplier>> {
    // Map 'limit' to 'take' for compatibility with schema

    const optionsWithTake = options
      ? { ...options, take: (options as any).limit || options.take }
      : {};

    const {
      where,
      orderBy,
      page = 1,
      take = 20,
      include,
    } = optionsWithTake as {
      where?: SupplierWhere;
      orderBy?: SupplierOrderBy;
      page?: number;
      take?: number;
      include?: SupplierInclude;
    };
    const skip = Math.max(0, (page - 1) * take);

    const [total, suppliers] = await Promise.all([
      transaction.supplier.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.supplier.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || [{ fantasyName: 'asc' }],
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: suppliers.map(supplier => this.mapDatabaseEntityToEntity(supplier)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: SupplierUpdateFormData,
    options?: UpdateOptions<SupplierInclude>,
  ): Promise<Supplier> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.supplier.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar fornecedor ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Supplier> {
    try {
      const result = await transaction.supplier.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar fornecedor ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: SupplierWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.supplier.count({ where: whereInput });
    } catch (error) {
      this.logError('contar fornecedores', error, { where });
      throw error;
    }
  }

  async findByCnpj(cnpj: string, tx?: PrismaTransaction): Promise<Supplier | null> {
    const transaction = tx || this.prisma;
    try {
      const result = await transaction.supplier.findFirst({
        where: { cnpj },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar fornecedor por CNPJ ${cnpj}`, error);
      throw error;
    }
  }

  async findByEmail(email: string, tx?: PrismaTransaction): Promise<Supplier | null> {
    const transaction = tx || this.prisma;
    try {
      const result = await transaction.supplier.findFirst({
        where: { email },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar fornecedor por email ${email}`, error);
      throw error;
    }
  }
}
