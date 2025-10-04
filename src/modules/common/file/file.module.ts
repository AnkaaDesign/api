// modules/file/file.module.ts

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { FilePrismaRepository } from './repositories/file-prisma.repository';
import { FileRepository } from './repositories/file.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { UserModule } from '@modules/people/user/user.module';
import { EnsureUploadDirMiddleware } from './middleware/upload.middleware';
import { ThumbnailService } from './thumbnail.service';
import { ThumbnailQueueModule } from './thumbnail-queue.module';
import { ThumbnailMonitoringController } from './thumbnail-monitoring.controller';
import { WebDAVService } from './services/webdav.service';
import { UPLOAD_CONFIG, fileFilter } from './config/upload.config';

// Ensure upload directory exists
const uploadDir = UPLOAD_CONFIG.uploadDir;
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    UserModule,
    ThumbnailQueueModule,
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, callback) => {
          callback(null, uploadDir);
        },
        filename: (req, file, callback) => {
          // Generate unique filename with timestamp and random suffix
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname);
          const filename = `${file.fieldname}-${uniqueSuffix}${ext}`;
          callback(null, filename);
        },
      }),
      limits: {
        fileSize: UPLOAD_CONFIG.maxFileSize,
      },
      fileFilter: fileFilter,
    }),
  ],
  controllers: [FileController, ThumbnailMonitoringController],
  providers: [
    FileService,
    ThumbnailService,
    WebDAVService,
    {
      provide: FileRepository,
      useClass: FilePrismaRepository,
    },
  ],
  exports: [FileService, FileRepository, WebDAVService],
})
export class FileModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EnsureUploadDirMiddleware).forRoutes('files');
  }
}
