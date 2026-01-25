import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client, LocalAuth, RemoteAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { CacheService } from '../cache/cache.service';
import { RedisStore } from './stores/redis-store';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Connection status enum
 */
export enum WhatsAppConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_READY = 'QR_READY',
  AUTHENTICATED = 'AUTHENTICATED',
  READY = 'READY',
  AUTH_FAILURE = 'AUTH_FAILURE',
}

/**
 * WhatsApp service that manages WhatsApp Web client connection
 * Uses singleton pattern to ensure only one client instance exists
 */
@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private client: Client | null = null;
  private redisStore: RedisStore | null = null;
  private isClientReady = false;
  private isInitializing = false;
  private currentQRCode: string | null = null;
  private qrCodeGeneratedAt: Date | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10; // Increased for better recovery
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly QR_CODE_EXPIRY_MS = 60000; // 60 seconds
  private readonly CACHE_KEY_STATUS = 'whatsapp:status';
  private readonly CACHE_KEY_QR = 'whatsapp:qr';
  private readonly SESSION_NAME = 'ankaa-whatsapp';
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private sessionBackupInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly SESSION_BACKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly HEALTH_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheService: CacheService,
  ) {
    // Initialize Redis store for session persistence
    this.redisStore = new RedisStore(this.cacheService);
  }

  /**
   * Setup handlers for graceful shutdown (removed to prevent blocking)
   * Cleanup is now handled only by NestJS's lifecycle hooks (onModuleDestroy)
   */

  /**
   * Kill orphaned Chrome/Chromium processes
   * More aggressive approach - kills all Chrome processes related to WhatsApp
   */
  private async killOrphanedChromeProcesses(): Promise<void> {
    try {
      this.logger.log('Checking for orphaned Chrome processes...');

      // Use multiple patterns to find Chrome processes
      const patterns = [
        'ps aux | grep -E "chrome|chromium" | grep -E "wwebjs|puppeteer|RemoteAuth" | grep -v grep | awk \'{print $2}\' || true',
        'ps aux | grep -E "chrome.*--user-data-dir.*wwebjs" | grep -v grep | awk \'{print $2}\' || true',
        'lsof -t +D .wwebjs_auth 2>/dev/null || true',
      ];

      const allPids = new Set<string>();

      for (const pattern of patterns) {
        try {
          const { stdout } = await Promise.race([
            execAsync(pattern, { timeout: 3000 }),
            new Promise<{ stdout: string; stderr: string }>((_, reject) =>
              setTimeout(() => reject(new Error('Process check timeout')), 3000),
            ),
          ]);

          const pids = stdout
            .trim()
            .split('\n')
            .filter(pid => pid && pid.trim());

          pids.forEach(pid => allPids.add(pid.trim()));
        } catch (error) {
          // Pattern might fail, continue with others
        }
      }

      if (allPids.size > 0) {
        this.logger.warn(`Found ${allPids.size} orphaned Chrome process(es), killing...`);
        for (const pid of Array.from(allPids)) {
          try {
            // First try SIGTERM, then SIGKILL
            try {
              await execAsync(`kill -15 ${pid}`, { timeout: 1000 });
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch {
              // Ignore SIGTERM errors
            }
            // Force kill
            await Promise.race([
              execAsync(`kill -9 ${pid}`),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Kill timeout')), 1000)),
            ]);
            this.logger.log(`Killed orphaned Chrome process: ${pid}`);
          } catch (error) {
            // Process might already be dead, ignore
          }
        }
        // Wait for processes to fully terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        this.logger.log('No orphaned Chrome processes found');
      }
    } catch (error) {
      // Non-critical error, just log it
      this.logger.warn(`Failed to check for orphaned Chrome processes: ${error.message}`);
    }
  }

  /**
   * Clean up lock files and stale session data
   */
  private async cleanupSessionLockFiles(): Promise<void> {
    try {
      const sessionPath = process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth';
      this.logger.log(`Cleaning up lock files in: ${sessionPath}`);

      // Check if session directory exists
      try {
        await fs.access(sessionPath);
      } catch {
        this.logger.log('Session directory does not exist, skipping cleanup');
        return;
      }

      // Remove SingletonLock files
      const lockPatterns = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

      for (const pattern of lockPatterns) {
        try {
          const files = await this.findFilesRecursive(sessionPath, pattern);
          for (const file of files) {
            await fs.unlink(file);
            this.logger.log(`Removed lock file: ${file}`);
          }
        } catch (error) {
          // Non-critical, continue
        }
      }

      this.logger.log('Session lock file cleanup completed');
    } catch (error) {
      this.logger.warn(`Failed to cleanup lock files: ${error.message}`);
    }
  }

  /**
   * Recursively find files matching a pattern
   */
  private async findFilesRecursive(dir: string, pattern: string): Promise<string[]> {
    const results: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const nestedResults = await this.findFilesRecursive(fullPath, pattern);
          results.push(...nestedResults);
        } else if (entry.name.includes(pattern)) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Directory might not exist or be accessible, ignore
    }

    return results;
  }

  /**
   * Perform cleanup before initialization
   */
  private async performPreInitializationCleanup(): Promise<void> {
    try {
      this.logger.log('Performing pre-initialization cleanup...');

      // Add overall timeout to prevent hanging
      await Promise.race([
        (async () => {
          // Kill orphaned Chrome processes
          await this.killOrphanedChromeProcesses();

          // Clean up lock files
          await this.cleanupSessionLockFiles();

          // Small delay to ensure processes are fully terminated
          await new Promise(resolve => setTimeout(resolve, 500));
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cleanup timeout after 10 seconds')), 10000),
        ),
      ]);

      this.logger.log('Pre-initialization cleanup completed');
    } catch (error) {
      this.logger.warn(
        `Cleanup failed or timed out: ${error.message}. Continuing with initialization...`,
      );
      // Don't block initialization if cleanup fails
    }
  }

  /**
   * Initialize WhatsApp client on module initialization
   */
  async onModuleInit() {
    // Check if WhatsApp is disabled via environment variable
    if (process.env.DISABLE_WHATSAPP === 'true') {
      this.logger.log('WhatsApp is disabled via DISABLE_WHATSAPP environment variable');
      return;
    }

    this.logger.log('Initializing WhatsApp module...');

    // Perform cleanup before initialization
    await this.performPreInitializationCleanup();

    await this.initializeClient();
  }

  /**
   * Cleanup on module destruction
   */
  async onModuleDestroy() {
    this.logger.log('Destroying WhatsApp module...');

    // Clear all intervals
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.sessionBackupInterval) {
      clearInterval(this.sessionBackupInterval);
      this.sessionBackupInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Save session before destroying
    await this.safeBackupSession();
    await this.destroyClient();
  }

  /**
   * Start periodic session backup
   * Ensures session is saved to Redis regularly
   */
  private startSessionBackupInterval(): void {
    // Clear existing interval if any
    if (this.sessionBackupInterval) {
      clearInterval(this.sessionBackupInterval);
    }

    this.sessionBackupInterval = setInterval(async () => {
      if (this.isClientReady) {
        await this.safeBackupSession();
      }
    }, this.SESSION_BACKUP_INTERVAL_MS);

    this.logger.log(`Session backup interval started (every ${this.SESSION_BACKUP_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Start health check interval
   * Monitors client connection and triggers reconnection if needed
   */
  private startHealthCheckInterval(): void {
    // Clear existing interval if any
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL_MS);

    this.logger.log(`Health check interval started (every ${this.HEALTH_CHECK_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Perform health check on the WhatsApp client
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Skip if already initializing
      if (this.isInitializing) {
        return;
      }

      // If client is supposed to be ready but isn't actually functional
      if (this.isClientReady && this.client) {
        try {
          // Try to get state as a health check
          const state = await Promise.race([
            this.client.getState(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Health check timeout')), 10000)
            ),
          ]);

          if (!state || state === 'CONFLICT' || state === 'UNLAUNCHED') {
            this.logger.warn(`WhatsApp client unhealthy (state: ${state}), triggering reconnection`);
            this.isClientReady = false;
            this.handleReconnection();
          }
        } catch (error: any) {
          this.logger.warn(`Health check failed: ${error.message}. Marking as disconnected.`);
          this.isClientReady = false;
          await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
          this.handleReconnection();
        }
      }
    } catch (error: any) {
      // Don't let health check errors crash the application
      this.logger.error(`Health check error (non-fatal): ${error.message}`);
    }
  }

  /**
   * Safely backup session to Redis (won't throw)
   */
  private async safeBackupSession(): Promise<boolean> {
    try {
      if (!this.redisStore || !this.isClientReady) {
        return false;
      }

      await this.redisStore.save({ session: this.SESSION_NAME });
      this.logger.debug('Session backed up to Redis');
      return true;
    } catch (error: any) {
      this.logger.warn(`Failed to backup session (non-fatal): ${error.message}`);
      return false;
    }
  }

  /**
   * Initialize the WhatsApp client with all event handlers
   * Uses RemoteAuth with Redis store for session persistence across deployments
   */
  async initializeClient(): Promise<void> {
    if (this.isInitializing) {
      this.logger.warn('Client is already initializing, skipping...');
      return;
    }

    if (this.client) {
      this.logger.warn('Client already exists, destroying old client first...');
      await this.destroyClient();
    }

    try {
      this.isInitializing = true;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);
      this.logger.log('Creating new WhatsApp client instance...');

      // Determine auth strategy based on environment
      // Use RemoteAuth with Redis store for production (persistent sessions)
      // Use LocalAuth for development (simpler setup)
      const useRemoteAuth = process.env.WHATSAPP_USE_REMOTE_AUTH !== 'false';
      const sessionPath = process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth';

      let authStrategy;

      if (useRemoteAuth && this.redisStore) {
        this.logger.log('Using RemoteAuth with Redis store for session persistence');

        // Check if session exists in Redis and restore it
        try {
          const sessionExists = await this.redisStore.sessionExists({ session: this.SESSION_NAME });
          if (sessionExists) {
            this.logger.log('Found existing session in Redis, restoring...');
            await this.redisStore.extract({ session: this.SESSION_NAME });
            this.logger.log('Session restored from Redis successfully');
          } else {
            this.logger.log('No existing session in Redis, will need QR code scan');
          }
        } catch (restoreError: any) {
          // Non-fatal - continue without restored session
          this.logger.warn(`Failed to restore session from Redis (will need QR scan): ${restoreError.message}`);
        }

        authStrategy = new RemoteAuth({
          store: this.redisStore,
          backupSyncIntervalMs: 60000, // Backup session every minute
          clientId: this.SESSION_NAME,
          dataPath: sessionPath,
        });
      } else {
        this.logger.log('Using LocalAuth for session persistence');
        authStrategy = new LocalAuth({
          dataPath: sessionPath,
        });
      }

      // Create client with the chosen auth strategy
      this.client = new Client({
        authStrategy,
        // Use webVersionCache to avoid compatibility issues with Chrome versions
        webVersionCache: {
          type: 'remote',
          remotePath:
            'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=Crashpad',
            '--enable-crashpad=false',
          ],
          timeout: 120000,
        },
      });

      this.setupEventHandlers();

      this.logger.log('Initializing WhatsApp client...');
      await this.client.initialize();

      this.reconnectAttempts = 0;
    } catch (error) {
      this.logger.error(`Failed to initialize WhatsApp client: ${error.message}`, error.stack);
      this.isInitializing = false;

      // Ensure client is destroyed on failure to prevent stale state
      try {
        if (this.client) {
          await this.client.destroy();
          this.client = null;
        }
      } catch (destroyError) {
        this.logger.error(
          `Failed to destroy client after initialization error: ${destroyError.message}`,
        );
      }

      // Perform cleanup after failure
      await this.performPreInitializationCleanup();

      await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
      this.handleReconnection();

      // Don't throw error to prevent API from crashing
      // The reconnection logic will handle retries
    }
  }

  /**
   * Setup all event handlers for the WhatsApp client
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // QR Code event - fired when QR code is generated for authentication
    this.client.on('qr', async (qr: string) => {
      this.logger.log('QR Code received, scan with WhatsApp app');

      // Convert QR string to base64 image
      const qrImageDataURL = await QRCode.toDataURL(qr, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      this.currentQRCode = qrImageDataURL; // Store as data URL
      this.qrCodeGeneratedAt = new Date();

      // Store QR code in cache with expiry
      await this.cacheService.setObject(
        this.CACHE_KEY_QR,
        {
          qr: qrImageDataURL, // Store as data URL
          generatedAt: this.qrCodeGeneratedAt,
          expiresAt: new Date(Date.now() + this.QR_CODE_EXPIRY_MS),
        },
        Math.ceil(this.QR_CODE_EXPIRY_MS / 1000),
      );

      // Update connection status
      await this.updateConnectionStatus(WhatsAppConnectionStatus.QR_READY);

      // Display QR code in terminal
      qrcode.generate(qr, { small: true });

      // Emit event for notification tracking
      this.eventEmitter.emit('whatsapp.qr', { qr, timestamp: new Date() });
    });

    // Ready event - fired when client is ready to send/receive messages
    this.client.on('ready', async () => {
      this.logger.log('WhatsApp client is ready!');
      this.isClientReady = true;
      this.isInitializing = false;
      this.currentQRCode = null;
      this.qrCodeGeneratedAt = null;
      this.reconnectAttempts = 0;

      // Clear QR code from cache
      await this.cacheService.del(this.CACHE_KEY_QR);

      // Update connection status
      await this.updateConnectionStatus(WhatsAppConnectionStatus.READY);

      // Start session backup and health check intervals
      this.startSessionBackupInterval();
      this.startHealthCheckInterval();

      // Save session immediately after becoming ready
      await this.safeBackupSession();

      // Emit event for notification tracking (this also triggers retry of failed notifications)
      this.eventEmitter.emit('whatsapp.ready', { timestamp: new Date() });
    });

    // Authenticated event - fired when authentication is successful
    this.client.on('authenticated', async () => {
      this.logger.log('WhatsApp client authenticated successfully');
      this.currentQRCode = null;
      this.qrCodeGeneratedAt = null;

      // Clear QR code from cache
      await this.cacheService.del(this.CACHE_KEY_QR);

      // Update connection status
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTHENTICATED);

      // Emit event for notification tracking
      this.eventEmitter.emit('whatsapp.authenticated', { timestamp: new Date() });
    });

    // Authentication failure event
    this.client.on('auth_failure', async error => {
      this.logger.error(`Authentication failure: ${error}`);
      this.isClientReady = false;
      this.currentQRCode = null;
      this.qrCodeGeneratedAt = null;

      // Clear QR code from cache
      await this.cacheService.del(this.CACHE_KEY_QR);

      // Update connection status
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);

      // Emit event for notification tracking
      this.eventEmitter.emit('whatsapp.auth_failure', { error, timestamp: new Date() });
    });

    // Disconnected event - fired when client disconnects
    this.client.on('disconnected', async (reason: string) => {
      this.logger.warn(`WhatsApp client disconnected: ${reason}`);
      this.isClientReady = false;
      this.isInitializing = false;
      this.currentQRCode = null;
      this.qrCodeGeneratedAt = null;

      // Clear QR code from cache
      await this.cacheService.del(this.CACHE_KEY_QR);

      // Update connection status
      await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);

      // Emit event for notification tracking
      this.eventEmitter.emit('whatsapp.disconnected', { reason, timestamp: new Date() });

      // Attempt to reconnect
      this.handleReconnection();
    });

    // Message received event - fired when a message is received
    this.client.on('message_create', async (message: Message) => {
      try {
        const contact = await message.getContact();
        const chat = await message.getChat();

        this.logger.log(
          `Message ${message.fromMe ? 'sent' : 'received'}: ${message.body.substring(0, 50)}... from ${contact.pushname || contact.number}`,
        );

        // Emit event for notification tracking
        this.eventEmitter.emit('whatsapp.message_create', {
          messageId: message.id._serialized,
          from: message.from,
          to: message.to,
          body: message.body,
          fromMe: message.fromMe,
          hasMedia: message.hasMedia,
          chatName: chat.name,
          contactName: contact.pushname || contact.number,
          timestamp: new Date(message.timestamp * 1000),
        });
      } catch (error) {
        this.logger.error(`Error processing message event: ${error.message}`);
      }
    });

    // Loading screen event
    this.client.on('loading_screen', (percent: number, message: string) => {
      this.logger.debug(`Loading: ${percent}% - ${message}`);
    });

    // Remote session saved event - backup session to Redis for persistence
    this.client.on('remote_session_saved', async () => {
      this.logger.log('Remote session saved event received');

      // Save to Redis store if using RemoteAuth
      if (this.redisStore && process.env.WHATSAPP_USE_REMOTE_AUTH !== 'false') {
        try {
          await this.redisStore.save({ session: this.SESSION_NAME });
          this.logger.log('WhatsApp session backed up to Redis successfully');
        } catch (error) {
          this.logger.error(`Failed to backup session to Redis: ${error.message}`);
        }
      }

      // Emit event for tracking
      this.eventEmitter.emit('whatsapp.session.saved', {
        sessionName: this.SESSION_NAME,
        timestamp: new Date(),
      });
    });
  }

  /**
   * Handle reconnection logic with exponential backoff
   */
  private handleReconnection(): void {
    // Clear any existing reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `Maximum reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Will retry in 5 minutes.`,
      );
      // After max attempts, wait 5 minutes and reset attempts to try again
      this.reconnectTimeout = setTimeout(() => {
        this.logger.log('Resetting reconnection attempts and trying again...');
        this.reconnectAttempts = 0;
        this.handleReconnection();
      }, 5 * 60 * 1000); // 5 minutes
      return;
    }

    this.reconnectAttempts++;
    // Calculate delay with exponential backoff, capped at 2 minutes
    const baseDelay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);
    const delay = Math.min(baseDelay, 2 * 60 * 1000); // Cap at 2 minutes

    this.logger.log(
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay / 1000} seconds...`,
    );

    this.reconnectTimeout = setTimeout(async () => {
      this.logger.log(`Attempting to reconnect (attempt ${this.reconnectAttempts})...`);
      try {
        // Perform cleanup before reconnection
        await this.performPreInitializationCleanup();
        await this.initializeClient();
      } catch (error: any) {
        this.logger.error(
          `Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`,
        );
        // Continue trying to reconnect
        this.handleReconnection();
      }
    }, delay);
  }

  /**
   * Send a WhatsApp message to a phone number
   * @param phone Phone number in international format (e.g., 5511999999999)
   * @param message Message text to send
   * @returns Promise<boolean> indicating success
   */
  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!this.isClientReady || !this.client) {
      throw new Error('WhatsApp client is not ready. Please check connection status.');
    }

    if (!phone || !message) {
      throw new Error('Phone number and message are required');
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\d{10,15}$/;
    const cleanPhone = phone.replace(/\D/g, '');

    if (!phoneRegex.test(cleanPhone)) {
      throw new Error(
        'Invalid phone number format. Use international format without + or spaces (e.g., 5511999999999)',
      );
    }

    try {
      // Normalize the phone number for Brazilian format
      const normalizedPhone = this.normalizeBrazilianPhone(cleanPhone);
      this.logger.log(`Sending message to ${this.maskPhone(cleanPhone)} (normalized: ${this.maskPhone(normalizedPhone)})`);

      // Generate all possible phone number variants to try
      const phoneVariants = this.generatePhoneVariants(cleanPhone);
      this.logger.log(`Will try ${phoneVariants.length} phone variants: ${phoneVariants.map(v => v.replace('@c.us', '')).join(', ')}`);

      // Check if WhatsApp has a different ID
      // WhatsApp may return the old Brazilian format (without the 9 after area code)
      // This is the SAME person, just registered with old format - we should use it
      try {
        const numberId = await this.client.getNumberId(normalizedPhone);
        if (numberId) {
          const returnedId = numberId._serialized;
          const returnedNumber = returnedId.replace('@c.us', '');

          if (returnedNumber === normalizedPhone) {
            this.logger.debug(`WhatsApp confirmed number format: ${returnedId}`);
          } else {
            // Check if this is the old Brazilian format of the same number
            // Old format: 554391402403 (12 digits)
            // New format: 5543991402403 (13 digits)
            const isOldBrazilianFormat = this.isOldBrazilianFormatOfSameNumber(normalizedPhone, returnedNumber);

            if (isOldBrazilianFormat) {
              // This is the same person, just registered with old format - USE IT
              this.logger.log(
                `WhatsApp returned old Brazilian format: ${returnedId} (same as ${normalizedPhone}). Using WhatsApp's ID.`
              );
              // Add WhatsApp's ID as the PRIMARY variant (it's what WhatsApp knows)
              if (!phoneVariants.includes(returnedId)) {
                phoneVariants.unshift(returnedId); // Add at beginning - try this first
                this.logger.log(`Added WhatsApp's registered ID as primary variant: ${returnedId}`);
              }
            } else {
              // Genuinely different number - don't use it
              this.logger.warn(
                `WhatsApp returned different ID: ${returnedId} (expected ${normalizedPhone}@c.us). ` +
                `NOT using as fallback - would send to wrong person.`
              );
            }
          }
        }
      } catch (idError: any) {
        this.logger.debug(`Could not get number ID: ${idError.message}`);
      }

      // Try each variant until one succeeds
      let messageSent = false;
      let lastError: Error | null = null;
      let successfulVariant = '';

      for (const variant of phoneVariants) {
        if (messageSent) break;

        this.logger.log(`Trying variant: ${variant}`);

        // Try to verify registration (but don't fail if we can't)
        try {
          const isRegistered = await this.client.isRegisteredUser(variant);
          if (!isRegistered) {
            this.logger.debug(`Variant ${variant} not registered, skipping`);
            continue;
          }
        } catch (checkError: any) {
          // If check fails, still try to send
          this.logger.debug(`Could not verify ${variant}: ${checkError.message}. Will try anyway.`);
        }

        // Try to send message
        try {
          // First attempt: direct send
          await this.client.sendMessage(variant, message);
          messageSent = true;
          successfulVariant = variant;
          this.logger.log(`Message sent successfully using variant: ${variant}`);
        } catch (sendError: any) {
          const errorMsg = sendError.message || '';

          // Check if this is a sendSeen/markedUnread error (message was actually sent)
          const isSendSeenError = errorMsg.includes('markedUnread') ||
                                  errorMsg.includes('sendSeen') ||
                                  errorMsg.includes('Cannot read properties of undefined');

          if (isSendSeenError) {
            this.logger.warn(
              `Message to ${variant} was sent but sendSeen failed (harmless): ${errorMsg}`,
            );
            messageSent = true;
            successfulVariant = variant;
          } else if (errorMsg.includes('No LID for user') || errorMsg.includes('Lid is missing')) {
            // "No LID for user" error - need to force LID creation
            // This is a known issue with whatsapp-web.js when sending to new contacts
            // Reference: https://github.com/pedroslopez/whatsapp-web.js/issues/3834
            this.logger.warn(`No LID for ${variant}, attempting to force LID creation...`);

            try {
              // Extract phone number from variant (remove @c.us suffix)
              const phoneNumber = variant.replace('@c.us', '');

              // Step 1: Try to force LID creation using WAWebContactSyncUtils
              // This is the workaround from GitHub issue #3834
              this.logger.log(`Attempting contact sync for ${phoneNumber}...`);

              // Use pupPage.evaluate to run code in WhatsApp Web's browser context
              // This accesses WhatsApp's internal Store objects to force LID creation
              // Note: The function runs in browser context where 'window' exists
              const syncResult = await (this.client as any).pupPage.evaluate(`
                (async () => {
                  try {
                    const phone = "${phoneNumber}";

                    // Method 1: Use findOrCreateLatestChat (from PR #3703)
                    if (window.Store?.WidFactory?.createWid && window.Store?.FindOrCreateChat?.findOrCreateLatestChat) {
                      const wid = window.Store.WidFactory.createWid(phone + "@c.us");
                      const chatResult = await window.Store.FindOrCreateChat.findOrCreateLatestChat(wid);
                      if (chatResult?.chat) {
                        return { success: true, method: 'findOrCreateChat', chatId: chatResult.chat.id._serialized };
                      }
                    }

                    // Method 2: Use contact sync utility (workaround from issue #3834)
                    if (typeof window.require === 'function') {
                      try {
                        const ContactSyncUtils = window.require('WAWebContactSyncUtils');
                        if (ContactSyncUtils?.constructUsyncDeltaQuery) {
                          const actions = [{ type: 'add', phoneNumber: phone }];
                          const query = ContactSyncUtils.constructUsyncDeltaQuery(actions);
                          const result = await query.execute();
                          if (result?.list?.[0]?.lid) {
                            return { success: true, method: 'contactSync', lid: result.list[0].lid };
                          }
                        }
                      } catch (reqErr) {
                        // Module might not exist, continue
                      }
                    }

                    return { success: false, error: 'No method succeeded' };
                  } catch (e) {
                    return { success: false, error: e.message || String(e) };
                  }
                })()
              `);

              this.logger.log(`Sync result: ${JSON.stringify(syncResult)}`);

              if (syncResult?.success) {
                // Try sending again after LID creation
                const targetId = syncResult.lid ? `${syncResult.lid}@lid` : variant;
                this.logger.log(`Retrying message send to ${targetId} after LID creation...`);

                await this.client.sendMessage(variant, message);
                messageSent = true;
                successfulVariant = variant;
                this.logger.log(`Message sent successfully after LID creation for ${variant}`);
              } else {
                // Step 2: Try getChatById with findOrCreateLatestChat
                this.logger.warn(`Contact sync failed: ${syncResult?.error}. Trying getChatById...`);

                try {
                  const chat = await this.client.getChatById(variant);
                  if (chat) {
                    await chat.sendMessage(message);
                    messageSent = true;
                    successfulVariant = variant;
                    this.logger.log(`Message sent successfully via chat object for ${variant}`);
                  }
                } catch (chatError: any) {
                  // Step 3: Last resort - getContactById
                  this.logger.warn(`getChatById failed: ${chatError.message}. Trying getContactById...`);

                  const contact = await this.client.getContactById(variant);
                  if (contact) {
                    const contactChat = await contact.getChat();
                    if (contactChat) {
                      await contactChat.sendMessage(message);
                      messageSent = true;
                      successfulVariant = variant;
                      this.logger.log(`Message sent successfully via contact chat for ${variant}`);
                    }
                  }
                }
              }
            } catch (lidError: any) {
              const lidErrorMsg = lidError.message || '';

              // Check if message was actually sent despite the error
              if (lidErrorMsg.includes('markedUnread') || lidErrorMsg.includes('sendSeen')) {
                this.logger.warn(`Message sent but follow-up failed (harmless): ${lidErrorMsg}`);
                messageSent = true;
                successfulVariant = variant;
              } else {
                lastError = lidError;
                this.logger.error(`Failed all LID approaches for ${variant}: ${lidErrorMsg}`);
              }
            }
          } else {
            lastError = sendError;
            this.logger.warn(`Failed to send to ${variant}: ${errorMsg}`);
          }
        }
      }

      // If no variant worked, throw the last error
      if (!messageSent) {
        throw lastError || new Error(`Failed to send message to any phone variant for ${this.maskPhone(cleanPhone)}`);
      }

      this.logger.log(`Message sent successfully to ${this.maskPhone(cleanPhone)} via ${successfulVariant}`);

      // Emit event for notification tracking
      this.eventEmitter.emit('whatsapp.message_sent', {
        to: cleanPhone,
        message,
        timestamp: new Date(),
      });

      return true;
    } catch (error: any) {
      this.logger.error(
        `Failed to send message to ${this.maskPhone(cleanPhone)}: ${error.message}`,
      );

      // Handle rate limiting
      if (error.message?.includes('rate limit')) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      // Handle disconnection during send
      if (error.message?.includes('session') || error.message?.includes('disconnected')) {
        this.isClientReady = false;
        throw new Error('WhatsApp client disconnected. Please reconnect and try again.');
      }

      throw error;
    }
  }

  /**
   * Check if the WhatsApp client is ready
   * @returns boolean indicating if client is ready
   */
  isReady(): boolean {
    return this.isClientReady;
  }

  /**
   * Generate a new QR code for authentication
   * This will reinitialize the client if needed
   * @returns Promise<{ qr: string; generatedAt: Date; expiresAt: Date }>
   */
  async generateQRCode(): Promise<{ qr: string; generatedAt: Date; expiresAt: Date }> {
    this.logger.log('Generating new QR code...');

    // If already authenticated, throw error
    if (this.isClientReady) {
      throw new Error('Client is already authenticated. Disconnect first to generate new QR code.');
    }

    // If already initializing, wait for QR code
    if (!this.isInitializing && !this.currentQRCode) {
      await this.initializeClient();
    }

    // Wait for QR code to be generated (max 30 seconds)
    const maxWaitTime = 30000;
    const startTime = Date.now();

    while (!this.currentQRCode && Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!this.currentQRCode || !this.qrCodeGeneratedAt) {
      throw new Error('Failed to generate QR code. Please try again.');
    }

    return {
      qr: this.currentQRCode,
      generatedAt: this.qrCodeGeneratedAt,
      expiresAt: new Date(this.qrCodeGeneratedAt.getTime() + this.QR_CODE_EXPIRY_MS),
    };
  }

  /**
   * Get current QR code for authentication
   * Returns cached QR code if available and not expired
   * @returns Promise<{ qr: string; generatedAt: Date; expiresAt: Date } | null>
   */
  async getQRCode(): Promise<{ qr: string; generatedAt: Date; expiresAt: Date } | null> {
    // Check if already authenticated
    if (this.isClientReady) {
      return null;
    }

    // Try to get from cache first
    const cachedQR = await this.cacheService.getObject<{
      qr: string;
      generatedAt: string;
      expiresAt: string;
    }>(this.CACHE_KEY_QR);

    if (cachedQR) {
      const expiresAt = new Date(cachedQR.expiresAt);

      // Check if expired
      if (expiresAt > new Date()) {
        return {
          qr: cachedQR.qr,
          generatedAt: new Date(cachedQR.generatedAt),
          expiresAt,
        };
      } else {
        // QR code expired, clear cache
        await this.cacheService.del(this.CACHE_KEY_QR);
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;
      }
    }

    // Return current in-memory QR code if available
    if (this.currentQRCode && this.qrCodeGeneratedAt) {
      const expiresAt = new Date(this.qrCodeGeneratedAt.getTime() + this.QR_CODE_EXPIRY_MS);

      // Check if expired
      if (expiresAt > new Date()) {
        return {
          qr: this.currentQRCode,
          generatedAt: this.qrCodeGeneratedAt,
          expiresAt,
        };
      } else {
        // QR code expired
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;
      }
    }

    return null;
  }

  /**
   * Check if WhatsApp is authenticated
   * @returns boolean indicating if client is authenticated and ready
   */
  isAuthenticated(): boolean {
    return this.isClientReady;
  }

  /**
   * Get client connection status
   */
  getStatus(): {
    ready: boolean;
    initializing: boolean;
    hasQRCode: boolean;
    reconnectAttempts: number;
  } {
    return {
      ready: this.isClientReady,
      initializing: this.isInitializing,
      hasQRCode: !!this.currentQRCode,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Get connection status with more details
   * Includes cached status information
   */
  async getConnectionStatus(): Promise<{
    status: WhatsAppConnectionStatus;
    ready: boolean;
    initializing: boolean;
    hasQRCode: boolean;
    qrCodeExpiry: Date | null;
    reconnectAttempts: number;
    lastUpdated: Date | null;
  }> {
    const cachedStatus = await this.cacheService.getObject<{
      status: WhatsAppConnectionStatus;
      lastUpdated: string;
    }>(this.CACHE_KEY_STATUS);

    const qrData = await this.getQRCode();

    return {
      status: cachedStatus?.status || WhatsAppConnectionStatus.DISCONNECTED,
      ready: this.isClientReady,
      initializing: this.isInitializing,
      hasQRCode: !!qrData,
      qrCodeExpiry: qrData?.expiresAt || null,
      reconnectAttempts: this.reconnectAttempts,
      lastUpdated: cachedStatus?.lastUpdated ? new Date(cachedStatus.lastUpdated) : null,
    };
  }

  /**
   * Update connection status in cache
   */
  private async updateConnectionStatus(status: WhatsAppConnectionStatus): Promise<void> {
    await this.cacheService.setObject(this.CACHE_KEY_STATUS, {
      status,
      lastUpdated: new Date(),
    });

    this.logger.log('WhatsApp connection status changed', {
      status,
      isReady: this.isClientReady,
      isInitializing: this.isInitializing,
      reconnectAttempts: this.reconnectAttempts,
      timestamp: new Date(),
    });

    // Emit event for notification tracking
    this.eventEmitter.emit('whatsapp.status_changed', {
      status,
      isReady: this.isClientReady,
      timestamp: new Date(),
    });
  }

  /**
   * Disconnect the WhatsApp client
   */
  async disconnect(): Promise<void> {
    this.logger.log('Disconnecting WhatsApp client...');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    await this.destroyClient();

    // Update connection status
    await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);

    this.logger.log('WhatsApp client disconnected successfully');

    // Emit event for notification tracking
    this.eventEmitter.emit('whatsapp.manual_disconnect', { timestamp: new Date() });
  }

  /**
   * Reconnect the WhatsApp client
   */
  async reconnect(): Promise<void> {
    this.logger.log('Reconnecting WhatsApp client...');

    // Reset reconnect attempts for manual reconnection
    this.reconnectAttempts = 0;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    await this.destroyClient();
    await this.initializeClient();

    this.logger.log('WhatsApp client reconnection initiated');

    // Emit event for notification tracking
    this.eventEmitter.emit('whatsapp.manual_reconnect', { timestamp: new Date() });
  }

  /**
   * Destroy the client instance
   * Saves session to Redis before destroying for persistence
   */
  private async destroyClient(): Promise<void> {
    if (this.client) {
      try {
        this.logger.log('Destroying WhatsApp client instance...');

        // Save session to Redis before destroying (for persistence)
        if (
          this.redisStore &&
          this.isClientReady &&
          process.env.WHATSAPP_USE_REMOTE_AUTH !== 'false'
        ) {
          try {
            this.logger.log('Saving session to Redis before destroying...');
            await this.redisStore.save({ session: this.SESSION_NAME });
            this.logger.log('Session saved to Redis successfully');
          } catch (saveError) {
            this.logger.error(`Failed to save session before destroy: ${saveError.message}`);
          }
        }

        // Try to gracefully destroy the client
        await Promise.race([
          this.client.destroy(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Client destroy timeout')), 5000),
          ),
        ]);

        this.logger.log('WhatsApp client destroyed successfully');
      } catch (error) {
        this.logger.error(`Error destroying client: ${error.message}`);
        // Force cleanup even if destroy fails
      } finally {
        // Always reset state
        this.client = null;
        this.isClientReady = false;
        this.isInitializing = false;
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;

        // Clear cache
        await this.cacheService.del(this.CACHE_KEY_QR).catch(() => {});

        // Kill any remaining Chrome processes
        await this.killOrphanedChromeProcesses();

        this.logger.log('WhatsApp client cleanup completed');
      }
    }
  }

  /**
   * Force backup session to Redis
   * Useful for manual backup before deployment
   */
  async backupSessionToRedis(): Promise<boolean> {
    if (!this.redisStore) {
      this.logger.warn('Redis store not initialized');
      return false;
    }

    if (!this.isClientReady) {
      this.logger.warn('Client is not ready, cannot backup session');
      return false;
    }

    try {
      this.logger.log('Manually backing up session to Redis...');
      await this.redisStore.save({ session: this.SESSION_NAME });
      this.logger.log('Session backup completed successfully');
      return true;
    } catch (error) {
      this.logger.error(`Failed to backup session: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if session exists in Redis
   */
  async hasSessionInRedis(): Promise<boolean> {
    if (!this.redisStore) {
      return false;
    }

    try {
      return await this.redisStore.sessionExists({ session: this.SESSION_NAME });
    } catch (error) {
      this.logger.error(`Failed to check session in Redis: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete session from Redis (for logout/reset)
   */
  async deleteSessionFromRedis(): Promise<boolean> {
    if (!this.redisStore) {
      this.logger.warn('Redis store not initialized');
      return false;
    }

    try {
      this.logger.log('Deleting session from Redis...');
      await this.redisStore.delete({ session: this.SESSION_NAME });
      this.logger.log('Session deleted from Redis successfully');
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete session from Redis: ${error.message}`);
      return false;
    }
  }

  /**
   * Normalize Brazilian phone number to the current 9-digit mobile format
   *
   * Brazilian mobile numbers transitioned from 8 to 9 digits (adding a 9 after area code)
   * This function ensures we always have the correct modern format.
   *
   * Examples:
   * - 554391402403 (12 digits, old format) -> 5543991402403 (13 digits, new format)
   * - 5543991402403 (13 digits, new format) -> 5543991402403 (unchanged)
   * - 43991402403 (11 digits, local with 9) -> 5543991402403 (add country code)
   * - 4391402403 (10 digits, local without 9) -> 5543991402403 (add country code + 9)
   *
   * @param phone Phone number in any format
   * @returns Normalized phone number in 55 + area code + 9 + 8 digits format
   */
  private normalizeBrazilianPhone(phone: string): string {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // If starts with +, it was already removed, but ensure no leading zeros
    cleaned = cleaned.replace(/^0+/, '');

    // Handle different lengths
    // Full international format with 9: 5543991402403 (13 digits)
    // Full international format without 9: 554391402403 (12 digits)
    // National format with 9: 43991402403 (11 digits)
    // National format without 9: 4391402403 (10 digits)
    // Local format with 9: 991402403 (9 digits)
    // Local format without 9: 91402403 (8 digits)

    // If it's a Brazilian number (starts with 55)
    if (cleaned.startsWith('55')) {
      // Remove country code to analyze
      const withoutCountry = cleaned.substring(2);

      // Area code is 2 digits, mobile starts with 9
      // withoutCountry should be: areaCode (2) + mobile (8 or 9)
      if (withoutCountry.length === 10) {
        // Old format: 4391402403 (area + 8 digits)
        // Need to add 9 after area code
        const areaCode = withoutCountry.substring(0, 2);
        const number = withoutCountry.substring(2);
        // Check if the number doesn't already start with 9
        if (!number.startsWith('9')) {
          cleaned = `55${areaCode}9${number}`;
          this.logger.debug(`Normalized phone (added 9): ${this.maskPhone(phone)} -> ${this.maskPhone(cleaned)}`);
        }
      } else if (withoutCountry.length === 11) {
        // New format: 43991402403 (area + 9 + 8 digits)
        // Already correct
      }
    } else if (cleaned.length === 11) {
      // National format with 9: 43991402403
      cleaned = `55${cleaned}`;
    } else if (cleaned.length === 10) {
      // National format without 9: 4391402403
      const areaCode = cleaned.substring(0, 2);
      const number = cleaned.substring(2);
      if (!number.startsWith('9')) {
        cleaned = `55${areaCode}9${number}`;
      } else {
        cleaned = `55${cleaned}`;
      }
    } else if (cleaned.length === 9) {
      // Local format with 9: 991402403
      // We can't determine area code, return as-is with warning
      this.logger.warn(`Phone number ${this.maskPhone(phone)} is too short - missing area code`);
    } else if (cleaned.length === 8) {
      // Local format without 9: 91402403
      // We can't determine area code, return as-is with warning
      this.logger.warn(`Phone number ${this.maskPhone(phone)} is too short - missing area code and 9`);
    }

    return cleaned;
  }

  /**
   * Check if the returned number is the old Brazilian format of the same number
   *
   * Brazilian mobile numbers transitioned from 8 to 9 digits by adding a 9 after the area code.
   * WhatsApp may have contacts registered with the old format.
   *
   * Example:
   * - New format (normalized): 5543991402403 (55 + 43 + 9 + 91402403)
   * - Old format (WhatsApp ID): 554391402403 (55 + 43 + 91402403)
   *
   * These are the SAME phone number, just different formats.
   *
   * @param normalizedPhone The normalized phone (new format with 9)
   * @param returnedNumber The number WhatsApp returned
   * @returns true if they represent the same Brazilian mobile number
   */
  private isOldBrazilianFormatOfSameNumber(normalizedPhone: string, returnedNumber: string): boolean {
    // Both must be Brazilian numbers (start with 55)
    if (!normalizedPhone.startsWith('55') || !returnedNumber.startsWith('55')) {
      return false;
    }

    // Normalized should be 13 digits (55 + 2 area + 9 + 8 number)
    // Returned should be 12 digits (55 + 2 area + 8 number)
    if (normalizedPhone.length !== 13 || returnedNumber.length !== 12) {
      return false;
    }

    // Extract parts
    const normalizedAreaCode = normalizedPhone.substring(2, 4); // e.g., "43"
    const normalizedNineDigit = normalizedPhone.substring(4, 5); // should be "9"
    const normalizedLocalNumber = normalizedPhone.substring(5); // e.g., "91402403"

    const returnedAreaCode = returnedNumber.substring(2, 4); // e.g., "43"
    const returnedLocalNumber = returnedNumber.substring(4); // e.g., "91402403"

    // Check if:
    // 1. Area codes match
    // 2. Normalized has the extra 9
    // 3. Local numbers match
    if (
      normalizedAreaCode === returnedAreaCode &&
      normalizedNineDigit === '9' &&
      normalizedLocalNumber === returnedLocalNumber
    ) {
      this.logger.debug(
        `Detected old Brazilian format: ${returnedNumber} is the same as ${normalizedPhone} (without the 9 prefix)`
      );
      return true;
    }

    return false;
  }

  /**
   * Generate phone number variants to try
   * IMPORTANT: Only returns the normalized (correct) format to avoid sending to wrong numbers
   *
   * Brazilian numbers with 9-digit mobile format (e.g., 5543991402403) should ONLY be sent
   * to that format. Falling back to old 8-digit format (e.g., 554391402403) would send
   * to a DIFFERENT phone number, not the intended recipient.
   */
  private generatePhoneVariants(phone: string): string[] {
    const cleaned = phone.replace(/\D/g, '');
    const variants: string[] = [];
    const seen = new Set<string>();

    const addVariant = (num: string) => {
      if (num && !seen.has(num)) {
        seen.add(num);
        variants.push(`${num}@c.us`);
      }
    };

    // Primary: normalized format (ensures correct Brazilian 9-digit format)
    const normalized = this.normalizeBrazilianPhone(cleaned);
    addVariant(normalized);

    // Secondary: original as provided (only if different from normalized)
    addVariant(cleaned);

    // NOTE: We intentionally do NOT add old format fallbacks
    // Sending to 554391402403 instead of 5543991402403 would reach a DIFFERENT person
    // It's better to fail than to send to the wrong number

    return variants;
  }

  /**
   * Mask phone number for logging (privacy)
   * In development mode, shows full number for debugging
   */
  private maskPhone(phone: string): string {
    // Show full number in development mode for debugging
    if (process.env.NODE_ENV === 'development') {
      return phone;
    }

    if (phone.length <= 4) return phone;
    const start = phone.slice(0, 2);
    const end = phone.slice(-2);
    const middle = '*'.repeat(phone.length - 4);
    return `${start}${middle}${end}`;
  }
}
