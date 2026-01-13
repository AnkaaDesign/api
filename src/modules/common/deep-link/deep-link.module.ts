import { Module } from '@nestjs/common';
import { DeepLinkController } from './deep-link.controller';

/**
 * Module for deep linking support
 * Enables iOS Universal Links and Android App Links
 *
 * Configuration files:
 * - Android: public/.well-known/assetlinks.json
 * - iOS: public/.well-known/apple-app-site-association
 *
 * Domain: ankaadesign.com.br
 * Package/Bundle ID: com.ankaadesign.management
 */
@Module({
  controllers: [DeepLinkController],
})
export class DeepLinkModule {}
