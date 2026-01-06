import { Test, TestingModule } from '@nestjs/testing';
import { NotificationAnalyticsService, DateRange } from './notification-analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { InternalServerErrorException } from '@nestjs/common';

describe('NotificationAnalyticsService', () => {
  let service: NotificationAnalyticsService;
  let prismaService: PrismaService;
  let cacheService: CacheService;

  const mockPrismaService = {
    notification: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    notificationDelivery: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    seenNotification: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationAnalyticsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<NotificationAnalyticsService>(NotificationAnalyticsService);
    prismaService = module.get<PrismaService>(PrismaService);
    cacheService = module.get<CacheService>(CacheService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOverallStats', () => {
    it('should return cached stats if available', async () => {
      const cachedStats = {
        total: 100,
        delivered: 90,
        failed: 5,
        seen: 80,
        deliveryRate: 90,
        seenRate: 88.89,
        byType: { TASK: 50, ORDER: 50 },
        byChannel: { EMAIL: 60, IN_APP: 40 },
      };

      mockCacheService.get.mockResolvedValue(cachedStats);

      const result = await service.getOverallStats();

      expect(result).toEqual(cachedStats);
      expect(mockCacheService.get).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.notification.count).not.toHaveBeenCalled();
    });

    it('should calculate and cache overall stats', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notification.count.mockResolvedValue(100);
      mockPrismaService.notificationDelivery.count
        .mockResolvedValueOnce(90) // delivered
        .mockResolvedValueOnce(5); // failed
      mockPrismaService.seenNotification.count.mockResolvedValue(80);
      mockPrismaService.notification.groupBy.mockResolvedValue([
        { type: 'TASK', _count: 50 },
        { type: 'ORDER', _count: 50 },
      ]);
      mockPrismaService.notification.findMany.mockResolvedValue([
        { channel: ['EMAIL', 'IN_APP'] },
        { channel: ['EMAIL'] },
      ]);

      const result = await service.getOverallStats();

      expect(result.total).toBe(100);
      expect(result.delivered).toBe(90);
      expect(result.failed).toBe(5);
      expect(result.seen).toBe(80);
      expect(result.deliveryRate).toBe(90);
      expect(result.seenRate).toBeCloseTo(88.89, 2);
      expect(mockCacheService.set).toHaveBeenCalledTimes(1);
    });

    it('should handle date range filtering', async () => {
      const dateRange: DateRange = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      };

      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notification.count.mockResolvedValue(50);
      mockPrismaService.notificationDelivery.count.mockResolvedValue(45);
      mockPrismaService.seenNotification.count.mockResolvedValue(40);
      mockPrismaService.notification.groupBy.mockResolvedValue([]);
      mockPrismaService.notification.findMany.mockResolvedValue([]);

      await service.getOverallStats(dateRange);

      expect(mockPrismaService.notification.count).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
      });
    });

    it('should handle errors gracefully', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notification.count.mockRejectedValue(new Error('Database error'));

      await expect(service.getOverallStats()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getDeliveryStats', () => {
    it('should return delivery stats by channel', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notificationDelivery.groupBy.mockResolvedValue([
        { channel: 'EMAIL', status: 'DELIVERED', _count: 50 },
        { channel: 'EMAIL', status: 'FAILED', _count: 5 },
        { channel: 'SMS', status: 'DELIVERED', _count: 20 },
        { channel: 'IN_APP', status: 'DELIVERED', _count: 100 },
      ]);

      const result = await service.getDeliveryStats();

      expect(result.email.delivered).toBe(50);
      expect(result.email.failed).toBe(5);
      expect(result.sms.delivered).toBe(20);
      expect(result.inApp.delivered).toBe(100);
    });

    it('should use cache when available', async () => {
      const cachedStats = {
        email: { sent: 100, delivered: 95, failed: 5 },
        sms: { sent: 50, delivered: 48, failed: 2 },
        push: { sent: 0, delivered: 0, failed: 0 },
        whatsapp: { sent: 0, delivered: 0, failed: 0 },
        inApp: { sent: 200, delivered: 200 },
      };

      mockCacheService.get.mockResolvedValue(cachedStats);

      const result = await service.getDeliveryStats();

      expect(result).toEqual(cachedStats);
      expect(mockPrismaService.notificationDelivery.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('getTimeSeries', () => {
    it('should return time series data for daily interval', async () => {
      const dateRange: DateRange = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-07'),
      };

      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.$queryRawUnsafe.mockResolvedValue([
        { time: new Date('2024-01-01'), count: BigInt(10) },
        { time: new Date('2024-01-02'), count: BigInt(15) },
        { time: new Date('2024-01-03'), count: BigInt(20) },
      ]);

      const result = await service.getTimeSeries(dateRange, 'day');

      expect(result).toHaveLength(3);
      expect(result[0].count).toBe(10);
      expect(result[1].count).toBe(15);
      expect(result[2].count).toBe(20);
    });

    it('should handle hourly interval', async () => {
      const dateRange: DateRange = {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-01-01T23:59:59Z'),
      };

      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.$queryRawUnsafe.mockResolvedValue([
        { time: new Date('2024-01-01T00:00:00Z'), count: BigInt(5) },
        { time: new Date('2024-01-01T01:00:00Z'), count: BigInt(8) },
      ]);

      const result = await service.getTimeSeries(dateRange, 'hour');

      expect(result).toHaveLength(2);
      expect(mockPrismaService.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("DATE_TRUNC('hour'"),
        dateRange.start,
        dateRange.end,
      );
    });
  });

  describe('getFailureReasons', () => {
    it('should return top 10 failure reasons', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notificationDelivery.groupBy.mockResolvedValue([
        { errorMessage: 'Network timeout', _count: 25 },
        { errorMessage: 'Invalid email', _count: 15 },
        { errorMessage: 'Service unavailable', _count: 10 },
      ]);

      const result = await service.getFailureReasons();

      expect(result).toHaveLength(3);
      expect(result[0].reason).toBe('Network timeout');
      expect(result[0].count).toBe(25);
      expect(result[1].reason).toBe('Invalid email');
      expect(result[1].count).toBe(15);
    });

    it('should handle null error messages', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notificationDelivery.groupBy.mockResolvedValue([
        { errorMessage: null, _count: 5 },
        { errorMessage: 'Unknown error', _count: 3 },
      ]);

      const result = await service.getFailureReasons();

      expect(result).toHaveLength(2);
      expect(result[0].reason).toBeNull();
      expect(result[0].count).toBe(5);
    });
  });

  describe('getUserEngagement', () => {
    it('should return user engagement metrics', async () => {
      const userId = 'user-123';

      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notification.count.mockResolvedValue(100);
      mockPrismaService.seenNotification.count.mockResolvedValue(85);

      // Mock countUserClickedNotifications
      mockPrismaService.seenNotification.count.mockResolvedValueOnce(45);

      // Mock getAverageTimeToSee
      mockPrismaService.seenNotification.findMany.mockResolvedValue([
        {
          seenAt: new Date('2024-01-01T00:10:00Z'),
          notification: { sentAt: new Date('2024-01-01T00:00:00Z') },
        },
        {
          seenAt: new Date('2024-01-01T00:20:00Z'),
          notification: { sentAt: new Date('2024-01-01T00:00:00Z') },
        },
      ]);

      const result = await service.getUserEngagement(userId);

      expect(result.received).toBe(100);
      expect(result.seen).toBe(85);
      expect(result.seenRate).toBe(85);
      expect(result.clickRate).toBe(45);
      expect(result.avgTimeToSee).toBeGreaterThan(0);
    });

    it('should handle users with no notifications', async () => {
      const userId = 'user-456';

      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notification.count.mockResolvedValue(0);
      mockPrismaService.seenNotification.count.mockResolvedValue(0);
      mockPrismaService.seenNotification.findMany.mockResolvedValue([]);

      const result = await service.getUserEngagement(userId);

      expect(result.received).toBe(0);
      expect(result.seen).toBe(0);
      expect(result.seenRate).toBe(0);
      expect(result.clickRate).toBe(0);
      expect(result.avgTimeToSee).toBe(0);
    });
  });

  describe('getTopUsers', () => {
    it('should return top users by received notifications', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notification.groupBy.mockResolvedValue([
        { userId: 'user-1', _count: 100 },
        { userId: 'user-2', _count: 80 },
      ]);
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
        { id: 'user-2', name: 'Jane Smith', email: 'jane@example.com' },
      ]);

      const result = await service.getTopUsers('received', 10);

      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe('user-1');
      expect(result[0].userName).toBe('John Doe');
      expect(result[0].count).toBe(100);
    });

    it('should return top users by seen notifications', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.seenNotification.groupBy.mockResolvedValue([
        { userId: 'user-1', _count: 50 },
      ]);
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
      ]);

      const result = await service.getTopUsers('seen', 10);

      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(50);
    });

    it('should handle users without names', async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockPrismaService.notification.groupBy.mockResolvedValue([
        { userId: 'user-unknown', _count: 10 },
      ]);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getTopUsers('received', 10);

      expect(result).toHaveLength(1);
      expect(result[0].userName).toBe('Unknown');
    });
  });

  describe('exportToCSV', () => {
    it('should export notifications to CSV format', async () => {
      mockPrismaService.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          title: 'Test Notification',
          type: 'TASK',
          importance: 'HIGH',
          userId: 'user-1',
          user: { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
          sentAt: new Date('2024-01-01'),
          deliveredAt: new Date('2024-01-01'),
          channel: ['EMAIL'],
          deliveries: [{ status: 'DELIVERED' }],
          seenBy: [{ seenAt: new Date('2024-01-01') }],
          createdAt: new Date('2024-01-01'),
        },
      ]);

      const result = await service.exportToCSV({});

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toContain('notif-1');
      expect(result.toString()).toContain('Test Notification');
      expect(result.toString()).toContain('John Doe');
    });

    it('should handle empty result set', async () => {
      mockPrismaService.notification.findMany.mockResolvedValue([]);

      const result = await service.exportToCSV({});

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0); // Should at least have headers
    });

    it('should limit export to 10000 records', async () => {
      mockPrismaService.notification.findMany.mockResolvedValue([]);

      await service.exportToCSV({});

      expect(mockPrismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10000,
        }),
      );
    });
  });
});
