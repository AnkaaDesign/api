#!/bin/bash

# PM2 Logs Viewer Script

# Show usage if argument provided
if [ "$1" == "production" ] || [ "$1" == "prod" ]; then
  echo "📊 Viewing Production logs (Ctrl+C to exit)..."
  pm2 logs ankaa-api-production
elif [ "$1" == "staging" ] || [ "$1" == "stage" ]; then
  echo "📊 Viewing Staging logs (Ctrl+C to exit)..."
  pm2 logs ankaa-api-staging
else
  echo "📊 Viewing all logs (Ctrl+C to exit)..."
  echo ""
  pm2 logs
fi
