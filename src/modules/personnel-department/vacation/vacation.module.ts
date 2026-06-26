// vacation.module.ts
// Férias (Departamento Pessoal) — Part C.

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { UserModule } from '@modules/people/user/user.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';
import { VacationController } from './vacation.controller';
import { VacationService } from './vacation.service';
import { VacationCalculationService } from './vacation-calculation.service';
import { VacationNotificationScheduler } from './vacation-notification.scheduler';

@Module({
  // SecullumModule provides SecullumVacationSyncService, which mirrors a
  // scheduled vacation's gozo períodos into Secullum as afastamentos so the
  // ponto system knows the employee is on férias. The robust values/calc/recibo
  // engine stays local; Secullum gets only the date ranges.
  imports: [PrismaModule, ChangeLogModule, NotificationModule, UserModule, SecullumModule],
  controllers: [VacationController],
  providers: [VacationService, VacationCalculationService, VacationNotificationScheduler],
  exports: [VacationService, VacationCalculationService],
})
export class VacationModule {}
