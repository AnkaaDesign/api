import { PrismaClient, NotificationType, NotificationImportance, NotificationChannel, Platform, DeliveryStatus, SectorPrivileges } from '@prisma/client';

const prisma = new PrismaClient();

// Test data marker - used to identify and clean up test data
const TEST_DATA_MARKER = '[TEST_DATA]';

interface TestUser {
  id: string;
  name: string;
  email: string;
  sectorPrivilege?: SectorPrivileges;
}

async function seedNotificationData() {
  console.log('🌱 Starting notification seed data...\n');

  // Get existing users from the database
  const users = await prisma.user.findMany({
    include: {
      sector: true,
    },
    take: 10,
  });

  if (users.length === 0) {
    console.log('⚠️  No users found in database. Please seed users first.');
    return;
  }

  const adminUsers = users.filter(u => u.sector?.privileges === 'ADMIN');
  const regularUsers = users.filter(u => u.sector?.privileges !== 'ADMIN');

  const testUsers: TestUser[] = [
    ...(adminUsers.length > 0 ? [{ id: adminUsers[0].id, name: adminUsers[0].name, email: adminUsers[0].email!, sectorPrivilege: 'ADMIN' as SectorPrivileges }] : []),
    ...(regularUsers.length > 0 ? [{ id: regularUsers[0].id, name: regularUsers[0].name, email: regularUsers[0].email!, sectorPrivilege: 'BASIC' as SectorPrivileges }] : []),
  ];

  if (testUsers.length === 0) {
    console.log('⚠️  Need at least one user with email to seed notification data.');
    return;
  }

  console.log(`📋 Found ${testUsers.length} users for testing:`);
  testUsers.forEach(u => console.log(`   - ${u.name} (${u.email})`));
  console.log('');

  // 1. Seed notification preferences for existing users
  await seedNotificationPreferences(users);

  // 2. Seed device tokens for testing
  await seedDeviceTokens(testUsers);

  // 3. Seed sample notifications
  await seedSampleNotifications(testUsers);

  // 4. Seed notification delivery records
  await seedNotificationDeliveries();

  console.log('\n✅ Notification seed data completed!');
  console.log('\n📌 To clean up test data, run: npm run seed:notification:clean');
}

async function seedNotificationPreferences(users: any[]) {
  console.log('1️⃣  Seeding notification preferences...');

  const adminSectorPrivileges = ['ADMIN', 'LEADER', 'WAREHOUSE', 'FINANCIAL'];
  const adminUsers = users.filter(u => adminSectorPrivileges.includes(u.sector?.privileges));
  const regularUsers = users.filter(u => !adminSectorPrivileges.includes(u.sector?.privileges));

  // Admin user preferences - more comprehensive notifications
  const adminPreferences = [
    // Task notifications (mandatory)
    { type: 'TASK_STATUS' as NotificationType, eventType: 'status_change', channels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'] as NotificationChannel[], mandatory: true, enabled: true },
    { type: 'TASK_DEADLINE' as NotificationType, eventType: 'approaching', channels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH', 'WHATSAPP'] as NotificationChannel[], mandatory: true, enabled: true },
    { type: 'TASK_ASSIGNMENT' as NotificationType, eventType: 'assigned', channels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'] as NotificationChannel[], mandatory: true, enabled: true },
    { type: 'TASK_FIELD_UPDATE' as NotificationType, eventType: 'field_changed', channels: ['IN_APP', 'EMAIL'] as NotificationChannel[], mandatory: false, enabled: true },

    // Order notifications
    { type: 'ORDER_CREATED' as NotificationType, eventType: 'created', channels: ['IN_APP', 'EMAIL'] as NotificationChannel[], mandatory: false, enabled: true },
    { type: 'ORDER_STATUS' as NotificationType, eventType: 'status_change', channels: ['IN_APP', 'EMAIL'] as NotificationChannel[], mandatory: false, enabled: true },
    { type: 'ORDER_OVERDUE' as NotificationType, eventType: 'overdue', channels: ['IN_APP', 'EMAIL', 'WHATSAPP'] as NotificationChannel[], mandatory: true, enabled: true },

    // Stock notifications
    { type: 'STOCK_LOW' as NotificationType, eventType: 'low_stock', channels: ['IN_APP', 'EMAIL'] as NotificationChannel[], mandatory: false, enabled: true },
    { type: 'STOCK_OUT' as NotificationType, eventType: 'out_of_stock', channels: ['IN_APP', 'EMAIL', 'WHATSAPP'] as NotificationChannel[], mandatory: true, enabled: true },
    { type: 'STOCK_REORDER' as NotificationType, eventType: 'reorder_point', channels: ['IN_APP', 'EMAIL'] as NotificationChannel[], mandatory: false, enabled: true },

    // System notifications
    { type: 'SYSTEM' as NotificationType, eventType: null, channels: ['IN_APP', 'EMAIL'] as NotificationChannel[], mandatory: true, enabled: true },
  ];

  // Regular user preferences - essential notifications only
  const regularPreferences = [
    // Task notifications (mandatory)
    { type: 'TASK_STATUS' as NotificationType, eventType: 'status_change', channels: ['IN_APP', 'MOBILE_PUSH'] as NotificationChannel[], mandatory: true, enabled: true },
    { type: 'TASK_DEADLINE' as NotificationType, eventType: 'approaching', channels: ['IN_APP', 'MOBILE_PUSH'] as NotificationChannel[], mandatory: true, enabled: true },
    { type: 'TASK_ASSIGNMENT' as NotificationType, eventType: 'assigned', channels: ['IN_APP', 'MOBILE_PUSH'] as NotificationChannel[], mandatory: true, enabled: true },

    // Order notifications (optional, disabled by default)
    { type: 'ORDER_STATUS' as NotificationType, eventType: 'status_change', channels: ['IN_APP'] as NotificationChannel[], mandatory: false, enabled: false },

    // Stock notifications (optional)
    { type: 'STOCK_LOW' as NotificationType, eventType: 'low_stock', channels: ['IN_APP'] as NotificationChannel[], mandatory: false, enabled: true },

    // System notifications
    { type: 'SYSTEM' as NotificationType, eventType: null, channels: ['IN_APP'] as NotificationChannel[], mandatory: true, enabled: true },
  ];

  let adminCount = 0;
  let regularCount = 0;

  // Seed admin preferences
  for (const user of adminUsers) {
    for (const pref of adminPreferences) {
      await prisma.userNotificationPreference.upsert({
        where: {
          userId_notificationType_eventType: {
            userId: user.id,
            notificationType: pref.type,
            eventType: pref.eventType,
          },
        },
        create: {
          userId: user.id,
          notificationType: pref.type,
          eventType: pref.eventType,
          channels: pref.channels,
          isMandatory: pref.mandatory,
          enabled: pref.enabled,
        },
        update: {
          channels: pref.channels,
          isMandatory: pref.mandatory,
        },
      });
    }
    adminCount++;
  }

  // Seed regular user preferences
  for (const user of regularUsers) {
    for (const pref of regularPreferences) {
      await prisma.userNotificationPreference.upsert({
        where: {
          userId_notificationType_eventType: {
            userId: user.id,
            notificationType: pref.type,
            eventType: pref.eventType,
          },
        },
        create: {
          userId: user.id,
          notificationType: pref.type,
          eventType: pref.eventType,
          channels: pref.channels,
          isMandatory: pref.mandatory,
          enabled: pref.enabled,
        },
        update: {
          channels: pref.channels,
          isMandatory: pref.mandatory,
        },
      });
    }
    regularCount++;
  }

  console.log(`   ✓ Created preferences for ${adminCount} admin users`);
  console.log(`   ✓ Created preferences for ${regularCount} regular users`);
  console.log('');
}

async function seedDeviceTokens(testUsers: TestUser[]) {
  console.log('2️⃣  Seeding device tokens...');

  const platforms: Platform[] = ['IOS', 'ANDROID', 'WEB'];
  let tokenCount = 0;

  for (const user of testUsers) {
    for (const platform of platforms) {
      // Generate fake but realistic device tokens
      const token = `${TEST_DATA_MARKER}_${platform.toLowerCase()}_token_${user.id}_${Date.now()}`;

      await prisma.deviceToken.upsert({
        where: {
          token: token,
        },
        create: {
          userId: user.id,
          token: token,
          platform: platform,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
      tokenCount++;
    }
  }

  console.log(`   ✓ Created ${tokenCount} device tokens across ${platforms.length} platforms`);
  console.log('');
}

async function seedSampleNotifications(testUsers: TestUser[]) {
  console.log('3️⃣  Seeding sample notifications...');

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const sampleNotifications = [
    // TASK notifications
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Task Status Changed`,
      body: 'Task #12345 has been moved to IN_PRODUCTION',
      type: 'TASK_STATUS' as NotificationType,
      channel: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'] as NotificationChannel[],
      importance: 'NORMAL' as NotificationImportance,
      actionUrl: '/tasks/12345',
      scheduledAt: twoDaysAgo,
      sentAt: twoDaysAgo,
      deliveredAt: twoDaysAgo,
      deliveredChannels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { taskId: 'test-task-001', oldStatus: 'PREPARATION', newStatus: 'IN_PRODUCTION' },
      relatedEntityType: 'TASK',
      relatedEntityId: 'test-task-001',
    },
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Task Deadline Approaching`,
      body: 'Task #12346 is due in 2 days',
      type: 'TASK_DEADLINE' as NotificationType,
      channel: ['IN_APP', 'EMAIL', 'WHATSAPP'] as NotificationChannel[],
      importance: 'HIGH' as NotificationImportance,
      actionUrl: '/tasks/12346',
      scheduledAt: yesterday,
      sentAt: yesterday,
      deliveredAt: yesterday,
      deliveredChannels: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      failedChannels: ['WHATSAPP'] as NotificationChannel[],
      retryCount: 1,
      metadata: { taskId: 'test-task-002', dueDate: tomorrow.toISOString(), daysRemaining: 2 },
      relatedEntityType: 'TASK',
      relatedEntityId: 'test-task-002',
    },
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} New Task Assignment`,
      body: 'You have been assigned to Task #12347',
      type: 'TASK_ASSIGNMENT' as NotificationType,
      channel: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'] as NotificationChannel[],
      importance: 'HIGH' as NotificationImportance,
      actionUrl: '/tasks/12347',
      scheduledAt: now,
      sentAt: null,
      deliveredAt: null,
      deliveredChannels: [] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { taskId: 'test-task-003', assignedBy: 'Manager Name' },
      relatedEntityType: 'TASK',
      relatedEntityId: 'test-task-003',
    },

    // ORDER notifications
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} New Order Created`,
      body: 'Order #ORD-2024-001 has been created',
      type: 'ORDER_CREATED' as NotificationType,
      channel: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      importance: 'NORMAL' as NotificationImportance,
      actionUrl: '/orders/ORD-2024-001',
      scheduledAt: yesterday,
      sentAt: yesterday,
      deliveredAt: yesterday,
      deliveredChannels: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { orderId: 'test-order-001', supplier: 'Test Supplier', totalItems: 5 },
      relatedEntityType: 'ORDER',
      relatedEntityId: 'test-order-001',
    },
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Order Status Update`,
      body: 'Order #ORD-2024-001 is now PARTIALLY_FULFILLED',
      type: 'ORDER_STATUS' as NotificationType,
      channel: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      importance: 'NORMAL' as NotificationImportance,
      actionUrl: '/orders/ORD-2024-001',
      scheduledAt: now,
      sentAt: now,
      deliveredAt: now,
      deliveredChannels: ['IN_APP'] as NotificationChannel[],
      failedChannels: ['EMAIL'] as NotificationChannel[],
      retryCount: 2,
      metadata: { orderId: 'test-order-001', oldStatus: 'CREATED', newStatus: 'PARTIALLY_FULFILLED' },
      relatedEntityType: 'ORDER',
      relatedEntityId: 'test-order-001',
    },
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Order Overdue`,
      body: 'Order #ORD-2024-002 is overdue by 3 days',
      type: 'ORDER_OVERDUE' as NotificationType,
      channel: ['IN_APP', 'EMAIL', 'WHATSAPP'] as NotificationChannel[],
      importance: 'URGENT' as NotificationImportance,
      actionUrl: '/orders/ORD-2024-002',
      scheduledAt: yesterday,
      sentAt: yesterday,
      deliveredAt: yesterday,
      deliveredChannels: ['IN_APP', 'EMAIL', 'WHATSAPP'] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { orderId: 'test-order-002', daysOverdue: 3, supplier: 'Test Supplier' },
      relatedEntityType: 'ORDER',
      relatedEntityId: 'test-order-002',
      targetSectors: ['ADMIN', 'WAREHOUSE', 'LEADER'] as SectorPrivileges[],
      isMandatory: true,
    },

    // STOCK notifications
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Low Stock Alert`,
      body: 'Item "Test Paint - Blue" is running low (5 units remaining)',
      type: 'STOCK_LOW' as NotificationType,
      channel: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      importance: 'NORMAL' as NotificationImportance,
      actionUrl: '/inventory/items/test-item-001',
      scheduledAt: twoDaysAgo,
      sentAt: twoDaysAgo,
      deliveredAt: twoDaysAgo,
      deliveredChannels: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { itemId: 'test-item-001', itemName: 'Test Paint - Blue', currentQuantity: 5, reorderPoint: 10 },
      relatedEntityType: 'ITEM',
      relatedEntityId: 'test-item-001',
      targetSectors: ['ADMIN', 'WAREHOUSE'] as SectorPrivileges[],
    },
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Out of Stock`,
      body: 'Item "Test Vinyl Roll" is out of stock',
      type: 'STOCK_OUT' as NotificationType,
      channel: ['IN_APP', 'EMAIL', 'WHATSAPP'] as NotificationChannel[],
      importance: 'URGENT' as NotificationImportance,
      actionUrl: '/inventory/items/test-item-002',
      scheduledAt: yesterday,
      sentAt: yesterday,
      deliveredAt: yesterday,
      deliveredChannels: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      failedChannels: ['WHATSAPP'] as NotificationChannel[],
      retryCount: 1,
      metadata: { itemId: 'test-item-002', itemName: 'Test Vinyl Roll', currentQuantity: 0 },
      relatedEntityType: 'ITEM',
      relatedEntityId: 'test-item-002',
      targetSectors: ['ADMIN', 'WAREHOUSE', 'PRODUCTION'] as SectorPrivileges[],
      isMandatory: true,
    },
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Reorder Point Reached`,
      body: 'Item "Test Paint - Red" has reached its reorder point',
      type: 'STOCK_REORDER' as NotificationType,
      channel: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      importance: 'HIGH' as NotificationImportance,
      actionUrl: '/inventory/items/test-item-003',
      scheduledAt: now,
      sentAt: null,
      deliveredAt: null,
      deliveredChannels: [] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { itemId: 'test-item-003', itemName: 'Test Paint - Red', currentQuantity: 8, reorderPoint: 10, reorderQuantity: 50 },
      relatedEntityType: 'ITEM',
      relatedEntityId: 'test-item-003',
      targetSectors: ['ADMIN', 'WAREHOUSE'] as SectorPrivileges[],
    },

    // SYSTEM notifications
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} System Maintenance`,
      body: 'System maintenance scheduled for tomorrow at 2:00 AM',
      type: 'SYSTEM' as NotificationType,
      channel: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      importance: 'HIGH' as NotificationImportance,
      scheduledAt: twoDaysAgo,
      sentAt: twoDaysAgo,
      deliveredAt: twoDaysAgo,
      deliveredChannels: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { maintenanceDate: tomorrow.toISOString(), duration: '2 hours' },
      isMandatory: true,
    },

    // Pending notification (scheduled for future)
    {
      userId: testUsers[0].id,
      title: `${TEST_DATA_MARKER} Scheduled Reminder`,
      body: 'This is a scheduled reminder for tomorrow',
      type: 'GENERAL' as NotificationType,
      channel: ['IN_APP', 'EMAIL'] as NotificationChannel[],
      importance: 'NORMAL' as NotificationImportance,
      scheduledAt: tomorrow,
      sentAt: null,
      deliveredAt: null,
      deliveredChannels: [] as NotificationChannel[],
      failedChannels: [] as NotificationChannel[],
      metadata: { reminderType: 'test_reminder' },
    },
  ];

  let createdCount = 0;
  const createdNotificationIds: string[] = [];

  for (const notif of sampleNotifications) {
    const created = await prisma.notification.create({
      data: notif,
    });
    createdNotificationIds.push(created.id);
    createdCount++;
  }

  console.log(`   ✓ Created ${createdCount} sample notifications`);
  console.log(`   ✓ Types: TASK (3), ORDER (3), STOCK (3), SYSTEM (1), GENERAL (1)`);
  console.log('');

  // Create seen/read records for some notifications
  await seedSeenNotifications(testUsers, createdNotificationIds.slice(0, 5));
}

async function seedSeenNotifications(testUsers: TestUser[], notificationIds: string[]) {
  console.log('4️⃣  Seeding seen notification records...');

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  let seenCount = 0;
  let reminderCount = 0;

  for (let i = 0; i < notificationIds.length && i < testUsers.length; i++) {
    const user = testUsers[i % testUsers.length];
    const notificationId = notificationIds[i];

    // Some notifications are seen immediately, others with reminders
    const hasReminder = i % 3 === 0;

    await prisma.seenNotification.create({
      data: {
        userId: user.id,
        notificationId: notificationId,
        seenAt: yesterday,
        remindAt: hasReminder ? tomorrow : null,
      },
    });

    seenCount++;
    if (hasReminder) reminderCount++;
  }

  console.log(`   ✓ Created ${seenCount} seen notification records`);
  console.log(`   ✓ ${reminderCount} notifications have reminders set`);
  console.log('');
}

async function seedNotificationDeliveries() {
  console.log('5️⃣  Seeding notification delivery records...');

  // Get test notifications
  const testNotifications = await prisma.notification.findMany({
    where: {
      title: {
        contains: TEST_DATA_MARKER,
      },
    },
  });

  if (testNotifications.length === 0) {
    console.log('   ⚠️  No test notifications found to create delivery records');
    return;
  }

  const now = new Date();
  const deliveryStatuses: DeliveryStatus[] = ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'RETRYING'];
  let deliveryCount = 0;

  for (const notification of testNotifications) {
    // Create delivery records for each channel
    for (const channel of notification.channel) {
      // Determine status based on notification state
      let status: DeliveryStatus = 'PENDING';
      let sentAt = null;
      let deliveredAt = null;
      let failedAt = null;
      let errorMessage = null;

      if (notification.deliveredChannels.includes(channel)) {
        status = 'DELIVERED';
        sentAt = notification.sentAt;
        deliveredAt = notification.deliveredAt;
      } else if (notification.failedChannels.includes(channel)) {
        status = 'FAILED';
        sentAt = notification.sentAt;
        failedAt = new Date(notification.sentAt!.getTime() + 5000); // Failed 5 seconds after send
        errorMessage = `Failed to deliver via ${channel}: Connection timeout`;
      } else if (notification.sentAt) {
        status = 'PROCESSING';
        sentAt = notification.sentAt;
      }

      await prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: channel,
          status: status,
          sentAt: sentAt,
          deliveredAt: deliveredAt,
          failedAt: failedAt,
          errorMessage: errorMessage,
          metadata: {
            attemptNumber: notification.retryCount || 1,
            provider: channel === 'EMAIL' ? 'nodemailer' : channel === 'SMS' ? 'twilio' : channel === 'WHATSAPP' ? 'whatsapp-web.js' : 'firebase',
          },
        },
      });

      deliveryCount++;
    }
  }

  console.log(`   ✓ Created ${deliveryCount} notification delivery records`);
  console.log(`   ✓ Statuses: DELIVERED, FAILED, PENDING, PROCESSING`);
  console.log('');
}

async function cleanTestData() {
  console.log('🧹 Cleaning up test notification data...\n');

  // Delete notification deliveries first (due to foreign key constraints)
  const deletedDeliveries = await prisma.notificationDelivery.deleteMany({
    where: {
      notification: {
        title: {
          contains: TEST_DATA_MARKER,
        },
      },
    },
  });

  // Delete seen notifications
  const deletedSeen = await prisma.seenNotification.deleteMany({
    where: {
      notification: {
        title: {
          contains: TEST_DATA_MARKER,
        },
      },
    },
  });

  // Delete test notifications
  const deletedNotifications = await prisma.notification.deleteMany({
    where: {
      title: {
        contains: TEST_DATA_MARKER,
      },
    },
  });

  // Delete test device tokens
  const deletedTokens = await prisma.deviceToken.deleteMany({
    where: {
      token: {
        contains: TEST_DATA_MARKER,
      },
    },
  });

  console.log('✅ Test data cleanup completed:');
  console.log(`   - ${deletedNotifications.count} notifications deleted`);
  console.log(`   - ${deletedDeliveries.count} delivery records deleted`);
  console.log(`   - ${deletedSeen.count} seen notification records deleted`);
  console.log(`   - ${deletedTokens.count} device tokens deleted`);
  console.log('\n📝 Note: User notification preferences were kept intact.');
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const isCleanup = args.includes('--clean');

  try {
    if (isCleanup) {
      await cleanTestData();
    } else {
      await seedNotificationData();
    }
  } catch (error) {
    console.error('❌ Error during seed execution:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
