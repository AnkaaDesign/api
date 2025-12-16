import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ThumbnailQueueService } from './thumbnail-queue.service';
import { ThumbnailProcessorService } from './thumbnail-processor.service';
import { ThumbnailService } from './thumbnail.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { FilesStorageModule } from './services/files-storage.module';

@Module({
  imports: [
    PrismaModule,
    FilesStorageModule,
    BullModule.registerQueue({
      name: 'thumbnail-generation',
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
      settings: {
        stalledInterval: 30000, // 30 seconds
        maxStalledCount: 1,
      },
    }),
  ],
  providers: [ThumbnailService, ThumbnailQueueService, ThumbnailProcessorService],
  exports: [ThumbnailQueueService, ThumbnailService],
})
export class ThumbnailQueueModule {}
