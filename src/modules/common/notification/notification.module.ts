import { Module } from '@nestjs/common';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { NotificationController, SeenNotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import {
  NotificationRepository,
  SeenNotificationRepository,
} from './repositories/notification.repository';
import {
  NotificationPrismaRepository,
  SeenNotificationPrismaRepository,
} from './repositories/notification-prisma.repository';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [NotificationController, SeenNotificationController],
  providers: [
    NotificationService,
    {
      provide: NotificationRepository,
      useClass: NotificationPrismaRepository,
    },
    {
      provide: SeenNotificationRepository,
      useClass: SeenNotificationPrismaRepository,
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
