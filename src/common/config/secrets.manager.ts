import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { env } from './env.validation';

/**
 * Secrets Manager for handling sensitive configuration data
 * Provides encryption/decryption and secure handling of secrets
 */
export class SecretsManager {
  private static instance: SecretsManager;
  private readonly algorithm = 'aes-256-gcm';
  private readonly scryptAsync = promisify(scrypt);

  private constructor() {}

  public static getInstance(): SecretsManager {
    if (!SecretsManager.instance) {
      SecretsManager.instance = new SecretsManager();
    }
    return SecretsManager.instance;
  }

  /**
   * Encrypts a secret value using the JWT secret as the key base
   */
  public async encryptSecret(plaintext: string): Promise<string> {
    try {
      const salt = randomBytes(16);
      const key = (await this.scryptAsync(env.JWT_SECRET, salt, 32)) as Buffer;

      const iv = randomBytes(12);
      const cipher = createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      // Combine salt, iv, authTag, and encrypted data
      return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to encrypt secret:', error);
      }
      throw new Error('Secret encryption failed');
    }
  }

  /**
   * Decrypts a secret value
   */
  public async decryptSecret(encryptedData: string): Promise<string> {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 4) {
        throw new Error('Invalid encrypted data format');
      }

      const [saltHex, ivHex, authTagHex, encrypted] = parts;
      const salt = Buffer.from(saltHex, 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const key = (await this.scryptAsync(env.JWT_SECRET, salt, 32)) as Buffer;

      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to decrypt secret:', error);
      }
      throw new Error('Secret decryption failed');
    }
  }

  /**
   * Safely retrieves a secret from environment variables
   * Returns undefined if not found, logs warning in production
   */
  public getSecret(key: keyof typeof env): string | number | boolean | undefined {
    const value = env[key];

    if (!value && env.NODE_ENV === 'production') {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`⚠️  Secret ${key} not configured in production environment`);
      }
    }

    return value;
  }

  /**
   * Validates that all required secrets are present
   */
  public validateSecrets(): void {
    const requiredSecrets = ['JWT_SECRET', 'DATABASE_URL'] as const;

    const optionalSecrets = ['TWILIO_AUTH_TOKEN', 'EMAIL_PASS'] as (keyof typeof env)[];

    const missingRequired: string[] = [];
    const missingOptional: string[] = [];

    // Check required secrets
    for (const secret of requiredSecrets) {
      if (!this.getSecret(secret)) {
        missingRequired.push(secret);
      }
    }

    // Check optional secrets
    for (const secret of optionalSecrets) {
      if (!this.getSecret(secret)) {
        missingOptional.push(secret);
      }
    }

    if (missingRequired.length > 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('❌ Missing required secrets:', missingRequired);
      }
      throw new Error(`Required secrets missing: ${missingRequired.join(', ')}`);
    }

    if (missingOptional.length > 0 && env.NODE_ENV === 'production') {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '⚠️  Missing optional secrets (some features may be disabled):',
          missingOptional,
        );
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ Secrets validation completed');
    }
  }

  /**
   * Masks sensitive values for logging
   */
  public maskSecret(secret: string): string {
    if (!secret || secret.length < 8) {
      return '***';
    }

    const visibleLength = Math.min(4, Math.floor(secret.length / 4));
    const masked = '*'.repeat(secret.length - visibleLength * 2);

    return `${secret.slice(0, visibleLength)}${masked}${secret.slice(-visibleLength)}`;
  }

  /**
   * Generates a secure random secret
   */
  public generateSecret(length: number = 64): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Validates the strength of a secret
   */
  public validateSecretStrength(secret: string): {
    isValid: boolean;
    score: number;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let score = 0;

    // Length check
    if (secret.length >= 32) score += 25;
    else if (secret.length >= 16) score += 15;
    else recommendations.push('Use at least 32 characters');

    // Character variety
    if (/[a-z]/.test(secret)) score += 15;
    else recommendations.push('Include lowercase letters');

    if (/[A-Z]/.test(secret)) score += 15;
    else recommendations.push('Include uppercase letters');

    if (/\d/.test(secret)) score += 15;
    else recommendations.push('Include numbers');

    if (/[^a-zA-Z0-9]/.test(secret)) score += 20;
    else recommendations.push('Include special characters');

    // Entropy check (basic)
    const uniqueChars = new Set(secret).size;
    if (uniqueChars / secret.length > 0.6) score += 10;
    else recommendations.push('Use more varied characters');

    return {
      isValid: score >= 70,
      score,
      recommendations,
    };
  }
}

// Export singleton instance
export const secretsManager = SecretsManager.getInstance();
