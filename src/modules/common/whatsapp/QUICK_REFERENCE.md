# WhatsApp QR Code Service - Quick Reference

## Available Endpoints (All require ADMIN role)

### 1. Generate QR Code (Primary Admin Endpoint)
```
GET /whatsapp/admin/qr-code
```
Generates a new QR code for WhatsApp authentication. Use this endpoint to get a fresh QR code.

**Response Example:**
```json
{
  "success": true,
  "data": {
    "qr": "2@F8zN...",
    "generatedAt": "2026-01-05T16:14:00.000Z",
    "expiresAt": "2026-01-05T16:15:00.000Z",
    "expiryInSeconds": 59,
    "message": "Scan this QR code with WhatsApp mobile app within 60 seconds"
  }
}
```

### 2. Get Current QR Code
```
GET /whatsapp/qr
```
Returns the currently cached QR code (if available and not expired).

### 3. Check Authentication Status
```
GET /whatsapp/is-authenticated
```
Returns boolean indicating if WhatsApp is authenticated.

### 4. Get Connection Status (Detailed)
```
GET /whatsapp/connection-status
```
Returns comprehensive connection status with cache information.

### 5. Get Status (Basic)
```
GET /whatsapp/status
```
Returns basic connection status.

### 6. Send Message
```
POST /whatsapp/send
Content-Type: application/json

{
  "phone": "5511999999999",
  "message": "Your message here"
}
```

### 7. Disconnect
```
POST /whatsapp/disconnect
```
Disconnects the WhatsApp client.

### 8. Reconnect
```
POST /whatsapp/reconnect
```
Reconnects the WhatsApp client.

## Service Methods

### Public Methods

```typescript
// Initialize client
await whatsappService.initializeClient();

// Generate new QR code
const qrData = await whatsappService.generateQRCode();
// Returns: { qr: string, generatedAt: Date, expiresAt: Date }

// Get current QR code
const qrData = await whatsappService.getQRCode();
// Returns: { qr: string, generatedAt: Date, expiresAt: Date } | null

// Check authentication
const isAuth = whatsappService.isAuthenticated();
// Returns: boolean

// Get connection status
const status = await whatsappService.getConnectionStatus();
// Returns: { status, ready, initializing, hasQRCode, qrCodeExpiry, reconnectAttempts, lastUpdated }

// Send message
await whatsappService.sendMessage('5511999999999', 'Hello!');
// Returns: boolean

// Disconnect
await whatsappService.disconnect();

// Reconnect
await whatsappService.reconnect();
```

## Connection Status Values

- `DISCONNECTED` - Client is disconnected
- `CONNECTING` - Client is connecting
- `QR_READY` - QR code is ready for scanning
- `AUTHENTICATED` - Client is authenticated but not ready
- `READY` - Client is ready to send messages
- `AUTH_FAILURE` - Authentication failed

## Events Emitted

Listen to these events for real-time updates:

```typescript
eventEmitter.on('whatsapp.qr', (data) => {
  // QR code generated: { qr, timestamp }
});

eventEmitter.on('whatsapp.ready', (data) => {
  // Client ready: { timestamp }
});

eventEmitter.on('whatsapp.authenticated', (data) => {
  // Authenticated: { timestamp }
});

eventEmitter.on('whatsapp.disconnected', (data) => {
  // Disconnected: { reason, timestamp }
});

eventEmitter.on('whatsapp.message_sent', (data) => {
  // Message sent: { to, message, timestamp }
});
```

## Common Use Cases

### 1. Initial Setup
```bash
# 1. Generate QR code
curl http://localhost:3030/whatsapp/admin/qr-code \
  -H "Authorization: Bearer YOUR_TOKEN"

# 2. Scan QR code with WhatsApp mobile app

# 3. Check authentication
curl http://localhost:3030/whatsapp/is-authenticated \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Sending a Message
```bash
curl -X POST http://localhost:3030/whatsapp/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone": "5511999999999", "message": "Hello!"}'
```

### 3. Handling Disconnection
```bash
# 1. Check status
curl http://localhost:3030/whatsapp/connection-status \
  -H "Authorization: Bearer YOUR_TOKEN"

# 2. Reconnect if needed
curl -X POST http://localhost:3030/whatsapp/reconnect \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Generate new QR code if reconnection requires it
curl http://localhost:3030/whatsapp/admin/qr-code \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Environment Variables

```env
WHATSAPP_SESSION_PATH=.wwebjs_auth
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

## Troubleshooting

### QR Code Expired
- QR codes expire after 60 seconds
- Generate a new one using `/whatsapp/admin/qr-code`

### Client Not Ready
- Check status: `GET /whatsapp/connection-status`
- If disconnected, reconnect: `POST /whatsapp/reconnect`
- Generate new QR code if needed

### Authentication Failed
- Clear session: `rm -rf .wwebjs_auth`
- Reconnect: `POST /whatsapp/reconnect`
- Generate new QR code: `GET /whatsapp/admin/qr-code`

### Message Send Failed
- Verify client is ready: `GET /whatsapp/is-authenticated`
- Check phone number format (international format, no +)
- Verify number is registered on WhatsApp

## Important Notes

1. **Admin Only**: All endpoints require ADMIN role
2. **QR Code TTL**: QR codes expire after 60 seconds
3. **Session Persistence**: Sessions are saved in `.wwebjs_auth` directory
4. **Rate Limits**: WhatsApp has rate limits (~15-20 messages/minute)
5. **Phone Format**: Use international format without + (e.g., 5511999999999)
6. **Redis Required**: Service requires Redis for caching

## Integration Example

```typescript
import { Injectable } from '@nestjs/common';
import { WhatsAppService } from '@modules/common/whatsapp/whatsapp.service';

@Injectable()
export class MyService {
  constructor(private readonly whatsapp: WhatsAppService) {}

  async sendNotification(userId: string, message: string) {
    // Get user phone
    const user = await this.userService.findById(userId);

    // Check if authenticated
    if (!this.whatsapp.isAuthenticated()) {
      throw new Error('WhatsApp not authenticated');
    }

    // Send message
    await this.whatsapp.sendMessage(user.phone, message);
  }
}
```
