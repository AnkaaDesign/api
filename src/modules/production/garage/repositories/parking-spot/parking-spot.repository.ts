// repositories/parking-spot.repository.ts

import { ParkingSpot } from '../../../../../types';
import {
  ParkingSpotCreateFormData,
  ParkingSpotUpdateFormData,
  ParkingSpotInclude,
  ParkingSpotOrderBy,
  ParkingSpotWhere,
} from '../../../../../schemas/garage';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ParkingSpotRepository extends BaseStringRepository<
  ParkingSpot,
  ParkingSpotCreateFormData,
  ParkingSpotUpdateFormData,
  ParkingSpotInclude,
  ParkingSpotOrderBy,
  ParkingSpotWhere
> {
  // ParkingSpot-specific methods can be added here if needed
}
