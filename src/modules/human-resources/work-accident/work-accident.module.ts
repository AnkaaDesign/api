// work-accident.module.ts
// CAT — Comunicação de Acidente de Trabalho (Medicina do Trabalho, Part E).

import { Module } from '@nestjs/common';
import { WorkAccidentController } from './work-accident.controller';
import { WorkAccidentService } from './work-accident.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule],
  controllers: [WorkAccidentController],
  providers: [WorkAccidentService],
  exports: [WorkAccidentService],
})
export class WorkAccidentModule {}
