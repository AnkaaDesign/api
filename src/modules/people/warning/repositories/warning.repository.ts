// repositories/warning.repository.ts

import { Warning } from '../../../../types';
import {
  WarningCreateFormData,
  WarningUpdateFormData,
  WarningInclude,
  WarningOrderBy,
  WarningWhere,
} from '../../../../schemas';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class WarningRepository extends BaseStringRepository<
  Warning,
  WarningCreateFormData,
  WarningUpdateFormData,
  WarningInclude,
  WarningOrderBy,
  WarningWhere
> {
  // Warning-specific methods can be added here if needed
}
