// api/src/modules/production/task-pricing/task-pricing.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { InvoiceModule } from '@modules/financial/invoice/invoice.module';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';
import { TaskPricingController } from './task-pricing.controller';
import { TaskPricingService } from './task-pricing.service';
import { TaskPricingRepository } from './repositories/task-pricing.repository';
import { TaskPricingPrismaRepository } from './repositories/task-pricing-prisma.repository';
import { TaskPricingPaymentScheduler } from './task-pricing-payment.scheduler';
import { TaskPricingStatusCascadeService } from './task-pricing-status-cascade.service';

/**
 * TaskPricing Module
 * Handles all pricing management for tasks
 *
 * Features:
 * - CRUD operations for task pricing
 * - Status management (PENDING → BUDGET_APPROVED → VERIFIED → INTERNAL_APPROVED → UPCOMING → PARTIAL → SETTLED)
 * - Approval workflow with automatic invoice generation on INTERNAL_APPROVED
 * - Automated status cascade from payment events
 * - Change logging
 * - Payment reminder notifications
 *
 * Dependencies:
 * - PrismaModule: Database access
 * - ChangeLogModule: Audit trail
 * - NotificationModule: Payment reminders
 * - InvoiceModule: Auto-generate invoices on approval
 */
@Module({
  imports: [PrismaModule, ChangeLogModule, NotificationModule, forwardRef(() => InvoiceModule), NfseModule],
  controllers: [TaskPricingController],
  providers: [
    TaskPricingService,
    TaskPricingPaymentScheduler,
    TaskPricingStatusCascadeService,
    {
      provide: TaskPricingRepository,
      useClass: TaskPricingPrismaRepository,
    },
  ],
  exports: [TaskPricingService, TaskPricingRepository, TaskPricingStatusCascadeService],
})
export class TaskPricingModule {}
