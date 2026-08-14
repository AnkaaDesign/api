import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { NfseCertificateService } from './nfse-certificate.service';
import { NfseXmlBuilderService } from './nfse-xml-builder.service';
import { NfseXmlSignerService } from './nfse-xml-signer.service';
import { NfseService } from './nfse.service';
import { NfseEmissionScheduler } from './nfse-emission.scheduler';
import { ElotechOxyAuthService } from './elotech-oxy-auth.service';
import { ElotechOxyNfseService } from './elotech-oxy-nfse.service';
import { NfseController } from './nfse.controller';
// NFS-e do prestador terceiro (aerografista MEI) pelo Sistema Nacional. Convive
// com o caminho municipal acima sem se misturar: lá a Ankaa é a prestadora, aqui
// é a tomadora.
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FiscalCertificateService } from './painter/fiscal-certificate.service';
import { FiscalEmitterProfileService } from './painter/fiscal-emitter-profile.service';
import { DpsSignerService } from './painter/dps.signer';
import { SefinNacionalClient } from './painter/sefin-nacional.client';
import { PainterNfseService } from './painter/painter-nfse.service';
import { PainterNfseScheduler } from './painter/painter-nfse.scheduler';
import { PainterNfseController } from './painter/painter-nfse.controller';
import { PainterNfseArtifactsService } from './painter/painter-nfse-artifacts.service';
// FileModule grava o XML e o DANFSe; SiegModule fornece o parser e o ingestor
// que transformam o XML em FiscalDocument (o mesmo caminho das notas do SIEG).
import { FileModule } from '@modules/common/file/file.module';
import { SiegModule } from '@modules/integrations/sieg/sieg.module';

@Module({
  imports: [PrismaModule, NotificationModule, ChangeLogModule, FileModule, SiegModule],
  controllers: [NfseController, PainterNfseController],
  providers: [
    NfseCertificateService,
    NfseXmlBuilderService,
    NfseXmlSignerService,
    NfseService,
    NfseEmissionScheduler,
    ElotechOxyAuthService,
    ElotechOxyNfseService,
    FiscalCertificateService,
    FiscalEmitterProfileService,
    DpsSignerService,
    SefinNacionalClient,
    PainterNfseService,
    PainterNfseScheduler,
    PainterNfseArtifactsService,
  ],
  exports: [
    NfseService,
    NfseEmissionScheduler,
    ElotechOxyNfseService,
    // Exportado para o AirbrushingService registrar a intenção dentro da mesma
    // transação que conclui a aerografia.
    PainterNfseService,
    FiscalCertificateService,
    FiscalEmitterProfileService,
  ],
})
export class NfseModule {}
