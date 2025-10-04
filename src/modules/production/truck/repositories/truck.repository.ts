// repositories/truck.repository.ts

import { Truck } from '../../../../types';
import {
  TruckCreateFormData,
  TruckUpdateFormData,
  TruckInclude,
  TruckOrderBy,
  TruckWhere,
} from '../../../../schemas/truck';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class TruckRepository extends BaseStringRepository<
  Truck,
  TruckCreateFormData,
  TruckUpdateFormData,
  TruckInclude,
  TruckOrderBy,
  TruckWhere
> {
  /**
   * Find truck by license plate (through task relation)
   */
  abstract findByLicensePlate(
    plate: string,
    options?: { include?: TruckInclude },
  ): Promise<Truck | null>;

  /**
   * Find truck by license plate within a transaction
   */
  abstract findByLicensePlateWithTransaction(
    transaction: PrismaTransaction,
    plate: string,
    options?: { include?: TruckInclude },
  ): Promise<Truck | null>;

  /**
   * Find truck by chassis (if chassis field exists in task)
   */
  abstract findByChassis(
    chassis: string,
    options?: { include?: TruckInclude },
  ): Promise<Truck | null>;

  /**
   * Find truck by chassis within a transaction
   */
  abstract findByChassisWithTransaction(
    transaction: PrismaTransaction,
    chassis: string,
    options?: { include?: TruckInclude },
  ): Promise<Truck | null>;
}
