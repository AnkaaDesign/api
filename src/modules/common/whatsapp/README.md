# WhatsApp Module

A robust WhatsApp Web integration module using `whatsapp-web.js` (Puppeteer-based unofficial API).

## Features

- WhatsApp Web client initialization with session persistence
- QR code authentication
- Message sending capabilities
- Automatic reconnection with exponential backoff
- Event-driven architecture with EventEmitter2
- Admin-only access control
- Production-ready error handling
- Rate limit handling
- Invalid number detection

## Installation

The required dependencies are already installed:
- `whatsapp-web.js` - WhatsApp Web API client
- `qrcode-terminal` - QR code generation for terminal

## Configuration

### Session Storage

Session data is stored in `/home/kennedy/Documents/repositories/api/.wwebjs_auth/`

This directory contains:
- WhatsApp authentication session
- Browser profile data
- Cached credentials

### Environment Variables

No additional environment variables are required. The module uses default settings.

## Usage

### Import the Module

```typescript
import { WhatsAppModule } from '@modules/common/whatsapp';

@Module({
  imports: [WhatsAppModule],
})
export class AppModule {}
```

### Using the Service

```typescript
import { WhatsAppService } from '@modules/common/whatsapp';

@Injectable()
export class NotificationService {
  constructor(private readonly whatsappService: WhatsAppService) {}

  async sendNotification(phone: string, message: string) {
    if (this.whatsappService.isReady()) {
      await this.whatsappService.sendMessage(phone, message);
    } else {
      // Handle client not ready
      console.warn('WhatsApp client is not ready');
    }
  }
}
```

## API Endpoints

All endpoints require `ADMIN` privileges.

### GET /whatsapp/status

Get WhatsApp client connection status.

**Response:**
```json
{
  "success": true,
  "data": {
    "ready": true,
    "initializing": false,
    "hasQRCode": false,
    "reconnectAttempts": 0,
    "message": "WhatsApp client is connected and ready"
  }
}
```

### GET /whatsapp/qr

Get QR code for authentication. Scan with WhatsApp mobile app.

**Response:**
```json
{
  "success": true,
  "data": {
    "qrCode": "QR_CODE_STRING_HERE",
    "message": "Scan this QR code with WhatsApp mobile app to authenticate"
  }
}
```

**Error Cases:**
- Client already authenticated
- Failed to generate QR code

### POST /whatsapp/send

Send a WhatsApp message manually (admin testing).

**Request Body:**
```json
{
  "phone": "5511999999999",
  "message": "Hello from Ankaa API!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

**Validation:**
- Phone must be 10-15 digits (international format without +)
- Message is required and max 4096 characters

**Error Cases:**
- Client not ready
- Invalid phone number format
- Phone not registered on WhatsApp
- Rate limit exceeded

### POST /whatsapp/disconnect

Disconnect WhatsApp client.

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp client disconnected successfully"
}
```

### POST /whatsapp/reconnect

Reconnect WhatsApp client.

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp client reconnection initiated. Check status endpoint for connection progress."
}
```

## Service Methods

### sendMessage(phone: string, message: string): Promise<boolean>

Send a WhatsApp message.

**Parameters:**
- `phone` - Phone number in international format (e.g., 5511999999999)
- `message` - Message text

**Returns:** Promise<boolean> indicating success

**Throws:**
- Client not ready
- Invalid phone number
- Phone not registered on WhatsApp
- Rate limit exceeded

### isReady(): boolean

Check if WhatsApp client is ready to send messages.

**Returns:** boolean

### getQRCode(): Promise<string>

Get current QR code for authentication.

**Returns:** Promise<string> with QR code

**Throws:**
- Client already authenticated
- Failed to generate QR code

### getStatus(): object

Get client connection status.

**Returns:**
```typescript
{
  ready: boolean;
  initializing: boolean;
  hasQRCode: boolean;
  reconnectAttempts: number;
}
```

### disconnect(): Promise<void>

Disconnect the WhatsApp client.

### reconnect(): Promise<void>

Reconnect the WhatsApp client.

## Events

The service emits events via EventEmitter2 for notification tracking:

### whatsapp.qr
Fired when QR code is generated.
```typescript
{
  qr: string;
  timestamp: Date;
}
```

### whatsapp.ready
Fired when client is ready.
```typescript
{
  timestamp: Date;
}
```

### whatsapp.authenticated
Fired when authentication is successful.
```typescript
{
  timestamp: Date;
}
```

### whatsapp.auth_failure
Fired on authentication failure.
```typescript
{
  error: string;
  timestamp: Date;
}
```

### whatsapp.disconnected
Fired when client disconnects.
```typescript
{
  reason: string;
  timestamp: Date;
}
```

### whatsapp.message_create
Fired when a message is sent or received.
```typescript
{
  messageId: string;
  from: string;
  to: string;
  body: string;
  fromMe: boolean;
  hasMedia: boolean;
  chatName: string;
  contactName: string;
  timestamp: Date;
}
```

### whatsapp.message_sent
Fired when a message is sent successfully.
```typescript
{
  to: string;
  message: string;
  timestamp: Date;
}
```

### whatsapp.manual_disconnect
Fired on manual disconnect.
```typescript
{
  timestamp: Date;
}
```

### whatsapp.manual_reconnect
Fired on manual reconnect.
```typescript
{
  timestamp: Date;
}
```

## Reconnection Logic

The service implements automatic reconnection with exponential backoff:

- Maximum reconnect attempts: 5
- Base delay: 5 seconds
- Exponential backoff: delay * 2^(attempt - 1)
- Delays: 5s, 10s, 20s, 40s, 80s

After 5 failed attempts, manual intervention is required.

## Error Handling

### Rate Limits
When rate limit is exceeded, the service throws:
```
Rate limit exceeded. Please try again later.
```

### Disconnections
If client disconnects during send:
```
WhatsApp client disconnected. Please reconnect and try again.
```

### Invalid Numbers
If phone number is not on WhatsApp:
```
Phone number is not registered on WhatsApp
```

### Invalid Format
If phone number format is invalid:
```
Invalid phone number format. Use international format without + or spaces (e.g., 5511999999999)
```

## Production Considerations

### Session Persistence
- Sessions are stored in `.wwebjs_auth/`
- Backup this directory to avoid re-authentication
- Add to `.gitignore`

### Puppeteer Configuration
The service uses optimized Puppeteer args:
- `--no-sandbox`
- `--disable-setuid-sandbox`
- `--disable-dev-shm-usage`
- `--disable-accelerated-2d-canvas`
- `--no-first-run`
- `--no-zygote`
- `--disable-gpu`

These args ensure compatibility with containerized environments.

### Singleton Pattern
The service uses a singleton pattern for the WhatsApp client to ensure only one instance exists per application.

### Logging
All events and errors are logged using NestJS Logger with proper log levels.

### Privacy
Phone numbers are masked in logs (e.g., 55****99) for privacy.

## Monitoring

Monitor these events for health checks:
- `whatsapp.ready` - Client is operational
- `whatsapp.disconnected` - Client needs attention
- `whatsapp.auth_failure` - Authentication issues

## Troubleshooting

### QR Code Not Generated
1. Check if client is already authenticated
2. Try disconnecting and reconnecting
3. Check logs for initialization errors

### Messages Not Sending
1. Verify client is ready: `GET /whatsapp/status`
2. Check if phone number is registered on WhatsApp
3. Verify phone number format
4. Check for rate limiting

### Client Keeps Disconnecting
1. Check network connectivity
2. Verify WhatsApp Web is not open on other devices
3. Check Puppeteer logs for browser issues
4. Ensure session directory has proper permissions

### Session Lost
1. Check if `.wwebjs_auth/` directory exists
2. Verify directory permissions
3. Re-authenticate by scanning QR code

## Security

- All endpoints require `ADMIN` privileges
- Phone numbers are validated before sending
- Session data is stored securely
- Rate limiting is handled automatically
- Suspicious patterns are logged

## License

This module is part of the Ankaa API system.
