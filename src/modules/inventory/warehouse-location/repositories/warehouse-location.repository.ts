// repositories/warehouse-location.repository.ts

import { WarehouseLocation } from '../../../../types';
import {
  WarehouseLocationCreateFormData,
  WarehouseLocationUpdateFormData,
  WarehouseLocationInclude,
  WarehouseLocationOrderBy,
  WarehouseLocationWhere,
} from '../../../../schemas/warehouse-location';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class WarehouseLocationRepository extends BaseStringRepository<
  WarehouseLocation,
  WarehouseLocationCreateFormData,
  WarehouseLocationUpdateFormData,
  WarehouseLocationInclude,
  WarehouseLocationOrderBy,
  WarehouseLocationWhere
> {
  // WarehouseLocation-specific methods
  abstract findByCodeAndSection(
    code: string,
    section: string | null,
    tx?: PrismaTransaction,
  ): Promise<WarehouseLocation | null>;
}
