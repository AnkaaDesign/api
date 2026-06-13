// employment-contract.module.ts

import { Module } from '@nestjs/common';
import { EmploymentContractController } from './employment-contract.controller';
import { EmploymentContractService } from './employment-contract.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [EmploymentContractController],
  providers: [EmploymentContractService],
  exports: [EmploymentContractService],
})
export class EmploymentContractModule {}
