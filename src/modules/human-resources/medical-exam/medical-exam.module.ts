// medical-exam.module.ts

import { Module } from '@nestjs/common';
import { MedicalExamController } from './medical-exam.controller';
import { MedicalExamService } from './medical-exam.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { FileModule } from '@modules/common/file/file.module';

@Module({
  imports: [PrismaModule, ChangeLogModule, UserModule, FileModule],
  controllers: [MedicalExamController],
  providers: [MedicalExamService],
  exports: [MedicalExamService],
})
export class MedicalExamModule {}
