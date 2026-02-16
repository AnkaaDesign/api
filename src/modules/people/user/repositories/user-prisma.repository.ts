import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { User } from '@types';
import {
  UserCreateFormData,
  UserUpdateFormData,
  UserInclude,
  UserOrderBy,
  UserWhere,
} from '@schemas/user';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '@types';
import { UserRepository } from './user.repository';
import { BaseStringPrismaRepository } from '@modules/common/base/base-string-prisma.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { Prisma } from '@prisma/client';
import {
  mapUserStatusToPrisma,
  mapVerificationTypeToPrisma,
  mapWhereClause,
  mapShirtSizeToPrisma,
  mapBootSizeToPrisma,
  mapPantsSizeToPrisma,
  mapSleevesSizeToPrisma,
  mapMaskSizeToPrisma,
  mapGlovesSizeToPrisma,
  mapRainBootsSizeToPrisma,
} from '@utils';

@Injectable()
export class UserPrismaRepository
  extends BaseStringPrismaRepository<
    User,
    UserCreateFormData,
    UserUpdateFormData,
    UserInclude,
    UserOrderBy,
    UserWhere,
    Prisma.UserGetPayload<{ include: any }>,
    Prisma.UserCreateInput,
    Prisma.UserUpdateInput,
    Prisma.UserInclude,
    Prisma.UserOrderByWithRelationInput,
    Prisma.UserWhereInput
  >
  implements UserRepository
{
  protected readonly logger = new Logger(UserPrismaRepository.name);

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // Mapping methods
  protected mapDatabaseEntityToEntity(databaseEntity: any): User {
    const { birth, ...restUser } = databaseEntity;

    const user = {
      ...restUser,
      // Map database field names to entity field names
      birth: birth || null,
    } as User;

    // Calculate virtual remuneration field for the position if it exists
    if (user.position && user.position.remunerations && user.position.remunerations.length > 0) {
      // Set the virtual remuneration field from the latest remuneration record
      user.position.remuneration = user.position.remunerations[0].value;
    } else if (user.position) {
      user.position.remuneration = 0;
    }

    return user;
  }

  protected mapCreateFormDataToDatabaseCreateInput(
    formData: UserCreateFormData,
  ): Prisma.UserCreateInput {
    const {
      positionId,
      sectorId,
      avatarId,
      ppeSize,
      notificationPreferences,
      userId,
      birth,
      ...rest
    } = formData;

    const createInput: Prisma.UserCreateInput = {
      ...rest,
      name: formData.name || 'Unnamed User', // Ensure name is provided
      email: formData.email || '', // Ensure email is provided
      phone: formData.phone || '', // Ensure phone is provided
      status: mapUserStatusToPrisma(formData.status),
      verified: formData.verified ?? false,
      performanceLevel: formData.performanceLevel ?? 0,
      // Map date fields to Prisma model field names
      birth: birth || null,
    };

    if (positionId) {
      createInput.position = { connect: { id: positionId } };
    }

    if (sectorId) {
      createInput.sector = { connect: { id: sectorId } };
    }

    // Note: managedSector is now handled via Sector.managerId relation
    // To make a user a sector manager, update the Sector's managerId field

    if (avatarId) {
      createInput.avatar = { connect: { id: avatarId } };
    }

    // Handle nested creates
    if (ppeSize) {
      createInput.ppeSize = {
        create: {
          shirts: mapShirtSizeToPrisma(ppeSize.shirts),
          boots: mapBootSizeToPrisma(ppeSize.boots),
          pants: mapPantsSizeToPrisma(ppeSize.pants),
          sleeves: mapSleevesSizeToPrisma(ppeSize.sleeves),
          mask: mapMaskSizeToPrisma(ppeSize.mask),
          gloves: mapGlovesSizeToPrisma(ppeSize.gloves),
          rainBoots: mapRainBootsSizeToPrisma(ppeSize.rainBoots),
        },
      };
    }

    // Note: notificationPreferences are handled separately through the preferences relation
    // They would typically be created after the user is created

    return createInput;
  }

  protected mapUpdateFormDataToDatabaseUpdateInput(
    formData: UserUpdateFormData,
  ): Prisma.UserUpdateInput {
    const {
      positionId,
      sectorId,
      avatarId,
      preferences,
      userId,
      status,
      verificationType,
      verificationCode,
      verificationExpiresAt,
      requirePasswordChange,
      ppeSize,
      ...rest
    } = formData;

    const updateInput: Prisma.UserUpdateInput = {
      ...rest,
      ...(formData.email !== undefined && { email: formData.email }),
      ...(formData.phone !== undefined && { phone: formData.phone }),
      ...(status && { status: mapUserStatusToPrisma(status) }),
      ...(verificationType !== undefined && {
        verificationType: mapVerificationTypeToPrisma(verificationType),
      }),
      ...(verificationCode !== undefined && { verificationCode }),
      ...(verificationExpiresAt !== undefined && { verificationExpiresAt }),
      ...(requirePasswordChange !== undefined && { requirePasswordChange }),
    };

    if (positionId !== undefined) {
      updateInput.position = positionId ? { connect: { id: positionId } } : { disconnect: true };
    }

    if (sectorId !== undefined) {
      updateInput.sector = sectorId ? { connect: { id: sectorId } } : { disconnect: true };
    }

    // Note: managedSector is now handled via Sector.managerId relation
    // To make a user a sector manager, update the Sector's managerId field

    if (avatarId !== undefined) {
      updateInput.avatar = avatarId ? { connect: { id: avatarId } } : { disconnect: true };
    }

    // Handle preferences update
    if (preferences) {
      updateInput.preference = { update: preferences };
    }

    // Handle ppeSize update
    if (ppeSize) {
      updateInput.ppeSize = {
        upsert: {
          create: {
            shirts: mapShirtSizeToPrisma(ppeSize.shirts),
            boots: mapBootSizeToPrisma(ppeSize.boots),
            pants: mapPantsSizeToPrisma(ppeSize.pants),
            sleeves: mapSleevesSizeToPrisma(ppeSize.sleeves),
            mask: mapMaskSizeToPrisma(ppeSize.mask),
            gloves: mapGlovesSizeToPrisma(ppeSize.gloves),
            rainBoots: mapRainBootsSizeToPrisma(ppeSize.rainBoots),
          },
          update: {
            shirts: mapShirtSizeToPrisma(ppeSize.shirts),
            boots: mapBootSizeToPrisma(ppeSize.boots),
            pants: mapPantsSizeToPrisma(ppeSize.pants),
            sleeves: mapSleevesSizeToPrisma(ppeSize.sleeves),
            mask: mapMaskSizeToPrisma(ppeSize.mask),
            gloves: mapGlovesSizeToPrisma(ppeSize.gloves),
            rainBoots: mapRainBootsSizeToPrisma(ppeSize.rainBoots),
          },
        },
      };
    }

    return updateInput;
  }

  protected mapIncludeToDatabaseInclude(include?: UserInclude): Prisma.UserInclude | undefined {
    if (!include) return undefined;

    const mappedInclude: any = { ...include };

    // Map tasks to createdTasks since that's the actual Prisma relation name
    if (mappedInclude.tasks !== undefined) {
      mappedInclude.createdTasks = mappedInclude.tasks;
      delete mappedInclude.tasks;
    }

    return mappedInclude as Prisma.UserInclude;
  }

  protected mapOrderByToDatabaseOrderBy(
    orderBy?: UserOrderBy,
  ): Prisma.UserOrderByWithRelationInput | undefined {
    if (!orderBy) return undefined;

    // If orderBy is an array, take the first element
    if (Array.isArray(orderBy)) {
      return orderBy[0] as Prisma.UserOrderByWithRelationInput;
    }

    // Return as is for object
    return orderBy as Prisma.UserOrderByWithRelationInput;
  }

  protected mapWhereToDatabaseWhere(where?: UserWhere): Prisma.UserWhereInput | undefined {
    if (!where) return undefined;

    // First apply generic mapping
    const mappedWhere = mapWhereClause(where) as any;

    // Then handle specific User model mappings
    if (mappedWhere.tasks !== undefined) {
      mappedWhere.createdTasks = mappedWhere.tasks;
      delete mappedWhere.tasks;
    }

    // Handle nested conditions (AND, OR, NOT)
    if (mappedWhere.AND) {
      if (Array.isArray(mappedWhere.AND)) {
        mappedWhere.AND = mappedWhere.AND.map((condition: any) =>
          this.mapWhereToDatabaseWhere(condition),
        );
      } else {
        mappedWhere.AND = this.mapWhereToDatabaseWhere(mappedWhere.AND);
      }
    }

    if (mappedWhere.OR && Array.isArray(mappedWhere.OR)) {
      mappedWhere.OR = mappedWhere.OR.map((condition: any) =>
        this.mapWhereToDatabaseWhere(condition),
      );
    }

    if (mappedWhere.NOT) {
      if (Array.isArray(mappedWhere.NOT)) {
        mappedWhere.NOT = mappedWhere.NOT.map((condition: any) =>
          this.mapWhereToDatabaseWhere(condition),
        );
      } else {
        mappedWhere.NOT = this.mapWhereToDatabaseWhere(mappedWhere.NOT);
      }
    }

    return mappedWhere as Prisma.UserWhereInput;
  }

  protected getDefaultInclude(): Prisma.UserInclude {
    return {
      position: {
        include: {
          remunerations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      sector: true,
      managedSector: true,
      ppeSize: true,
      preference: true,
      _count: {
        select: {
          activities: true,
          vacations: true,
        },
      },
    };
  }

  // Implement abstract methods from base
  async createWithTransaction(
    transaction: PrismaTransaction,
    data: UserCreateFormData,
    options?: CreateOptions<UserInclude>,
  ): Promise<User> {
    try {
      const createInput = this.mapCreateFormDataToDatabaseCreateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.user.create({
        data: createInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError('criar usuário', error, { data });
      throw error;
    }
  }

  async findByIdWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    options?: CreateOptions<UserInclude> & { select?: any },
  ): Promise<User | null> {
    try {
      const useSelect = options?.select && Object.keys(options.select).length > 0;

      const queryArgs = useSelect
        ? { where: { id }, select: options.select }
        : {
            where: { id },
            include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
          };

      const result = await transaction.user.findUnique(queryArgs as any);

      return result ? (useSelect ? (result as any) : this.mapDatabaseEntityToEntity(result)) : null;
    } catch (error) {
      this.logError(`buscar usuário por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<UserInclude> & { select?: any },
  ): Promise<User[]> {
    try {
      const useSelect = options?.select && Object.keys(options.select).length > 0;

      const queryArgs = useSelect
        ? { where: { id: { in: ids } }, select: options.select }
        : {
            where: { id: { in: ids } },
            include: this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude(),
          };

      const results = await transaction.user.findMany(queryArgs as any);

      return useSelect
        ? (results as any[])
        : results.map(result => this.mapDatabaseEntityToEntity(result));
    } catch (error) {
      this.logError('buscar usuários por IDs', error, { ids });
      throw error;
    }
  }

  async findManyWithTransaction(
    transaction: PrismaTransaction,
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
  ): Promise<FindManyResult<User>> {
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
      select,
    } = optionsWithTake as FindManyOptions<UserOrderBy, UserWhere, UserInclude> & {
      take?: number;
      select?: any;
    };
    const skip = Math.max(0, (page - 1) * take);

    // Determine whether to use select or include
    const useSelect = select && Object.keys(select).length > 0;

    const findManyArgs = useSelect
      ? {
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          select,
        }
      : {
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
        };

    const [total, users] = await Promise.all([
      transaction.user.count({
        where: this.mapWhereToDatabaseWhere(where),
      }),
      transaction.user.findMany(findManyArgs as any),
    ]);

    return {
      data: useSelect
        ? (users as any[]) // When using select, return as-is without mapping
        : users.map(user => this.mapDatabaseEntityToEntity(user)),
      meta: this.calculatePagination(total, page, take),
    };
  }

  async updateWithTransaction(
    transaction: PrismaTransaction,
    id: string,
    data: UserUpdateFormData,
    options?: UpdateOptions<UserInclude>,
  ): Promise<User> {
    try {
      const updateInput = this.mapUpdateFormDataToDatabaseUpdateInput(data);
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.user.update({
        where: { id },
        data: updateInput,
        include: includeInput,
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`atualizar usuário ${id}`, error, { data });
      throw error;
    }
  }

  async deleteWithTransaction(transaction: PrismaTransaction, id: string): Promise<User> {
    try {
      const result = await transaction.user.delete({
        where: { id },
        include: this.getDefaultInclude(),
      });

      return this.mapDatabaseEntityToEntity(result);
    } catch (error) {
      this.logError(`deletar usuário ${id}`, error);
      throw error;
    }
  }

  async countWithTransaction(transaction: PrismaTransaction, where?: UserWhere): Promise<number> {
    try {
      const whereInput = this.mapWhereToDatabaseWhere(where);
      return await transaction.user.count({ where: whereInput });
    } catch (error) {
      this.logError('contar usuários', error, { where });
      throw error;
    }
  }

  // User-specific methods
  async findByCpf(cpf: string, tx?: PrismaTransaction): Promise<User | null> {
    try {
      const transaction = tx || this.prisma;
      const result = await transaction.user.findFirst({
        where: { cpf },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar usuário por CPF ${cpf}`, error);
      throw error;
    }
  }

  async findByEmail(email: string, tx?: PrismaTransaction): Promise<User | null> {
    try {
      const transaction = tx || this.prisma;
      const result = await transaction.user.findFirst({
        where: { email },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar usuário por email ${email}`, error);
      throw error;
    }
  }

  async findByPhone(phone: string, tx?: PrismaTransaction): Promise<User | null> {
    try {
      const transaction = tx || this.prisma;
      const result = await transaction.user.findFirst({
        where: { phone },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar usuário por telefone ${phone}`, error);
      throw error;
    }
  }

  async findByPayrollNumber(payrollNumber: number, tx?: PrismaTransaction): Promise<User | null> {
    try {
      const transaction = tx || this.prisma;
      const result = await transaction.user.findFirst({
        where: { payrollNumber },
        include: this.getDefaultInclude(),
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar usuário por número de folha ${payrollNumber}`, error);
      throw error;
    }
  }

  // =====================
  // Optimized Query Methods for Comboboxes
  // =====================

  /**
   * Find users for comboboxes with minimal data (id, name only)
   * This is the most optimized query for simple dropdowns
   */
  async findManyMinimal(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<FindManyResult<{ id: string; name: string }>> {
    try {
      const transaction = tx || this.prisma;
      const optionsWithTake = options
        ? { ...options, take: (options as any).limit || options.take }
        : {};

      const {
        where,
        orderBy,
        page = 1,
        take = 20,
      } = optionsWithTake as FindManyOptions<UserOrderBy, UserWhere, UserInclude> & {
        take?: number;
      };
      const skip = Math.max(0, (page - 1) * take);

      const [total, users] = await Promise.all([
        transaction.user.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.user.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          select: {
            id: true,
            name: true,
          },
        }),
      ]);

      return {
        data: users,
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar usuários (minimal)', error);
      throw error;
    }
  }

  /**
   * Find users with sector information (id, name, sector)
   * Optimized for comboboxes that need to display sector
   */
  async findManyWithSector(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<
    FindManyResult<{ id: string; name: string; sector: { id: string; name: string } | null }>
  > {
    try {
      const transaction = tx || this.prisma;
      const optionsWithTake = options
        ? { ...options, take: (options as any).limit || options.take }
        : {};

      const {
        where,
        orderBy,
        page = 1,
        take = 20,
      } = optionsWithTake as FindManyOptions<UserOrderBy, UserWhere, UserInclude> & {
        take?: number;
      };
      const skip = Math.max(0, (page - 1) * take);

      const [total, users] = await Promise.all([
        transaction.user.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.user.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          select: {
            id: true,
            name: true,
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);

      return {
        data: users,
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar usuários com setor', error);
      throw error;
    }
  }

  /**
   * Find users with position information (id, name, position)
   * Optimized for comboboxes that need to display position
   */
  async findManyWithPosition(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<
    FindManyResult<{ id: string; name: string; position: { id: string; name: string } | null }>
  > {
    try {
      const transaction = tx || this.prisma;
      const optionsWithTake = options
        ? { ...options, take: (options as any).limit || options.take }
        : {};

      const {
        where,
        orderBy,
        page = 1,
        take = 20,
      } = optionsWithTake as FindManyOptions<UserOrderBy, UserWhere, UserInclude> & {
        take?: number;
      };
      const skip = Math.max(0, (page - 1) * take);

      const [total, users] = await Promise.all([
        transaction.user.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.user.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          select: {
            id: true,
            name: true,
            position: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);

      return {
        data: users,
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar usuários com cargo', error);
      throw error;
    }
  }

  /**
   * Find users with both sector and position (id, name, sector, position)
   * Optimized for comboboxes that need to display both
   */
  async findManyWithSectorAndPosition(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<
    FindManyResult<{
      id: string;
      name: string;
      sector: { id: string; name: string } | null;
      position: { id: string; name: string } | null;
    }>
  > {
    try {
      const transaction = tx || this.prisma;
      const optionsWithTake = options
        ? { ...options, take: (options as any).limit || options.take }
        : {};

      const {
        where,
        orderBy,
        page = 1,
        take = 20,
      } = optionsWithTake as FindManyOptions<UserOrderBy, UserWhere, UserInclude> & {
        take?: number;
      };
      const skip = Math.max(0, (page - 1) * take);

      const [total, users] = await Promise.all([
        transaction.user.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.user.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          select: {
            id: true,
            name: true,
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
            position: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);

      return {
        data: users,
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar usuários com setor e cargo', error);
      throw error;
    }
  }

  /**
   * Find users for list views with basic information
   * Includes: id, name, email, phone, status, isActive, avatarId, payrollNumber, sector, position
   */
  async findManyForList(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<
    FindManyResult<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      status: string;
      isActive: boolean;
      avatarId: string | null;
      payrollNumber: number | null;
      sector: { id: string; name: string } | null;
      position: { id: string; name: string } | null;
    }>
  > {
    try {
      const transaction = tx || this.prisma;
      const optionsWithTake = options
        ? { ...options, take: (options as any).limit || options.take }
        : {};

      const {
        where,
        orderBy,
        page = 1,
        take = 20,
      } = optionsWithTake as FindManyOptions<UserOrderBy, UserWhere, UserInclude> & {
        take?: number;
      };
      const skip = Math.max(0, (page - 1) * take);

      const [total, users] = await Promise.all([
        transaction.user.count({
          where: this.mapWhereToDatabaseWhere(where),
        }),
        transaction.user.findMany({
          where: this.mapWhereToDatabaseWhere(where),
          orderBy: this.mapOrderByToDatabaseOrderBy(orderBy) || { name: 'asc' },
          skip,
          take,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            isActive: true,
            avatarId: true,
            payrollNumber: true,
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
            position: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);

      return {
        data: users,
        meta: this.calculatePagination(total, page, take),
      };
    } catch (error) {
      this.logError('buscar usuários para listagem', error);
      throw error;
    }
  }
}
