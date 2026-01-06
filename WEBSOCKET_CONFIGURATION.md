# WebSocket Configuration Guide

## Overview

The API uses Socket.io for real-time WebSocket communication, primarily for the notification system. Socket.io is configured with CORS, JWT authentication, and multiple transport protocols.

## Configuration Summary

### Socket.io Server Settings

The Socket.io server is configured in `/home/kennedy/Documents/repositories/api/src/main.ts` using a custom `SocketIoAdapter`:

```typescript
class SocketIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions): any {
    const serverOptions: ServerOptions = {
      cors: {
        origin: securityConfig.cors.origin,
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
      transports: ['websocket', 'polling'],
      path: '/socket.io',
      pingTimeout: 60000,
      pingInterval: 25000,
      upgradeTimeout: 10000,
      maxHttpBufferSize: 1e6,
      allowEIO3: true,
      cookie: false,
    };
    return super.createIOServer(port, serverOptions);
  }
}
```

### Key Configuration Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Path** | `/socket.io` | Socket.io endpoint path |
| **Transports** | `['websocket', 'polling']` | WebSocket preferred, HTTP long-polling fallback |
| **CORS Origins** | From `securityConfig.cors.origin` | Allowed frontend origins |
| **Credentials** | `true` | Allow credentials in CORS requests |
| **Ping Timeout** | 60000ms (60s) | Time to wait for ping response before disconnecting |
| **Ping Interval** | 25000ms (25s) | Interval between ping packets |
| **Max Buffer Size** | 1MB | Maximum HTTP buffer size for messages |
| **Cookie** | `false` | JWT authentication used instead of cookies |

---

## WebSocket Endpoints

### Base URL Structure

- **Development**: `http://localhost:3030/socket.io`
- **Staging**: `https://api.staging.ankaa.live/socket.io`
- **Production**: `https://api.ankaa.live/socket.io`

### Namespaces

#### 1. Notifications Namespace
- **Path**: `/notifications`
- **Full URL**: `{BASE_URL}/socket.io?namespace=/notifications`
- **Purpose**: Real-time notification delivery
- **Authentication**: Required (JWT)
- **Gateway File**: `/home/kennedy/Documents/repositories/api/src/modules/common/notification/notification.gateway.ts`

---

## CORS Configuration

CORS for WebSocket connections is configured to match the HTTP API CORS settings from `/home/kennedy/Documents/repositories/api/src/common/config/security.config.ts`.

### Allowed Origins

**Development:**
- `http://localhost:3000`
- `http://localhost:5173` - `http://localhost:5177`
- `http://192.168.0.13:*` (local network)
- Other configured development URLs

**Production/Staging:**
- `https://ankaa.live`
- `https://www.ankaa.live`
- `https://staging.ankaa.live`
- Environment variable `CLIENT_HOST`

### CORS Settings

```javascript
cors: {
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}
```

---

## JWT Authentication

### Authentication Flow

1. **Client obtains JWT token** from the login endpoint
2. **Client connects to WebSocket** with token in handshake
3. **Server validates token** and verifies user
4. **Connection established** with user context
5. **Client subscribed** to appropriate rooms (user, sector, admin)

### Token Transmission Methods

The gateway supports three methods for passing the JWT token:

#### 1. Query Parameter (Recommended for browsers)
```javascript
const socket = io('http://localhost:3030/notifications', {
  query: { token: 'YOUR_JWT_TOKEN' }
});
```

#### 2. Authorization Header
```javascript
const socket = io('http://localhost:3030/notifications', {
  extraHeaders: {
    Authorization: 'Bearer YOUR_JWT_TOKEN'
  }
});
```

#### 3. Auth Object (Socket.io v3+)
```javascript
const socket = io('http://localhost:3030/notifications', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});
```

### Authentication Validation

The gateway performs the following checks:

1. **Token presence**: Rejects if no token provided
2. **Token validity**: Verifies JWT signature with `JWT_SECRET`
3. **User existence**: Checks if user exists in database
4. **User status**: Verifies user is active (`isActive: true`)

If any check fails, the connection is immediately disconnected.

---

## Notification Gateway Features

Located at: `/home/kennedy/Documents/repositories/api/src/modules/common/notification/notification.gateway.ts`

### Connection Features

- **Multi-device support**: Users can connect from multiple devices
- **Automatic room subscriptions**: Personal, sector, and admin rooms
- **Pending notifications**: Sent automatically on connection
- **Unread count**: Sent on connection and updates
- **Connection confirmation**: `connection:success` event emitted

### Room Structure

#### Personal Room
- **Format**: `user:{userId}`
- **Purpose**: Direct notifications to specific user
- **Auto-join**: Yes, on connection

#### Sector Room
- **Format**: `sector:{sectorId}`
- **Purpose**: Broadcast to all users in a sector
- **Auto-join**: If user has `sectorId`

#### Admin Room
- **Format**: `admin`
- **Purpose**: Broadcast to all admins
- **Auto-join**: If user role is `ADMIN` or `SUPER_ADMIN`

### Events Emitted to Clients

| Event | Description | Payload |
|-------|-------------|---------|
| `connection:success` | Successful connection confirmation | `{ userId, userName, connectedAt, unreadCount }` |
| `notification:new` | New notification created | Notification object |
| `notification:read` | Notification marked as read | `{ notificationId, readAt }` |
| `notification:delivered` | Notification delivered via socket | Notification object |
| `notification:count` | Unread notification count update | `{ count }` |

### Events Received from Clients

| Event | Description | Payload | Response |
|-------|-------------|---------|----------|
| `mark.read` | Mark notification as read | `{ notificationId }` | `{ success, notificationId?, error? }` |
| `mark.delivered` | Acknowledge notification delivery | `{ notificationId }` | `{ success, notificationId?, error? }` |
| `notification:seen` | (Deprecated) Legacy read event | `{ notificationId }` | Same as `mark.read` |
| `notification:remind` | Request notification reminder | `{ notificationId }` | `{ success, notificationId }` |

---

## Client Integration Examples

### JavaScript/TypeScript (Browser)

```typescript
import { io, Socket } from 'socket.io-client';

// Get JWT token from your auth system
const token = localStorage.getItem('jwt_token');

// Connect to notifications namespace
const socket: Socket = io('http://localhost:3030/notifications', {
  transports: ['websocket', 'polling'],
  query: { token },
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// Connection events
socket.on('connect', () => {
  console.log('Connected to WebSocket');
});

socket.on('connection:success', (data) => {
  console.log('Authentication successful:', data);
  console.log('Unread count:', data.unreadCount);
});

socket.on('disconnect', () => {
  console.log('Disconnected from WebSocket');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});

// Notification events
socket.on('notification:new', (notification) => {
  console.log('New notification:', notification);

  // Acknowledge delivery
  socket.emit('mark.delivered', { notificationId: notification.id });

  // Display notification to user
  displayNotification(notification);
});

socket.on('notification:count', (data) => {
  console.log('Unread count:', data.count);
  updateBadgeCount(data.count);
});

socket.on('notification:read', (data) => {
  console.log('Notification read:', data.notificationId);
  updateNotificationUI(data.notificationId, 'read');
});

// Mark notification as read
function markAsRead(notificationId: string) {
  socket.emit('mark.read', { notificationId }, (response) => {
    if (response.success) {
      console.log('Notification marked as read');
    } else {
      console.error('Failed to mark as read:', response.error);
    }
  });
}
```

### React Example

```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

function useNotifications(token: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!token) return;

    const newSocket = io('http://localhost:3030/notifications', {
      query: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
    });

    newSocket.on('connection:success', (data) => {
      setUnreadCount(data.unreadCount);
    });

    newSocket.on('notification:new', (notification) => {
      setNotifications((prev) => [notification, ...prev]);

      // Acknowledge delivery
      newSocket.emit('mark.delivered', { notificationId: notification.id });
    });

    newSocket.on('notification:count', (data) => {
      setUnreadCount(data.count);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token]);

  const markAsRead = (notificationId: string) => {
    if (socket) {
      socket.emit('mark.read', { notificationId });
    }
  };

  return { socket, notifications, unreadCount, markAsRead };
}
```

### React Native Example

```typescript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useNotificationSocket(jwtToken: string) {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!jwtToken) return;

    const socketInstance = io('https://api.ankaa.live/notifications', {
      transports: ['websocket', 'polling'],
      query: { token: jwtToken },
      reconnection: true,
    });

    socketInstance.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to notifications');
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    socketInstance.on('connection:success', (data) => {
      setUnreadCount(data.unreadCount);
    });

    socketInstance.on('notification:new', (notification) => {
      // Show push notification or update UI
      console.log('New notification:', notification);

      // Acknowledge
      socketInstance.emit('mark.delivered', {
        notificationId: notification.id
      });
    });

    socketInstance.on('notification:count', (data) => {
      setUnreadCount(data.count);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.close();
    };
  }, [jwtToken]);

  return { socket, isConnected, unreadCount };
}
```

---

## Environment Variables

Add these to your `.env` file if needed:

```bash
# API Configuration
API_URL="http://localhost:3030"

# Client/CORS Configuration
CLIENT_HOST="http://localhost:5173"
CORS_ORIGINS="http://localhost:5173,http://localhost:5174"

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key-min-32-chars-long"
JWT_EXPIRATION="7d"
```

---

## Security Considerations

### 1. JWT Token Security
- Tokens are validated on every connection
- Invalid or expired tokens result in immediate disconnection
- Tokens should be transmitted over HTTPS in production

### 2. CORS Protection
- Only configured origins can establish WebSocket connections
- Credentials required for cross-origin requests
- Origin validation enforced by Socket.io

### 3. User Validation
- User must exist in database
- User must be active (`isActive: true`)
- User role determines room access (admin, sector, personal)

### 4. Rate Limiting
- Socket.io has built-in protection against flooding
- Consider implementing custom rate limiting for message events

### 5. Transport Security
- Use WSS (WebSocket Secure) in production
- Configure nginx/load balancer for WebSocket proxying
- Enable HSTS headers for HTTPS enforcement

---

## Nginx Configuration for WebSocket Proxy

If deploying behind nginx, add this configuration:

```nginx
# WebSocket upgrade configuration
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name api.ankaa.live;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Socket.io WebSocket proxy
    location /socket.io/ {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;

        # WebSocket upgrade headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeout configuration for long-lived connections
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 86400;

        # Disable buffering for real-time
        proxy_buffering off;
    }

    # HTTP API proxy
    location / {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Troubleshooting

### Connection Issues

#### Problem: Connection fails with CORS error
**Solution**: Verify that your client origin is in the allowed origins list in `security.config.ts`

#### Problem: Connection fails with authentication error
**Solution**:
- Verify JWT token is valid and not expired
- Check that token is being sent correctly in handshake
- Verify `JWT_SECRET` environment variable matches between client and server

#### Problem: Connection established but immediately disconnects
**Solution**:
- Check if user exists in database
- Verify user `isActive` status is `true`
- Check server logs for specific disconnect reason

### Transport Issues

#### Problem: WebSocket upgrade fails
**Solution**:
- Verify nginx/proxy configuration includes WebSocket headers
- Check that firewall allows WebSocket connections
- Ensure `transports: ['websocket', 'polling']` is set on client

#### Problem: Falling back to polling excessively
**Solution**:
- Check network configuration
- Verify WebSocket port is open
- Review proxy/load balancer WebSocket support

### Event Issues

#### Problem: Not receiving notifications
**Solution**:
- Verify connection is established (`socket.connected`)
- Check that user is authenticated (listen for `connection:success`)
- Verify notification is being sent to correct user/room
- Check browser console for errors

#### Problem: Notifications received multiple times
**Solution**:
- Verify socket connection is not being created multiple times
- Check for duplicate event listeners
- Ensure proper cleanup in `useEffect` or component unmount

---

## Monitoring and Logs

### Development Logs

When `NODE_ENV !== 'production'`, the following information is logged:

- Socket.io server configuration on startup
- Client connections with user information
- Client disconnections
- Notification delivery events
- Authentication failures
- Room subscriptions

### Production Monitoring

Consider implementing:
- Connection count metrics
- Authentication failure rate
- Message delivery success rate
- Average connection duration
- Peak concurrent connections

---

## Additional Resources

- **Socket.io Documentation**: https://socket.io/docs/v4/
- **NestJS WebSocket Documentation**: https://docs.nestjs.com/websockets/gateways
- **Notification Gateway Source**: `/home/kennedy/Documents/repositories/api/src/modules/common/notification/notification.gateway.ts`
- **Security Configuration**: `/home/kennedy/Documents/repositories/api/src/common/config/security.config.ts`
- **Main Application**: `/home/kennedy/Documents/repositories/api/src/main.ts`

---

## Summary

- **WebSocket Endpoint**: `{API_URL}/socket.io`
- **Notifications Namespace**: `/notifications`
- **Authentication**: JWT token in handshake (query, header, or auth object)
- **CORS**: Configured from `securityConfig.cors.origin`
- **Transports**: WebSocket (preferred) with polling fallback
- **Security**: JWT validation, user verification, CORS enforcement
- **Rooms**: Personal (`user:{id}`), Sector (`sector:{id}`), Admin (`admin`)
- **Events**: `notification:new`, `notification:read`, `notification:count`, `connection:success`

The WebSocket server is now fully configured with CORS, JWT authentication, and proper security settings. All configuration is centralized and follows NestJS best practices.
