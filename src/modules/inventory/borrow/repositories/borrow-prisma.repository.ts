// repositories/borrow-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Borrow } from '../../../../types';
import {
  BorrowCreateFormData,
  BorrowUpdateFormData,
  BorrowInclude,
  BorrowOrderBy,
  BorrowWhere,
} from '../../../../schemas/borrow';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { BorrowRepository } from './borrow.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, Borrow as PrismaBorrow, BorrowStatus } from '@prisma/client';
import { BORROW_STATUS, BORROW_STATUS_ORDER } from '../../../../constants';

@Injectable()
export class BorrowPrismaRepository
  extends BaseStringPrismaRepository<
    Borrow,
    BorrowCreateFormData,
    BorrowUpdateFormData,
    BorrowInclude,
    BorrowOrderBy,
    BorrowWhere,
    PrismaBorrow & Record<string, unknown>,
    Prisma.BorrowCreateInput,
    Prisma.BorrowUpdateInput,
    Prisma.BorrowInclude,
    Prisma.BorrowOrderByWithRelationInput,
    Prisma.BorrowWhereInput
  >
  implements BorrowRepository
{
  protected readonly logger = new Logger(BorrowPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(
    databaseEntity: PrismaBorrow & Record<string, unknown>,
  ): Borrow {
    return {
      id: databaseEntity.id,
      itemId: databaseEntity.itemId,
      userId: databaseEntity.userId,
      quantity: databaseEntity.quantity,
      status: databaseEntity.status as BORROW_STATUS,
      statusOrder: databaseEntity.statusOrder,
      returnedAt: databaseEntity.returnedAt,
      createdAt: databaseEntity.createdAt,
      updatedAt: databaseEntity.updatedAt,
      // Relations
      item: databaseEntity.item as any,
      user: databaseEntity.user as any,
    };
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: BorrowCreateFormData,
  ): Prisma.BorrowCreateInput {
    const { itemId, userId, ...rest } = formData;

    // Validate required fields
    if (!itemId) {
      throw new Error('Item ID is required for creating a borrow');
    }
    if (!userId) {
      throw new Error('User ID is required for creating a borrow');
    }

    // Determine status and statusOrder - new borrows default to ACTIVE
    const status = BORROW_STATUS.ACTIVE;
    const statusOrder = BORROW_STATUS_ORDER[BORROW_STATUS.ACTIVE];

    const createInput: Prisma.BorrowCreateInput = {
      ...rest,
      quantity: formData.quantity ?? 1,
      status: status as BorrowStatus,
      statusOrder,
      item: { connect: { id: itemId } },
      user: { connect: { id: userId } },
    };

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: BorrowUpdateFormData,
  ): Prisma.BorrowUpdateInput {
    const { itemId, userId, status, statusOrder, quantity, returnedAt } = formData;

    const updateInput: Prisma.BorrowUpdateInput = {};

    if (status !== undefined) {
      updateInput.status = status as BorrowStatus;
      // Automatically sync statusOrder when status changes
      // Only set if statusOrder wasn't explicitly provided
      if (statusOrder === undefined) {
        const newStatusOrder = BORROW_STATUS_ORDER[status];
        if (newStatusOrder !== undefined) {
          updateInput.statusOrder = newStatusOrder;
        }
      }
    }

    if (statusOrder !== undefined) {
      updateInput.statusOrder = statusOrder;
    }

    if (quantity !== undefined) {
      updateInput.quantity = quantity;
    }

    if (returnedAt !== undefined) {
      updateInput.returnedAt = returnedAt;
    }

    if (itemId !== undefined) {
      updateInput.item = { connect: { id: itemId } };
    }

    if (userId !== undefined) {
      updateInput.user = { connect: { id: userId } };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: BorrowInclude): Prisma.BorrowInclude | undefined {
    return include as Prisma.BorrowInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: BorrowOrderBy,
  ): Prisma.BorrowOrderByWithRelationInput | undefined {
    return orderBy as Prisma.BorrowOrderByWithRelationInput | undefined;
  }

  private convertOrderByToCorrectFormat(
    orderBy?: BorrowOrderBy,
  ): Prisma.BorrowOrderByWithRelationInput | Prisma.BorrowOrderByWithRelationInput[] | undefined {
    if (!orderBy) return undefined;

    // If orderBy is already an array, return it as is
    if (Array.isArray(orderBy)) {
      return orderBy as Prisma.BorrowOrderByWithRelationInput[];
    }

    // If it's an object, check if it has multiple keys
    if (typeof orderBy === 'object') {
      const keys = Object.keys(orderBy);

      // If multiple keys, convert to array format for Prisma
      if (keys.length > 1) {
        return keys.map(key => ({
          [key]: orderBy[key as keyof typeof orderBy],
        })) as Prisma.BorrowOrderByWithRelationInput[];
      }

      // Single key, return as object
      return orderBy as Prisma.BorrowOrderByWithRelationInput;
    }

    return orderBy as Prisma.BorrowOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: BorrowWhere): Prisma.BorrowWhereInput | undefined {
    return where as Prisma.BorrowWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.BorrowInclude {
    return {
      item: true,
      user: true,
    };
  }

  /**
   * Get optimized select for table/list views
   * Returns minimal data needed for displaying borrows in tables
   */
  protected getSelectForTable(): Prisma.BorrowSelect {
    return {
      id: true,
      quantity: true,
      status: true,
      returnedAt: true,
      createdAt: true,
      item: {
        select: {
          id: true,
          name: true,
          uniCode: true,
          quantity: true,
          brand: {
            select: {
              name: true,
            },
          },
          category: {
            select: {
              name: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          position: {
            select: {
              name: true,
            },
          },
          sector: {
            select: {
              name: true,
            },
          },
        },
      },
    };
  }

  /**
   * Get optimized select for form views
   * Returns fields needed for editing/creating borrows
   */
  protected getSelectForForm(): Prisma.BorrowSelect {
    return {
      id: true,
      itemId: true,
      userId: true,
      quantity: true,
      status: true,
      statusOrder: true,
      returnedAt: true,
      createdAt: true,
      updatedAt: true,
      item: {
        select: {
          id: true,
          name: true,
          uniCode: true,
          quantity: true,
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          sectorId: true,
          positionId: true,
          position: {
            select: {
              id: true,
              name: true,
            },
          },
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    };
  }

  /**
   * Get optimized select for detail views
   * Returns complete data with full relations
   */
  protected getSelectForDetail(): Prisma.BorrowSelect {
    return {
      id: true,
      itemId: true,
      userId: true,
      quantity: true,
      status: true,
      statusOrder: true,
      returnedAt: true,
      createdAt: true,
      updatedAt: true,
      item: {
        select: {
          id: true,
          name: true,
          uniCode: true,
          quantity: true,
          brandId: true,
          categoryId: true,
          supplierId: true,
          createdAt: true,
          updatedAt: true,
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          supplier: {
            select: {
              id: true,
              fantasyName: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          sectorId: true,
          positionId: true,
          createdAt: true,
          updatedAt: true,
          position: {
            select: {
              id: true,
              name: true,
            },
          },
          sector: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    };
  }

  /**
   * Determines which select/include to use based on options
   * Priority: custom select > custom include > default include (for backward compatibility)
   */
  protected resolveSelectOrInclude(
    options?: { select?: any; include?: any },
  ): { select?: Prisma.BorrowSelect; include?: Prisma.BorrowInclude } {
    if (options?.select) {
      return { select: options.select as Prisma.BorrowSelect };
    }
    if (options?.include) {
      return { include: this.mapIncludeToDatabaseInclude(options.include) };
    }
    // Default to include for backward compatibility
    return { include: this.getDefaultInclude() };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: BorrowCreateFormData,
    options?: CreateOptions<BorrowInclude>,
  ): Promise<Borrow> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const selectOrInclude = this.resolveSelectOrInclude(options);

      const result = await transaction.borrow.create({
        data: createInput,
        ...selectOrInclude,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar empréstimo', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<BorrowInclude>,
  ): Promise<Borrow | null> {
    try {
      const selectOrInclude = this.resolveSelectOrInclude(options);

      const result = await transaction.borrow.findUnique({
        where: { id },
        ...selectOrInclude,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar empréstimo por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<BorrowInclude>,
  ): Promise<Borrow[]> {
    try {
      const selectOrInclude = this.resolveSelectOrInclude(options);

      const results = await transaction.borrow.findMany({
        where: { id: { in: ids } },
        ...selectOrInclude,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar empréstimos por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<BorrowOrderBy, BorrowWhere, BorrowInclude>,
  ): Promise<FindManyResult<Borrow>> {
    const { where, orderBy, page = 1, take = 20, include, select } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const prismaOrderBy = this.convertOrderByToCorrectFormat(orderBy) || { createdAt: 'desc' };
    const selectOrInclude = this.resolveSelectOrInclude({ select, include });

    const [total, borrows] = await Promise.all([
      transaction.borrow.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.borrow.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: prismaOrderBy,
        skip,
        take,
        ...selectOrInclude,
      }),
    ]);

    return {
      data: borrows.map(borrow => this.mapDatabaseEntityToEntity(borrow)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: BorrowUpdateFormData,
    options?: UpdateOptions<BorrowInclude>,
  ): Promise<Borrow> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const selectOrInclude = this.resolveSelectOrInclude(options);

      const result = await transaction.borrow.update({
        where: { id },
        data: updateInput,
        ...selectOrInclude,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar empréstimo ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Borrow> {
    try {
      // Use minimal select for delete operations - only need the core fields
      const result = await transaction.borrow.delete({
        where: { id },
        select: {
          id: true,
          itemId: true,
          userId: true,
          quantity: true,
          status: true,
          statusOrder: true,
          returnedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return this.mapDatabaseEntityToEntity(result as any);
    } catch (error) {
      this.logError(`deletar empréstimo ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: BorrowWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.borrow.count({ where: whereInput });
    } catch (error) {
      this.logError('contar empréstimos', error, { where });
      throw error;
    }
  }

  async findUnreturnedByItem(itemId: string): Promise<Borrow[]> {
    try {
      // Use optimized select for table view - this is typically used in list views
      const results = await this.prisma.borrow.findMany({
        where: {
          itemId,
          returnedAt: null,
        },
        select: this.getSelectForTable(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result as any));
    } catch (error) {
      this.logError(`buscar empréstimos não devolvidos do item ${itemId}`, error);
      throw error;
    }
  }

  async getTotalUnreturnedQuantity(itemId: string): Promise<number> {
    try {
      const result = await this.prisma.borrow.aggregate({
        where: {
          itemId,
          returnedAt: null,
        },
        _sum: {
          quantity: true,
        },
      });

      return result._sum?.quantity ?? 0;
    } catch (error) {
      this.logError(`calcular quantidade total não devolvida do item ${itemId}`, error);
      throw error;
    }
  }

  // =====================
  // Optimized Query Methods
  // =====================

  /**
   * Find borrows optimized for table view
   * Uses minimal select to improve performance for list views
   */
  async findManyForTable(
    options?: FindManyOptions<BorrowOrderBy, BorrowWhere, BorrowInclude>,
  ): Promise<FindManyResult<Borrow>> {
    return this.findManyWithTransaction(this.prisma, {
      ...options,
      select: this.getSelectForTable() as any,
    });
  }

  /**
   * Find borrows optimized for form view
   * Includes all fields needed for editing
   */
  async findManyForForm(
    options?: FindManyOptions<BorrowOrderBy, BorrowWhere, BorrowInclude>,
  ): Promise<FindManyResult<Borrow>> {
    return this.findManyWithTransaction(this.prisma, {
      ...options,
      select: this.getSelectForForm() as any,
    });
  }

  /**
   * Find borrows optimized for detail view
   * Includes complete data with all relations
   */
  async findManyForDetail(
    options?: FindManyOptions<BorrowOrderBy, BorrowWhere, BorrowInclude>,
  ): Promise<FindManyResult<Borrow>> {
    return this.findManyWithTransaction(this.prisma, {
      ...options,
      select: this.getSelectForDetail() as any,
    });
  }

  /**
   * Find borrow by ID optimized for table view
   */
  async findByIdForTable(id: string): Promise<Borrow | null> {
    return this.findByIdWithTransaction(this.prisma, id, {
      select: this.getSelectForTable() as any,
    });
  }

  /**
   * Find borrow by ID optimized for form view
   */
  async findByIdForForm(id: string): Promise<Borrow | null> {
    return this.findByIdWithTransaction(this.prisma, id, {
      select: this.getSelectForForm() as any,
    });
  }

  /**
   * Find borrow by ID optimized for detail view
   */
  async findByIdForDetail(id: string): Promise<Borrow | null> {
    return this.findByIdWithTransaction(this.prisma, id, {
      select: this.getSelectForDetail() as any,
    });
  }
}
