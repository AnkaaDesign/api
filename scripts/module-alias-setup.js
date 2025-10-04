#!/usr/bin/env node

const path = require('path');

// Register module aliases for runtime
require('module-alias').addAliases({
  '@modules': path.join(__dirname, '..', 'dist', 'apps', 'api', 'src', 'modules'),
  '@common': path.join(__dirname, '..', 'dist', 'apps', 'api', 'src', 'common'),
  '@config': path.join(__dirname, '..', 'dist', 'apps', 'api', 'src', 'config'),
});
