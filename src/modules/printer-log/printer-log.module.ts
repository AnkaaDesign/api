import { Module } from '@nestjs/common';
import { PrinterLogController } from './printer-log.controller';
import { PrinterLogService } from './printer-log.service';

@Module({
  controllers: [PrinterLogController],
  providers: [PrinterLogService],
})
export class PrinterLogModule {}
