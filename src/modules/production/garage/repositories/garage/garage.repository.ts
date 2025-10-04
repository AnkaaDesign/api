// repositories/garage.repository.ts

import { Garage } from '../../../../../types';
import {
  GarageCreateFormData,
  GarageUpdateFormData,
  GarageInclude,
  GarageOrderBy,
  GarageWhere,
} from '../../../../../schemas/garage';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class GarageRepository extends BaseStringRepository<
  Garage,
  GarageCreateFormData,
  GarageUpdateFormData,
  GarageInclude,
  GarageOrderBy,
  GarageWhere
> {
  // Garage-specific methods can be added here if needed
}
