// repositories/position-remuneration.repository.ts

import { PositionRemuneration } from '../../../../../types';
import {
  PositionRemunerationCreateFormData,
  PositionRemunerationUpdateFormData,
  PositionRemunerationInclude,
  PositionRemunerationOrderBy,
  PositionRemunerationWhere,
} from '../../../../../schemas/position';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PositionRemunerationRepository extends BaseStringRepository<
  PositionRemuneration,
  PositionRemunerationCreateFormData,
  PositionRemunerationUpdateFormData,
  PositionRemunerationInclude,
  PositionRemunerationOrderBy,
  PositionRemunerationWhere
> {
  // Position-remuneration-specific methods can be added here if needed
}
