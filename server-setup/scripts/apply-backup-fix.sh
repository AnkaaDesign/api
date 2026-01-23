#!/bin/bash
# ============================================
# Apply Backup Permission Fix
# ============================================
# Quick script to apply the backup permission fix to an existing server.
# This should be run ONCE after deploying the updated code.
#
# Run as root: sudo bash apply-backup-fix.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_PATH="/srv/files/Backup"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Apply Backup Permission Fix${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   echo "Usage: sudo $0"
   exit 1
fi

# Step 1: Configure group memberships
echo -e "${BLUE}[1/5] Configuring group memberships...${NC}"
usermod -aG www-data kennedy 2>/dev/null && echo "  Added kennedy to www-data group" || echo "  kennedy already in www-data group"
usermod -aG ankaa www-data 2>/dev/null && echo "  Added www-data to ankaa group" || echo "  www-data already in ankaa group"
echo ""

# Step 2: Install sudoers configuration
echo -e "${BLUE}[2/5] Installing sudoers configuration...${NC}"
SUDOERS_SRC="$SCRIPT_DIR/../sudoers/ankaa-backup"
if [ -f "$SUDOERS_SRC" ]; then
    cp "$SUDOERS_SRC" /etc/sudoers.d/ankaa-backup
    chmod 440 /etc/sudoers.d/ankaa-backup
    if visudo -c -f /etc/sudoers.d/ankaa-backup 2>/dev/null; then
        echo -e "  ${GREEN}Sudoers configuration installed${NC}"
    else
        echo -e "  ${RED}Invalid sudoers file, removing...${NC}"
        rm -f /etc/sudoers.d/ankaa-backup
    fi
else
    echo -e "  ${YELLOW}Sudoers file not found at $SUDOERS_SRC, creating...${NC}"
    cat > /etc/sudoers.d/ankaa-backup << 'EOF'
# Sudoers configuration for Ankaa Backup Operations
kennedy ALL=(root) NOPASSWD: /usr/bin/chown -R kennedy\:www-data /srv/files/Backup/*
kennedy ALL=(root) NOPASSWD: /usr/bin/chown kennedy\:www-data /srv/files/Backup/*
kennedy ALL=(root) NOPASSWD: /usr/bin/chmod -R 2775 /srv/files/Backup/*
kennedy ALL=(root) NOPASSWD: /usr/bin/chmod 2775 /srv/files/Backup/*
kennedy ALL=(root) NOPASSWD: /usr/bin/rm -rf /srv/files/Backup/*
kennedy ALL=(root) NOPASSWD: /usr/bin/rm -f /srv/files/Backup/*
kennedy ALL=(root) NOPASSWD: /usr/bin/mkdir -p /srv/files/Backup/*
EOF
    chmod 440 /etc/sudoers.d/ankaa-backup
    echo -e "  ${GREEN}Sudoers configuration created${NC}"
fi
echo ""

# Step 3: Create/fix backup directory structure
echo -e "${BLUE}[3/5] Setting up backup directory structure...${NC}"
mkdir -p "$BACKUP_PATH"/{database,arquivos,sistema,full}
echo "  Created directories: database, arquivos, sistema, full"
echo ""

# Step 4: Fix ownership on existing backups
echo -e "${BLUE}[4/5] Fixing ownership on existing backups...${NC}"
chown -R kennedy:www-data "$BACKUP_PATH"
chmod -R 2775 "$BACKUP_PATH"
echo -e "  ${GREEN}Ownership set to kennedy:www-data with mode 2775${NC}"
echo ""

# Step 5: Verify and show results
echo -e "${BLUE}[5/5] Verification...${NC}"
echo ""
echo "Backup directory:"
ls -ld "$BACKUP_PATH"
echo ""
echo "Subdirectories:"
ls -la "$BACKUP_PATH"
echo ""

# Count existing backups
BACKUP_COUNT=$(find "$BACKUP_PATH" -name "*.json" -type f 2>/dev/null | wc -l)
echo "Found $BACKUP_COUNT backup metadata files"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Fix Applied Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Important: Restart the API service to apply changes:${NC}"
echo "  sudo systemctl restart ankaa-api"
echo ""
echo -e "${GREEN}The backup system should now work correctly:${NC}"
echo "  - New backups will be owned by kennedy:www-data"
echo "  - Existing backups have been fixed"
echo "  - Deletion will work without sudo issues"
echo ""
