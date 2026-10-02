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
import { TaskLabelSheetStore } from './task-label-sheet.store';
import {
  taskLabelPrintSchema,
  taskLabelReleaseSchema,
  type TaskLabelPrintFormData,
  type TaskLabelReleaseFormData,
} from './task-label.schemas';

// Truck-body label sheets, printed by the server on the office Epson (agenda → "Imprimir Etiquetas").
@Controller('task-labels')
@Roles(SECTOR_PRIVILEGES.ADMIN)
export class TaskLabelController {
  constructor(
    private readonly printer: TaskLabelPrinterService,
    private readonly sheet: TaskLabelSheetStore,
  ) {}

  // the sheet in the printer is shared: every user sees and changes the same printed slots
  @Get('sheet')
  @NoRateLimit() // polled by the open print dialog
  async getSheet() {
    return { success: true, message: 'Folha atual obtida.', data: await this.sheet.get() };
  }

  @Post('sheet/new')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async newSheet() {
    return {
      success: true,
      message: 'Folha nova iniciada.',
      data: await this.sheet.startNewSheet(),
    };
  }

  @Post('sheet/release')
  @HttpCode(HttpStatus.OK)
  @WriteRateLimit()
  async release(
    @Body(new ZodValidationPipe(taskLabelReleaseSchema, { coerceFormData: false }))
    body: TaskLabelReleaseFormData,
  ) {
    const slots = body.slots.map(s => s as number);
    return { success: true, message: 'Espaços liberados.', data: await this.sheet.release(slots) };
  }

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
