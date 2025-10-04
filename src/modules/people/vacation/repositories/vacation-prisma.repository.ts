// repositories/vacation-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Vacation } from '../../../../types';
import {
  VacationCreateFormData,
  VacationUpdateFormData,
  VacationInclude,
  VacationOrderBy,
  VacationWhere,
} from '../../../../schemas';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import { VacationRepository } from './vacation.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, Vacation as PrismaVacation, VacationStatus, VacationType } from '@prisma/client';
import {
  getVacationStatusOrder,
  getVacationTypeOrder,
  mapVacationStatusToPrisma,
  mapVacationTypeToPrisma,
  mapWhereClause,
} from '../../../../utils';

@Injectable()
export class VacationPrismaRepository
  extends BaseStringPrismaRepository<
    Vacation,
    VacationCreateFormData,
    VacationUpdateFormData,
    VacationInclude,
    VacationOrderBy,
    VacationWhere,
    PrismaVacation,
    Prisma.VacationCreateInput,
    Prisma.VacationUpdateInput,
    Prisma.VacationInclude,
    Prisma.VacationOrderByWithRelationInput,
    Prisma.VacationWhereInput
  >
  implements VacationRepository
{
  protected readonly logger = new Logger(VacationPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaVacation): Vacation {
    return databaseEntity as Vacation;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: VacationCreateFormData,
  ): Prisma.VacationCreateInput {
    const { userId, ...rest } = formData;

    const createInput: Prisma.VacationCreateInput = {
      ...rest,
      startAt: formData.startAt || new Date(), // Ensure startAt is provided
      endAt: formData.endAt || new Date(), // Ensure endAt is provided
      status: mapVacationStatusToPrisma(formData.status),
      statusOrder: getVacationStatusOrder(formData.status),
      type: mapVacationTypeToPrisma(formData.type),
      typeOrder: getVacationTypeOrder(formData.type),
    };

    if (userId) {
      createInput.user = { connect: { id: userId } };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: VacationUpdateFormData,
  ): Prisma.VacationUpdateInput {
    const { userId, status, type, ...rest } = formData;

    const updateInput: Prisma.VacationUpdateInput = { ...rest };

    // Handle enums
    if (status !== undefined) {
      updateInput.status = mapVacationStatusToPrisma(status);
      updateInput.statusOrder = getVacationStatusOrder(status);
    }

    if (type !== undefined) {
      updateInput.type = mapVacationTypeToPrisma(type);
      updateInput.typeOrder = getVacationTypeOrder(type);
    }

    if (userId !== undefined) {
      updateInput.user = userId ? { connect: { id: userId } } : { disconnect: true };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: VacationInclude,
  ): Prisma.VacationInclude | undefined {
    return include as Prisma.VacationInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: VacationOrderBy,
  ): Prisma.VacationOrderByWithRelationInput | undefined {
    return orderBy as Prisma.VacationOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: VacationWhere): Prisma.VacationWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.VacationWhereInput;
  }

  protected getDefaultInclude(): Prisma.VacationInclude {
    return {
      user: {
        include: {
          position: true,
          sector: true,
        },
      },
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: VacationCreateFormData,
    options?: CreateOptions<VacationInclude>,
  ): Promise<Vacation> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);

      const result = await transaction.vacation.create({
        data: createInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar férias', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: VacationUpdateFormData,
    options?: UpdateOptions<VacationInclude>,
  ): Promise<Vacation> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);

      const result = await transaction.vacation.update({
        where: { id },
        data: updateInput,
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar férias ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Vacation> {
    try {
      const result = await transaction.vacation.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar férias ${id}`, error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<VacationInclude>,
  ): Promise<Vacation | null> {
    try {
      const result = await transaction.vacation.findUnique({
        where: { id },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar férias por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<VacationInclude>,
  ): Promise<Vacation[]> {
    try {
      const results = await transaction.vacation.findMany({
        where: { id: { in: ids } },
        include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar férias por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<VacationOrderBy, VacationWhere, VacationInclude>,
  ): Promise<FindManyResult<Vacation>> {
    const { where, include, page = 1, take = 20, orderBy = { createdAt: 'desc' } } = options || {};
    const skip = page && take ? (page - 1) * take : undefined;

    try {
      const [total, vacations] = await Promise.all([
        transaction.vacation.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.vacation.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy),
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        }),
      ]);

      return {
        data: vacations.map(vacation => this.mapDatabaseEntityToEntity(vacation)),
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar múltiplas férias', error, { where, orderBy, page, take });
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: VacationWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.vacation.count({ where: whereInput });
    } catch (error) {
      this.logError('contar férias', error, { where });
      throw error;
    }
  }

  /**
   * Find overlapping vacations for a specific user within a date range
   */
  async findOverlapping(
    userId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ): Promise<Vacation[]> {
    try {
      const where: Prisma.VacationWhereInput = {
        userId,
        AND: [
          {
            OR: [
              {
                AND: [{ startAt: { lte: startDate } }, { endAt: { gte: startDate } }],
              },
              {
                AND: [{ startAt: { lte: endDate } }, { endAt: { gte: endDate } }],
              },
              {
                AND: [{ startAt: { gte: startDate } }, { endAt: { lte: endDate } }],
              },
            ],
          },
        ],
      };

      if (excludeId) {
        where.id = { not: excludeId };
      }

      const results = await this.prisma.vacation.findMany({
        where,
        include: this.getDefaultInclude(),
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar férias sobrepostas', error, { userId, startDate, endDate, excludeId });
      throw error;
    }
  }
}
