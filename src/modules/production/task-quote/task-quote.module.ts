// api/src/modules/production/task-quote/task-quote.module.ts

import { Module, forwardRef, Inject, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { SignatureModule } from '@modules/common/signature/signature.module';
import { SignatureEnvelopeService } from '@modules/common/signature/services/signature-envelope.service';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { FileModule } from '@modules/common/file/file.module';
import { InvoiceModule } from '@modules/financial/invoice/invoice.module';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';
import { SicrediModule } from '@modules/integrations/sicredi/sicredi.module';
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
 * - Status management (PENDING → BUDGET_APPROVED → BILLING_APPROVED → UPCOMING → DUE → PARTIAL → SETTLED)
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
  imports: [
    PrismaModule,
    ChangeLogModule,
    NotificationModule,
    FileModule,
    forwardRef(() => InvoiceModule),
    NfseModule,
    // forwardRef: SicrediModule imports this module back (cascade service); a direct
    // reference is undefined when the ESM cycle is entered from the Invoice/Sicredi side.
    forwardRef(() => SicrediModule),
    forwardRef(() => SignatureModule),
  ],
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
/**
 * Liga a conclusão de um envelope de assinatura à aprovação do orçamento.
 *
 * O registro acontece daqui — e não de dentro do módulo de assinatura — porque é
 * este domínio que sabe o que "todos assinaram" significa para o `TaskQuote`.
 */
export class TaskQuoteModule implements OnModuleInit {
  constructor(
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly signatureEnvelopes: SignatureEnvelopeService,
    private readonly taskQuoteService: TaskQuoteService,
  ) {}

  onModuleInit(): void {
    this.signatureEnvelopes.setOnEnvelopeCompleted(async (quoteId, _envelopeId, actorUserId) => {
      await this.taskQuoteService.budgetApprove(quoteId, actorUserId ?? '');
    });
  }
}
