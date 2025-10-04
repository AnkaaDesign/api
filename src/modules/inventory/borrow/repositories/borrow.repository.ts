// repositories/borrow.repository.ts

import { Borrow } from '../../../../types';
import {
  BorrowCreateFormData,
  BorrowUpdateFormData,
  BorrowInclude,
  BorrowOrderBy,
  BorrowWhere,
} from '../../../../schemas/borrow';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class BorrowRepository extends BaseStringRepository<
  Borrow,
  BorrowCreateFormData,
  BorrowUpdateFormData,
  BorrowInclude,
  BorrowOrderBy,
  BorrowWhere
> {
  // Find all unreturned borrows for a specific item
  abstract findUnreturnedByItem(itemId: string): Promise<Borrow[]>;

  // Get the total unreturned quantity for a specific item
  abstract getTotalUnreturnedQuantity(itemId: string): Promise<number>;
}
