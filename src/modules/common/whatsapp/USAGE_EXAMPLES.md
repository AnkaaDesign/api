# WhatsApp Module - Usage Examples

## Basic Setup and Authentication

### 1. First Time Setup (QR Code Authentication)

```bash
# Start the application
npm run dev

# The WhatsApp service will automatically initialize
# Check logs for QR code in terminal, or use the API endpoint
```

#### Using API to Get QR Code

```bash
# Get QR code (requires admin token)
curl -X GET http://localhost:3030/whatsapp/qr \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Response:
```json
{
  "success": true,
  "data": {
    "qrCode": "2@XbN7F...",
    "message": "Scan this QR code with WhatsApp mobile app to authenticate"
  }
}
```

#### Scan QR Code Steps:
1. Open WhatsApp on your phone
2. Go to Settings > Linked Devices
3. Tap "Link a Device"
4. Scan the QR code from terminal or API response

### 2. Check Connection Status

```bash
curl -X GET http://localhost:3030/whatsapp/status \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Response when ready:
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

## Sending Messages

### Manual Send via API (Admin Testing)

```bash
# Send a test message
curl -X POST http://localhost:3030/whatsapp/send \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5511999999999",
    "message": "Hello from Ankaa API!"
  }'
```

Response:
```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

### Programmatic Send in Your Service

```typescript
import { Injectable } from '@nestjs/common';
import { WhatsAppService } from '@modules/common/whatsapp';

@Injectable()
export class NotificationService {
  constructor(private readonly whatsappService: WhatsAppService) {}

  async sendOrderNotification(customerPhone: string, orderId: string) {
    // Check if WhatsApp is ready
    if (!this.whatsappService.isReady()) {
      console.warn('WhatsApp client is not ready');
      return false;
    }

    try {
      const message = `Seu pedido #${orderId} foi confirmado! Obrigado por escolher a Ankaa.`;
      await this.whatsappService.sendMessage(customerPhone, message);
      return true;
    } catch (error) {
      console.error('Failed to send WhatsApp notification:', error);
      return false;
    }
  }

  async sendTaskReminder(userPhone: string, taskName: string, dueDate: string) {
    if (!this.whatsappService.isReady()) {
      return false;
    }

    try {
      const message = `Lembrete: A tarefa "${taskName}" vence em ${dueDate}. Não se esqueça!`;
      await this.whatsappService.sendMessage(userPhone, message);
      return true;
    } catch (error) {
      console.error('Failed to send task reminder:', error);
      return false;
    }
  }

  async sendBulkMessages(recipients: Array<{ phone: string; message: string }>) {
    if (!this.whatsappService.isReady()) {
      throw new Error('WhatsApp client is not ready');
    }

    const results = [];
    for (const recipient of recipients) {
      try {
        await this.whatsappService.sendMessage(recipient.phone, recipient.message);
        results.push({ phone: recipient.phone, success: true });

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({ phone: recipient.phone, success: false, error: error.message });
      }
    }

    return results;
  }
}
```

## Event Listening

### Subscribe to WhatsApp Events

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class WhatsAppEventHandler implements OnModuleInit {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  onModuleInit() {
    console.log('WhatsApp Event Handler initialized');
  }

  @OnEvent('whatsapp.ready')
  handleWhatsAppReady(payload: { timestamp: Date }) {
    console.log('WhatsApp is ready!', payload);
    // Send notification to admins
  }

  @OnEvent('whatsapp.disconnected')
  handleWhatsAppDisconnected(payload: { reason: string; timestamp: Date }) {
    console.error('WhatsApp disconnected:', payload);
    // Alert admins about disconnection
  }

  @OnEvent('whatsapp.message_sent')
  handleMessageSent(payload: { to: string; message: string; timestamp: Date }) {
    console.log('Message sent:', payload);
    // Log to database or analytics
  }

  @OnEvent('whatsapp.message_create')
  handleMessageReceived(payload: {
    messageId: string;
    from: string;
    to: string;
    body: string;
    fromMe: boolean;
    timestamp: Date;
  }) {
    if (!payload.fromMe) {
      console.log('Received message from:', payload.from, 'Body:', payload.body);
      // Process incoming messages
      // Could implement auto-replies, commands, etc.
    }
  }

  @OnEvent('whatsapp.auth_failure')
  handleAuthFailure(payload: { error: string; timestamp: Date }) {
    console.error('WhatsApp authentication failed:', payload);
    // Send urgent alert to admins
  }
}
```

## Connection Management

### Disconnect Client

```bash
curl -X POST http://localhost:3030/whatsapp/disconnect \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Reconnect Client

```bash
curl -X POST http://localhost:3030/whatsapp/reconnect \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## Integration Examples

### 1. Order Notification System

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsAppService } from '@modules/common/whatsapp';

@Injectable()
export class OrderNotificationService {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @OnEvent('order.created')
  async handleOrderCreated(order: { id: string; customerPhone: string; total: number }) {
    if (this.whatsappService.isReady()) {
      const message = `Pedido #${order.id} recebido!\nValor: R$ ${order.total.toFixed(2)}\nObrigado pela preferência!`;

      try {
        await this.whatsappService.sendMessage(order.customerPhone, message);
      } catch (error) {
        console.error('Failed to send order notification:', error);
      }
    }
  }

  @OnEvent('order.shipped')
  async handleOrderShipped(order: { id: string; customerPhone: string; trackingCode: string }) {
    if (this.whatsappService.isReady()) {
      const message = `Seu pedido #${order.id} foi enviado!\nCódigo de rastreamento: ${order.trackingCode}`;

      try {
        await this.whatsappService.sendMessage(order.customerPhone, message);
      } catch (error) {
        console.error('Failed to send shipping notification:', error);
      }
    }
  }
}
```

### 2. Task Management System

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WhatsAppService } from '@modules/common/whatsapp';
import { PrismaService } from '@modules/common/prisma';

@Injectable()
export class TaskReminderService {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDailyReminders() {
    if (!this.whatsappService.isReady()) {
      console.warn('WhatsApp not ready, skipping reminders');
      return;
    }

    // Get tasks due today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const tasksDueToday = await this.prisma.task.findMany({
      where: {
        dueDate: {
          gte: today,
          lt: tomorrow,
        },
        status: 'IN_PROGRESS',
      },
      include: {
        assignedTo: true,
      },
    });

    for (const task of tasksDueToday) {
      if (task.assignedTo?.phone) {
        try {
          const message = `Lembrete: Você tem uma tarefa vencendo hoje!\n\nTarefa: ${task.name}\nPrazo: ${task.dueDate.toLocaleDateString('pt-BR')}`;
          await this.whatsappService.sendMessage(task.assignedTo.phone, message);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Delay between messages
        } catch (error) {
          console.error(`Failed to send reminder for task ${task.id}:`, error);
        }
      }
    }
  }
}
```

### 3. Stock Alert System

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsAppService } from '@modules/common/whatsapp';

@Injectable()
export class StockAlertService {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @OnEvent('stock.low')
  async handleLowStock(data: { itemName: string; currentStock: number; minStock: number; adminPhone: string }) {
    if (this.whatsappService.isReady()) {
      const message = `ALERTA DE ESTOQUE BAIXO!\n\nProduto: ${data.itemName}\nEstoque atual: ${data.currentStock}\nEstoque mínimo: ${data.minStock}\n\nPor favor, realizar pedido urgente.`;

      try {
        await this.whatsappService.sendMessage(data.adminPhone, message);
      } catch (error) {
        console.error('Failed to send stock alert:', error);
      }
    }
  }

  @OnEvent('stock.out')
  async handleOutOfStock(data: { itemName: string; adminPhone: string }) {
    if (this.whatsappService.isReady()) {
      const message = `PRODUTO SEM ESTOQUE!\n\nProduto: ${data.itemName}\n\nEstoque zerado. Ação urgente necessária!`;

      try {
        await this.whatsappService.sendMessage(data.adminPhone, message);
      } catch (error) {
        console.error('Failed to send out-of-stock alert:', error);
      }
    }
  }
}
```

## Error Handling Examples

### Handling Rate Limits

```typescript
import { Injectable } from '@nestjs/common';
import { WhatsAppService } from '@modules/common/whatsapp';

@Injectable()
export class BulkMessageService {
  constructor(private readonly whatsappService: WhatsAppService) {}

  async sendBulkWithRetry(messages: Array<{ phone: string; message: string }>) {
    const results = [];

    for (const msg of messages) {
      let retries = 3;
      let success = false;

      while (retries > 0 && !success) {
        try {
          await this.whatsappService.sendMessage(msg.phone, msg.message);
          success = true;
          results.push({ phone: msg.phone, success: true });

          // Delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          if (error.message.includes('rate limit')) {
            retries--;
            if (retries > 0) {
              // Wait longer before retry
              await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
              results.push({ phone: msg.phone, success: false, error: 'Rate limit exceeded' });
            }
          } else {
            // Other error, don't retry
            results.push({ phone: msg.phone, success: false, error: error.message });
            break;
          }
        }
      }
    }

    return results;
  }
}
```

### Handling Disconnections

```typescript
import { Injectable } from '@nestjs/common';
import { WhatsAppService } from '@modules/common/whatsapp';

@Injectable()
export class RobustMessageService {
  constructor(private readonly whatsappService: WhatsAppService) {}

  async sendWithConnectionCheck(phone: string, message: string) {
    // Check if client is ready
    if (!this.whatsappService.isReady()) {
      throw new Error('WhatsApp client is not ready. Please check connection status.');
    }

    try {
      await this.whatsappService.sendMessage(phone, message);
      return { success: true };
    } catch (error) {
      // Check if it's a disconnection error
      if (error.message.includes('disconnected')) {
        // Trigger reconnection
        await this.whatsappService.reconnect();
        throw new Error('WhatsApp disconnected. Reconnection initiated. Please retry in a moment.');
      }

      throw error;
    }
  }
}
```

## Testing

### Testing the Service

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WhatsAppService } from './whatsapp.service';

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return status', () => {
    const status = service.getStatus();
    expect(status).toHaveProperty('ready');
    expect(status).toHaveProperty('initializing');
    expect(status).toHaveProperty('hasQRCode');
    expect(status).toHaveProperty('reconnectAttempts');
  });

  // Add more tests as needed
});
```

## Best Practices

### 1. Always Check Ready State

```typescript
if (this.whatsappService.isReady()) {
  await this.whatsappService.sendMessage(phone, message);
} else {
  // Handle not ready state
  console.warn('WhatsApp client is not ready');
}
```

### 2. Add Delays Between Messages

```typescript
for (const recipient of recipients) {
  await this.whatsappService.sendMessage(recipient.phone, message);
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
}
```

### 3. Handle Errors Gracefully

```typescript
try {
  await this.whatsappService.sendMessage(phone, message);
} catch (error) {
  console.error('WhatsApp send failed:', error.message);
  // Implement fallback (SMS, email, etc.)
}
```

### 4. Monitor Events

```typescript
@OnEvent('whatsapp.disconnected')
handleDisconnection() {
  // Alert admins
  // Log to monitoring system
}
```

### 5. Validate Phone Numbers

```typescript
const phoneRegex = /^\d{10,15}$/;
const cleanPhone = phone.replace(/\D/g, '');

if (!phoneRegex.test(cleanPhone)) {
  throw new Error('Invalid phone number format');
}
```

## Production Deployment

### Environment Setup

```bash
# Ensure session directory exists and has proper permissions
mkdir -p /home/kennedy/Documents/repositories/api/.wwebjs_auth
chmod 755 /home/kennedy/Documents/repositories/api/.wwebjs_auth

# Add to .gitignore
echo ".wwebjs_auth/" >> .gitignore
```

### Docker Considerations

If running in Docker, ensure Puppeteer dependencies are installed:

```dockerfile
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils
```

### Monitoring

Monitor these metrics:
- Connection uptime
- Message send success rate
- Reconnection frequency
- QR code generation events
- Error rates

## Troubleshooting Guide

See README.md for detailed troubleshooting steps.
