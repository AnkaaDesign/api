import { Module } from '@nestjs/common';
import { ObservationService } from './observation.service';
import { ObservationController } from './observation.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { ObservationRepository } from './repositories/observation.repository';
import { ObservationPrismaRepository } from './repositories/observation-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule, FileModule],
  controllers: [ObservationController],
  providers: [
    ObservationService,
    {
      provide: ObservationRepository,
      useClass: ObservationPrismaRepository,
    },
  ],
  exports: [ObservationService, ObservationRepository],
})
export class ObservationModule {}
