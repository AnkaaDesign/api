# Notification Export - Quick Reference Guide

## API Endpoints

### 1. Standard Export
**Endpoint:** `GET /admin/notifications/export`

**Example Requests:**

```bash
# Export all notifications to CSV
GET /admin/notifications/export?format=csv

# Export to Excel
GET /admin/notifications/export?format=xlsx

# Export failed notifications
GET /admin/notifications/export?format=csv&deliveryStatus=failed

# Export by date range
GET /admin/notifications/export?format=xlsx&dateFrom=2026-01-01&dateTo=2026-01-31

# Export for specific user
GET /admin/notifications/export?format=csv&userId=user-uuid-here

# Export specific notification type
GET /admin/notifications/export?format=csv&type=TASK_ASSIGNMENT

# Export by channel
GET /admin/notifications/export?format=csv&channel=EMAIL
```

### 2. Analytics Export
**Endpoint:** `GET /admin/notifications/export/analytics`

**Example Requests:**

```bash
# Export analytics to CSV
GET /admin/notifications/export/analytics?format=csv

# Export analytics to Excel for date range
GET /admin/notifications/export/analytics?format=xlsx&dateFrom=2026-01-01&dateTo=2026-01-31
```

### 3. Streaming Export
**Endpoint:** `GET /admin/notifications/export/stream`

**Example Requests:**

```bash
# Stream CSV export (for large datasets)
GET /admin/notifications/export/stream?format=csv

# Stream Excel export with filters
GET /admin/notifications/export/stream?format=xlsx&deliveryStatus=failed
```

## Query Parameters Reference

| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `format` | string | `csv`, `xlsx` | Export format (default: csv) |
| `type` | string | NOTIFICATION_TYPE enum | Filter by notification type |
| `channel` | string | NOTIFICATION_CHANNEL enum | Filter by channel |
| `status` | string | `sent`, `scheduled`, `pending` | Filter by status |
| `deliveryStatus` | string | `delivered`, `failed`, `pending` | Filter by delivery status |
| `userId` | string | UUID | Filter by user ID |
| `sectorId` | string | UUID | Filter by sector ID |
| `dateFrom` | string | ISO date | Start date filter |
| `dateTo` | string | ISO date | End date filter |

## Response Format

### Standard Export Response
```json
{
  "success": true,
  "data": {
    "filename": "notifications-export-2026-01-05-14-30-45.csv",
    "content": "base64-encoded-content",
    "size": 12345,
    "format": "csv"
  },
  "message": "Notificações exportadas com sucesso."
}
```

### Streaming Export Response
Direct file download with appropriate headers:
- `Content-Type`: `text/csv` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition`: `attachment; filename="notifications-export-2026-01-05-14-30-45.csv"`

## Service Methods

### NotificationExportService

```typescript
// Export to CSV
const csvBuffer = await exportService.exportToCSV(filters);

// Export to Excel
const xlsxBuffer = await exportService.exportToExcel(filters);

// Export analytics
const analyticsBuffer = await exportService.exportAnalytics(filters, 'csv');

// Format data for export
const formattedData = await exportService.formatExportData(notifications);

// Generate filename
const filename = exportService.generateExportFilename('csv', 'notifications');

// Stream export
const stream = await exportService.streamExport(filters, 'csv');
```

## Export Columns

### Notifications Export
- ID
- Type
- User
- Message
- Channels
- Status
- Sent At
- Delivered At
- Seen At
- Failed Reason

### Analytics Export
- Date
- Total Notifications
- Sent Notifications
- Delivered Notifications
- Failed Notifications
- Seen Notifications
- Delivery Rate
- Seen Rate
- Avg Delivery Time
- Top Channel
- Top Failure Reason

## Filter Examples

```typescript
// Example filter object
const filters: ExportFilters = {
  type: 'TASK_ASSIGNMENT',
  channel: 'EMAIL',
  status: 'sent',
  deliveryStatus: 'delivered',
  userId: 'user-uuid',
  sectorId: 'sector-uuid',
  dateFrom: new Date('2026-01-01'),
  dateTo: new Date('2026-01-31'),
};
```

## Common Use Cases

### 1. Monthly Report
```bash
GET /admin/notifications/export/analytics?format=xlsx&dateFrom=2026-01-01&dateTo=2026-01-31
```

### 2. Failed Deliveries Investigation
```bash
GET /admin/notifications/export?format=csv&deliveryStatus=failed&dateFrom=2026-01-01
```

### 3. User Activity Report
```bash
GET /admin/notifications/export?format=xlsx&userId=user-uuid
```

### 4. Channel Performance Analysis
```bash
GET /admin/notifications/export?format=csv&channel=EMAIL&dateFrom=2026-01-01
```

### 5. Large Dataset Export
```bash
GET /admin/notifications/export/stream?format=csv&dateFrom=2026-01-01&dateTo=2026-12-31
```

## Performance Tips

1. **Use streaming for >10,000 records**: `/export/stream` endpoint
2. **Apply date filters**: Reduce dataset size
3. **Use CSV for large exports**: Faster than Excel
4. **Filter by specific criteria**: Reduce processing time
5. **Export during off-peak hours**: For very large datasets

## Security

- All endpoints require admin authentication
- JWT token must be included in Authorization header
- Only admins with `SECTOR_PRIVILEGES.ADMIN` can access
- Data is filtered based on user permissions

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Missing/invalid token | Include valid JWT token |
| 403 Forbidden | Not admin user | Use admin account |
| 500 Internal Server Error | Database/processing error | Check logs, retry |
| 400 Bad Request | Invalid filters | Verify filter parameters |

## Limits

- Maximum records per export: 50,000
- Maximum export size: ~100MB (CSV), ~50MB (Excel)
- Timeout: 2 minutes for standard export, no limit for streaming
- Concurrent exports: 5 per admin user

## Testing

```bash
# Test with curl
curl -X GET "http://localhost:3030/admin/notifications/export?format=csv" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o export.csv

# Test streaming
curl -X GET "http://localhost:3030/admin/notifications/export/stream?format=csv" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  > export.csv

# Test analytics
curl -X GET "http://localhost:3030/admin/notifications/export/analytics?format=xlsx" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o analytics.xlsx
```

## Troubleshooting

### Export is slow
- Use streaming endpoint
- Add date range filters
- Reduce dataset size

### Out of memory errors
- Always use streaming for >50,000 records
- Increase Node.js memory limit: `--max-old-space-size=4096`

### Invalid format errors
- Verify data encoding
- Check for special characters in messages
- Use Excel format for complex data

### Missing data in export
- Check filter parameters
- Verify user permissions
- Review date range filters

## Support

For issues or questions:
1. Check application logs: `logs/notification-export.log`
2. Review error messages in response
3. Contact development team
4. Submit issue with export parameters used
