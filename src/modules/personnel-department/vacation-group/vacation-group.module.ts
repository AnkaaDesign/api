// vacation-group.module.ts
// Férias COLETIVAS (CLT art. 139-141) — Departamento Pessoal.

import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';
import { UserModule } from '@modules/people/user/user.module';
import { VacationModule } from '../vacation/vacation.module';
import { VacationGroupController } from './vacation-group.controller';
import { VacationGroupService } from './vacation-group.service';

@Module({
  // Reuses the individual vacation engine (VacationService + calc) to expand a
  // collective into per-colaborador Vacation rows, and SecullumVacationSyncService
  // (via VacationModule re-export / SecullumModule) to mirror the collective into
  // the ponto.
  imports: [PrismaModule, ChangeLogModule, SecullumModule, UserModule, VacationModule],
  controllers: [VacationGroupController],
  providers: [VacationGroupService],
  exports: [VacationGroupService],
})
export class VacationGroupModule {}
