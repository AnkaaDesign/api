# Notification Admin API Documentation

## Overview

The Notification Admin API provides comprehensive endpoints for tracking, analyzing, and managing notifications across the system. All endpoints require **ADMIN privileges** for access.

**Base URL:** `/admin/notifications`

**Authentication:** Bearer token with ADMIN role required for all endpoints.

---

## Endpoints

### 1. List All Notifications

**GET** `/admin/notifications`

Get a paginated list of all notifications with advanced filtering capabilities.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | `NOTIFICATION_TYPE` | No | Filter by notification type (SYSTEM, TASK, ORDER, PPE, VACATION, WARNING, STOCK, GENERAL) |
| `channel` | `NOTIFICATION_CHANNEL` | No | Filter by channel (EMAIL, SMS, PUSH, IN_APP) |
| `status` | `string` | No | Filter by status: `sent`, `scheduled`, `pending` |
| `deliveryStatus` | `string` | No | Filter by delivery status: `delivered`, `failed`, `pending` |
| `userId` | `string` | No | Filter by user ID |
| `sectorId` | `string` | No | Filter by sector ID |
| `dateFrom` | `ISO 8601` | No | Filter notifications created from this date |
| `dateTo` | `ISO 8601` | No | Filter notifications created until this date |
| `page` | `number` | No | Page number (default: 1) |
| `limit` | `number` | No | Items per page (default: 20) |
| `orderBy` | `string` | No | Field to order by (default: `createdAt`) |
| `order` | `asc \| desc` | No | Order direction (default: `desc`) |

#### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "notification-id",
      "title": "Notification Title",
      "body": "Notification body content",
      "type": "TASK",
      "channel": ["EMAIL", "IN_APP"],
      "importance": "HIGH",
      "sentAt": "2026-01-05T10:00:00Z",
      "scheduledAt": null,
      "user": {
        "id": "user-id",
        "name": "John Doe",
        "email": "john@example.com",
        "sector": {
          "id": "sector-id",
          "name": "Production"
        }
      },
      "deliveries": [
        {
          "id": "delivery-id",
          "channel": "EMAIL",
          "status": "DELIVERED",
          "sentAt": "2026-01-05T10:00:00Z",
          "deliveredAt": "2026-01-05T10:00:05Z",
          "failedAt": null,
          "errorMessage": null
        }
      ],
      "seenBy": [
        {
          "userId": "user-id",
          "seenAt": "2026-01-05T10:05:00Z"
        }
      ]
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPreviousPage": false
  },
  "message": "Notificações carregadas com sucesso."
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/admin/notifications?type=TASK&status=sent&page=1&limit=20" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 2. Get Notification Details

**GET** `/admin/notifications/:id`

Get detailed information about a specific notification including all deliveries and seen status.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Notification ID |

#### Response

```json
{
  "success": true,
  "data": {
    "id": "notification-id",
    "title": "Task Assignment",
    "body": "You have been assigned to a new task",
    "type": "TASK",
    "channel": ["EMAIL", "IN_APP", "PUSH"],
    "importance": "HIGH",
    "actionType": "TASK_VIEW",
    "actionUrl": "/tasks/task-id",
    "sentAt": "2026-01-05T10:00:00Z",
    "scheduledAt": null,
    "user": {
      "id": "user-id",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "sector": {
        "id": "sector-id",
        "name": "Production"
      }
    },
    "deliveries": [
      {
        "id": "delivery-1",
        "channel": "EMAIL",
        "status": "DELIVERED",
        "sentAt": "2026-01-05T10:00:00Z",
        "deliveredAt": "2026-01-05T10:00:05Z",
        "failedAt": null,
        "errorMessage": null
      },
      {
        "id": "delivery-2",
        "channel": "PUSH",
        "status": "FAILED",
        "sentAt": "2026-01-05T10:00:00Z",
        "deliveredAt": null,
        "failedAt": "2026-01-05T10:00:03Z",
        "errorMessage": "Device token not found"
      }
    ],
    "seenBy": [
      {
        "userId": "user-id",
        "seenAt": "2026-01-05T10:05:00Z",
        "user": {
          "id": "user-id",
          "name": "John Doe",
          "email": "john@example.com"
        }
      }
    ],
    "metrics": {
      "delivery": {
        "totalDeliveries": 3,
        "deliveredCount": 2,
        "failedCount": 1,
        "pendingCount": 0,
        "averageDeliveryTime": 5000
      },
      "seen": {
        "totalSeen": 1,
        "firstSeenAt": "2026-01-05T10:05:00Z",
        "lastSeenAt": "2026-01-05T10:05:00Z"
      }
    }
  },
  "message": "Detalhes da notificação carregados com sucesso."
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/admin/notifications/notification-id" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 3. Get Overall Statistics

**GET** `/admin/notifications/stats/overview`

Get comprehensive notification statistics including delivery rates, seen rates, and failure analysis.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | `ISO 8601` | No | Start date for statistics |
| `dateTo` | `ISO 8601` | No | End date for statistics |

#### Response

```json
{
  "success": true,
  "data": {
    "total": 5000,
    "byType": {
      "SYSTEM": 500,
      "TASK": 2000,
      "ORDER": 1000,
      "PPE": 300,
      "VACATION": 400,
      "WARNING": 200,
      "STOCK": 500,
      "GENERAL": 100
    },
    "byChannel": {
      "EMAIL": 3000,
      "SMS": 1000,
      "PUSH": 2500,
      "IN_APP": 4500
    },
    "deliveryRate": {
      "email": {
        "sent": 3000,
        "delivered": 2850,
        "failed": 150
      },
      "sms": {
        "sent": 1000,
        "delivered": 950,
        "failed": 50
      },
      "push": {
        "sent": 2500,
        "delivered": 2300,
        "failed": 200
      },
      "whatsapp": {
        "sent": 500,
        "delivered": 480,
        "failed": 20
      },
      "inApp": {
        "sent": 4500,
        "seen": 3600
      }
    },
    "seenRate": 72.5,
    "averageDeliveryTime": 3500,
    "failureReasons": {
      "Invalid email address": 80,
      "User not found": 50,
      "Network timeout": 120,
      "Device token not found": 100,
      "SMS quota exceeded": 20
    }
  },
  "message": "Estatísticas carregadas com sucesso."
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/admin/notifications/stats/overview?dateFrom=2026-01-01&dateTo=2026-01-31" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 4. Get Delivery Report

**GET** `/admin/notifications/reports/delivery`

Generate a comprehensive delivery report with time series data, channel performance, and user engagement metrics.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dateFrom` | `ISO 8601` | No | Start date for report |
| `dateTo` | `ISO 8601` | No | End date for report |
| `groupBy` | `day \| hour` | No | Time series grouping (default: `day`) |

#### Response

```json
{
  "success": true,
  "data": {
    "timeSeries": [
      {
        "date": "2026-01-05",
        "sent": 150,
        "delivered": 140,
        "failed": 10
      },
      {
        "date": "2026-01-06",
        "sent": 200,
        "delivered": 185,
        "failed": 15
      }
    ],
    "channelPerformance": [
      {
        "channel": "EMAIL",
        "sent": 3000,
        "delivered": 2850,
        "failed": 150,
        "successRate": 95.0
      },
      {
        "channel": "SMS",
        "sent": 1000,
        "delivered": 950,
        "failed": 50,
        "successRate": 95.0
      },
      {
        "channel": "PUSH",
        "sent": 2500,
        "delivered": 2300,
        "failed": 200,
        "successRate": 92.0
      }
    ],
    "topFailureReasons": [
      {
        "reason": "Network timeout",
        "count": 120,
        "percentage": 28.57
      },
      {
        "reason": "Device token not found",
        "count": 100,
        "percentage": 23.81
      },
      {
        "reason": "Invalid email address",
        "count": 80,
        "percentage": 19.05
      }
    ],
    "userEngagement": {
      "totalSent": 5000,
      "totalSeen": 3600,
      "seenRate": 72.0,
      "averageSeenTime": 15.5
    }
  },
  "message": "Relatório de entrega gerado com sucesso."
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/admin/notifications/reports/delivery?dateFrom=2026-01-01&groupBy=day" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 5. Get User Notification History

**GET** `/admin/notifications/user/:userId`

Get complete notification history for a specific user including delivery status, seen status, and preferences.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | `string` | Yes | User ID |

#### Response

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user-id",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "notifications": [
      {
        "id": "notification-1",
        "title": "Task Assignment",
        "body": "You have been assigned to Task #123",
        "type": "TASK",
        "importance": "HIGH",
        "sentAt": "2026-01-05T10:00:00Z",
        "scheduledAt": null,
        "deliveries": [
          {
            "channel": "EMAIL",
            "status": "DELIVERED",
            "sentAt": "2026-01-05T10:00:00Z",
            "deliveredAt": "2026-01-05T10:00:05Z",
            "failedAt": null,
            "errorMessage": null
          }
        ],
        "isSeen": true,
        "seenAt": "2026-01-05T10:05:00Z"
      }
    ],
    "preferences": [
      {
        "notificationType": "TASK",
        "enabled": true,
        "channels": ["EMAIL", "IN_APP"]
      },
      {
        "notificationType": "ORDER",
        "enabled": false,
        "channels": []
      }
    ],
    "stats": {
      "totalReceived": 150,
      "totalSeen": 120,
      "seenRate": 80.0
    }
  },
  "message": "Histórico de notificações do usuário carregado com sucesso."
}
```

#### Example Request

```bash
curl -X GET "http://localhost:3000/admin/notifications/user/user-id" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 6. Resend Failed Notification

**POST** `/admin/notifications/resend/:id`

Resend a notification that has failed deliveries. This endpoint resets failed deliveries and re-queues them for processing.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | Notification ID |

#### Response

```json
{
  "success": true,
  "data": {
    "notificationId": "notification-id",
    "resendResults": [
      {
        "deliveryId": "delivery-1",
        "channel": "EMAIL",
        "success": true,
        "message": "Re-queued successfully"
      },
      {
        "deliveryId": "delivery-2",
        "channel": "PUSH",
        "success": false,
        "message": "Device token not found"
      }
    ],
    "summary": {
      "total": 2,
      "succeeded": 1,
      "failed": 1
    }
  },
  "message": "1 de 2 entregas foram reenviadas com sucesso."
}
```

#### Example Request

```bash
curl -X POST "http://localhost:3000/admin/notifications/resend/notification-id" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### 7. Export Notifications

**GET** `/admin/notifications/export/csv`

Export notifications to CSV or JSON format with the same filtering options as the list endpoint.

#### Query Parameters

All parameters from the [List Notifications](#1-list-all-notifications) endpoint plus:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | `csv \| json` | No | Export format (default: `csv`) |

#### Response (CSV format)

```json
{
  "success": true,
  "data": {
    "csv": "id,title,type,importance,channels,userName,userEmail,sector,sentAt,scheduledAt,deliveryStatus,seenCount,isSeen,createdAt\n...",
    "count": 150
  },
  "message": "150 notificações exportadas com sucesso."
}
```

#### Response (JSON format)

```json
{
  "success": true,
  "data": [
    {
      "id": "notification-id",
      "title": "Notification Title",
      "type": "TASK",
      "importance": "HIGH",
      "channels": "EMAIL, IN_APP",
      "userId": "user-id",
      "userName": "John Doe",
      "userEmail": "john@example.com",
      "sector": "Production",
      "sentAt": "2026-01-05T10:00:00.000Z",
      "scheduledAt": "N/A",
      "deliveryStatus": "All delivered",
      "seenCount": 1,
      "isSeen": "Yes",
      "createdAt": "2026-01-05T09:55:00.000Z"
    }
  ],
  "message": "150 notificações exportadas com sucesso."
}
```

#### Example Request

```bash
# Export as CSV
curl -X GET "http://localhost:3000/admin/notifications/export/csv?type=TASK&dateFrom=2026-01-01&format=csv" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Export as JSON
curl -X GET "http://localhost:3000/admin/notifications/export/csv?type=TASK&dateFrom=2026-01-01&format=json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

## Enums Reference

### NOTIFICATION_TYPE

- `SYSTEM` - System notifications
- `TASK` - Task-related notifications
- `ORDER` - Order-related notifications
- `PPE` - Personal Protective Equipment notifications
- `VACATION` - Vacation/leave notifications
- `WARNING` - Warning/alert notifications
- `STOCK` - Stock/inventory notifications
- `GENERAL` - General notifications

### NOTIFICATION_CHANNEL

- `EMAIL` - Email notifications
- `SMS` - SMS text messages
- `PUSH` - Push notifications (mobile/desktop)
- `IN_APP` - In-app notifications

### NOTIFICATION_IMPORTANCE

- `LOW` - Low priority
- `NORMAL` - Normal priority
- `HIGH` - High priority
- `URGENT` - Urgent/critical priority

### DELIVERY_STATUS

- `PENDING` - Delivery is pending
- `PROCESSING` - Currently being processed
- `DELIVERED` - Successfully delivered
- `FAILED` - Delivery failed
- `RETRYING` - Retry in progress

---

## Error Responses

All endpoints may return the following error responses:

### 401 Unauthorized

```json
{
  "statusCode": 401,
  "message": "Você não está autorizado a fazer essa ação.",
  "error": "Unauthorized"
}
```

### 403 Forbidden

```json
{
  "statusCode": 403,
  "message": "Acesso negado. Privilégios insuficientes. Necessário: ADMIN",
  "error": "Forbidden"
}
```

### 404 Not Found

```json
{
  "statusCode": 404,
  "message": "Notificação não encontrada.",
  "error": "Not Found"
}
```

### 500 Internal Server Error

```json
{
  "statusCode": 500,
  "message": "Erro ao buscar notificações. Tente novamente.",
  "error": "Internal Server Error"
}
```

---

## Use Cases

### 1. Monitor Notification Delivery Performance

Track overall system performance:

```bash
# Get statistics for the last 30 days
curl -X GET "http://localhost:3000/admin/notifications/stats/overview?dateFrom=2025-12-06" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### 2. Investigate Failed Notifications

Find and analyze failed notifications:

```bash
# List all failed notifications
curl -X GET "http://localhost:3000/admin/notifications?deliveryStatus=failed&limit=50" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Get detailed info about a specific failure
curl -X GET "http://localhost:3000/admin/notifications/notification-id" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Resend failed notification
curl -X POST "http://localhost:3000/admin/notifications/resend/notification-id" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### 3. Analyze User Engagement

Check how users interact with notifications:

```bash
# Get user's notification history
curl -X GET "http://localhost:3000/admin/notifications/user/user-id" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Get delivery report with engagement metrics
curl -X GET "http://localhost:3000/admin/notifications/reports/delivery?dateFrom=2026-01-01" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### 4. Generate Reports

Export data for external analysis:

```bash
# Export all task notifications from January
curl -X GET "http://localhost:3000/admin/notifications/export/csv?type=TASK&dateFrom=2026-01-01&dateTo=2026-01-31&format=csv" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -o notifications_january.csv
```

### 5. Monitor Channel Performance

Compare performance across different channels:

```bash
# Get delivery report with channel breakdown
curl -X GET "http://localhost:3000/admin/notifications/reports/delivery?groupBy=day" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

## Rate Limiting

All admin endpoints are subject to rate limiting:

- **Standard Rate Limit:** 100 requests per minute per admin user
- **Export Endpoints:** 10 requests per minute (due to higher resource usage)

Rate limit headers are included in all responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1641024000
```

---

## Best Practices

1. **Use Date Filters:** Always use date range filters when querying large datasets to improve performance.

2. **Pagination:** Use appropriate page sizes (10-50 items) for better performance.

3. **Export Limits:** The export endpoint has a 10,000 record limit. For larger exports, use multiple requests with date range filters.

4. **Caching:** Statistics endpoints cache results for 5 minutes. For real-time data, use the list endpoint.

5. **Monitoring:** Set up alerts for:
   - High failure rates (>10%)
   - Low seen rates (<50%)
   - Specific error patterns

6. **Resend Strategy:** Before resending failed notifications:
   - Check the failure reason
   - Verify the issue has been resolved
   - Consider the notification age (don't resend very old notifications)

---

## Support

For issues or questions about the Notification Admin API:

- Check the system logs for detailed error information
- Review the notification queue status
- Contact the development team for assistance

---

**Version:** 1.0.0
**Last Updated:** 2026-01-05
