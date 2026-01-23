#!/bin/bash
# ============================================
# Fix Backup Permissions Script
# ============================================
# This script fixes permissions on existing backups that were
# created with www-data:www-data ownership, making them
# deletable by the kennedy user (API service user).
#
# Run as root: sudo bash fix-backup-permissions.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BACKUP_PATH="${1:-/srv/files/Backup}"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Fix Backup Permissions${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   echo "Usage: sudo $0 [backup_path]"
   echo "Default path: /srv/files/Backup"
   exit 1
fi

# Check if backup path exists
if [ ! -d "$BACKUP_PATH" ]; then
    echo -e "${RED}Backup path does not exist: $BACKUP_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}Backup path: $BACKUP_PATH${NC}"
echo ""

# Step 1: Ensure group memberships
echo -e "${YELLOW}[1/4] Checking group memberships...${NC}"
usermod -aG www-data kennedy 2>/dev/null || true
usermod -aG ankaa www-data 2>/dev/null || true
echo -e "  kennedy groups: $(groups kennedy)"
echo -e "  www-data groups: $(groups www-data)"

# Step 2: Fix ownership on all backup files
echo -e "${YELLOW}[2/4] Fixing ownership to kennedy:www-data...${NC}"
chown -R kennedy:www-data "$BACKUP_PATH"
echo -e "  ${GREEN}Done${NC}"

# Step 3: Fix permissions
echo -e "${YELLOW}[3/4] Setting permissions to 2775 (setgid)...${NC}"
chmod -R 2775 "$BACKUP_PATH"
echo -e "  ${GREEN}Done${NC}"

# Step 4: Verify
echo -e "${YELLOW}[4/4] Verifying...${NC}"
echo ""
echo "Sample files:"
find "$BACKUP_PATH" -type f -name "*.json" | head -5 | while read file; do
    ls -la "$file"
done
echo ""
echo "Sample directories:"
find "$BACKUP_PATH" -type d | head -5 | while read dir; do
    ls -ld "$dir"
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Permissions Fixed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Summary:${NC}"
echo "  - Owner: kennedy (can create, modify, delete)"
echo "  - Group: www-data (can read for nginx access)"
echo "  - Mode: 2775 (setgid for group inheritance)"
echo ""
echo -e "${YELLOW}Note: You may need to restart the API service:${NC}"
echo "  sudo systemctl restart ankaa-api"
