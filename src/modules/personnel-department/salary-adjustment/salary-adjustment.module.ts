// salary-adjustment.module.ts

import { Module } from '@nestjs/common';
import { SalaryAdjustmentController } from './salary-adjustment.controller';
import { SalaryAdjustmentService } from './salary-adjustment.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule],
  controllers: [SalaryAdjustmentController],
  providers: [SalaryAdjustmentService],
  exports: [SalaryAdjustmentService],
})
export class SalaryAdjustmentModule {}
