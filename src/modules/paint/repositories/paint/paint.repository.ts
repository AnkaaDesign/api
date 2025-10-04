// repositories/paint.repository.ts

import { Paint } from '../../../../types';
import {
  PaintCreateFormData,
  PaintUpdateFormData,
  PaintInclude,
  PaintOrderBy,
  PaintWhere,
} from '../../../../schemas/paint';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PaintRepository extends BaseStringRepository<
  Paint,
  PaintCreateFormData,
  PaintUpdateFormData,
  PaintInclude,
  PaintOrderBy,
  PaintWhere
> {
  // Paint-specific methods can be added here if needed
}
