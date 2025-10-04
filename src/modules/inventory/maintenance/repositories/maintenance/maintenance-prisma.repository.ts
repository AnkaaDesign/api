// repositories/maintenance-prisma.repository.ts

import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Maintenance } from '../../../../../types';
import {
  MaintenanceCreateFormData,
  MaintenanceUpdateFormData,
  MaintenanceInclude,
  MaintenanceOrderBy,
  MaintenanceWhere,
} from '../../../../../schemas/maintenance';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../../types';
import { MaintenanceRepository } from './maintenance.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import {
  Prisma,
  Maintenance as PrismaMaintenance,
  ScheduleFrequency,
  MaintenanceStatus,
} from '@prisma/client';
import { SCHEDULE_FREQUENCY, MAINTENANCE_STATUS } from '../../../../../constants/enums';
import {
  getMaintenanceStatusOrder,
  mapMaintenanceStatusToPrisma,
  mapScheduleFrequencyToPrisma,
  mapWhereClause,
} from '../../../../../utils';

@Injectable()
export class MaintenancePrismaRepository
  extends BaseStringPrismaRepository<
    Maintenance,
    MaintenanceCreateFormData,
    MaintenanceUpdateFormData,
    MaintenanceInclude,
    MaintenanceOrderBy,
    MaintenanceWhere,
    PrismaMaintenance,
    Prisma.MaintenanceCreateInput,
    Prisma.MaintenanceUpdateInput,
    Prisma.MaintenanceInclude,
    Prisma.MaintenanceOrderByWithRelationInput,
    Prisma.MaintenanceWhereInput
  >
  implements MaintenanceRepository
{
  protected readonly logger = new Logger(MaintenancePrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaMaintenance): Maintenance {
    return databaseEntity as Maintenance;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: MaintenanceCreateFormData,
  ): Prisma.MaintenanceCreateInput {
    const { itemsNeeded, itemId, maintenanceScheduleId, ...rest } = formData;
    const statusOrder = getMaintenanceStatusOrder(formData.status);

    const createInput: Prisma.MaintenanceCreateInput = {
      name: formData.name,
      description: formData.description,
      status: mapMaintenanceStatusToPrisma(formData.status || MAINTENANCE_STATUS.PENDING),
      statusOrder,
      item: { connect: { id: itemId } },
      scheduledFor: formData.scheduledFor,
    };

    // Handle maintenance schedule relationship
    if (maintenanceScheduleId) {
      createInput.maintenanceSchedule = { connect: { id: maintenanceScheduleId } };
    }

    // Handle items needed
    if (itemsNeeded && itemsNeeded.length > 0) {
      const validatedItems = itemsNeeded.map(item => ({
        quantity: item.quantity || 0,
        itemId: item.itemId || '',
      }));
      createInput.itemsNeeded = {
        create: validatedItems,
      };
    }

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: MaintenanceUpdateFormData,
  ): Prisma.MaintenanceUpdateInput {
    const { itemId, status, maintenanceScheduleId, ...rest } = formData;

    const updateInput: Prisma.MaintenanceUpdateInput = {};

    // Handle enums
    if (status !== undefined) {
      updateInput.status = mapMaintenanceStatusToPrisma(status);
      updateInput.statusOrder = getMaintenanceStatusOrder(status);
    }

    if (itemId !== undefined) {
      updateInput.item = { connect: { id: itemId } };
    }

    // Handle maintenance schedule relationship
    if (maintenanceScheduleId !== undefined) {
      updateInput.maintenanceSchedule = maintenanceScheduleId
        ? { connect: { id: maintenanceScheduleId } }
        : { disconnect: true };
    }

    return { ...rest, ...updateInput };
  }

  protected mapIncludeToDatabaseInclude(
    include?: MaintenanceInclude,
  ): Prisma.MaintenanceInclude | undefined {
    if (!include) return undefined;

    // Filter out deprecated fields and map to new structure
    const mappedInclude: any = {};

    // Handle each field properly
    for (const [key, value] of Object.entries(include)) {
      // Skip deprecated fields
      if (key === 'lastRunMaintenance') {
        // Instead of lastRunMaintenance, include maintenanceSchedule which might have this info
        mappedInclude.maintenanceSchedule = true;
        continue;
      }

      // Handle schedule config fields that should be nested under maintenanceSchedule
      if (key === 'weeklyConfig' || key === 'monthlyConfig' || key === 'yearlyConfig') {
        // These fields belong to maintenanceSchedule, not directly to maintenance
        if (!mappedInclude.maintenanceSchedule) {
          mappedInclude.maintenanceSchedule = { include: {} };
        } else if (typeof mappedInclude.maintenanceSchedule === 'boolean') {
          mappedInclude.maintenanceSchedule = { include: {} };
        } else if (!mappedInclude.maintenanceSchedule.include) {
          mappedInclude.maintenanceSchedule.include = {};
        }

        mappedInclude.maintenanceSchedule.include[key] = value;
        continue;
      }

      // Copy other fields as-is
      mappedInclude[key] = value;
    }

    return mappedInclude as Prisma.MaintenanceInclude;
  }

  protected mapOrderByToDatabaseOrderBy(orderBy?: MaintenanceOrderBy): any {
    return orderBy || { createdAt: 'desc' };
  }

  protected mapWhereToDatabaseWhere(
    where?: MaintenanceWhere,
  ): Prisma.MaintenanceWhereInput | undefined {
    if (!where) return undefined;
    return mapWhereClause(where) as Prisma.MaintenanceWhereInput;
  }

  protected getDefaultInclude(): Prisma.MaintenanceInclude {
    return {
      itemsNeeded: {
        include: {
          item: true,
        },
      },
      item: true,
      maintenanceSchedule: true,
    };
  }

  // WithTransaction method implementations
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: MaintenanceCreateFormData,
    options?: CreateOptions<MaintenanceInclude>,
  ): Promise<Maintenance> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenance.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar manutenção', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<MaintenanceInclude>,
  ): Promise<Maintenance | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenance.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar manutenção por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<MaintenanceInclude>,
  ): Promise<Maintenance[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.maintenance.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar manutenções por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<MaintenanceOrderBy, MaintenanceWhere, MaintenanceInclude>,
  ): Promise<FindManyResult<Maintenance>> {
    // Map 'limit' to 'take' for compatibility with schema

    const optionsWithTake = options
      ? { ...options, take: (options as any).limit || options.take }
      : {};

    const { where, orderBy, page = 1, take = 20, include } = optionsWithTake as any;
    const skip = Math.max(0, (page - 1) * take);

    const [total, maintenances] = await Promise.all([
      transaction.maintenance.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.maintenance.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: maintenances.map(maintenance => this.mapDatabaseEntityToEntity(maintenance)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: MaintenanceUpdateFormData,
    options?: UpdateOptions<MaintenanceInclude>,
  ): Promise<Maintenance> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.maintenance.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar manutenção ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Maintenance> {
    try {
      const result = await transaction.maintenance.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar manutenção ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: MaintenanceWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.maintenance.count({ where: whereInput });
    } catch (error) {
      this.logError('contar manutenções', error, { where });
      throw error;
    }
  }
}
