// apps/api/src/modules/production/implement-measure/repositories/implement-measure.repository.ts

import { ImplementMeasure } from '@prisma/client';
import type { ImplementMeasureCreateFormData, ImplementMeasureUpdateFormData } from '../../../../schemas';
import type { MeasureReference } from '../implement-measure-writer';

export interface ImplementMeasureRepository {
  findById(id: string, include?: any): Promise<ImplementMeasure | null>;
  findByTruckId(truckId: string): Promise<{
    leftSideMeasure: ImplementMeasure | null;
    rightSideMeasure: ImplementMeasure | null;
    backSideMeasure: ImplementMeasure | null;
  }>;
  create(data: ImplementMeasureCreateFormData, userId?: string): Promise<ImplementMeasure>;
  update(
    id: string,
    data: ImplementMeasureUpdateFormData,
    userId?: string,
    afterWrite?: (tx: any, references: MeasureReference[]) => Promise<void>,
  ): Promise<ImplementMeasure>;
  delete(id: string, userId?: string): Promise<void>;
}
