# Notification Seed Data - Summary

## Quick Reference

### Commands

```bash
# Seed notification test data
npm run seed:notification

# Clean up test data
npm run seed:notification:clean

# Seed with main database
npm run seed -- --notifications-only
```

## What Gets Created

### 1. User Notification Preferences
- **Admin users**: 11 preference types with multiple channels
- **Regular users**: 6 preference types with essential channels
- Preferences are preserved during cleanup

### 2. Device Tokens
- 3 tokens per test user (iOS, Android, Web)
- All marked with `[TEST_DATA]` for easy cleanup

### 3. Sample Notifications (11 total)

| Type | Count | Status | Description |
|------|-------|--------|-------------|
| TASK_STATUS | 1 | DELIVERED | Task status changed |
| TASK_DEADLINE | 1 | PARTIALLY_FAILED | Deadline approaching |
| TASK_ASSIGNMENT | 1 | PENDING | New assignment |
| ORDER_CREATED | 1 | DELIVERED | New order |
| ORDER_STATUS | 1 | FAILED | Order status update |
| ORDER_OVERDUE | 1 | DELIVERED | Overdue alert |
| STOCK_LOW | 1 | DELIVERED | Low stock warning |
| STOCK_OUT | 1 | PARTIALLY_FAILED | Out of stock |
| STOCK_REORDER | 1 | PENDING | Reorder point |
| SYSTEM | 1 | DELIVERED | System maintenance |
| GENERAL | 1 | SCHEDULED | Future reminder |

### 4. Delivery Records
- ~25-35 delivery records across all channels
- Statuses: PENDING, PROCESSING, DELIVERED, FAILED
- Includes error messages for failed deliveries

### 5. Seen/Read Records
- 5 notifications marked as seen
- Some with reminders set for tomorrow

## Data Breakdown by Notification Type

### TASK Notifications (3)
✅ **Delivered** - Status changed (2 days ago)
⚠️ **Partially Failed** - Deadline approaching (yesterday)
⏳ **Pending** - New assignment (now)

### ORDER Notifications (3)
✅ **Delivered** - Order created (yesterday)
❌ **Failed** - Status update (now)
✅ **Delivered** - Overdue alert (yesterday)

### STOCK Notifications (3)
✅ **Delivered** - Low stock (2 days ago)
⚠️ **Partially Failed** - Out of stock (yesterday)
⏳ **Pending** - Reorder point (now)

### SYSTEM Notifications (1)
✅ **Delivered** - Maintenance alert (2 days ago)

### GENERAL Notifications (1)
📅 **Scheduled** - Reminder (tomorrow)

## Testing Coverage

### Delivery States
- ✅ Successful delivery (all channels)
- ⚠️ Partial failure (some channels failed)
- ❌ Complete failure (all channels failed)
- ⏳ Pending (not yet sent)
- 📅 Scheduled (future delivery)

### Importance Levels
- 🔵 NORMAL - 6 notifications
- 🟠 HIGH - 3 notifications
- 🔴 URGENT - 2 notifications

### Channel Coverage
- IN_APP - All notifications
- EMAIL - 10 notifications
- MOBILE_PUSH - 5 notifications
- WHATSAPP - 4 notifications

### Target Sectors
- 🎯 All users - 6 notifications
- 🎯 ADMIN, WAREHOUSE - 4 notifications
- 🎯 ADMIN, WAREHOUSE, LEADER - 1 notification

## Statistics

```
Total Records Created:
- Preferences: ~10-25 per user (varies by role)
- Device Tokens: 3 per test user
- Notifications: 11
- Deliveries: ~25-35
- Seen Records: 5

Total Time: ~2-3 seconds
Database Size: ~50-100KB
```

## Use Cases Covered

✅ Multi-channel delivery testing
✅ Retry logic testing
✅ User preference filtering
✅ Role-based notifications
✅ Mandatory vs optional notifications
✅ Read/unread tracking
✅ Reminder functionality
✅ Future scheduling
✅ Error handling
✅ Platform-specific tokens

## Safety Features

🔒 **Test Data Marker**: All test data marked with `[TEST_DATA]`
🔒 **Preserved Preferences**: User preferences kept during cleanup
🔒 **Foreign Key Safety**: Cleanup respects all constraints
🔒 **No Production Impact**: Only marked data is removed

## Quick Start

1. **Ensure users exist in database**
   ```bash
   npm run seed  # If needed
   ```

2. **Seed notification data**
   ```bash
   npm run seed:notification
   ```

3. **Test your notification system**
   - Check notification list UI
   - Test delivery mechanisms
   - Verify preference filtering
   - Test read/unread states

4. **Clean up when done**
   ```bash
   npm run seed:notification:clean
   ```

## File Locations

```
/prisma/
  /seeds/
    notification.seed.ts              # Main seed script
    notification-preferences.seed.ts  # Legacy preferences seed
    NOTIFICATION_SEED_README.md      # Full documentation
    NOTIFICATION_SEED_SUMMARY.md     # This file
  seed.ts                             # Master seed coordinator
```

## Next Steps

After seeding, you can:
1. View notifications in the application UI
2. Test notification delivery services
3. Verify preference filtering logic
4. Test push notification sending
5. Check delivery status tracking
6. Test reminder functionality

## Support

For detailed documentation, see: `NOTIFICATION_SEED_README.md`
