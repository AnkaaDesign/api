// position.module.ts

import { Module } from '@nestjs/common';
import { PositionController, PositionRemunerationController } from './position.controller';
import { PositionService } from './position.service';
import { PositionRemunerationService } from './position-remuneration.service';
import { PositionRepository } from './repositories/position/position.repository';
import { PositionPrismaRepository } from './repositories/position/position-prisma.repository';
import { PositionRemunerationRepository } from './repositories/position-remuneration/position-remuneration.repository';
import { PositionRemunerationPrismaRepository } from './repositories/position-remuneration/position-remuneration-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [PositionController, PositionRemunerationController],
  providers: [
    PositionService,
    PositionRemunerationService,
    {
      provide: PositionRepository,
      useClass: PositionPrismaRepository,
    },
    {
      provide: PositionRemunerationRepository,
      useClass: PositionRemunerationPrismaRepository,
    },
  ],
  exports: [PositionService, PositionRepository],
})
export class PositionModule {}
