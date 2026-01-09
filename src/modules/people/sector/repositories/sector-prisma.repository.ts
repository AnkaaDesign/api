// repositories/sector-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Sector } from '../../../../types';
import {
  SectorCreateFormData,
  SectorUpdateFormData,
  SectorInclude,
  SectorOrderBy,
  SectorWhere,
} from '../../../../schemas/sector';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { SectorRepository } from './sector.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, SectorPrivileges } from '@prisma/client';
import { SECTOR_PRIVILEGES } from '../../../../constants/enums';

@Injectable()
export class SectorPrismaRepository
  extends BaseStringPrismaRepository<
    Sector,
    SectorCreateFormData,
    SectorUpdateFormData,
    SectorInclude,
    SectorOrderBy,
    SectorWhere,
    Prisma.SectorGetPayload<{ include: any }>,
    Prisma.SectorCreateInput,
    Prisma.SectorUpdateInput,
    Prisma.SectorInclude,
    Prisma.SectorOrderByWithRelationInput,
    Prisma.SectorWhereInput
  >
  implements SectorRepository
{
  protected readonly logger = new Logger(SectorPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): Sector {
    return databaseEntity as Sector;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: SectorCreateFormData,
  ): Prisma.SectorCreateInput {
    const createInput: Prisma.SectorCreateInput = {
      name: formData.name,
      privileges: (formData.privileges || SECTOR_PRIVILEGES.BASIC) as SectorPrivileges,
    };

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: SectorUpdateFormData,
  ): Prisma.SectorUpdateInput {
    const updateInput: Prisma.SectorUpdateInput = {};

    if (formData.name !== undefined) {
      updateInput.name = formData.name;
    }

    if (formData.privileges !== undefined) {
      updateInput.privileges = formData.privileges as SectorPrivileges;
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: SectorInclude): Prisma.SectorInclude | undefined {
    if (!include) return undefined;

    const mappedInclude: Prisma.SectorInclude = {};

    // Handle users relation
    if (include.users !== undefined) {
      mappedInclude.users = include.users as any;
    }

    // Handle tasks relation
    if (include.tasks !== undefined) {
      mappedInclude.tasks = include.tasks as any;
    }

    // Handle managedByUsers relation (removed - doesn't exist in schema)
    // if (include.managedByUsers !== undefined) {
    //   mappedInclude.managedByUsers = include.managedByUsers as any;
    // }

    // Handle _count field - must use select syntax
    if (include._count) {
      if (include._count === true) {
        // If _count is true, include all counts
        mappedInclude._count = {
          select: {
            users: true,
            tasks: true,
          },
        };
      } else if (typeof include._count === 'object' && include._count !== null) {
        // Handle when _count is an object with select
        const countSelect = include._count as { select?: Record<string, boolean> };
        if (countSelect.select) {
          mappedInclude._count = {
            select: {
              users: countSelect.select.users === true,
              tasks: countSelect.select.tasks === true,
            },
          };
        } else {
          // Default to including all counts if select is not specified
          mappedInclude._count = {
            select: {
              users: true,
              tasks: true,
            },
          };
        }
      }
    }

    return mappedInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: SectorOrderBy,
  ): Prisma.SectorOrderByWithRelationInput | undefined {
    return orderBy as Prisma.SectorOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: SectorWhere): Prisma.SectorWhereInput | undefined {
    return where as Prisma.SectorWhereInput;
  }

  protected getDefaultInclude(): Prisma.SectorInclude {
    return {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          position: { select: { id: true, name: true } },
        },
      },
      tasks: {
        select: {
          id: true,
          name: true,
          status: true,
          term: true,
          customer: { select: { id: true, fantasyName: true } },
        },
      },
      _count: {
        select: {
          users: true,
          tasks: true,
        },
      },
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: SectorCreateFormData,
    options?: CreateOptions<SectorInclude>,
  ): Promise<Sector> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await transaction.sector.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar setor', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<SectorInclude>,
  ): Promise<Sector | null> {
    try {
      const result = await transaction.sector.findUnique({
        where: { id },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar setor por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<SectorInclude>,
  ): Promise<Sector[]> {
    try {
      const results = await transaction.sector.findMany({
        where: { id: { in: ids } },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar setores por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<SectorOrderBy, SectorWhere, SectorInclude>,
  ): Promise<FindManyResult<Sector>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    try {
      const [total, sectors] = await Promise.all([
        transaction.sector.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.sector.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: sectors.map(sector => this.mapDatabaseEntityToEntity(sector)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar múltiplos setores', error, { where, orderBy, page, take });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: SectorUpdateFormData,
    options?: UpdateOptions<SectorInclude>,
  ): Promise<Sector> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await transaction.sector.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar setor ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Sector> {
    try {
      const result = await transaction.sector.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar setor ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: SectorWhere): Promise<number> {
    try {
      return transaction.sector.count({
        where: this.mapWhereToDatabaseWhere(where),
      });
    } catch (error) {
      this.logError('contar setores', error, { where });
      throw error;
    }
  }

  async findByName(name: string): Promise<Sector | null> {
    try {
      const result = await this.prisma.sector.findFirst({
        where: { name },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar setor por nome ${name}`, error);
      throw error;
    }
  }
}
