import { PrismaService } from '../../src/modules/common/prisma/prisma.service';
import { SECTOR_PRIVILEGES, TASK_STATUS, ORDER_STATUS } from '../../src/constants';

/**
 * Wait for async operations to complete
 */
export const waitForAsync = (ms: number = 1000): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Create a test user with customizable properties
 */
export const createTestUser = async (
  prisma: PrismaService,
  data: {
    name: string;
    email: string;
    sectorPrivilege?: SECTOR_PRIVILEGES;
    phone?: string;
    isActive?: boolean;
  }
) => {
  const sector = await prisma.sector.findFirst({
    where: { privilege: data.sectorPrivilege || SECTOR_PRIVILEGES.BASIC },
  });

  if (!sector) {
    throw new Error(`Sector with privilege ${data.sectorPrivilege} not found`);
  }

  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone || '+5511999999999',
      sectorId: sector.id,
      isActive: data.isActive ?? true,
      // Add other required fields based on your schema
    },
  });
};

/**
 * Create a test task with customizable properties
 */
export const createTestTask = async (
  prisma: PrismaService,
  data: {
    title: string;
    userId: string;
    status?: string;
    priority?: string;
    sectorId?: string;
    deadline?: Date;
  }
) => {
  return prisma.task.create({
    data: {
      title: data.title,
      description: `Description for ${data.title}`,
      userId: data.userId,
      status: (data.status || TASK_STATUS.PREPARATION) as any,
      priority: data.priority || 'NORMAL',
      sectorId: data.sectorId,
      deadline: data.deadline || new Date(Date.now() + 86400000), // 1 day from now
      // Add other required fields based on your schema
    },
  });
};

/**
 * Create a test order with customizable properties
 */
export const createTestOrder = async (
  prisma: PrismaService,
  data: {
    description: string;
    status?: string;
    supplierId?: string;
  }
) => {
  // Find or create a supplier
  let supplier;
  if (data.supplierId) {
    supplier = await prisma.supplier.findUnique({
      where: { id: data.supplierId },
    });
  } else {
    supplier = await prisma.supplier.findFirst();
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: {
          name: 'Test Supplier',
          email: 'supplier@test.com',
          phone: '+5511888888888',
          // Add other required fields
        },
      });
    }
  }

  return prisma.order.create({
    data: {
      description: data.description,
      status: (data.status || ORDER_STATUS.CREATED) as any,
      supplierId: supplier.id,
      expectedDeliveryDate: new Date(Date.now() + 604800000), // 7 days from now
      // Add other required fields based on your schema
    },
  });
};

/**
 * Create a test item with customizable properties
 */
export const createTestItem = async (
  prisma: PrismaService,
  data: {
    name: string;
    quantity?: number;
    minStock?: number;
  }
) => {
  return prisma.item.create({
    data: {
      name: data.name,
      description: `Description for ${data.name}`,
      quantity: data.quantity ?? 100,
      minStock: data.minStock ?? 10,
      unit: 'UN',
      // Add other required fields based on your schema
    },
  });
};

/**
 * Create a test notification preference
 */
export const createTestNotificationPreference = async (
  prisma: PrismaService,
  data: {
    userId: string;
    notificationType: string;
    eventType?: string;
    enabled?: boolean;
    channels?: string[];
    isMandatory?: boolean;
  }
) => {
  return prisma.userNotificationPreference.create({
    data: {
      userId: data.userId,
      notificationType: data.notificationType as any,
      eventType: data.eventType || null,
      enabled: data.enabled ?? true,
      channels: (data.channels || ['IN_APP']) as any[],
      isMandatory: data.isMandatory ?? false,
    },
  });
};

/**
 * Create a test notification
 */
export const createTestNotification = async (
  prisma: PrismaService,
  data: {
    userId: string;
    title: string;
    body: string;
    type: string;
    channels?: string[];
    importance?: string;
    actionUrl?: string;
    scheduledAt?: Date;
  }
) => {
  return prisma.notification.create({
    data: {
      userId: data.userId,
      title: data.title,
      body: data.body,
      type: data.type as any,
      channel: (data.channels || ['IN_APP']) as any[],
      importance: (data.importance || 'NORMAL') as any,
      actionUrl: data.actionUrl,
      scheduledAt: data.scheduledAt,
    },
  });
};

/**
 * Create a seen notification record
 */
export const markNotificationAsSeen = async (
  prisma: PrismaService,
  notificationId: string,
  userId: string
) => {
  return prisma.seenNotification.create({
    data: {
      notificationId,
      userId,
      seenAt: new Date(),
    },
  });
};

/**
 * Get notifications for a user
 */
export const getUserNotifications = async (
  prisma: PrismaService,
  userId: string,
  filters?: {
    type?: string;
    seen?: boolean;
  }
) => {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(filters?.type && { type: filters.type as any }),
      ...(filters?.seen !== undefined && {
        seenBy: filters.seen
          ? { some: { userId } }
          : { none: { userId } },
      }),
    },
    include: {
      seenBy: true,
      deliveries: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
};

/**
 * Get notification deliveries
 */
export const getNotificationDeliveries = async (
  prisma: PrismaService,
  filters?: {
    notificationId?: string;
    userId?: string;
    channel?: string;
    status?: string;
  }
) => {
  return prisma.notificationDelivery.findMany({
    where: {
      ...(filters?.notificationId && { notificationId: filters.notificationId }),
      ...(filters?.channel && { channel: filters.channel as any }),
      ...(filters?.status && { status: filters.status as any }),
      ...(filters?.userId && {
        notification: {
          userId: filters.userId,
        },
      }),
    },
    include: {
      notification: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
};

/**
 * Clean up database - remove all test data
 */
export const cleanupDatabase = async (prisma: PrismaService) => {
  // Delete in order to respect foreign key constraints
  await prisma.seenNotification.deleteMany({});
  await prisma.notificationDelivery.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.userNotificationPreference.deleteMany({
    where: {
      user: {
        email: {
          contains: '@test.com',
        },
      },
    },
  });
  await prisma.task.deleteMany({
    where: {
      title: {
        contains: 'Test',
      },
    },
  });
  await prisma.order.deleteMany({
    where: {
      description: {
        contains: 'Test',
      },
    },
  });
  await prisma.item.deleteMany({
    where: {
      name: {
        contains: 'Test',
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: '@test.com',
      },
    },
  });
  await prisma.supplier.deleteMany({
    where: {
      email: {
        contains: '@test.com',
      },
    },
  });
};

/**
 * Create test fixture data
 */
export const createTestFixtures = async (prisma: PrismaService) => {
  // Create test sectors if they don't exist
  const sectors = await Promise.all(
    Object.values(SECTOR_PRIVILEGES).map(async (privilege) => {
      const existing = await prisma.sector.findFirst({
        where: { privilege: privilege as any },
      });

      if (existing) return existing;

      return prisma.sector.create({
        data: {
          name: privilege,
          privilege: privilege as any,
        },
      });
    })
  );

  return { sectors };
};

/**
 * Simulate notification dispatch
 */
export const simulateNotificationDispatch = async (
  prisma: PrismaService,
  notificationId: string
) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    throw new Error('Notification not found');
  }

  // Mark as sent
  await prisma.notification.update({
    where: { id: notificationId },
    data: { sentAt: new Date() },
  });

  // Create delivery records for each channel
  const deliveries = notification.channel.map((channel) => ({
    notificationId: notification.id,
    channel: channel as any,
    status: 'DELIVERED' as any,
    sentAt: new Date(),
    deliveredAt: new Date(),
  }));

  await prisma.notificationDelivery.createMany({
    data: deliveries,
  });
};

/**
 * Simulate notification failure
 */
export const simulateNotificationFailure = async (
  prisma: PrismaService,
  notificationId: string,
  channel: string,
  errorMessage: string = 'Test failure'
) => {
  await prisma.notificationDelivery.create({
    data: {
      notificationId,
      channel: channel as any,
      status: 'FAILED' as any,
      sentAt: new Date(),
      failedAt: new Date(),
      errorMessage,
      attempts: 1,
    },
  });
};

/**
 * Get unread notification count
 */
export const getUnreadNotificationCount = async (
  prisma: PrismaService,
  userId: string
) => {
  return prisma.notification.count({
    where: {
      userId,
      seenBy: {
        none: {
          userId,
        },
      },
    },
  });
};

/**
 * Verify notification was sent via channel
 */
export const verifyNotificationSent = async (
  prisma: PrismaService,
  notificationId: string,
  channel: string
): Promise<boolean> => {
  const delivery = await prisma.notificationDelivery.findFirst({
    where: {
      notificationId,
      channel: channel as any,
      status: {
        in: ['DELIVERED', 'PROCESSING'],
      },
    },
  });

  return delivery !== null;
};

/**
 * Create batch notifications
 */
export const createBatchNotifications = async (
  prisma: PrismaService,
  count: number,
  baseData: {
    userId: string;
    type: string;
    channel?: string[];
  }
) => {
  const notifications = Array.from({ length: count }, (_, i) => ({
    userId: baseData.userId,
    title: `Batch Notification ${i + 1}`,
    body: `Body for notification ${i + 1}`,
    type: baseData.type as any,
    channel: (baseData.channel || ['IN_APP']) as any[],
    importance: 'NORMAL' as any,
  }));

  await prisma.notification.createMany({
    data: notifications,
  });

  return prisma.notification.findMany({
    where: {
      userId: baseData.userId,
      title: {
        startsWith: 'Batch Notification',
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: count,
  });
};
