# Notification Tests - Quick Start Guide

## 30-Second Setup

```bash
# 1. Install dependencies (if not already done)
npm install

# 2. Set up test database
export TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/test_db"

# 3. Run tests
npm test test/notification/
```

## Most Common Test Commands

```bash
# Run all notification tests
npm test test/notification/

# Run with coverage
npm test -- --coverage test/notification/

# Run specific test file
npm test test/notification/notification.e2e-spec.ts

# Run specific test suite
npm test -- --testNamePattern="Task Notifications"

# Watch mode for development
npm test -- --watch test/notification/

# Verbose output
npm test -- --verbose test/notification/
```

## Quick Examples

### Example 1: Test Task Notification
```typescript
it('should send notification when task is created', async () => {
  const task = await createTestTask(prisma, {
    title: 'New Test Task',
    userId: testUserId,
  });

  await waitForAsync(1000);

  const notifications = await getUserNotifications(prisma, testUserId, {
    type: NOTIFICATION_TYPE.TASK,
  });

  expect(notifications.length).toBeGreaterThan(0);
});
```

### Example 2: Test User Preferences
```typescript
it('should respect user channel preferences', async () => {
  // Disable email notifications
  await prisma.userNotificationPreference.update({
    where: { userId: testUserId },
    data: {
      enabled: false,
      channels: [],
    },
  });

  await createTask(); // Should not send email

  expect(mockEmailService.getSentCount()).toBe(0);
});
```

### Example 3: Test Multi-channel Delivery
```typescript
it('should send via all enabled channels', async () => {
  const notification = await createTestNotification(prisma, {
    userId: testUserId,
    title: 'Multi-channel Test',
    body: 'Testing',
    type: NOTIFICATION_TYPE.TASK,
    channels: [
      NOTIFICATION_CHANNEL.EMAIL,
      NOTIFICATION_CHANNEL.SMS,
      NOTIFICATION_CHANNEL.PUSH,
    ],
  });

  await simulateNotificationDispatch(prisma, notification.id);
  await waitForAsync(2000);

  expect(mockEmailService.wasEmailSent(testUser.email)).toBe(true);
  expect(mockSmsService.wasSmsSent(testUser.phone)).toBe(true);
  expect(mockPushService.wasNotificationSent(deviceToken)).toBe(true);
});
```

## Essential Helper Functions

### Creating Test Data
```typescript
// Create user
const user = await createTestUser(prisma, {
  name: 'Test User',
  email: 'test@example.com',
  sectorPrivilege: SECTOR_PRIVILEGES.PRODUCTION,
});

// Create task
const task = await createTestTask(prisma, {
  title: 'Test Task',
  userId: user.id,
});

// Create notification
const notification = await createTestNotification(prisma, {
  userId: user.id,
  title: 'Test',
  body: 'Message',
  type: NOTIFICATION_TYPE.TASK,
  channels: [NOTIFICATION_CHANNEL.EMAIL],
});
```

### Verifying Results
```typescript
// Get user notifications
const notifications = await getUserNotifications(prisma, userId);

// Check if email was sent
expect(mockEmailService.wasEmailSent('user@example.com')).toBe(true);

// Get sent count
expect(mockSmsService.getSentCount()).toBe(1);

// Verify delivery
const delivered = await verifyNotificationSent(
  prisma,
  notificationId,
  NOTIFICATION_CHANNEL.EMAIL
);
expect(delivered).toBe(true);
```

### Mock Configuration
```typescript
// Make email fail
mockEmailService.configureFail(true);

// Add delay
mockSmsService.configureDelay(500);

// Random failures (30% rate)
mockEmailService.configureFailureRate(0.3);

// Reset mocks
mockEmailService.reset();
mockSmsService.reset();
```

### Cleanup
```typescript
beforeEach(async () => {
  // Create test data
  user = await createTestUser(prisma, {...});
});

afterEach(async () => {
  // Clean up everything
  await cleanupDatabase(prisma);
});
```

## Common Patterns

### Pattern 1: Test with Setup and Cleanup
```typescript
describe('My Feature', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await createTestUser(prisma, userFixtures.admin);
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase(prisma);
  });

  it('should work', async () => {
    // Your test here
  });
});
```

### Pattern 2: Test Async Operations
```typescript
it('should handle async operation', async () => {
  // Trigger async operation
  await createTask();

  // Wait for processing
  await waitForAsync(1000);

  // Verify result
  const notifications = await getUserNotifications(prisma, userId);
  expect(notifications.length).toBeGreaterThan(0);
});
```

### Pattern 3: Test with Mocks
```typescript
it('should handle failure', async () => {
  // Configure mock to fail
  mockEmailService.configureFail(true);

  // Attempt operation
  await simulateNotificationDispatch(prisma, notificationId);

  // Verify failure handling
  const delivery = await getNotificationDeliveries(prisma, {
    notificationId,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });
  expect(delivery[0].status).toBe('FAILED');
});
```

### Pattern 4: Test with Fixtures
```typescript
it('should work with fixtures', async () => {
  // Use predefined fixtures
  const user = await createTestUser(prisma, userFixtures.warehouse);
  const task = await createTestTask(prisma, {
    ...taskFixtures.urgent,
    userId: user.id,
  });

  // Test logic here
});
```

## Debugging Tips

### See Mock Interactions
```typescript
// After test runs
console.log('Emails sent:', mockEmailService.sentEmails);
console.log('SMS sent:', mockSmsService.sentMessages);
console.log('Push sent:', mockPushService.sentNotifications);
```

### Add More Wait Time
```typescript
// If test is flaky
await waitForAsync(3000); // Increase from 1000
```

### Check Database State
```typescript
// See what's in database
const notifications = await prisma.notification.findMany();
console.log('Notifications:', notifications);
```

### Isolate Test
```typescript
// Run only one test
it.only('should work', async () => {
  // Test here
});
```

## Fixtures Quick Reference

```typescript
// Users
userFixtures.admin
userFixtures.warehouse
userFixtures.production
userFixtures.designer

// Tasks
taskFixtures.preparation
taskFixtures.inProduction
taskFixtures.completed
taskFixtures.urgent

// Notifications
notificationFixtures.taskCreated
notificationFixtures.taskStatusChange
notificationFixtures.orderReceived
notificationFixtures.stockLow
```

## File Structure
```
test/notification/
├── notification.e2e-spec.ts          # Main tests (93 tests)
├── notification-advanced.e2e-spec.ts # Advanced tests (25+ tests)
├── test-helpers.ts                    # Helper functions
├── test-fixtures.ts                   # Test data
├── mocks/
│   ├── mock-email.service.ts
│   ├── mock-sms.service.ts
│   ├── mock-whatsapp.service.ts
│   └── mock-push.service.ts
├── jest.config.js
├── jest.setup.ts
├── README.md                          # Full documentation
├── TEST_SUMMARY.md                    # Statistics
└── QUICK_START.md                     # This file
```

## Cheat Sheet

| Action | Command/Code |
|--------|-------------|
| Run all tests | `npm test test/notification/` |
| Run with coverage | `npm test -- --coverage test/notification/` |
| Run specific test | `npm test -- --testNamePattern="Test Name"` |
| Create user | `createTestUser(prisma, {...})` |
| Create notification | `createTestNotification(prisma, {...})` |
| Wait for async | `await waitForAsync(1000)` |
| Cleanup | `await cleanupDatabase(prisma)` |
| Mock failure | `mockEmailService.configureFail(true)` |
| Reset mocks | `mockEmailService.reset()` |
| Verify email | `mockEmailService.wasEmailSent(email)` |
| Get notifications | `getUserNotifications(prisma, userId)` |

## Need Help?

1. Check **README.md** for detailed documentation
2. Look at **existing tests** for examples
3. Review **TEST_SUMMARY.md** for overview
4. Check **test-helpers.ts** for available functions
5. Review **test-fixtures.ts** for test data

## Pro Tips

1. **Always use fixtures** for consistency
2. **Always cleanup** after tests
3. **Always wait** for async operations
4. **Always reset mocks** between tests
5. **Use descriptive test names** that explain what they do
6. **Test both success and failure** paths
7. **Keep tests independent** - don't rely on test order

---

**Happy Testing!** 🚀
