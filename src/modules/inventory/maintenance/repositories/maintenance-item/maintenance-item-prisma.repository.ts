import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { MaintenanceItem } from '../../../../../types';
import {
  MaintenanceItemCreateFormData,
  MaintenanceItemUpdateFormData,
  MaintenanceItemInclude,
  MaintenanceItemOrderBy,
  MaintenanceItemWhere,
} from '../../../../../schemas/maintenance';
import { MaintenanceItemRepository } from './maintenance-item.repository';
import { MaintenanceItem as PrismaMaintenanceItem, Prisma } from '@prisma/client';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { CreateOptions, FindManyOptions, FindManyResult, UpdateOptions } from '../../../../../types';

@Injectable()
export class MaintenanceItemPrismaRepository
  extends BaseStringPrismaRepository<
    MaintenanceItem,
    MaintenanceItemCreateFormData,
    MaintenanceItemUpdateFormData,
    MaintenanceItemInclude,
    MaintenanceItemOrderBy,
    MaintenanceItemWhere,
    PrismaMaintenanceItem,
    Prisma.MaintenanceItemCreateInput,
    Prisma.MaintenanceItemUpdateInput,
    Prisma.MaintenanceItemInclude,
    Prisma.MaintenanceItemOrderByWithRelationInput,
    Prisma.MaintenanceItemWhereInput
  >
  implements MaintenanceItemRepository
{
  protected readonly logger = new Logger(MaintenanceItemPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaMaintenanceItem): MaintenanceItem {
    return databaseEntity as unknown as MaintenanceItem;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: MaintenanceItemCreateFormData,
  ): Prisma.MaintenanceItemCreateInput {
    return {
      quantity: formData.quantity,
      maintenance: { connect: { id: formData.maintenanceId } },
      item: { connect: { id: formData.itemId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: MaintenanceItemUpdateFormData,
  ): Prisma.MaintenanceItemUpdateInput {
    const updateInput: Prisma.MaintenanceItemUpdateInput = {};

    if (formData.quantity !== undefined) {
      updateInput.quantity = formData.quantity;
    }

    // MaintenanceItemUpdateFormData only has quantity field per schema
    // maintenanceId and itemId cannot be updated after creation

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: MaintenanceItemInclude,
  ): Prisma.MaintenanceItemInclude | undefined {
    return include as Prisma.MaintenanceItemInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: MaintenanceItemOrderBy): any {
    return orderBy || { createdAt: 'desc' };
  }

  protected mapWhereToDatabaseWhere(
    where?: MaintenanceItemWhere,
  ): Prisma.MaintenanceItemWhereInput | undefined {
    return where as Prisma.MaintenanceItemWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.MaintenanceItemInclude {
    return {
      maintenance: true,
      item: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: MaintenanceItemCreateFormData,
    options?: CreateOptions<MaintenanceItemInclude>,
  ): Promise<MaintenanceItem> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenanceItem.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar item de manutenção', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<MaintenanceItemInclude>,
  ): Promise<MaintenanceItem | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenanceItem.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar item de manutenção por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<MaintenanceItemInclude>,
  ): Promise<MaintenanceItem[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.maintenanceItem.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar itens de manutenção por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<MaintenanceItemOrderBy, MaintenanceItemWhere, MaintenanceItemInclude>,
  ): Promise<FindManyResult<MaintenanceItem>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, maintenanceItems] = await Promise.all([
      transaction.maintenanceItem.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.maintenanceItem.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: maintenanceItems.map(maintenanceItem =>
        this.mapDatabaseEntityToEntity(maintenanceItem),
      ),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: MaintenanceItemUpdateFormData,
    options?: UpdateOptions<MaintenanceItemInclude>,
  ): Promise<MaintenanceItem> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenanceItem.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar item de manutenção ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(
    transaction: PrismaTransaction,
    id: string,
  ): Promise<MaintenanceItem> {
    try {
      const result = await transaction.maintenanceItem.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar item de manutenção ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: MaintenanceItemWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.maintenanceItem.count({ where: whereInput });
    } catch (error) {
      this.logError('contar itens de manutenção', error, { where });
      throw error;
    }
  }
}
