import { Module } from '@nestjs/common';
import { UpdateController } from './update.controller';
import { UpdateService } from './update.service';

/**
 * Self-hosted Expo Updates (OTA) module.
 * No database access — it serves exported JS bundles from `UPDATES_ROOT`.
 */
@Module({
  controllers: [UpdateController],
  providers: [UpdateService],
  exports: [UpdateService],
})
export class UpdateModule {}
