import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { PpeSize } from '../../../../../types';
import {
  PpeSizeCreateFormData,
  PpeSizeUpdateFormData,
  PpeSizeInclude,
  PpeSizeOrderBy,
  PpeSizeWhere,
} from '../../../../../schemas';
import { PpeSizeRepository } from './ppe-size.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import {
  CreateOptions,
  FindManyOptions,
  FindManyResult,
  UpdateOptions,
} from '../../../../../types';
import { Prisma } from '@prisma/client';

@Injectable()
export class PpeSizePrismaRepository
  extends BaseStringPrismaRepository<
    PpeSize,
    PpeSizeCreateFormData,
    PpeSizeUpdateFormData,
    PpeSizeInclude,
    PpeSizeOrderBy,
    PpeSizeWhere,
    Prisma.PpeSizeGetPayload<{ include: any }>,
    Prisma.PpeSizeCreateInput,
    Prisma.PpeSizeUpdateInput,
    Prisma.PpeSizeInclude,
    Prisma.PpeSizeOrderByWithRelationInput,
    Prisma.PpeSizeWhereInput
  >
  implements PpeSizeRepository
{
  protected readonly logger = new Logger(PpeSizePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: any): PpeSize {
    return databaseEntity as PpeSize;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PpeSizeCreateFormData,
  ): Prisma.PpeSizeCreateInput {
    const { userId, ...rest } = formData;

    return {
      ...(rest as Omit<Prisma.PpeSizeCreateInput, 'user'>),
      user: { connect: { id: userId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PpeSizeUpdateFormData,
  ): Prisma.PpeSizeUpdateInput {
    return formData as unknown as Prisma.PpeSizeUpdateInput;
  }

  protected mapWhereToDatabaseWhere(where?: PpeSizeWhere): Prisma.PpeSizeWhereInput | undefined {
    return where as Prisma.PpeSizeWhereInput;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PpeSizeOrderBy,
  ): Prisma.PpeSizeOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PpeSizeOrderByWithRelationInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PpeSizeInclude,
  ): Prisma.PpeSizeInclude | undefined {
    return include as Prisma.PpeSizeInclude;
  }

  protected getDatabaseModel(tx?: PrismaTransaction) {
    return tx ? tx.ppeSize : this.prisma.ppeSize;
  }

  protected getDefaultInclude(): Prisma.PpeSizeInclude {
    return {
      user: true,
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: PpeSizeCreateFormData,
    options?: CreateOptions<PpeSizeInclude>,
  ): Promise<PpeSize> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeSize.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar tamanhos PPE', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PpeSizeInclude>,
  ): Promise<PpeSize | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeSize.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar tamanhos PPE por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PpeSizeInclude>,
  ): Promise<PpeSize[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.ppeSize.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar tamanhos PPE por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PpeSizeOrderBy, PpeSizeWhere, PpeSizeInclude>,
  ): Promise<FindManyResult<PpeSize>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, sizes] = await Promise.all([
      transaction.ppeSize.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.ppeSize.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: sizes.map(size => this.mapDatabaseEntityToEntity(size)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PpeSizeUpdateFormData,
    options?: UpdateOptions<PpeSizeInclude>,
  ): Promise<PpeSize> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.ppeSize.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar tamanhos PPE ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<PpeSize> {
    try {
      const result = await transaction.ppeSize.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar tamanhos PPE ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PpeSizeWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.ppeSize.count({ where: whereInput });
    } catch (error) {
      this.logError('contar tamanhos PPE', error, { where });
      throw error;
    }
  }

  // Non-transaction methods that delegate to transaction methods
  async create(
    data: PpeSizeCreateFormData,
    options?: CreateOptions<PpeSizeInclude>,
  ): Promise<PpeSize> {
    return this.createWithTransaction(this.prisma, data, options);
  }

  async findById(id: string, options?: CreateOptions<PpeSizeInclude>): Promise<PpeSize | null> {
    return this.findByIdWithTransaction(this.prisma, id, options);
  }

  async findByIds(ids: string[], options?: CreateOptions<PpeSizeInclude>): Promise<PpeSize[]> {
    return this.findByIdsWithTransaction(this.prisma, ids, options);
  }

  async findMany(
    options?: FindManyOptions<PpeSizeOrderBy, PpeSizeWhere, PpeSizeInclude>,
  ): Promise<FindManyResult<PpeSize>> {
    return this.findManyWithTransaction(this.prisma, options);
  }

  async update(
    id: string,
    data: PpeSizeUpdateFormData,
    options?: UpdateOptions<PpeSizeInclude>,
  ): Promise<PpeSize> {
    return this.updateWithTransaction(this.prisma, id, data, options);
  }

  async delete(id: string): Promise<PpeSize> {
    return this.deleteWithTransaction(this.prisma, id);
  }

  async count(where?: PpeSizeWhere): Promise<number> {
    return this.countWithTransaction(this.prisma, where);
  }

  // Additional method from abstract class
  async findByUserIdWithTransaction(
    transaction: PrismaTransaction,
    userId: string,
    options?: CreateOptions<PpeSizeInclude>,
  ): Promise<PpeSize | null> {
    const result = await transaction.ppeSize.findFirst({
      where: { userId },
      include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
    });

    return result ? this.mapDatabaseEntityToEntity(result) : null;
  }

  async findByUserId(
    userId: string,
    options?: CreateOptions<PpeSizeInclude>,
  ): Promise<PpeSize | null> {
    return this.findByUserIdWithTransaction(this.prisma, userId, options);
  }
}
