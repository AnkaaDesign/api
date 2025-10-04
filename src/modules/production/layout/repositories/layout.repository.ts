// apps/api/src/modules/production/layout/repositories/layout.repository.ts

import { Layout } from '@prisma/client';
import type { LayoutCreateFormData, LayoutUpdateFormData } from '../../../../schemas';

export interface LayoutRepository {
  findById(id: string, include?: any): Promise<Layout | null>;
  findByTruckId(truckId: string): Promise<{
    leftSideLayout: Layout | null;
    rightSideLayout: Layout | null;
    backSideLayout: Layout | null;
  }>;
  create(data: LayoutCreateFormData, userId?: string): Promise<Layout>;
  update(id: string, data: LayoutUpdateFormData, userId?: string): Promise<Layout>;
  delete(id: string, userId?: string): Promise<void>;
}
