# Notification Analytics Quick Reference

## Quick Start

### Import the Service
```typescript
import { NotificationAnalyticsService } from './notification-analytics.service';

constructor(
  private readonly analyticsService: NotificationAnalyticsService,
) {}
```

## Common Use Cases

### 1. Get Overall Statistics
```typescript
// All time stats
const stats = await this.analyticsService.getOverallStats();

// Last 30 days
const dateRange = {
  start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  end: new Date(),
};
const monthStats = await this.analyticsService.getOverallStats(dateRange);
```

**Returns:**
```typescript
{
  total: 1500,
  delivered: 1350,
  failed: 75,
  seen: 1200,
  deliveryRate: 90.0,
  seenRate: 88.89,
  byType: { TASK: 500, ORDER: 300 },
  byChannel: { EMAIL: 800, IN_APP: 1500 }
}
```

### 2. Get Delivery Statistics
```typescript
const deliveryStats = await this.analyticsService.getDeliveryStats(dateRange);
```

**Returns:**
```typescript
{
  email: { sent: 800, delivered: 750, failed: 50 },
  sms: { sent: 200, delivered: 190, failed: 10 },
  push: { sent: 500, delivered: 480, failed: 20 },
  whatsapp: { sent: 100, delivered: 95, failed: 5 },
  inApp: { sent: 1500, delivered: 1500 }
}
```

### 3. Get Time Series Data
```typescript
// Daily for last week
const lastWeek = {
  start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  end: new Date(),
};
const dailySeries = await this.analyticsService.getTimeSeries(lastWeek, 'day');

// Hourly for last 24 hours
const last24h = {
  start: new Date(Date.now() - 24 * 60 * 60 * 1000),
  end: new Date(),
};
const hourlySeries = await this.analyticsService.getTimeSeries(last24h, 'hour');
```

**Returns:**
```typescript
[
  { time: Date, count: 150 },
  { time: Date, count: 200 },
  // ...
]
```

### 4. Get Failure Reasons
```typescript
const failures = await this.analyticsService.getFailureReasons(dateRange);
```

**Returns:**
```typescript
[
  { reason: "Network timeout", count: 25 },
  { reason: "Invalid email", count: 15 },
  // ... top 10
]
```

### 5. Get User Engagement
```typescript
const userId = 'user-123';
const engagement = await this.analyticsService.getUserEngagement(
  userId,
  dateRange
);
```

**Returns:**
```typescript
{
  received: 100,
  seen: 85,
  clicked: 45,
  seenRate: 85.0,
  clickRate: 45.0,
  avgTimeToSee: 12.5  // minutes
}
```

### 6. Get Top Users
```typescript
// Top 10 users by received notifications
const topReceived = await this.analyticsService.getTopUsers('received', 10);

// Top 20 most engaged users
const topEngaged = await this.analyticsService.getTopUsers('engaged', 20);

// Top users who have seen most notifications
const topSeen = await this.analyticsService.getTopUsers('seen', 10);
```

**Returns:**
```typescript
[
  {
    userId: "user-123",
    userName: "John Doe",
    userEmail: "john@example.com",
    count: 250
  },
  // ...
]
```

### 7. Export to CSV
```typescript
// Export with filters
const filters = {
  type: 'TASK',
  userId: 'user-123',
  createdAt: {
    gte: new Date('2024-01-01'),
    lte: new Date('2024-01-31'),
  },
};

const csvBuffer = await this.analyticsService.exportToCSV(filters);

// Save to file
import * as fs from 'fs';
fs.writeFileSync('notifications.csv', csvBuffer);

// Send as response
res.setHeader('Content-Type', 'text/csv');
res.setHeader('Content-Disposition', 'attachment; filename=notifications.csv');
res.send(csvBuffer);
```

## API Endpoints

### Overview Statistics
```bash
GET /admin/notifications/analytics/overview
Query: ?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Delivery Statistics
```bash
GET /admin/notifications/analytics/delivery
Query: ?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Time Series
```bash
GET /admin/notifications/analytics/time-series
Query: ?dateFrom=2024-01-01&dateTo=2024-01-31&interval=day
Required: dateFrom, dateTo
Optional: interval (hour|day, default: day)
```

### Failure Reasons
```bash
GET /admin/notifications/analytics/failures
Query: ?dateFrom=2024-01-01&dateTo=2024-01-31
```

### User Engagement
```bash
GET /admin/notifications/analytics/users/:userId
Query: ?dateFrom=2024-01-01&dateTo=2024-01-31
```

### Top Users
```bash
GET /admin/notifications/analytics/top-users
Query: ?metric=engaged&limit=20
Optional: metric (received|seen|engaged, default: received)
Optional: limit (number, default: 10)
```

### Export CSV
```bash
GET /admin/notifications/analytics/export
Query: ?type=TASK&dateFrom=2024-01-01&dateTo=2024-01-31
Supports all list endpoint filters
```

## Date Range Helper

```typescript
// Helper function to create date ranges
function createDateRange(days: number): DateRange {
  return {
    start: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    end: new Date(),
  };
}

// Usage
const last7Days = createDateRange(7);
const last30Days = createDateRange(30);
const last90Days = createDateRange(90);
```

## Common Date Ranges

```typescript
// Today
const today = {
  start: new Date(new Date().setHours(0, 0, 0, 0)),
  end: new Date(),
};

// Yesterday
const yesterday = {
  start: new Date(new Date().setDate(new Date().getDate() - 1)),
  end: new Date(new Date().setHours(0, 0, 0, 0)),
};

// Last 7 days
const last7Days = {
  start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  end: new Date(),
};

// Last 30 days
const last30Days = {
  start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  end: new Date(),
};

// Current month
const currentMonth = {
  start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  end: new Date(),
};

// Last month
const lastMonth = {
  start: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
  end: new Date(new Date().getFullYear(), new Date().getMonth(), 0),
};

// Year to date
const yearToDate = {
  start: new Date(new Date().getFullYear(), 0, 1),
  end: new Date(),
};
```

## Performance Tips

### 1. Use Caching
- Data is cached for 5 minutes automatically
- No need to implement your own caching

### 2. Optimize Date Ranges
- Use specific date ranges instead of all-time queries
- Shorter ranges = faster queries

### 3. Limit Results
- Use reasonable limits for top users queries
- Default limit is 10, max recommended is 100

### 4. Export Best Practices
- Filter data before export
- Be aware of 10,000 record limit
- Use date ranges for large datasets

## Error Handling

```typescript
try {
  const stats = await this.analyticsService.getOverallStats();
} catch (error) {
  if (error instanceof InternalServerErrorException) {
    // Handle analytics service errors
    console.error('Analytics error:', error.message);
  }
  throw error;
}
```

## Testing

```typescript
// Mock the service in tests
const mockAnalyticsService = {
  getOverallStats: jest.fn(),
  getDeliveryStats: jest.fn(),
  getTimeSeries: jest.fn(),
  // ...
};

// Use in test
mockAnalyticsService.getOverallStats.mockResolvedValue({
  total: 100,
  delivered: 90,
  // ...
});
```

## Monitoring

### Key Metrics
```typescript
// Check delivery rate
const stats = await this.analyticsService.getOverallStats();
if (stats.deliveryRate < 90) {
  // Alert: Low delivery rate
}

// Check failure reasons
const failures = await this.analyticsService.getFailureReasons();
if (failures[0].count > 100) {
  // Alert: High failure count
}
```

## Integration Examples

### Create Dashboard Endpoint
```typescript
@Get('dashboard')
async getDashboard() {
  const last30Days = createDateRange(30);

  const [overview, delivery, failures, topUsers] = await Promise.all([
    this.analyticsService.getOverallStats(last30Days),
    this.analyticsService.getDeliveryStats(last30Days),
    this.analyticsService.getFailureReasons(last30Days),
    this.analyticsService.getTopUsers('engaged', 10),
  ]);

  return {
    overview,
    delivery,
    failures,
    topUsers,
  };
}
```

### Scheduled Reports
```typescript
import { Cron } from '@nestjs/schedule';

@Cron('0 9 * * 1') // Every Monday at 9 AM
async sendWeeklyReport() {
  const lastWeek = createDateRange(7);
  const stats = await this.analyticsService.getOverallStats(lastWeek);

  // Send email with stats
  await this.emailService.sendWeeklyReport(stats);
}
```

### Real-time Alerts
```typescript
import { Interval } from '@nestjs/schedule';

@Interval(60000) // Check every minute
async checkDeliveryRate() {
  const lastHour = {
    start: new Date(Date.now() - 60 * 60 * 1000),
    end: new Date(),
  };

  const stats = await this.analyticsService.getOverallStats(lastHour);

  if (stats.deliveryRate < 90) {
    await this.alertService.sendAlert(
      'Low Delivery Rate',
      `Current rate: ${stats.deliveryRate}%`
    );
  }
}
```

## Troubleshooting

### Problem: Slow queries
**Solution:** Use date ranges, check cache, verify indexes

### Problem: Missing data
**Solution:** Verify notification delivery, check date ranges

### Problem: Cache not working
**Solution:** Ensure Redis is running, check cache service

### Problem: Export too large
**Solution:** Use date ranges, be aware of 10k limit

## Support

- Documentation: See ANALYTICS_DOCUMENTATION.md
- Issues: Contact development team
- API: All endpoints documented above
