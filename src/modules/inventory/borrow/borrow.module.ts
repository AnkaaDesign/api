import { Module } from '@nestjs/common';
import { BorrowService } from './borrow.service';
import { BorrowController } from './borrow.controller';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { BorrowRepository } from './repositories/borrow.repository';
import { BorrowPrismaRepository } from './repositories/borrow-prisma.repository';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { ActivityModule } from '@modules/inventory/activity/activity.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { BorrowNotificationScheduler } from './borrow-notification.scheduler';

@Module({
  imports: [PrismaModule, ChangeLogModule, ActivityModule, NotificationModule],
  controllers: [BorrowController],
  providers: [
    BorrowService,
    BorrowNotificationScheduler,
    {
      provide: BorrowRepository,
      useClass: BorrowPrismaRepository,
    },
  ],
  exports: [BorrowService, BorrowRepository],
})
export class BorrowModule {}
