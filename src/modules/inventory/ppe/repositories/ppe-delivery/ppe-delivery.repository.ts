// repositories/ppe-delivery.repository.ts

import { PpeDelivery } from '../../../../../types';
import {
  PpeDeliveryCreateFormData,
  PpeDeliveryUpdateFormData,
  PpeDeliveryInclude,
  PpeDeliveryOrderBy,
  PpeDeliveryWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PpeDeliveryRepository extends BaseStringRepository<
  PpeDelivery,
  PpeDeliveryCreateFormData,
  PpeDeliveryUpdateFormData,
  PpeDeliveryInclude,
  PpeDeliveryOrderBy,
  PpeDeliveryWhere
> {}
