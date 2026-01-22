import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupProcessor } from './backup.processor';
import { BackupGateway } from './backup.gateway';
import { BackupScheduleRepository } from './backup-schedule.repository';
import { UserModule } from '../../people/user/user.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [
    UserModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
    BullModule.registerQueue({
      name: 'backup-queue',
    }),
  ],
  controllers: [BackupController],
  providers: [BackupService, BackupProcessor, BackupGateway, BackupScheduleRepository],
  exports: [BackupService, BackupScheduleRepository],
})
export class BackupModule {}
