import { Injectable } from '@nestjs/common';
import {
  Responsible,
  ResponsibleCreateFormData,
  ResponsibleUpdateFormData,
  ResponsibleInclude,
  ResponsibleOrderBy,
  ResponsibleWhere,
} from '@/types/responsible';
import { PrismaTransaction } from '@/modules/common/base/base.repository';

/**
 * Abstract repository for Responsible entity.
 * Does not extend BaseStringRepository to keep it simple
 * and avoid implementing unused batch/transaction methods.
 */
@Injectable()
export abstract class ResponsibleRepository {
  // Create
  abstract create(
    data: ResponsibleCreateFormData,
    options?: { include?: ResponsibleInclude },
    tx?: PrismaTransaction,
  ): Promise<Responsible>;

  // Read
  abstract findById(
    id: string,
    options?: { include?: ResponsibleInclude },
    tx?: PrismaTransaction,
  ): Promise<Responsible | null>;

  abstract findByEmail(email: string, tx?: PrismaTransaction): Promise<Responsible | null>;

  abstract findByPhone(phone: string, tx?: PrismaTransaction): Promise<Responsible | null>;

  abstract findByCompanyIdAndRole(
    companyId: string,
    role: string,
    tx?: PrismaTransaction,
  ): Promise<Responsible | null>;

  abstract findByCompanyId(
    companyId: string,
    options?: {
      include?: ResponsibleInclude;
      orderBy?: ResponsibleOrderBy;
    },
    tx?: PrismaTransaction,
  ): Promise<Responsible[]>;

  abstract findMany(
    options?: {
      skip?: number;
      take?: number;
      where?: ResponsibleWhere;
      orderBy?: ResponsibleOrderBy;
      include?: ResponsibleInclude;
    },
    tx?: PrismaTransaction,
  ): Promise<Responsible[]>;

  // Update
  abstract update(
    id: string,
    data: ResponsibleUpdateFormData,
    options?: { include?: ResponsibleInclude },
    tx?: PrismaTransaction,
  ): Promise<Responsible>;

  // Delete
  abstract delete(id: string, tx?: PrismaTransaction): Promise<Responsible>;

  // Count
  abstract count(where?: ResponsibleWhere, tx?: PrismaTransaction): Promise<number>;

  // Session management
  abstract findBySessionToken(
    sessionToken: string,
    tx?: PrismaTransaction,
  ): Promise<Responsible | null>;

  abstract updateSessionToken(
    id: string,
    sessionToken: string | null,
    tx?: PrismaTransaction,
  ): Promise<Responsible>;
}
