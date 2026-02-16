import { z } from 'zod';
import { config } from 'dotenv';

// Load environment variables from .env file (if not already loaded by PM2/runtime)
// PM2 startup scripts load .env.production or .env.staging
config();

/**
 * Environment variable validation schema
 * This ensures all required environment variables are present and valid
 */
export const envSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test', 'staging']).default('development'),

  // Server Configuration
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3030'),
  API_PORT: z.string().regex(/^\d+$/).transform(Number).optional(),

  // Database
  DATABASE_URL: z.string().min(1, 'Database URL is required'),

  // JWT Authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRATION: z.string().default('7d'),

  // File Upload
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE: z.string().regex(/^\d+$/).transform(Number).default('52428800'),
  ALLOWED_FILE_TYPES: z.string().default('image/*,application/pdf,application/msword'),
  FILE_URL_PREFIX: z.string().default('/files'),

  // Twilio SMS
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Secullum Integration
  SECULLUM_BASE_URL: z.string().url().default('https://pontoweb.secullum.com.br'),
  SECULLUM_EMAIL: z.string().email().optional(),
  SECULLUM_PASSWORD: z.string().optional(),
  SECULLUM_DATABASE_ID: z.string().optional(),
  SECULLUM_CLIENT_ID: z.string().optional(),
  SECULLUM_CLIENT_SECRET: z.string().optional(),
  USE_MOCK_SECULLUM: z
    .string()
    .transform(val => val === 'true')
    .default('false'),

  // Email Service
  EMAIL_USER: z.string().email().optional(),
  EMAIL_PASS: z.string().optional(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().regex(/^\d+$/).transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().regex(/^\d+$/).transform(Number).default('0'),

  // Rate Limiting
  DISABLE_RATE_LIMITING: z
    .string()
    .transform(val => val === 'true')
    .default('false'),

  // API URLs
  API_URL: z.string().url().optional(),
  CLIENT_HOST: z.string().optional(),

  // Application URLs
  WEB_APP_URL: z.string().url().optional(),
  FILES_BASE_URL: z.string().url().optional(),
  WEBHOOK_URL: z.string().url().optional(),

  // CORS
  CORS_ORIGINS: z.string().optional(),

  // ClickSign Digital Signature (API 3.0)
  CLICKSIGN_API_URL: z.string().url().default('https://sandbox.clicksign.com/api/v3'),
  CLICKSIGN_ACCESS_TOKEN: z.string().optional(),
  CLICKSIGN_WEBHOOK_SECRET: z.string().optional(),

  // File Storage
  FILES_ROOT: z.string().default('./files'),

  // Secullum Auth URL (OAuth2 token endpoint)
  SECULLUM_AUTH_URL: z.string().url().default('https://autenticador.secullum.com.br/Token'),

  // Backup & Sync
  BACKUP_PATH: z.string().default('/mnt/backup'),
  PRODUCTION_BASE_PATH: z.string().default('/home/kennedy/ankaa'),
  SYNC_SCRIPT_PATH: z.string().default('/home/kennedy/repositories/sync-prod-to-test.sh'),
  SYNC_LOG_PATH: z.string().default('/home/kennedy/repositories/sync.log'),

  // Email Template
  SUPPORT_PHONE: z.string().default('+554384190989'),
  EMAIL_LOGO_URL: z
    .string()
    .url()
    .default(
      'https://firebasestorage.googleapis.com/v0/b/ankaa-files.appspot.com/o/images%2Flogo.png?alt=media&token=b0603036-dca9-4df8-ab17-18dfd83e0814',
    ),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates and returns the environment configuration
 * Throws an error if validation fails
 */
export function validateEnv(): EnvConfig {
  try {
    const result = envSchema.parse(process.env);

    // Additional custom validations
    if (result.NODE_ENV === 'production') {
      // Production-specific validations
      if (!result.TWILIO_ACCOUNT_SID || !result.TWILIO_AUTH_TOKEN) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '⚠️  Twilio credentials not configured - SMS functionality will be disabled',
          );
        }
      }

      if (!result.EMAIL_USER || !result.EMAIL_PASS) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '⚠️  Email credentials not configured - email functionality will be disabled',
          );
        }
      }

      if (result.DISABLE_RATE_LIMITING) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('⚠️  Rate limiting is disabled in production - this is not recommended');
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ Environment variables validated successfully');
    }
    return result;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      if (process.env.NODE_ENV !== 'production') {
        console.error('❌ Environment validation failed:');
        missingVars.forEach(err => console.error(`  - ${err}`));

        console.error(
          '\n📋 Please check your .env file and ensure all required variables are set.',
        );
        console.error('📋 You can copy from .env.example and fill in the values.');
      }

      process.exit(1);
    }

    throw error;
  }
}

/**
 * Get validated environment configuration
 * Safe to use after validateEnv() has been called
 */
export const env = validateEnv();
