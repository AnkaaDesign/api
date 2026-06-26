import { Module } from '@nestjs/common';
import { InstallController } from './install.controller';
import { InstallService } from './install.service';

/**
 * Self-hosted native app install module.
 * No database access — it stores + serves the iOS .ipa / Android .apk release
 * binaries (and a meta.json) from INSTALL_DIR.
 */
@Module({
  controllers: [InstallController],
  providers: [InstallService],
  exports: [InstallService],
})
export class InstallModule {}
