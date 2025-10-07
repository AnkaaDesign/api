import { Module } from '@nestjs/common';
import { AirbrushingService } from './airbrushing.service';
import { AirbrushingController } from './airbrushing.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { AirbrushingRepository } from './repositories/airbrushing.repository';
import { AirbrushingPrismaRepository } from './repositories/airbrushing-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule, FileModule],
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
