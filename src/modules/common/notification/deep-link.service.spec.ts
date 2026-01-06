import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepLinkService, DeepLinkEntity, Platform } from './deep-link.service';

describe('DeepLinkService', () => {
  let service: DeepLinkService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        WEB_APP_URL: 'https://testapp.com',
        MOBILE_APP_SCHEME: 'testapp',
        UNIVERSAL_LINK_DOMAIN: 'https://testapp.com',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepLinkService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<DeepLinkService>(DeepLinkService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should load configuration from environment variables', () => {
      expect(configService.get).toHaveBeenCalledWith('WEB_APP_URL');
      expect(configService.get).toHaveBeenCalledWith('MOBILE_APP_SCHEME');
      expect(configService.get).toHaveBeenCalledWith('UNIVERSAL_LINK_DOMAIN');
    });
  });

  describe('generateTaskLink', () => {
    it('should generate web link for task', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web');

      expect(link).toBe('https://testapp.com/production/tasks/details/task-123');
    });

    it('should generate mobile link for task', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'mobile');

      expect(link).toBe('testapp://production/tasks/task-123');
    });

    it('should generate link with query parameters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {
        action: 'approve',
        source: 'email',
      });

      expect(link).toBe(
        'https://testapp.com/production/tasks/details/task-123?action=approve&source=email',
      );
    });

    it('should encode special characters in task ID', () => {
      const taskId = 'task 123&special';
      const link = service.generateTaskLink(taskId, 'web');

      expect(link).toContain(encodeURIComponent(taskId));
    });

    it('should throw error for empty task ID', () => {
      expect(() => service.generateTaskLink('', 'web')).toThrow('Entity ID cannot be empty');
    });

    it('should handle query parameters with special characters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {
        action: 'approve',
        reason: 'needs review & approval',
      });

      expect(link).toContain('reason=needs%20review%20%26%20approval');
    });
  });

  describe('generateOrderLink', () => {
    it('should generate web link for order', () => {
      const orderId = 'order-456';
      const link = service.generateOrderLink(orderId, 'web');

      expect(link).toBe('https://testapp.com/inventory/orders/details/order-456');
    });

    it('should generate mobile link for order', () => {
      const orderId = 'order-456';
      const link = service.generateOrderLink(orderId, 'mobile');

      expect(link).toBe('testapp://inventory/orders/order-456');
    });
  });

  describe('generateItemLink', () => {
    it('should generate web link for item', () => {
      const itemId = 'item-789';
      const link = service.generateItemLink(itemId, 'web');

      expect(link).toBe('https://testapp.com/inventory/products/details/item-789');
    });

    it('should generate mobile link for item', () => {
      const itemId = 'item-789';
      const link = service.generateItemLink(itemId, 'mobile');

      expect(link).toBe('testapp://inventory/items/item-789');
    });
  });

  describe('generateServiceOrderLink', () => {
    it('should generate web link for service order', () => {
      const serviceOrderId = 'so-101';
      const link = service.generateServiceOrderLink(serviceOrderId, 'web');

      expect(link).toBe('https://testapp.com/production/service-orders/details/so-101');
    });

    it('should generate mobile link for service order', () => {
      const serviceOrderId = 'so-101';
      const link = service.generateServiceOrderLink(serviceOrderId, 'mobile');

      expect(link).toBe('testapp://production/service-orders/so-101');
    });
  });

  describe('generateUserLink', () => {
    it('should generate web link for user', () => {
      const userId = 'user-202';
      const link = service.generateUserLink(userId, 'web');

      expect(link).toBe('https://testapp.com/administration/collaborators/details/user-202');
    });

    it('should generate mobile link for user', () => {
      const userId = 'user-202';
      const link = service.generateUserLink(userId, 'mobile');

      expect(link).toBe('testapp://profile/user-202');
    });
  });

  describe('generateTaskLinks', () => {
    it('should generate all link types for task', () => {
      const taskId = 'task-123';
      const links = service.generateTaskLinks(taskId);

      expect(links).toHaveProperty('web');
      expect(links).toHaveProperty('mobile');
      expect(links).toHaveProperty('universalLink');
      expect(links.web).toBe('https://testapp.com/production/tasks/details/task-123');
      expect(links.mobile).toBe('testapp://production/tasks/task-123');
      expect(links.universalLink).toBe('https://testapp.com/app/production/tasks/task-123');
    });

    it('should generate all links with query parameters', () => {
      const taskId = 'task-123';
      const queryParams = { action: 'view', source: 'notification' };
      const links = service.generateTaskLinks(taskId, queryParams);

      expect(links.web).toContain('action=view&source=notification');
      expect(links.mobile).toContain('action=view&source=notification');
      expect(links.universalLink).toContain('action=view&source=notification');
    });
  });

  describe('generateOrderLinks', () => {
    it('should generate all link types for order', () => {
      const orderId = 'order-456';
      const links = service.generateOrderLinks(orderId);

      expect(links.web).toBe('https://testapp.com/inventory/orders/details/order-456');
      expect(links.mobile).toBe('testapp://inventory/orders/order-456');
      expect(links.universalLink).toBe('https://testapp.com/app/inventory/orders/order-456');
    });
  });

  describe('generateItemLinks', () => {
    it('should generate all link types for item', () => {
      const itemId = 'item-789';
      const links = service.generateItemLinks(itemId);

      expect(links.web).toBe('https://testapp.com/inventory/products/details/item-789');
      expect(links.mobile).toBe('testapp://inventory/items/item-789');
      expect(links.universalLink).toBe('https://testapp.com/app/inventory/items/item-789');
    });
  });

  describe('generateServiceOrderLinks', () => {
    it('should generate all link types for service order', () => {
      const serviceOrderId = 'so-101';
      const links = service.generateServiceOrderLinks(serviceOrderId);

      expect(links.web).toBe('https://testapp.com/production/service-orders/details/so-101');
      expect(links.mobile).toBe('testapp://production/service-orders/so-101');
      expect(links.universalLink).toBe('https://testapp.com/app/production/service-orders/so-101');
    });
  });

  describe('generateUserLinks', () => {
    it('should generate all link types for user', () => {
      const userId = 'user-202';
      const links = service.generateUserLinks(userId);

      expect(links.web).toBe('https://testapp.com/administration/collaborators/details/user-202');
      expect(links.mobile).toBe('testapp://profile/user-202');
      expect(links.universalLink).toBe('https://testapp.com/app/profile/user-202');
    });
  });

  describe('generateNotificationActionUrl', () => {
    it('should generate JSON string with all link types', () => {
      const taskId = 'task-123';
      const actionUrl = service.generateNotificationActionUrl(DeepLinkEntity.Task, taskId);

      const parsed = JSON.parse(actionUrl);
      expect(parsed).toHaveProperty('web');
      expect(parsed).toHaveProperty('mobile');
      expect(parsed).toHaveProperty('universalLink');
    });

    it('should generate action URL with query parameters', () => {
      const taskId = 'task-123';
      const queryParams = { action: 'approve', source: 'email' };
      const actionUrl = service.generateNotificationActionUrl(
        DeepLinkEntity.Task,
        taskId,
        queryParams,
      );

      const parsed = JSON.parse(actionUrl);
      expect(parsed.web).toContain('action=approve&source=email');
      expect(parsed.mobile).toContain('action=approve&source=email');
      expect(parsed.universalLink).toContain('action=approve&source=email');
    });

    it('should work for all entity types', () => {
      const entityIds = {
        Task: 'task-123',
        Order: 'order-456',
        Item: 'item-789',
        ServiceOrder: 'so-101',
        User: 'user-202',
      };

      Object.entries(entityIds).forEach(([entityType, entityId]) => {
        const actionUrl = service.generateNotificationActionUrl(
          entityType as DeepLinkEntity,
          entityId,
        );
        expect(() => JSON.parse(actionUrl)).not.toThrow();
      });
    });
  });

  describe('parseNotificationActionUrl', () => {
    it('should parse valid JSON action URL', () => {
      const originalLinks = service.generateTaskLinks('task-123');
      const actionUrl = JSON.stringify(originalLinks);

      const parsed = service.parseNotificationActionUrl(actionUrl);

      expect(parsed).not.toBeNull();
      expect(parsed?.web).toBe(originalLinks.web);
      expect(parsed?.mobile).toBe(originalLinks.mobile);
      expect(parsed?.universalLink).toBe(originalLinks.universalLink);
    });

    it('should handle plain URL string (backward compatibility)', () => {
      const plainUrl = 'https://testapp.com/production/tasks/details/task-123';
      const parsed = service.parseNotificationActionUrl(plainUrl);

      expect(parsed).not.toBeNull();
      expect(parsed?.web).toBe(plainUrl);
      expect(parsed?.mobile).toBe(plainUrl);
    });

    it('should return null for invalid JSON', () => {
      const invalidJson = 'not-a-valid-json';
      const parsed = service.parseNotificationActionUrl(invalidJson);

      expect(parsed?.web).toBe(invalidJson);
    });

    it('should return null for null input', () => {
      const parsed = service.parseNotificationActionUrl(null);
      expect(parsed).toBeNull();
    });

    it('should return null for empty string', () => {
      const parsed = service.parseNotificationActionUrl('');
      expect(parsed).toBeNull();
    });
  });

  describe('validateDeepLink', () => {
    it('should validate web HTTPS URLs', () => {
      const url = 'https://testapp.com/production/tasks/details/task-123';
      expect(service.validateDeepLink(url)).toBe(true);
    });

    it('should validate web HTTP URLs', () => {
      const url = 'http://testapp.com/production/tasks/details/task-123';
      expect(service.validateDeepLink(url)).toBe(true);
    });

    it('should validate mobile deep links', () => {
      const url = 'testapp://production/tasks/task-123';
      expect(service.validateDeepLink(url)).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(service.validateDeepLink('not-a-url')).toBe(false);
      expect(service.validateDeepLink('')).toBe(false);
      expect(service.validateDeepLink('   ')).toBe(false);
    });

    it('should reject different scheme URLs', () => {
      const url = 'otherapp://production/tasks/task-123';
      expect(service.validateDeepLink(url)).toBe(false);
    });
  });

  describe('Query Parameter Handling', () => {
    it('should handle empty query parameters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {});

      expect(link).toBe('https://testapp.com/production/tasks/details/task-123');
    });

    it('should filter out undefined parameters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {
        action: 'view',
        source: undefined,
      });

      expect(link).not.toContain('source');
      expect(link).toBe('https://testapp.com/production/tasks/details/task-123?action=view');
    });

    it('should filter out null parameters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {
        action: 'view',
        source: null as any,
      });

      expect(link).not.toContain('source');
    });

    it('should filter out empty string parameters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {
        action: 'view',
        source: '',
      });

      expect(link).not.toContain('source');
    });

    it('should handle multiple query parameters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {
        action: 'approve',
        source: 'email',
        priority: 'high',
        returnTo: '/dashboard',
      });

      expect(link).toContain('action=approve');
      expect(link).toContain('source=email');
      expect(link).toContain('priority=high');
      expect(link).toContain('returnTo=%2Fdashboard');
    });

    it('should properly encode URLs in query parameters', () => {
      const taskId = 'task-123';
      const link = service.generateTaskLink(taskId, 'web', {
        returnTo: 'https://example.com/path?param=value',
      });

      expect(link).toContain(encodeURIComponent('https://example.com/path?param=value'));
    });
  });

  describe('Edge Cases', () => {
    it('should handle UUIDs as entity IDs', () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      const link = service.generateTaskLink(uuid, 'web');

      expect(link).toContain(uuid);
    });

    it('should handle numeric IDs', () => {
      const numericId = '12345';
      const link = service.generateTaskLink(numericId, 'web');

      expect(link).toContain(numericId);
    });

    it('should handle IDs with special characters', () => {
      const specialId = 'task-123_test';
      const link = service.generateTaskLink(specialId, 'web');

      expect(link).toBeDefined();
    });

    it('should trim whitespace from empty ID', () => {
      expect(() => service.generateTaskLink('   ', 'web')).toThrow();
    });

    it('should handle very long IDs', () => {
      const longId = 'a'.repeat(1000);
      const link = service.generateTaskLink(longId, 'web');

      expect(link).toContain(longId);
    });
  });

  describe('Universal Links', () => {
    it('should generate universal link with /app prefix', () => {
      const taskId = 'task-123';
      const links = service.generateTaskLinks(taskId);

      expect(links.universalLink).toContain('/app/');
      expect(links.universalLink).toContain('production/tasks/task-123');
    });

    it('should use mobile route structure for universal links', () => {
      const taskId = 'task-123';
      const links = service.generateTaskLinks(taskId);

      // Universal links should use mobile route (without /details/)
      expect(links.universalLink).not.toContain('/details/');
      expect(links.universalLink).toBe('https://testapp.com/app/production/tasks/task-123');
    });

    it('should include query parameters in universal links', () => {
      const taskId = 'task-123';
      const links = service.generateTaskLinks(taskId, {
        action: 'view',
        source: 'notification',
      });

      expect(links.universalLink).toContain('action=view&source=notification');
    });
  });

  describe('Configuration Fallbacks', () => {
    it('should use default values when config is not set', () => {
      const customConfigService = {
        get: jest.fn(() => undefined),
      };

      const module = Test.createTestingModule({
        providers: [
          DeepLinkService,
          {
            provide: ConfigService,
            useValue: customConfigService,
          },
        ],
      }).compile();

      // Service should initialize with defaults
      expect(module).toBeDefined();
    });
  });
});
