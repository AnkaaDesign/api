// api/src/modules/production/task-pricing/task-pricing.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { TaskPricingController } from './task-pricing.controller';
import { TaskPricingService } from './task-pricing.service';
import { TaskPricingRepository } from './repositories/task-pricing.repository';
import { TaskPricingPrismaRepository } from './repositories/task-pricing-prisma.repository';

/**
 * TaskPricing Module
 * Handles all pricing management for tasks
 *
 * Features:
 * - CRUD operations for task pricing
 * - Status management (DRAFT, APPROVED, REJECTED, CANCELLED)
 * - Approval workflow
 * - Change logging
 *
 * Dependencies:
 * - PrismaModule: Database access
 * - ChangeLogModule: Audit trail
 */
@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [TaskPricingController],
  providers: [
    TaskPricingService,
    {
      provide: TaskPricingRepository,
      useClass: TaskPricingPrismaRepository,
    },
  ],
  exports: [TaskPricingService, TaskPricingRepository],
})
export class TaskPricingModule {}
