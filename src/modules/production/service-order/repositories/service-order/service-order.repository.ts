// repositories/service-order.repository.ts

import { ServiceOrder } from '../../../../../types';
import {
  ServiceOrderCreateFormData,
  ServiceOrderUpdateFormData,
  ServiceOrderInclude,
  ServiceOrderOrderBy,
  ServiceOrderWhere,
} from '../../../../../schemas/serviceOrder';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class ServiceOrderRepository extends BaseStringRepository<
  ServiceOrder,
  ServiceOrderCreateFormData,
  ServiceOrderUpdateFormData,
  ServiceOrderInclude,
  ServiceOrderOrderBy,
  ServiceOrderWhere
> {}
