import { Controller, Post, Get, Put, Body, Param, HttpCode, Logger } from '@nestjs/common';
import { Public } from '@modules/common/auth/decorators/public.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '@constants';
import { SicrediWebhookService } from './sicredi-webhook.service';
import { SicrediService } from './sicredi.service';
import { WebhookEventDto } from './dto';

@Controller('webhooks/sicredi')
export class SicrediWebhookController {
  private readonly logger = new Logger(SicrediWebhookController.name);

  constructor(
    private readonly webhookService: SicrediWebhookService,
    private readonly sicrediService: SicrediService,
  ) {}

  /**
   * POST /webhooks/sicredi
   * Receives webhook events from Sicredi. Public endpoint (no auth) per Sicredi docs.
   */
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

  /**
   * POST /webhooks/sicredi/contract
   * Register a webhook contract with Sicredi.
   */
  @Post('contract')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async registerContract(@Body() body: { url: string }) {
    return this.sicrediService.registerWebhookContract(body.url);
  }

  /**
   * GET /webhooks/sicredi/contract
   * Query existing webhook contracts.
   */
  @Get('contract')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async queryContracts() {
    return this.sicrediService.queryWebhookContracts();
  }

  /**
   * PUT /webhooks/sicredi/contract/:id
   * Update an existing webhook contract.
   */
  @Put('contract/:id')
  @Roles(SECTOR_PRIVILEGES.ADMIN)
  async updateContract(
    @Param('id') id: string,
    @Body() body: { url?: string; urlStatus?: 'ATIVO' | 'INATIVO' | 'BLOQUEADO'; contratoStatus?: 'ATIVO' | 'INATIVO' | 'BLOQUEADO' },
  ) {
    return this.sicrediService.updateWebhookContract(id, body);
  }
}
