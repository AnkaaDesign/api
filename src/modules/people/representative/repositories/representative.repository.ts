import { Injectable } from '@nestjs/common';
import {
  Representative,
  RepresentativeCreateFormData,
  RepresentativeUpdateFormData,
  RepresentativeInclude,
  RepresentativeOrderBy,
  RepresentativeWhere,
} from '@/types/representative';
import { PrismaTransaction } from '@/modules/common/base/base.repository';

/**
 * Abstract repository for Representative entity.
 * Does not extend BaseStringRepository to keep it simple
 * and avoid implementing unused batch/transaction methods.
 */
@Injectable()
export abstract class RepresentativeRepository {
  // Create
  abstract create(
    data: RepresentativeCreateFormData,
    options?: { include?: RepresentativeInclude },
    tx?: PrismaTransaction
  ): Promise<Representative>;

  // Read
  abstract findById(
    id: string,
    options?: { include?: RepresentativeInclude },
    tx?: PrismaTransaction
  ): Promise<Representative | null>;

  abstract findByEmail(
    email: string,
    tx?: PrismaTransaction
  ): Promise<Representative | null>;

  abstract findByPhone(
    phone: string,
    tx?: PrismaTransaction
  ): Promise<Representative | null>;

  abstract findByCustomerIdAndRole(
    customerId: string,
    role: string,
    tx?: PrismaTransaction
  ): Promise<Representative | null>;

  abstract findByCustomerId(
    customerId: string,
    options?: {
      include?: RepresentativeInclude;
      orderBy?: RepresentativeOrderBy;
    },
    tx?: PrismaTransaction
  ): Promise<Representative[]>;

  abstract findMany(
    options?: {
      skip?: number;
      take?: number;
      where?: RepresentativeWhere;
      orderBy?: RepresentativeOrderBy;
      include?: RepresentativeInclude;
    },
    tx?: PrismaTransaction
  ): Promise<Representative[]>;

  // Update
  abstract update(
    id: string,
    data: RepresentativeUpdateFormData,
    options?: { include?: RepresentativeInclude },
    tx?: PrismaTransaction
  ): Promise<Representative>;

  // Delete
  abstract delete(
    id: string,
    tx?: PrismaTransaction
  ): Promise<Representative>;

  // Count
  abstract count(
    where?: RepresentativeWhere,
    tx?: PrismaTransaction
  ): Promise<number>;

  // Session management
  abstract findBySessionToken(
    sessionToken: string,
    tx?: PrismaTransaction
  ): Promise<Representative | null>;

  abstract updateSessionToken(
    id: string,
    sessionToken: string | null,
    tx?: PrismaTransaction
  ): Promise<Representative>;
}
