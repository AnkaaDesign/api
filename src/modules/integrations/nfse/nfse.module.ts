import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NfseCertificateService } from './nfse-certificate.service';
import { NfseXmlBuilderService } from './nfse-xml-builder.service';
import { NfseXmlSignerService } from './nfse-xml-signer.service';
import { NfseService } from './nfse.service';
import { NfseEmissionScheduler } from './nfse-emission.scheduler';

@Module({
  imports: [PrismaModule],
  providers: [
    NfseCertificateService,
    NfseXmlBuilderService,
    NfseXmlSignerService,
    NfseService,
    NfseEmissionScheduler,
  ],
  exports: [NfseService, NfseEmissionScheduler],
})
export class NfseModule {}
