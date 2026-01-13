import { Controller, Get, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { NoRateLimit } from '../throttler/throttler.decorators';
import { join } from 'path';
import { readFileSync } from 'fs';

/**
 * Controller for serving deep linking configuration files
 * Required for iOS Universal Links and Android App Links
 *
 * Files served:
 * - /.well-known/assetlinks.json (Android Digital Asset Links)
 * - /.well-known/apple-app-site-association (iOS Universal Links)
 */
@Controller('.well-known')
export class DeepLinkController {
  private readonly wellKnownPath: string;

  constructor() {
    this.wellKnownPath = join(__dirname, '..', '..', '..', '..', '..', 'public', '.well-known');
  }

  /**
   * Android Digital Asset Links
   * Required for Android App Links verification
   * https://developer.android.com/training/app-links/verify-android-applinks
   *
   * @returns JSON file with SHA256 certificate fingerprints
   */
  @Public()
  @NoRateLimit()
  @Get('assetlinks.json')
  @Header('Content-Type', 'application/json')
  @Header('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
  getAssetLinks(@Res() res: Response): void {
    try {
      const filePath = join(this.wellKnownPath, 'assetlinks.json');
      const content = readFileSync(filePath, 'utf-8');
      res.send(content);
    } catch (error) {
      res.status(404).json({ error: 'assetlinks.json not found' });
    }
  }

  /**
   * Apple App Site Association
   * Required for iOS Universal Links verification
   * https://developer.apple.com/documentation/xcode/supporting-associated-domains
   *
   * IMPORTANT: This file must be served:
   * - Without .json extension in URL
   * - With application/json Content-Type
   * - At the root domain (not subdomain)
   *
   * @returns JSON file with app IDs and path configurations
   */
  @Public()
  @NoRateLimit()
  @Get('apple-app-site-association')
  @Header('Content-Type', 'application/json')
  @Header('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
  getAppleAppSiteAssociation(@Res() res: Response): void {
    try {
      const filePath = join(this.wellKnownPath, 'apple-app-site-association');
      const content = readFileSync(filePath, 'utf-8');
      res.send(content);
    } catch (error) {
      res.status(404).json({ error: 'apple-app-site-association not found' });
    }
  }
}
