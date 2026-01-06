# Notification Queue Monitoring Guide

This guide provides comprehensive information about monitoring and managing the notification queue system.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Monitoring Endpoints](#monitoring-endpoints)
4. [Health Checks](#health-checks)
5. [Metrics and Statistics](#metrics-and-statistics)
6. [Queue Management](#queue-management)
7. [Alerting and Thresholds](#alerting-and-thresholds)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

## Overview

The notification queue monitoring system provides comprehensive insights into the health, performance, and status of the notification delivery pipeline. It includes:

- **Real-time metrics**: Job counts, processing rates, error rates
- **Health indicators**: System health status with actionable recommendations
- **Queue management**: Pause, resume, retry, and clean operations
- **Deep insights**: Job details, failure analysis, worker metrics

## Architecture

### Components

1. **NotificationQueueMonitorService**
   - Core monitoring logic
   - Statistics aggregation
   - Queue operations

2. **NotificationQueueHealthIndicator**
   - Health check implementations
   - Status evaluation
   - Threshold monitoring

3. **NotificationQueueMonitorController**
   - Management endpoints
   - Administrative operations
   - Authenticated access

4. **NotificationQueueHealthController**
   - Public health endpoints
   - Kubernetes probes
   - Monitoring system integration

## Monitoring Endpoints

### Statistics

#### Get Queue Statistics
```http
GET /notifications/queue/monitor/stats
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "waiting": 45,
    "active": 12,
    "completed": 15234,
    "failed": 23,
    "delayed": 5,
    "paused": 0,
    "total": 15319,
    "isPaused": false,
    "processingRate": 234,
    "averageProcessingTime": 1250,
    "errorRate": 0.15
  },
  "message": "Queue statistics retrieved successfully"
}
```

**Metrics Explained:**
- `waiting`: Jobs queued and ready to process
- `active`: Jobs currently being processed
- `completed`: Successfully completed jobs (retained count)
- `failed`: Jobs that failed after all retries
- `delayed`: Jobs scheduled for future execution
- `processingRate`: Jobs completed per hour
- `averageProcessingTime`: Average time to process a job (ms)
- `errorRate`: Percentage of failed jobs

### Health Status

#### Basic Health Check
```http
GET /notifications/queue/monitor/health
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "isHealthy": true,
    "status": "healthy",
    "issues": [],
    "recommendations": [],
    "metrics": {
      "failedJobsCount": 23,
      "activeJobsCount": 12,
      "waitingJobsCount": 45,
      "delayedJobsCount": 5,
      "stalledJobsCount": 0
    }
  },
  "message": "Queue health status: healthy"
}
```

**Status Levels:**
- `healthy`: All metrics within acceptable ranges
- `warning`: Some metrics approaching thresholds
- `critical`: Metrics exceed critical thresholds

### Job Inspection

#### Get Jobs by Status
```http
GET /notifications/queue/monitor/jobs/:status?limit=10
Authorization: Bearer <token>
```

**Parameters:**
- `status`: `waiting`, `active`, `completed`, `failed`, `delayed`
- `limit`: Maximum number of jobs to return (default: 10)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "email-123-1704441600000",
      "name": "send-email",
      "data": {
        "notificationId": "123",
        "channel": "EMAIL",
        "recipientEmail": "user@example.com",
        "title": "Welcome",
        "body": "Welcome to our platform"
      },
      "timestamp": 1704441600000,
      "processedOn": 1704441601250,
      "finishedOn": 1704441602500,
      "attemptsMade": 1,
      "state": "completed",
      "progress": 100
    }
  ],
  "meta": {
    "status": "completed",
    "count": 1,
    "limit": 10
  },
  "message": "Retrieved 1 completed jobs"
}
```

#### Get Failed Jobs
```http
GET /notifications/queue/monitor/failed?limit=20
Authorization: Bearer <token>
```

**Response includes:**
- Full job details
- Failure reason
- Stack trace (if available)
- Attempt count
- Timestamps

#### Get Job by ID
```http
GET /notifications/queue/monitor/job/:id
Authorization: Bearer <token>
```

### Queue Management

#### Retry Failed Job
```http
POST /notifications/queue/monitor/retry/:id
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "email-123-1704441600000"
  },
  "message": "Job email-123-1704441600000 retried successfully"
}
```

#### Retry All Failed Jobs
```http
POST /notifications/queue/monitor/retry-all
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "retried": 18,
    "failed": 5
  },
  "message": "Retried 18 failed jobs (5 failed to retry)"
}
```

#### Pause Queue
```http
POST /notifications/queue/monitor/pause
Authorization: Bearer <token>
```

**Use Cases:**
- Emergency maintenance
- System updates
- Debugging issues
- Rate limiting

#### Resume Queue
```http
POST /notifications/queue/monitor/resume
Authorization: Bearer <token>
```

#### Clean Completed Jobs
```http
POST /notifications/queue/monitor/clean/completed?grace=3600000
Authorization: Bearer <token>
```

**Parameters:**
- `grace`: Grace period in milliseconds (default: 1 hour)

**Response:**
```json
{
  "success": true,
  "data": {
    "cleaned": 1234,
    "gracePeriod": 3600000
  },
  "message": "Cleaned 1234 completed jobs older than 3600000ms"
}
```

#### Clean Failed Jobs
```http
POST /notifications/queue/monitor/clean/failed?grace=604800000
Authorization: Bearer <token>
```

**Parameters:**
- `grace`: Grace period in milliseconds (default: 7 days)

#### Remove Specific Job
```http
DELETE /notifications/queue/monitor/job/:id
Authorization: Bearer <token>
```

### Worker Metrics

#### Get Worker Status
```http
GET /notifications/queue/monitor/workers
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "notification-worker",
      "isRunning": true,
      "isActive": true,
      "isIdle": false
    }
  ],
  "message": "Worker metrics retrieved successfully"
}
```

## Health Checks

### Kubernetes Integration

The system provides health endpoints optimized for Kubernetes and container orchestrators:

#### Liveness Probe
```http
GET /health/notification-queue/liveness
```

**Response:**
```json
{
  "status": "alive",
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

**Kubernetes Configuration:**
```yaml
livenessProbe:
  httpGet:
    path: /health/notification-queue/liveness
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

#### Readiness Probe
```http
GET /health/notification-queue/readiness
```

**Response:**
```json
{
  "status": "ready",
  "ready": true,
  "timestamp": "2026-01-05T12:00:00.000Z"
}
```

**Kubernetes Configuration:**
```yaml
readinessProbe:
  httpGet:
    path: /health/notification-queue/readiness
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

### Detailed Health Checks

#### Basic Health Check
```http
GET /health/notification-queue
```

**Public endpoint** - No authentication required

#### Detailed Health Check
```http
GET /health/notification-queue/detailed
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "isHealthy": true,
    "status": "healthy",
    "timestamp": "2026-01-05T12:00:00.000Z",
    "metrics": {
      "active": 12,
      "waiting": 45,
      "completed": 15234,
      "failed": 23,
      "delayed": 5,
      "paused": false
    },
    "issues": [],
    "recommendations": []
  },
  "message": "Queue status: healthy"
}
```

#### Deep Health Check
```http
GET /health/notification-queue/deep
Authorization: Bearer <token>
```

**Checks:**
- Queue connectivity
- Queue responsiveness
- Metrics availability
- Redis connection

## Alerting and Thresholds

### Default Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Active Jobs | 100 | 500 |
| Failed Jobs | 50 | 100 |
| Waiting Jobs | 1,000 | 5,000 |
| Error Rate | 5% | 20% |
| Queue Paused | ⚠️ | - |

### Health Status Determination

1. **Healthy**
   - All metrics within normal ranges
   - No issues detected
   - Queue processing normally

2. **Warning (Degraded)**
   - One or more metrics approaching thresholds
   - Recommendations provided
   - Queue still functional

3. **Critical (Unhealthy)**
   - Metrics exceed critical thresholds
   - Immediate action required
   - Service degradation likely

### Sample Alerts

#### High Active Jobs
```json
{
  "issue": "High number of active jobs: 450",
  "recommendation": "Consider scaling workers or optimizing job processing",
  "status": "warning"
}
```

#### High Failed Jobs
```json
{
  "issue": "High number of failed jobs: 120",
  "recommendation": "Critical: Investigate and fix job failures immediately",
  "status": "critical"
}
```

#### Large Backlog
```json
{
  "issue": "Large backlog of waiting jobs: 6000",
  "recommendation": "Critical: Increase worker capacity urgently",
  "status": "critical"
}
```

## Best Practices

### Monitoring

1. **Set Up Alerts**
   - Configure alerts for critical thresholds
   - Monitor health endpoints regularly
   - Use both basic and detailed health checks

2. **Regular Maintenance**
   - Clean completed jobs daily
   - Clean failed jobs weekly
   - Review failed jobs regularly

3. **Performance Optimization**
   - Monitor processing rates
   - Track average processing time
   - Identify bottlenecks early

### Queue Management

1. **Job Retries**
   - Review failed jobs before mass retry
   - Investigate failure patterns
   - Fix root causes before retrying

2. **Pause Operations**
   - Use pause sparingly
   - Document pause reasons
   - Resume as soon as possible

3. **Cleanup Strategy**
   ```javascript
   // Daily cleanup (automated)
   POST /notifications/queue/monitor/clean/completed?grace=86400000  // 24 hours

   // Weekly cleanup (automated)
   POST /notifications/queue/monitor/clean/failed?grace=604800000    // 7 days
   ```

### Integration with Monitoring Tools

#### Prometheus Metrics (Example)
```javascript
// Custom metrics endpoint integration
async getPrometheusMetrics() {
  const stats = await monitorService.getQueueStats();

  return `
    # HELP notification_queue_waiting Number of waiting jobs
    # TYPE notification_queue_waiting gauge
    notification_queue_waiting ${stats.waiting}

    # HELP notification_queue_active Number of active jobs
    # TYPE notification_queue_active gauge
    notification_queue_active ${stats.active}

    # HELP notification_queue_failed Number of failed jobs
    # TYPE notification_queue_failed gauge
    notification_queue_failed ${stats.failed}

    # HELP notification_queue_processing_rate Jobs processed per hour
    # TYPE notification_queue_processing_rate gauge
    notification_queue_processing_rate ${stats.processingRate}
  `;
}
```

#### Grafana Dashboard
Create dashboards monitoring:
- Job counts over time
- Processing rate trends
- Error rate trends
- Queue health status
- Average processing time

## Troubleshooting

### Common Issues

#### High Number of Failed Jobs

**Symptoms:**
- Failed job count > 50
- Error rate > 5%

**Investigation:**
```http
GET /notifications/queue/monitor/failed?limit=50
```

**Steps:**
1. Review failure reasons
2. Check for common patterns
3. Verify external service availability (email, SMS)
4. Check credentials and configuration
5. Review job data validity

#### Queue Backlog

**Symptoms:**
- Waiting jobs > 1,000
- Processing rate declining

**Investigation:**
```http
GET /notifications/queue/monitor/stats
GET /notifications/queue/monitor/workers
```

**Steps:**
1. Check worker status
2. Verify Redis connectivity
3. Review system resources
4. Consider scaling workers
5. Optimize job processing

#### Queue Paused

**Symptoms:**
- isPaused: true
- No jobs processing

**Resolution:**
```http
POST /notifications/queue/monitor/resume
```

#### High Active Jobs

**Symptoms:**
- Active jobs > 100
- Jobs not completing

**Investigation:**
```http
GET /notifications/queue/monitor/jobs/active?limit=100
```

**Steps:**
1. Check for stalled jobs
2. Review processing time
3. Check external service latency
4. Verify timeout configurations
5. Consider increasing workers

### Debugging Commands

```bash
# Check queue health
curl http://localhost:3000/health/notification-queue

# Get detailed statistics
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/stats

# Review failed jobs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/failed

# Check specific job
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/job/email-123-1704441600000

# Retry all failed jobs
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/notifications/queue/monitor/retry-all
```

## Additional Resources

- [Notification Queue Documentation](./NOTIFICATION_QUEUE_README.md)
- [Bull Queue Documentation](https://github.com/OptimalBits/bull)
- [NestJS Bull Module](https://docs.nestjs.com/techniques/queues)
- [Redis Best Practices](https://redis.io/topics/best-practices)

## Support

For issues or questions:
1. Check this documentation
2. Review application logs
3. Check health endpoints
4. Contact DevOps team
5. Create GitHub issue
