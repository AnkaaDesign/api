# WebSocket Architecture Diagram

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATIONS                          │
├─────────────────────────────────────────────────────────────────────┤
│  Web Browser    │  React Native App  │  Mobile Web  │  Desktop App  │
│  (React/Vue)    │     (iOS/Android)  │              │               │
└────────┬────────┴──────────┬─────────┴──────┬───────┴───────┬───────┘
         │                   │                │               │
         │    Socket.io Client Library (socket.io-client)    │
         │                   │                │               │
         └───────────────────┴────────────────┴───────────────┘
                             │
                             │ JWT Token in Handshake
                             │ (query, header, or auth object)
                             │
                             ▼
         ┌───────────────────────────────────────────┐
         │         CORS VALIDATION                   │
         │  - Origin check                           │
         │  - Credentials verification               │
         │  - Allowed headers check                  │
         └───────────────────┬───────────────────────┘
                             │
                             ▼
         ┌───────────────────────────────────────────┐
         │      NGINX/LOAD BALANCER (Production)     │
         │  - WebSocket upgrade headers              │
         │  - Proxy pass to Node.js                  │
         │  - SSL/TLS termination                    │
         │  - Path: /socket.io/                      │
         └───────────────────┬───────────────────────┘
                             │
                             ▼
         ┌───────────────────────────────────────────┐
         │         NESTJS APPLICATION                │
         │         (main.ts)                         │
         │                                           │
         │  ┌─────────────────────────────────┐    │
         │  │   SocketIoAdapter               │    │
         │  │   extends IoAdapter             │    │
         │  │                                 │    │
         │  │  Configuration:                 │    │
         │  │  - Path: /socket.io            │    │
         │  │  - Transports: ws, polling     │    │
         │  │  - CORS: securityConfig        │    │
         │  │  - Ping: 25s interval          │    │
         │  │  - Timeout: 60s                │    │
         │  └──────────┬──────────────────────┘    │
         │             │                            │
         │             ▼                            │
         │  ┌─────────────────────────────────┐    │
         │  │   Socket.io Server              │    │
         │  │   - Port: 3030 (default)        │    │
         │  │   - Path: /socket.io            │    │
         │  └──────────┬──────────────────────┘    │
         └─────────────┼──────────────────────────┘
                       │
                       │ Namespace routing
                       │
                       ▼
         ┌───────────────────────────────────────────┐
         │     NOTIFICATION GATEWAY                  │
         │     (@WebSocketGateway)                   │
         │     namespace: '/notifications'           │
         │                                           │
         │  Connection Flow:                         │
         │  1. Extract JWT token                     │
         │  2. Verify token signature                │
         │  3. Load user from database               │
         │  4. Verify user is active                 │
         │  5. Store user context                    │
         │  6. Subscribe to rooms                    │
         │  7. Send pending notifications            │
         │  8. Emit connection:success               │
         │                                           │
         └───────────────────┬───────────────────────┘
                             │
                             ▼
         ┌───────────────────────────────────────────┐
         │         ROOM SUBSCRIPTIONS                │
         ├───────────────────────────────────────────┤
         │                                           │
         │  Personal Room: user:{userId}             │
         │  - Direct notifications                   │
         │  - User-specific events                   │
         │                                           │
         │  Sector Room: sector:{sectorId}           │
         │  - Sector-wide broadcasts                 │
         │  - Department notifications               │
         │                                           │
         │  Admin Room: admin                        │
         │  - Admin-only notifications               │
         │  - System alerts                          │
         │                                           │
         └───────────────────┬───────────────────────┘
                             │
                             ▼
         ┌───────────────────────────────────────────┐
         │        NOTIFICATION SERVICES              │
         ├───────────────────────────────────────────┤
         │                                           │
         │  NotificationRepository                   │
         │  - Find/Create/Update notifications       │
         │                                           │
         │  NotificationDeliveryRepository           │
         │  - Track delivery status                  │
         │  - Channel tracking (IN_APP, PUSH, etc)   │
         │                                           │
         │  UserRepository                           │
         │  - User authentication                    │
         │  - User profile data                      │
         │                                           │
         └───────────────────┬───────────────────────┘
                             │
                             ▼
         ┌───────────────────────────────────────────┐
         │          DATABASE (PostgreSQL)            │
         │  - Notification table                     │
         │  - NotificationDelivery table             │
         │  - User table                             │
         │  - NotificationSeen table                 │
         └───────────────────────────────────────────┘
```

## Connection Flow Diagram

```
Client Application
      │
      │ 1. Obtain JWT token from /auth/login
      │
      ▼
Socket.io Client
      │
      │ 2. Connect to ws://api.ankaa.live/socket.io
      │    with namespace: /notifications
      │    and token in handshake
      │
      ▼
SocketIoAdapter (main.ts)
      │
      │ 3. Apply CORS validation
      │    - Check origin
      │    - Verify credentials
      │
      ▼
NotificationGateway
      │
      │ 4. Handle connection event
      │
      ├──► 5. Extract JWT token from:
      │         - handshake.query.token
      │         - handshake.headers.authorization
      │         - handshake.auth.token
      │
      ├──► 6. Verify JWT signature
      │         using JWT_SECRET
      │
      ├──► 7. Load user from database
      │         - Check user exists
      │         - Verify isActive = true
      │
      ├──► 8. Store user context in socket.data
      │         - userId
      │         - userEmail
      │         - userName
      │         - sectorId
      │         - userRole
      │
      ├──► 9. Track connection in memory
      │         - Add to userSockets Map
      │         - Add to socketUsers Map
      │         - Add to onlineUsers Set
      │
      ├──► 10. Subscribe to rooms
      │          - user:{userId} (always)
      │          - sector:{sectorId} (if user has sector)
      │          - admin (if user is ADMIN/SUPER_ADMIN)
      │
      ├──► 11. Send pending notifications
      │          - Query unread notifications
      │          - Emit each via notification:new
      │          - Mark as delivered
      │
      ├──► 12. Send unread count
      │          - Query unread count
      │          - Emit via notification:count
      │
      └──► 13. Emit connection:success
               - userId, userName, timestamp, unreadCount
```

## Event Flow Diagram

### New Notification Flow

```
Backend Service
      │
      │ Create notification
      │
      ▼
NotificationRepository.create()
      │
      ▼
NotificationGateway.sendNotification()
      │
      ├──► Emit to room: user:{userId}
      │    Event: notification:new
      │    Payload: { id, title, message, ... }
      │
      ├──► Mark as delivered if user online
      │    NotificationDeliveryRepository.create()
      │
      └──► Log delivery status
            - User ID
            - Socket count
            - Event type

Client receives notification:new
      │
      ├──► Display notification to user
      │
      └──► Emit acknowledgment
           Event: mark.delivered
           Payload: { notificationId }
```

### Mark as Read Flow

```
Client
      │
      │ User marks notification as read
      │
      ▼
Socket.emit('mark.read', { notificationId })
      │
      ▼
NotificationGateway.handleMarkAsRead()
      │
      ├──► Verify notification exists
      │
      ├──► Emit to all user's devices
      │    Room: user:{userId}
      │    Event: notification:read
      │    Payload: { notificationId, readAt }
      │
      ├──► Update unread count
      │    Query new count
      │
      ├──► Emit updated count
      │    Event: notification:count
      │    Payload: { count }
      │
      └──► Return response to client
           { success: true, notificationId }

All user's devices receive notification:read
      │
      └──► Update UI to show as read
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION LAYER                      │
│  JWT Token → Verification → User Lookup → Context Storage   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    CONNECTION LAYER                          │
│  Socket.io Server → Gateway → Room Subscriptions            │
│                                                              │
│  User Tracking:                                             │
│  - userSockets: Map<userId, Set<socketId>>                  │
│  - socketUsers: Map<socketId, userId>                       │
│  - onlineUsers: Set<userId>                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    MESSAGING LAYER                           │
│  Event Handling → Room Broadcasting → Delivery Tracking     │
│                                                              │
│  Event Types:                                               │
│  - notification:new (server → client)                       │
│  - notification:read (server → client)                      │
│  - notification:count (server → client)                     │
│  - connection:success (server → client)                     │
│  - mark.read (client → server)                              │
│  - mark.delivered (client → server)                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    PERSISTENCE LAYER                         │
│  Notification Repository → Database → Delivery Tracking     │
│                                                              │
│  Tables:                                                    │
│  - Notification (notification data)                         │
│  - NotificationDelivery (delivery status)                   │
│  - NotificationSeen (read receipts)                         │
│  - User (authentication)                                    │
└─────────────────────────────────────────────────────────────┘
```

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: TRANSPORT SECURITY                                │
│  - HTTPS/WSS in production                                  │
│  - TLS 1.2+ encryption                                      │
│  - Certificate validation                                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: CORS PROTECTION                                   │
│  - Origin whitelist validation                              │
│  - Credentials requirement                                  │
│  - Header validation                                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: AUTHENTICATION                                    │
│  - JWT signature verification                               │
│  - Token expiration check                                   │
│  - User existence validation                                │
│  - Active status verification                               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: AUTHORIZATION                                     │
│  - Room access control                                      │
│  - Role-based permissions                                   │
│  - Sector-based filtering                                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: RATE LIMITING                                     │
│  - Connection rate limits                                   │
│  - Message rate limits                                      │
│  - Socket.io built-in protection                            │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
/home/kennedy/Documents/repositories/api/
│
├── src/
│   ├── main.ts
│   │   └── SocketIoAdapter configuration
│   │       - CORS setup
│   │       - Transport configuration
│   │       - Security settings
│   │
│   ├── common/
│   │   └── config/
│   │       └── security.config.ts
│   │           - CORS origins
│   │           - JWT settings
│   │           - Security headers
│   │
│   └── modules/
│       └── common/
│           ├── auth/
│           │   ├── auth.module.ts (JWT configuration)
│           │   ├── auth.service.ts (JWT operations)
│           │   └── auth.guard.ts (HTTP JWT guard)
│           │
│           └── notification/
│               ├── notification.gateway.ts
│               │   - Connection handling
│               │   - Authentication
│               │   - Event handlers
│               │   - Room management
│               │
│               ├── notification.service.ts
│               │   - Business logic
│               │
│               ├── repositories/
│               │   ├── notification.repository.ts
│               │   └── notification-delivery.repository.ts
│               │
│               └── notification.module.ts
│
├── WEBSOCKET_CONFIGURATION.md
│   - Comprehensive configuration guide
│   - Client examples
│   - Troubleshooting
│
├── WEBSOCKET_QUICK_START.md
│   - Quick reference
│   - Basic examples
│
├── WEBSOCKET_IMPLEMENTATION_SUMMARY.md
│   - Implementation overview
│   - Changes made
│
└── WEBSOCKET_ARCHITECTURE.md (this file)
    - System architecture
    - Flow diagrams
```

## Scalability Considerations

### Horizontal Scaling (Multiple Instances)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Client A   │     │  Client B   │     │  Client C   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │    Load Balancer (sticky sessions)   │
       │                   │                   │
       ├───────────────────┴───────────────────┤
       │                   │                   │
┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
│  Node.js    │     │  Node.js    │     │  Node.js    │
│  Instance 1 │     │  Instance 2 │     │  Instance 3 │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Redis Adapter│
                    │ (for scaling)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  PostgreSQL │
                    └─────────────┘
```

For production scaling, consider adding Redis adapter:
```typescript
import { RedisIoAdapter } from '@nestjs/platform-socket.io';
// Configure in main.ts for multi-instance deployments
```

## Monitoring Points

```
┌─────────────────────────────────────────────────────────────┐
│  METRICS TO MONITOR                                         │
├─────────────────────────────────────────────────────────────┤
│  Connection Metrics:                                        │
│  - Total connections                                        │
│  - Connections per user                                     │
│  - Connection duration                                      │
│  - Connection failures                                      │
│  - Authentication failures                                  │
│                                                             │
│  Performance Metrics:                                       │
│  - Message delivery time                                    │
│  - Event processing time                                    │
│  - Room broadcast latency                                   │
│                                                             │
│  Business Metrics:                                          │
│  - Notifications sent                                       │
│  - Notifications delivered                                  │
│  - Notifications read                                       │
│  - Online user count                                        │
└─────────────────────────────────────────────────────────────┘
```

## Summary

This architecture provides:
- Secure WebSocket communication with JWT authentication
- CORS protection for frontend applications
- Scalable room-based broadcasting
- Multi-device support for users
- Comprehensive event tracking and delivery confirmation
- Production-ready configuration with proper security layers
