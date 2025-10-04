// repositories/customer.repository.ts

import { Customer } from '../../../../types';
import {
  CustomerCreateFormData,
  CustomerUpdateFormData,
  CustomerInclude,
  CustomerOrderBy,
  CustomerWhere,
} from '../../../../schemas/customer';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';
export abstract class CustomerRepository extends BaseStringRepository<
  Customer,
  CustomerCreateFormData,
  CustomerUpdateFormData,
  CustomerInclude,
  CustomerOrderBy,
  CustomerWhere
> {
  // Customer-specific methods
  abstract findByCpf(cpf: string, tx?: PrismaTransaction): Promise<Customer | null>;
  abstract findByCnpj(cnpj: string, tx?: PrismaTransaction): Promise<Customer | null>;
  abstract findByEmail(email: string, tx?: PrismaTransaction): Promise<Customer | null>;
}
