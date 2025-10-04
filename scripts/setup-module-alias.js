#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Setup module alias for runtime
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Set _moduleAliases with correct paths (always override)
packageJson._moduleAliases = {
  '@modules': './dist/apps/api/src/modules',
  '@common': './dist/apps/api/src/common',
  '@config': './dist/apps/api/src/config',
};

// Write back to package.json
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log('Module aliases configured successfully');
