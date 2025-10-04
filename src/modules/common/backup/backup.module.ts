import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupProcessor } from './backup.processor';
import { UserModule } from '../../people/user/user.module';

@Module({
  imports: [
    UserModule,
    BullModule.registerQueue({
      name: 'backup-queue',
    }),
  ],
  controllers: [BackupController],
  providers: [BackupService, BackupProcessor],
  exports: [BackupService],
})
export class BackupModule {}
