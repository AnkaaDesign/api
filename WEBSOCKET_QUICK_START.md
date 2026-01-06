# WebSocket Quick Start Guide

## Connection Setup (5 minutes)

### Step 1: Get Your JWT Token
```javascript
// After login, you'll receive a JWT token
const token = 'your-jwt-token-here';
```

### Step 2: Connect to WebSocket
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3030/notifications', {
  query: { token },
  transports: ['websocket', 'polling']
});
```

### Step 3: Listen for Connection Success
```javascript
socket.on('connection:success', (data) => {
  console.log('Connected!', data);
  // { userId, userName, connectedAt, unreadCount }
});
```

### Step 4: Listen for Notifications
```javascript
socket.on('notification:new', (notification) => {
  console.log('New notification:', notification);

  // Acknowledge receipt
  socket.emit('mark.delivered', {
    notificationId: notification.id
  });

  // Show notification to user
  showNotification(notification);
});
```

### Step 5: Handle Unread Count
```javascript
socket.on('notification:count', (data) => {
  console.log('Unread count:', data.count);
  updateBadge(data.count);
});
```

## Mark Notification as Read
```javascript
socket.emit('mark.read', { notificationId: '123' }, (response) => {
  if (response.success) {
    console.log('Marked as read');
  }
});
```

## Complete Example
```javascript
import { io } from 'socket.io-client';

// Get token from your auth system
const token = localStorage.getItem('jwt_token');

// Connect
const socket = io('http://localhost:3030/notifications', {
  query: { token },
  transports: ['websocket', 'polling'],
  reconnection: true,
});

// Connection events
socket.on('connect', () => console.log('Connected'));
socket.on('disconnect', () => console.log('Disconnected'));
socket.on('connect_error', (error) => console.error('Error:', error));

// Authentication success
socket.on('connection:success', (data) => {
  console.log('User:', data.userName);
  console.log('Unread:', data.unreadCount);
});

// New notifications
socket.on('notification:new', (notification) => {
  console.log('New:', notification);
  socket.emit('mark.delivered', { notificationId: notification.id });
});

// Unread count updates
socket.on('notification:count', (data) => {
  console.log('Unread count:', data.count);
});

// Mark as read
function markAsRead(notificationId) {
  socket.emit('mark.read', { notificationId });
}
```

## WebSocket URLs

| Environment | URL |
|-------------|-----|
| **Local Development** | `http://localhost:3030/socket.io` |
| **Staging** | `https://api.staging.ankaa.live/socket.io` |
| **Production** | `https://api.ankaa.live/socket.io` |

## Authentication Methods

### Query Parameter (Recommended)
```javascript
io('http://localhost:3030/notifications', {
  query: { token: 'YOUR_JWT_TOKEN' }
});
```

### Authorization Header
```javascript
io('http://localhost:3030/notifications', {
  extraHeaders: {
    Authorization: 'Bearer YOUR_JWT_TOKEN'
  }
});
```

### Auth Object (Socket.io v3+)
```javascript
io('http://localhost:3030/notifications', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});
```

## Events Reference

### Events You'll Receive

| Event | Description | Payload |
|-------|-------------|---------|
| `connection:success` | Connection authenticated | `{ userId, userName, connectedAt, unreadCount }` |
| `notification:new` | New notification | Full notification object |
| `notification:read` | Notification marked as read | `{ notificationId, readAt }` |
| `notification:count` | Unread count update | `{ count }` |

### Events You Can Send

| Event | Description | Payload | Response |
|-------|-------------|---------|----------|
| `mark.read` | Mark as read | `{ notificationId }` | `{ success, notificationId?, error? }` |
| `mark.delivered` | Acknowledge delivery | `{ notificationId }` | `{ success, notificationId?, error? }` |

## Troubleshooting

### "Connection failed"
- Check that token is valid
- Verify API URL is correct
- Check CORS settings

### "Authentication error"
- Token might be expired - get a new one
- Verify JWT_SECRET is correct
- Check user exists and is active

### "Not receiving notifications"
- Verify socket is connected: `socket.connected`
- Check you're listening for the right events
- Look for errors in browser console

## Need Help?

See full documentation: `/home/kennedy/Documents/repositories/api/WEBSOCKET_CONFIGURATION.md`

## Testing Connection

```bash
# Test with curl (get token first from login endpoint)
curl -X POST http://localhost:3030/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# Use the token to test WebSocket (install wscat first: npm install -g wscat)
wscat -c "ws://localhost:3030/socket.io/?EIO=4&transport=websocket&token=YOUR_JWT_TOKEN"
```
