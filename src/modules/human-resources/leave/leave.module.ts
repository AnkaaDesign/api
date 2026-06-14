// leave.module.ts

import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { FileModule } from '@modules/common/file/file.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';

@Module({
  // SecullumModule provides SecullumLeaveSyncService, which mirrors an
  // afastamento's date range into Secullum as an afastamento so the ponto system
  // does not flag the period as faltas injustificadas. The robust leave engine
  // stays local; Secullum gets only the date range.
  imports: [PrismaModule, ChangeLogModule, UserModule, FileModule, SecullumModule],
  controllers: [LeaveController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}
