#!/bin/bash

# Load staging environment variables
export $(cat .env.staging | grep -v '^#' | xargs)

# Start PM2 with staging config
pm2 start dist/main.js \
  --name "ankaa-api-staging" \
  --max-memory-restart 512M \
  --watch \
  --watch-delay 1000 \
  --ignore-watch="node_modules logs uploads .git *.log *.md dist .env*" \
  --error ./logs/staging-error.log \
  --output ./logs/staging-out.log \
  --log ./logs/staging-combined.log \
  --time
