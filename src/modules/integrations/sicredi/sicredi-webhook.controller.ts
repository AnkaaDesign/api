import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { SicrediWebhookService } from './sicredi-webhook.service';
import { WebhookEventDto } from './dto';

@Controller('webhooks/sicredi')
export class SicrediWebhookController {
  private readonly logger = new Logger(SicrediWebhookController.name);

  constructor(
    private readonly webhookService: SicrediWebhookService,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  async handleWebhook(@Body() payload: WebhookEventDto): Promise<{ received: boolean }> {
    this.logger.log(
      `Received Sicredi webhook event: ${payload.idEventoWebhook} - movimento: ${payload.movimento}`,
    );

    // Immediately return 200, process asynchronously
    this.webhookService.processEvent(payload).catch((error) => {
      this.logger.error(
        `Failed to process Sicredi webhook event ${payload.idEventoWebhook}`,
        error,
      );
    });

    return { received: true };
  }
}
