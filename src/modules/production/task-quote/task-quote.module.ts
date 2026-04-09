// api/src/modules/production/task-quote/task-quote.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { InvoiceModule } from '@modules/financial/invoice/invoice.module';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';
import { TaskQuoteController } from './task-quote.controller';
import { TaskQuoteService } from './task-quote.service';
import { TaskQuoteRepository } from './repositories/task-quote.repository';
import { TaskQuotePrismaRepository } from './repositories/task-quote-prisma.repository';
import { TaskQuotePaymentScheduler } from './task-quote-payment.scheduler';
import { TaskQuoteStatusCascadeService } from './task-quote-status-cascade.service';

/**
 * TaskQuote Module
 * Handles all quote management for tasks
 *
 * Features:
 * - CRUD operations for task quotes
 * - Status management (PENDING → BUDGET_APPROVED → COMMERCIAL_APPROVED → BILLING_APPROVED → UPCOMING → DUE → PARTIAL → SETTLED)
 * - Approval workflow with automatic invoice generation on BILLING_APPROVED
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
  controllers: [TaskQuoteController],
  providers: [
    TaskQuoteService,
    TaskQuotePaymentScheduler,
    TaskQuoteStatusCascadeService,
    {
      provide: TaskQuoteRepository,
      useClass: TaskQuotePrismaRepository,
    },
  ],
  exports: [TaskQuoteService, TaskQuoteRepository, TaskQuoteStatusCascadeService],
})
export class TaskQuoteModule {}
