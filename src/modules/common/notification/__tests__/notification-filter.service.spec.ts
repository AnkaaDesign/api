import { Test, TestingModule } from '@nestjs/testing';
import { NotificationFilterService } from '../notification-filter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationPreferenceService } from '../notification-preference.service';
import { NOTIFICATION_TYPE, SECTOR_PRIVILEGES } from '../../../../constants';

describe('NotificationFilterService', () => {
  let service: NotificationFilterService;
  let prisma: PrismaService;
  let preferenceService: NotificationPreferenceService;

  const mockPrismaService = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockPreferenceService = {
    getUserPreferences: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationFilterService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationPreferenceService, useValue: mockPreferenceService },
      ],
    }).compile();

    service = module.get<NotificationFilterService>(NotificationFilterService);
    prisma = module.get<PrismaService>(PrismaService);
    preferenceService = module.get<NotificationPreferenceService>(NotificationPreferenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('filterByRole', () => {
    it('should filter notifications based on user sector', () => {
      const user: any = {
        id: 'user-1',
        name: 'Test User',
        sector: {
          id: 'sector-1',
          privileges: SECTOR_PRIVILEGES.WAREHOUSE,
        },
      };

      const notifications: any[] = [
        {
          id: 'notif-1',
          type: NOTIFICATION_TYPE.STOCK,
          userId: null,
        },
        {
          id: 'notif-2',
          type: NOTIFICATION_TYPE.TASK,
          userId: 'user-1',
        },
        {
          id: 'notif-3',
          type: NOTIFICATION_TYPE.VACATION,
          userId: 'user-2',
          metadata: { vacation: { userId: 'user-2' } },
        },
      ];

      const result = service.filterByRole(user, notifications);

      // Should see stock (warehouse privilege) and own task
      expect(result).toHaveLength(2);
      expect(result.some((n) => n.id === 'notif-1')).toBe(true);
      expect(result.some((n) => n.id === 'notif-2')).toBe(true);
    });

    it('should allow admin to see all notifications', () => {
      const adminUser: any = {
        id: 'admin-1',
        name: 'Admin User',
        sector: {
          id: 'admin-sector',
          privileges: SECTOR_PRIVILEGES.ADMIN,
        },
      };

      const notifications: any[] = [
        { id: 'notif-1', type: NOTIFICATION_TYPE.STOCK, userId: null },
        { id: 'notif-2', type: NOTIFICATION_TYPE.VACATION, userId: 'user-1' },
        { id: 'notif-3', type: NOTIFICATION_TYPE.TASK, userId: 'user-2' },
      ];

      const result = service.filterByRole(adminUser, notifications);

      expect(result).toHaveLength(3);
    });

    it('should filter task notifications by assignment', () => {
      const user: any = {
        id: 'user-1',
        name: 'Test User',
        sector: {
          id: 'sector-1',
          privileges: SECTOR_PRIVILEGES.PRODUCTION,
        },
        sectorId: 'sector-1',
      };

      const notifications: any[] = [
        {
          id: 'notif-1',
          type: NOTIFICATION_TYPE.TASK,
          userId: null,
          metadata: {
            task: {
              id: 'task-1',
              sectorId: 'sector-1',
              assignedUserIds: ['user-1'],
            },
          },
        },
        {
          id: 'notif-2',
          type: NOTIFICATION_TYPE.TASK,
          userId: null,
          metadata: {
            task: {
              id: 'task-2',
              sectorId: 'sector-2',
              assignedUserIds: ['user-2'],
            },
          },
        },
      ];

      const result = service.filterByRole(user, notifications);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('notif-1');
    });
  });

  describe('canUserReceive', () => {
    it('should allow user with correct sector to receive notification', () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.STOCK,
        userId: null,
      };

      const result = service.canUserReceive(user, notification);

      expect(result).toBe(true);
    });

    it('should deny user without correct sector', () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.STOCK,
        userId: null,
      };

      const result = service.canUserReceive(user, notification);

      expect(result).toBe(false);
    });

    it('should allow admin to receive any notification', () => {
      const adminUser: any = {
        id: 'admin-1',
        sector: { privileges: SECTOR_PRIVILEGES.ADMIN },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.VACATION,
        userId: 'user-2',
      };

      const result = service.canUserReceive(adminUser, notification);

      expect(result).toBe(true);
    });

    it('should allow user to receive their own notifications', () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.TASK,
        userId: 'user-1',
      };

      const result = service.canUserReceive(user, notification);

      expect(result).toBe(true);
    });

    it('should deny user from receiving others targeted notifications', () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.VACATION,
        userId: 'user-2',
      };

      const result = service.canUserReceive(user, notification);

      expect(result).toBe(false);
    });

    it('should allow all users to receive system notifications', () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.BASIC },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.SYSTEM,
        userId: null,
      };

      const result = service.canUserReceive(user, notification);

      expect(result).toBe(true);
    });
  });

  describe('shouldReceiveNotification', () => {
    it('should check role filtering first', async () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.STOCK,
        userId: null,
        isMandatory: false,
      };

      const result = await service.shouldReceiveNotification(user, notification);

      expect(result).toBe(false);
      expect(preferenceService.getUserPreferences).not.toHaveBeenCalled();
    });

    it('should skip preference check for mandatory notifications', async () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.STOCK,
        userId: null,
        isMandatory: true,
      };

      const result = await service.shouldReceiveNotification(user, notification);

      expect(result).toBe(true);
      expect(preferenceService.getUserPreferences).not.toHaveBeenCalled();
    });

    it('should check user preferences for optional notifications', async () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.STOCK,
        userId: null,
        isMandatory: false,
      };

      const mockPreferences = [
        {
          notificationType: NOTIFICATION_TYPE.STOCK,
          eventType: null,
          enabled: false,
          channels: [],
        },
      ];

      mockPreferenceService.getUserPreferences.mockResolvedValue(mockPreferences);

      const result = await service.shouldReceiveNotification(user, notification);

      expect(result).toBe(false);
      expect(preferenceService.getUserPreferences).toHaveBeenCalledWith('user-1');
    });

    it('should allow notification when preference check is disabled', async () => {
      const user: any = {
        id: 'user-1',
        sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE },
      };

      const notification: any = {
        id: 'notif-1',
        type: NOTIFICATION_TYPE.STOCK,
        userId: null,
        isMandatory: false,
      };

      const result = await service.shouldReceiveNotification(user, notification, false);

      expect(result).toBe(true);
      expect(preferenceService.getUserPreferences).not.toHaveBeenCalled();
    });
  });

  describe('filterBySector', () => {
    it('should filter users by sector', () => {
      const users: any[] = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.ADMIN } },
        { id: 'user-3', sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION } },
      ];

      const result = service.filterBySector(users, [
        SECTOR_PRIVILEGES.WAREHOUSE,
        SECTOR_PRIVILEGES.ADMIN,
      ]);

      expect(result).toHaveLength(2);
      expect(result.some((u) => u.id === 'user-1')).toBe(true);
      expect(result.some((u) => u.id === 'user-2')).toBe(true);
    });

    it('should return all users when sectors array is empty', () => {
      const users: any[] = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION } },
      ];

      const result = service.filterBySector(users, []);

      expect(result).toHaveLength(2);
    });
  });

  describe('filterByPrivilege', () => {
    it('should filter users by minimum privilege level', () => {
      const users: any[] = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.BASIC } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-3', sector: { privileges: SECTOR_PRIVILEGES.ADMIN } },
      ];

      const result = service.filterByPrivilege(users, 4); // Warehouse level

      expect(result).toHaveLength(2);
      expect(result.some((u) => u.id === 'user-2')).toBe(true);
      expect(result.some((u) => u.id === 'user-3')).toBe(true);
    });

    it('should exclude users without sector', () => {
      const users: any[] = [
        { id: 'user-1', sector: null },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.ADMIN } },
      ];

      const result = service.filterByPrivilege(users, 1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-2');
    });
  });

  describe('combineFilters', () => {
    it('should combine multiple filters with AND logic', () => {
      const users: any[] = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.ADMIN } },
        { id: 'user-3', sector: { privileges: SECTOR_PRIVILEGES.BASIC } },
      ];

      const result = service.combineFilters(users, {
        sectors: [SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN],
        minPrivilegeLevel: 4,
      });

      expect(result).toHaveLength(2);
    });

    it('should include specific user IDs with OR logic', () => {
      const users: any[] = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-3', sector: { privileges: SECTOR_PRIVILEGES.BASIC } },
      ];

      const result = service.combineFilters(users, {
        sectors: [SECTOR_PRIVILEGES.WAREHOUSE],
        userIds: ['user-1'],
      });

      expect(result).toHaveLength(2);
      expect(result.some((u) => u.id === 'user-1')).toBe(true);
      expect(result.some((u) => u.id === 'user-2')).toBe(true);
    });

    it('should exclude specific user IDs', () => {
      const users: any[] = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-3', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
      ];

      const result = service.combineFilters(users, {
        sectors: [SECTOR_PRIVILEGES.WAREHOUSE],
        excludeUserIds: ['user-2'],
      });

      expect(result).toHaveLength(2);
      expect(result.some((u) => u.id === 'user-2')).toBe(false);
    });

    it('should apply custom filter function', () => {
      const users: any[] = [
        { id: 'user-1', name: 'Alice', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-2', name: 'Bob', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
      ];

      const result = service.combineFilters(users, {
        sectors: [SECTOR_PRIVILEGES.WAREHOUSE],
        customFilter: (user) => user.name.startsWith('A'),
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-1');
    });
  });

  describe('getUsersForTaskNotification', () => {
    it('should return users based on task criteria', async () => {
      const mockUsers = [
        { id: 'user-1', sectorId: 'sector-1' },
        { id: 'user-2', managedSector: { id: 'sector-1' } },
        { id: 'admin-1', sector: { privileges: SECTOR_PRIVILEGES.ADMIN } },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getUsersForTaskNotification(
        'sector-1',
        'creator-1',
        ['user-1'],
        'supervisor-1',
      );

      expect(result).toHaveLength(3);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });

  describe('getUsersForOrderNotification', () => {
    it('should return warehouse and logistic users', async () => {
      const mockUsers = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.LOGISTIC } },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getUsersForOrderNotification();

      expect(result).toHaveLength(2);
    });
  });

  describe('getUsersForStockNotification', () => {
    it('should return warehouse users and admin', async () => {
      const mockUsers = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
        { id: 'admin-1', sector: { privileges: SECTOR_PRIVILEGES.ADMIN } },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getUsersForStockNotification();

      expect(result).toHaveLength(2);
    });
  });

  describe('getUsersForPPENotification', () => {
    it('should return HR and warehouse users', async () => {
      const mockUsers = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.HUMAN_RESOURCES } },
        { id: 'user-2', sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE } },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getUsersForPPENotification();

      expect(result).toHaveLength(2);
    });

    it('should include specific user if userId provided', async () => {
      const mockUsers = [
        { id: 'user-1', sector: { privileges: SECTOR_PRIVILEGES.HUMAN_RESOURCES } },
      ];

      const specificUser = {
        id: 'user-2',
        sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION },
      };

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);
      mockPrismaService.user.findUnique.mockResolvedValue(specificUser);

      const result = await service.getUsersForPPENotification('user-2');

      expect(result).toHaveLength(2);
      expect(result.some((u) => u.id === 'user-2')).toBe(true);
    });
  });

  describe('getUsersForSystemNotification', () => {
    it('should return all active users', async () => {
      const mockUsers = [
        { id: 'user-1', isActive: true },
        { id: 'user-2', isActive: true },
      ];

      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getUsersForSystemNotification();

      expect(result).toHaveLength(2);
    });
  });

  describe('isAdmin', () => {
    it('should return true for admin user', () => {
      const adminUser: any = {
        sector: { privileges: SECTOR_PRIVILEGES.ADMIN },
      };

      expect(service.isAdmin(adminUser)).toBe(true);
    });

    it('should return false for non-admin user', () => {
      const user: any = {
        sector: { privileges: SECTOR_PRIVILEGES.PRODUCTION },
      };

      expect(service.isAdmin(user)).toBe(false);
    });
  });

  describe('isSectorManager', () => {
    it('should return true for sector manager', () => {
      const managerUser: any = {
        managedSector: { id: 'sector-1' },
      };

      expect(service.isSectorManager(managerUser)).toBe(true);
    });

    it('should return false for non-manager', () => {
      const user: any = {
        managedSector: null,
      };

      expect(service.isSectorManager(user)).toBe(false);
    });
  });

  describe('getPrivilegeLevel', () => {
    it('should return correct privilege level for user', () => {
      const user: any = {
        sector: { privileges: SECTOR_PRIVILEGES.WAREHOUSE },
      };

      const level = service.getPrivilegeLevel(user);

      expect(level).toBe(4);
    });

    it('should return 0 for user without sector', () => {
      const user: any = {
        sector: null,
      };

      const level = service.getPrivilegeLevel(user);

      expect(level).toBe(0);
    });
  });
});
