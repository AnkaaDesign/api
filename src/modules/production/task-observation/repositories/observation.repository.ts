// repositories/observations.repository.ts

import { Observation } from '../../../../types';
import {
  ObservationCreateFormData,
  ObservationUpdateFormData,
  ObservationInclude,
  ObservationOrderBy,
  ObservationWhere,
} from '../../../../schemas/observation';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ObservationRepository extends BaseStringRepository<
  Observation,
  ObservationCreateFormData,
  ObservationUpdateFormData,
  ObservationInclude,
  ObservationOrderBy,
  ObservationWhere
> {}
