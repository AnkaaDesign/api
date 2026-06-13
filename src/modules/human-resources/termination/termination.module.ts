// termination.module.ts

import { Module } from '@nestjs/common';
import { TerminationController } from './termination.controller';
import { TerminationService } from './termination.service';
import { TerminationCalculationService } from './termination-calculation.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { FileModule } from '@modules/common/file/file.module';
import { EmploymentContractModule } from '../employment-contract/employment-contract.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule, FileModule, EmploymentContractModule],
  controllers: [TerminationController],
  providers: [TerminationService, TerminationCalculationService],
  exports: [TerminationService, TerminationCalculationService],
})
export class TerminationModule {}
