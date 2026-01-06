# Queue Monitoring Quick Reference

Quick reference for common monitoring and management operations.

## Quick Commands

### Health Checks

```bash
# Basic health check
curl http://localhost:3000/health/notification-queue

# Detailed health with auth
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/health/notification-queue/detailed

# Deep health check
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/health/notification-queue/deep
```

### Statistics

```bash
# Get queue stats
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/stats

# Get queue health status
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/health
```

### Job Inspection

```bash
# Get failed jobs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/failed?limit=20

# Get waiting jobs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/jobs/waiting?limit=10

# Get active jobs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/jobs/active?limit=10

# Get specific job
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/job/JOB_ID
```

### Queue Management

```bash
# Retry failed job
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/retry/JOB_ID

# Retry all failed jobs
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/retry-all

# Pause queue
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/pause

# Resume queue
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/resume
```

### Cleanup

```bash
# Clean completed jobs (older than 1 hour)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/clean/completed?grace=3600000

# Clean failed jobs (older than 7 days)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/clean/failed?grace=604800000

# Remove specific job
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/job/JOB_ID
```

## Service Usage

### In Your Code

```typescript
import { NotificationQueueMonitorService } from './notification-queue-monitor.service';
import { NotificationQueueHealthIndicator } from './notification-queue.health';

@Injectable()
export class YourService {
  constructor(
    private readonly monitor: NotificationQueueMonitorService,
    private readonly health: NotificationQueueHealthIndicator,
  ) {}

  async checkHealth() {
    // Basic stats
    const stats = await this.monitor.getQueueStats();
    console.log(`Waiting: ${stats.waiting}, Active: ${stats.active}`);

    // Health check
    const healthResult = await this.health.isHealthy('notification-queue');
    console.log(`Healthy: ${healthResult['notification-queue'].status}`);

    // Detailed health
    const detailedHealth = await this.health.getDetailedHealthStatus();
    console.log(`Status: ${detailedHealth.status}`);
    console.log(`Issues: ${detailedHealth.issues.join(', ')}`);
  }

  async manageQueue() {
    // Get failed jobs
    const failed = await this.monitor.getFailedJobs(20);
    console.log(`Failed jobs: ${failed.length}`);

    // Retry specific job
    await this.monitor.retryJob('job-id-123');

    // Retry all failed
    const result = await this.monitor.retryAllFailed();
    console.log(`Retried: ${result.retried}, Failed: ${result.failed}`);

    // Clean old jobs
    const cleaned = await this.monitor.cleanCompleted(3600000); // 1 hour
    console.log(`Cleaned ${cleaned} completed jobs`);
  }
}
```

## Health Status Reference

### Status Levels

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| `healthy` | All systems normal | None |
| `warning` | Approaching limits | Monitor closely |
| `critical` | Exceeds thresholds | Immediate action |

### Common Issues & Fixes

#### High Failed Jobs
```bash
# 1. Check failed jobs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/failed?limit=50

# 2. Investigate common patterns
# 3. Fix root cause
# 4. Retry failed jobs
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/retry-all
```

#### Queue Backlog
```bash
# 1. Check stats
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/stats

# 2. Scale workers if needed
# 3. Monitor processing rate
```

#### Queue Paused
```bash
# Resume queue
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/resume
```

## Monitoring Thresholds

```typescript
const THRESHOLDS = {
  active: {
    warning: 100,
    critical: 500,
  },
  failed: {
    warning: 50,
    critical: 100,
  },
  waiting: {
    warning: 1000,
    critical: 5000,
  },
  errorRate: {
    warning: 5, // percent
    critical: 20, // percent
  },
};
```

## Kubernetes Integration

### Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /health/notification-queue/liveness
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
```

### Readiness Probe
```yaml
readinessProbe:
  httpGet:
    path: /health/notification-queue/readiness
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
```

## Scheduled Tasks Examples

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class QueueMaintenance {
  constructor(private monitor: NotificationQueueMonitorService) {}

  // Daily cleanup at 2 AM
  @Cron('0 2 * * *')
  async dailyCleanup() {
    await this.monitor.cleanCompleted(24 * 60 * 60 * 1000);
  }

  // Weekly cleanup on Sunday at 3 AM
  @Cron('0 3 * * 0')
  async weeklyCleanup() {
    await this.monitor.cleanFailed(7 * 24 * 60 * 60 * 1000);
  }

  // Health check every 5 minutes
  @Cron(CronExpression.EVERY_5_MINUTES)
  async healthCheck() {
    const health = await this.monitor.getQueueHealthStatus();
    if (!health.isHealthy) {
      // Send alert
    }
  }
}
```

## Response Examples

### Stats Response
```json
{
  "waiting": 45,
  "active": 12,
  "completed": 15234,
  "failed": 23,
  "delayed": 5,
  "total": 15319,
  "isPaused": false,
  "processingRate": 234,
  "averageProcessingTime": 1250,
  "errorRate": 0.15
}
```

### Health Response
```json
{
  "isHealthy": true,
  "status": "healthy",
  "issues": [],
  "recommendations": [],
  "metrics": {
    "failedJobsCount": 23,
    "activeJobsCount": 12,
    "waitingJobsCount": 45,
    "delayedJobsCount": 5
  }
}
```

### Job Info Response
```json
{
  "id": "email-123-1704441600000",
  "name": "send-email",
  "state": "failed",
  "attemptsMade": 3,
  "failedReason": "Connection timeout",
  "timestamp": 1704441600000,
  "data": {
    "notificationId": "123",
    "channel": "EMAIL",
    "recipientEmail": "user@example.com"
  }
}
```

## Time Conversion Helper

```javascript
const TIME = {
  ONE_MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
};

// Clean jobs older than 1 hour
?grace=${TIME.ONE_HOUR}

// Clean jobs older than 1 week
?grace=${TIME.ONE_WEEK}
```

## Error Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad Request (invalid parameters) |
| 401 | Unauthorized (missing/invalid token) |
| 404 | Not Found (job doesn't exist) |
| 500 | Internal Server Error |

## Quick Troubleshooting

1. **Queue stuck?** → Check pause status → Resume if needed
2. **Too many failures?** → Check failed jobs → Investigate → Retry
3. **High backlog?** → Check workers → Scale if needed
4. **Slow processing?** → Check averageProcessingTime → Optimize
5. **Memory issues?** → Clean old jobs → Reduce retention

## Need More Help?

- Full Documentation: [QUEUE_MONITORING_GUIDE.md](./QUEUE_MONITORING_GUIDE.md)
- Integration Examples: [examples/queue-monitoring-integration.example.ts](./examples/queue-monitoring-integration.example.ts)
- Queue Documentation: [NOTIFICATION_QUEUE_README.md](./NOTIFICATION_QUEUE_README.md)
