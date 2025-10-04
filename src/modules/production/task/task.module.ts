// tasks.module.ts
import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskRepository } from './repositories/task.repository';
import { TaskPrismaRepository } from './repositories/task-prisma.repository';
import { PrismaModule } from '@modules/common/prisma/prisma.module';
import { ChangeLogModule } from '@modules/common/changelog/changelog.module';

@Module({
  imports: [PrismaModule, ChangeLogModule],
  controllers: [TaskController],
  providers: [
    TaskService,
    {
      provide: TaskRepository,
      useClass: TaskPrismaRepository,
    },
  ],
  exports: [TaskService, TaskRepository],
})
export class TaskModule {}
