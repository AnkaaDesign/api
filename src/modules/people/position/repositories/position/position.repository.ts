// repositories/position.repository.ts

import { Position } from '../../../../../types';
import {
  PositionCreateFormData,
  PositionUpdateFormData,
  PositionInclude,
  PositionOrderBy,
  PositionWhere,
} from '../../../../../schemas/position';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export type { PrismaTransaction } from '@modules/common/base/base.repository';

export abstract class PositionRepository extends BaseStringRepository<
  Position,
  PositionCreateFormData,
  PositionUpdateFormData,
  PositionInclude,
  PositionOrderBy,
  PositionWhere
> {
  abstract findByName(name: string): Promise<Position | null>;
}
