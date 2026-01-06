# Notification Seed Data

This document describes the notification seed data structure and usage.

## Overview

The notification seed script creates comprehensive test data for the notification system, including:

1. **Notification Preferences** - Default preferences for admin and regular users
2. **Device Tokens** - Sample device tokens for iOS, Android, and Web platforms
3. **Sample Notifications** - Test notifications covering all notification types
4. **Notification Deliveries** - Delivery tracking records with various statuses
5. **Seen/Read Records** - Notification read status and reminder data

## Usage

### Seed Notification Data

```bash
npm run seed:notification
```

This will create:
- Notification preferences for all existing users
- Device tokens for test users (iOS, Android, Web)
- 11 sample notifications of different types
- Delivery records for each notification channel
- Read/seen records with reminders

### Clean Test Data

```bash
npm run seed:notification:clean
```

This removes all test notification data marked with `[TEST_DATA]`. It will delete:
- All test notifications
- Associated delivery records
- Seen notification records
- Test device tokens

**Note:** User notification preferences are preserved during cleanup.

## Seed Data Structure

### 1. Notification Preferences

#### Admin Users (ADMIN, LEADER, WAREHOUSE, FINANCIAL)
Comprehensive notification settings with all channels enabled:

- **Task Notifications** (Mandatory)
  - Status changes: IN_APP, EMAIL, MOBILE_PUSH
  - Deadline alerts: IN_APP, EMAIL, MOBILE_PUSH, WHATSAPP
  - Assignments: IN_APP, EMAIL, MOBILE_PUSH
  - Field updates: IN_APP, EMAIL (Optional)

- **Order Notifications**
  - Created: IN_APP, EMAIL (Optional)
  - Status changes: IN_APP, EMAIL (Optional)
  - Overdue: IN_APP, EMAIL, WHATSAPP (Mandatory)

- **Stock Notifications**
  - Low stock: IN_APP, EMAIL (Optional)
  - Out of stock: IN_APP, EMAIL, WHATSAPP (Mandatory)
  - Reorder point: IN_APP, EMAIL (Optional)

- **System Notifications**
  - All system alerts: IN_APP, EMAIL (Mandatory)

#### Regular Users (BASIC, PRODUCTION, etc.)
Essential notifications only:

- **Task Notifications** (Mandatory)
  - Status changes: IN_APP, MOBILE_PUSH
  - Deadline alerts: IN_APP, MOBILE_PUSH
  - Assignments: IN_APP, MOBILE_PUSH

- **Order Notifications**
  - Status changes: IN_APP (Optional, disabled by default)

- **Stock Notifications**
  - Low stock: IN_APP (Optional)

- **System Notifications**
  - All system alerts: IN_APP (Mandatory)

### 2. Device Tokens

For each test user, tokens are created for:
- **iOS** - Mobile push notifications
- **Android** - Mobile push notifications
- **Web** - Web push notifications

All tokens are marked with `[TEST_DATA]` for easy identification and cleanup.

### 3. Sample Notifications

#### Task Notifications (3)

1. **Task Status Changed** (DELIVERED)
   - Type: TASK_STATUS
   - Channels: IN_APP, EMAIL, MOBILE_PUSH
   - Status: All channels delivered successfully
   - Created: 2 days ago

2. **Task Deadline Approaching** (PARTIALLY_FAILED)
   - Type: TASK_DEADLINE
   - Channels: IN_APP, EMAIL, WHATSAPP
   - Status: IN_APP and EMAIL delivered, WHATSAPP failed
   - Retry count: 1
   - Created: Yesterday

3. **New Task Assignment** (PENDING)
   - Type: TASK_ASSIGNMENT
   - Channels: IN_APP, EMAIL, MOBILE_PUSH
   - Status: Not sent yet
   - Created: Now

#### Order Notifications (3)

4. **New Order Created** (DELIVERED)
   - Type: ORDER_CREATED
   - Channels: IN_APP, EMAIL
   - Status: All channels delivered successfully
   - Created: Yesterday

5. **Order Status Update** (FAILED)
   - Type: ORDER_STATUS
   - Channels: IN_APP, EMAIL
   - Status: IN_APP delivered, EMAIL failed
   - Retry count: 2
   - Created: Now

6. **Order Overdue** (DELIVERED)
   - Type: ORDER_OVERDUE
   - Channels: IN_APP, EMAIL, WHATSAPP
   - Importance: URGENT
   - Status: All channels delivered successfully
   - Target sectors: ADMIN, WAREHOUSE, LEADER
   - Created: Yesterday

#### Stock Notifications (3)

7. **Low Stock Alert** (DELIVERED)
   - Type: STOCK_LOW
   - Channels: IN_APP, EMAIL
   - Status: All channels delivered successfully
   - Target sectors: ADMIN, WAREHOUSE
   - Created: 2 days ago

8. **Out of Stock** (PARTIALLY_FAILED)
   - Type: STOCK_OUT
   - Channels: IN_APP, EMAIL, WHATSAPP
   - Importance: URGENT
   - Status: IN_APP and EMAIL delivered, WHATSAPP failed
   - Retry count: 1
   - Target sectors: ADMIN, WAREHOUSE, PRODUCTION
   - Created: Yesterday

9. **Reorder Point Reached** (PENDING)
   - Type: STOCK_REORDER
   - Channels: IN_APP, EMAIL
   - Status: Not sent yet
   - Target sectors: ADMIN, WAREHOUSE
   - Created: Now

#### System Notifications (1)

10. **System Maintenance** (DELIVERED)
    - Type: SYSTEM
    - Channels: IN_APP, EMAIL
    - Importance: HIGH
    - Status: All channels delivered successfully
    - Mandatory: Yes
    - Created: 2 days ago

#### General Notifications (1)

11. **Scheduled Reminder** (SCHEDULED)
    - Type: GENERAL
    - Channels: IN_APP, EMAIL
    - Status: Scheduled for tomorrow
    - Created: Now

### 4. Notification Statuses

The seed data includes notifications in various states:

- **DELIVERED** - Successfully delivered through all channels
- **PARTIALLY_FAILED** - Some channels delivered, others failed
- **FAILED** - All channels failed
- **PENDING** - Not yet sent
- **SCHEDULED** - Scheduled for future delivery

### 5. Delivery Records

For each notification and channel combination:
- **Status**: PENDING, PROCESSING, DELIVERED, FAILED, RETRYING
- **Timestamps**: sentAt, deliveredAt, failedAt
- **Error messages**: For failed deliveries
- **Metadata**: Provider info, attempt numbers

### 6. Seen/Read Records

- 5 notifications marked as seen
- Some with reminders set for tomorrow
- Tracks user engagement with notifications

## Testing Scenarios

The seed data supports testing these scenarios:

### 1. Notification Delivery Testing
- Test successful multi-channel delivery
- Test partial delivery failures
- Test retry mechanisms
- Test channel fallback logic

### 2. User Preference Testing
- Test different preference profiles (admin vs regular)
- Test mandatory vs optional notifications
- Test channel selection and filtering

### 3. Device Token Management
- Test multi-device support
- Test platform-specific notifications
- Test token validation and cleanup

### 4. Notification UI Testing
- Test notification lists with various states
- Test read/unread indicators
- Test reminder functionality
- Test notification actions and deep links

### 5. Status Tracking
- Test delivery status tracking
- Test retry logic for failed deliveries
- Test error handling and reporting

### 6. Sector-Based Notifications
- Test target sector filtering
- Test role-based notification routing
- Test mandatory notifications for specific sectors

## Data Volume

The seed creates minimal but sufficient data:

- **Users**: Uses existing users (no new users created)
- **Preferences**: ~10-25 preferences per user (depending on role)
- **Device Tokens**: 3 tokens per test user (iOS, Android, Web)
- **Notifications**: 11 sample notifications
- **Deliveries**: ~25-35 delivery records (varies by notification)
- **Seen Records**: 5 records with some reminders

Total records: ~50-100 depending on number of users in system

## Important Notes

### Test Data Marker
All test data is marked with `[TEST_DATA]` prefix in:
- Notification titles
- Device token strings

This allows for easy identification and cleanup without affecting production data.

### Data Integrity
- All foreign keys reference existing users
- Cleanup respects foreign key constraints
- User preferences are preserved during cleanup
- No orphaned records are left after cleanup

### Production Safety
- Test data is clearly marked
- Cleanup script only removes marked test data
- Real user data and preferences are never touched
- Safe to run in any environment

## Advanced Usage

### Seed with main database seed

```bash
# Seed everything including notifications
npm run seed -- --all

# Seed only notifications
npm run seed -- --notifications-only
```

### Custom Seeding

You can modify the seed script to:
- Add more notification types
- Change delivery statuses
- Adjust time ranges
- Add more device tokens
- Customize user preferences

### Integration with Tests

```typescript
// In your test setup
beforeAll(async () => {
  await execSync('npm run seed:notification');
});

afterAll(async () => {
  await execSync('npm run seed:notification:clean');
});
```

## Troubleshooting

### No users found
If you see "No users found in database", seed users first:
```bash
npm run seed
```

### Permission errors
Ensure the database user has CREATE, UPDATE, DELETE permissions.

### Foreign key constraints
The cleanup script respects constraints and deletes in the correct order:
1. NotificationDelivery
2. SeenNotification
3. Notification
4. DeviceToken
5. (UserNotificationPreference preserved)

## Future Enhancements

Potential additions to the seed data:

- [ ] Notification templates
- [ ] Batch notifications
- [ ] Scheduled notification campaigns
- [ ] Notification groups/categories
- [ ] Advanced retry configurations
- [ ] Webhook delivery records
- [ ] Analytics/metrics data
- [ ] A/B testing variants

## Support

For issues or questions about notification seeding:
1. Check the main README
2. Review the schema.prisma file
3. Examine the notification service implementation
4. Contact the development team
