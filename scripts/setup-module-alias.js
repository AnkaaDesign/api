#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Setup module alias for runtime
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Set _moduleAliases with correct paths (always override)
packageJson._moduleAliases = {
  '@': './dist',
  '@modules': './dist/modules',
  '@constants': './dist/constants',
  '@types': './dist/types',
  '@utils': './dist/utils',
  '@schemas': './dist/schemas',
  '@common': './dist/common',
  '@config': './dist/config',
  '@decorators': './dist/common/decorators',
  '@auth-decorators': './dist/modules/common/auth/decorators',
  '@guards': './dist/modules/common/auth/guards',
  '@middleware': './dist/common/middleware',
  '@templates': './dist/templates',
  '@domain': './dist/modules/domain',
  '@inventory': './dist/modules/inventory',
  '@production': './dist/modules/production',
  '@people': './dist/modules/people',
  '@paint': './dist/modules/paint',
  '@system': './dist/modules/system',
  '@integrations': './dist/modules/integrations',
  '@human-resources': './dist/modules/human-resources'
};

// Write back to package.json
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log('Module aliases configured successfully');
