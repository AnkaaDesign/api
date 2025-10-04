// repositories/supplier.repository.ts

import { Supplier } from '../../../../types';
import {
  SupplierCreateFormData,
  SupplierUpdateFormData,
  SupplierInclude,
  SupplierOrderBy,
  SupplierWhere,
} from '../../../../schemas/supplier';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class SupplierRepository extends BaseStringRepository<
  Supplier,
  SupplierCreateFormData,
  SupplierUpdateFormData,
  SupplierInclude,
  SupplierOrderBy,
  SupplierWhere
> {
  // Supplier-specific methods
  abstract findByCnpj(cnpj: string, tx?: PrismaTransaction): Promise<Supplier | null>;
  abstract findByEmail(email: string, tx?: PrismaTransaction): Promise<Supplier | null>;
}
