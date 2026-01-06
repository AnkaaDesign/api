# Notification System Integration Tests

Comprehensive end-to-end tests for the notification system covering all aspects of notification delivery, preferences, tracking, and edge cases.

## Overview

This test suite provides complete coverage of the notification system including:

- Task notifications
- User preferences and customization
- Role-based filtering
- Multi-channel delivery (Email, SMS, WhatsApp, Push, In-App)
- Notification tracking (seen, read, remind later)
- Edge cases and error handling
- Notification aggregation
- Scheduled notifications
- Statistics and analytics

## Test Files

### Main Test Suite

- **notification.e2e-spec.ts** - Complete end-to-end test suite with all test scenarios

### Supporting Files

- **test-helpers.ts** - Helper functions for creating test data and verifying results
- **test-fixtures.ts** - Predefined test data for various scenarios
- **mocks/** - Mock services for external dependencies

## Mock Services

### MockEmailService
Simulates email sending with configurable behavior:
- Track sent emails
- Simulate failures
- Configure delays
- Set random failure rates
- Verify email delivery

### MockSmsService
Simulates SMS sending:
- Track sent messages
- Simulate failures and retries
- Configure delivery delays
- Validate phone numbers

### MockWhatsAppService
Simulates WhatsApp Business API:
- Track messages by type (text, template, media)
- Simulate delivery status updates
- Message read receipts
- Template message support

### MockPushService
Simulates push notification delivery:
- Support for multiple platforms (iOS, Android, Web)
- Track delivery and click-through rates
- Topic/group messaging
- Silent/data-only notifications

## Test Categories

### 1. Task Notifications

Tests notification delivery for task-related events:

```typescript
it('should send notification when task is created')
it('should send notification when task status changes')
it('should track individual field changes')
it('should send notification to assigned user')
it('should handle task completion notification')
```

### 2. User Preferences

Tests user notification preference management:

```typescript
it('should respect user channel preferences')
it('should not allow disabling mandatory notifications')
it('should allow customizing channels for non-mandatory notifications')
it('should initialize default preferences for new users')
```

### 3. Role-based Filtering

Tests sector-based notification routing:

```typescript
it('should only send order notifications to warehouse/admin')
it('should send task notifications to relevant sectors')
```

### 4. Multi-channel Delivery

Tests notification delivery across multiple channels:

```typescript
it('should send notification via all enabled channels')
it('should handle channel failures gracefully')
it('should track delivery status for each channel')
```

### 5. Tracking

Tests notification tracking functionality:

```typescript
it('should track when notification is seen')
it('should not duplicate seen records')
it('should support remind later functionality')
it('should get unread notification count')
it('should mark all as read')
```

### 6. Edge Cases

Tests error handling and edge cases:

```typescript
it('should handle concurrent task updates')
it('should handle failed deliveries with retry')
it('should respect rate limiting')
it('should handle notification to deleted user gracefully')
it('should handle empty notification list')
it('should validate notification data')
```

### 7. Notification Aggregation

Tests notification grouping and summarization:

```typescript
it('should aggregate similar notifications')
it('should group notifications by type')
```

### 8. Scheduled Notifications

Tests scheduled notification delivery:

```typescript
it('should not send scheduled notification before time')
it('should send scheduled notification after time')
```

### 9. Statistics

Tests notification analytics:

```typescript
it('should get user notification statistics')
it('should get delivery statistics for notification')
```

## Running Tests

### Run all notification tests
```bash
npm test test/notification/notification.e2e-spec.ts
```

### Run with coverage
```bash
npm test -- --coverage test/notification/
```

### Run specific test suite
```bash
npm test -- --testNamePattern="Task Notifications"
```

### Run in watch mode
```bash
npm test -- --watch test/notification/
```

## Test Utilities

### createTestUser
Creates a test user with specified sector privileges:

```typescript
const user = await createTestUser(prisma, {
  name: 'Test User',
  email: 'test@example.com',
  sectorPrivilege: SECTOR_PRIVILEGES.PRODUCTION,
});
```

### createTestTask
Creates a test task with customizable properties:

```typescript
const task = await createTestTask(prisma, {
  title: 'Test Task',
  userId: testUserId,
  status: TASK_STATUS.IN_PRODUCTION,
  priority: 'HIGH',
});
```

### createTestNotification
Creates a notification for testing:

```typescript
const notification = await createTestNotification(prisma, {
  userId: testUserId,
  title: 'Test Notification',
  body: 'Test body',
  type: NOTIFICATION_TYPE.TASK,
  channels: [NOTIFICATION_CHANNEL.EMAIL],
});
```

### waitForAsync
Waits for async operations to complete:

```typescript
await waitForAsync(1000); // Wait 1 second
```

### cleanupDatabase
Cleans up all test data:

```typescript
await cleanupDatabase(prisma);
```

## Test Fixtures

Pre-configured test data is available in `test-fixtures.ts`:

### User Fixtures
```typescript
userFixtures.admin
userFixtures.warehouse
userFixtures.production
userFixtures.designer
userFixtures.leader
```

### Task Fixtures
```typescript
taskFixtures.preparation
taskFixtures.inProduction
taskFixtures.completed
taskFixtures.urgent
```

### Notification Fixtures
```typescript
notificationFixtures.taskCreated
notificationFixtures.taskStatusChange
notificationFixtures.orderReceived
notificationFixtures.stockLow
```

## Mock Configuration

### Configure Email Mock

```typescript
const emailService = app.get(EmailService);

// Simulate failure
emailService.configureFail(true);

// Simulate delay
emailService.configureDelay(500);

// Set random failure rate (30%)
emailService.configureFailureRate(0.3);

// Reset to default
emailService.reset();
```

### Configure SMS Mock

```typescript
const smsService = app.get(SmsService);

// Configure similar to email mock
smsService.configureFail(true);
smsService.configureDelay(200);
smsService.configureFailureRate(0.2);
```

### Verify Mock Calls

```typescript
// Check if email was sent
expect(emailService.wasEmailSent('user@example.com', 'Task Created')).toBe(true);

// Get sent emails
const emails = emailService.getSentEmailsFor('user@example.com');
expect(emails.length).toBeGreaterThan(0);

// Get send count
expect(emailService.getSentCount()).toBe(5);
```

## Best Practices

### 1. Clean Up After Each Test
Always use `afterEach` to clean up test data:

```typescript
afterEach(async () => {
  await cleanupDatabase(prisma);
});
```

### 2. Use Fixtures for Consistency
Use predefined fixtures instead of creating data inline:

```typescript
const user = await createTestUser(prisma, userFixtures.production);
```

### 3. Wait for Async Operations
Always wait for async operations to complete:

```typescript
await waitForAsync(1000);
```

### 4. Test Both Success and Failure Cases
Test both happy path and error scenarios:

```typescript
// Success case
it('should send notification successfully', async () => {
  // Test implementation
});

// Failure case
it('should handle delivery failure gracefully', async () => {
  emailService.configureFail(true);
  // Test implementation
});
```

### 5. Verify Mock Interactions
Always verify that mocks were called correctly:

```typescript
expect(emailService.wasEmailSent(testUser.email)).toBe(true);
expect(smsService.getSentCount()).toBe(1);
```

## Troubleshooting

### Tests Timing Out
If tests are timing out, increase wait times:

```typescript
await waitForAsync(3000); // Increase from 1000 to 3000
```

### Database Cleanup Issues
If cleanup fails, ensure foreign key constraints are respected:

```typescript
// Delete in correct order
await prisma.seenNotification.deleteMany({});
await prisma.notificationDelivery.deleteMany({});
await prisma.notification.deleteMany({});
```

### Mock Not Working
Ensure mocks are properly injected:

```typescript
.overrideProvider(EmailService)
.useClass(MockEmailService)
```

### Flaky Tests
For flaky tests, check for:
- Race conditions in async operations
- Insufficient wait times
- Improper cleanup between tests
- Shared state between tests

## Coverage Goals

Target coverage metrics:
- **Statements**: 90%+
- **Branches**: 85%+
- **Functions**: 90%+
- **Lines**: 90%+

## Continuous Integration

Tests are automatically run in CI/CD pipeline:
- On every pull request
- On merge to main branch
- Nightly regression tests

## Contributing

When adding new tests:

1. Follow existing test structure
2. Use helper functions and fixtures
3. Add appropriate mocks
4. Document complex test scenarios
5. Ensure tests are independent
6. Clean up test data
7. Add to this README if introducing new patterns

## Related Documentation

- [Notification Service Documentation](../../src/modules/common/notification/README.md)
- [API Documentation](../../docs/api/notifications.md)
- [Testing Guidelines](../../docs/testing.md)

## Contact

For questions or issues with tests:
- Open an issue in the project repository
- Contact the development team
- Check the testing channel in team chat
