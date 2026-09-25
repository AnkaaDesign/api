// apps/api/src/modules/production/implement-measure/repositories/implement-measure.repository.ts

import { ImplementMeasure } from '@prisma/client';
import type { ImplementMeasureCreateFormData, ImplementMeasureUpdateFormData } from '../../../../schemas';
import type { FACE_REL, ImplementFace, MeasureReference } from '../implement-measure-writer';

/** A medida corrente de cada face, pela relação (`leftSideMeasure`, …, `frontSideMeasure`). */
export type ImplementMeasuresByFace = Record<(typeof FACE_REL)[ImplementFace], ImplementMeasure | null>;

export interface ImplementMeasureRepository {
  findById(id: string, include?: any): Promise<ImplementMeasure | null>;
  findByImplementId(implementId: string): Promise<ImplementMeasuresByFace>;
  create(data: ImplementMeasureCreateFormData, userId?: string): Promise<ImplementMeasure>;
  update(
    id: string,
    data: ImplementMeasureUpdateFormData,
    userId?: string,
    afterWrite?: (tx: any, references: MeasureReference[]) => Promise<void>,
  ): Promise<ImplementMeasure>;
  delete(id: string, userId?: string): Promise<void>;
}
