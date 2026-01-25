import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  WASocket,
  Browsers,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../cache/cache.service';
import { BaileysAuthStateStore } from './baileys-auth-state.store';
import { NotificationGatewayService } from '../notification/notification-gateway.service';

/**
 * WhatsApp connection status tracking
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
 * Baileys-based WhatsApp service
 * Replaces whatsapp-web.js with more reliable WebSocket-based connection
 *
 * Key Improvements:
 * - No Puppeteer/Chrome dependency (saves 250MB+ memory)
 * - Native multi-device protocol support
 * - Better reconnection handling
 * - Eliminates LID errors
 * - Faster startup (2-7s vs 40-70s)
 * - Lower resource usage (50-100MB vs 200-400MB)
 */
@Injectable()
export class BaileysWhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaileysWhatsAppService.name);

  private sock: WASocket | null = null;
  private clientReady = false;
  private isConnecting = false;

  // QR code management
  private currentQRCode: string | null = null;
  private qrCodeGeneratedAt: Date | null = null;
  private readonly QR_CODE_EXPIRY_MS = 60000; // 60 seconds
  private readonly CACHE_KEY_QR = 'whatsapp:qr';
  private readonly CACHE_KEY_STATUS = 'whatsapp:status';

  // Reconnection management
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 8;
  private readonly RECONNECT_DELAY = 3000; // 3 seconds base
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheService: CacheService,
    private readonly authStateStore: BaileysAuthStateStore,
    @Inject(forwardRef(() => NotificationGatewayService))
    private readonly gatewayService: NotificationGatewayService,
  ) {}

  async onModuleInit() {
    // Check if WhatsApp is disabled
    if (process.env.DISABLE_WHATSAPP === 'true') {
      this.logger.warn('WhatsApp service is DISABLED via environment variable');
      return;
    }

    this.logger.log('Initializing Baileys WhatsApp service...');
    await this.initializeSocket();
  }

  async onModuleDestroy() {
    this.logger.log('Destroying WhatsApp service...');
    await this.destroySocket();
  }

  /**
   * Initialize Baileys socket connection
   */
  private async initializeSocket(): Promise<void> {
    if (this.sock) {
      this.logger.warn('Socket already exists, destroying first...');
      await this.destroySocket();
    }

    try {
      this.isConnecting = true;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);

      // Initialize auth state from Redis
      const { state, saveCreds } = await this.authStateStore.initAuthState();

      // Fetch latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.log(`Using WA version v${version.join('.')}, isLatest: ${isLatest}`);

      // Create Pino logger with trace support for Baileys
      const pinoLogger = {
        trace: (...args) => {}, // Silent trace logs
        debug: (...args) => {}, // Silent debug logs
        info: (msg) => this.logger.log(msg),
        warn: (msg) => this.logger.warn(msg),
        error: (msg) => this.logger.error(msg),
        fatal: (msg) => this.logger.error(msg),
        child: () => pinoLogger,
        level: 'silent',
      };

      // Create socket
      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pinoLogger as any),
        },
        logger: pinoLogger as any,
        browser: Browsers.ubuntu('Chrome'),
        defaultQueryTimeoutMs: 60000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
      });

      // Register event handlers
      this.registerEventHandlers(saveCreds);

      this.logger.log('Baileys socket initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize socket: ${error.message}`, error.stack);
      this.isConnecting = false;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);

      // Retry connection
      this.handleReconnection();
    }
  }

  /**
   * Register all Baileys event handlers
   */
  private registerEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.sock) return;

    // Connection updates (handles qr, connected, disconnected, etc.)
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR code event
      if (qr) {
        await this.handleQRCode(qr);
      }

      // Connection opened (ready)
      if (connection === 'open') {
        this.logger.log('✅ WhatsApp connection opened successfully');
        this.clientReady = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;

        await this.cacheService.del(this.CACHE_KEY_QR);
        await this.updateConnectionStatus(WhatsAppConnectionStatus.READY);

        this.eventEmitter.emit('whatsapp.ready', { timestamp: new Date() });

        // Broadcast to all admins via WebSocket
        try {
          await this.gatewayService.broadcastToAdmin({
            event: 'whatsapp:connected',
            data: {
              status: 'READY',
              message: 'WhatsApp connected successfully',
              timestamp: new Date(),
            },
          });
        } catch (error) {
          this.logger.error(`Failed to broadcast connection status: ${error.message}`);
        }
      }

      // Connection closed
      if (connection === 'close') {
        this.clientReady = false;
        this.isConnecting = false;

        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

        this.logger.warn(`Connection closed. Reason: ${reason}, shouldReconnect: ${shouldReconnect}`);

        await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
        this.eventEmitter.emit('whatsapp.disconnected', { reason, timestamp: new Date() });

        if (shouldReconnect) {
          this.handleReconnection();
        } else {
          this.logger.error('Logged out from WhatsApp. Manual re-authentication required.');
          await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);
          this.eventEmitter.emit('whatsapp.auth_failure', {
            error: 'Logged out',
            timestamp: new Date()
          });
        }
      }

      // Connecting state
      if (connection === 'connecting') {
        this.logger.log('Connecting to WhatsApp...');
        this.isConnecting = true;
        await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);
      }
    });

    // Credentials update (save to Redis)
    this.sock.ev.on('creds.update', saveCreds);

    // Messages received/sent
    this.sock.ev.on('messages.upsert', async (m) => {
      const messages = m.messages;
      const type = m.type;

      for (const message of messages) {
        // Check if message is from us
        const fromMe = message.key.fromMe;

        // Extract message content
        const messageText = message.message?.conversation ||
                           message.message?.extendedTextMessage?.text ||
                           '';

        // Emit event for tracking
        this.eventEmitter.emit('whatsapp.message_create', {
          messageId: message.key.id,
          from: message.key.remoteJid,
          fromMe,
          message: messageText,
          timestamp: new Date(message.messageTimestamp as number * 1000),
          type,
        });

        if (fromMe) {
          this.logger.debug(`Message sent: ${messageText.substring(0, 50)}...`);
        }
      }
    });
  }

  /**
   * Handle QR code generation
   */
  private async handleQRCode(qr: string): Promise<void> {
    try {
      this.logger.log('QR Code received, scan with WhatsApp app');

      // Convert QR string to data URL
      const qrImageDataURL = await QRCode.toDataURL(qr, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      this.currentQRCode = qrImageDataURL;
      this.qrCodeGeneratedAt = new Date();

      // Cache QR code with expiry
      await this.cacheService.setObject(
        this.CACHE_KEY_QR,
        {
          qr: qrImageDataURL,
          generatedAt: this.qrCodeGeneratedAt,
          expiresAt: new Date(Date.now() + this.QR_CODE_EXPIRY_MS),
        },
        Math.ceil(this.QR_CODE_EXPIRY_MS / 1000),
      );

      await this.updateConnectionStatus(WhatsAppConnectionStatus.QR_READY);

      this.eventEmitter.emit('whatsapp.qr', { qr: qrImageDataURL, timestamp: new Date() });

      // Broadcast QR code to all admins via WebSocket
      try {
        await this.gatewayService.broadcastToAdmin({
          event: 'whatsapp:qr',
          data: {
            qr: qrImageDataURL,
            generatedAt: this.qrCodeGeneratedAt,
            expiresAt: new Date(Date.now() + this.QR_CODE_EXPIRY_MS),
            message: 'New QR code generated. Scan with WhatsApp mobile app.',
          },
        });
      } catch (error) {
        this.logger.error(`Failed to broadcast QR code: ${error.message}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process QR code: ${error.message}`);
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `Maximum reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Manual intervention required.`,
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY * Math.pow(1.8, this.reconnectAttempts - 1);
    const cappedDelay = Math.min(delay, 90000); // Cap at 90 seconds

    this.logger.log(
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${cappedDelay / 1000} seconds...`,
    );

    this.reconnectTimeout = setTimeout(async () => {
      this.logger.log(`Attempting to reconnect (attempt ${this.reconnectAttempts})...`);
      try {
        await this.initializeSocket();
      } catch (error) {
        this.logger.error(`Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`);
      }
    }, cappedDelay);
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!this.clientReady || !this.sock) {
      throw new Error('WhatsApp client is not ready. Please check connection status.');
    }

    if (!phone || !message) {
      throw new Error('Phone number and message are required');
    }

    try {
      // Format phone number for Baileys (remove non-digits)
      const cleanPhone = phone.replace(/\D/g, '');

      // Use onWhatsApp to get the correct JID (handles @lid vs @s.whatsapp.net)
      // This is CRITICAL in Baileys v7+ to resolve the correct account
      this.logger.log(`Resolving JID for phone ${this.maskPhone(cleanPhone)}`);
      const [result] = await this.sock.onWhatsApp(cleanPhone);

      if (!result || !result.exists) {
        throw new Error(`Phone number ${this.maskPhone(cleanPhone)} is not registered on WhatsApp`);
      }

      const jid = result.jid;
      this.logger.log(`Resolved JID: ${jid.split('@')[0]}@${jid.split('@')[1]} for phone ${this.maskPhone(cleanPhone)}`);

      // Send message to the resolved JID
      await this.sock.sendMessage(jid, { text: message });

      this.logger.log(`Message sent successfully to ${this.maskPhone(cleanPhone)}`);

      this.eventEmitter.emit('whatsapp.message_sent', {
        to: cleanPhone,
        jid: jid,
        message,
        timestamp: new Date(),
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get current QR code
   */
  async getQRCode(): Promise<{ qr: string; generatedAt: Date; expiresAt: Date } | null> {
    try {
      const cached = await this.cacheService.get<any>(this.CACHE_KEY_QR);

      if (cached && typeof cached === 'object') {
        return {
          qr: cached.qr,
          generatedAt: new Date(cached.generatedAt),
          expiresAt: new Date(cached.expiresAt),
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to get QR code: ${error.message}`);
      return null;
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(): Promise<{
    status: WhatsAppConnectionStatus;
    ready: boolean;
    hasQRCode: boolean;
    qrCodeExpiry: Date | null;
    reconnectAttempts: number;
  }> {
    const statusStr = await this.cacheService.get<string>(this.CACHE_KEY_STATUS);
    const status = (statusStr as WhatsAppConnectionStatus) || WhatsAppConnectionStatus.DISCONNECTED;

    const qrData = await this.getQRCode();

    return {
      status,
      ready: this.clientReady,
      hasQRCode: !!qrData,
      qrCodeExpiry: qrData?.expiresAt || null,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Check if WhatsApp client is ready to send messages
   * @returns boolean indicating if client is ready
   */
  isReady(): boolean {
    return this.clientReady && this.sock !== null;
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    return await this.authStateStore.hasAuthState();
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect(): Promise<void> {
    this.logger.log('Manually disconnecting WhatsApp client...');
    await this.destroySocket();
    await this.authStateStore.clearAuthState();
    this.eventEmitter.emit('whatsapp.manual_disconnect', { timestamp: new Date() });
  }

  /**
   * Reconnect to WhatsApp
   */
  async reconnect(): Promise<void> {
    this.logger.log('Manually reconnecting WhatsApp client...');
    await this.destroySocket();
    this.reconnectAttempts = 0;
    await this.initializeSocket();
    this.eventEmitter.emit('whatsapp.manual_reconnect', { timestamp: new Date() });
  }

  /**
   * Destroy socket connection
   */
  private async destroySocket(): Promise<void> {
    if (this.sock) {
      try {
        this.sock.end(undefined);
        this.logger.log('Socket destroyed successfully');
      } catch (error) {
        this.logger.error(`Error destroying socket: ${error.message}`);
      } finally {
        this.sock = null;
        this.clientReady = false;
        this.isConnecting = false;
        this.currentQRCode = null;
        this.qrCodeGeneratedAt = null;

        await this.cacheService.del(this.CACHE_KEY_QR);
      }
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Update connection status in Redis
   */
  private async updateConnectionStatus(status: WhatsAppConnectionStatus): Promise<void> {
    try {
      await this.cacheService.set(this.CACHE_KEY_STATUS, status, 86400); // 24 hours
      this.eventEmitter.emit('whatsapp.status_changed', { status, timestamp: new Date() });
    } catch (error) {
      this.logger.error(`Failed to update connection status: ${error.message}`);
    }
  }

  /**
   * Mask phone number for privacy
   */
  private maskPhone(phone: string): string {
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
