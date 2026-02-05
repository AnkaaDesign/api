/**
 * Deep Link Service - Test Examples
 *
 * This file contains practical test cases and examples demonstrating
 * all methods of the DeepLinkService.
 */

import { DeepLinkService, DeepLinkEntity } from './deep-link.service';
import { ConfigService } from '@nestjs/config';

// Example test setup
function createTestService(): DeepLinkService {
  const mockConfigService = {
    get: (key: string) => {
      const config = {
        WEB_APP_URL: 'https://app.domain.com',
        MOBILE_APP_SCHEME: 'myapp',
        UNIVERSAL_LINK_DOMAIN: 'https://app.domain.com',
      };
      return config[key];
    },
  } as ConfigService;

  return new DeepLinkService(mockConfigService);
}

// Test Examples
export class DeepLinkTestExamples {
  private deepLinkService: DeepLinkService;

  constructor() {
    this.deepLinkService = createTestService();
  }

  /**
   * Example 1: generateDeepLink()
   * Generate complete deep link with all URL types
   */
  testGenerateDeepLink() {
    console.log('\n=== Test 1: generateDeepLink() ===');

    const result = this.deepLinkService.generateDeepLink(DeepLinkEntity.Task, 'task-123', {
      action: 'view',
      source: 'notification',
    });

    console.log('Web URL:', result.web);
    // Expected: https://app.domain.com/tarefas/task-123?action=view&source=notification

    console.log('Mobile URL:', result.mobile);
    // Expected: myapp://tarefas/task-123?action=view&source=notification

    console.log('Universal Link:', result.universalLink);
    // Expected: https://app.domain.com/app/tarefas/task-123?action=view&source=notification

    return result;
  }

  /**
   * Example 2: parseDeepLink()
   * Parse stored deep link from notification
   */
  testParseDeepLink() {
    console.log('\n=== Test 2: parseDeepLink() ===');

    // Test JSON format
    const jsonActionUrl = JSON.stringify({
      web: 'https://app.domain.com/tarefas/task-123',
      mobile: 'myapp://tarefas/task-123',
      universalLink: 'https://app.domain.com/app/tarefas/task-123',
    });

    const parsed = this.deepLinkService.parseDeepLink(jsonActionUrl);
    console.log('Parsed from JSON:', parsed);

    // Test plain URL (backward compatibility)
    const plainUrl = 'https://app.domain.com/tarefas/task-123';
    const parsedPlain = this.deepLinkService.parseDeepLink(plainUrl);
    console.log('Parsed from plain URL:', parsedPlain);

    // Test invalid input
    const invalid = this.deepLinkService.parseDeepLink(null);
    console.log('Parsed null:', invalid);
    // Expected: null

    return parsed;
  }

  /**
   * Example 3: buildWebLink()
   * Build web application link only
   */
  testBuildWebLink() {
    console.log('\n=== Test 3: buildWebLink() ===');

    const webUrl = this.deepLinkService.buildWebLink(DeepLinkEntity.Order, 'order-456', {
      highlight: 'status',
    });

    console.log('Web URL:', webUrl);
    // Expected: https://app.domain.com/pedidos/order-456?highlight=status

    return webUrl;
  }

  /**
   * Example 4: buildMobileLink()
   * Build mobile app link with custom scheme
   */
  testBuildMobileLink() {
    console.log('\n=== Test 4: buildMobileLink() ===');

    const mobileUrl = this.deepLinkService.buildMobileLink(DeepLinkEntity.Item, 'item-789', {
      action: 'reorder',
    });

    console.log('Mobile URL:', mobileUrl);
    // Expected: myapp://estoque/produtos/item-789?action=reorder

    return mobileUrl;
  }

  /**
   * Example 5: getEntityUrl()
   * Get entity paths from entity type or notification type string
   */
  testGetEntityUrl() {
    console.log('\n=== Test 5: getEntityUrl() ===');

    // Using entity enum
    const paths1 = this.deepLinkService.getEntityUrl(DeepLinkEntity.Task, 'task-123');
    console.log('Paths from enum:', paths1);
    // Expected: { webPath: '/tarefas/task-123', mobilePath: 'tarefas/task-123' }

    // Using notification type string
    const paths2 = this.deepLinkService.getEntityUrl('TASK_CREATED', 'task-123');
    console.log('Paths from TASK_CREATED:', paths2);

    const paths3 = this.deepLinkService.getEntityUrl('ORDER_UPDATE', 'order-456');
    console.log('Paths from ORDER_UPDATE:', paths3);

    const paths4 = this.deepLinkService.getEntityUrl('STOCK_LOW', 'item-789');
    console.log('Paths from STOCK_LOW:', paths4);

    const paths5 = this.deepLinkService.getEntityUrl('FINANCIAL_TRANSACTION', 'txn-123');
    console.log('Paths from FINANCIAL_TRANSACTION:', paths5);

    return { paths1, paths2, paths3, paths4, paths5 };
  }

  /**
   * Example 6: validateDeepLink()
   * Validate deep link URL format
   */
  testValidateDeepLink() {
    console.log('\n=== Test 6: validateDeepLink() ===');

    const validWeb = this.deepLinkService.validateDeepLink(
      'https://app.domain.com/tarefas/task-123',
    );
    console.log('Valid web URL:', validWeb);
    // Expected: true

    const validMobile = this.deepLinkService.validateDeepLink('myapp://tarefas/task-123');
    console.log('Valid mobile URL:', validMobile);
    // Expected: true

    const invalid1 = this.deepLinkService.validateDeepLink('invalid-url');
    console.log('Invalid URL:', invalid1);
    // Expected: false

    const invalid2 = this.deepLinkService.validateDeepLink('');
    console.log('Empty URL:', invalid2);
    // Expected: false

    return { validWeb, validMobile, invalid1, invalid2 };
  }

  /**
   * Example 7: All Entity Types
   * Test all entity type deep link generation
   */
  testAllEntityTypes() {
    console.log('\n=== Test 7: All Entity Types ===');

    // Task
    const taskLinks = this.deepLinkService.generateTaskLinks('task-123');
    console.log('Task Links:', taskLinks);

    // Order
    const orderLinks = this.deepLinkService.generateOrderLinks('order-456');
    console.log('Order Links:', orderLinks);

    // Item/Stock
    const itemLinks = this.deepLinkService.generateItemLinks('item-789');
    console.log('Item Links:', itemLinks);

    // Service Order
    const serviceOrderLinks = this.deepLinkService.generateServiceOrderLinks('so-123');
    console.log('Service Order Links:', serviceOrderLinks);

    // Financial
    const financialLinks = this.deepLinkService.generateFinancialLinks('txn-456');
    console.log('Financial Links:', financialLinks);

    // User
    const userLinks = this.deepLinkService.generateUserLinks('user-789');
    console.log('User Links:', userLinks);

    return {
      taskLinks,
      orderLinks,
      itemLinks,
      serviceOrderLinks,
      financialLinks,
      userLinks,
    };
  }

  /**
   * Example 8: Notification Integration
   * Complete example with notification creation
   */
  testNotificationIntegration() {
    console.log('\n=== Test 8: Notification Integration ===');

    // Generate deep links for task assignment
    const links = this.deepLinkService.generateDeepLink(DeepLinkEntity.Task, 'task-123', {
      action: 'view',
      source: 'assignment',
      priority: 'high',
    });

    // Notification payload structure
    const notificationPayload = {
      userId: 'user-456',
      title: 'New Task Assigned',
      body: 'You have been assigned a high-priority task',
      type: 'TASK_ASSIGNMENT',
      importance: 'HIGH',
      channel: ['IN_APP', 'PUSH', 'EMAIL'],
      actionUrl: JSON.stringify(links), // Store as JSON string
      metadata: {
        entityType: 'Task',
        entityId: 'task-123',
        webUrl: links.web,
        mobileUrl: links.mobile,
      },
    };

    console.log('Notification Payload:', JSON.stringify(notificationPayload, null, 2));

    // Later: Parse the actionUrl
    const parsedLinks = this.deepLinkService.parseDeepLink(notificationPayload.actionUrl);
    console.log('Parsed Action URL:', parsedLinks);

    return { notificationPayload, parsedLinks };
  }

  /**
   * Example 9: Complex Query Parameters
   * Test with multiple query parameters
   */
  testComplexQueryParams() {
    console.log('\n=== Test 9: Complex Query Parameters ===');

    const links = this.deepLinkService.generateDeepLink(DeepLinkEntity.Task, 'task-123', {
      action: 'edit',
      section: 'details',
      field: 'description',
      highlight: 'true',
      returnTo: '/dashboard',
      source: 'notification',
      timestamp: new Date().toISOString(),
    });

    console.log('Complex Web URL:', links.web);
    console.log('Complex Mobile URL:', links.mobile);

    return links;
  }

  /**
   * Example 10: Channel-Specific Deep Links
   * Generate links for different notification channels
   */
  testChannelSpecificLinks() {
    console.log('\n=== Test 10: Channel-Specific Links ===');

    const taskId = 'task-123';

    // Email link
    const emailLink = this.deepLinkService.buildWebLink(DeepLinkEntity.Task, taskId, {
      source: 'email',
      action: 'view',
    });
    console.log('Email Link:', emailLink);

    // Push notification link
    const pushLinks = this.deepLinkService.generateTaskLinks(taskId, {
      source: 'push',
      action: 'view',
    });
    console.log('Push Notification Links:', pushLinks);

    // WhatsApp link (web)
    const whatsappLink = this.deepLinkService.buildWebLink(DeepLinkEntity.Task, taskId, {
      source: 'whatsapp',
    });
    console.log('WhatsApp Link:', whatsappLink);

    // In-app notification
    const inAppLinks = this.deepLinkService.generateTaskLinks(taskId, {
      source: 'in_app',
      action: 'view',
    });
    console.log('In-App Links:', inAppLinks);

    return { emailLink, pushLinks, whatsappLink, inAppLinks };
  }

  /**
   * Run all tests
   */
  runAllTests() {
    console.log('\n========================================');
    console.log('Deep Link Service - All Tests');
    console.log('========================================');

    try {
      this.testGenerateDeepLink();
      this.testParseDeepLink();
      this.testBuildWebLink();
      this.testBuildMobileLink();
      this.testGetEntityUrl();
      this.testValidateDeepLink();
      this.testAllEntityTypes();
      this.testNotificationIntegration();
      this.testComplexQueryParams();
      this.testChannelSpecificLinks();

      console.log('\n========================================');
      console.log('All tests completed successfully!');
      console.log('========================================\n');
    } catch (error) {
      console.error('\n========================================');
      console.error('Test failed:', error.message);
      console.error('========================================\n');
      throw error;
    }
  }
}

// Example usage
if (require.main === module) {
  const tests = new DeepLinkTestExamples();
  tests.runAllTests();
}

// Export for use in other test files
export { createTestService };
