import {
  MaintenanceItemCreateFormData,
  MaintenanceItemUpdateFormData,
  MaintenanceItemInclude,
  MaintenanceItemWhere,
  MaintenanceItemOrderBy,
} from '../../../../../schemas/maintenance';
import { MaintenanceItem } from '../../../../../types';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class MaintenanceItemRepository extends BaseStringRepository<
  MaintenanceItem,
  MaintenanceItemCreateFormData,
  MaintenanceItemUpdateFormData,
  MaintenanceItemInclude,
  MaintenanceItemOrderBy,
  MaintenanceItemWhere
> {
  // MaintenanceItem-specific methods can be added here if needed
}
