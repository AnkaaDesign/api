import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, sign as cryptoSign } from 'crypto';
import { existsSync, promises as fs, statSync } from 'fs';
import { join, normalize, resolve } from 'path';

/**
 * Self-hosted Expo Updates server.
 *
 * Implements the Expo Updates protocol (v0/v1) so the API can deliver
 * over-the-air (OTA) JS bundle updates to the mobile app WITHOUT EAS.
 *
 * Publishing flow (see `mobile/scripts/publish-ota.mjs`):
 *   1. `npx expo export` produces a `dist/` folder (metadata.json + _expo/ + assets/).
 *   2. The script copies that folder into `UPDATES_ROOT/<runtimeVersion>/`
 *      and writes an `expo-publish.json` sidecar with the publish timestamp.
 *   3. The mobile app polls `GET /updates/manifest`; this service reads the
 *      exported files, builds (and optionally signs) the manifest, and the app
 *      downloads the referenced bundle + assets from `GET /updates/assets`.
 *
 * Optional code signing: set `EXPO_UPDATES_PRIVATE_KEY_PATH` to a PEM RSA
 * private key. When the client sends `expo-expect-signature`, the manifest is
 * signed and returned in the `expo-signature` part header.
 */

export interface ManifestAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  url: string;
}

export interface ExpoManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
  metadata: Record<string, unknown>;
  extra: Record<string, unknown>;
}

interface ExportMetadata {
  version: number;
  bundler: string;
  fileMetadata: {
    [platform: string]: {
      bundle: string;
      assets: { path: string; ext: string }[];
    };
  };
}

const MIME_TYPES: Record<string, string> = {
  js: 'application/javascript',
  hbc: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  db: 'application/octet-stream',
};

@Injectable()
export class UpdateService {
  private readonly logger = new Logger(UpdateService.name);

  /**
   * Root folder that holds published exports, one sub-folder per runtimeVersion.
   * Anchored to the process working directory (the API root when started via
   * `node dist/main.js` / PM2), which is stable across dev and compiled builds.
   * Override with the UPDATES_ROOT env var when the cwd differs.
   */
  private get updatesRoot(): string {
    return process.env.UPDATES_ROOT || join(process.cwd(), 'updates');
  }

  private getMimeType(ext: string): string {
    return MIME_TYPES[ext.replace(/^\./, '').toLowerCase()] || 'application/octet-stream';
  }

  /** Format a 32-char hex string as a UUID (used to derive a stable update id). */
  private convertSHA256HashToUUID(value: string): string {
    return [
      value.slice(0, 8),
      value.slice(8, 12),
      value.slice(12, 16),
      value.slice(16, 20),
      value.slice(20, 32),
    ].join('-');
  }

  private getBase64URLEncoding(base64: string): string {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /** Resolve and validate the export directory for a runtime version (no traversal). */
  private resolveRuntimeDir(runtimeVersion: string): string | null {
    const safe = normalize(runtimeVersion).replace(/^(\.\.[/\\])+/, '');
    if (safe.includes('..') || safe.includes('/') || safe.includes('\\')) {
      return null;
    }
    const dir = resolve(this.updatesRoot, safe);
    if (!dir.startsWith(resolve(this.updatesRoot))) {
      return null;
    }
    return existsSync(join(dir, 'metadata.json')) ? dir : null;
  }

  /** True when a published update exists for the given runtime version. */
  hasUpdate(runtimeVersion: string): boolean {
    return this.resolveRuntimeDir(runtimeVersion) !== null;
  }

  /**
   * Build the Expo manifest for a runtime version + platform.
   * `baseUrl` is the public origin used to construct asset download URLs.
   */
  async buildManifest(
    runtimeVersion: string,
    platform: 'ios' | 'android',
    baseUrl: string,
  ): Promise<ExpoManifest> {
    const dir = this.resolveRuntimeDir(runtimeVersion);
    if (!dir) {
      throw new NotFoundException(`No update published for runtimeVersion ${runtimeVersion}`);
    }

    const metadataPath = join(dir, 'metadata.json');
    const metadataRaw = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(metadataRaw) as ExportMetadata;

    const platformMeta = metadata.fileMetadata?.[platform];
    if (!platformMeta) {
      throw new NotFoundException(`No ${platform} bundle for runtimeVersion ${runtimeVersion}`);
    }

    // Stable update id derived from the export contents, so the client only
    // re-downloads when the published bundle actually changes.
    const id = this.convertSHA256HashToUUID(
      createHash('sha256').update(metadataRaw).digest('hex'),
    );

    // createdAt from the publish sidecar (preferred) or the metadata mtime.
    let createdAt: string;
    const sidecarPath = join(dir, 'expo-publish.json');
    if (existsSync(sidecarPath)) {
      const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
      createdAt = sidecar.createdAt || statSync(metadataPath).mtime.toISOString();
    } else {
      createdAt = statSync(metadataPath).mtime.toISOString();
    }

    const assetUrl = (relativePath: string): string =>
      `${baseUrl}/updates/assets?runtimeVersion=${encodeURIComponent(runtimeVersion)}` +
      `&platform=${platform}&asset=${encodeURIComponent(relativePath)}`;

    const buildAsset = async (
      relativePath: string,
      ext: string,
      contentType?: string,
    ): Promise<ManifestAsset> => {
      const filePath = join(dir, relativePath);
      const contents = await fs.readFile(filePath);
      return {
        hash: this.getBase64URLEncoding(createHash('sha256').update(contents).digest('base64')),
        key: createHash('md5').update(contents).digest('hex'),
        contentType: contentType || this.getMimeType(ext),
        fileExtension: ext ? `.${ext.replace(/^\./, '')}` : undefined,
        url: assetUrl(relativePath),
      };
    };

    const launchAsset = await buildAsset(
      platformMeta.bundle,
      'hbc',
      'application/javascript',
    );

    const assets = await Promise.all(
      (platformMeta.assets || []).map((a) => buildAsset(a.path, a.ext)),
    );

    return {
      id,
      createdAt,
      runtimeVersion,
      launchAsset,
      assets,
      metadata: {},
      extra: {},
    };
  }

  /** Read an asset/bundle file for serving, guarding against path traversal. */
  async getAssetFile(
    runtimeVersion: string,
    assetRelativePath: string,
  ): Promise<{ contents: Buffer; contentType: string }> {
    const dir = this.resolveRuntimeDir(runtimeVersion);
    if (!dir) {
      throw new NotFoundException('Update not found');
    }
    const safeAsset = normalize(assetRelativePath).replace(/^(\.\.[/\\])+/, '');
    const filePath = resolve(dir, safeAsset);
    if (!filePath.startsWith(resolve(dir)) || !existsSync(filePath)) {
      throw new NotFoundException('Asset not found');
    }

    // Exported asset files are content-addressed and have NO extension, so the
    // correct content type comes from metadata.json (or it's the JS bundle).
    const contentType = await this.resolveAssetContentType(dir, safeAsset);
    const contents = await fs.readFile(filePath);
    return { contents, contentType };
  }

  /** Look up an asset's content type from the export metadata. */
  private async resolveAssetContentType(dir: string, relativePath: string): Promise<string> {
    try {
      const metadata = JSON.parse(
        await fs.readFile(join(dir, 'metadata.json'), 'utf8'),
      ) as ExportMetadata;
      for (const platform of Object.keys(metadata.fileMetadata || {})) {
        const meta = metadata.fileMetadata[platform];
        if (meta.bundle === relativePath) {
          return 'application/javascript';
        }
        const asset = (meta.assets || []).find((a) => a.path === relativePath);
        if (asset) {
          return this.getMimeType(asset.ext);
        }
      }
    } catch {
      /* fall through to extension-based detection */
    }
    return this.getMimeType(relativePath.split('.').pop() || '');
  }

  /**
   * Sign the stringified manifest (or directive) with the configured RSA key.
   * Returns the value for the `expo-signature` structured-field header, or null
   * when no key is configured.
   */
  signBody(body: string): string | null {
    const keyPath = process.env.EXPO_UPDATES_PRIVATE_KEY_PATH;
    if (!keyPath || !existsSync(keyPath)) {
      return null;
    }
    try {
      const privateKey = require('fs').readFileSync(keyPath, 'utf8');
      const signature = cryptoSign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64');
      const keyid = process.env.EXPO_UPDATES_KEY_ID || 'main';
      return `sig="${signature}", keyid="${keyid}"`;
    } catch (err) {
      this.logger.error(`Failed to sign manifest: ${(err as Error).message}`);
      return null;
    }
  }
}
