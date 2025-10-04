#!/bin/bash

# PM2 Status Display Script

echo "📊 Ankaa API - PM2 Status"
echo "=========================="
echo ""

pm2 status

echo ""
echo "💾 Memory usage:"
pm2 describe ankaa-api-production 2>/dev/null | grep -E "memory|cpu" || echo "  Production: Not running"
pm2 describe ankaa-api-staging 2>/dev/null | grep -E "memory|cpu" || echo "  Staging: Not running"

echo ""
echo "📋 Quick Actions:"
echo "  View logs:    ./pm2-logs.sh [production|staging]"
echo "  Restart all:  pm2 restart all"
echo "  Stop all:     ./pm2-stop-all.sh"
echo "  Monitor:      pm2 monit"
