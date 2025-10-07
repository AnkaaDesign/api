#!/bin/bash

# Load production environment variables
export $(cat .env.production | grep -v '^#' | xargs)

# Start PM2 with production config
pm2 start dist/main.js \
  --name "ankaa-api-production" \
  --max-memory-restart 1G \
  --error ./logs/production-error.log \
  --output ./logs/production-out.log \
  --log ./logs/production-combined.log \
  --time
