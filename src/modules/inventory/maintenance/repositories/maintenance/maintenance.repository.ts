// repositories/maintenance.repository.ts

import { Maintenance } from '../../../../../types';
import {
  MaintenanceCreateFormData,
  MaintenanceUpdateFormData,
  MaintenanceInclude,
  MaintenanceWhere,
  MaintenanceOrderBy,
} from '../../../../../schemas/maintenance';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class MaintenanceRepository extends BaseStringRepository<
  Maintenance,
  MaintenanceCreateFormData,
  MaintenanceUpdateFormData,
  MaintenanceInclude,
  MaintenanceOrderBy,
  MaintenanceWhere
> {
  // Maintenance-specific methods can be added here if needed
}
