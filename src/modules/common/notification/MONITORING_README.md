# Notification Queue Monitoring System

Comprehensive monitoring, health checks, and management for the notification queue.

## Quick Start

### 1. Check Queue Health

```bash
curl http://localhost:3000/health/notification-queue
```

### 2. Get Queue Statistics

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/stats
```

### 3. View Failed Jobs

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/failed
```

## What's Included

### Services

- **NotificationQueueMonitorService**: Core monitoring logic, statistics, and queue management
- **NotificationQueueHealthIndicator**: Health checks with configurable thresholds

### Controllers

- **NotificationQueueMonitorController**: Administrative endpoints for queue management
- **NotificationQueueHealthController**: Public and authenticated health check endpoints

### Features

#### Monitoring
- Real-time queue statistics (waiting, active, completed, failed, delayed)
- Performance metrics (processing rate, average time, error rate)
- Job inspection by status
- Worker status and metrics

#### Health Checks
- Basic health check (up/down status)
- Detailed health with issues and recommendations
- Deep health check (connectivity, responsiveness)
- Kubernetes liveness and readiness probes

#### Management
- Retry failed jobs (individual or bulk)
- Pause/resume queue processing
- Clean old completed and failed jobs
- Remove specific jobs

## API Endpoints

### Health Endpoints (Public)

```
GET /health/notification-queue                    - Basic health check
GET /health/notification-queue/liveness           - K8s liveness probe
GET /health/notification-queue/readiness          - K8s readiness probe
```

### Health Endpoints (Authenticated)

```
GET /health/notification-queue/detailed           - Detailed health
GET /health/notification-queue/deep               - Deep health check
```

### Monitoring Endpoints (Authenticated)

```
GET    /notifications/queue/monitor/stats         - Queue statistics
GET    /notifications/queue/monitor/health        - Health status
GET    /notifications/queue/monitor/jobs/:status  - Jobs by status
GET    /notifications/queue/monitor/failed        - Failed jobs
GET    /notifications/queue/monitor/job/:id       - Job details
GET    /notifications/queue/monitor/workers       - Worker metrics

POST   /notifications/queue/monitor/retry/:id     - Retry job
POST   /notifications/queue/monitor/retry-all     - Retry all failed
POST   /notifications/queue/monitor/pause         - Pause queue
POST   /notifications/queue/monitor/resume        - Resume queue
POST   /notifications/queue/monitor/clean/completed - Clean completed
POST   /notifications/queue/monitor/clean/failed - Clean failed

DELETE /notifications/queue/monitor/job/:id       - Remove job
```

## Usage in Code

### Check Health

```typescript
import { NotificationQueueHealthIndicator } from './notification-queue.health';

@Injectable()
export class MyService {
  constructor(private health: NotificationQueueHealthIndicator) {}

  async checkHealth() {
    const result = await this.health.isHealthy('notification-queue');

    if (result['notification-queue'].status === 'up') {
      console.log('Queue is healthy');
    } else {
      console.log('Queue has issues:', result['notification-queue']);
    }
  }
}
```

### Get Statistics

```typescript
import { NotificationQueueMonitorService } from './notification-queue-monitor.service';

@Injectable()
export class MyService {
  constructor(private monitor: NotificationQueueMonitorService) {}

  async getStats() {
    const stats = await this.monitor.getQueueStats();
    console.log(`
      Waiting: ${stats.waiting}
      Active: ${stats.active}
      Failed: ${stats.failed}
      Processing Rate: ${stats.processingRate} jobs/hour
      Error Rate: ${stats.errorRate}%
    `);
  }
}
```

### Manage Queue

```typescript
async manageQueue() {
  // Get failed jobs
  const failed = await this.monitor.getFailedJobs(20);

  // Retry all failed jobs
  const result = await this.monitor.retryAllFailed();
  console.log(`Retried: ${result.retried}, Failed: ${result.failed}`);

  // Clean old completed jobs (older than 1 hour)
  const cleaned = await this.monitor.cleanCompleted(3600000);
  console.log(`Cleaned ${cleaned} jobs`);
}
```

## Health Status Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Active Jobs | 100 | 500 |
| Failed Jobs | 50 | 100 |
| Waiting Jobs | 1,000 | 5,000 |
| Error Rate | 5% | 20% |

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

## Automated Maintenance

### Daily Cleanup
```typescript
import { Cron } from '@nestjs/schedule';

@Injectable()
export class MaintenanceService {
  constructor(private monitor: NotificationQueueMonitorService) {}

  @Cron('0 2 * * *') // Daily at 2 AM
  async cleanCompleted() {
    await this.monitor.cleanCompleted(24 * 60 * 60 * 1000);
  }

  @Cron('0 3 * * 0') // Weekly on Sunday at 3 AM
  async cleanFailed() {
    await this.monitor.cleanFailed(7 * 24 * 60 * 60 * 1000);
  }
}
```

### Health Monitoring
```typescript
@Cron('*/5 * * * *') // Every 5 minutes
async monitorHealth() {
  const health = await this.monitor.getQueueHealthStatus();

  if (!health.isHealthy) {
    // Send alert
    await this.alertService.sendAlert({
      status: health.status,
      issues: health.issues,
      recommendations: health.recommendations,
    });
  }
}
```

## Common Tasks

### View Current Status
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/stats
```

### Check Failed Jobs
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/failed?limit=50
```

### Retry Failed Jobs
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/retry-all
```

### Pause Queue
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/pause
```

### Resume Queue
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/resume
```

### Clean Old Jobs
```bash
# Clean completed jobs older than 1 hour
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/notifications/queue/monitor/clean/completed?grace=3600000"

# Clean failed jobs older than 7 days
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/notifications/queue/monitor/clean/failed?grace=604800000"
```

## Documentation

- **[Complete Guide](./QUEUE_MONITORING_GUIDE.md)**: Comprehensive documentation
- **[Quick Reference](./QUEUE_MONITORING_QUICK_REFERENCE.md)**: Quick commands and snippets
- **[Implementation Summary](./QUEUE_MONITORING_IMPLEMENTATION_SUMMARY.md)**: Technical details
- **[Integration Examples](./examples/queue-monitoring-integration.example.ts)**: Code examples

## Troubleshooting

### High Failed Job Count
1. Check failed jobs: `GET /notifications/queue/monitor/failed`
2. Analyze failure reasons
3. Fix root cause
4. Retry: `POST /notifications/queue/monitor/retry-all`

### Queue Backlog
1. Check stats: `GET /notifications/queue/monitor/stats`
2. Verify workers: `GET /notifications/queue/monitor/workers`
3. Scale workers if needed

### Queue Paused
1. Check health: `GET /health/notification-queue`
2. Resume: `POST /notifications/queue/monitor/resume`

## Monitoring Integration

### Prometheus
Export metrics for Prometheus monitoring:
```typescript
async getPrometheusMetrics() {
  const stats = await this.monitor.getQueueStats();
  return `
    notification_queue_waiting ${stats.waiting}
    notification_queue_active ${stats.active}
    notification_queue_failed ${stats.failed}
    notification_queue_processing_rate ${stats.processingRate}
  `;
}
```

### Grafana
Create dashboards to visualize:
- Job counts over time
- Processing rate trends
- Error rate percentage
- Queue health status

## Best Practices

1. **Monitor Regularly**: Check health every 5 minutes
2. **Set Up Alerts**: Configure alerts for critical thresholds
3. **Clean Regularly**: Remove old jobs daily/weekly
4. **Investigate Failures**: Review failed jobs and fix root causes
5. **Scale Appropriately**: Monitor trends and scale workers as needed

## Support

For detailed information, see the comprehensive guides:
- [QUEUE_MONITORING_GUIDE.md](./QUEUE_MONITORING_GUIDE.md)
- [QUEUE_MONITORING_QUICK_REFERENCE.md](./QUEUE_MONITORING_QUICK_REFERENCE.md)

## License

Part of the notification system.
