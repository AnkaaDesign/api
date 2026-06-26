// admission.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdmissionController } from './admission.controller';
import { AdmissionService } from './admission.service';
import { AdmissionSignatureService } from './admission-signature.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { FileModule } from '@modules/common/file/file.module';
import { EmploymentContractModule } from '../employment-contract/employment-contract.module';
// Reuse the PPE PAdES signer (self-contained — depends only on ConfigService).
// Registered locally instead of importing the heavy PpeModule, and PpeModule's
// own behavior is left untouched.
import { PpePadesSignerService } from '@modules/inventory/ppe/ppe-pades-signer.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ChangeLogModule,
    UserModule,
    FileModule,
    EmploymentContractModule,
  ],
  controllers: [AdmissionController],
  providers: [AdmissionService, AdmissionSignatureService, PpePadesSignerService],
  exports: [AdmissionService],
})
export class AdmissionModule {}
