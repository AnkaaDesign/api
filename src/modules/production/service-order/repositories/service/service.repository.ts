// repositories/service.repository.ts

import { Service } from '../../../../../types';
import {
  ServiceCreateFormData,
  ServiceUpdateFormData,
  ServiceInclude,
  ServiceOrderBy,
  ServiceWhere,
} from '../../../../../schemas/service';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ServiceRepository extends BaseStringRepository<
  Service,
  ServiceCreateFormData,
  ServiceUpdateFormData,
  ServiceInclude,
  ServiceOrderBy,
  ServiceWhere
> {
  // Service-specific methods can be added here if needed
}
