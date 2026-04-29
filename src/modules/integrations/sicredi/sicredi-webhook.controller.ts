import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  HttpCode,
  Logger,
  Req,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
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
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /webhooks/sicredi
   * Receives webhook events from Sicredi. Public endpoint guarded by HMAC-SHA256
   * signature verification (header `x-signature` or `x-sicredi-signature`).
   */
  @Post()
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: any,
    @Body() payload: WebhookEventDto,
  ): Promise<{ received: boolean }> {
    this.verifySignature(req);

    this.logger.log(
      `Received Sicredi webhook event: ${payload.idEventoWebhook} - movimento: ${payload.movimento}`,
    );

    // Immediately return 200, process asynchronously
    this.webhookService.processEvent(payload).catch(error => {
      this.logger.error(
        `Failed to process Sicredi webhook event ${payload.idEventoWebhook}`,
        error,
      );
    });

    return { received: true };
  }

  private verifySignature(req: any): void {
    const secret = this.configService.get<string>('SICREDI_WEBHOOK_SECRET');
    const isProduction = process.env.NODE_ENV === 'production';

    if (!secret) {
      if (isProduction) {
        this.logger.error('SICREDI_WEBHOOK_SECRET is not configured in production');
        throw new InternalServerErrorException('Webhook secret not configured');
      }
      this.logger.warn(
        'SICREDI_WEBHOOK_SECRET not set — bypassing signature verification (non-production only)',
      );
      return;
    }

    const signature: string | undefined =
      req.headers?.['x-signature'] || req.headers?.['x-sicredi-signature'];

    if (!signature) {
      this.logger.warn(
        'Sicredi webhook request missing signature header (x-signature / x-sicredi-signature)',
      );
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Raw body captured by main.ts middleware before JSON parsing
    const rawBody: Buffer | undefined = req.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body unavailable for signature verification');
      throw new UnauthorizedException('Cannot verify webhook signature');
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    // Strip optional "sha256=" prefix some senders include
    const provided = signature.replace(/^sha256=/i, '').trim();

    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');

    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      this.logger.warn('Sicredi webhook signature mismatch');
      throw new UnauthorizedException('Invalid webhook signature');
    }
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
    @Body()
    body: {
      url?: string;
      urlStatus?: 'ATIVO' | 'INATIVO' | 'BLOQUEADO';
      contratoStatus?: 'ATIVO' | 'INATIVO' | 'BLOQUEADO';
    },
  ) {
    return this.sicrediService.updateWebhookContract(id, body);
  }
}
