import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE, SECTOR_PRIVILEGES, TASK_STATUS } from '../../src/constants';

/**
 * Sample user fixtures with different roles
 */
export const userFixtures = {
  admin: {
    name: 'Admin Test User',
    email: 'admin.test@example.com',
    phone: '+5511999990001',
    sectorPrivilege: SECTOR_PRIVILEGES.ADMIN,
    isActive: true,
  },
  warehouse: {
    name: 'Warehouse Test User',
    email: 'warehouse.test@example.com',
    phone: '+5511999990002',
    sectorPrivilege: SECTOR_PRIVILEGES.WAREHOUSE,
    isActive: true,
  },
  production: {
    name: 'Production Test User',
    email: 'production.test@example.com',
    phone: '+5511999990003',
    sectorPrivilege: SECTOR_PRIVILEGES.PRODUCTION,
    isActive: true,
  },
  designer: {
    name: 'Designer Test User',
    email: 'designer.test@example.com',
    phone: '+5511999990004',
    sectorPrivilege: SECTOR_PRIVILEGES.DESIGNER,
    isActive: true,
  },
  leader: {
    name: 'Leader Test User',
    email: 'leader.test@example.com',
    phone: '+5511999990005',
    sectorPrivilege: SECTOR_PRIVILEGES.LEADER,
    isActive: true,
  },
};

/**
 * Sample task fixtures
 */
export const taskFixtures = {
  preparation: {
    title: 'Test Task - Preparation',
    description: 'Task in preparation stage for testing',
    status: TASK_STATUS.PREPARATION,
    priority: 'NORMAL',
  },
  inProduction: {
    title: 'Test Task - In Production',
    description: 'Task currently in production for testing',
    status: TASK_STATUS.IN_PRODUCTION,
    priority: 'HIGH',
  },
  completed: {
    title: 'Test Task - Completed',
    description: 'Completed task for testing',
    status: TASK_STATUS.COMPLETED,
    priority: 'NORMAL',
  },
  urgent: {
    title: 'Test Task - Urgent',
    description: 'Urgent task for testing',
    status: TASK_STATUS.WAITING_PRODUCTION,
    priority: 'CRITICAL',
    deadline: new Date(Date.now() + 86400000), // 1 day from now
  },
};

/**
 * Sample order fixtures
 */
export const orderFixtures = {
  newOrder: {
    description: 'New test order',
    status: 'CREATED',
    expectedDeliveryDate: new Date(Date.now() + 604800000), // 7 days from now
  },
  partiallyFulfilled: {
    description: 'Partially fulfilled test order',
    status: 'PARTIALLY_FULFILLED',
    expectedDeliveryDate: new Date(Date.now() + 259200000), // 3 days from now
  },
  overdue: {
    description: 'Overdue test order',
    status: 'OVERDUE',
    expectedDeliveryDate: new Date(Date.now() - 86400000), // 1 day ago
  },
};

/**
 * Sample item fixtures
 */
export const itemFixtures = {
  lowStock: {
    name: 'Test Item - Low Stock',
    description: 'Item with low stock for testing',
    quantity: 5,
    minStock: 20,
    unit: 'UN',
  },
  outOfStock: {
    name: 'Test Item - Out of Stock',
    description: 'Out of stock item for testing',
    quantity: 0,
    minStock: 10,
    unit: 'UN',
  },
  normalStock: {
    name: 'Test Item - Normal Stock',
    description: 'Item with normal stock for testing',
    quantity: 100,
    minStock: 20,
    unit: 'UN',
  },
};

/**
 * Sample notification preference fixtures
 */
export const notificationPreferenceFixtures = {
  taskStatusMandatory: {
    notificationType: NOTIFICATION_TYPE.TASK,
    eventType: 'status',
    enabled: true,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
    isMandatory: true,
  },
  taskDeadlineMandatory: {
    notificationType: NOTIFICATION_TYPE.TASK,
    eventType: 'deadline',
    enabled: true,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
    isMandatory: true,
  },
  orderOptional: {
    notificationType: NOTIFICATION_TYPE.ORDER,
    eventType: 'created',
    enabled: true,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
    isMandatory: false,
  },
  stockLowOptional: {
    notificationType: NOTIFICATION_TYPE.STOCK,
    eventType: 'low',
    enabled: true,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    isMandatory: false,
  },
  disabledPreference: {
    notificationType: NOTIFICATION_TYPE.GENERAL,
    eventType: null,
    enabled: false,
    channels: [],
    isMandatory: false,
  },
};

/**
 * Sample notification fixtures
 */
export const notificationFixtures = {
  taskCreated: {
    title: 'New Task Created',
    body: 'A new task has been assigned to you',
    type: NOTIFICATION_TYPE.TASK,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
  },
  taskStatusChange: {
    title: 'Task Status Updated',
    body: 'Task status has been changed to IN_PRODUCTION',
    type: NOTIFICATION_TYPE.TASK,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    importance: NOTIFICATION_IMPORTANCE.HIGH,
  },
  taskDeadlineApproaching: {
    title: 'Task Deadline Approaching',
    body: 'Your task is due in 24 hours',
    type: NOTIFICATION_TYPE.TASK,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH],
    importance: NOTIFICATION_IMPORTANCE.HIGH,
  },
  orderReceived: {
    title: 'New Order Received',
    body: 'A new order has been placed',
    type: NOTIFICATION_TYPE.ORDER,
    channel: [NOTIFICATION_CHANNEL.IN_APP],
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
  },
  stockLow: {
    title: 'Low Stock Alert',
    body: 'Stock level is below minimum threshold',
    type: NOTIFICATION_TYPE.STOCK,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    importance: NOTIFICATION_IMPORTANCE.HIGH,
  },
  systemMaintenance: {
    title: 'System Maintenance Scheduled',
    body: 'System will be under maintenance on Sunday at 2 AM',
    type: NOTIFICATION_TYPE.SYSTEM,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
  },
  urgentWarning: {
    title: 'Urgent Warning',
    body: 'Immediate action required',
    type: NOTIFICATION_TYPE.WARNING,
    channel: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL, NOTIFICATION_CHANNEL.PUSH, NOTIFICATION_CHANNEL.SMS],
    importance: NOTIFICATION_IMPORTANCE.CRITICAL,
  },
};

/**
 * Sample delivery scenarios for testing
 */
export const deliveryScenarios = {
  successful: {
    status: 'DELIVERED',
    sentAt: new Date(),
    deliveredAt: new Date(),
    attempts: 1,
  },
  failed: {
    status: 'FAILED',
    sentAt: new Date(),
    failedAt: new Date(),
    attempts: 3,
    errorMessage: 'Delivery failed after 3 attempts',
  },
  pending: {
    status: 'PENDING',
    sentAt: null,
    deliveredAt: null,
    attempts: 0,
  },
  retrying: {
    status: 'RETRYING',
    sentAt: new Date(),
    deliveredAt: null,
    attempts: 2,
    errorMessage: 'Temporary failure, retrying',
  },
};

/**
 * Sample edge case scenarios
 */
export const edgeCaseScenarios = {
  concurrentUpdates: {
    updates: [
      { field: 'priority', value: 'HIGH' },
      { field: 'status', value: 'IN_PRODUCTION' },
      { field: 'deadline', value: new Date(Date.now() + 43200000) },
    ],
  },
  rapidNotifications: {
    count: 50,
    interval: 100, // ms between notifications
  },
  longMessage: {
    title: 'A'.repeat(200),
    body: 'B'.repeat(5000),
  },
  specialCharacters: {
    title: 'Test 测试 Тест 🚀',
    body: 'Special chars: @#$%^&*()_+-=[]{}|;:\'",.<>?/',
  },
  emptyOptionalFields: {
    title: 'Minimal Notification',
    body: 'Only required fields',
    type: NOTIFICATION_TYPE.GENERAL,
    channel: [NOTIFICATION_CHANNEL.IN_APP],
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    actionUrl: null,
    actionType: null,
    scheduledAt: null,
  },
};

/**
 * Sample test timeouts and delays
 */
export const testTimings = {
  shortDelay: 100, // For quick operations
  normalDelay: 1000, // For async operations
  longDelay: 3000, // For complex operations
  veryLongDelay: 5000, // For batch operations
  retryInterval: 2000, // Time between retries
  deliveryTimeout: 10000, // Max time to wait for delivery
};

/**
 * Sample metadata for notifications
 */
export const notificationMetadata = {
  task: {
    taskId: 'test-task-id',
    field: 'status',
    oldValue: 'PREPARATION',
    newValue: 'IN_PRODUCTION',
    changedBy: 'test-user-id',
  },
  order: {
    orderId: 'test-order-id',
    supplierId: 'test-supplier-id',
    totalItems: 10,
    expectedDate: new Date().toISOString(),
  },
  stock: {
    itemId: 'test-item-id',
    currentQuantity: 5,
    minStock: 20,
    deficit: 15,
  },
  system: {
    version: '2.0.0',
    scheduledTime: new Date(Date.now() + 86400000).toISOString(),
    duration: '2 hours',
  },
};

/**
 * Sample rate limit configurations
 */
export const rateLimitConfig = {
  perSecond: 10,
  perMinute: 100,
  perHour: 1000,
  perDay: 10000,
  burstSize: 20,
};

/**
 * Helper to create test data batch
 */
export const createTestBatch = (count: number, template: any) => {
  return Array.from({ length: count }, (_, i) => ({
    ...template,
    title: `${template.title} ${i + 1}`,
  }));
};

/**
 * Helper to generate random test data
 */
export const generateRandomNotification = () => {
  const types = Object.values(NOTIFICATION_TYPE);
  const channels = Object.values(NOTIFICATION_CHANNEL);
  const importances = Object.values(NOTIFICATION_IMPORTANCE);

  return {
    title: `Random Notification ${Math.random().toString(36).substring(7)}`,
    body: `Random body ${Math.random().toString(36).substring(7)}`,
    type: types[Math.floor(Math.random() * types.length)],
    channel: [channels[Math.floor(Math.random() * channels.length)]],
    importance: importances[Math.floor(Math.random() * importances.length)],
  };
};

/**
 * Helper to get fixture by type
 */
export const getFixture = (type: 'user' | 'task' | 'order' | 'item', variant: string) => {
  const fixtures: Record<string, any> = {
    user: userFixtures,
    task: taskFixtures,
    order: orderFixtures,
    item: itemFixtures,
  };

  return fixtures[type]?.[variant];
};
