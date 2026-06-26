import type { PrismaTransaction } from '@modules/common/base/base.repository';
import type {
  DiscountCreateFormData,
  DiscountUpdateFormData,
} from '../../../../../schemas/discount';
import type { Discount } from '../../../../../types';

export abstract class DiscountRepository {
  abstract create(data: DiscountCreateFormData, tx?: PrismaTransaction): Promise<Discount>;
  abstract createMany(data: DiscountCreateFormData[], tx?: PrismaTransaction): Promise<Discount[]>;
  abstract update(
    id: string,
    data: DiscountUpdateFormData,
    tx?: PrismaTransaction,
  ): Promise<Discount>;
  abstract findById(id: string): Promise<Discount | null>;
  abstract findMany(options: any): Promise<any>;
  abstract findByPayroll(payrollId: string): Promise<Discount[]>;
  abstract delete(id: string, tx?: PrismaTransaction): Promise<void>;
  abstract deleteMany(ids: string[], tx?: PrismaTransaction): Promise<void>;
  abstract count(where?: any): Promise<number>;
}
