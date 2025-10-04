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
import { PrismaTransaction } from '@modules/common/base/base.repository';

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
}
