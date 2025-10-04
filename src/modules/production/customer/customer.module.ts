import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CustomerRepository } from './repositories/customer.repository';
import { CustomerPrismaRepository } from './repositories/customer-prisma.repository';
import { ChangeLogModule } from '../../common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [CustomerController],
  providers: [
    CustomerService,
    {
      provide: CustomerRepository,
      useClass: CustomerPrismaRepository,
    },
  ],
  exports: [CustomerService, CustomerRepository],
})
export class CustomerModule {}
