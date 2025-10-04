// repositories/activity.repository.ts

import { Activity } from '../../../../types';
import {
  ActivityCreateFormData,
  ActivityUpdateFormData,
  ActivityInclude,
  ActivityOrderBy,
  ActivityWhere,
} from '../../../../schemas/activity';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ActivityRepository extends BaseStringRepository<
  Activity,
  ActivityCreateFormData,
  ActivityUpdateFormData,
  ActivityInclude,
  ActivityOrderBy,
  ActivityWhere
> {
  // Activity-specific methods can be added here if needed
}
