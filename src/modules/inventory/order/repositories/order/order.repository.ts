// repositories/order.repository.ts

import { Order } from '../../../../../types';
import {
  OrderCreateFormData,
  OrderUpdateFormData,
  OrderInclude,
  OrderWhere,
  OrderOrderBy,
} from '../../../../../schemas/order';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { ORDER_STATUS } from '../../../../../constants/enums';

// Order Repository
export abstract class OrderRepository extends BaseStringRepository<
  Order,
  OrderCreateFormData,
  OrderUpdateFormData,
  OrderInclude,
  OrderOrderBy,
  OrderWhere
> {}
