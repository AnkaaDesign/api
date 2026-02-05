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
   * Events we handle:
   * - sign: Individual signature completed
   * - document_closed: Signed PDF ready for download (main completion event)
   * - auto_close: Document finalized automatically after last signature
   * - refusal: Document refused by signer
   * - cancel: Document cancelled
   * - acceptance_term_*: WhatsApp acceptance events
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
      const eventName = this.clickSignService.getEventName(event);
      const documentKey = this.clickSignService.getDocumentKeyFromEvent(event);
      this.logger.log(`Webhook event: ${eventName} for document ${documentKey || 'unknown'}`);

      // Handle signature completion events (document_closed, auto_close)
      if (this.clickSignService.isSignatureCompletedEvent(event)) {
        await this.handleSignatureCompleted(event);
      }
      // Handle refusal events
      else if (this.clickSignService.isRefusalEvent(event)) {
        await this.handleSignatureRefused(event);
      }
      // Handle WhatsApp errors
      else if (this.clickSignService.isWhatsAppErrorEvent(event)) {
        this.logger.warn(`WhatsApp error event: ${eventName} for document ${documentKey}`);
        // Could notify admin or retry via email
      }
      // Log sign events for tracking
      else if (this.clickSignService.isSignEvent(event)) {
        this.logger.log(
          `Signature completed by ${event.event.data?.signer?.name || 'unknown'} for document ${documentKey}`,
        );
      }

      return {
        received: true,
        message: `Event ${eventName} processed successfully`,
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
   * Handle signature completion (document_closed or auto_close events)
   */
  private async handleSignatureCompleted(event: ClickSignWebhookEvent): Promise<void> {
    const documentKey = this.clickSignService.getDocumentKeyFromEvent(event);
    const deliveryIds = this.clickSignService.getDeliveryIdsFromEvent(event);

    if (!documentKey) {
      this.logger.warn('No document key found in webhook payload');
      return;
    }

    this.logger.log(
      `Processing signature completion for document ${documentKey} (${deliveryIds.length} deliveries from metadata)`,
    );

    // Get signed document URL
    const signedDocUrl = this.clickSignService.getSignedDocumentUrl(event);
    const signedAt = this.clickSignService.getEventTimestamp(event);

    await this.ppeSignatureService.handleSignatureCompletion({
      envelopeId: '', // Not used in document-based lookup
      documentKey,
      signedAt,
      signedDocumentUrl: signedDocUrl,
    });

    this.logger.log(`Signature completion processed for document: ${documentKey}`);
  }

  /**
   * Handle signature refusal (refusal, cancel, acceptance_term_refused events)
   */
  private async handleSignatureRefused(event: ClickSignWebhookEvent): Promise<void> {
    const documentKey = this.clickSignService.getDocumentKeyFromEvent(event);
    const eventName = this.clickSignService.getEventName(event);

    if (!documentKey) {
      this.logger.warn('No document key found in refusal webhook payload');
      return;
    }

    this.logger.log(`Processing signature refusal (${eventName}) for document ${documentKey}`);

    // Find deliveries by document key and reject them
    try {
      // Get signer info if available
      const signerName = event.event.data?.signer?.name || 'Signatário';
      const reason = `Documento recusado por ${signerName} (${eventName})`;

      await this.ppeSignatureService.handleSignatureRefusal(documentKey, reason);
      this.logger.log(`Signature refusal processed for document: ${documentKey}`);
    } catch (error) {
      this.logger.error(`Error processing signature refusal: ${error}`);
    }
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
