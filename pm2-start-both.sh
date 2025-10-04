#!/bin/bash

# PM2 Start Both Environments Script
# Starts both production (3030) and staging (3031)

set -e

echo "🚀 Starting Ankaa API - All Environments"
echo "========================================="

# Navigate to API directory
cd "$(dirname "$0")"

# Ensure build exists
if [ ! -d "dist" ]; then
  echo "❌ Build not found. Running build..."
  npm run build
fi

# Ensure directories exist
mkdir -p logs
mkdir -p uploads
mkdir -p uploads-staging

# Start both PM2 processes
pm2 start ecosystem.config.js

# Show status
echo ""
echo "✅ All environments started successfully!"
echo ""
pm2 status

echo ""
echo "📊 Environments:"
echo "  Production: http://localhost:3030/api"
echo "  Staging:    http://localhost:3031/api"
echo ""
echo "📋 View all logs:"
echo "  pm2 logs"
echo ""
echo "📋 View specific logs:"
echo "  pm2 logs ankaa-api-production"
echo "  pm2 logs ankaa-api-staging"
echo ""
echo "🔄 Restart all:"
echo "  pm2 restart all"
echo ""
echo "🛑 Stop all:"
echo "  pm2 stop all"
