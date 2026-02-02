# WhatsApp Event Handler Migration Guide

## Project Context
- **Current Library**: whatsapp-web.js v1.34.4
- **Target Library**: Baileys (alternative WhatsApp library)
- **Service Location**: `/home/kennedy/Documents/repositories/api/src/modules/common/whatsapp/whatsapp.service.ts`
- **Secondary Service Location**: `/home/kennedy/Documents/repositories/api/src/modules/common/notification/whatsapp/whatsapp.service.ts`

---

## Part 1: Current Event Handlers in whatsapp.service.ts

### Documented Events (8 Total)

#### 1. **qr** Event
**Location**: Lines 496-531
**Purpose**: Fired when QR code is generated for authentication
**Payload**: `qr: string` (QR code string)
**Handler Actions**:
- Converts QR string to Base64 image using `QRCode.toDataURL()`
- Stores QR in memory cache (`this.currentQRCode`)
- Stores QR in Redis cache with 60-second expiry
- Updates connection status to `QR_READY`
- Displays QR code in terminal using `qrcode-terminal`
- Emits custom event: `whatsapp.qr` with `{ qr, timestamp }`

**Event Emitter Pattern Used**:
```typescript
this.eventEmitter.emit('whatsapp.qr', { qr, timestamp: new Date() });
```

---

#### 2. **ready** Event
**Location**: Lines 534-557
**Purpose**: Fired when client is ready to send/receive messages
**Payload**: None (event itself indicates readiness)
**Handler Actions**:
- Sets `isClientReady = true`
- Sets `isInitializing = false`
- Clears current QR code
- Clears QR code from cache
- Updates connection status to `READY`
- Starts session backup interval (5 minutes)
- Starts health check interval (30 seconds)
- Performs immediate session backup to Redis
- Emits custom event: `whatsapp.ready` with `{ timestamp }`

**Event Emitter Pattern Used**:
```typescript
this.eventEmitter.emit('whatsapp.ready', { timestamp: new Date() });
```

---

#### 3. **authenticated** Event
**Location**: Lines 560-573
**Purpose**: Fired when authentication is successful (before client is ready)
**Payload**: None
**Handler Actions**:
- Clears QR code from memory
- Clears QR code from cache
- Updates connection status to `AUTHENTICATED`
- Emits custom event: `whatsapp.authenticated` with `{ timestamp }`

**Event Emitter Pattern Used**:
```typescript
this.eventEmitter.emit('whatsapp.authenticated', { timestamp: new Date() });
```

---

#### 4. **auth_failure** Event
**Location**: Lines 576-590
**Purpose**: Fired when authentication fails
**Payload**: `error: string` (error message)
**Handler Actions**:
- Sets `isClientReady = false`
- Clears QR code from memory
- Clears QR code from cache
- Updates connection status to `AUTH_FAILURE`
- Emits custom event: `whatsapp.auth_failure` with `{ error, timestamp }`

**Event Emitter Pattern Used**:
```typescript
this.eventEmitter.emit('whatsapp.auth_failure', { error, timestamp: new Date() });
```

---

#### 5. **disconnected** Event
**Location**: Lines 593-611
**Purpose**: Fired when client disconnects
**Payload**: `reason: string` (disconnection reason)
**Handler Actions**:
- Sets `isClientReady = false`
- Sets `isInitializing = false`
- Clears QR code
- Clears QR code from cache
- Updates connection status to `DISCONNECTED`
- Emits custom event: `whatsapp.disconnected` with `{ reason, timestamp }`
- Initiates reconnection logic with exponential backoff

**Event Emitter Pattern Used**:
```typescript
this.eventEmitter.emit('whatsapp.disconnected', { reason, timestamp: new Date() });
```

---

#### 6. **message_create** Event
**Location**: Lines 614-638
**Purpose**: Fired when a message is created (sent or received)
**Payload**: `message: Message` (Message object from whatsapp-web.js)
**Handler Actions**:
- Retrieves contact information
- Retrieves chat information
- Logs message details (first 50 chars)
- Extracts relevant data: messageId, from, to, body, fromMe, hasMedia, chatName, contactName, timestamp
- Emits custom event: `whatsapp.message_create` with full message details

**Event Emitter Pattern Used**:
```typescript
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
```

---

#### 7. **remote_session_saved** Event
**Location**: Lines 646-664
**Purpose**: Fired when remote session (RemoteAuth) is saved
**Payload**: None
**Handler Actions**:
- Saves session to Redis store if using RemoteAuth
- Logs success or error
- Emits custom event: `whatsapp.session.saved` with `{ sessionName, timestamp }`

**Event Emitter Pattern Used**:
```typescript
this.eventEmitter.emit('whatsapp.session.saved', {
  sessionName: this.SESSION_NAME,
  timestamp: new Date(),
});
```

---

#### 8. **loading_screen** Event
**Location**: Lines 641-643
**Purpose**: Fired during client initialization with loading progress
**Payload**: `percent: number, message: string`
**Handler Actions**:
- Logs loading progress (only as debug level)
- No state changes
- No custom event emission

**Event Emitter Pattern Used**: None (only internal logging)

---

## Part 2: Baileys Library Events

### Core Events Provided by Baileys

Baileys provides a different event model compared to whatsapp-web.js. Here are the main events:

#### **connection.update**
**Fired**: When connection state changes
**Payload**:
```typescript
{
  connection?: 'open' | 'close',
  lastDisconnect?: {
    error?: Boom,
    date: Date
  },
  isNewLogin?: boolean,
  qr?: string,
  receivedPendingNotifications?: boolean,
  isBlockedByRateLimit?: boolean,
  // ... other connection state flags
}
```

**Use Cases**:
- Detects QR code (`qr` field present)
- Detects connection open/close
- Detects disconnection reasons
- Detects if login is new
- Detects rate limiting

---

#### **messages.upsert**
**Fired**: When messages are added/updated
**Payload**:
```typescript
{
  messages: WAMessage[],
  type: 'notify' | 'append' | 'prepend' | 'replace'
}
```

**Message Object Properties**:
- `key`: { remoteJid, fromMe, id }
- `message`: { conversation, extendedTextMessage, ... }
- `messageTimestamp`: number (Unix seconds)
- `pushName`: string (contact name)
- `status`: MessageStatus enum

**Use Cases**:
- Real-time message events (created, sent, received)
- Bulk message loading
- Message updates

---

#### **creds.update**
**Fired**: When authentication credentials change
**Payload**: `Partial<AuthenticationCreds>`

**Credentials Include**:
- `noiseKey`: Noise encryption key
- `signedIdentityKey`: Identity key pair
- `signedPreKey`: Pre-key with signature
- `registrationId`: Registration ID
- `advSecretKey`: Advanced security key
- `nextPreKeyId`: Next pre-key index
- `firstUnuploadedPreKeyId`: Pre-key upload tracker
- `accountSettings`: Account configuration
- `deviceId`: Device identifier
- `accountSyncCounter`: Sync counter
- `accountSettings`: Platform settings

**Use Cases**:
- Persisting authentication state
- Session recovery
- Backup/restore credentials

---

### Optional Events (Implementation-Specific)

Depending on Baileys implementation:
- `chats.upsert`: Chat list updates
- `chats.delete`: Chat deletions
- `messages.reaction`: Emoji reactions
- `messages.update`: Message status updates (read, delivery)
- `contacts.upsert`: Contact list updates
- `presence.update`: Online/offline status

---

## Part 3: Event Migration Mapping

### Mapping Table

| **Old Event (whatsapp-web.js)** | **New Event (Baileys)** | **Mapping Logic** | **Data Transformation** |
|---|---|---|---|
| **qr** | **connection.update** (with qr field) | Monitor `update.qr` field | `update.qr` → string (same format) |
| **ready** | **connection.update** (connection: 'open') | Monitor connection state + creds | Detect full initialization state |
| **authenticated** | **creds.update** | Credential change indicates auth | Detect first credential arrival |
| **auth_failure** | **connection.update** (lastDisconnect) | Monitor disconnection error codes | Extract error from `lastDisconnect.error` |
| **disconnected** | **connection.update** (connection: 'close') | Monitor connection close | Extract reason from `lastDisconnect` |
| **message_create** | **messages.upsert** (type: 'notify') | Monitor message additions | Extract message details from WAMessage |
| **remote_session_saved** | **creds.update** | Credential updates (auto-persisted) | Save credentials to storage (e.g., Redis) |
| **loading_screen** | **connection.update** | Progress metadata (if available) | No direct equivalent; implement custom logic |

---

## Part 4: Detailed Migration Patterns

### Pattern 1: QR Code Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('qr', async (qr: string) => {
  // qr is the QR string
  const qrImageDataURL = await QRCode.toDataURL(qr, {...});
  this.currentQRCode = qrImageDataURL;
  await this.cacheService.setObject(this.CACHE_KEY_QR, {...});
  await this.updateConnectionStatus(WhatsAppConnectionStatus.QR_READY);
  qrcode.generate(qr, { small: true });
  this.eventEmitter.emit('whatsapp.qr', { qr, timestamp: new Date() });
});
```

**New (Baileys)**:
```typescript
socket.ev.on('connection.update', async (update) => {
  if (update.qr) {
    // update.qr is the QR string (same format as whatsapp-web.js)
    const qrImageDataURL = await QRCode.toDataURL(update.qr, {...});
    this.currentQRCode = qrImageDataURL;
    await this.cacheService.setObject(this.CACHE_KEY_QR, {...});
    await this.updateConnectionStatus(WhatsAppConnectionStatus.QR_READY);
    qrcode.generate(update.qr, { small: true });
    this.eventEmitter.emit('whatsapp.qr', { qr: update.qr, timestamp: new Date() });
  }
});
```

**Key Differences**:
- QR string format is identical
- Consolidates to `connection.update` event
- Same processing pipeline

---

### Pattern 2: Ready Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('ready', async () => {
  this.isClientReady = true;
  this.isInitializing = false;
  // ... cleanup and backup
  this.startSessionBackupInterval();
  this.startHealthCheckInterval();
  await this.safeBackupSession();
  this.eventEmitter.emit('whatsapp.ready', { timestamp: new Date() });
});
```

**New (Baileys)**:
```typescript
socket.ev.on('connection.update', async (update) => {
  if (update.connection === 'open') {
    this.isClientReady = true;
    this.isInitializing = false;
    // ... cleanup and backup
    this.startSessionBackupInterval();
    this.startHealthCheckInterval();
    await this.safeBackupSession();
    this.eventEmitter.emit('whatsapp.ready', { timestamp: new Date() });
  }
});
```

**Key Differences**:
- Detect readiness via `connection: 'open'` in `connection.update`
- May need to combine with credential availability check
- Should verify `creds` are initialized before marking as ready

---

### Pattern 3: Authenticated Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('authenticated', async () => {
  this.currentQRCode = null;
  await this.cacheService.del(this.CACHE_KEY_QR);
  await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTHENTICATED);
  this.eventEmitter.emit('whatsapp.authenticated', { timestamp: new Date() });
});
```

**New (Baileys)**:
```typescript
socket.ev.on('creds.update', async (update) => {
  if (update && Object.keys(update).length > 0) {
    // First credential update indicates successful authentication
    if (!this.hasAuthenticatedOnce) {
      this.hasAuthenticatedOnce = true;
      this.currentQRCode = null;
      await this.cacheService.del(this.CACHE_KEY_QR);
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTHENTICATED);
      this.eventEmitter.emit('whatsapp.authenticated', { timestamp: new Date() });
    }

    // Save credentials to persistent storage
    await this.saveCredentials(update);
  }
});
```

**Key Differences**:
- Authentication happens when credentials first arrive
- Need to track if authenticated before to avoid duplicate events
- Combined with credential persistence
- No separate auth_failure event in Baileys; detect via connection close

---

### Pattern 4: Auth Failure Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('auth_failure', async error => {
  this.logger.error(`Authentication failure: ${error}`);
  this.isClientReady = false;
  await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);
  this.eventEmitter.emit('whatsapp.auth_failure', { error, timestamp: new Date() });
});
```

**New (Baileys)**:
```typescript
socket.ev.on('connection.update', async (update) => {
  if (update.connection === 'close') {
    const shouldReconnect = new BoomError(update?.lastDisconnect?.error).isAuthenticationFailure();

    if (shouldReconnect) {
      this.logger.error(`Authentication failure detected`);
      this.isClientReady = false;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.AUTH_FAILURE);
      this.eventEmitter.emit('whatsapp.auth_failure', {
        error: update.lastDisconnect?.error?.message || 'Authentication failed',
        timestamp: new Date()
      });
      // Clear credentials and require re-login
      await this.deleteSessionFromRedis();
    }
  }
});
```

**Key Differences**:
- Use Boom error class to detect auth failures
- Check `.isAuthenticationFailure()` method
- Combined with connection close detection
- May need to explicitly clear credentials

---

### Pattern 5: Disconnected Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('disconnected', async (reason: string) => {
  this.logger.warn(`WhatsApp client disconnected: ${reason}`);
  this.isClientReady = false;
  await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
  this.eventEmitter.emit('whatsapp.disconnected', { reason, timestamp: new Date() });
  this.handleReconnection();
});
```

**New (Baileys)**:
```typescript
socket.ev.on('connection.update', async (update) => {
  if (update.connection === 'close') {
    const error = update.lastDisconnect?.error;
    const isBoom = Boom.isBoom(error);
    const shouldReconnect = !(
      isBoom && error.output.statusCode === DisconnectReason.loggedOut
    );

    if (shouldReconnect && !isAuthFailure) {
      this.logger.warn(`WhatsApp disconnected: ${error?.message}`);
      this.isClientReady = false;
      await this.updateConnectionStatus(WhatsAppConnectionStatus.DISCONNECTED);
      this.eventEmitter.emit('whatsapp.disconnected', {
        reason: error?.message || 'Unknown',
        timestamp: new Date()
      });
      this.handleReconnection();
    }
  }
});
```

**Key Differences**:
- Detect disconnection via `connection: 'close'`
- Use Boom error utilities to classify disconnection type
- Check `DisconnectReason` enum for logout vs. network errors
- Extract reason from `lastDisconnect.error.message`

---

### Pattern 6: Message Create Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('message_create', async (message: Message) => {
  try {
    const contact = await message.getContact();
    const chat = await message.getChat();

    this.logger.log(`Message ${message.fromMe ? 'sent' : 'received'}: ...`);

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
```

**New (Baileys)**:
```typescript
socket.ev.on('messages.upsert', async (m) => {
  const { messages, type } = m;

  for (const msg of messages) {
    // Only process newly received/sent messages (not archived)
    if (type !== 'notify') return;

    try {
      const jid = msg.key.remoteJid;
      const fromMe = msg.key.fromMe;
      const body = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text || '';

      const contact = await socket.contactDB?.get(jid);
      const chat = await socket.chatDB?.get(jid);

      this.logger.log(`Message ${fromMe ? 'sent' : 'received'}: ...`);

      this.eventEmitter.emit('whatsapp.message_create', {
        messageId: msg.key.id,
        from: fromMe ? msg.key.remoteJid : msg.pushName,
        to: fromMe ? msg.key.remoteJid : msg.key.fromMe,
        body: body,
        fromMe: fromMe,
        hasMedia: !!msg.message?.mediaMessage,
        chatName: chat?.name || jid,
        contactName: msg.pushName || jid,
        timestamp: new Date((msg.messageTimestamp || 0) * 1000),
      });
    } catch (error) {
      this.logger.error(`Error processing message event: ${error.message}`);
    }
  }
});
```

**Key Differences**:
- Event payload is `{ messages: WAMessage[], type }` instead of single message
- Must iterate over `messages` array
- Filter by `type: 'notify'` for real-time events
- Extract text from nested `message` object structure
- `WAMessage` has different structure than `Message` class
- Contact/chat data may not be directly available; may need separate queries

---

### Pattern 7: Remote Session Saved Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('remote_session_saved', async () => {
  this.logger.log('Remote session saved event received');

  if (this.redisStore && process.env.WHATSAPP_USE_REMOTE_AUTH !== 'false') {
    try {
      await this.redisStore.save({ session: this.SESSION_NAME });
      this.logger.log('WhatsApp session backed up to Redis successfully');
    } catch (error) {
      this.logger.error(`Failed to backup session to Redis: ${error.message}`);
    }
  }

  this.eventEmitter.emit('whatsapp.session.saved', {
    sessionName: this.SESSION_NAME,
    timestamp: new Date(),
  });
});
```

**New (Baileys)**:
```typescript
socket.ev.on('creds.update', async (update) => {
  try {
    // Baileys auto-saves via the provided store
    // But we can emit our event when credentials update
    if (update && Object.keys(update).length > 0) {
      this.logger.log('Credentials updated, session backup completed');

      // Optional: Force save to Redis if using additional storage
      if (this.redisStore) {
        await this.redisStore.save({
          session: this.SESSION_NAME,
          credentials: update,
          timestamp: new Date()
        });
        this.logger.log('Session backed up to Redis');
      }

      this.eventEmitter.emit('whatsapp.session.saved', {
        sessionName: this.SESSION_NAME,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    this.logger.error(`Failed to backup session: ${error.message}`);
  }
});
```

**Key Differences**:
- Baileys handles credential persistence automatically via store
- `creds.update` is the equivalent event
- No explicit "save" API needed; store handles persistence
- Can layer additional storage (like Redis) on top

---

### Pattern 8: Loading Screen Event

**Old (whatsapp-web.js)**:
```typescript
this.client.on('loading_screen', (percent: number, message: string) => {
  this.logger.debug(`Loading: ${percent}% - ${message}`);
});
```

**New (Baileys)**:
```typescript
// Baileys doesn't have a direct loading_screen event
// Instead, implement custom loading tracking via connection.update:

socket.ev.on('connection.update', (update) => {
  if (!update.connection && !update.qr && !update.lastDisconnect) {
    // Likely in loading/connecting state
    this.logger.debug(`Connecting...`);
  }

  // Optionally emit custom event
  if (this.isInitializing) {
    this.eventEmitter.emit('whatsapp.loading_screen', {
      status: 'connecting',
      timestamp: new Date()
    });
  }
});
```

**Key Differences**:
- No native loading progress event in Baileys
- Track connection state implicitly
- Consider implementing progress via external metrics
- May need to add custom logic for loading animation

---

## Part 5: Event Emitter Patterns to Keep

### Pattern 1: NestJS EventEmitter2 Integration
**To Keep**: Yes (same interface)

```typescript
// Current approach works with both libraries
this.eventEmitter.emit('whatsapp.event_name', {
  // payload
  timestamp: new Date()
});
```

**Why Keep**:
- Works with both whatsapp-web.js and Baileys
- Already integrated with NestJS ecosystem
- Other modules depend on this pattern
- No code changes needed in consumer modules

---

### Pattern 2: Connection Status Enum
**To Keep**: Yes (with minor additions)

```typescript
export enum WhatsAppConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_READY = 'QR_READY',
  AUTHENTICATED = 'AUTHENTICATED',
  READY = 'READY',
  AUTH_FAILURE = 'AUTH_FAILURE',
}
```

**Why Keep**:
- Provides consistent status tracking across both libraries
- Used by connection status endpoints
- Familiar to frontend consumers

**Enhancements**:
- Add `LOGGED_OUT = 'LOGGED_OUT'` for explicit logout state
- Add `NETWORK_ERROR = 'NETWORK_ERROR'` for transient failures

---

### Pattern 3: State Flags
**To Keep**: Yes (with slight adjustments)

```typescript
private isClientReady = false;
private isInitializing = false;
private currentQRCode: string | null = null;
private qrCodeGeneratedAt: Date | null = null;
```

**Why Keep**:
- Simple, effective synchronous state tracking
- Used by health checks and reconnection logic
- Minimal overhead

**Adjustments**:
- Add `private hasAuthenticatedOnce = false` to track initial auth
- Add `private connectionState: WAConnectionState` for detailed Baileys state

---

### Pattern 4: Cache Integration
**To Keep**: Yes (identical pattern)

```typescript
await this.cacheService.setObject(
  this.CACHE_KEY_QR,
  { qr, generatedAt, expiresAt },
  Math.ceil(this.QR_CODE_EXPIRY_MS / 1000)
);
```

**Why Keep**:
- Exact same cache operations work with both libraries
- QR code format is identical
- No changes needed to cache layer

---

### Pattern 5: Session Backup Strategy
**To Keep**: Yes (with Baileys-native persistence)

**Current**: Use RedisStore + periodic backups
**Baileys**: Use Baileys built-in auth store + optional Redis layer

```typescript
// Keep the backup logic but let Baileys handle primary persistence
// Baileys will auto-save via provided store
socket.ev.on('creds.update', async (update) => {
  // Baileys already persisted it
  // Optionally layer Redis on top for multi-instance setups
  await this.redisStore?.save({ credentials: update });
});
```

**Why Keep**:
- Existing infrastructure depends on Redis persistence
- Multi-instance deployments need shared session state
- Baileys persistence can be primary, Redis as backup

---

### Pattern 6: Reconnection with Exponential Backoff
**To Keep**: Yes (works with both)

```typescript
private handleReconnection(): void {
  const baseDelay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);
  const delay = Math.min(baseDelay, 2 * 60 * 1000); // Cap at 2 minutes

  this.reconnectTimeout = setTimeout(async () => {
    await this.initializeClient();
  }, delay);
}
```

**Why Keep**:
- Works identically with both whatsapp-web.js and Baileys
- Prevents rapid reconnection storms
- Already well-tested

---

### Pattern 7: Health Check Mechanism
**To Keep**: Yes (adapt for Baileys)

**Current**:
```typescript
const state = await this.client.getState();
if (!state || state === 'CONFLICT' || state === 'UNLAUNCHED') {
  this.handleReconnection();
}
```

**New (Baileys)**:
```typescript
// Baileys has different state tracking
// Use connection.update + creds validity
if (!this.isClientReady || !this.credsAreValid) {
  this.handleReconnection();
}
```

**Why Keep**:
- Essential for detecting stale connections
- Prevents zombie client instances
- Already integrated with lifecycle hooks

---

### Pattern 8: Error Classification
**To Keep**: Yes (expand for Baileys errors)

```typescript
// Current approach - expand for Baileys error types
if (error.message.includes('not registered')) {
  return false; // Don't retry
}
if (error.message.includes('network')) {
  return true; // Retry
}
```

**Baileys-Specific Additions**:
```typescript
const isBoom = Boom.isBoom(error);
if (isBoom && error.output.statusCode === DisconnectReason.loggedOut) {
  return false; // Don't retry on logout
}
```

**Why Keep**:
- Same error classification philosophy works for both
- Baileys errors are more structured (Boom)
- Keep existing string-based checks, add Boom checks

---

## Part 6: Migration Implementation Checklist

### Phase 1: Preparation
- [ ] Create feature branch: `feature/baileys-migration`
- [ ] Add Baileys to dependencies
- [ ] Create `BaileysAdapter` wrapper class
- [ ] Add configuration for library selection (feature flag)
- [ ] Ensure both libraries can coexist temporarily

### Phase 2: Core Events
- [ ] Implement connection.update handler (covers qr, ready, disconnected)
- [ ] Implement creds.update handler (covers authenticated, session.saved)
- [ ] Update connection status enum
- [ ] Add state tracking for Baileys-specific states

### Phase 3: Message Handling
- [ ] Implement messages.upsert handler
- [ ] Extract message text from nested structure
- [ ] Emit whatsapp.message_create with same payload structure
- [ ] Test with real messages

### Phase 4: Storage & Persistence
- [ ] Create Baileys-compatible auth store interface
- [ ] Integrate with Redis for session persistence
- [ ] Implement credential backup/restore
- [ ] Test session persistence across restarts

### Phase 5: Quality Assurance
- [ ] Unit tests for all event handlers
- [ ] Integration tests with test WhatsApp account
- [ ] Error scenario testing (network failures, auth failures)
- [ ] Load testing (multiple messages, connections)
- [ ] Compare behavior with whatsapp-web.js

### Phase 6: Rollout
- [ ] Add feature flag to switch libraries
- [ ] Deploy to staging environment
- [ ] Monitor for 1 week
- [ ] Gradual rollout to production
- [ ] Keep whatsapp-web.js as fallback for 2-4 weeks

---

## Part 7: Code Structure Comparison

### Event Registration Old (whatsapp-web.js)
```typescript
// In setupEventHandlers()
this.client.on('qr', async (qr: string) => { ... });
this.client.on('ready', async () => { ... });
this.client.on('authenticated', async () => { ... });
this.client.on('auth_failure', async error => { ... });
this.client.on('disconnected', async (reason) => { ... });
this.client.on('message_create', async (message) => { ... });
this.client.on('remote_session_saved', async () => { ... });
this.client.on('loading_screen', (percent, message) => { ... });
```

### Event Registration New (Baileys)
```typescript
// In setupEventHandlers()
socket.ev.on('connection.update', async (update) => {
  // Handles: qr, ready, disconnected, connecting states
});

socket.ev.on('creds.update', async (update) => {
  // Handles: authenticated, session.saved
});

socket.ev.on('messages.upsert', async (m) => {
  // Handles: message_create
});

socket.ev.on('chats.upsert', async (chats) => {
  // Optional: for chat management
});
```

---

## Part 8: Migration-Specific Considerations

### Baileys Advantages
1. **Smaller footprint**: No Chromium/Puppeteer required
2. **Faster startup**: Direct WebSocket vs. browser automation
3. **Better stability**: Native WhatsApp Web protocol
4. **Lower resource usage**: No browser process management

### Baileys Challenges
1. **Less abstract API**: More low-level message structure
2. **Error handling**: Boom library errors require different handling
3. **State management**: More manual state tracking needed
4. **Library maturity**: Less widely used than whatsapp-web.js

### Data Structure Changes

| Aspect | whatsapp-web.js | Baileys |
|---|---|---|
| Message object | `Message` class with methods | WAMessage interface |
| Text extraction | `message.body` | `message.message.conversation` or `.extendedTextMessage.text` |
| Contact data | `message.getContact()` | Direct from message object |
| Chat data | `message.getChat()` | Separate event/query |
| Timestamp | `message.timestamp * 1000` | `message.messageTimestamp * 1000` |
| Message ID | `message.id._serialized` | `message.key.id` |

---

## Part 9: Testing Strategy

### Unit Tests to Create
1. Connection state transitions
2. QR code generation and storage
3. Message event parsing
4. Credential updates
5. Error classification

### Integration Tests to Create
1. Full authentication flow (QR → Ready)
2. Message send/receive cycle
3. Session persistence across restarts
4. Network failure recovery
5. Rate limiting behavior

### Test Scenarios
```typescript
// Test 1: QR Generation
await service.initializeClient();
expect(emit).toHaveBeenCalledWith('whatsapp.qr', expect.objectContaining({
  qr: expect.any(String),
  timestamp: expect.any(Date)
}));

// Test 2: Ready Event
// Simulate connection.update with connection: 'open'
socket.ev.emit('connection.update', { connection: 'open' });
expect(service.isReady()).toBe(true);

// Test 3: Message Processing
socket.ev.emit('messages.upsert', {
  messages: [{ key: {...}, message: {...}, timestamp: ... }],
  type: 'notify'
});
expect(emit).toHaveBeenCalledWith('whatsapp.message_create', expect.any(Object));
```

---

## Part 10: Summary

### Key Takeaways

1. **Event Consolidation**: whatsapp-web.js has 8 separate events; Baileys consolidates to 3 main events
2. **Same Consumer Interface**: NestJS EventEmitter2 remains unchanged for downstream consumers
3. **State Tracking**: Keep existing state flags; add Baileys-specific state tracking
4. **Gradual Migration**: Can implement both libraries in parallel with feature flag
5. **Persistence Layer**: Keep Redis integration; layer on top of Baileys native storage

### Event Mapping Summary Table

| Old Event | New Event | Status |
|---|---|---|
| qr | connection.update (qr field) | Direct mapping |
| ready | connection.update (connection: 'open') | Direct mapping |
| authenticated | creds.update | Direct mapping |
| auth_failure | connection.update (lastDisconnect) | Requires error classification |
| disconnected | connection.update (connection: 'close') | Direct mapping |
| message_create | messages.upsert (type: 'notify') | Requires structure extraction |
| remote_session_saved | creds.update | Direct mapping |
| loading_screen | No direct equivalent | Custom implementation needed |

### Effort Estimation
- Event handler migration: 3-4 days
- Storage/persistence layer: 2 days
- Testing & validation: 5-7 days
- Documentation & rollout: 2 days
- **Total: 2-3 weeks for production readiness**
