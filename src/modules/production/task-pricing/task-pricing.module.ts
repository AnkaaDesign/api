// api/src/modules/production/task-pricing/task-pricing.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { TaskPricingController } from './task-pricing.controller';
import { TaskPricingService } from './task-pricing.service';
import { TaskPricingRepository } from './repositories/task-pricing.repository';
import { TaskPricingPrismaRepository } from './repositories/task-pricing-prisma.repository';
import { TaskPricingPaymentScheduler } from './task-pricing-payment.scheduler';

/**
 * TaskPricing Module
 * Handles all pricing management for tasks
 *
 * Features:
 * - CRUD operations for task pricing
 * - Status management (DRAFT, APPROVED, REJECTED, CANCELLED)
 * - Approval workflow
 * - Change logging
 * - Payment reminder notifications
 *
 * Dependencies:
 * - PrismaModule: Database access
 * - ChangeLogModule: Audit trail
 * - NotificationModule: Payment reminders
 */
@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule],
  controllers: [TaskPricingController],
  providers: [
    TaskPricingService,
    TaskPricingPaymentScheduler,
    {
      provide: TaskPricingRepository,
      useClass: TaskPricingPrismaRepository,
    },
  ],
  exports: [TaskPricingService, TaskPricingRepository],
})
export class TaskPricingModule {}
