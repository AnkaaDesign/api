# Notification Aggregation Service

## Overview

The Notification Aggregation Service intelligently groups and batches similar notifications together to reduce notification fatigue and improve user experience. Instead of receiving multiple individual notifications for related events, users receive a single aggregated summary.

## Features

- **Smart Grouping**: Automatically groups similar notifications based on configurable rules
- **Time Windows**: Batches notifications within customizable time windows
- **Max Count Limits**: Automatically flushes when notification count reaches threshold
- **Redis Caching**: High-performance storage of pending aggregations
- **User Preferences**: Per-user control over aggregation settings
- **Scheduled Flushing**: Periodic background task to send aggregated notifications
- **Type-Specific Templates**: Custom aggregation templates for different notification types

## Architecture

### Core Components

1. **NotificationAggregationService**: Main service handling aggregation logic
2. **NotificationAggregationController**: REST API endpoints for managing aggregations
3. **Redis Cache**: Stores pending notification groups (TTL: 5 minutes)
4. **Cron Scheduler**: Flushes expired aggregations every 1 minute

### Data Flow

```
New Notification
    ↓
shouldAggregate() → Check if eligible for aggregation
    ↓ (Yes)
addToAggregation() → Add to Redis cache group
    ↓
Check maxCount or timeWindow
    ↓ (Threshold reached)
flushGroup() → Create aggregated notification
    ↓
Send to user
```

## Aggregation Rules

### Default Rules

| Type | Time Window | Max Count | Group By | Template |
|------|-------------|-----------|----------|----------|
| TASK | 5 min | 10 | taskId | task-multiple-updates |
| STOCK | 5 min | 10 | - | stock-multiple-low |
| ORDER | 5 min | 10 | orderId | order-multiple-updates |
| WARNING | 5 min | 10 | userId | warning-multiple |
| PPE | 5 min | 10 | - | ppe-multiple-alerts |

### Rule Properties

```typescript
interface AggregationRule {
  type: NotificationType;        // Notification type to aggregate
  timeWindow: number;             // Minutes to wait before flushing
  maxCount: number;               // Max notifications before auto-flush
  groupBy: string[];              // Fields to group by (empty = group all)
  template: string;               // Template name for aggregated message
  enabled: boolean;               // Enable/disable this rule
}
```

## Redis Cache Structure

### Cache Keys

```
notif:agg:{userId}:{type}:{groupId}     - Aggregation groups
notif:agg:pref:{userId}                 - User preferences
notif:agg:aggregated:ids                - Aggregated notification IDs
```

### Aggregation Group Structure

```typescript
{
  userId: "user-123",
  type: "TASK",
  groupId: "taskId:task-456",
  notifications: [
    {
      id: "notif-1",
      title: "Task status updated",
      body: "Status changed from PENDING to IN_PROGRESS",
      type: "TASK",
      metadata: { taskId: "task-456", field: "status" },
      timestamp: 1704384000000,
      importance: "MEDIUM",
      channels: ["IN_APP", "EMAIL"]
    },
    // ... more notifications
  ],
  firstNotificationAt: 1704384000000,
  lastNotificationAt: 1704385200000,
  rule: { /* aggregation rule */ }
}
```

## API Endpoints

### User Endpoints

#### Get User Preferences
```http
GET /notifications/aggregation/preferences
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "enabled": true,
    "timeWindowMultiplier": 1.0
  },
  "message": "Preferências de agregação carregadas com sucesso."
}
```

#### Update User Preferences
```http
PUT /notifications/aggregation/preferences
Authorization: Bearer {token}
Content-Type: application/json

{
  "enabled": true,
  "timeWindowMultiplier": 1.5  // 50% longer time windows
}

Response:
{
  "success": true,
  "message": "Preferências de agregação atualizadas com sucesso."
}
```

#### Get Pending Aggregations
```http
GET /notifications/aggregation/pending
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": [
    {
      "title": "10 atualizações na Tarefa #123",
      "body": "• Status: PENDING → IN_PROGRESS\n• Deadline: 2024-01-01 → 2024-01-05\n...",
      "type": "TASK_AGGREGATED",
      "importance": "MEDIUM",
      "channels": ["IN_APP", "EMAIL"],
      "metadata": {
        "aggregatedCount": 10,
        "groupId": "taskId:123",
        "updates": [...]
      }
    }
  ],
  "message": "Notificações agregadas pendentes carregadas com sucesso."
}
```

#### Flush User Aggregations
```http
POST /notifications/aggregation/flush
Authorization: Bearer {token}

Response:
{
  "success": true,
  "message": "Notificações agregadas enviadas com sucesso."
}
```

### Admin Endpoints

#### Get Statistics
```http
GET /notifications/aggregation/stats
Authorization: Bearer {admin-token}

Response:
{
  "success": true,
  "data": {
    "totalGroups": 45,
    "totalPendingNotifications": 234,
    "groupsByType": {
      "TASK": 20,
      "STOCK": 15,
      "ORDER": 10
    }
  },
  "message": "Estatísticas de agregação carregadas com sucesso."
}
```

#### Flush All Aggregations
```http
POST /notifications/aggregation/flush-all
Authorization: Bearer {admin-token}

Response:
{
  "success": true,
  "message": "Todas as notificações agregadas foram enviadas com sucesso."
}
```

#### Clear All Aggregations
```http
POST /notifications/aggregation/clear-all
Authorization: Bearer {admin-token}

Response:
{
  "success": true,
  "message": "Todas as agregações foram limpas com sucesso."
}
```

## Usage Examples

### Basic Integration

```typescript
import { NotificationAggregationService } from './notification-aggregation.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly aggregationService: NotificationAggregationService,
  ) {}

  async updateTask(taskId: string, data: UpdateTaskDto) {
    // Update task...

    // Create notification
    const notification = await this.notificationService.createNotification({
      userId: task.assignedTo,
      title: 'Task updated',
      body: `Task #${taskId} has been updated`,
      type: NOTIFICATION_TYPE.TASK,
      channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      importance: NOTIFICATION_IMPORTANCE.MEDIUM,
      actionUrl: `/tasks/${taskId}`,
    });

    // Add to aggregation
    await this.aggregationService.addToAggregation(notification.data);
  }
}
```

### Programmatic Control

```typescript
// Flush user's aggregations immediately
await aggregationService.flushUserAggregations('user-123');

// Get pending aggregations
const pending = await aggregationService.getAggregatedNotifications('user-123');

// Update user preferences
await aggregationService.updateUserPreference('user-123', {
  enabled: true,
  timeWindowMultiplier: 2.0, // Double the time window
});

// Get statistics
const stats = await aggregationService.getAggregationStats();
console.log(`${stats.totalGroups} groups with ${stats.totalPendingNotifications} notifications`);
```

## Aggregation Templates

### Task Notifications

**Single Notification:**
```
Title: "Task #123 status updated"
Body: "Status changed from PENDING to IN_PROGRESS"
```

**Aggregated Notification:**
```
Title: "10 atualizações na Tarefa #123"
Body:
• Status: PENDING → IN_PROGRESS
• Deadline: 2024-01-01 → 2024-01-05
• Priority: MEDIUM → HIGH
• Assignee: John → Jane
... e mais 6 atualizações
```

### Stock Notifications

**Single Notification:**
```
Title: "Low stock alert"
Body: "Item ABC-123 is running low (5 units remaining)"
```

**Aggregated Notification:**
```
Title: "20 itens com estoque baixo"
Body:
• Parafuso M6: 5 unidades (Ponto de reposição: 50)
• Cola Branca: 2 unidades (Ponto de reposição: 20)
• Tinta Azul: 0 unidades (Ponto de reposição: 10)
... e mais 17 itens
```

### Order Notifications

**Single Notification:**
```
Title: "Order #456 updated"
Body: "Order status changed to SHIPPED"
```

**Aggregated Notification:**
```
Title: "15 atualizações no Pedido #456"
Body:
• Status atualizado
• Tracking number adicionado
• Estimated delivery atualizado
... e mais 12 atualizações
```

## Scheduled Tasks

### Automatic Flush (Every 1 Minute)

The service includes a scheduled task that runs every 1 minute to:

1. Scan all aggregation groups in Redis
2. Check if time window has expired (5 minutes)
3. Flush expired groups
4. Send aggregated notifications

```typescript
@Cron('*/1 * * * *', {
  name: 'flush-notification-aggregations',
})
async scheduledFlush(): Promise<void> {
  this.logger.log('Running scheduled aggregation flush (every 1 minute)');
  await this.flushAggregatedNotifications();
}
```

## User Preferences

### Aggregation Control

Users can control aggregation behavior through preferences:

- **enabled**: Enable/disable aggregation entirely
- **timeWindowMultiplier**: Adjust time windows (0.5 = half, 2.0 = double)

### Example Scenarios

**Power User (wants updates immediately):**
```json
{
  "enabled": false
}
```

**Busy User (wants fewer interruptions):**
```json
{
  "enabled": true,
  "timeWindowMultiplier": 2.0
}
```

**Default User:**
```json
{
  "enabled": true,
  "timeWindowMultiplier": 1.0
}
```

## Performance Considerations

### Redis Optimization

- **Key Prefix**: All keys use `notif:agg:` prefix for easy identification
- **TTL**: Groups automatically expire based on time window
- **Batch Operations**: Uses Redis pipeline for multiple operations

### Memory Management

- **Max Count**: Prevents groups from growing too large
- **Auto-Flush**: Expired groups are automatically flushed
- **Cleanup**: Aggregated notification IDs are stored for 24 hours

### Scalability

- **Horizontal Scaling**: Multiple app instances can share Redis cache
- **Load Distribution**: Scheduled tasks can be distributed across instances
- **Caching**: User preferences cached for 1 hour to reduce DB queries

## Monitoring

### Key Metrics

1. **Total Aggregation Groups**: Current number of active groups
2. **Pending Notifications**: Total notifications waiting to be aggregated
3. **Groups by Type**: Distribution of groups across notification types
4. **Flush Rate**: How often groups are being flushed

### Health Checks

```typescript
const stats = await aggregationService.getAggregationStats();

// Alert if too many pending notifications
if (stats.totalPendingNotifications > 1000) {
  console.warn('High number of pending notifications!');
}

// Alert if groups not being flushed
if (stats.totalGroups > 100) {
  console.warn('Many active groups - check scheduler!');
}
```

## Error Handling

### Graceful Degradation

If aggregation fails, notifications are still sent normally:

```typescript
try {
  await this.aggregationService.addToAggregation(notification);
} catch (error) {
  this.logger.error('Aggregation failed, notification sent normally:', error);
  // Notification was already created, no action needed
}
```

### Redis Connection Issues

If Redis is unavailable:
- Aggregation is skipped
- Notifications sent immediately
- Error logged for monitoring

## Testing

### Unit Tests

```typescript
describe('NotificationAggregationService', () => {
  it('should aggregate notifications within time window', async () => {
    const notification = createMockNotification();
    await service.addToAggregation(notification);

    const pending = await service.getAggregatedNotifications(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].metadata.aggregatedCount).toBe(1);
  });

  it('should flush when max count reached', async () => {
    // Add 10 notifications (maxCount for TASK)
    for (let i = 0; i < 10; i++) {
      await service.addToAggregation(createMockNotification());
    }

    // Should have flushed automatically
    const pending = await service.getAggregatedNotifications(userId);
    expect(pending).toHaveLength(0);
  });
});
```

### Integration Tests

```typescript
describe('Aggregation Integration', () => {
  it('should aggregate and flush notifications', async () => {
    // Create 5 notifications
    for (let i = 0; i < 5; i++) {
      await createNotification(taskId);
    }

    // Wait for time window to expire
    await sleep(35 * 60 * 1000); // 35 minutes

    // Trigger scheduled flush
    await service.scheduledFlush();

    // Check that aggregated notification was created
    const notifications = await getNotifications(userId);
    expect(notifications.some(n => n.type.includes('AGGREGATED'))).toBe(true);
  });
});
```

## Troubleshooting

### Notifications Not Being Aggregated

**Possible Causes:**
1. User has disabled aggregation in preferences
2. Notification importance is HIGH (never aggregated)
3. No aggregation rule defined for notification type
4. Redis connection issues

**Solution:**
```typescript
// Check if notification should be aggregated
const shouldAgg = await service.shouldAggregate(notification);
console.log('Should aggregate:', shouldAgg);

// Check user preferences
const pref = await service.getUserPreference(userId);
console.log('User preferences:', pref);
```

### Groups Not Being Flushed

**Possible Causes:**
1. Scheduler not running
2. Time window not expired
3. Group below max count threshold

**Solution:**
```typescript
// Manual flush
await service.flushUserAggregations(userId);

// Check stats
const stats = await service.getAggregationStats();
console.log('Pending groups:', stats.totalGroups);
```

### Redis Memory Issues

**Possible Causes:**
1. Too many aggregation groups
2. Groups not expiring properly
3. TTL not set correctly

**Solution:**
```typescript
// Clear all aggregations
await service.clearAllAggregations();

// Flush all immediately
await service.flushAggregations();
```

## Best Practices

1. **Set Appropriate Time Windows**: Balance between reducing fatigue and timely updates
2. **Monitor Aggregation Stats**: Watch for anomalies in pending notifications
3. **User Control**: Allow users to customize aggregation behavior
4. **Graceful Degradation**: Always send notifications even if aggregation fails
5. **Cache Cleanup**: Regularly monitor Redis memory usage
6. **Test Edge Cases**: Test max count limits and time window expiration
7. **Log Aggregations**: Track when groups are created and flushed

## Future Enhancements

- [ ] Machine learning-based aggregation rules
- [ ] Per-notification-type user preferences
- [ ] Aggregation analytics dashboard
- [ ] Custom aggregation templates per user
- [ ] Smart timing based on user activity patterns
- [ ] Preview aggregated notifications before sending
- [ ] Undo/recall aggregated notifications
