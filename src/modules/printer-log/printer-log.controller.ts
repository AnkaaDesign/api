import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserId } from '@modules/common/auth/decorators/user.decorator';
import { PrinterLogService } from './printer-log.service';

@Controller('printer-log')
export class PrinterLogController {
  constructor(private readonly printerLogService: PrinterLogService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async log(@Body() body: Record<string, unknown>, @UserId() userId: string): Promise<void> {
    await this.printerLogService.append({ ...body, userId });
  }
}
