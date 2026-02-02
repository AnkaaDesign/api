/**
 * Test Configuration
 *
 * Central configuration for all optimization tests.
 * Adjust these values based on your environment and requirements.
 */

export const TEST_CONFIG = {
  /**
   * Performance thresholds for different contexts
   */
  performance: {
    list: {
      maxResponseTimeMs: 500,
      maxPayloadSizeKB: 100,
      maxFieldsPerRecord: 15,
      minImprovementPercent: 20,
    },
    form: {
      maxResponseTimeMs: 300,
      maxPayloadSizeKB: 50,
      maxFieldsPerRecord: 20,
      minImprovementPercent: 20,
    },
    detail: {
      maxResponseTimeMs: 800,
      maxPayloadSizeKB: 200,
      maxFieldsPerRecord: 50,
      minImprovementPercent: 15,
    },
    export: {
      maxResponseTimeMs: 5000,
      maxPayloadSizeKB: 5000,
      maxFieldsPerRecord: 100,
      minImprovementPercent: 10,
    },
  },

  /**
   * Payload size targets
   */
  payload: {
    minPayloadReductionPercent: 30,
    minCompressionRatio: 0.4, // 40% of original size when compressed
  },

  /**
   * Query optimization targets
   */
  query: {
    maxNestingDepth: 3,
    maxQueryCount: 10, // Max N+1 queries
    minQueryTimeImprovementPercent: 25,
  },

  /**
   * Test data configuration
   */
  testData: {
    listPageSize: 50,
    searchPageSize: 20,
    dashboardRecentCount: 5,
  },

  /**
   * Required fields that must always be present
   */
  requiredFields: {
    task: [
      'id',
      'name',
      'status',
      'statusOrder',
      'serialNumber',
      'createdAt',
      'updatedAt',
      'sectorId',
    ],
    user: ['id', 'name', 'email'],
    customer: ['id', 'fantasyName'],
    sector: ['id', 'name'],
  },

  /**
   * Sensitive fields that should never be exposed
   */
  sensitiveFields: [
    'password',
    'passwordHash',
    'salt',
    'resetToken',
    'accessToken',
    'refreshToken',
    'privateKey',
    'apiKey',
  ],

  /**
   * Heavy fields that should be excluded from list views
   */
  heavyFields: {
    task: [
      'details', // Large text
      'generalPainting.formula', // Very large JSON
    ],
    paint: [
      'formula', // Very large JSON
    ],
  },

  /**
   * Report configuration
   */
  reports: {
    saveJSON: true,
    saveHTML: true,
    saveSummary: true,
    generateCharts: false, // Future enhancement
  },

  /**
   * Database configuration for tests
   */
  database: {
    connectionTimeout: 5000,
    queryTimeout: 10000,
  },

  /**
   * Bandwidth estimation (for calculating savings)
   */
  bandwidth: {
    estimatedRequestsPerDay: 1000,
    estimatedRequestsPerMonth: 30000,
    estimatedRequestsPerYear: 365000,
  },
};

/**
 * Environment-specific overrides
 */
export function getTestConfig(env: 'development' | 'staging' | 'production' = 'development') {
  const config = { ...TEST_CONFIG };

  switch (env) {
    case 'staging':
      // Slightly relaxed thresholds for staging
      config.performance.list.maxResponseTimeMs = 600;
      config.performance.form.maxResponseTimeMs = 400;
      config.performance.detail.maxResponseTimeMs = 1000;
      break;

    case 'production':
      // Stricter thresholds for production
      config.performance.list.maxResponseTimeMs = 400;
      config.performance.form.maxResponseTimeMs = 250;
      config.performance.detail.maxResponseTimeMs = 600;
      config.payload.minPayloadReductionPercent = 40;
      break;

    case 'development':
    default:
      // Standard thresholds for development
      break;
  }

  return config;
}

/**
 * Get configuration based on environment variable
 */
export function getConfigForCurrentEnv() {
  const env = (process.env.NODE_ENV as any) || 'development';
  return getTestConfig(env);
}

export default TEST_CONFIG;
