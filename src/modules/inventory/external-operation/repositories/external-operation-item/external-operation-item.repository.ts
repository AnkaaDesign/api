// repositories/external-operation-item/external-operation-item.repository.ts

import { ExternalOperationItem } from '../../../../../types';
import {
  ExternalOperationItemCreateFormData,
  ExternalOperationItemUpdateFormData,
  ExternalOperationItemInclude,
  ExternalOperationItemOrderBy,
  ExternalOperationItemWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export abstract class ExternalOperationItemRepository extends BaseStringRepository<
  ExternalOperationItem,
  ExternalOperationItemCreateFormData,
  ExternalOperationItemUpdateFormData,
  ExternalOperationItemInclude,
  ExternalOperationItemOrderBy,
  ExternalOperationItemWhere
> {
  // ExternalOperationItem-specific methods can be added here if needed
}
