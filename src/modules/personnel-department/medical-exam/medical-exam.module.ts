// medical-exam.module.ts

import { Module } from '@nestjs/common';
import { MedicalExamController } from './medical-exam.controller';
import { MedicalExamService } from './medical-exam.service';
import { MedicalExamAlertScheduler } from './medical-exam-alert.scheduler';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { FileModule } from '@modules/common/file/file.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { EventEmitterModule } from '@modules/common/event-emitter/event-emitter.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    UserModule,
    FileModule,
    NotificationModule,
    EventEmitterModule,
  ],
  controllers: [MedicalExamController],
  providers: [MedicalExamService, MedicalExamAlertScheduler],
  exports: [MedicalExamService],
})
export class MedicalExamModule {}
