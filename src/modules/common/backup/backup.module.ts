import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupProcessor } from './backup.processor';
import { BackupGateway } from './backup.gateway';
import { UserModule } from '../../people/user/user.module';

@Module({
  imports: [
    UserModule,
    EventEmitterModule.forRoot(),
    BullModule.registerQueue({
      name: 'backup-queue',
    }),
  ],
  controllers: [BackupController],
  providers: [BackupService, BackupProcessor, BackupGateway],
  exports: [BackupService],
})
export class BackupModule {}
