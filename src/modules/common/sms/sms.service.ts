import { Injectable, Logger } from '@nestjs/common';
import { SmsRepository } from './repositories/sms.repository';
import { isValidPhone } from '../../../utils';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly smsRepository: SmsRepository) {}

  async sendSms(to: string, message: string): Promise<void> {
    if (!isValidPhone(to)) {
      throw new Error('Número de telefone inválido');
    }

    if (!message || message.trim().length === 0) {
      throw new Error('Mensagem não pode estar vazia');
    }

    if (message.length > 160) {
      throw new Error('Mensagem deve ter no máximo 160 caracteres');
    }

    const fullMessage = `[Ankaa] ${message}`;

    try {
      await this.smsRepository.sendSms(to, fullMessage);
      this.logger.log(`SMS sent successfully to ${this.maskPhone(to)}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${this.maskPhone(to)}: ${error.message}`);
      throw error;
    }
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }
}
