import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NfseCertificateService } from './nfse-certificate.service';
import { NfseXmlBuilderService } from './nfse-xml-builder.service';
import { NfseXmlSignerService } from './nfse-xml-signer.service';
import { NfseService } from './nfse.service';
import { NfseEmissionScheduler } from './nfse-emission.scheduler';
import { ElotechOxyAuthService } from './elotech-oxy-auth.service';
import { ElotechOxyNfseService } from './elotech-oxy-nfse.service';
import { NfseController } from './nfse.controller';

@Module({
  imports: [PrismaModule],
  controllers: [NfseController],
  providers: [
    NfseCertificateService,
    NfseXmlBuilderService,
    NfseXmlSignerService,
    NfseService,
    NfseEmissionScheduler,
    ElotechOxyAuthService,
    ElotechOxyNfseService,
  ],
  exports: [NfseService, NfseEmissionScheduler, ElotechOxyNfseService],
})
export class NfseModule {}
