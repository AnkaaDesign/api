module.exports = {
  displayName: 'notification-e2e',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    '../../src/modules/common/notification/**/*.ts',
    '!../../src/modules/common/notification/**/*.spec.ts',
    '!../../src/modules/common/notification/**/*.interface.ts',
    '!../../src/modules/common/notification/**/*.dto.ts',
  ],
  coverageDirectory: '../../coverage/notification-e2e',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/../../tsconfig.json',
      isolatedModules: true,
    },
  },
};
