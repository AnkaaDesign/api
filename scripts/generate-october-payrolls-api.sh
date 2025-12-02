#!/bin/bash

# Generate October 2025 Payrolls via API
# This script calls the payroll generation endpoint

echo "======================================================================================================"
echo "🔄 GENERATING OCTOBER 2025 PAYROLLS"
echo "======================================================================================================"
echo ""

# API endpoint
API_URL="http://localhost:3030/api/payroll/generate-month"

# Payload
PAYLOAD='{"year": 2025, "month": 10}'

echo "📡 Calling API endpoint:"
echo "   POST $API_URL"
echo "   Body: $PAYLOAD"
echo ""

# Make the API call (without auth - assuming no auth in dev or you have open endpoint)
response=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -w "\n%{http_code}")

# Extract HTTP status code
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "======================================================================================================"
echo "📊 API RESPONSE"
echo "======================================================================================================"
echo "HTTP Status: $http_code"
echo ""
echo "$body" | jq '.' 2>/dev/null || echo "$body"
echo ""

if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
  echo "======================================================================================================"
  echo "✅ SUCCESS: Payrolls generated successfully!"
  echo "======================================================================================================"
  echo ""
  echo "Now check the logs in /tmp/nest-app.log for Secullum integration messages:"
  echo ""
  echo "   grep -i 'secullum' /tmp/nest-app.log | tail -50"
  echo ""
  echo "Look for:"
  echo "   - 'Fetching Secullum payroll data for employee...'"
  echo "   - 'Mapped to Secullum employee ID: X'"
  echo "   - 'Successfully extracted payroll data...'"
  echo ""
else
  echo "======================================================================================================"
  echo "❌ ERROR: Failed to generate payrolls"
  echo "======================================================================================================"
  echo ""
  echo "Check the application logs for errors:"
  echo "   tail -100 /tmp/nest-app.log"
  echo ""
fi

echo "======================================================================================================"
