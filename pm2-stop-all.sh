#!/bin/bash

# PM2 Stop All Environments Script

set -e

echo "🛑 Stopping all Ankaa API environments..."

# Stop all PM2 processes
pm2 stop all

echo ""
echo "✅ All environments stopped!"
echo ""
pm2 status

echo ""
echo "💡 To start again:"
echo "  ./pm2-start-both.sh       (start all)"
echo "  ./pm2-start-production.sh (production only)"
echo "  ./pm2-start-staging.sh    (staging only)"
