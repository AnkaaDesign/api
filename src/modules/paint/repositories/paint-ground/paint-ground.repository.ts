// paint-ground.repository.ts

import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PaintGround } from '../../../../types';
import type {
  PaintGroundCreateFormData,
  PaintGroundUpdateFormData,
  PaintGroundInclude,
  PaintGroundOrderBy,
  PaintGroundWhere,
} from '../../../../schemas/paint';
import { PrismaTransaction } from '@modules/common/base/base.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PaintGroundRepository extends BaseStringRepository<
  PaintGround,
  PaintGroundCreateFormData,
  PaintGroundUpdateFormData,
  PaintGroundInclude,
  PaintGroundOrderBy,
  PaintGroundWhere
> {}
