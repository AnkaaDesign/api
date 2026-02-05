import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsRepository } from './sms.repository';
import { cleanPhone } from '../../../../utils';

// Lazy-loaded Twilio types
type TwilioClient = import('twilio').Twilio;

@Injectable()
export class TwilioRepository extends SmsRepository implements OnModuleInit {
  private readonly logger = new Logger(TwilioRepository.name);
  private twilioClient: TwilioClient | null = null;
  private readonly fromNumber: string;
  private readonly accountSid: string | undefined;
  private readonly authToken: string | undefined;
  private isInitialized = false;
  private initializationError: string | null = null;
  private readonly isDisabled: boolean;

  constructor(private configService: ConfigService) {
    super();

    // Check if SMS is explicitly disabled
    this.isDisabled = this.configService.get<string>('DISABLE_SMS') === 'true';

    if (this.isDisabled) {
      this.initializationError = 'SMS service is disabled via DISABLE_SMS environment variable';
      this.fromNumber = '';
      this.logger.warn(this.initializationError);
      return;
    }

    this.accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    this.authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER') || '';

    this.logger.log(`Twilio configuration check:`);
    this.logger.log(`Account SID: ${this.accountSid ? 'SET' : 'MISSING'}`);
    this.logger.log(`Auth Token: ${this.authToken ? 'SET' : 'MISSING'}`);
    this.logger.log(`Phone Number: ${this.fromNumber ? this.fromNumber : 'MISSING'}`);

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      this.initializationError = 'Twilio credentials are not configured - SMS will not be sent';
      this.logger.warn(this.initializationError);
    }
  }

  /**
   * Module initialization - just log status, don't load Twilio SDK yet
   * Twilio SDK is only loaded when actually sending an SMS (truly lazy)
   */
  async onModuleInit(): Promise<void> {
    if (this.initializationError) {
      this.logger.warn(`SMS service disabled: ${this.initializationError}`);
      return;
    }

    this.logger.log('SMS service configured - Twilio SDK will be loaded on first use');
    // NOTE: We do NOT initialize Twilio here to avoid ts-node-dev IPC channel issues
    // The heavy Twilio SDK (~100+ modules) is only loaded when sendSms() is called
  }

  /**
   * Lazily initialize the Twilio client
   * Uses dynamic import to avoid loading the heavy SDK at startup
   * Handles ts-node-dev IPC channel issues gracefully
   */
  private async initializeTwilioClient(): Promise<void> {
    if (this.isInitialized || this.twilioClient) {
      return;
    }

    if (!this.accountSid || !this.authToken) {
      this.initializationError = 'Twilio credentials not configured';
      return;
    }

    try {
      this.logger.log('Initializing Twilio client (lazy loading)...');

      // Dynamic import to avoid loading the heavy SDK at module load time
      // This prevents ERR_IPC_CHANNEL_CLOSED errors with ts-node-dev
      const twilioModule = await import('twilio');
      const Twilio = (twilioModule.default || twilioModule.Twilio) as any;

      this.twilioClient = new Twilio(this.accountSid, this.authToken);
      this.isInitialized = true;
      this.logger.log('Twilio client initialized successfully');
    } catch (error: any) {
      // Handle ts-node-dev IPC channel closed error gracefully
      const errorMessage = error.message || '';
      const isIpcError =
        errorMessage.includes('Channel closed') || error.code === 'ERR_IPC_CHANNEL_CLOSED';

      if (isIpcError) {
        this.logger.warn(
          'Twilio SDK loading interrupted (ts-node-dev IPC issue). ' +
            'SMS will be retried on next attempt. This is normal in development.',
        );
        // Don't set permanent error - allow retry on next sendSms call
        this.twilioClient = null;
        this.isInitialized = false;
      } else {
        this.initializationError = `Failed to initialize Twilio client: ${error.message}`;
        this.logger.error(this.initializationError, error.stack);
        this.twilioClient = null;
      }
    }
  }

  /**
   * Ensure Twilio client is ready before use
   * Implements retry logic for transient initialization failures
   */
  private async ensureClient(): Promise<TwilioClient> {
    // Check for permanent configuration errors
    if (this.initializationError && !this.twilioClient) {
      throw new Error(this.initializationError);
    }

    // Try to initialize if not ready
    if (!this.twilioClient) {
      await this.initializeTwilioClient();
    }

    // If still not available, try one more time (handles IPC recovery)
    if (!this.twilioClient && !this.initializationError) {
      this.logger.log('Retrying Twilio client initialization...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay before retry
      await this.initializeTwilioClient();
    }

    if (!this.twilioClient) {
      throw new Error(
        this.initializationError || 'SMS service temporarily unavailable. Please try again later.',
      );
    }

    return this.twilioClient;
  }

  /**
   * Check if SMS service is configured and available
   * @returns boolean indicating if SMS can be sent
   */
  isConfigured(): boolean {
    return !this.initializationError && !!this.accountSid && !!this.authToken && !!this.fromNumber;
  }

  /**
   * Get the current status of the Twilio client
   */
  getStatus(): { configured: boolean; initialized: boolean; error: string | null } {
    return {
      configured: this.isConfigured(),
      initialized: this.isInitialized,
      error: this.initializationError,
    };
  }

  async sendSms(to: string, message: string): Promise<void> {
    this.logger.log(`Attempting to send SMS to ${this.maskPhone(to)}`);

    try {
      // Ensure Twilio client is initialized (lazy loading)
      const client = await this.ensureClient();

      const cleanedPhone = cleanPhone(to);
      const formattedPhone = this.formatBrazilianPhone(cleanedPhone);

      this.logger.log(`Sending SMS: ${this.maskPhone(to)} -> ${this.maskPhone(formattedPhone)}`);
      this.logger.log(`Message: ${message.substring(0, 50)}...`);
      this.logger.log(`From: ${this.fromNumber}`);

      const result = await client.messages.create({
        body: message,
        from: this.fromNumber,
        to: formattedPhone,
      });

      this.logger.log(`SMS sent successfully to ${this.maskPhone(to)}: ${result.sid}`);
    } catch (error: any) {
      this.logger.error(`Failed to send SMS to ${this.maskPhone(to)}: ${error.message}`);

      // Log Twilio-specific error details
      if (error.code) {
        this.logger.error(`Twilio error code: ${error.code}`);
      }
      if (error.moreInfo) {
        this.logger.error(`More info: ${error.moreInfo}`);
      }

      // Provide user-friendly error messages based on error type
      if (error.message?.includes('not configured') || error.message?.includes('not available')) {
        throw new Error(
          'Serviço de SMS não está disponível no momento. Tente novamente mais tarde.',
        );
      }

      throw new Error(`Falha ao enviar SMS: ${error.message}`);
    }
  }

  private formatBrazilianPhone(phone: string): string {
    // Remove any non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Handle Brazilian phone numbers
    if (digits.length === 13 && digits.startsWith('55')) {
      // Already has country code (55 + 11 digits)
      return `+${digits}`;
    } else if (digits.length === 12 && digits.startsWith('55')) {
      // Already has country code (55 + 10 digits)
      return `+${digits}`;
    } else if (digits.length === 11) {
      // Mobile number without country code
      return `+55${digits}`;
    } else if (digits.length === 10) {
      // Landline without country code
      return `+55${digits}`;
    }

    // Fallback - assume it's already formatted
    return phone.startsWith('+') ? phone : `+55${digits}`;
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }
}
