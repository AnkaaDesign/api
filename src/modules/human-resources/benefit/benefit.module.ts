// benefit.module.ts

import { Module } from '@nestjs/common';
import { BenefitController } from './benefit.controller';
import { UserBenefitController } from './user-benefit.controller';
import { BenefitService } from './benefit.service';
import { UserBenefitService } from './user-benefit.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { FileModule } from '@modules/common/file/file.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule, FileModule],
  controllers: [BenefitController, UserBenefitController],
  providers: [BenefitService, UserBenefitService],
  exports: [BenefitService, UserBenefitService],
})
export class BenefitModule {}
