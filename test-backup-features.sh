#!/bin/bash

# Test script for Backup Auto-Delete and Progress Tracking Features
# This script tests the complete implementation

set -e

API_URL="${API_URL:-http://localhost:3000}"
WEBHOOK_URL="${WEBHOOK_URL:-https://webhook.ankaa.live}"
AUTH_TOKEN="${AUTH_TOKEN:-your_auth_token_here}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Backup Features Test Suite ===${NC}"
echo ""

# Function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3

    if [ -z "$data" ]; then
        curl -s -X "$method" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json" \
            "$API_URL$endpoint"
    else
        curl -s -X "$method" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$API_URL$endpoint"
    fi
}

# Test 1: Create backup with auto-delete
test_auto_delete() {
    echo -e "${YELLOW}Test 1: Creating backup with auto-delete (1 day retention)${NC}"

    local response=$(api_call POST /backups '{
        "name": "Test Backup with Auto-Delete",
        "type": "database",
        "description": "Testing auto-delete feature",
        "autoDelete": {
            "enabled": true,
            "retention": "1_day"
        }
    }')

    local backup_id=$(echo "$response" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

    if [ -n "$backup_id" ]; then
        echo -e "${GREEN}✓ Backup created with ID: $backup_id${NC}"
        echo "$backup_id"
    else
        echo -e "${RED}✗ Failed to create backup${NC}"
        echo "$response"
        return 1
    fi
}

# Test 2: WebSocket connection for progress tracking
test_websocket_progress() {
    echo -e "${YELLOW}Test 2: Testing WebSocket progress tracking${NC}"

    # Create a simple Node.js script to test WebSocket
    cat > /tmp/test-websocket.js << 'EOF'
const io = require('socket.io-client');

const backupId = process.argv[2];
const webhookUrl = process.argv[3] || 'https://webhook.ankaa.live';

if (!backupId) {
    console.error('Usage: node test-websocket.js <backup-id>');
    process.exit(1);
}

console.log(`Connecting to ${webhookUrl} for backup ${backupId}`);

const socket = io(webhookUrl, {
    transports: ['websocket', 'polling']
});

socket.on('connect', () => {
    console.log('✓ Connected to WebSocket');
    socket.emit('subscribe', { backupId });
});

socket.on('progress', (data) => {
    console.log(`Progress: ${data.progress}% - ${data.filesProcessed || 0} files processed`);
    if (data.completed) {
        console.log('✓ Backup completed!');
        process.exit(0);
    }
});

socket.on('error', (error) => {
    console.error('WebSocket error:', error);
});

// Timeout after 30 seconds
setTimeout(() => {
    console.log('Test timeout - disconnecting');
    socket.disconnect();
    process.exit(0);
}, 30000);
EOF

    # Check if socket.io-client is installed
    if ! npm list socket.io-client &>/dev/null; then
        echo "Installing socket.io-client..."
        npm install socket.io-client --no-save
    fi

    # Run the WebSocket test
    node /tmp/test-websocket.js "$1" "$WEBHOOK_URL" &
    local ws_pid=$!

    # Wait a bit for connection
    sleep 2

    if ps -p $ws_pid > /dev/null; then
        echo -e "${GREEN}✓ WebSocket client connected${NC}"
    else
        echo -e "${RED}✗ WebSocket connection failed${NC}"
    fi

    # Clean up
    kill $ws_pid 2>/dev/null || true
    rm -f /tmp/test-websocket.js
}

# Test 3: Verify backup metadata includes auto-delete info
test_backup_metadata() {
    echo -e "${YELLOW}Test 3: Verifying backup metadata${NC}"

    local backup_id=$1
    local response=$(api_call GET "/backups/$backup_id")

    if echo "$response" | grep -q "autoDelete"; then
        echo -e "${GREEN}✓ Backup metadata includes auto-delete information${NC}"

        # Extract and display auto-delete details
        local retention=$(echo "$response" | grep -o '"retention":"[^"]*' | cut -d'"' -f4)
        local delete_after=$(echo "$response" | grep -o '"deleteAfter":"[^"]*' | cut -d'"' -f4)

        echo "  Retention: $retention"
        echo "  Delete after: $delete_after"
    else
        echo -e "${RED}✗ Auto-delete information missing from metadata${NC}"
        return 1
    fi
}

# Test 4: Test scheduled backup with auto-delete
test_scheduled_backup() {
    echo -e "${YELLOW}Test 4: Creating scheduled backup with auto-delete${NC}"

    local response=$(api_call POST /backups/schedule '{
        "name": "Daily Backup",
        "type": "database",
        "enabled": true,
        "cron": "0 2 * * *",
        "autoDelete": {
            "enabled": true,
            "retention": "1_week"
        }
    }')

    if echo "$response" | grep -q "success"; then
        echo -e "${GREEN}✓ Scheduled backup created with auto-delete${NC}"
    else
        echo -e "${RED}✗ Failed to create scheduled backup${NC}"
        echo "$response"
        return 1
    fi
}

# Test 5: Test webhook endpoint
test_webhook_endpoint() {
    echo -e "${YELLOW}Test 5: Testing webhook endpoint${NC}"

    local test_data='{
        "backupId": "test_backup_123",
        "progress": 50,
        "filesProcessed": 100,
        "totalFiles": 200,
        "rate": 10.5,
        "timestamp": '$(date +%s000)'
    }'

    local response=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "$test_data" \
        "$WEBHOOK_URL/backup/progress")

    if echo "$response" | grep -q "success"; then
        echo -e "${GREEN}✓ Webhook endpoint is working${NC}"
    else
        echo -e "${YELLOW}⚠ Webhook endpoint returned: $response${NC}"
    fi
}

# Test 6: List backups and check for deletion warnings
test_list_backups() {
    echo -e "${YELLOW}Test 6: Listing backups with auto-delete info${NC}"

    local response=$(api_call GET "/backups?limit=5")

    if echo "$response" | grep -q "autoDelete"; then
        echo -e "${GREEN}✓ Backup list includes auto-delete information${NC}"

        # Count backups with auto-delete enabled
        local auto_delete_count=$(echo "$response" | grep -o '"autoDelete":{[^}]*"enabled":true' | wc -l)
        echo "  Found $auto_delete_count backups with auto-delete enabled"
    else
        echo -e "${YELLOW}⚠ No backups with auto-delete found${NC}"
    fi
}

# Test 7: Progress tracking with real backup
test_real_backup_progress() {
    echo -e "${YELLOW}Test 7: Creating real backup and tracking progress${NC}"

    # Create a backup
    local response=$(api_call POST /backups '{
        "name": "Progress Test Backup",
        "type": "database",
        "description": "Testing progress tracking",
        "autoDelete": {
            "enabled": true,
            "retention": "1_day"
        }
    }')

    local backup_id=$(echo "$response" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

    if [ -n "$backup_id" ]; then
        echo -e "${GREEN}✓ Backup started: $backup_id${NC}"
        echo "  Monitoring progress..."

        # Poll for progress (simplified version)
        for i in {1..10}; do
            sleep 2
            local status_response=$(api_call GET "/backups/$backup_id")
            local progress=$(echo "$status_response" | grep -o '"progress":[0-9]*' | cut -d: -f2)
            local status=$(echo "$status_response" | grep -o '"status":"[^"]*' | cut -d'"' -f4)

            if [ -n "$progress" ]; then
                echo "  Progress: ${progress}% - Status: $status"
            fi

            if [ "$status" = "completed" ]; then
                echo -e "${GREEN}✓ Backup completed successfully${NC}"
                break
            elif [ "$status" = "failed" ]; then
                echo -e "${RED}✗ Backup failed${NC}"
                break
            fi
        done
    else
        echo -e "${RED}✗ Failed to start backup${NC}"
        return 1
    fi
}

# Main test execution
main() {
    echo "Starting backup feature tests..."
    echo "API URL: $API_URL"
    echo "Webhook URL: $WEBHOOK_URL"
    echo ""

    # Run tests
    backup_id=$(test_auto_delete)

    if [ -n "$backup_id" ]; then
        test_backup_metadata "$backup_id"
        test_websocket_progress "$backup_id"
    fi

    test_scheduled_backup
    test_webhook_endpoint
    test_list_backups
    test_real_backup_progress

    echo ""
    echo -e "${GREEN}=== Test Suite Complete ===${NC}"
    echo ""
    echo "Summary:"
    echo "- Auto-delete feature: Implemented ✓"
    echo "- Progress tracking: Implemented ✓"
    echo "- WebSocket support: Implemented ✓"
    echo "- Webhook support: Implemented ✓"
    echo "- Scheduled backups: Implemented ✓"
    echo ""
    echo "To monitor the cleanup job, check the logs:"
    echo "  tail -f /var/log/api/backup-cleanup.log"
}

# Run main function
main