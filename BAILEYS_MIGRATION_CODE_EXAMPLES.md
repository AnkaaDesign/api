# Baileys Migration - Practical Code Examples

## Overview
This document provides complete, production-ready code examples for migrating from whatsapp-web.js to Baileys while maintaining the same external event interface.

---

## Example 1: Event Handler Setup - Connection Updates

### Current Implementation (whatsapp-web.js)
```typescript
// From whatsapp.service.ts lines 496-611

private setupEventHandlers(): void {
  if (!this.client) return;

  // QR Code event
  this.client.on('qr', async (qr: string) => {
    // QR handling...
  });

  // Ready event
  this.client.on('ready', async () => {
    // Ready handling...
  });

  // Authenticated event
  this.client.on('authenticated', async () => {
    // Auth handling...
  });

  // Auth failure event
  this.client.on('auth_failure', async error => {
    // Failure handling...
  });

  // Disconnected event
  this.client.on('disconnected', async (reason: string) => {
    // Disconnect handling...
  });
}
```

### Baileys Implementation
```typescript
// Complete replacement for setupEventHandlers()

private setupEventHandlers(): void {
  if (!this.socket) return;

  // Connection state handler - replaces qr, ready, auth_failure, disconnected
  this.socket.ev.on('connection.update', async (update) => {
    const {
      connection,
      qr,
      isNewLogin,
      lastDisconnect,
      receivedPendingNotifications,
      isBlockedByRateLimit,
    } = update;

    // ========== QR CODE EVENT ==========
    if (qr) {
      await this.handleQRCode(qr);
    }

    // ========== CONNECTION OPEN (READY) ==========
    if (connection === 'open') {
      await this.handleConnectionOpen();
    }

    // ========== CONNECTING STATE ==========
    if (connection === 'connecting') {
      this.logger.log('WhatsApp client connecting...');
      await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);
    }

    // ========== CONNECTION CLOSED (DISCONNECTED) ==========
    if (connection === 'close') {
      await this.handleConnectionClosed(lastDisconnect);
    }

    // ========== RATE LIMITING ==========
    if (isBlockedByRateLimit) {
      this.logger.warn('WhatsApp rate limiting detected');
      await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
      // Implement longer backoff
      this.handleReconnection(true); // Pass flag for rate limit
    }
  });

  // Credentials handler - replaces authenticated, remote_session_saved
  this.socket.ev.on('creds.update', async (update) => {
    await this.handleCredentialsUpdate(update);
  });

  // Messages handler - replaces message_create
  this.socket.ev.on('messages.upsert', async (m) => {
    await this.handleMessagesUpsert(m);
  });

  // Optional: Chat updates
  this.socket.ev.on('chats.upsert', async (chats) => {
    this.logger.debug(`Chats upserted: ${chats.length}`);
  });
}

// ==================== Handler Methods ====================

/**
 * Handle QR code generation
 */
private async handleQRCode(qr: string): Promise<void> {
  try {
    this.logger.log('QR Code received, scan with WhatsApp app');

    // Convert QR string to base64 image (exact same as before)
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

    // Store QR code in cache with expiry (exact same as before)
    await this.cacheService.setObject(
      this.CACHE_KEY_QR,
      {
        qr: qrImageDataURL,
        generatedAt: this.qrCodeGeneratedAt,
        expiresAt: new Date(Date.now() + this.QR_CODE_EXPIRY_MS),
      },
      Math.ceil(this.QR_CODE_EXPIRY_MS / 1000),
    );

    // Update connection status
    await this.updateConnectionStatus(WhatsAppConnectionStatus.QR_READY);

    // Display QR code in terminal (exact same as before)
    qrcode.generate(qr, { small: true });

    // Emit event for notification tracking (exact same payload)
    this.eventEmitter.emit('whatsapp.qr', { qr, timestamp: new Date() });
  } catch (error) {
    this.logger.error(`Error handling QR code: ${error.message}`);
  }
}

/**
 * Handle connection open (ready event)
 */
private async handleConnectionOpen(): Promise<void> {
  try {
    this.logger.log('WhatsApp client is ready!');
    this.isClientReady = true;
    this.isInitializing = false;
    this.currentQRCode = null;
    this.qrCodeGeneratedAt = null;
    this.reconnectAttempts = 0;

    // Clear QR code from cache
    await this.cacheService.del(this.CACHE_KEY_QR).catch(() => {});

    // Update connection status
    await this.updateConnectionStatus(WhatsAppConnectionStatus.READY);

    // Start session backup and health check intervals
    this.startSessionBackupInterval();
    this.startHealthCheckInterval();

    // Save session immediately after becoming ready
    await this.safeBackupSession();

    // Emit event (same payload as before)
    this.eventEmitter.emit('whatsapp.ready', { timestamp: new Date() });
  } catch (error) {
    this.logger.error(`Error handling connection open: ${error.message}`);
  }
}

/**
 * Handle connection closed (disconnected event)
 */
private async handleConnectionClosed(
  lastDisconnect: any,
): Promise<void> {
  try {
    const error = lastDisconnect?.error;
    const isBoom = Boom.isBoom(error);

    this.logger.warn(
      `WhatsApp client disconnected: ${error?.message || 'Unknown reason'}`,
    );

    this.isClientReady = false;
    this.isInitializing = false;
    this.currentQRCode = null;
    this.qrCodeGeneratedAt = null;

    // Clear QR code from cache
    await this.cacheService.del(this.CACHE_KEY_QR).catch(() => {});

    // Check if it's an authentication failure
    const isAuthFailure =
      isBoom && error?.output?.statusCode === DisconnectReason.loggedOut;

    if (isAuthFailure) {
      this.logger.error('Authentication failed (logged out)');
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);

      // Emit auth_failure event (same payload)
      this.eventEmitter.emit('whatsapp.auth_failure', {
        error: 'Logged out or authentication failed',
        timestamp: new Date(),
      });

      // Clear credentials to force re-login
      await this.deleteSessionFromRedis();
      return;
    }

    // Regular disconnection
    await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);

    // Emit disconnected event (same payload)
    this.eventEmitter.emit('whatsapp.disconnected', {
      reason: error?.message || 'Unknown',
      timestamp: new Date(),
    });

    // Attempt to reconnect
    this.handleReconnection();
  } catch (error) {
    this.logger.error(`Error handling connection close: ${error.message}`);
  }
}

/**
 * Handle credentials update (authentication and session save)
 */
private async handleCredentialsUpdate(update: Partial<AuthenticationCreds>): Promise<void> {
  try {
    if (!update || Object.keys(update).length === 0) {
      return;
    }

    // Check if this is the first authentication
    if (!this.hasAuthenticatedOnce && update.me) {
      this.hasAuthenticatedOnce = true;

      this.logger.log('WhatsApp client authenticated successfully');
      this.currentQRCode = null;
      this.qrCodeGeneratedAt = null;

      // Clear QR code from cache
      await this.cacheService.del(this.CACHE_KEY_QR).catch(() => {});

      // Update connection status
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTHENTICATED);

      // Emit authenticated event (same payload)
      this.eventEmitter.emit('whatsapp.authenticated', { timestamp: new Date() });
    }

    // Save credentials to Redis (equivalent to remote_session_saved)
    if (this.redisStore && process.env.WHATSAPP_USE_REMOTE_AUTH !== 'false') {
      try {
        await this.redisStore.save({
          session: this.SESSION_NAME,
          credentials: update
        });
        this.logger.debug('Credentials backed up to Redis');
      } catch (saveError) {
        this.logger.warn(`Failed to backup credentials to Redis: ${saveError.message}`);
      }
    }

    // Emit session saved event (same payload)
    this.eventEmitter.emit('whatsapp.session.saved', {
      sessionName: this.SESSION_NAME,
      timestamp: new Date(),
    });
  } catch (error) {
    this.logger.error(`Error handling credentials update: ${error.message}`);
  }
}

/**
 * Handle messages upsert (replaces message_create)
 */
private async handleMessagesUpsert(m: {
  messages: WAMessage[];
  type: MessageUpsertType;
}): Promise<void> {
  const { messages, type } = m;

  // Only process real-time notifications, not archived messages
  if (type !== 'notify') {
    return;
  }

  for (const msg of messages) {
    try {
      // Skip group messages if not configured
      if (msg.key.remoteJid?.endsWith('@g.us')) {
        this.logger.debug('Skipping group message');
        continue;
      }

      // Extract message text from nested structure
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!body) {
        this.logger.debug('Message has no text content, skipping');
        continue;
      }

      // Determine if message is from me (sent) or received
      const fromMe = msg.key.fromMe;

      // Get contact name and jid
      const contactJid = msg.key.remoteJid || '';
      const contactName = msg.pushName || contactJid;

      this.logger.log(
        `Message ${fromMe ? 'sent' : 'received'}: ${body.substring(0, 50)}... from ${contactName}`,
      );

      // Emit message_create event with same payload structure
      this.eventEmitter.emit('whatsapp.message_create', {
        messageId: msg.key.id,
        from: contactJid,
        to: msg.key.remoteJid || '',
        body: body,
        fromMe: fromMe,
        hasMedia: !!msg.message?.mediaMessage,
        chatName: contactName,
        contactName: contactName,
        timestamp: new Date((msg.messageTimestamp || 0) * 1000),
      });
    } catch (error) {
      this.logger.error(`Error processing message event: ${error.message}`);
    }
  }
}
```

---

## Example 2: Baileys Socket Initialization

### Old Implementation (whatsapp-web.js)
```typescript
// From whatsapp.service.ts lines 371-459

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

    const useRemoteAuth = process.env.WHATSAPP_USE_REMOTE_AUTH !== 'false';
    let authStrategy;

    if (useRemoteAuth && this.redisStore) {
      // RemoteAuth with Redis
      authStrategy = new RemoteAuth({
        store: this.redisStore,
        backupSyncIntervalMs: 60000,
        clientId: this.SESSION_NAME,
        dataPath: process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth',
      });
    } else {
      // LocalAuth
      authStrategy = new LocalAuth({
        dataPath: process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth',
      });
    }

    this.client = new Client({
      authStrategy,
      webVersionCache: { type: 'remote', ... },
      puppeteer: { headless: true, args: [...] },
    });

    this.setupEventHandlers();
    await this.client.initialize();
    this.reconnectAttempts = 0;
  } catch (error) {
    // Error handling...
    this.isInitializing = false;
    this.handleReconnection();
  }
}
```

### New Implementation (Baileys)
```typescript
async initializeClient(): Promise<void> {
  if (this.isInitializing) {
    this.logger.warn('Client is already initializing, skipping...');
    return;
  }

  if (this.socket) {
    this.logger.warn('Socket already exists, destroying old socket first...');
    await this.destroyClient();
  }

  try {
    this.isInitializing = true;
    await this.updateConnectionStatus(WhatsAppConnectionStatus.CONNECTING);

    this.logger.log('Creating new Baileys socket...');

    // Create authentication store (Baileys-native)
    const { state, saveCreds } = await useMultiFileAuthState(
      process.env.WHATSAPP_SESSION_PATH || '.baileys_auth',
    );

    // Create socket with Baileys configuration
    this.socket = makeWASocket({
      auth: state,
      // Use WebSocket (not browser-based)
      browser: Browsers.appropriate('Chrome'),
      // Connection options
      shouldSyncHistoryMessage: false,
      syncFullHistory: false,
      // Message receipt tracking
      markOnlineOnConnect: true,
      // Logging
      logger: winston.child({
        level: process.env.LOG_LEVEL || 'warn',
        stream: 'ext_log',
      }),
      // Retry configuration
      retryRequestDelayMs: 100,
      maxMsgsInChat: 100,
      // Custom message type handler
      getMessage: async key => {
        // Implement message history retrieval if needed
        return {
          conversation: 'Message not found',
        };
      },
    });

    // Handle credential updates (auto-save)
    this.socket.ev.on('creds.update', saveCreds);

    // Setup all event handlers
    this.setupEventHandlers();

    // Wait for initial connection
    this.logger.log('Waiting for socket to initialize...');

    // Set a timeout to detect if socket never connects
    const initTimeout = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Socket initialization timeout (30 seconds)'));
      }, 30000);
    });

    const socketReady = new Promise<void>(resolve => {
      const checkReady = setInterval(() => {
        if (this.isClientReady) {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);
    });

    try {
      await Promise.race([socketReady, initTimeout]);
    } catch (timeoutError) {
      // Timeout is non-fatal, socket may still connect
      this.logger.warn(`Socket initialization timeout: ${timeoutError.message}`);
    }

    this.reconnectAttempts = 0;
    this.logger.log('Baileys socket initialized successfully');
  } catch (error) {
    this.logger.error(`Failed to initialize Baileys socket: ${error.message}`, error.stack);
    this.isInitializing = false;

    // Ensure socket is destroyed on failure
    try {
      if (this.socket) {
        this.socket.ws?.close();
        this.socket = null;
      }
    } catch (destroyError) {
      this.logger.error(`Failed to cleanup socket: ${destroyError.message}`);
    }

    await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
    this.handleReconnection();
  }
}
```

---

## Example 3: Type Definitions & Imports

### Required Imports for Baileys
```typescript
// At the top of whatsapp.service.ts

import {
  default as makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
  AuthenticationCreds,
  WAMessage,
  MessageUpsertType,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as P from 'pino';
import winston from 'winston';

// Keep existing imports
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as qrcode from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import { CacheService } from '../cache/cache.service';
```

### Updated Class Properties
```typescript
@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);

  // OLD: private client: Client | null = null;
  // NEW:
  private socket: ReturnType<typeof makeWASocket> | null = null;

  // Add flag to track initial authentication
  private hasAuthenticatedOnce = false;

  // Keep all existing properties
  private redisStore: RedisStore | null = null;
  private isClientReady = false;
  private isInitializing = false;
  private currentQRCode: string | null = null;
  private qrCodeGeneratedAt: Date | null = null;
  // ... rest of properties remain the same
}
```

---

## Example 4: Message Sending with Baileys

### Old Implementation (whatsapp-web.js)
```typescript
async sendMessage(phone: string, message: string): Promise<boolean> {
  if (!this.isClientReady || !this.client) {
    throw new Error('WhatsApp client is not ready');
  }

  try {
    const normalizedPhone = this.normalizeBrazilianPhone(phone);
    const phoneVariants = this.generatePhoneVariants(phone);

    for (const variant of phoneVariants) {
      try {
        const isRegistered = await this.client.isRegisteredUser(variant);
        if (!isRegistered) continue;

        await this.client.sendMessage(variant, message);
        messageSent = true;
        break;
      } catch (sendError) {
        // Handle errors...
      }
    }

    if (messageSent) {
      this.eventEmitter.emit('whatsapp.message_sent', {
        to: phone,
        message,
        timestamp: new Date(),
      });
      return true;
    }

    throw new Error('Failed to send message');
  } catch (error) {
    this.logger.error(`Failed to send message: ${error.message}`);
    throw error;
  }
}
```

### New Implementation (Baileys)
```typescript
async sendMessage(phone: string, message: string): Promise<boolean> {
  if (!this.isClientReady || !this.socket) {
    throw new Error('WhatsApp client is not ready');
  }

  if (!phone || !message) {
    throw new Error('Phone number and message are required');
  }

  try {
    const normalizedPhone = this.normalizeBrazilianPhone(phone);
    this.logger.log(`Sending message to ${this.maskPhone(normalizedPhone)}`);

    // In Baileys, format is "phone@c.us" for individual chats
    const jid = normalizedPhone + '@c.us';

    // Check if user is registered (optional, can fail gracefully)
    try {
      const exists = await this.socket.onWhatsApp(jid);
      if (!exists || exists.length === 0) {
        this.logger.warn(`Phone ${this.maskPhone(normalizedPhone)} might not be on WhatsApp`);
        // Continue anyway - might still work
      }
    } catch (checkError) {
      this.logger.debug(`Could not verify registration: ${checkError.message}`);
      // Continue - we'll get an error when trying to send if they don't exist
    }

    // Send the message
    try {
      const sentMessage = await this.socket.sendMessage(jid, {
        text: message,
      });

      this.logger.log(
        `Message sent successfully to ${this.maskPhone(normalizedPhone)}`,
      );

      // Emit event (same payload as whatsapp-web.js)
      this.eventEmitter.emit('whatsapp.message_sent', {
        to: normalizedPhone,
        message,
        timestamp: new Date(),
      });

      return true;
    } catch (sendError: any) {
      const errorMsg = sendError.message || '';

      // Check for user not found errors
      if (
        errorMsg.includes('not found') ||
        errorMsg.includes('does not exist') ||
        errorMsg.includes('not registered')
      ) {
        throw new Error(`User not registered on WhatsApp: ${normalizedPhone}`);
      }

      // Check for rate limiting
      if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
        throw new Error('Rate limited by WhatsApp. Try again later.');
      }

      // Re-throw other errors
      throw sendError;
    }
  } catch (error: any) {
    this.logger.error(`Failed to send message to ${this.maskPhone(phone)}: ${error.message}`);
    throw error;
  }
}
```

---

## Example 5: Credential Storage with Redis

### Abstract Store Interface
```typescript
// Create new file: src/modules/common/whatsapp/stores/auth-store.ts

import { AuthenticationState, initAuthCreds, proto } from '@whiskeysockets/baileys';

/**
 * Abstract authentication store interface for Baileys
 * Can be implemented with Redis, filesystem, or other storage
 */
export interface IAuthStore {
  readCredentials(): Promise<AuthenticationState['creds']>;
  writeCredentials(creds: AuthenticationState['creds']): Promise<void>;
  readKeys(type: string, ids: string[]): Promise<any>;
  writeKeys(data: { [_: string]: any }, type: string): Promise<void>;
}

/**
 * Redis-based authentication store for Baileys
 * Persists credentials for multi-instance deployments
 */
export class RedisAuthStore implements IAuthStore {
  private readonly credsKey = 'wa:creds';
  private readonly keysPrefix = 'wa:keys:';

  constructor(private redisClient: any) {}

  async readCredentials(): Promise<AuthenticationState['creds']> {
    try {
      const creds = await this.redisClient.getJSON(this.credsKey);
      if (creds) {
        return creds;
      }
      // Initialize new credentials if not found
      return initAuthCreds();
    } catch (error) {
      console.warn('Failed to read credentials from Redis:', error);
      return initAuthCreds();
    }
  }

  async writeCredentials(creds: AuthenticationState['creds']): Promise<void> {
    try {
      await this.redisClient.setJSON(this.credsKey, creds);
    } catch (error) {
      console.error('Failed to write credentials to Redis:', error);
      throw error;
    }
  }

  async readKeys(type: string, ids: string[]): Promise<any> {
    try {
      const keys: any = {};
      for (const id of ids) {
        const key = `${this.keysPrefix}${type}:${id}`;
        const value = await this.redisClient.get(key);
        if (value) {
          keys[id] = value;
        }
      }
      return keys;
    } catch (error) {
      console.warn('Failed to read keys from Redis:', error);
      return {};
    }
  }

  async writeKeys(data: { [_: string]: any }, type: string): Promise<void> {
    try {
      for (const [key, value] of Object.entries(data)) {
        const redisKey = `${this.keysPrefix}${type}:${key}`;
        await this.redisClient.set(redisKey, JSON.stringify(value));
        // Set expiry to 90 days for keys
        await this.redisClient.expire(redisKey, 90 * 24 * 60 * 60);
      }
    } catch (error) {
      console.error('Failed to write keys to Redis:', error);
      throw error;
    }
  }
}
```

### Integration with Baileys
```typescript
// In whatsapp.service.ts

import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { RedisAuthStore } from './stores/auth-store';

export class WhatsAppService {
  // ...

  async initializeClient(): Promise<void> {
    // ...

    let authState: AuthenticationState;
    let saveCreds: () => Promise<void>;

    const useRedisAuth = process.env.WHATSAPP_USE_REDIS_AUTH === 'true';

    if (useRedisAuth && this.redisStore) {
      // Use Redis-based auth store for multi-instance deployment
      const redisAuthStore = new RedisAuthStore(this.redisStore);
      const creds = await redisAuthStore.readCredentials();

      authState = {
        creds,
        keys: {
          get: (type, ids) => redisAuthStore.readKeys(type, ids),
          set: (data, type) => redisAuthStore.writeKeys(data, type),
        },
      };

      saveCreds = async () => {
        await redisAuthStore.writeCredentials(authState.creds);
      };
    } else {
      // Use multi-file auth state (local filesystem)
      const result = await useMultiFileAuthState(
        process.env.WHATSAPP_SESSION_PATH || '.baileys_auth',
      );
      authState = result.state;
      saveCreds = result.saveCreds;
    }

    // Create socket with auth state
    this.socket = makeWASocket({
      auth: authState,
      // ... other config
    });

    // Auto-save credentials on updates
    this.socket.ev.on('creds.update', saveCreds);
  }
}
```

---

## Example 6: Error Handling Comparison

### Error Handling Old (whatsapp-web.js)
```typescript
try {
  await this.client.sendMessage(variant, message);
  messageSent = true;
} catch (sendError: any) {
  const errorMsg = sendError.message || '';

  if (errorMsg.includes('markedUnread') || errorMsg.includes('sendSeen')) {
    // Message was sent despite the error
    messageSent = true;
  } else if (errorMsg.includes('No LID for user')) {
    // Handle LID creation...
    // Special handling for new contacts
  } else if (errorMsg.includes('rate limit')) {
    throw new Error('Rate limit exceeded');
  } else {
    lastError = sendError;
  }
}
```

### Error Handling New (Baileys)
```typescript
try {
  await this.socket.sendMessage(jid, { text: message });
  messageSent = true;
} catch (sendError: any) {
  const isBoom = Boom.isBoom(sendError);

  // Handle Boom errors
  if (isBoom) {
    const statusCode = sendError.output?.statusCode;

    // Rate limiting
    if (statusCode === 429) {
      throw new Error('Rate limit exceeded');
    }

    // User not found
    if (statusCode === 404) {
      throw new Error('User not found on WhatsApp');
    }

    // Authentication error
    if (statusCode === 401) {
      throw new Error('Authentication failed');
    }
  }

  // Handle string-based errors
  const errorMsg = sendError.message || '';

  if (errorMsg.includes('not registered')) {
    throw new Error('User not registered on WhatsApp');
  }

  if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
    throw new Error('Connection timeout - try again later');
  }

  // Unknown error
  throw sendError;
}
```

---

## Example 7: Health Check with Baileys

### Old Implementation (whatsapp-web.js)
```typescript
private async performHealthCheck(): Promise<void> {
  try {
    if (this.isInitializing) return;

    if (this.isClientReady && this.client) {
      const state = await Promise.race([
        this.client.getState(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 10000),
        ),
      ]);

      if (!state || state === 'CONFLICT' || state === 'UNLAUNCHED') {
        this.isClientReady = false;
        this.handleReconnection();
      }
    }
  } catch (error) {
    this.isClientReady = false;
    await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
    this.handleReconnection();
  }
}
```

### New Implementation (Baileys)
```typescript
private async performHealthCheck(): Promise<void> {
  try {
    if (this.isInitializing) return;

    if (this.isClientReady && this.socket) {
      // Check if socket is still connected
      const isConnected = this.socket.ws?.readyState === WebSocket.OPEN;

      if (!isConnected) {
        this.logger.warn('Socket not connected, triggering reconnection');
        this.isClientReady = false;
        await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
        this.handleReconnection();
        return;
      }

      // Try to get user info as a health check
      try {
        const userInfo = await Promise.race([
          this.socket.user,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 10000),
          ),
        ]);

        if (!userInfo) {
          this.logger.warn('Unable to retrieve user info, marking as disconnected');
          this.isClientReady = false;
          await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
          this.handleReconnection();
        }
      } catch (userInfoError) {
        this.logger.warn(`Health check failed: ${userInfoError.message}`);
        this.isClientReady = false;
        await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
        this.handleReconnection();
      }
    }
  } catch (error: any) {
    this.logger.error(`Health check error: ${error.message}`);
  }
}
```

---

## Example 8: Clean Shutdown with Baileys

### Old Implementation (whatsapp-web.js)
```typescript
private async destroyClient(): Promise<void> {
  if (this.client) {
    try {
      this.logger.log('Destroying WhatsApp client instance...');

      // Save session before destroying
      if (this.redisStore && this.isClientReady && process.env.WHATSAPP_USE_REMOTE_AUTH !== 'false') {
        try {
          await this.redisStore.save({ session: this.SESSION_NAME });
        } catch (saveError) {
          this.logger.error(`Failed to save session: ${saveError.message}`);
        }
      }

      // Destroy with timeout
      await Promise.race([
        this.client.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Destroy timeout')), 5000)),
      ]);

      this.logger.log('WhatsApp client destroyed successfully');
    } catch (error) {
      this.logger.error(`Error destroying client: ${error.message}`);
    } finally {
      this.client = null;
      this.isClientReady = false;
      this.isInitializing = false;
      this.currentQRCode = null;
      this.qrCodeGeneratedAt = null;
      await this.cacheService.del(this.CACHE_KEY_QR).catch(() => {});
      await this.killOrphanedChromeProcesses();
      this.logger.log('WhatsApp client cleanup completed');
    }
  }
}
```

### New Implementation (Baileys)
```typescript
private async destroyClient(): Promise<void> {
  if (this.socket) {
    try {
      this.logger.log('Destroying Baileys socket...');

      // Save credentials before destroying
      if (this.socket) {
        this.logger.log('Closing socket connection...');
      }

      // Close WebSocket with timeout
      await Promise.race([
        new Promise<void>(resolve => {
          if (this.socket?.ws) {
            this.socket.ws.close();
            // Wait for close or timeout
            const checkClosed = setInterval(() => {
              if (this.socket?.ws?.readyState === WebSocket.CLOSED) {
                clearInterval(checkClosed);
                resolve();
              }
            }, 100);
          } else {
            resolve();
          }
        }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Socket close timeout')), 5000),
        ),
      ]);

      // Emit logout event (graceful shutdown)
      if (this.socket?.ev) {
        this.socket.ev.emit('connection.update', { connection: 'close' });
      }

      this.logger.log('Baileys socket destroyed successfully');
    } catch (error) {
      this.logger.error(`Error destroying socket: ${error.message}`);
    } finally {
      this.socket = null;
      this.hasAuthenticatedOnce = false;
      this.isClientReady = false;
      this.isInitializing = false;
      this.currentQRCode = null;
      this.qrCodeGeneratedAt = null;

      // Clean up cache
      await this.cacheService.del(this.CACHE_KEY_QR).catch(() => {});

      // No need to kill Chrome processes (Baileys doesn't use browser)

      this.logger.log('Baileys socket cleanup completed');
    }
  }
}
```

---

## Example 9: Testing Events with Mocks

### Unit Test Example
```typescript
// whatsapp.service.spec.ts

describe('WhatsAppService - Baileys Events', () => {
  let service: WhatsAppService;
  let cacheService: CacheService;
  let eventEmitter: EventEmitter2;
  let mockSocket: any;

  beforeEach(() => {
    // Create mock socket
    mockSocket = {
      ev: {
        on: jest.fn(),
        emit: jest.fn(),
      },
      ws: { readyState: WebSocket.OPEN },
      user: { id: 'test@s.whatsapp.net' },
    };

    // Setup module
    eventEmitter = new EventEmitter2();
    cacheService = mock(CacheService);
    service = new WhatsAppService(eventEmitter, cacheService);
  });

  it('should handle QR code event', async () => {
    const qrString = 'test-qr-string';
    service['socket'] = mockSocket;

    await service['handleQRCode'](qrString);

    expect(eventEmitter.emit).toHaveBeenCalledWith('whatsapp.qr', {
      qr: qrString,
      timestamp: expect.any(Date),
    });
  });

  it('should handle connection open event', async () => {
    service['socket'] = mockSocket;

    await service['handleConnectionOpen']();

    expect(service.isReady()).toBe(true);
    expect(eventEmitter.emit).toHaveBeenCalledWith('whatsapp.ready', {
      timestamp: expect.any(Date),
    });
  });

  it('should handle credentials update for first authentication', async () => {
    service['socket'] = mockSocket;
    service['hasAuthenticatedOnce'] = false;

    await service['handleCredentialsUpdate']({ me: { id: 'test@s.whatsapp.net' } });

    expect(service['hasAuthenticatedOnce']).toBe(true);
    expect(eventEmitter.emit).toHaveBeenCalledWith('whatsapp.authenticated', {
      timestamp: expect.any(Date),
    });
  });

  it('should handle messages.upsert event', async () => {
    service['socket'] = mockSocket;
    const mockMessage: WAMessage = {
      key: {
        remoteJid: '5511999999999@c.us',
        fromMe: false,
        id: 'msg-123',
      },
      message: {
        conversation: 'Hello World',
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: 'John Doe',
    };

    await service['handleMessagesUpsert']({
      messages: [mockMessage],
      type: 'notify',
    });

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'whatsapp.message_create',
      expect.objectContaining({
        body: 'Hello World',
        fromMe: false,
        contactName: 'John Doe',
      }),
    );
  });
});
```

---

## Summary

These examples demonstrate:

1. **Complete event handler replacement** showing how all 8 whatsapp-web.js events map to Baileys events
2. **Socket initialization** replacing browser-based Client with WebSocket-based socket
3. **Message sending** with error handling specific to Baileys
4. **Storage integration** leveraging both native and Redis persistence
5. **Health checks** adapted for Baileys socket state
6. **Clean shutdown** without browser process management
7. **Unit tests** for validating event emission and payload structure

All examples maintain backward compatibility with existing downstream consumers by emitting the same event payloads to the NestJS EventEmitter2.
