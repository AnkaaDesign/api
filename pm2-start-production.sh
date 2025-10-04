#!/bin/bash

# PM2 Start Production Environment Script
# Starts only the production instance on port 3030

set -e

echo "🚀 Starting Ankaa API - Production Environment"
echo "================================================"

# Navigate to API directory
cd "$(dirname "$0")"

# Ensure build exists
if [ ! -d "dist" ]; then
  echo "❌ Build not found. Running build..."
  npm run build
fi

# Ensure logs directory exists
mkdir -p logs

# Ensure uploads directory exists
mkdir -p uploads

# Start PM2 process (production only)
pm2 start ecosystem.config.js --only ankaa-api-production

# Show status
echo ""
echo "✅ Production API started successfully!"
echo ""
pm2 status

echo ""
echo "📊 View logs with:"
echo "  pm2 logs ankaa-api-production"
echo ""
echo "🔄 Restart with:"
echo "  pm2 restart ankaa-api-production"
echo ""
echo "🛑 Stop with:"
echo "  pm2 stop ankaa-api-production"
