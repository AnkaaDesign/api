#!/bin/bash
cd /var/www/test.api.ankaa.live
# Load test environment (use set -a to auto-export)
set -a
source .env.test
set +a
# Start with node (compiled JavaScript) and module-alias for TypeScript path resolution
exec node -r ./scripts/module-alias-setup.js dist/apps/api/src/main.js
