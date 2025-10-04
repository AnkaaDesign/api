// repositories/preference-prisma.repository.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Preferences } from '../../../../types';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
import {
  PreferencesCreateFormData,
  PreferencesUpdateFormData,
  PreferencesInclude,
  PreferencesWhere,
  PreferencesOrderBy,
} from '../../../../schemas/preferences';
import { PreferencesRepository } from './preferences.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma, Preferences as PrismaPreferences, ColorSchema } from '@prisma/client';

@Injectable()
export class PreferencesPrismaRepository
  extends BaseStringPrismaRepository<
    Preferences,
    PreferencesCreateFormData,
    PreferencesUpdateFormData,
    PreferencesInclude,
    PreferencesOrderBy,
    PreferencesWhere,
    PrismaPreferences,
    Prisma.PreferencesCreateInput,
    Prisma.PreferencesUpdateInput,
    Prisma.PreferencesInclude,
    Prisma.PreferencesOrderByWithRelationInput,
    Prisma.PreferencesWhereInput
  >
  implements PreferencesRepository
{
  protected readonly logger = new Logger(PreferencesPrismaRepository.name);

  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  // Abstract method implementations from BaseStringPrismaRepository
  protected mapDatabaseEntityToEntity(databaseEntity: PrismaPreferences): Preferences {
    return databaseEntity as Preferences;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: PreferencesCreateFormData,
  ): Prisma.PreferencesCreateInput {
    const { userId, colorSchema, ...rest } = formData;

    return {
      ...rest,
      colorSchema: colorSchema as ColorSchema,
      user: { connect: { id: userId } },
    };
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: PreferencesUpdateFormData,
  ): Prisma.PreferencesUpdateInput {
    // For preferences, we don't update userId relationship
    return formData as Prisma.PreferencesUpdateInput;
  }

  protected mapIncludeToDatabaseInclude(
    include?: PreferencesInclude,
  ): Prisma.PreferencesInclude | undefined {
    return include as Prisma.PreferencesInclude | undefined;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: PreferencesOrderBy,
  ): Prisma.PreferencesOrderByWithRelationInput | undefined {
    return orderBy as Prisma.PreferencesOrderByWithRelationInput | undefined;
  }

  protected mapWhereToDatabaseWhere(
    where?: PreferencesWhere,
  ): Prisma.PreferencesWhereInput | undefined {
    return where as Prisma.PreferencesWhereInput | undefined;
  }

  protected getDefaultInclude(): Prisma.PreferencesInclude {
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
    data: PreferencesCreateFormData,
    options?: CreateOptions<PreferencesInclude>,
  ): Promise<Preferences> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.preferences.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar preferências', error, { data });
      throw error;
    }
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: PreferencesUpdateFormData,
    options?: UpdateOptions<PreferencesInclude>,
  ): Promise<Preferences> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.preferences.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar preferências ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<Preferences> {
    try {
      const result = await transaction.preferences.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar preferências ${id}`, error);
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<PreferencesInclude>,
  ): Promise<Preferences | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.preferences.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar preferências por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<PreferencesInclude>,
  ): Promise<Preferences[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.preferences.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar preferências por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<PreferencesOrderBy, PreferencesWhere, PreferencesInclude>,
  ): Promise<FindManyResult<Preferences>> {
    const { where, orderBy, page = 1, take = 20, include } = options || {};
    const skip = Math.max(0, (page - 1) * take);

    const [total, preferences] = await Promise.all([
      transaction.preferences.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.preferences.findMany({
        where: this.mapWhereToDatabaseWhere(where),
        orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { createdAt: 'desc' },
        skip,
        take,
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: preferences.map(preference => this.mapDatabaseEntityToEntity(preference)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async countWithTransaction(
    transaction: PrismaTransaction,
    where?: PreferencesWhere,
  ): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.preferences.count({ where: whereInput });
    } catch (error) {
      this.logError('contar preferências', error, { where });
      throw error;
    }
  }
}
