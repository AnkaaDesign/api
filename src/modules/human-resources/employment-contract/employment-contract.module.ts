// employment-contract.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { EmploymentContractController } from './employment-contract.controller';
import { EmploymentContractService } from './employment-contract.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, forwardRef(() => UserModule)],
  controllers: [EmploymentContractController],
  providers: [EmploymentContractService],
  exports: [EmploymentContractService],
})
export class EmploymentContractModule {}
