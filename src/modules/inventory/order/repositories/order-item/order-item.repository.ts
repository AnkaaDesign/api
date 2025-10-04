// repositories/order-item.repository.ts

import { OrderItem } from '../../../../../types';
import {
  OrderItemCreateFormData,
  OrderItemUpdateFormData,
  OrderItemInclude,
  OrderItemWhere,
  OrderItemOrderBy,
} from '../../../../../schemas/order';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export abstract class OrderItemRepository extends BaseStringRepository<
  OrderItem,
  OrderItemCreateFormData,
  OrderItemUpdateFormData,
  OrderItemInclude,
  OrderItemOrderBy,
  OrderItemWhere
> {}
