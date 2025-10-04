// repositories/external-withdrawal/external-withdrawal.repository.ts

import { ExternalWithdrawal } from '../../../../../types';
import {
  ExternalWithdrawalCreateFormData,
  ExternalWithdrawalUpdateFormData,
  ExternalWithdrawalInclude,
  ExternalWithdrawalOrderBy,
  ExternalWithdrawalWhere,
} from '../../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export abstract class ExternalWithdrawalRepository extends BaseStringRepository<
  ExternalWithdrawal,
  ExternalWithdrawalCreateFormData,
  ExternalWithdrawalUpdateFormData,
  ExternalWithdrawalInclude,
  ExternalWithdrawalOrderBy,
  ExternalWithdrawalWhere
> {
  // ExternalWithdrawal-specific methods can be added here if needed
}
