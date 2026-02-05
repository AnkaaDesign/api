// repositories/user.repository.ts

import { User } from '../../../../types';
import {
  UserCreateFormData,
  UserUpdateFormData,
  UserInclude,
  UserOrderBy,
  UserWhere,
} from '../../../../schemas/user';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import {
  PrismaTransaction,
  FindManyOptions,
  FindManyResult,
} from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class UserRepository extends BaseStringRepository<
  User,
  UserCreateFormData,
  UserUpdateFormData,
  UserInclude,
  UserOrderBy,
  UserWhere
> {
  // User-specific methods
  abstract findByCpf(cpf: string, tx?: PrismaTransaction): Promise<User | null>;
  abstract findByEmail(email: string, tx?: PrismaTransaction): Promise<User | null>;
  abstract findByPhone(phone: string, tx?: PrismaTransaction): Promise<User | null>;
  abstract findByPayrollNumber(payrollNumber: number, tx?: PrismaTransaction): Promise<User | null>;

  // Optimized query methods for comboboxes
  abstract findManyMinimal(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<FindManyResult<{ id: string; name: string }>>;

  abstract findManyWithSector(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<
    FindManyResult<{ id: string; name: string; sector: { id: string; name: string } | null }>
  >;

  abstract findManyWithPosition(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<
    FindManyResult<{ id: string; name: string; position: { id: string; name: string } | null }>
  >;

  abstract findManyWithSectorAndPosition(
    options?: FindManyOptions<UserOrderBy, UserWhere, UserInclude>,
    tx?: PrismaTransaction,
  ): Promise<
    FindManyResult<{
      id: string;
      name: string;
      sector: { id: string; name: string } | null;
      position: { id: string; name: string } | null;
    }>
  >;

  abstract findManyForList(
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
  >;
}
