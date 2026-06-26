import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { env } from '../../../common/config/env.validation';

/**
 * Self-hosted native app install server.
 *
 * Stores and serves the iOS (.ipa) and Android (.apk) release binaries so the
 * apps can be installed directly from the API WITHOUT the App Store / Play Store
 * (iOS via the itms-services manifest, Android via a direct .apk download).
 *
 *   GET  /install/version          -> JSON version/build/size/availability per platform
 *   GET  /install/manifest.plist   -> itms-services plist (references the .ipa)
 *   GET  /install/ios/app.ipa      -> stream the iOS binary
 *   GET  /install/android/app.apk  -> stream the Android binary
 *   POST /install/publish/ios      -> ADMIN multipart upload -> AnkaaDesign.ipa + meta
 *   POST /install/publish/android  -> ADMIN multipart upload -> AnkaaDesign.apk + meta
 *
 * Files live under INSTALL_DIR: AnkaaDesign.ipa, AnkaaDesign.apk, meta.json.
 */

export type InstallPlatform = 'ios' | 'android';

export interface PlatformMeta {
  version: string;
  build: string;
  uploadedAt: string;
}

export interface InstallMeta {
  ios: PlatformMeta | null;
  android: PlatformMeta | null;
}

export interface PlatformVersionInfo {
  version: string | null;
  build: string | null;
  sizeBytes: number;
  uploadedAt: string | null;
  available: boolean;
}

export interface VersionResponse {
  ios: PlatformVersionInfo;
  android: PlatformVersionInfo;
}

// Shared contract constants (keep verbatim).
const IOS_BUNDLE_IDENTIFIER = 'com.ankaadesign.management';
const APP_TITLE = 'Ankaa Design';
const DEFAULT_BUNDLE_VERSION = '1.0.0';

const IPA_FILENAME = 'AnkaaDesign.ipa';
const APK_FILENAME = 'AnkaaDesign.apk';
const META_FILENAME = 'meta.json';

@Injectable()
export class InstallService implements OnModuleInit {
  private readonly logger = new Logger(InstallService.name);

  onModuleInit(): void {
    this.ensureDir();
  }

  /** Absolute storage directory for binaries + meta. */
  get installDir(): string {
    return env.INSTALL_DIR;
  }

  /** Public origin used to construct manifest download URLs. */
  private get publicBaseUrl(): string {
    return (env.INSTALL_PUBLIC_URL || 'https://api.ankaadesign.com.br').replace(/\/$/, '');
  }

  private ensureDir(): void {
    if (!existsSync(this.installDir)) {
      mkdirSync(this.installDir, { recursive: true });
      this.logger.log(`Created install binaries directory: ${this.installDir}`);
    }
  }

  private fileFor(platform: InstallPlatform): string {
    return join(this.installDir, platform === 'ios' ? IPA_FILENAME : APK_FILENAME);
  }

  private get metaPath(): string {
    return join(this.installDir, META_FILENAME);
  }

  /** Absolute path to the binary, or null when it has not been published yet. */
  getBinaryPath(platform: InstallPlatform): string | null {
    const p = this.fileFor(platform);
    return existsSync(p) ? p : null;
  }

  createBinaryStream(path: string): NodeJS.ReadableStream {
    return createReadStream(path);
  }

  fileSize(path: string): number {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  }

  /** Read meta.json, tolerating absence / corruption. */
  readMeta(): InstallMeta {
    try {
      if (!existsSync(this.metaPath)) {
        return { ios: null, android: null };
      }
      const raw = readFileSync(this.metaPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<InstallMeta>;
      return {
        ios: parsed.ios ?? null,
        android: parsed.android ?? null,
      };
    } catch (err) {
      this.logger.warn(`Failed to read ${META_FILENAME}: ${(err as Error).message}`);
      return { ios: null, android: null };
    }
  }

  private writeMeta(meta: InstallMeta): void {
    this.ensureDir();
    const tmp = `${this.metaPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
    renameSync(tmp, this.metaPath);
  }

  /** Build the /install/version payload from meta + on-disk file sizes. */
  getVersionInfo(): VersionResponse {
    const meta = this.readMeta();
    return {
      ios: this.platformInfo('ios', meta.ios),
      android: this.platformInfo('android', meta.android),
    };
  }

  private platformInfo(platform: InstallPlatform, meta: PlatformMeta | null): PlatformVersionInfo {
    const path = this.getBinaryPath(platform);
    const available = path !== null;
    return {
      version: meta?.version ?? null,
      build: meta?.build ?? null,
      sizeBytes: path ? this.fileSize(path) : 0,
      uploadedAt: meta?.uploadedAt ?? null,
      available,
    };
  }

  /**
   * Commit an uploaded binary already written to a temp path by multer:
   * atomically rename it into place and update meta.json.
   */
  publish(platform: InstallPlatform, tempPath: string, version: string, build: string): PlatformMeta {
    this.ensureDir();
    const dest = this.fileFor(platform);
    renameSync(tempPath, dest);

    const entry: PlatformMeta = {
      version,
      build,
      uploadedAt: new Date().toISOString(),
    };
    const meta = this.readMeta();
    meta[platform] = entry;
    this.writeMeta(meta);

    this.logger.log(
      `Published ${platform} binary (v${version} build ${build}) -> ${dest} (${this.fileSize(dest)} bytes)`,
    );
    return entry;
  }

  /** Build the itms-services manifest.plist XML for the iOS install flow. */
  buildManifestPlist(): string {
    const meta = this.readMeta();
    const bundleVersion = meta.ios?.version || DEFAULT_BUNDLE_VERSION;
    const ipaUrl = `${this.publicBaseUrl}/install/ios/app.ipa`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${IOS_BUNDLE_IDENTIFIER}</string>
        <key>bundle-version</key>
        <string>${bundleVersion}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${APP_TITLE}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
  }
}
