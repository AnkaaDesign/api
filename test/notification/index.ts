/**
 * Notification System Test Suite
 *
 * Comprehensive integration tests for the notification system covering:
 * - Multi-channel delivery (Email, SMS, WhatsApp, Push, In-App)
 * - User preferences and role-based filtering
 * - Notification tracking and analytics
 * - Edge cases and error handling
 * - Performance and scalability
 *
 * @packageDocumentation
 */

// Export all test helpers
export * from './test-helpers';

// Export all test fixtures
export * from './test-fixtures';

// Export mock services
export { MockEmailService } from './mocks/mock-email.service';
export { MockSmsService } from './mocks/mock-sms.service';
export { MockWhatsAppService } from './mocks/mock-whatsapp.service';
export { MockPushService } from './mocks/mock-push.service';

/**
 * Test suite information
 */
export const testSuiteInfo = {
  name: 'Notification System Tests',
  version: '1.0.0',
  totalTests: 118,
  categories: [
    'Task Notifications',
    'User Preferences',
    'Role-based Filtering',
    'Multi-channel Delivery',
    'Tracking',
    'Edge Cases',
    'Notification Aggregation',
    'Scheduled Notifications',
    'Statistics',
    'Delivery Retry Logic',
    'Rate Limiting',
    'Delivery Optimization',
    'Templates',
    'Webhooks',
    'Performance',
    'Data Consistency',
  ],
  mockServices: 4,
  helperFunctions: 20,
  fixtures: 50,
};

/**
 * Quick reference for common test operations
 */
export const testOperations = {
  // Test execution
  runAll: 'npm test test/notification/',
  runCore: 'npm test test/notification/notification.e2e-spec.ts',
  runAdvanced: 'npm test test/notification/notification-advanced.e2e-spec.ts',
  runWithCoverage: 'npm test -- --coverage test/notification/',
  runWatch: 'npm test -- --watch test/notification/',

  // Documentation
  readme: 'test/notification/README.md',
  quickStart: 'test/notification/QUICK_START.md',
  summary: 'test/notification/TEST_SUMMARY.md',
};

/**
 * Coverage targets
 */
export const coverageTargets = {
  statements: 90,
  branches: 85,
  functions: 90,
  lines: 90,
};
