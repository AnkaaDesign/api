# Real-Time Notification Gateway Documentation

## Overview

The Notification Gateway provides real-time, bidirectional communication between the server and clients using Socket.io. It enables instant delivery of notifications to users without polling, supporting features like:

- JWT-based authentication
- User-to-socket mapping for targeted notifications
- Sector-based broadcasting
- Online/offline user tracking
- Multiple device support per user
- Different notification event types

## Architecture

### Files Structure

```
notification/
├── notification.gateway.ts           # WebSocket gateway implementation
├── notification-gateway.service.ts   # Injectable service wrapper
├── notification.service.ts           # Business logic with real-time integration
└── notification.module.ts            # Module configuration
```

### Components

1. **NotificationGateway** - Handles WebSocket connections, authentication, and room management
2. **NotificationGatewayService** - Provides a clean API for other services to send notifications
3. **NotificationService** - Existing service enhanced with real-time capabilities

## WebSocket Connection

### Endpoint

```
ws://localhost:3030/notifications
```

Or in production:
```
wss://your-domain.com/notifications
```

### Authentication

The gateway supports three authentication methods:

#### 1. Query Parameter (Recommended for Web)
```javascript
const socket = io('http://localhost:3030/notifications', {
  query: {
    token: 'your-jwt-token'
  }
});
```

#### 2. Authorization Header
```javascript
const socket = io('http://localhost:3030/notifications', {
  extraHeaders: {
    Authorization: 'Bearer your-jwt-token'
  }
});
```

#### 3. Auth Object
```javascript
const socket = io('http://localhost:3030/notifications', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

## Client Integration

### JavaScript/TypeScript Example

```typescript
import { io, Socket } from 'socket.io-client';

class NotificationClient {
  private socket: Socket;

  constructor(token: string) {
    this.socket = io('http://localhost:3030/notifications', {
      query: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.setupListeners();
  }

  private setupListeners() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to notification server');
    });

    this.socket.on('connection:success', (data) => {
      console.log('Authenticated:', data);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    // Notification events
    this.socket.on('notification:new', (notification) => {
      console.log('New notification:', notification);
      this.handleNewNotification(notification);
    });

    this.socket.on('notification:update', (notification) => {
      console.log('Notification updated:', notification);
      this.handleNotificationUpdate(notification);
    });

    this.socket.on('notification:delete', (data) => {
      console.log('Notification deleted:', data.id);
      this.handleNotificationDelete(data.id);
    });

    this.socket.on('notification:seen', (data) => {
      console.log('Notification seen:', data);
      this.handleNotificationSeen(data);
    });
  }

  // Mark notification as seen
  markAsSeen(notificationId: string) {
    return new Promise((resolve, reject) => {
      this.socket.emit('notification:seen', { notificationId }, (response) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(response.error);
        }
      });
    });
  }

  // Request notification reminder
  requestReminder(notificationId: string) {
    return new Promise((resolve, reject) => {
      this.socket.emit('notification:remind', { notificationId }, (response) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(response.error);
        }
      });
    });
  }

  // Handler methods
  private handleNewNotification(notification: any) {
    // Show toast/notification UI
    // Update notification list
    // Play sound/vibration
  }

  private handleNotificationUpdate(notification: any) {
    // Update existing notification in UI
  }

  private handleNotificationDelete(notificationId: string) {
    // Remove notification from UI
  }

  private handleNotificationSeen(data: any) {
    // Mark notification as read in UI
  }

  disconnect() {
    this.socket.disconnect();
  }
}

// Usage
const token = 'your-jwt-token';
const notificationClient = new NotificationClient(token);

// Mark notification as seen
notificationClient.markAsSeen('notification-id-123')
  .then(() => console.log('Marked as seen'))
  .catch(err => console.error('Failed to mark as seen:', err));
```

### React Example

```tsx
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export function useNotifications(token: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('http://localhost:3030/notifications', {
      query: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('notification:new', (notification) => {
      setNotifications(prev => [notification, ...prev]);
      // Show toast notification
    });

    newSocket.on('notification:update', (notification) => {
      setNotifications(prev =>
        prev.map(n => n.id === notification.id ? notification : n)
      );
    });

    newSocket.on('notification:delete', (data) => {
      setNotifications(prev => prev.filter(n => n.id !== data.id));
    });

    newSocket.on('notification:seen', (data) => {
      setNotifications(prev =>
        prev.map(n =>
          n.id === data.notificationId
            ? { ...n, seenAt: data.seenAt }
            : n
        )
      );
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  const markAsSeen = (notificationId: string) => {
    if (socket) {
      socket.emit('notification:seen', { notificationId });
    }
  };

  const requestReminder = (notificationId: string) => {
    if (socket) {
      socket.emit('notification:remind', { notificationId });
    }
  };

  return {
    socket,
    notifications,
    isConnected,
    markAsSeen,
    requestReminder,
  };
}

// Component usage
function NotificationBell() {
  const token = localStorage.getItem('authToken');
  const { notifications, isConnected, markAsSeen } = useNotifications(token);

  return (
    <div>
      <div className="status">
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>
      <div className="notifications">
        {notifications.map(notification => (
          <div key={notification.id} onClick={() => markAsSeen(notification.id)}>
            <h4>{notification.title}</h4>
            <p>{notification.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Server-Side Usage

### Sending Notifications

#### From Any Service

```typescript
import { Injectable } from '@nestjs/common';
import { NotificationGatewayService } from '@modules/common/notification/notification-gateway.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly notificationGatewayService: NotificationGatewayService,
  ) {}

  async assignTask(taskId: string, userId: string) {
    // ... business logic ...

    // Send real-time notification
    this.notificationGatewayService.sendToUser(userId, {
      id: taskId,
      title: 'New Task Assigned',
      body: 'You have been assigned a new task',
      type: 'task',
      actionUrl: `/tasks/${taskId}`,
      createdAt: new Date(),
    });
  }
}
```

#### Broadcasting to Sectors

```typescript
// Send notification to all users in specific sectors
this.notificationGatewayService.broadcastToSectors(
  ['sector-id-1', 'sector-id-2'],
  {
    title: 'Sector Meeting',
    body: 'Team meeting at 3 PM today',
    importance: 'HIGH',
  }
);
```

#### Broadcasting to All Users

```typescript
// Send notification to all connected users
this.notificationGatewayService.broadcastToAll({
  title: 'System Maintenance',
  body: 'System will be down for maintenance at 2 AM',
  importance: 'URGENT',
});
```

### Checking User Status

```typescript
// Check if user is online
const isOnline = this.notificationGatewayService.isUserOnline('user-id');

// Get number of user's active connections
const connectionCount = this.notificationGatewayService.getUserConnectionCount('user-id');

// Get total online users count
const onlineCount = this.notificationGatewayService.getOnlineUsersCount();

// Get all online user IDs
const onlineUsers = this.notificationGatewayService.getOnlineUsers();

// Get gateway statistics
const stats = this.notificationGatewayService.getGatewayStats();
// Returns: { onlineUsers, totalConnections, averageConnectionsPerUser }
```

## Event Types

### Server to Client Events

| Event | Description | Payload |
|-------|-------------|---------|
| `connection:success` | Sent when client successfully authenticates | `{ userId, userName, connectedAt }` |
| `notification:new` | New notification created | Full notification object |
| `notification:update` | Notification updated | Updated notification object |
| `notification:delete` | Notification deleted | `{ id, type: 'notification:delete', deletedAt }` |
| `notification:seen` | Notification marked as seen | `{ id, type: 'notification:seen', seenAt }` |

### Client to Server Events

| Event | Description | Payload | Response |
|-------|-------------|---------|----------|
| `notification:seen` | Mark notification as seen | `{ notificationId }` | `{ success, notificationId }` |
| `notification:remind` | Request notification reminder | `{ notificationId }` | `{ success, notificationId }` |

## Room Structure

The gateway automatically manages rooms for efficient message delivery:

### User Rooms
- Format: `user:{userId}`
- Purpose: Send notifications to specific user across all their devices
- Auto-join: User joins their room on connection

### Sector Rooms
- Format: `sector:{sectorId}`
- Purpose: Broadcast notifications to all users in a sector
- Auto-join: User joins their sector room if they have a sector assigned

## Error Handling

### Connection Errors

```typescript
socket.on('connect_error', (error) => {
  console.error('Connection failed:', error.message);

  // Common errors:
  // - 'Invalid token' - JWT verification failed
  // - 'User not found' - User doesn't exist
  // - 'User inactive' - User account is deactivated
});
```

### Reconnection

The client automatically handles reconnection with exponential backoff:

```typescript
const socket = io('http://localhost:3030/notifications', {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});
```

## Security

### Authentication
- All connections require valid JWT token
- Token is verified on every connection
- User must exist and be active
- Invalid tokens result in immediate disconnection

### Authorization
- Users can only receive notifications intended for them
- Sector rooms only accessible to users in that sector
- User rooms are private to each user

## Performance Considerations

### Multiple Devices
- Users can connect from multiple devices simultaneously
- Each device gets its own socket connection
- Notifications are delivered to all user's devices
- User is marked offline only when all connections close

### Scalability
- Gateway uses in-memory maps for user-socket tracking
- For horizontal scaling, consider using Redis adapter:

```typescript
// Future enhancement for multi-server setup
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));
```

## Monitoring

### Logging

The gateway logs all important events:

```
[NotificationGateway] Notification WebSocket Gateway initialized
[NotificationGateway] Client connected: ABC123 | User: John Doe (user-id-123) | Total connections: 1
[NotificationGateway] User John Doe (user-id-123) joined sector room: sector:sector-id-456
[NotificationGateway] Notification sent to user user-id-123 (2 devices) | Event: notification:new
[NotificationGateway] Client disconnected: ABC123 | User: user-id-123 | Remaining connections: 1
[NotificationGateway] User user-id-123 is now offline (all connections closed)
```

### Health Check Endpoint

You can add a health check endpoint to monitor gateway status:

```typescript
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationGatewayService: NotificationGatewayService,
  ) {}

  @Get('stats')
  getGatewayStats() {
    return this.notificationGatewayService.getGatewayStats();
  }

  @Get('online-users')
  getOnlineUsers() {
    return {
      count: this.notificationGatewayService.getOnlineUsersCount(),
      users: this.notificationGatewayService.getOnlineUsers(),
    };
  }
}
```

## Testing

### Manual Testing with Socket.io Client

```bash
npm install -g socket.io-client-cli

# Connect to gateway
socket.io-client-cli http://localhost:3030/notifications --query token=your-jwt-token

# Listen for events
> on notification:new

# Emit events
> emit notification:seen { "notificationId": "test-123" }
```

### Unit Testing

```typescript
import { Test } from '@nestjs/testing';
import { NotificationGateway } from './notification.gateway';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from '@modules/people/user/repositories/user.repository';

describe('NotificationGateway', () => {
  let gateway: NotificationGateway;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NotificationGateway,
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn() },
        },
        {
          provide: UserRepository,
          useValue: { findById: jest.fn() },
        },
      ],
    }).compile();

    gateway = module.get<NotificationGateway>(NotificationGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  // Add more tests...
});
```

## Troubleshooting

### Client Cannot Connect

1. Check if the server is running and accessible
2. Verify JWT token is valid and not expired
3. Check CORS configuration if connecting from web app
4. Ensure user account exists and is active

### Notifications Not Received

1. Verify client is connected (`socket.connected` should be `true`)
2. Check if correct event listener is registered
3. Verify user is in the correct room (for sector broadcasts)
4. Check server logs for delivery errors

### Performance Issues

1. Monitor number of connections per user
2. Check for socket leaks (connections not properly closed)
3. Review notification payload sizes
4. Consider implementing message batching for high-frequency updates

## Best Practices

1. **Always handle disconnections** - Implement reconnection logic
2. **Use acknowledgments** - For critical notifications, use callbacks
3. **Validate payloads** - Validate data on both client and server
4. **Handle errors gracefully** - Don't crash on connection errors
5. **Clean up listeners** - Remove event listeners when components unmount
6. **Use rooms efficiently** - Leverage rooms for targeted broadcasting
7. **Monitor performance** - Track connection counts and message rates
8. **Implement fallbacks** - Have a polling fallback if WebSocket fails

## Future Enhancements

- [ ] Redis adapter for horizontal scaling
- [ ] Message persistence for offline users
- [ ] Delivery receipts and read confirmations
- [ ] Push notification integration (FCM, APNs)
- [ ] Rate limiting per user
- [ ] Message priority queues
- [ ] Notification categories and filtering
- [ ] Analytics and metrics dashboard
