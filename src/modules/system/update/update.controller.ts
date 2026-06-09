import {
  Controller,
  Get,
  Headers,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UpdateService } from './update.service';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { NoRateLimit } from '@modules/common/throttler/throttler.decorators';

/**
 * Expo Updates protocol endpoints (self-hosted OTA server).
 *
 *   GET /updates/manifest  -> manifest (multipart/mixed for protocol v1)
 *   GET /updates/assets    -> raw bundle/asset files referenced by the manifest
 *
 * All responses are written through the raw express `Response` (`@Res()`) so the
 * global serialization interceptors do NOT wrap the protocol payload.
 */
@Controller('updates')
export class UpdateController {
  // Stable, unique multipart boundary (manifest JSON can never contain it).
  private static readonly BOUNDARY = 'ankaa-expo-updates-boundary-9f2a1c';

  constructor(private readonly updateService: UpdateService) {}

  private getBaseUrl(req: Request): string {
    if (process.env.UPDATES_PUBLIC_URL) {
      return process.env.UPDATES_PUBLIC_URL.replace(/\/$/, '');
    }
    // Honor reverse-proxy headers (nginx) for the public origin.
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
    return `${proto}://${host}`;
  }

  @Get('manifest')
  @Public()
  @NoRateLimit()
  async manifest(
    @Headers('expo-protocol-version') protocolVersionHeader: string,
    @Headers('expo-platform') platformHeader: string,
    @Headers('expo-runtime-version') runtimeVersionHeader: string,
    @Headers('expo-expect-signature') expectSignature: string,
    @Query('platform') platformQuery: string,
    @Query('runtime-version') runtimeVersionQuery: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const protocolVersion = parseInt(protocolVersionHeader ?? '0', 10) || 0;
    const platform = (platformHeader || platformQuery) as 'ios' | 'android';
    const runtimeVersion = runtimeVersionHeader || runtimeVersionQuery;

    if (platform !== 'ios' && platform !== 'android') {
      res.status(400).json({ error: 'Unsupported or missing platform' });
      return;
    }
    if (!runtimeVersion) {
      res.status(400).json({ error: 'Missing runtime version' });
      return;
    }

    // No published update for this runtime version.
    if (!this.updateService.hasUpdate(runtimeVersion)) {
      if (protocolVersion === 0) {
        res.status(404).json({ error: 'No update available' });
        return;
      }
      this.writeDirective(
        res,
        JSON.stringify({ type: 'noUpdateAvailable' }),
        protocolVersion,
        !!expectSignature,
      );
      return;
    }

    const manifest = await this.updateService.buildManifest(
      runtimeVersion,
      platform,
      this.getBaseUrl(req),
    );
    const manifestString = JSON.stringify(manifest);
    const signature = expectSignature ? this.updateService.signBody(manifestString) : null;

    if (protocolVersion === 0) {
      // Protocol v0: bare JSON manifest, signature (if any) as a response header.
      res.setHeader('expo-protocol-version', '0');
      res.setHeader('expo-sfv-version', '0');
      res.setHeader('cache-control', 'private, max-age=0');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (signature) res.setHeader('expo-signature', signature);
      res.status(200).send(manifestString);
      return;
    }

    // Protocol v1: multipart/mixed with a "manifest" part.
    this.writeMultipart(res, 'manifest', manifestString, protocolVersion, signature);
  }

  @Get('assets')
  @Public()
  @NoRateLimit()
  async assets(
    @Query('asset') asset: string,
    @Query('runtimeVersion') runtimeVersion: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!asset || !runtimeVersion) {
      res.status(400).json({ error: 'Missing asset or runtimeVersion' });
      return;
    }
    const { contents, contentType } = await this.updateService.getAssetFile(
      runtimeVersion,
      asset,
    );
    // Assets are content-addressed (hashed), so they are immutable.
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('content-type', contentType);
    res.status(200).send(contents);
  }

  /** Write a protocol-v1 directive (e.g. noUpdateAvailable) as multipart. */
  private writeDirective(
    res: Response,
    directiveBody: string,
    protocolVersion: number,
    expectSignature: boolean,
  ): void {
    const signature = expectSignature ? this.updateService.signBody(directiveBody) : null;
    this.writeMultipart(res, 'directive', directiveBody, protocolVersion, signature);
  }

  /**
   * Serialize a single-part multipart/mixed body exactly as the `form-data`
   * package (and therefore the expo-updates client) expects.
   */
  private writeMultipart(
    res: Response,
    partName: 'manifest' | 'directive',
    body: string,
    protocolVersion: number,
    signature: string | null,
  ): void {
    const b = UpdateController.BOUNDARY;
    const lines = [
      `--${b}`,
      `Content-Disposition: form-data; name="${partName}"`,
      `Content-Type: application/json; charset=utf-8`,
    ];
    if (signature) {
      lines.push(`expo-signature: ${signature}`);
    }
    lines.push('', body, `--${b}--`, '');
    const payload = Buffer.from(lines.join('\r\n'), 'utf8');

    res.setHeader('expo-protocol-version', String(protocolVersion));
    res.setHeader('expo-sfv-version', '0');
    res.setHeader('cache-control', 'private, max-age=0');
    res.setHeader('content-type', `multipart/mixed; boundary=${b}`);
    res.setHeader('content-length', String(payload.length));
    res.status(200).send(payload);
  }
}
