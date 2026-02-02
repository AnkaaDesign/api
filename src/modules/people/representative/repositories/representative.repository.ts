import { Injectable } from '@nestjs/common';
import { BaseStringRepository } from '@/modules/common/base/base-string.repository';
import {
  Representative,
  RepresentativeCreateFormData,
  RepresentativeUpdateFormData,
  RepresentativeInclude,
  RepresentativeOrderBy,
  RepresentativeWhere,
} from '@/types/representative';
import { PrismaTransaction } from '@/types/prisma';

@Injectable()
export abstract class RepresentativeRepository extends BaseStringRepository<
  Representative,
  RepresentativeCreateFormData,
  RepresentativeUpdateFormData,
  RepresentativeInclude,
  RepresentativeOrderBy,
  RepresentativeWhere
> {
  abstract findByEmail(email: string, tx?: PrismaTransaction): Promise<Representative | null>;
  abstract findByPhone(phone: string, tx?: PrismaTransaction): Promise<Representative | null>;
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