import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { CacheService } from '../cache/cache.service';

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
  private isClientReady = false;
  private isInitializing = false;
  private currentQRCode: string | null = null;
  private qrCodeGeneratedAt: Date | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly QR_CODE_EXPIRY_MS = 60000; // 60 seconds
  private readonly CACHE_KEY_STATUS = 'whatsapp:status';
  private readonly CACHE_KEY_QR = 'whatsapp:qr';
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Initialize WhatsApp client on module initialization
   */
  async onModuleInit() {
    this.logger.log('Initializing WhatsApp module...');
    await this.initializeClient();
  }

  /**
   * Cleanup on module destruction
   */
  async onModuleDestroy() {
    this.logger.log('Destroying WhatsApp module...');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    await this.destroyClient();
  }

  /**
   * Initialize the WhatsApp client with all event handlers
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

      // Create client with LocalAuth strategy for session persistence
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth',
        }),
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
          ],
        },
      });

      this.setupEventHandlers();

      this.logger.log('Initializing WhatsApp client...');
      await this.client.initialize();

      this.reconnectAttempts = 0;
    } catch (error) {
      this.logger.error(`Failed to initialize WhatsApp client: ${error.message}`, error.stack);
      this.isInitializing = false;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
      this.handleReconnection();
      throw error;
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

      // Emit event for notification tracking
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

    // Remote session saved event
    this.client.on('remote_session_saved', () => {
      this.logger.log('Remote session saved successfully');
    });
  }

  /**
   * Handle reconnection logic with exponential backoff
   */
  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `Maximum reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Manual intervention required.`,
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);

    this.logger.log(
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay / 1000} seconds...`,
    );

    this.reconnectTimeout = setTimeout(async () => {
      this.logger.log(`Attempting to reconnect (attempt ${this.reconnectAttempts})...`);
      try {
        await this.initializeClient();
      } catch (error) {
        this.logger.error(
          `Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`,
        );
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
      // Format phone number for WhatsApp (add @c.us suffix)
      const chatId = `${cleanPhone}@c.us`;

      this.logger.log(`Sending message to ${this.maskPhone(cleanPhone)}`);

      // Try to get the number ID first to establish LID (fixes "No LID for user" errors)
      let whatsappId = chatId;
      try {
        const numberId = await this.client.getNumberId(cleanPhone);
        if (numberId) {
          whatsappId = numberId._serialized;
          this.logger.log(`Got WhatsApp ID for ${this.maskPhone(cleanPhone)}: ${whatsappId}`);
        }
      } catch (idError: any) {
        this.logger.warn(`Could not get number ID for ${this.maskPhone(cleanPhone)}: ${idError.message}. Using chat ID format.`);
      }

      // Check if number exists on WhatsApp (with error handling for "No LID" errors)
      try {
        const isRegistered = await this.client.isRegisteredUser(whatsappId);
        if (!isRegistered) {
          throw new Error('Phone number is not registered on WhatsApp');
        }
      } catch (checkError: any) {
        // If isRegisteredUser fails with "No LID" or other errors, log warning but try to send anyway
        this.logger.warn(
          `Could not verify registration for ${this.maskPhone(cleanPhone)}: ${checkError.message}. Will attempt to send anyway.`,
        );
      }

      // Send message using the WhatsApp ID
      await this.client.sendMessage(whatsappId, message);

      this.logger.log(`Message sent successfully to ${this.maskPhone(cleanPhone)}`);

      // Emit event for notification tracking
      this.eventEmitter.emit('whatsapp.message_sent', {
        to: cleanPhone,
        message,
        timestamp: new Date(),
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send message to ${this.maskPhone(cleanPhone)}: ${error.message}`,
      );

      // Handle rate limiting
      if (error.message.includes('rate limit')) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      // Handle disconnection during send
      if (error.message.includes('session') || error.message.includes('disconnected')) {
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
   */
  private async destroyClient(): Promise<void> {
    if (this.client) {
      try {
        this.logger.log('Destroying WhatsApp client instance...');
        await this.client.destroy();
        this.client = null;
        this.isClientReady = false;
        this.isInitializing = false;
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;

        // Clear cache
        await this.cacheService.del(this.CACHE_KEY_QR);

        this.logger.log('WhatsApp client destroyed successfully');
      } catch (error) {
        this.logger.error(`Error destroying client: ${error.message}`);
        // Force cleanup even if destroy fails
        this.client = null;
        this.isClientReady = false;
        this.isInitializing = false;
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;

        // Clear cache
        await this.cacheService.del(this.CACHE_KEY_QR).catch(() => {});
      }
    }
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
