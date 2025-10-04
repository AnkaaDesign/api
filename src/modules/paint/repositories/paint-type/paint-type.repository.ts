import { PaintType } from '../../../../types';
import {
  PaintTypeCreateFormData,
  PaintTypeUpdateFormData,
  PaintTypeInclude,
  PaintTypeOrderBy,
  PaintTypeWhere,
} from '../../../../schemas/paint';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PaintTypeRepository extends BaseStringRepository<
  PaintType,
  PaintTypeCreateFormData,
  PaintTypeUpdateFormData,
  PaintTypeInclude,
  PaintTypeOrderBy,
  PaintTypeWhere
> {
  /**
   * Find a paint type by name
   * @param name The name to search for
   * @param options Optional includes
   * @returns The paint type if found, null otherwise
   */
  abstract findByName(
    name: string,
    options?: { include?: PaintTypeInclude },
  ): Promise<PaintType | null>;

  /**
   * Find a paint type by name within a transaction
   * @param transaction The Prisma transaction
   * @param name The name to search for
   * @param options Optional includes
   * @returns The paint type if found, null otherwise
   */
  abstract findByNameWithTransaction(
    transaction: PrismaTransaction,
    name: string,
    options?: { include?: PaintTypeInclude },
  ): Promise<PaintType | null>;
}
