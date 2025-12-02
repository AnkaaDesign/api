# API Monitoring & Health Check Endpoints

## Overview

The Ankaa API provides comprehensive monitoring and health check endpoints to track system performance, resource utilization, and service health in real-time.

## Base URL

- **Development:** `http://localhost:3030`
- **Staging:** `https://test.api.ankaa.live`
- **Production:** `https://api.ankaa.live`

## Authentication

All monitoring endpoints require authentication via JWT token.

### Required Headers
```http
Authorization: Bearer <your-jwt-token>
```

### Required Privileges
Users must have one of the following sector privileges:
- MAINTENANCE
- WAREHOUSE
- DESIGNER
- LOGISTIC
- FINANCIAL
- PRODUCTION
- LEADER
- HUMAN_RESOURCES
- ADMIN
- EXTERNAL

## Endpoints

### 1. Get Current Health Status

Get the current health status of the system.

**Endpoint:** `GET /monitoring/health`

**Rate Limit:** Standard read rate limit applied

**Request:**
```bash
curl -X GET \
  'http://localhost:3030/monitoring/health' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Estado de saúde do sistema obtido com sucesso",
  "data": {
    "timestamp": "2025-11-30T14:34:42.719Z",
    "status": "healthy",
    "resources": {
      "cpu": {
        "usage": 45.2,
        "loadAverage": [1.23, 1.45, 1.52]
      },
      "memory": {
        "used": 4294967296,
        "total": 16777216000,
        "percentage": 25.6
      },
      "disk": {
        "used": 107374182400,
        "total": 536870912000,
        "percentage": 20.0
      }
    },
    "services": {
      "healthy": 5,
      "unhealthy": 0,
      "total": 5
    },
    "alerts": []
  }
}
```

**Status Values:**
- `healthy` - All systems operating normally
- `warning` - Some metrics approaching thresholds
- `critical` - One or more critical thresholds exceeded

**Alert Types & Severities:**

CPU Alerts:
- Warning: ≥75% usage
- Critical: ≥90% usage

Memory Alerts:
- Warning: ≥75% usage
- Critical: ≥90% usage

Disk Alerts:
- Warning: ≥85% usage
- Critical: ≥90% usage

Service Alerts:
- Warning: 1-2 services down
- Critical: ≥3 services down

---

### 2. Get Health History

Retrieve historical health metrics for analysis and trending.

**Endpoint:** `GET /monitoring/health/history`

**Rate Limit:** Standard read rate limit applied

**Query Parameters:**
| Parameter | Type | Required | Default | Max | Description |
|-----------|------|----------|---------|-----|-------------|
| hours | integer | No | 24 | 720 | Number of hours of history to retrieve |

**Request:**
```bash
# Get last 24 hours (default)
curl -X GET \
  'http://localhost:3030/monitoring/health/history' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'

# Get last 7 days
curl -X GET \
  'http://localhost:3030/monitoring/health/history?hours=168' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'

# Get last 30 days (maximum)
curl -X GET \
  'http://localhost:3030/monitoring/health/history?hours=720' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Histórico de saúde dos últimos 24 horas obtido com sucesso",
  "data": [
    {
      "timestamp": "2025-11-30T14:30:00.000Z",
      "status": "healthy",
      "resources": {
        "cpu": {
          "usage": 42.1,
          "loadAverage": [1.2, 1.3, 1.4]
        },
        "memory": {
          "used": 4194304000,
          "total": 16777216000,
          "percentage": 25.0
        },
        "disk": {
          "used": 107374182400,
          "total": 536870912000,
          "percentage": 20.0
        }
      },
      "services": {
        "healthy": 5,
        "unhealthy": 0,
        "total": 5
      },
      "alerts": []
    },
    {
      "timestamp": "2025-11-30T14:25:00.000Z",
      "status": "warning",
      "resources": {
        "cpu": {
          "usage": 78.5,
          "loadAverage": [2.1, 2.3, 2.4]
        },
        "memory": {
          "used": 4194304000,
          "total": 16777216000,
          "percentage": 25.0
        },
        "disk": {
          "used": 107374182400,
          "total": 536870912000,
          "percentage": 20.0
        }
      },
      "services": {
        "healthy": 5,
        "unhealthy": 0,
        "total": 5
      },
      "alerts": [
        {
          "type": "CPU",
          "severity": "warning",
          "message": "Uso de CPU elevado: 78.5%"
        }
      ]
    }
  ],
  "meta": {
    "hours": 24,
    "count": 288
  }
}
```

**Notes:**
- Metrics are collected every 5 minutes
- Maximum retention: 720 hours (30 days)
- Historical data is automatically cleaned up after retention period
- If no history is available, returns at least current health status

---

### 3. Refresh Health Metrics

Force an immediate collection of health metrics (admin/maintenance only).

**Endpoint:** `POST /monitoring/health/refresh`

**Rate Limit:** Standard read rate limit applied

**Required Privileges:** MAINTENANCE or ADMIN only

**Request:**
```bash
curl -X POST \
  'http://localhost:3030/monitoring/health/refresh' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Métricas de saúde atualizadas com sucesso",
  "data": {
    "timestamp": "2025-11-30T14:35:42.719Z",
    "status": "healthy",
    "resources": {
      "cpu": {
        "usage": 45.2,
        "loadAverage": [1.23, 1.45, 1.52]
      },
      "memory": {
        "used": 4294967296,
        "total": 16777216000,
        "percentage": 25.6
      },
      "disk": {
        "used": 107374182400,
        "total": 536870912000,
        "percentage": 20.0
      }
    },
    "services": {
      "healthy": 5,
      "unhealthy": 0,
      "total": 5
    },
    "alerts": []
  }
}
```

**Use Cases:**
- Manual health check trigger
- Debugging system issues
- Verifying system state after maintenance
- Testing monitoring system

---

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Token inválido ou expirado",
  "error": "UNAUTHORIZED"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "Permissão insuficiente para acessar este recurso",
  "error": "FORBIDDEN"
}
```

### 429 Too Many Requests
```json
{
  "success": false,
  "message": "Muitas requisições. Tente novamente em alguns instantes",
  "error": "RATE_LIMIT_EXCEEDED"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Erro ao obter métricas de saúde",
  "error": "INTERNAL_SERVER_ERROR"
}
```

---

## Data Collection Schedule

The monitoring system automatically collects metrics using the following schedule:

| Metric Type | Collection Frequency | Retention Period |
|-------------|---------------------|------------------|
| CPU Usage | Every 5 minutes | 30 days |
| Memory Usage | Every 5 minutes | 30 days |
| Disk Usage | Every 5 minutes | 30 days |
| Service Health | Every 5 minutes | 30 days |
| System Uptime | Every 5 minutes | 30 days |

**Total Data Points:** Up to 720 entries (5-minute intervals × 144 per day × 30 days)

---

## Metric Definitions

### CPU Metrics

**usage** (number)
- Current CPU utilization percentage
- Range: 0-100
- Calculation: Average across all CPU cores

**loadAverage** (array of 3 numbers)
- System load average over 1, 5, and 15 minutes
- Format: `[1min, 5min, 15min]`
- Interpretation: Values > number of CPU cores indicate high load

### Memory Metrics

**used** (number)
- Currently used memory in bytes
- Includes buffers and cache

**total** (number)
- Total system memory in bytes
- Physical RAM available to the system

**percentage** (number)
- Memory utilization percentage
- Range: 0-100
- Calculation: `(used / total) × 100`

### Disk Metrics

**used** (number)
- Currently used disk space in bytes
- Includes all mounted volumes

**total** (number)
- Total disk space in bytes
- Sum of all available storage

**percentage** (number)
- Disk utilization percentage
- Range: 0-100
- Calculation: `(used / total) × 100`

### Service Metrics

**healthy** (number)
- Count of services in "running" state

**unhealthy** (number)
- Count of services not in "running" state

**total** (number)
- Total number of monitored services

---

## Alert Examples

### CPU Warning Alert
```json
{
  "type": "CPU",
  "severity": "warning",
  "message": "Uso de CPU elevado: 78.5%"
}
```

### Memory Critical Alert
```json
{
  "type": "Memory",
  "severity": "critical",
  "message": "Uso de memória crítico: 92.3%"
}
```

### Disk Warning Alert
```json
{
  "type": "Disk",
  "severity": "warning",
  "message": "Uso de disco elevado: 87.1%"
}
```

### Service Alert
```json
{
  "type": "Services",
  "severity": "warning",
  "message": "1 serviço(s) não está(ão) em execução"
}
```

---

## Integration Examples

### JavaScript/TypeScript
```typescript
import axios from 'axios';

const API_URL = 'http://localhost:3030';
const JWT_TOKEN = 'your-jwt-token';

// Get current health
async function getCurrentHealth() {
  try {
    const response = await axios.get(`${API_URL}/monitoring/health`, {
      headers: {
        Authorization: `Bearer ${JWT_TOKEN}`
      }
    });

    console.log('Health Status:', response.data.data.status);
    console.log('CPU Usage:', response.data.data.resources.cpu.usage);

    if (response.data.data.alerts.length > 0) {
      console.warn('Active Alerts:', response.data.data.alerts);
    }

    return response.data;
  } catch (error) {
    console.error('Failed to get health status:', error);
    throw error;
  }
}

// Get health history
async function getHealthHistory(hours = 24) {
  try {
    const response = await axios.get(`${API_URL}/monitoring/health/history`, {
      params: { hours },
      headers: {
        Authorization: `Bearer ${JWT_TOKEN}`
      }
    });

    console.log(`Retrieved ${response.data.meta.count} data points`);
    return response.data.data;
  } catch (error) {
    console.error('Failed to get health history:', error);
    throw error;
  }
}

// Monitor health continuously
function startHealthMonitoring(intervalMs = 60000) {
  return setInterval(async () => {
    const health = await getCurrentHealth();

    if (health.data.status === 'critical') {
      // Send alert to your monitoring system
      console.error('CRITICAL: System health is critical!');
    }
  }, intervalMs);
}
```

### Python
```python
import requests
import time

API_URL = "http://localhost:3030"
JWT_TOKEN = "your-jwt-token"

def get_current_health():
    response = requests.get(
        f"{API_URL}/monitoring/health",
        headers={"Authorization": f"Bearer {JWT_TOKEN}"}
    )
    response.raise_for_status()
    data = response.json()

    print(f"Health Status: {data['data']['status']}")
    print(f"CPU Usage: {data['data']['resources']['cpu']['usage']}%")

    if data['data']['alerts']:
        print(f"Active Alerts: {data['data']['alerts']}")

    return data

def monitor_health(interval_seconds=60):
    while True:
        try:
            health = get_current_health()

            if health['data']['status'] == 'critical':
                print("CRITICAL: System health is critical!")
                # Send alert to your monitoring system
        except Exception as e:
            print(f"Error monitoring health: {e}")

        time.sleep(interval_seconds)
```

### cURL Script
```bash
#!/bin/bash

API_URL="http://localhost:3030"
JWT_TOKEN="your-jwt-token"

# Get current health and check status
get_health() {
  response=$(curl -s -X GET \
    "${API_URL}/monitoring/health" \
    -H "Authorization: Bearer ${JWT_TOKEN}")

  status=$(echo "$response" | jq -r '.data.status')

  if [ "$status" == "critical" ]; then
    echo "CRITICAL: System health is critical!"
    echo "$response" | jq '.data.alerts'
    # Send notification
    exit 1
  elif [ "$status" == "warning" ]; then
    echo "WARNING: System health issues detected"
    echo "$response" | jq '.data.alerts'
  else
    echo "OK: System is healthy"
  fi
}

# Run health check
get_health
```

---

## Monitoring Best Practices

### 1. Set Up Alerts
- Configure automated alerts for critical and warning statuses
- Use multiple notification channels (email, Slack, PagerDuty)
- Set up escalation policies for unacknowledged alerts

### 2. Track Trends
- Monitor CPU usage patterns to identify peak times
- Track memory growth over time to detect memory leaks
- Monitor disk usage growth to plan capacity

### 3. Regular Reviews
- Review health history weekly for patterns
- Adjust alert thresholds based on actual usage
- Document and investigate recurring alerts

### 4. Integration
- Integrate with existing monitoring tools (Grafana, Prometheus)
- Set up dashboards for real-time visibility
- Export historical data for long-term analysis

### 5. Incident Response
- Document runbooks for common alert scenarios
- Test alert notifications regularly
- Review and update monitoring configuration quarterly

---

## Troubleshooting

### No Data Returned
- Verify JWT token is valid and not expired
- Check user has required privileges
- Ensure monitoring service is running

### Stale Data
- Use refresh endpoint to force metric collection
- Check cron job is running (`@Cron(CronExpression.EVERY_5_MINUTES)`)
- Verify system time is correct

### High Resource Usage in Monitoring
- Review history retention settings
- Reduce collection frequency if needed
- Check for memory leaks in monitoring service

---

## Support

For issues or questions about monitoring endpoints:
- Check application logs in `./logs/`
- Review monitoring service logs
- Contact system administrator

**Last Updated:** 2025-11-30
