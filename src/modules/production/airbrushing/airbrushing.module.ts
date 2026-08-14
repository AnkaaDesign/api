import { Module } from '@nestjs/common';
import { AirbrushingService } from './airbrushing.service';
import { AirbrushingController } from './airbrushing.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { AirbrushingRepository } from './repositories/airbrushing.repository';
import { AirbrushingPrismaRepository } from './repositories/airbrushing-prisma.repository';
// Fornece o PainterNfseService, que registra a intenção de emitir a NFS-e do
// aerografista dentro da mesma transação que conclui a aerografia.
import { NfseModule } from '@modules/integrations/nfse/nfse.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, FileModule, NfseModule],
  controllers: [AirbrushingController],
  providers: [
    AirbrushingService,
    {
      provide: AirbrushingRepository,
      useClass: AirbrushingPrismaRepository,
    },
  ],
  exports: [AirbrushingService, AirbrushingRepository],
})
export class AirbrushingModule {}
