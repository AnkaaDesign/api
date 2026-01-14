#!/bin/bash

echo "========================================"
echo "Restarting API with Push Notifications"
echo "========================================"
echo ""

# Check if running in dev mode or production
if pm2 list | grep -q "api"; then
    echo "📦 Detected PM2 process"
    echo "Restarting with PM2..."
    pm2 restart api
    echo ""
    echo "✅ API restarted!"
    echo ""
    echo "Check logs:"
    echo "  pm2 logs api --lines 50"
    echo ""
    echo "Look for:"
    echo "  [EXPO PUSH] Initializing Expo Push Service..."
    echo "  [EXPO PUSH] ✅ Expo Push Service initialized successfully"
else
    echo "🔧 No PM2 process detected"
    echo ""
    echo "Start the API manually:"
    echo "  cd /home/kennedy/Documents/repositories/api"
    echo "  npm run dev"
    echo ""
    echo "Or with PM2:"
    echo "  pm2 start npm --name api -- run dev"
fi

echo ""
echo "========================================"
echo "Next Steps:"
echo "========================================"
echo "1. Check API logs for Expo Push initialization"
echo "2. Login to mobile app (to register token)"
echo "3. Send a test notification"
echo ""
echo "See: PUSH_NOTIFICATIONS_COMPLETE_SETUP.md"
echo "========================================"
