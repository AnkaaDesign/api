/**
 * ClickSign Integration Service - API 3.0 (Envelope-based)
 *
 * Handles digital signature workflow using ClickSign API 3.0.
 * Used for PPE delivery document signatures.
 *
 * API Flow:
 * 1. Create envelope (container)
 * 2. Upload document to envelope
 * 3. Add signer
 * 4. Create requirements (link signer to document with auth method)
 * 5. Activate envelope
 * 6. Send notification
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

// ClickSign API 3.0 Response Types
export interface ClickSignEnvelope {
  id: string;
  type: 'envelopes';
  attributes: {
    name: string;
    locale: string;
    status: 'draft' | 'running' | 'finished' | 'canceled';
    created_at: string;
    updated_at: string;
    finished_at: string | null;
    metadata: Record<string, any>;
  };
}

export interface ClickSignDocument {
  id: string;
  type: 'documents';
  attributes: {
    key: string;
    filename: string;
    content_type: string;
    status: string;
    created_at: string;
    updated_at: string;
    downloads: {
      original_file_url: string;
      signed_file_url: string | null;
    };
  };
}

export interface ClickSignSigner {
  id: string;
  type: 'signers';
  attributes: {
    key: string;
    email: string;
    name: string;
    documentation: string | null;
    phone_number: string | null;
    created_at: string;
  };
}

export interface ClickSignRequirement {
  id: string;
  type: 'requirements';
  attributes: {
    action: string;
    status: string;
    created_at: string;
  };
}

export interface ClickSignNotificationResponse {
  data: {
    id: string;
    type: 'notifications';
    attributes: {
      sent_at: string;
      message: string;
    };
  };
}

// Webhook Event Types (ClickSign)
// Based on official documentation: https://developers.clicksign.com/docs/evento-sign
export interface ClickSignWebhookEvent {
  event: {
    name: string; // 'sign', 'document_closed', 'auto_close', 'refusal', 'cancel', etc.
    data?: {
      account?: { key: string };
      signer?: {
        key: string;
        email: string;
        name: string;
        phone_number?: string;
        sign_as?: string;
        auths?: string[];
        url?: string;
      };
      secret_hmac?: string | null;
    };
    occurred_at?: string;
  };
  // Document object containing key, downloads, metadata
  document?: {
    key: string;
    filename?: string;
    status?: string;
    auto_close?: boolean;
    finished_at?: string;
    metadata?: Record<string, any>;
    downloads?: {
      original_file_url?: string;
      signed_file_url?: string;
      ziped_file_url?: string;
    };
    signers?: Array<{
      key: string;
      email: string;
      name: string;
    }>;
  };
}

// Service Input Types
export interface CreateEnvelopeInput {
  name: string;
  deliveryIds: string[];
}

export interface CreateDocumentInput {
  envelopeId: string;
  pdfBuffer: Buffer;
  filename: string;
  metadata?: Record<string, any>;
}

export interface CreateSignerInput {
  envelopeId: string;
  email: string;
  name: string;
  cpf?: string;
  phoneNumber?: string;
}

export interface CreateRequirementInput {
  envelopeId: string;
  documentId: string;
  signerId: string;
  action?: 'sign' | 'approve' | 'acknowledge';
  authMethod?: 'email' | 'sms' | 'whatsapp' | 'pix' | 'biometrics';
}

export interface SignatureResult {
  envelopeId: string;
  documentId: string;
  documentKey: string;
  signerId: string;
  signerKey: string;
  requirementId: string;
  signatureUrl: string;
}

@Injectable()
export class ClickSignService {
  private readonly logger = new Logger(ClickSignService.name);
  private readonly client: AxiosInstance;
  private readonly accessToken: string | undefined;
  private readonly isConfigured: boolean;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    // API 3.0 base URL
    this.apiUrl =
      this.configService.get<string>('CLICKSIGN_API_URL') || 'https://sandbox.clicksign.com/api/v3';
    this.accessToken = this.configService.get<string>('CLICKSIGN_ACCESS_TOKEN');
    this.isConfigured = !!this.accessToken;

    if (!this.isConfigured) {
      this.logger.warn(
        'ClickSign is not configured - CLICKSIGN_ACCESS_TOKEN is missing. Digital signatures will be disabled.',
      );
    }

    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      timeout: 60000, // 60 seconds for file uploads
    });

    // Add auth to all requests - ClickSign API v3 uses Authorization header with token directly
    this.client.interceptors.request.use(config => {
      if (this.accessToken) {
        // ClickSign API v3 - Authorization header with token directly (no Bearer prefix)
        config.headers.Authorization = this.accessToken;
      }
      this.logger.debug(
        `ClickSign API Request: ${config.method?.toUpperCase()} ${this.apiUrl}${config.url}`,
      );
      return config;
    });

    // Add retry logic for rate limiting (429) with exponential backoff
    this.client.interceptors.response.use(
      response => response,
      async error => {
        const config = error.config;

        // Only retry on 429 (rate limit) errors
        if (error.response?.status === 429 && !config._retryCount) {
          config._retryCount = 0;
        }

        if (error.response?.status === 429 && config._retryCount < 5) {
          config._retryCount += 1;
          const delay = 5000 * Math.pow(2, config._retryCount - 1); // 5s, 10s, 20s, 40s, 80s
          this.logger.warn(`Rate limited (429). Retry ${config._retryCount}/5 after ${delay}ms...`);

          await new Promise(resolve => setTimeout(resolve, delay));
          return this.client.request(config);
        }

        return Promise.reject(error);
      },
    );
  }

  /**
   * Helper to add delay between API calls to avoid rate limiting
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if ClickSign service is properly configured
   */
  isAvailable(): boolean {
    return this.isConfigured;
  }

  /**
   * Step 1: Create an envelope (container for documents and signers)
   */
  async createEnvelope(input: CreateEnvelopeInput): Promise<ClickSignEnvelope> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      const response = await this.client.post('/envelopes', {
        data: {
          type: 'envelopes',
          attributes: {
            name: input.name,
            locale: 'pt-BR',
            auto_close: true,
            remind_interval: '3', // String: 1, 2, 3, 7, or 14 days
            block_after_refusal: false,
            // Store delivery IDs in metadata for webhook retrieval
            metadata: {
              delivery_ids: input.deliveryIds.join(','),
            },
          },
        },
      });

      this.logger.log(
        `Envelope created: ${response.data.data.id} with ${input.deliveryIds.length} delivery IDs`,
      );
      return response.data.data;
    } catch (error) {
      this.handleApiError(error, 'createEnvelope');
      throw error;
    }
  }

  /**
   * Step 2: Upload a document to the envelope
   * Includes metadata with delivery IDs for webhook retrieval
   */
  async uploadDocument(input: CreateDocumentInput): Promise<ClickSignDocument> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      const base64Content = input.pdfBuffer.toString('base64');

      const attributes: any = {
        filename: input.filename,
        content_base64: `data:application/pdf;base64,${base64Content}`,
      };

      // Add metadata if provided (includes delivery_ids for webhook retrieval)
      if (input.metadata) {
        attributes.metadata = input.metadata;
      }

      const response = await this.client.post(`/envelopes/${input.envelopeId}/documents`, {
        data: {
          type: 'documents',
          attributes,
        },
      });

      this.logger.log(
        `Document uploaded to envelope ${input.envelopeId}: ${response.data.data.id}`,
      );
      return response.data.data;
    } catch (error) {
      this.handleApiError(error, 'uploadDocument');
      throw error;
    }
  }

  /**
   * Step 3: Add a signer to the envelope
   * Configures WhatsApp as the notification channel if phone number is provided
   */
  async addSigner(input: CreateSignerInput): Promise<ClickSignSigner> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      // Configure notification channel
      const notificationChannel = 'email';

      const signerAttributes: any = {
        name: input.name,
        email: input.email,
        has_documentation: false, // Don't ask for CPF/birthday - simplest flow
        // Configure notification preferences
        communicate_events: {
          document_signed: notificationChannel,
          signature_request: notificationChannel,
          signature_reminder: notificationChannel,
        },
      };

      // Add phone number for WhatsApp notifications (Brazilian format: 55XXXXXXXXXXX)
      if (input.phoneNumber) {
        // Ensure phone is in international format
        let formattedPhone = input.phoneNumber.replace(/\D/g, '');
        if (!formattedPhone.startsWith('55')) {
          formattedPhone = '55' + formattedPhone;
        }
        signerAttributes.phone_number = formattedPhone;
      }

      const response = await this.client.post(`/envelopes/${input.envelopeId}/signers`, {
        data: {
          type: 'signers',
          attributes: signerAttributes,
        },
      });

      this.logger.log(
        `Signer added to envelope ${input.envelopeId}: ${response.data.data.id} (notifications via ${notificationChannel})`,
      );
      return response.data.data;
    } catch (error) {
      this.handleApiError(error, 'addSigner');
      throw error;
    }
  }

  /**
   * Step 4: Create requirements linking signer to document
   * Per official docs: need TWO requirements - one for agreement/signing, one for authentication
   */
  async createRequirement(input: CreateRequirementInput): Promise<ClickSignRequirement> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      // First requirement: Agreement with role "sign"
      const agreeResponse = await this.client.post(`/envelopes/${input.envelopeId}/requirements`, {
        data: {
          type: 'requirements',
          attributes: {
            action: 'agree',
            role: 'sign',
          },
          relationships: {
            document: {
              data: { type: 'documents', id: input.documentId },
            },
            signer: {
              data: { type: 'signers', id: input.signerId },
            },
          },
        },
      });

      this.logger.log(`Agreement requirement created: ${agreeResponse.data.data.id}`);

      // Add delay between requirement calls to avoid rate limiting
      await this.delay(3000);

      // Second requirement: Authentication via email (simplest method)
      const authResponse = await this.client.post(`/envelopes/${input.envelopeId}/requirements`, {
        data: {
          type: 'requirements',
          attributes: {
            action: 'provide_evidence',
            auth: input.authMethod || 'email',
          },
          relationships: {
            document: {
              data: { type: 'documents', id: input.documentId },
            },
            signer: {
              data: { type: 'signers', id: input.signerId },
            },
          },
        },
      });

      this.logger.log(`Auth requirement created: ${authResponse.data.data.id}`);
      return agreeResponse.data.data;
    } catch (error) {
      this.handleApiError(error, 'createRequirement');
      throw error;
    }
  }

  /**
   * Step 5: Activate the envelope (start the signing process)
   */
  async activateEnvelope(envelopeId: string): Promise<ClickSignEnvelope> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      const response = await this.client.patch(`/envelopes/${envelopeId}`, {
        data: {
          type: 'envelopes',
          id: envelopeId,
          attributes: {
            status: 'running',
          },
        },
      });

      this.logger.log(`Envelope activated: ${envelopeId}`);
      return response.data.data;
    } catch (error) {
      this.handleApiError(error, 'activateEnvelope');
      throw error;
    }
  }

  /**
   * Step 6: Send notification to all signers in the envelope
   */
  async sendNotification(envelopeId: string): Promise<ClickSignNotificationResponse> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      // Per official docs: empty attributes notifies all signers
      const response = await this.client.post(`/envelopes/${envelopeId}/notifications`, {
        data: {
          type: 'notifications',
          attributes: {},
        },
      });

      this.logger.log(`Notification sent to all signers in envelope ${envelopeId}`);
      return response.data;
    } catch (error) {
      this.handleApiError(error, 'sendNotification');
      throw error;
    }
  }

  /**
   * Get envelope details
   */
  async getEnvelope(envelopeId: string): Promise<ClickSignEnvelope> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      const response = await this.client.get(`/envelopes/${envelopeId}`);
      return response.data.data;
    } catch (error) {
      this.handleApiError(error, 'getEnvelope');
      throw error;
    }
  }

  /**
   * Get document details including download URLs
   */
  async getDocument(envelopeId: string, documentId: string): Promise<ClickSignDocument> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    try {
      const response = await this.client.get(`/envelopes/${envelopeId}/documents/${documentId}`);
      return response.data.data;
    } catch (error) {
      this.handleApiError(error, 'getDocument');
      throw error;
    }
  }

  /**
   * Download the signed document
   * Handles both full URLs and relative paths from ClickSign API
   */
  async downloadSignedDocument(signedFileUrl: string): Promise<Buffer> {
    try {
      // Determine if URL is relative or absolute
      let downloadUrl = signedFileUrl;

      // If it's a relative path, construct the full URL
      // ClickSign API v3 may return relative paths like /2023/03/13/file.pdf
      if (signedFileUrl.startsWith('/')) {
        // Derive the base domain from the configured API URL
        const parsedApiUrl = new URL(this.apiUrl);
        const baseUrl = parsedApiUrl.origin;
        downloadUrl = `${baseUrl}${signedFileUrl}`;
        this.logger.debug(`Constructed download URL: ${downloadUrl}`);
      }

      this.logger.log(`Downloading signed document from: ${downloadUrl}`);

      // Check if URL is a pre-signed S3 URL (contains X-Amz-Signature)
      // Pre-signed URLs should NOT have Authorization header - they have auth in query params
      const isPreSignedS3Url =
        downloadUrl.includes('X-Amz-Signature') || downloadUrl.includes('amazonaws.com');

      const headers: Record<string, string> = {};
      if (!isPreSignedS3Url) {
        // Only add Authorization for non-S3 URLs (ClickSign API endpoints)
        headers.Authorization = this.accessToken || '';
      }

      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers,
        timeout: 60000, // 60 seconds for large files
      });

      this.logger.log(`Downloaded signed document: ${response.data.byteLength} bytes`);
      return Buffer.from(response.data);
    } catch (error) {
      this.handleApiError(error, 'downloadSignedDocument');
      throw error;
    }
  }

  /**
   * Fetch signed document URL from API
   * Use this when the webhook doesn't include the download URL
   * Returns fresh pre-signed URL (valid for ~5 minutes)
   */
  async fetchSignedDocumentUrl(envelopeId: string, documentId: string): Promise<string | null> {
    try {
      this.logger.log(
        `Fetching signed document URL for envelope ${envelopeId}, document ${documentId}`,
      );
      const document = await this.getDocument(envelopeId, documentId);

      // Log the full document structure for debugging
      this.logger.debug(`Document API response: ${JSON.stringify(document, null, 2)}`);

      // Try multiple possible paths for the signed URL based on API version
      // API v3 uses links.files.signed, older versions use attributes.downloads.signed_file_url
      const signedUrl =
        (document as any).links?.files?.signed ||
        document.attributes?.downloads?.signed_file_url ||
        (document as any).downloads?.signed_file_url ||
        (document as any).signed_file_url;

      if (signedUrl) {
        this.logger.log(`Retrieved signed document URL: ${signedUrl.substring(0, 80)}...`);
        return signedUrl;
      }

      // Log available paths for debugging
      const links = (document as any).links;
      if (links?.files) {
        this.logger.warn(
          `No signed URL found. Available files: ${JSON.stringify(Object.keys(links.files))}`,
        );
      } else {
        this.logger.warn(
          `No signed_file_url found in document response. Available keys: ${JSON.stringify(Object.keys(document))}`,
        );
        if (document.attributes) {
          this.logger.warn(
            `Document attributes keys: ${JSON.stringify(Object.keys(document.attributes))}`,
          );
        }
      }
      return null;
    } catch (error) {
      this.logger.error(`Error fetching signed document URL: ${error}`);
      return null;
    }
  }

  /**
   * Get signer's signature URL (for direct access)
   * Note: In API v3, the URL is typically sent via email only
   */
  // ClickSign API v3 does not provide individual signer URLs - signatures are done via email link
  async getSignerUrl(envelopeId: string, signerId: string): Promise<string> {
    return '';
  }

  /**
   * Full signature workflow: create envelope, upload document, add signer, create requirement, activate, notify
   * This is the main method to use for initiating PPE delivery signatures
   */
  async initiateSignature(
    pdfBuffer: Buffer,
    filename: string,
    deliveryIds: string[],
    signer: { email: string; name: string; cpf?: string; phoneNumber?: string },
  ): Promise<SignatureResult> {
    if (!this.isConfigured) {
      throw new Error('ClickSign não está configurado. Verifique CLICKSIGN_ACCESS_TOKEN.');
    }

    this.logger.log(
      `Initiating signature for ${deliveryIds.length} deliveries, signer: ${signer.email}`,
    );

    // Step 1: Create envelope
    const envelope = await this.createEnvelope({
      name: `Termo de Entrega de EPI - ${signer.name}`,
      deliveryIds,
    });

    // Add delay between API calls to avoid rate limiting
    await this.delay(3000);

    // Step 2: Upload document with delivery IDs in metadata for webhook retrieval
    const document = await this.uploadDocument({
      envelopeId: envelope.id,
      pdfBuffer,
      filename,
      metadata: {
        delivery_ids: deliveryIds.join(','),
      },
    });

    await this.delay(3000);

    // Step 3: Add signer
    const clicksignSigner = await this.addSigner({
      envelopeId: envelope.id,
      email: signer.email,
      name: signer.name,
      cpf: signer.cpf,
      phoneNumber: signer.phoneNumber,
    });

    await this.delay(3000);

    // Step 4: Create requirement
    const authMethod = 'email';
    const requirement = await this.createRequirement({
      envelopeId: envelope.id,
      documentId: document.id,
      signerId: clicksignSigner.id,
      action: 'sign',
      authMethod,
    });

    await this.delay(3000);

    // Step 5: Activate envelope
    await this.activateEnvelope(envelope.id);

    await this.delay(3000);

    // Step 6: Send notification to all signers
    await this.sendNotification(envelope.id);

    this.logger.log(
      `Signature initiated successfully. Envelope: ${envelope.id}, Document: ${document.id}`,
    );

    return {
      envelopeId: envelope.id,
      documentId: document.id,
      documentKey: document.id, // API v3 uses document.id as the key (no attributes.key)
      signerId: clicksignSigner.id,
      signerKey: clicksignSigner.attributes.key,
      requirementId: requirement.id,
      signatureUrl: '', // URL is sent via email by ClickSign
    };
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(payload: string, signature: string): boolean {
    const secret = this.configService.get<string>('CLICKSIGN_WEBHOOK_SECRET');

    if (!secret) {
      this.logger.warn(
        'CLICKSIGN_WEBHOOK_SECRET not configured - skipping webhook signature validation',
      );
      return true;
    }

    const crypto = require('crypto');
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  /**
   * Parse webhook event from ClickSign
   * Payload structure: { event: { name: string, data: {...}, occurred_at: string }, document: {...} }
   */
  parseWebhookEvent(body: any): ClickSignWebhookEvent {
    if (!body.event?.name) {
      throw new Error('Invalid webhook payload: missing event.name');
    }
    return body as ClickSignWebhookEvent;
  }

  /**
   * Get the event name from webhook payload
   */
  getEventName(event: ClickSignWebhookEvent): string {
    return event.event.name;
  }

  /**
   * Check if event indicates signature completion (document ready for download)
   */
  isSignatureCompletedEvent(event: ClickSignWebhookEvent): boolean {
    const eventName = event.event.name;
    // 'document_closed' - signed PDF is ready for download (MAIN completion event)
    // 'auto_close' - document finalized automatically after last signature
    return eventName === 'document_closed' || eventName === 'auto_close';
  }

  /**
   * Check if all signatures are complete (document finished)
   */
  isDocumentFinished(event: ClickSignWebhookEvent): boolean {
    const eventName = event.event.name;
    return (
      eventName === 'document_closed' ||
      eventName === 'auto_close' ||
      event.document?.status === 'closed'
    );
  }

  /**
   * Check if event indicates signature refusal
   */
  isRefusalEvent(event: ClickSignWebhookEvent): boolean {
    const eventName = event.event.name;
    return (
      eventName === 'refusal' || eventName === 'acceptance_term_refused' || eventName === 'cancel'
    );
  }

  /**
   * Check if event indicates WhatsApp delivery error
   */
  isWhatsAppErrorEvent(event: ClickSignWebhookEvent): boolean {
    const eventName = event.event.name;
    return (
      eventName === 'acceptance_term_error' ||
      eventName === 'acceptance_term_expired' ||
      eventName === 'attempts_by_whatsapp_exceeded'
    );
  }

  /**
   * Check if event is a sign event (individual signature)
   */
  isSignEvent(event: ClickSignWebhookEvent): boolean {
    return event.event.name === 'sign';
  }

  /**
   * Extract delivery IDs from webhook event (stored in document metadata)
   */
  getDeliveryIdsFromEvent(event: ClickSignWebhookEvent): string[] {
    const deliveryIdsStr = event.document?.metadata?.delivery_ids;
    if (!deliveryIdsStr) {
      return [];
    }
    return deliveryIdsStr.split(',').filter((id: string) => id.trim());
  }

  /**
   * Get document key from webhook event
   */
  getDocumentKeyFromEvent(event: ClickSignWebhookEvent): string | undefined {
    return event.document?.key;
  }

  /**
   * Get signed document URL from webhook event
   */
  getSignedDocumentUrl(event: ClickSignWebhookEvent): string | undefined {
    return event.document?.downloads?.signed_file_url;
  }

  /**
   * Get event timestamp
   */
  getEventTimestamp(event: ClickSignWebhookEvent): Date {
    const timestamp = event.event.occurred_at || event.document?.finished_at;
    return timestamp ? new Date(timestamp) : new Date();
  }

  /**
   * Handle and log API errors
   */
  private handleApiError(error: unknown, operation: string): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data;

      this.logger.error(
        `ClickSign API error in ${operation}: Status ${status}, Response: ${JSON.stringify(data)}`,
      );

      if (status === 401) {
        throw new Error('ClickSign: Token de acesso inválido ou expirado.');
      } else if (status === 422) {
        const errors = (data as any)?.errors;
        const errorDetail = errors ? JSON.stringify(errors) : JSON.stringify(data);
        throw new Error(`ClickSign: Dados inválidos - ${errorDetail}`);
      } else if (status === 404) {
        throw new Error('ClickSign: Recurso não encontrado.');
      } else if (status === 400) {
        throw new Error(`ClickSign: Requisição inválida - ${JSON.stringify(data)}`);
      } else {
        throw new Error(`ClickSign: Erro na API - ${axiosError.message}`);
      }
    } else {
      this.logger.error(`ClickSign error in ${operation}: ${error}`);
      throw error;
    }
  }
}
