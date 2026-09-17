import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceGenerationService } from './invoice-generation.service';
import { InvoiceAnalyticsService } from './invoice-analytics.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import { InvoicePrismaRepository } from './repositories/invoice-prisma.repository';
import { SicrediModule } from '@modules/integrations/sicredi/sicredi.module';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { FilesStorageModule } from '@modules/common/file/services/files-storage.module';
// forwardRef: BudgetModule imports this module back (invoice generation on approval),
// so the pair is circular by design.
import { BudgetModule } from '@modules/production/budget/budget.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { BillingStatusModule } from '@modules/financial/billing/billing-status.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    // Só o Prisma por baixo — ver `BillingStatusModule`. Não fecha ciclo.
    BillingStatusModule,
    SicrediModule,
    NfseModule,
    NotificationModule,
    FilesStorageModule,
    forwardRef(() => BudgetModule),
  ],
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    InvoiceGenerationService,
    InvoiceAnalyticsService,
    { provide: InvoiceRepository, useClass: InvoicePrismaRepository },
  ],
  exports: [InvoiceService, InvoiceGenerationService],
})
export class InvoiceModule {}
