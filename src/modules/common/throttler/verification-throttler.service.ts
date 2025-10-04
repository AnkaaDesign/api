import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { RedisThrottlerStorage } from './redis-throttler-storage';

interface VerificationAttempt {
  attempts: number;
  lastAttempt: number;
  isBlocked: boolean;
  blockUntil?: number;
  progressiveDelay: number;
}

@Injectable()
export class VerificationThrottlerService {
  private readonly logger = new Logger(VerificationThrottlerService.name);
  private readonly storage: RedisThrottlerStorage;

  // Configuration constants
  private readonly MAX_ATTEMPTS_PER_CODE = 3;
  private readonly CODE_ATTEMPT_WINDOW = 10 * 60 * 1000; // 10 minutes
  private readonly IP_RATE_LIMIT = 10; // 10 verification requests per hour per IP
  private readonly IP_RATE_WINDOW = 60 * 60 * 1000; // 1 hour
  private readonly PROGRESSIVE_DELAYS = [0, 5000, 15000, 30000, 60000]; // 0s, 5s, 15s, 30s, 1min
  private readonly MAX_COOLDOWN = 5 * 60 * 1000; // 5 minutes max cooldown

  constructor() {
    this.storage = new RedisThrottlerStorage();
  }

  /**
   * Check if a verification attempt is allowed for a specific contact and code
   */
  async checkVerificationAttempt(
    contact: string,
    code: string,
    ip: string,
  ): Promise<{ allowed: boolean; retryAfter?: number; message?: string }> {
    const codeAttemptKey = `verification_attempt:${contact}:${code}`;
    const ipRateKey = `verification_ip:${ip}`;
    const contactCooldownKey = `verification_cooldown:${contact}`;

    try {
      // Check if contact is in cooldown period
      const cooldown = await this.checkCooldown(contactCooldownKey);
      if (!cooldown.allowed) {
        return {
          allowed: false,
          retryAfter: cooldown.retryAfter,
          message: `Muitas tentativas de verificação. Tente novamente em ${Math.ceil(cooldown.retryAfter! / 1000)} segundos.`,
        };
      }

      // Check IP rate limiting
      const ipCheck = await this.checkIpRateLimit(ipRateKey);
      if (!ipCheck.allowed) {
        return {
          allowed: false,
          retryAfter: ipCheck.retryAfter,
          message: 'Muitas tentativas de verificação deste IP. Tente novamente mais tarde.',
        };
      }

      // Check code-specific attempts
      const codeCheck = await this.checkCodeAttempts(codeAttemptKey);
      if (!codeCheck.allowed) {
        // If code attempts exceeded, start cooldown for the contact
        await this.startCooldown(contactCooldownKey, codeCheck.progressiveDelay);
        return {
          allowed: false,
          retryAfter: codeCheck.progressiveDelay,
          message: `Código incorreto. Aguarde ${Math.ceil(codeCheck.progressiveDelay / 1000)} segundos antes de tentar novamente.`,
        };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error(`Error checking verification attempt: ${error.message}`);
      // If Redis is down, allow but log the error
      return { allowed: true };
    }
  }

  /**
   * Record a failed verification attempt
   */
  async recordFailedAttempt(contact: string, code: string, ip: string): Promise<void> {
    const codeAttemptKey = `verification_attempt:${contact}:${code}`;
    const ipRateKey = `verification_ip:${ip}`;

    try {
      // Increment code-specific attempts
      await this.incrementCodeAttempts(codeAttemptKey);

      // Increment IP rate limiting
      await this.incrementIpAttempts(ipRateKey);

      this.logger.warn(`Failed verification attempt recorded for contact: ${contact}, IP: ${ip}`);
    } catch (error) {
      this.logger.error(`Error recording failed attempt: ${error.message}`);
    }
  }

  /**
   * Record a successful verification (clears all limits for the contact)
   */
  async recordSuccessfulVerification(contact: string): Promise<void> {
    try {
      // Clear all verification-related keys for this contact
      const pattern = `verification_*:${contact}*`;
      // Note: In a real implementation, you'd want to use Redis SCAN with the pattern
      // For now, we'll clear the known keys
      const keysToRemove = [
        `verification_cooldown:${contact}`,
        // Code-specific keys will expire naturally
      ];

      for (const key of keysToRemove) {
        await this.storage['redis'].del(key);
      }

      this.logger.log(`Verification limits cleared for contact: ${contact}`);
    } catch (error) {
      this.logger.error(`Error clearing verification limits: ${error.message}`);
    }
  }

  /**
   * Check if a new verification code can be sent for a contact
   */
  async checkCodeSendAttempt(
    contact: string,
    ip: string,
  ): Promise<{ allowed: boolean; retryAfter?: number; message?: string }> {
    const sendRateKey = `verification_send:${contact}`;
    const ipSendKey = `verification_send_ip:${ip}`;

    try {
      // Limit code sending: max 3 codes per 5 minutes per contact
      const contactSendLimit = await this.checkSendRateLimit(sendRateKey, 3, 5 * 60 * 1000);
      if (!contactSendLimit.allowed) {
        return {
          allowed: false,
          retryAfter: contactSendLimit.retryAfter,
          message: `Muitos códigos enviados. Aguarde ${Math.ceil(contactSendLimit.retryAfter! / 1000)} segundos.`,
        };
      }

      // Limit code sending per IP: max 10 codes per hour
      const ipSendLimit = await this.checkSendRateLimit(ipSendKey, 10, 60 * 60 * 1000);
      if (!ipSendLimit.allowed) {
        return {
          allowed: false,
          retryAfter: ipSendLimit.retryAfter,
          message: 'Muitos códigos enviados deste IP. Tente novamente mais tarde.',
        };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error(`Error checking code send attempt: ${error.message}`);
      return { allowed: true };
    }
  }

  /**
   * Record a verification code send
   */
  async recordCodeSend(contact: string, ip: string): Promise<void> {
    const sendRateKey = `verification_send:${contact}`;
    const ipSendKey = `verification_send_ip:${ip}`;

    try {
      await this.incrementSendAttempts(sendRateKey, 5 * 60); // 5 minutes TTL
      await this.incrementSendAttempts(ipSendKey, 60 * 60); // 1 hour TTL
    } catch (error) {
      this.logger.error(`Error recording code send: ${error.message}`);
    }
  }

  // Private helper methods

  private async checkCooldown(key: string): Promise<{ allowed: boolean; retryAfter?: number }> {
    const cooldownEnd = await this.storage['redis'].get(key);
    if (cooldownEnd) {
      const retryAfter = parseInt(cooldownEnd) - Date.now();
      if (retryAfter > 0) {
        return { allowed: false, retryAfter };
      }
    }
    return { allowed: true };
  }

  private async startCooldown(key: string, duration: number): Promise<void> {
    const cooldownEnd = Date.now() + duration;
    await this.storage['redis'].set(key, cooldownEnd.toString(), 'PX', duration);
  }

  private async checkIpRateLimit(key: string): Promise<{ allowed: boolean; retryAfter?: number }> {
    const count = await this.storage['redis'].get(key);
    const currentCount = count ? parseInt(count) : 0;

    if (currentCount >= this.IP_RATE_LIMIT) {
      const ttl = await this.storage['redis'].ttl(key);
      return { allowed: false, retryAfter: ttl * 1000 };
    }

    return { allowed: true };
  }

  private async incrementIpAttempts(key: string): Promise<void> {
    const multi = this.storage['redis'].multi();
    multi.incr(key);
    multi.expire(key, Math.floor(this.IP_RATE_WINDOW / 1000));
    await multi.exec();
  }

  private async checkCodeAttempts(
    key: string,
  ): Promise<{ allowed: boolean; progressiveDelay: number }> {
    const data = await this.storage['redis'].get(key);
    const attempt: VerificationAttempt = data
      ? JSON.parse(data)
      : {
          attempts: 0,
          lastAttempt: 0,
          isBlocked: false,
          progressiveDelay: 0,
        };

    // Clean up old attempts (outside the window)
    if (Date.now() - attempt.lastAttempt > this.CODE_ATTEMPT_WINDOW) {
      attempt.attempts = 0;
      attempt.isBlocked = false;
      attempt.progressiveDelay = 0;
    }

    if (attempt.attempts >= this.MAX_ATTEMPTS_PER_CODE) {
      // Calculate progressive delay
      const delayIndex = Math.min(
        attempt.attempts - this.MAX_ATTEMPTS_PER_CODE,
        this.PROGRESSIVE_DELAYS.length - 1,
      );
      const progressiveDelay = Math.min(this.PROGRESSIVE_DELAYS[delayIndex], this.MAX_COOLDOWN);

      return { allowed: false, progressiveDelay };
    }

    return { allowed: true, progressiveDelay: 0 };
  }

  private async incrementCodeAttempts(key: string): Promise<void> {
    const data = await this.storage['redis'].get(key);
    const attempt: VerificationAttempt = data
      ? JSON.parse(data)
      : {
          attempts: 0,
          lastAttempt: 0,
          isBlocked: false,
          progressiveDelay: 0,
        };

    attempt.attempts += 1;
    attempt.lastAttempt = Date.now();

    if (attempt.attempts >= this.MAX_ATTEMPTS_PER_CODE) {
      attempt.isBlocked = true;
    }

    const ttl = Math.floor(this.CODE_ATTEMPT_WINDOW / 1000);
    await this.storage['redis'].set(key, JSON.stringify(attempt), 'EX', ttl);
  }

  private async checkSendRateLimit(
    key: string,
    limit: number,
    window: number,
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const count = await this.storage['redis'].get(key);
    const currentCount = count ? parseInt(count) : 0;

    if (currentCount >= limit) {
      const ttl = await this.storage['redis'].ttl(key);
      return { allowed: false, retryAfter: ttl * 1000 };
    }

    return { allowed: true };
  }

  private async incrementSendAttempts(key: string, ttlSeconds: number): Promise<void> {
    const multi = this.storage['redis'].multi();
    multi.incr(key);
    multi.expire(key, ttlSeconds);
    await multi.exec();
  }

  /**
   * Get current verification attempt status for debugging/monitoring
   */
  async getVerificationStatus(contact: string): Promise<any> {
    try {
      const cooldownKey = `verification_cooldown:${contact}`;
      const cooldownEnd = await this.storage['redis'].get(cooldownKey);

      return {
        contact,
        isInCooldown: !!cooldownEnd,
        cooldownEndsAt: cooldownEnd ? new Date(parseInt(cooldownEnd)) : null,
        retryAfter: cooldownEnd ? Math.max(0, parseInt(cooldownEnd) - Date.now()) : 0,
      };
    } catch (error) {
      this.logger.error(`Error getting verification status: ${error.message}`);
      return { contact, error: error.message };
    }
  }
}
