import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { NoRateLimit, Roles, WriteRateLimit } from '@decorators';
import { SECTOR_PRIVILEGES } from '@constants';
import { ZodValidationPipe } from '@modules/common/pipes/zod-validation.pipe';
import { TaskLabelPrinterService } from './task-label-printer.service';
import { taskLabelPrintSchema, type TaskLabelPrintFormData } from './task-label.schemas';

// Truck-body label sheets, printed by the server on the office Epson (agenda → "Imprimir Etiquetas").
@Controller('task-labels')
@Roles(SECTOR_PRIVILEGES.ADMIN)
export class TaskLabelController {
  constructor(private readonly printer: TaskLabelPrinterService) {}

  @Get('printer')
  @NoRateLimit() // polled by the open print dialog
  async printerStatus() {
    return {
      success: true,
      message: 'Estado da impressora obtido.',
      data: await this.printer.getStatus(),
    };
  }

  @Post('print')
  @HttpCode(HttpStatus.ACCEPTED)
  @WriteRateLimit()
  async print(
    @Body(new ZodValidationPipe(taskLabelPrintSchema, { coerceFormData: false }))
    body: TaskLabelPrintFormData,
  ) {
    // the pipe already enforced both fields; the inferred type only reads optional under strict: false
    const labels = body.labels.map(l => ({ slot: l.slot as number, taskId: l.taskId as string }));
    const data = await this.printer.print(labels);
    return { success: true, message: 'Folha enviada para a impressora.', data };
  }

  @Get('jobs/:jobId')
  @NoRateLimit() // polled until the sheet comes out
  async job(@Param('jobId', ParseIntPipe) jobId: number) {
    return {
      success: true,
      message: 'Estado do trabalho obtido.',
      data: await this.printer.getJob(jobId),
    };
  }
}
