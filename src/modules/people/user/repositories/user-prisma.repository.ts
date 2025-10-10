import { PrismaService } from '@modules/common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { User } from '../../../../types';
import {
  UserCreateFormData,
  UserUpdateFormData,
  UserInclude,
  UserOrderBy,
  UserWhere,
} from '../../../../schemas/user';
import { FindManyOptions, FindManyResult, CreateOptions, UpdateOptions } from '../../../../types';
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
} from '../../../../utils';

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
    const { birth, admissional, dismissal, ...restUser } = databaseEntity;

    const user = {
      ...restUser,
      // Map database field names to entity field names
      birthDate: birth || null,
      hireDate: admissional || null,
      admissional: admissional || null,
      dismissal: dismissal || null,
      // Ensure status timestamp fields are properly mapped
      contractedAt: restUser.contractedAt || null,
      exp1StartAt: restUser.exp1StartAt || null,
      exp1EndAt: restUser.exp1EndAt || null,
      exp2StartAt: restUser.exp2StartAt || null,
      exp2EndAt: restUser.exp2EndAt || null,
      dismissedAt: restUser.dismissedAt || null,
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
      managedSectorId,
      ppeSize,
      notificationPreferences,
      userId,
      admissional,
      birth,
      dismissal,
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
      admissional: admissional || null,
      birth: birth || null,
      dismissal: dismissal || null,
      // Include status timestamp fields if they're in rest (from service layer)
      ...((rest as any).contractedAt !== undefined && { contractedAt: (rest as any).contractedAt }),
      ...((rest as any).exp1StartAt !== undefined && { exp1StartAt: (rest as any).exp1StartAt }),
      ...((rest as any).exp1EndAt !== undefined && { exp1EndAt: (rest as any).exp1EndAt }),
      ...((rest as any).exp2StartAt !== undefined && { exp2StartAt: (rest as any).exp2StartAt }),
      ...((rest as any).exp2EndAt !== undefined && { exp2EndAt: (rest as any).exp2EndAt }),
      ...((rest as any).dismissedAt !== undefined && { dismissedAt: (rest as any).dismissedAt }),
    };

    if (positionId) {
      createInput.position = { connect: { id: positionId } };
    }

    if (sectorId) {
      createInput.sector = { connect: { id: sectorId } };
    }

    if (managedSectorId) {
      createInput.managedSector = { connect: { id: managedSectorId } };
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
      managedSectorId,
      preferences,
      userId,
      status,
      verificationType,
      verificationCode,
      verificationExpiresAt,
      requirePasswordChange,
      admissional,
      birth,
      dismissal,
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
      // Map date fields to Prisma model field names
      ...(admissional !== undefined && { admissional }),
      ...(birth !== undefined && { birth }),
      ...(dismissal !== undefined && { dismissal }),
      // Include status timestamp fields if they're in rest (from service layer)
      ...((rest as any).contractedAt !== undefined && { contractedAt: (rest as any).contractedAt }),
      ...((rest as any).exp1StartAt !== undefined && { exp1StartAt: (rest as any).exp1StartAt }),
      ...((rest as any).exp1EndAt !== undefined && { exp1EndAt: (rest as any).exp1EndAt }),
      ...((rest as any).exp2StartAt !== undefined && { exp2StartAt: (rest as any).exp2StartAt }),
      ...((rest as any).exp2EndAt !== undefined && { exp2EndAt: (rest as any).exp2EndAt }),
      ...((rest as any).dismissedAt !== undefined && { dismissedAt: (rest as any).dismissedAt }),
    };

    if (positionId !== undefined) {
      updateInput.position = positionId ? { connect: { id: positionId } } : { disconnect: true };
    }

    if (sectorId !== undefined) {
      updateInput.sector = sectorId ? { connect: { id: sectorId } } : { disconnect: true };
    }

    if (managedSectorId !== undefined) {
      updateInput.managedSector = managedSectorId
        ? { connect: { id: managedSectorId } }
        : { disconnect: true };
    }

    // Handle preferences update
    if (preferences) {
      updateInput.preference = { update: preferences };
    }

    // Handle PPE size update (upsert - create if doesn't exist, update if it does)
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

    // If it's an array, take the first element to satisfy type requirements
    // Prisma supports both single object and array of objects for orderBy at runtime
    if (Array.isArray(orderBy)) {
      return orderBy[0] as Prisma.UserOrderByWithRelationInput;
    }

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
    options?: CreateOptions<UserInclude>,
  ): Promise<User | null> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const result = await transaction.user.findUnique({
        where: { id },
        include: includeInput,
      });

      return result ? this.mapDatabaseEntityToEntity(result) : null;
    } catch (error) {
      this.logError(`buscar usuário por ID ${id}`, error);
      throw error;
    }
  }

  async findByIdsWithTransaction(
    transaction: PrismaTransaction,
    ids: string[],
    options?: CreateOptions<UserInclude>,
  ): Promise<User[]> {
    try {
      const includeInput =
        this.mapIncludeToDatabaseInclude(options?.include) || this.getDefaultInclude();

      const results = await transaction.user.findMany({
        where: { id: { in: ids } },
        include: includeInput,
      });

      return results.map(result => this.mapDatabaseEntityToEntity(result));
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
    } = optionsWithTake as FindManyOptions<UserOrderBy, UserWhere, UserInclude> & { take?: number };
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
        include: this.mapIncludeToDatabaseInclude(include) || this.getDefaultInclude(),
      }),
    ]);

    return {
      data: users.map(user => this.mapDatabaseEntityToEntity(user)),
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
}
