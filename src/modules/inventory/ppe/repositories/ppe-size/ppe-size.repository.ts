import { PpeSize } from '../../../../../types';
import {
  PpeSizeCreateFormData,
  PpeSizeUpdateFormData,
  PpeSizeInclude,
  PpeSizeOrderBy,
  PpeSizeWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { CreateOptions } from '../../../../../types';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PpeSizeRepository extends BaseStringRepository<
  PpeSize,
  PpeSizeCreateFormData,
  PpeSizeUpdateFormData,
  PpeSizeInclude,
  PpeSizeOrderBy,
  PpeSizeWhere
> {
  abstract findByUserId(
    userId: string,
    options?: CreateOptions<PpeSizeInclude>,
  ): Promise<PpeSize | null>;
}
