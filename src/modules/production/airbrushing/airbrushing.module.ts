import { Module } from '@nestjs/common';
import { AirbrushingService } from './airbrushing.service';
import { AirbrushingController } from './airbrushing.controller';
import { AirbrushingQuoteController } from './airbrushing-quote.controller';
import { AirbrushingQuoteService } from './airbrushing-quote.service';
import { AirbrushingQuoteScheduler } from './airbrushing-quote.scheduler';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { AirbrushingRepository } from './repositories/airbrushing.repository';
import { AirbrushingPrismaRepository } from './repositories/airbrushing-prisma.repository';
// Fornece o PainterNfseService, que registra a intenção de emitir a NFS-e do
// aerografista dentro da mesma transação que conclui a aerografia.
import { NfseModule } from '@modules/integrations/nfse/nfse.module';
// Fornece o AirbrushingNotificationService, que avisa o aerografista quando um
// serviço é atribuído a ele e quando o pagamento dele é registrado.
import { NotificationModule } from '@modules/common/notification/notification.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, FileModule, NfseModule, NotificationModule],
  controllers: [AirbrushingController, AirbrushingQuoteController],
  providers: [
    AirbrushingService,
    AirbrushingQuoteService,
    AirbrushingQuoteScheduler,
    {
      provide: AirbrushingRepository,
      useClass: AirbrushingPrismaRepository,
    },
  ],
  exports: [AirbrushingService, AirbrushingQuoteService, AirbrushingRepository],
})
export class AirbrushingModule {}
