import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PaintProduction } from '../../../../types';
import {
  PaintProductionCreateFormData,
  PaintProductionUpdateFormData,
  PaintProductionInclude,
  PaintProductionOrderBy,
  PaintProductionWhere,
} from '../../../../schemas/paint';

export abstract class PaintProductionRepository extends BaseStringRepository<
  PaintProduction,
  PaintProductionCreateFormData,
  PaintProductionUpdateFormData,
  PaintProductionInclude,
  PaintProductionOrderBy,
  PaintProductionWhere
> {}
