// tasks.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskQuoteModule } from '../task-quote/task-quote.module';
import { TaskService } from './task.service';
import { TaskAnalyticsService } from './task-analytics.service';
import { TaskRepository } from './repositories/task.repository';
import { TaskPrismaRepository } from './repositories/task-prisma.repository';
import { TaskListener } from './task.listener';
import { LayoutListener } from './layout.listener';
import { TaskNotificationScheduler } from './task-notification.scheduler';
import { TaskFieldTrackerService } from './task-field-tracker.service';
import { TaskNotificationService } from '@modules/common/notification/task-notification.service';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';
import { FileModule } from '@modules/common/file/file.module';
import { NotificationModule } from '@modules/common/notification/notification.module';
import { NfseModule } from '@modules/integrations/nfse/nfse.module';

@Module({
  imports: [
    PrismaModule,
    ChangeLogModule,
    FileModule,
    NotificationModule,
    NfseModule,
    forwardRef(() => TaskQuoteModule),
  ],
  controllers: [TaskController],
  providers: [
    TaskService,
    TaskAnalyticsService,
    TaskListener,
    LayoutListener,
    TaskNotificationScheduler,
    TaskFieldTrackerService,
    TaskNotificationService,
    {
      provide: TaskRepository,
      useClass: TaskPrismaRepository,
    },
  ],
  exports: [TaskService, TaskRepository],
})
export class TaskModule {}
