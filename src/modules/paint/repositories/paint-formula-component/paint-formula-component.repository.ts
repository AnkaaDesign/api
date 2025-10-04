import { BaseStringRepository } from '@modules/common/base/base-string.repository';
import { PaintFormulaComponent } from '../../../../types';
import {
  PaintFormulaComponentCreateFormData,
  PaintFormulaComponentUpdateFormData,
  PaintFormulaComponentInclude,
  PaintFormulaComponentOrderBy,
  PaintFormulaComponentWhere,
} from '../../../../schemas/paint';

export abstract class PaintFormulaComponentRepository extends BaseStringRepository<
  PaintFormulaComponent,
  PaintFormulaComponentCreateFormData,
  PaintFormulaComponentUpdateFormData,
  PaintFormulaComponentInclude,
  PaintFormulaComponentOrderBy,
  PaintFormulaComponentWhere
> {}
