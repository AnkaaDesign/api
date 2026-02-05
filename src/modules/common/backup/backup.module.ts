import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupProcessor } from './backup.processor';
import { BackupGateway } from './backup.gateway';
import { BackupRepository } from './backup.repository';
import { BackupScheduleRepository } from './backup-schedule.repository';
import { GDriveSyncService } from './gdrive-sync.service';
import { GDriveSyncProcessor } from './gdrive-sync.processor';
import { RcloneService } from './rclone.service';
import { UserModule } from '../../people/user/user.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    UserModule,
    PrismaModule,
    EventEmitterModule.forRoot(),
    BullModule.registerQueue({
      name: 'backup-queue',
    }),
    BullModule.registerQueue({
      name: 'gdrive-sync-queue',
    }),
  ],
  controllers: [BackupController],
  providers: [
    BackupService,
    BackupProcessor,
    BackupGateway,
    BackupRepository,
    BackupScheduleRepository,
    GDriveSyncService,
    GDriveSyncProcessor,
    RcloneService,
  ],
  exports: [
    BackupService,
    BackupRepository,
    BackupScheduleRepository,
    GDriveSyncService,
    RcloneService,
  ],
})
export class BackupModule {}
