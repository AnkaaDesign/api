import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { UserRepository } from '../../people/user/repositories/user.repository';
import { SmsService } from '../sms/sms.service';
import { MailerRepository } from '../mailer/repositories/mailer.repository';
import { EmailService } from '../mailer/services/email.service';
import { ChangeLogService } from '../changelog/changelog.service';
import { VerificationThrottlerService } from '../throttler/verification-throttler.service';
import {
  VERIFICATION_TYPE,
  CHANGE_ACTION,
  ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
  VERIFICATION_ERROR_CODE,
} from '../../../constants/enums';
import {
  isValidPhone,
  isValidEmail,
  generateVerificationCode,
  createVerificationCodeExpiration,
  getPhoneLookupVariants,
  normalizeBrazilianPhone,
  detectContactMethod,
} from '../../../utils';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly VERIFICATION_EXPIRY_MINUTES = 10;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly smsService: SmsService,
    private readonly mailerRepository: MailerRepository,
    private readonly emailService: EmailService,
    private readonly changeLogService: ChangeLogService,
    private readonly verificationThrottler: VerificationThrottlerService,
  ) {}

  /**
   * Send a 6-digit verification code to the specified contact method
   */
  async sendVerificationCode(contact: string, ip?: string): Promise<any> {
    const startTime = Date.now();

    if (!contact) {
      throw new BadRequestException('Método de contato é obrigatório');
    }

    const user = await this.findUserByContact(contact);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (user.verified) {
      throw new BadRequestException('Usuário já verificado');
    }

    // Check rate limiting before proceeding
    if (ip) {
      const rateLimitCheck = await this.verificationThrottler.checkCodeSendAttempt(contact, ip);
      if (!rateLimitCheck.allowed) {
        const error = new BadRequestException(VERIFICATION_ERROR_CODE.TOO_MANY_REQUESTS);
        throw error;
      }
    }

    // Generate 6-digit code and expiration
    const verificationCode = this.generateSixDigitCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.VERIFICATION_EXPIRY_MINUTES);

    // Determine verification type
    const verificationType = this.getVerificationType(contact);

    // Update user with verification code
    await this.userRepository.update(user.id, {
      verificationCode,
      verificationExpiresAt: expiresAt,
      verificationType,
      verified: false,
    } as any);

    // Send verification code
    try {
      if (verificationType === VERIFICATION_TYPE.PHONE) {
        await this.sendVerificationSms(contact, user.name, verificationCode);
      } else if (verificationType === VERIFICATION_TYPE.EMAIL) {
        await this.sendVerificationEmail(contact, user.name, verificationCode);
      }

      // Record successful code send for rate limiting
      if (ip) {
        await this.verificationThrottler.recordCodeSend(contact, ip);
      }

      // Code sent successfully
      const duration = Date.now() - startTime;
      this.logger.debug(`Verification code sent to ${contact} in ${duration}ms`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification code to ${contact}: ${error.message}`,
        error.stack,
      );

      // Determine specific error type based on verification method
      const errorCode =
        verificationType === VERIFICATION_TYPE.PHONE
          ? VERIFICATION_ERROR_CODE.SMS_SEND_FAILED
          : VERIFICATION_ERROR_CODE.EMAIL_SEND_FAILED;

      const verificationError = new BadRequestException(errorCode);

      // Failed to send verification code
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to send verification code to ${contact} in ${duration}ms: ${errorCode}`,
      );

      throw verificationError;
    }

    // Log verification code sent
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verificationCode',
      oldValue: null,
      newValue: { status: 'SENT', type: verificationType, expiresAt: expiresAt.toISOString() },
      reason: `${verificationType.toLowerCase()} verification code sent`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER,
      triggeredById: user.id,
      userId: user.id,
    });

    return {
      success: true,
      message: `Verification code sent via ${verificationType.toLowerCase()}`,
      data: {
        contact,
        verificationType,
        expiresAt,
      },
    };
  }

  /**
   * Verify a 6-digit code for the specified contact method
   */
  async verifyCode(contact: string, code: string, ip?: string): Promise<any> {
    const startTime = Date.now();

    if (!contact) {
      throw new BadRequestException('Método de contato é obrigatório');
    }

    if (!code) {
      throw new BadRequestException('Código de verificação é obrigatório');
    }

    // Check rate limiting before attempting verification
    if (ip) {
      const rateLimitCheck = await this.verificationThrottler.checkVerificationAttempt(
        contact,
        code,
        ip,
      );
      if (!rateLimitCheck.allowed) {
        const errorCode = rateLimitCheck.message?.includes('IP')
          ? VERIFICATION_ERROR_CODE.IP_RATE_LIMITED
          : rateLimitCheck.message?.includes('cooldown')
            ? VERIFICATION_ERROR_CODE.CONTACT_COOLDOWN
            : VERIFICATION_ERROR_CODE.TOO_MANY_ATTEMPTS;

        const error = new BadRequestException(errorCode);
        throw error;
      }
    }

    const user = await this.findUserByContact(contact);
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (user.verified) {
      throw new BadRequestException('Usuário já verificado');
    }

    // Check if user has a verification code
    if (!user.verificationCode) {
      throw new BadRequestException('Código de verificação não encontrado');
    }

    // Check if code is expired
    if (user.verificationExpiresAt && new Date() > user.verificationExpiresAt) {
      throw new BadRequestException('Código de verificação expirado');
    }

    // Verification attempt being processed
    this.logger.debug(`Processing verification attempt for ${contact}`);

    // Verify the code against the stored verification code
    const isValidCode = code === user.verificationCode;

    // Debug logging for verification attempts
    this.logger.debug(
      `Verification attempt for ${contact}: provided="${code}", stored="${user.verificationCode}", match=${isValidCode}`,
    );

    if (!isValidCode) {
      // Record failed attempt for rate limiting
      if (ip) {
        await this.verificationThrottler.recordFailedAttempt(contact, code, ip);
      }

      this.logger.warn(
        `Invalid verification code for ${contact}: provided="${code}", expected="${user.verificationCode}"`,
      );
      throw new BadRequestException('Código de verificação inválido');
    }

    // Verify the user and clear verification code
    await this.userRepository.update(user.id, {
      verified: true,
      verificationCode: null,
      verificationExpiresAt: null,
      verificationType: null,
    } as any);

    // Clear verification rate limiting for successful verification
    if (ip) {
      await this.verificationThrottler.recordSuccessfulVerification(contact);
    }

    // Verification successful
    const duration = Date.now() - startTime;
    this.logger.debug(`Verification successful for ${contact} in ${duration}ms`);

    // Log verification
    await this.changeLogService.logChange({
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      action: CHANGE_ACTION.UPDATE,
      field: 'verified',
      oldValue: false,
      newValue: true,
      reason: `${user.verificationType?.toLowerCase() || 'contact'} verification completed`,
      triggeredBy: CHANGE_TRIGGERED_BY.USER,
      triggeredById: user.id,
      userId: user.id,
    });

    return {
      success: true,
      message: 'Conta verificada com sucesso! Você já pode fazer login',
      data: {
        verified: true,
        userId: user.id,
      },
    };
  }

  /**
   * Resend verification code to the specified contact method
   */
  async resendVerificationCode(contact: string, ip?: string): Promise<any> {
    // Use the same logic as sendVerificationCode for consistency
    return await this.sendVerificationCode(contact, ip);
  }

  // Private helper methods

  private generateSixDigitCode(): string {
    // Use crypto-secure random number generation for all environments
    return generateVerificationCode();
  }

  private getVerificationType(contact: string): VERIFICATION_TYPE {
    if (isValidEmail(contact)) {
      return VERIFICATION_TYPE.EMAIL;
    } else if (isValidPhone(contact)) {
      return VERIFICATION_TYPE.PHONE;
    }
    throw new BadRequestException(VERIFICATION_ERROR_CODE.INVALID_CONTACT_FORMAT);
  }

  private async sendVerificationSms(phone: string, userName: string, code: string): Promise<void> {
    // Normalize the phone number before sending
    const normalizedPhone = normalizeBrazilianPhone(phone) || phone;
    this.logger.debug(`Sending verification SMS to normalized phone: ${normalizedPhone}`);
    const message = `Olá ${userName}! Seu código de verificação do Ankaa é: ${code}`;
    await this.smsService.sendSms(normalizedPhone, message);
  }

  private async sendVerificationEmail(
    email: string,
    userName: string,
    code: string,
  ): Promise<void> {
    const baseData = this.emailService.createBaseEmailData(userName);
    const emailData = {
      ...baseData,
      verificationCode: code,
      expiryMinutes: this.VERIFICATION_EXPIRY_MINUTES,
    };

    const result = await this.emailService.sendEmailVerificationCode(email, emailData);

    if (!result.success) {
      this.logger.error(`Failed to send verification email to ${email}: ${result.error}`);
      throw new Error(`Email delivery failed: ${result.error}`);
    }

    this.logger.log(
      `Verification email sent successfully to ${email} (MessageId: ${result.messageId})`,
    );
  }

  private async findUserByContact(contact: string): Promise<any> {
    const whereConditions: Array<{ email?: string; phone?: string }> = [];

    // Check what type of contact was provided
    const contactType = detectContactMethod(contact);

    if (contactType === 'email') {
      // Search by email (exact match, case-insensitive)
      whereConditions.push({ email: contact.toLowerCase() });
      whereConditions.push({ email: contact });
    } else if (contactType === 'phone') {
      // Generate all possible phone format variants for lookup
      const phoneVariants = getPhoneLookupVariants(contact);
      this.logger.debug(`Phone lookup variants for "${contact}": ${JSON.stringify(phoneVariants)}`);

      for (const variant of phoneVariants) {
        whereConditions.push({ phone: variant });
      }
    } else {
      // Unknown format - try both as fallback
      whereConditions.push({ email: contact });
      whereConditions.push({ phone: contact });

      // Also try phone variants in case it's a phone in unusual format
      const phoneVariants = getPhoneLookupVariants(contact);
      for (const variant of phoneVariants) {
        whereConditions.push({ phone: variant });
      }
    }

    const foundUsers = await this.userRepository.findMany({
      where: {
        OR: whereConditions,
      },
      take: 1,
      page: 1,
    });

    if (!foundUsers.data || foundUsers.data.length === 0) {
      return null;
    }

    return foundUsers.data[0];
  }
}
