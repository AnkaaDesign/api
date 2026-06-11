// repositories/external-operation/external-operation.repository.ts

import { ExternalOperation } from '../../../../../types';
import {
  ExternalOperationCreateFormData,
  ExternalOperationUpdateFormData,
  ExternalOperationInclude,
  ExternalOperationOrderBy,
  ExternalOperationWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export abstract class ExternalOperationRepository extends BaseStringRepository<
  ExternalOperation,
  ExternalOperationCreateFormData,
  ExternalOperationUpdateFormData,
  ExternalOperationInclude,
  ExternalOperationOrderBy,
  ExternalOperationWhere
> {
  // ExternalOperation-specific methods can be added here if needed
}
