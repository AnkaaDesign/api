// repositories/customer-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Customer } from '@types';
import {
  CustomerCreateFormData,
  CustomerUpdateFormData,
  CustomerInclude,
  CustomerOrderBy,
  CustomerWhere,
} from '@schemas/customer';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '@types';
import { CustomerRepository } from './customer.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import {
  CustomerDatabaseEntity,
  ProcessedEntity,
  DatabaseQueryOptions,
} from '../../../../common/types/database.types';

@Injectable()
export class CustomerPrismaRepository
  extends BaseStringPrismaRepository<
    Customer,
    CustomerCreateFormData,
    CustomerUpdateFormData,
    CustomerInclude,
    CustomerOrderBy,
    CustomerWhere,
    Prisma.CustomerGetPayload<{ include: any }>,
    Prisma.CustomerCreateInput,
    Prisma.CustomerUpdateInput,
    Prisma.CustomerInclude,
    Prisma.CustomerOrderByWithRelationInput,
    Prisma.CustomerWhereInput
  >
  implements CustomerRepository
{
  protected readonly logger = new Logger(CustomerPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: CustomerDatabaseEntity): Customer {
    // Use base class utility to handle special properties like _count
    const processedEntity = this.handleSpecialProperties(databaseEntity);

    // Ensure arrays are properly handled using base class utility
    const entityWithArrays = this.mapArrayProperties(processedEntity as any, ['phones', 'tags']);

    // Create the final customer entity
    const customer: Customer = {
      ...entityWithArrays,
      phones: entityWithArrays.phones ?? [],
      tags: entityWithArrays.tags ?? [],
    };

    // Preserve _count if it exists (for queries that include counts)
    if ('_count' in processedEntity && processedEntity._count) {
      (customer as Customer & { _count?: Record<string, number> })._count =
        processedEntity._count as Record<string, number>;
    }

    return customer;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: CustomerCreateFormData,
  ): Prisma.CustomerCreateInput {
    const { logoId, ...rest } = formData;

    const createInput: Prisma.CustomerCreateInput = {
      ...rest,
      fantasyName: formData.fantasyName || 'Unnamed Customer', // Ensure name is provided
      phones: formData.phones || [],
      tags: formData.tags || [],
    };

    if (logoId) {
      createInput.logo = { connect: { id: logoId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: CustomerUpdateFormData,
  ): Prisma.CustomerUpdateInput {
    const { logoId, ...rest } = formData;

    const updateInput: Prisma.CustomerUpdateInput = {
      ...rest,
    };

    // Handle array fields explicitly to ensure they're properly set
    if (formData.phones !== undefined) {
      updateInput.phones = formData.phones || [];
    }

    if (formData.tags !== undefined) {
      updateInput.tags = formData.tags || [];
    }

    if (logoId !== undefined) {
      updateInput.logo = logoId ? { connect: { id: logoId } } : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: CustomerInclude,
  ): Prisma.CustomerInclude | undefined {
    // Use base class utility for handling nested includes with _count
    return this.mapIncludeWithNestedHandling(include, undefined) as
      | Prisma.CustomerInclude
      | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: CustomerOrderBy,
  ): Prisma.CustomerOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;

    // If orderBy is already an array, return it as is
    if (Array.isArray(orderBy)) {
      return orderBy as Prisma.CustomerOrderByWithRelationInput;
    }

    // Convert object to array format to support multiple orderBy fields
    // Prisma supports: [{ field1: 'asc' }, { field2: 'desc' }]
    const orderByArray: any[] = [];
    Object.entries(orderBy).forEach(([key, value]) => {
      if (value !== undefined) {
        orderByArray.push({ [key]: value });
      }
    });

    return orderByArray.length > 0
      ? (orderByArray as Prisma.CustomerOrderByWithRelationInput)
      : undefined;
  }

  protected mapWhereToDatabaseWhere(where?: CustomerWhere): Prisma.CustomerWhereInput | undefined {
    return where as Prisma.CustomerWhereInput;
  }

  protected getDefaultInclude(): Prisma.CustomerInclude {
    return {
      logo: {
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimetype: true,
          path: true,
          size: true,
          thumbnailUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      tasks: {
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          tasks: true,
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: CustomerCreateFormData,
    options?: CreateOptions<CustomerInclude>,
  ): Promise<Customer> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        options?.include !== undefined
          ? this.mapIncludeToDatabaseInclude(options.include)
          : this.getDefaultInclude();

      const result = await transaction.customer.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result as any);
    } catch (error) {
      this.logError('criar cliente', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<CustomerInclude>,
  ): Promise<Customer | null> {
    try {
      const includeInput =
        options?.include !== undefined
          ? this.mapIncludeToDatabaseInclude(options.include)
          : this.getDefaultInclude();

      const result = await transaction.customer.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result as any) : null;
    } catch (error) {
      this.logError(`buscar cliente por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<CustomerInclude>,
  ): Promise<Customer[]> {
    try {
      const includeInput =
        options?.include !== undefined
          ? this.mapIncludeToDatabaseInclude(options.include)
          : this.getDefaultInclude();

      const results = await transaction.customer.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result =>
        this.mapDatabaseEntityToEntity(result as unknown as CustomerDatabaseEntity),
      );
    } catch (error) {
      this.logError('buscar clientes por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<CustomerOrderBy, CustomerWhere, CustomerInclude>,
  ): Promise<FindManyResult<Customer>> {
    // Map 'limit' to 'take' for compatibility with schema
    const optionsWithTake = options
      ? { ...options, take: (options as DatabaseQueryOptions).limit || options.take }
      : {};
    const {
      where,
      orderBy,
      page = 1,
      take = 20,
      include,
    } = optionsWithTake as {
      where?: CustomerWhere;
      orderBy?: CustomerOrderBy;
      page?: number;
      take?: number;
      include?: CustomerInclude;
    };
    const skip = Math.max(0, (page - 1) * take);

    const [total, customers] = await Promise.all([
      transaction.customer.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.customer.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { fantasyName: 'asc' },
        skip,
        take,
        include:
          include !== undefined
            ? this.mapIncludeToDatabaseInclude(include)
            : this.getDefaultInclude(),
      }),
    ]);

    return {
      data: customers.map(customer =>
        this.mapDatabaseEntityToEntity(customer as unknown as CustomerDatabaseEntity),
      ),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: CustomerUpdateFormData,
    options?: UpdateOptions<CustomerInclude>,
  ): Promise<Customer> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        options?.include !== undefined
          ? this.mapIncludeToDatabaseInclude(options.include)
          : this.getDefaultInclude();

      const result = await transaction.customer.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result as any);
    } catch (error) {
      this.logError(`atualizar cliente ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Customer> {
    try {
      const result = await transaction.customer.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result as any);
    } catch (error) {
      this.logError(`deletar cliente ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: CustomerWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.customer.count({ where: whereInput });
    } catch (error) {
      this.logError('contar clientes', error, { where });
      throw error;
    }
  }

  async findByCpf(cpf: string, tx?: PrismaTransaction): Promise<Customer | null> {
    const transaction = tx || this.prisma;
    try {
      const result = await transaction.customer.findFirst({
        where: { cpf },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result as any) : null;
    } catch (error) {
      this.logError(`buscar cliente por CPF ${cpf}`, error);
      throw error;
    }
  }

  async findByCnpj(cnpj: string, tx?: PrismaTransaction): Promise<Customer | null> {
    const transaction = tx || this.prisma;
    try {
      const result = await transaction.customer.findFirst({
        where: { cnpj },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result as any) : null;
    } catch (error) {
      this.logError(`buscar cliente por CNPJ ${cnpj}`, error);
      throw error;
    }
  }

  async findByEmail(email: string, tx?: PrismaTransaction): Promise<Customer | null> {
    const transaction = tx || this.prisma;
    try {
      const result = await transaction.customer.findFirst({
        where: { email },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result as any) : null;
    } catch (error) {
      this.logError(`buscar cliente por email ${email}`, error);
      throw error;
    }
  }
}
