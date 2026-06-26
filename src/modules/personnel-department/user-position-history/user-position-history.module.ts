// user-position-history.module.ts

import { Module } from '@nestjs/common';
import { UserPositionHistoryController } from './user-position-history.controller';
import { UserPositionHistoryService } from './user-position-history.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule],
  controllers: [UserPositionHistoryController],
  providers: [UserPositionHistoryService],
  exports: [UserPositionHistoryService],
})
export class UserPositionHistoryModule {}
