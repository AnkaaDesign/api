import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceGenerationService } from './invoice-generation.service';
import { InvoiceAnalyticsService } from './invoice-analytics.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import { InvoicePrismaRepository } from './repositories/invoice-prisma.repository';
import { SicrediModule } from '@modules/integrations/sicredi/sicredi.module';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';

@Module({
  imports: [PrismaModule, SicrediModule, NfseModule],
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
