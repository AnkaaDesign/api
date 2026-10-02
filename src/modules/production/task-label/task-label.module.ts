import { Module } from '@nestjs/common';
import { TaskLabelController } from './task-label.controller';
import { TaskLabelPrinterService } from './task-label-printer.service';

@Module({
  controllers: [TaskLabelController],
  providers: [TaskLabelPrinterService],
})
export class TaskLabelModule {}
