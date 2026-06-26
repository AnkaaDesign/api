import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Response } from 'express';
import { InstallService } from './install.service';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import {
  NoRateLimit,
  ReadRateLimit,
  WriteRateLimit,
} from '@modules/common/throttler/throttler.decorators';
import { env } from '../../../common/config/env.validation';

/**
 * Self-hosted native app install endpoints.
 *
 *   GET  /install/version          -> JSON version metadata per platform (public)
 *   GET  /install/manifest.plist   -> itms-services manifest XML (public)
 *   GET  /install/ios/app.ipa      -> stream the iOS .ipa (public)
 *   GET  /install/android/app.apk  -> stream the Android .apk (public)
 *   POST /install/publish/ios      -> ADMIN multipart upload of the .ipa
 *   POST /install/publish/android  -> ADMIN multipart upload of the .apk
 *
 * All binary responses go through the raw express `Response` (`@Res()`) so the
 * global serialization interceptors do not wrap the stream.
 */

// .ipa/.apk are 50-300MB — stream straight to disk (NOT memory) with a high cap.
const INSTALL_MAX_UPLOAD_BYTES = 600 * 1024 * 1024; // 600MB

const installUploadConfig = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = env.INSTALL_DIR;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    },
    // Temp name; InstallService.publish() atomically renames into the final file.
    filename: (_req, _file, cb) => cb(null, `upload-${uuidv4()}.tmp`),
  }),
  limits: { fileSize: INSTALL_MAX_UPLOAD_BYTES },
};

@Controller('install')
export class InstallController {
  constructor(private readonly installService: InstallService) {}

  @Get('version')
  @Public()
  @ReadRateLimit()
  getVersion() {
    return this.installService.getVersionInfo();
  }

  @Get('manifest.plist')
  @Public()
  @ReadRateLimit()
  getManifest(@Res() res: Response): void {
    const xml = this.installService.buildManifestPlist();
    res.setHeader('content-type', 'application/xml');
    res.setHeader('cache-control', 'no-cache');
    res.status(200).send(xml);
  }

  @Get('ios/app.ipa')
  @Public()
  @NoRateLimit()
  downloadIpa(@Res() res: Response): void {
    this.streamBinary(res, 'ios', 'application/octet-stream', 'AnkaaDesign.ipa');
  }

  @Get('android/app.apk')
  @Public()
  @NoRateLimit()
  downloadApk(@Res() res: Response): void {
    this.streamBinary(res, 'android', 'application/vnd.android.package-archive', 'AnkaaDesign.apk');
  }

  @Post('publish/ios')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @UseInterceptors(FileInterceptor('file', installUploadConfig))
  publishIos(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { version?: string; build?: string },
  ) {
    return this.publish('ios', file, body);
  }

  @Post('publish/android')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  @WriteRateLimit()
  @UseInterceptors(FileInterceptor('file', installUploadConfig))
  publishAndroid(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { version?: string; build?: string },
  ) {
    return this.publish('android', file, body);
  }

  private publish(
    platform: 'ios' | 'android',
    file: Express.Multer.File | undefined,
    body: { version?: string; build?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }
    const version = (body.version || '').trim();
    const build = (body.build || '').trim();
    if (!version || !build) {
      throw new BadRequestException('Os campos "version" e "build" são obrigatórios');
    }

    const entry = this.installService.publish(platform, file.path, version, build);
    return {
      success: true,
      message: `Binário ${platform === 'ios' ? 'iOS' : 'Android'} publicado com sucesso`,
      data: { platform, ...entry },
    };
  }

  private streamBinary(
    res: Response,
    platform: 'ios' | 'android',
    contentType: string,
    downloadName: string,
  ): void {
    const path = this.installService.getBinaryPath(platform);
    if (!path) {
      res.status(404).json({ error: `No ${platform} binary published` });
      return;
    }

    const size = this.installService.fileSize(path);
    res.setHeader('content-type', contentType);
    res.setHeader('content-disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('content-length', String(size));
    res.setHeader('cache-control', 'no-cache');

    const stream = this.installService.createBinaryStream(path);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).json({ error: `Failed to read ${platform} binary` });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }
}
