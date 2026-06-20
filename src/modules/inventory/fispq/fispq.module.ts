// fispq.module.ts

import { Module } from '@nestjs/common';
import { FispqController } from './fispq.controller';
import { FispqService } from './fispq.service';
import { FispqDocumentService } from './fispq-document.service';
import { FispqAlertScheduler } from './fispq-alert.scheduler';
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
  controllers: [FispqController],
  providers: [FispqService, FispqDocumentService, FispqAlertScheduler],
  exports: [FispqService, FispqDocumentService],
})
export class FispqModule {}
