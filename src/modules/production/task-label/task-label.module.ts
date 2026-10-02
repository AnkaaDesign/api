import { Module } from '@nestjs/common';
import { TaskLabelController } from './task-label.controller';
import { TaskLabelPrinterService } from './task-label-printer.service';
import { TaskLabelSheetStore } from './task-label-sheet.store';

@Module({
  controllers: [TaskLabelController],
  providers: [TaskLabelPrinterService, TaskLabelSheetStore],
})
export class TaskLabelModule {}
