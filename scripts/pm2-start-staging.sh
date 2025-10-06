#!/bin/bash

# PM2 Start Staging Environment Script
# Starts only the staging instance on port 3031

set -e

echo "🧪 Starting Ankaa API - Staging Environment"
echo "============================================"

# Navigate to API directory
cd "$(dirname "$0")"

# Ensure build exists
if [ ! -d "dist" ]; then
  echo "❌ Build not found. Running build..."
  npm run build
fi

# Ensure logs directory exists
mkdir -p logs

# Ensure staging uploads directory exists
mkdir -p uploads-staging

# Start PM2 process (staging only)
pm2 start ecosystem.config.js --only ankaa-api-staging

# Show status
echo ""
echo "✅ Staging API started successfully!"
echo ""
pm2 status

echo ""
echo "📊 View logs with:"
echo "  pm2 logs ankaa-api-staging"
echo ""
echo "🔄 Restart with:"
echo "  pm2 restart ankaa-api-staging"
echo ""
echo "🛑 Stop with:"
echo "  pm2 stop ankaa-api-staging"
