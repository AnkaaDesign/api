import { Module, forwardRef } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollRepository } from './repositories/payroll/payroll.repository';
import { PayrollPrismaRepository } from './repositories/payroll/payroll-prisma.repository';
import { DiscountRepository } from './repositories/discount/discount.repository';
import { DiscountPrismaRepository } from './repositories/discount/discount-prisma.repository';
import { DiscountService } from './discount.service';
import { DiscountController } from './discount.controller';
import { BrazilianTaxCalculatorService } from './utils/brazilian-tax-calculator.service';
import { CompletePayrollCalculatorService } from './utils/complete-payroll-calculator.service';
import { SecullumPayrollIntegrationService } from './services/secullum-payroll-integration.service';
import { AutoDiscountCreationService } from './services/auto-discount-creation.service';
import { PersistentDiscountService } from './services/persistent-discount.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { UserModule } from '@modules/people/user/user.module';
import { BonusModule } from '../bonus/bonus.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { SecullumModule } from '@modules/integrations/secullum/secullum.module';

@Module({
  imports: [
    PrismaModule,
    UserModule,
    forwardRef(() => BonusModule),
    ChangeLogModule,
    SecullumModule,
  ],
  controllers: [PayrollController, DiscountController],
  providers: [
    PayrollService,
    DiscountService,
    BrazilianTaxCalculatorService,
    CompletePayrollCalculatorService,
    SecullumPayrollIntegrationService,
    AutoDiscountCreationService,
    PersistentDiscountService,
    {
      provide: PayrollRepository,
      useClass: PayrollPrismaRepository,
    },
    {
      provide: DiscountRepository,
      useClass: DiscountPrismaRepository,
    },
  ],
  exports: [
    PayrollService,
    DiscountService,
    BrazilianTaxCalculatorService,
    CompletePayrollCalculatorService,
    SecullumPayrollIntegrationService,
    AutoDiscountCreationService,
    PersistentDiscountService,
  ],
})
export class PayrollModule {}
