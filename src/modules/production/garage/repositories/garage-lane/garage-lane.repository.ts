// repositories/garage-lane.repository.ts

import { GarageLane } from '../../../../../types';
import {
  GarageLaneCreateFormData,
  GarageLaneUpdateFormData,
  GarageLaneInclude,
  GarageLaneOrderBy,
  GarageLaneWhere,
} from '../../../../../schemas/garage';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class GarageLaneRepository extends BaseStringRepository<
  GarageLane,
  GarageLaneCreateFormData,
  GarageLaneUpdateFormData,
  GarageLaneInclude,
  GarageLaneOrderBy,
  GarageLaneWhere
> {
  // GarageLane-specific methods can be added here if needed
}
