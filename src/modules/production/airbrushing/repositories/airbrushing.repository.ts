// repositories/airbrushing.repository.ts

import { Airbrushing } from '../../../../types';
import {
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingInclude,
  AirbrushingOrderBy,
  AirbrushingWhere,
} from '../../../../schemas/airbrushing';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';
export abstract class AirbrushingRepository extends BaseStringRepository<
  Airbrushing,
  AirbrushingCreateFormData,
  AirbrushingUpdateFormData,
  AirbrushingInclude,
  AirbrushingOrderBy,
  AirbrushingWhere
> {
  // Airbrushing-specific methods
}
