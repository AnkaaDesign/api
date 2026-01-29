/**
 * ClickSign Webhook Controller
 *
 * Handles incoming webhooks from ClickSign for signature events.
 * Updates PPE delivery status when signatures are completed.
 */

import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { Public, NoRateLimit } from '@decorators';
import { ClickSignService, ClickSignWebhookEvent } from './clicksign.service';
import { PpeSignatureService } from '@modules/inventory/ppe/ppe-signature.service';

@Controller('webhooks/clicksign')
export class ClickSignController {
  private readonly logger = new Logger(ClickSignController.name);

  constructor(
    private readonly clickSignService: ClickSignService,
    private readonly ppeSignatureService: PpeSignatureService,
  ) {}

  /**
   * Handle ClickSign webhook events
   *
   * Events we care about:
   * - requirement_fulfilled: A signer completed their action
   * - envelope_finished: All requirements are complete, document is fully signed
   */
  @Post()
  @Public()
  @NoRateLimit()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Req() req: Request,
  ): Promise<{ received: boolean; message: string }> {
    this.logger.log('Received ClickSign webhook');

    try {
      // Validate webhook signature if secret is configured
      const signature = req.headers['x-clicksign-signature'] as string;
      const rawBody = JSON.stringify(body);

      if (signature && !this.clickSignService.validateWebhookSignature(rawBody, signature)) {
        this.logger.warn('Invalid webhook signature');
        throw new BadRequestException('Invalid webhook signature');
      }

      // Parse the event
      const event = this.clickSignService.parseWebhookEvent(body);
      this.logger.log(`Webhook event: ${event.event} for envelope ${event.envelope.id}`);

      // Handle signature completion events
      if (this.clickSignService.isSignatureCompletedEvent(event)) {
        await this.handleSignatureCompleted(event);
      }

      return {
        received: true,
        message: `Event ${event.event} processed successfully`,
      };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error}`);

      // Return success to prevent ClickSign from retrying
      // Log the error for investigation
      return {
        received: true,
        message: `Event logged with error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Handle signature completion
   */
  private async handleSignatureCompleted(event: ClickSignWebhookEvent): Promise<void> {
    const deliveryIds = this.clickSignService.getDeliveryIdsFromEvent(event);

    if (deliveryIds.length === 0) {
      this.logger.warn('No delivery IDs found in webhook metadata');
      return;
    }

    this.logger.log(`Processing signature completion for ${deliveryIds.length} deliveries`);

    // Only process when envelope is fully finished (all signers completed)
    if (!this.clickSignService.isEnvelopeFinished(event)) {
      this.logger.log('Envelope not yet finished - waiting for all signatures');
      return;
    }

    // Get signed document URL
    const signedDocUrl = event.document?.downloads?.signed_file_url;

    await this.ppeSignatureService.handleSignatureCompletion({
      envelopeId: event.envelope.id,
      documentKey: event.document?.key || '',
      signedAt: new Date(event.occurred_at),
      signedDocumentUrl: signedDocUrl,
    });

    this.logger.log(`Signature completion processed for deliveries: ${deliveryIds.join(', ')}`);
  }

  /**
   * Health check endpoint for ClickSign webhook configuration
   */
  @Post('health')
  @Public()
  @NoRateLimit()
  @HttpCode(HttpStatus.OK)
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
