// dependent.module.ts

import { Module } from '@nestjs/common';
import { DependentController } from './dependent.controller';
import { DependentService } from './dependent.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule],
  controllers: [DependentController],
  providers: [DependentService],
  exports: [DependentService],
})
export class DependentModule {}
