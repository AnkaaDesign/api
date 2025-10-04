import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { SmsRepository } from './sms.repository';
import { cleanPhone } from '../../../../utils';

@Injectable()
export class TwilioRepository extends SmsRepository {
  private readonly logger = new Logger(TwilioRepository.name);
  private readonly twilioClient: Twilio;
  private readonly fromNumber: string;

  constructor(private configService: ConfigService) {
    super();

    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER')!;

    this.logger.log(`Twilio configuration check:`);
    this.logger.log(`Account SID: ${accountSid ? 'SET' : 'MISSING'}`);
    this.logger.log(`Auth Token: ${authToken ? 'SET' : 'MISSING'}`);
    this.logger.log(`Phone Number: ${this.fromNumber ? this.fromNumber : 'MISSING'}`);

    if (!accountSid || !authToken || !this.fromNumber) {
      this.logger.error('Twilio credentials are not configured - SMS will not be sent');
      return;
    }

    try {
      this.twilioClient = new Twilio(accountSid, authToken);
      this.logger.log('Twilio client initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Twilio client: ${error.message}`);
    }
  }

  async sendSms(to: string, message: string): Promise<void> {
    this.logger.log(`Attempting to send SMS to ${this.maskPhone(to)}`);

    if (!this.twilioClient) {
      this.logger.error(`SMS not sent to ${this.maskPhone(to)} - Twilio client not initialized`);
      throw new Error('Twilio client not configured');
    }

    try {
      const cleanedPhone = cleanPhone(to);
      const formattedPhone = this.formatBrazilianPhone(cleanedPhone);

      this.logger.log(`Sending SMS: ${this.maskPhone(to)} -> ${this.maskPhone(formattedPhone)}`);
      this.logger.log(`Message: ${message.substring(0, 50)}...`);
      this.logger.log(`From: ${this.fromNumber}`);

      const result = await this.twilioClient.messages.create({
        body: message,
        from: this.fromNumber,
        to: formattedPhone,
      });

      this.logger.log(`SMS sent successfully to ${this.maskPhone(to)}: ${result.sid}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${this.maskPhone(to)}: ${error.message}`);
      if (error.code) {
        this.logger.error(`Twilio error code: ${error.code}`);
      }
      if (error.moreInfo) {
        this.logger.error(`More info: ${error.moreInfo}`);
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
