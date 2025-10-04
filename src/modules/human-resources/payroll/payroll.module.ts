import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollRepository } from './repositories/payroll/payroll.repository';
import { PayrollPrismaRepository } from './repositories/payroll/payroll-prisma.repository';
import { DiscountRepository } from './repositories/discount/discount.repository';
import { DiscountPrismaRepository } from './repositories/discount/discount-prisma.repository';
import { DiscountService } from './discount.service';
import { DiscountController } from './discount.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserModule } from '@modules/people/user/user.module';
import { BonusModule } from '../bonus/bonus.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [
    PrismaModule,
    UserModule,
    BonusModule,
    ChangeLogModule,
  ],
  controllers: [PayrollController, DiscountController],
  providers: [
    PayrollService,
    DiscountService,
    {
      provide: PayrollRepository,
      useClass: PayrollPrismaRepository,
    },
    {
      provide: DiscountRepository,
      useClass: DiscountPrismaRepository,
    },
  ],
  exports: [PayrollService, DiscountService],
})
export class PayrollModule {}