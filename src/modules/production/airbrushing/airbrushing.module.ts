import { Module } from '@nestjs/common';
import { AirbrushingService } from './airbrushing.service';
import { AirbrushingController } from './airbrushing.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { AirbrushingRepository } from './repositories/airbrushing.repository';
import { AirbrushingPrismaRepository } from './repositories/airbrushing-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule],
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
