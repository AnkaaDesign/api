// vacation.module.ts

import { Module } from '@nestjs/common';
import { VacationController } from './vacation.controller';
import { VacationService } from './vacation.service';
import { VacationRepository } from './repositories/vacation.repository';
import { VacationPrismaRepository } from './repositories/vacation-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [VacationController],
  providers: [
    VacationService,
    {
      provide: VacationRepository,
      useClass: VacationPrismaRepository,
    },
  ],
  exports: [VacationService, VacationRepository],
})
export class VacationModule {}
