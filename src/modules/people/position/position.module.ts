// position.module.ts

import { Module } from '@nestjs/common';
import { PositionController } from './position.controller';
import { PositionService } from './position.service';
import { PositionRepository } from './repositories/position/position.repository';
import { PositionPrismaRepository } from './repositories/position/position-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [PositionController],
  providers: [
    PositionService,
    {
      provide: PositionRepository,
      useClass: PositionPrismaRepository,
    },
  ],
  exports: [PositionService, PositionRepository],
})
export class PositionModule {}
