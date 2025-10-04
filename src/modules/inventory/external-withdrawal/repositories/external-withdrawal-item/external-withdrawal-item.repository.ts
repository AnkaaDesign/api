// repositories/external-withdrawal-item/external-withdrawal-item.repository.ts

import { ExternalWithdrawalItem } from '../../../../../types';
import {
  ExternalWithdrawalItemCreateFormData,
  ExternalWithdrawalItemUpdateFormData,
  ExternalWithdrawalItemInclude,
  ExternalWithdrawalItemOrderBy,
  ExternalWithdrawalItemWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export abstract class ExternalWithdrawalItemRepository extends BaseStringRepository<
  ExternalWithdrawalItem,
  ExternalWithdrawalItemCreateFormData,
  ExternalWithdrawalItemUpdateFormData,
  ExternalWithdrawalItemInclude,
  ExternalWithdrawalItemOrderBy,
  ExternalWithdrawalItemWhere
> {
  // ExternalWithdrawalItem-specific methods can be added here if needed
}
