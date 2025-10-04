// repositories/paint-formula.repository.ts

import { PaintFormula } from '../../../../types';
import {
  PaintFormulaCreateFormData,
  PaintFormulaUpdateFormData,
  PaintFormulaInclude,
  PaintFormulaOrderBy,
  PaintFormulaWhere,
} from '../../../../schemas/paint';
import { BaseStringRepository } from '@modules/common/base/base-string.repository';

export abstract class PaintFormulaRepository extends BaseStringRepository<
  PaintFormula,
  PaintFormulaCreateFormData,
  PaintFormulaUpdateFormData,
  PaintFormulaInclude,
  PaintFormulaOrderBy,
  PaintFormulaWhere
> {
  // PaintFormula-specific methods can be added here if needed
}
