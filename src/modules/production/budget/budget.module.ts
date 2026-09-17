// api/src/modules/production/budget/budget.module.ts

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
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { BudgetRepository } from './repositories/budget.repository';
import { BudgetPrismaRepository } from './repositories/budget-prisma.repository';
import { BudgetPaymentScheduler } from './budget-payment.scheduler';
import { BudgetStatusCascadeService } from './budget-status-cascade.service';
import { BudgetReceiptService } from './budget-receipt.service';
import { BillingStatusModule } from '@modules/financial/billing/billing-status.module';

/**
 * Budget Module
 * Handles all quote management for tasks
 *
 * Features:
 * - CRUD operations for task quotes
 * - Status management (PENDING → SIGNED → APPROVED; EXPIRED e CANCELLED à parte)
 * - Approval workflow with automatic invoice generation quando a COBRANÇA é
 *   aprovada (PUT /billings/:id/approve). O ciclo do pagamento
 *   (APROVADO/PARCIAL/VENCIDO/LIQUIDADO) é do `Billing`, não do orçamento.
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
  imports: [BillingStatusModule, 
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
  controllers: [BudgetController],
  providers: [
    BudgetService,
    BudgetPaymentScheduler,
    BudgetStatusCascadeService,
    BudgetReceiptService,
    {
      provide: BudgetRepository,
      useClass: BudgetPrismaRepository,
    },
  ],
  exports: [BudgetService, BudgetRepository, BudgetStatusCascadeService],
})
/**
 * Liga a conclusão de um envelope de assinatura à aprovação do orçamento.
 *
 * O registro acontece daqui — e não de dentro do módulo de assinatura — porque é
 * este domínio que sabe o que "todos assinaram" significa para o `Budget`.
 */
export class BudgetModule implements OnModuleInit {
  constructor(
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly signatureEnvelopes: SignatureEnvelopeService,
    private readonly budgetService: BudgetService,
  ) {}

  onModuleInit(): void {
    this.signatureEnvelopes.setOnEnvelopeCompleted(async (quoteId, _envelopeId, actorUserId) => {
      await this.budgetService.budgetApprove(quoteId, actorUserId ?? '');
    });

    // O cliente fechou o lado dele; falta a nossa caneta. Momento distinto da
    // conclusão acima e, às vezes, dias antes dela.
    this.signatureEnvelopes.setOnCustomerSideSigned(async quoteId => {
      await this.budgetService.markSigned(quoteId);
    });

    // A validade venceu com assinatura de cliente faltando: o orçamento volta
    // para o comercial reanalisar o valor.
    this.signatureEnvelopes.setOnEnvelopeExpired(async quoteId => {
      await this.budgetService.markExpiredBySignature(quoteId);
    });

    // O cliente recusou e não sobrou ninguém do lado dele para assinar: o valor
    // volta para o comercial reanalisar, como no ramo do vencimento.
    //
    // O gancho já existia e já era disparado; faltava OUVINTE — e sem ouvinte a
    // cerimônia só logava um aviso. Nove envelopes `REFUSED` no acervo têm o
    // orçamento parado em `PENDING`, indistinguível de um criado naquela manhã.
    this.signatureEnvelopes.setOnEnvelopeRefused(async (quoteId, _envelopeId, reason) => {
      await this.budgetService.markRefusedBySignature(quoteId, reason);
    });
  }
}
