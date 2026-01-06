# Notification Analytics Service Documentation

## Overview

The Notification Analytics Service provides comprehensive analytics and reporting capabilities for the notification system. It enables administrators to track delivery performance, user engagement, and identify issues through detailed metrics and visualizations.

## Features

### 1. Overall Statistics
- Total notification counts
- Delivery rate (successful deliveries / total notifications)
- Seen rate (seen notifications / delivered notifications)
- Breakdown by notification type
- Breakdown by delivery channel

### 2. Delivery Analytics
- Channel-specific performance metrics
- Success rates per channel
- Failed delivery tracking
- Average delivery times

### 3. Time Series Analysis
- Hourly or daily notification trends
- Historical performance tracking
- Pattern identification

### 4. Failure Analysis
- Top 10 failure reasons with counts
- Error categorization
- Helps identify systemic issues

### 5. User Engagement Metrics
- Per-user notification statistics
- Seen rates and click rates
- Average time to see notifications
- User behavior analysis

### 6. Top Users Ranking
- Most active recipients
- Most engaged users
- High-interaction users

### 7. CSV Export
- Export analytics data for external analysis
- Customizable filtering
- Includes all relevant fields

## API Endpoints

### GET /admin/notifications/analytics/overview

Get comprehensive overview analytics.

**Query Parameters:**
- `dateFrom` (optional): Start date for filtering (ISO 8601 format)
- `dateTo` (optional): End date for filtering (ISO 8601 format)

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 1500,
    "delivered": 1350,
    "failed": 75,
    "seen": 1200,
    "deliveryRate": 90.0,
    "seenRate": 88.89,
    "byType": {
      "TASK": 500,
      "ORDER": 300,
      "GENERAL": 700
    },
    "byChannel": {
      "EMAIL": 800,
      "IN_APP": 1500,
      "SMS": 200
    }
  },
  "message": "Estatísticas gerais carregadas com sucesso."
}
```

### GET /admin/notifications/analytics/delivery

Get delivery statistics by channel.

**Query Parameters:**
- `dateFrom` (optional): Start date for filtering
- `dateTo` (optional): End date for filtering

**Response:**
```json
{
  "success": true,
  "data": {
    "email": {
      "sent": 800,
      "delivered": 750,
      "failed": 50
    },
    "sms": {
      "sent": 200,
      "delivered": 190,
      "failed": 10
    },
    "push": {
      "sent": 500,
      "delivered": 480,
      "failed": 20
    },
    "whatsapp": {
      "sent": 100,
      "delivered": 95,
      "failed": 5
    },
    "inApp": {
      "sent": 1500,
      "delivered": 1500
    }
  },
  "message": "Estatísticas de entrega carregadas com sucesso."
}
```

### GET /admin/notifications/analytics/time-series

Get time series data for trend analysis.

**Query Parameters:**
- `dateFrom` (required): Start date
- `dateTo` (required): End date
- `interval` (optional): Time interval - 'hour' or 'day' (default: 'day')

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "time": "2024-01-01T00:00:00.000Z",
      "count": 150
    },
    {
      "time": "2024-01-02T00:00:00.000Z",
      "count": 200
    }
  ],
  "message": "Série temporal carregada com sucesso."
}
```

### GET /admin/notifications/analytics/failures

Get top failure reasons.

**Query Parameters:**
- `dateFrom` (optional): Start date for filtering
- `dateTo` (optional): End date for filtering

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "reason": "Email address not found",
      "count": 25
    },
    {
      "reason": "Network timeout",
      "count": 20
    },
    {
      "reason": "Invalid phone number",
      "count": 15
    }
  ],
  "message": "Motivos de falha carregados com sucesso."
}
```

### GET /admin/notifications/analytics/users/:id

Get engagement analytics for a specific user.

**Path Parameters:**
- `id` (required): User ID

**Query Parameters:**
- `dateFrom` (optional): Start date for filtering
- `dateTo` (optional): End date for filtering

**Response:**
```json
{
  "success": true,
  "data": {
    "received": 100,
    "seen": 85,
    "clicked": 45,
    "seenRate": 85.0,
    "clickRate": 45.0,
    "avgTimeToSee": 12.5
  },
  "message": "Métricas de engajamento do usuário carregadas com sucesso."
}
```

**Field Descriptions:**
- `received`: Total notifications received
- `seen`: Number of notifications seen
- `clicked`: Number of notifications with actions taken
- `seenRate`: Percentage of notifications seen
- `clickRate`: Percentage of notifications clicked
- `avgTimeToSee`: Average time in minutes to see a notification after it's sent

### GET /admin/notifications/analytics/top-users

Get top users by a specific metric.

**Query Parameters:**
- `metric` (optional): Metric to rank by - 'received', 'seen', or 'engaged' (default: 'received')
- `limit` (optional): Number of top users to return (default: 10)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "userId": "user-123",
      "userName": "John Doe",
      "userEmail": "john@example.com",
      "count": 250
    },
    {
      "userId": "user-456",
      "userName": "Jane Smith",
      "userEmail": "jane@example.com",
      "count": 200
    }
  ],
  "message": "Top usuários carregados com sucesso."
}
```

**Metric Options:**
- `received`: Users who received most notifications
- `seen`: Users who have seen most notifications
- `engaged`: Users with highest engagement (seen notifications with actions)

### GET /admin/notifications/analytics/export

Export analytics data to CSV.

**Query Parameters:**
- Same filtering options as the list endpoint:
  - `type`: Notification type
  - `channel`: Notification channel
  - `status`: Notification status
  - `userId`: Filter by user ID
  - `sectorId`: Filter by sector ID
  - `dateFrom`: Start date
  - `dateTo`: End date

**Response:**
```json
{
  "success": true,
  "data": {
    "csv": "id,title,type,importance,userId,userName...",
    "size": 15000
  },
  "message": "Dados exportados com sucesso."
}
```

## Performance Optimization

### Database Indexes

The following indexes are automatically created to ensure optimal query performance:

**Notification Table:**
- `createdAt`: For date range filtering
- `sentAt`: For sent notification queries
- `type, createdAt`: For type-based analytics
- `userId, createdAt`: For user-specific analytics

**NotificationDelivery Table:**
- `channel, status`: For channel performance metrics
- `status, createdAt`: For delivery status tracking
- `deliveredAt`: For delivery time analysis
- `sentAt`: For send time analysis
- `failedAt`: For failure tracking
- `createdAt`: For time-based queries

**SeenNotification Table:**
- `seenAt`: For engagement time analysis
- `userId, seenAt`: For user engagement tracking
- `createdAt`: For time-based queries
- `notificationId, userId`: For seen status lookups

### Caching Strategy

The service implements intelligent caching to reduce database load:

- **Cache TTL**: 5 minutes for most analytics queries
- **Cache TTL**: 10 minutes for top users queries
- **Cache Keys**: Include date range parameters to ensure data freshness
- **Automatic Invalidation**: Cache entries expire automatically

**Cached Endpoints:**
- Overall statistics
- Delivery statistics
- Time series data
- Failure reasons
- User engagement metrics
- Top users

### Query Optimization

1. **Aggregation at Database Level**: Uses `groupBy` and raw SQL queries for efficient data aggregation
2. **Parallel Queries**: Executes independent queries in parallel using `Promise.all()`
3. **Result Limiting**: Limits export queries to 10,000 records for performance
4. **Efficient Joins**: Minimizes joins and uses selective field selection

## Usage Examples

### Basic Usage

```typescript
import { NotificationAnalyticsService } from './notification-analytics.service';

// Inject the service
constructor(
  private readonly analyticsService: NotificationAnalyticsService,
) {}

// Get overall stats
const stats = await this.analyticsService.getOverallStats();

// Get stats for last 7 days
const dateRange = {
  start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  end: new Date(),
};
const weekStats = await this.analyticsService.getOverallStats(dateRange);
```

### Advanced Analytics

```typescript
// Get hourly time series for the last 24 hours
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const now = new Date();
const timeSeries = await this.analyticsService.getTimeSeries(
  { start: yesterday, end: now },
  'hour'
);

// Get top engaged users
const topEngaged = await this.analyticsService.getTopUsers('engaged', 20);

// Get user engagement for specific user
const userStats = await this.analyticsService.getUserEngagement(
  'user-id-123',
  dateRange
);
```

### Export to CSV

```typescript
// Export all notifications from last month
const lastMonth = {
  createdAt: {
    gte: new Date('2024-01-01'),
    lte: new Date('2024-01-31'),
  },
};

const csvBuffer = await this.analyticsService.exportToCSV(lastMonth);

// Save to file or send to client
fs.writeFileSync('notifications.csv', csvBuffer);
```

## Monitoring and Alerting

### Key Metrics to Monitor

1. **Delivery Rate**: Should be > 95%
   - Alert if drops below 90%

2. **Seen Rate**: Should be > 70%
   - Alert if drops below 50%

3. **Failed Deliveries**: Monitor failure reasons
   - Alert on sudden spike in failures

4. **Average Delivery Time**: Should be < 60 seconds
   - Alert if exceeds 5 minutes

### Dashboard Recommendations

Create dashboards showing:
- Real-time delivery status
- Channel performance comparison
- Daily/hourly notification trends
- Top failure reasons
- User engagement metrics

## Best Practices

1. **Date Range Selection**:
   - Use reasonable date ranges to avoid performance issues
   - For large datasets, use pagination or time-based filtering

2. **Caching**:
   - Leverage the built-in caching for frequently accessed metrics
   - Clear cache when real-time data is needed

3. **Export Limits**:
   - Be aware of the 10,000 record limit on exports
   - Use date filtering for large datasets

4. **Query Optimization**:
   - Filter at the database level rather than in application code
   - Use indexes for all date range queries

5. **Error Handling**:
   - Always handle potential errors when calling analytics endpoints
   - Provide fallback values for missing data

## Troubleshooting

### Slow Queries

If analytics queries are slow:
1. Check that database indexes are properly created
2. Verify cache is working correctly
3. Reduce date range for time series queries
4. Consider database query optimization

### Missing Data

If analytics show missing or incorrect data:
1. Verify notification delivery is working correctly
2. Check that seen notifications are being tracked
3. Ensure date range parameters are correct
4. Verify user IDs are valid

### Cache Issues

If cached data seems stale:
1. Check cache TTL settings
2. Verify cache service is running
3. Clear cache manually if needed
4. Check for cache invalidation logic

## Future Enhancements

Planned improvements:
- Real-time analytics dashboard
- Advanced filtering and segmentation
- Predictive analytics for delivery success
- Custom report generation
- Scheduled report delivery
- Integration with monitoring tools (Grafana, DataDog)
- A/B testing metrics
- Notification effectiveness scoring

## Support

For issues or questions:
- Check the main notification service documentation
- Review the API endpoint documentation above
- Consult the troubleshooting section
- Contact the development team for advanced support
