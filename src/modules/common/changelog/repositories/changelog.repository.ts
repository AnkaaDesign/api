import type { ChangeLog } from '../../../../types';
import type {
  ChangeLogCreateFormData,
  ChangeLogUpdateFormData,
  ChangeLogInclude,
  ChangeLogOrderBy,
  ChangeLogWhere,
} from '../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ChangeLogRepository extends BaseStringRepository<
  ChangeLog,
  ChangeLogCreateFormData,
  ChangeLogUpdateFormData,
  ChangeLogInclude,
  ChangeLogOrderBy,
  ChangeLogWhere
> {}
