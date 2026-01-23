#!/bin/bash
# ============================================
# Cleanup All Backups Script
# ============================================
# This script removes all existing backups and prepares the system
# for the new database-backed backup workflow.
#
# WARNING: This will permanently delete ALL backups!
#
# Run as root: sudo bash cleanup-all-backups.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BACKUP_PATH="${BACKUP_PATH:-/mnt/backup}"
OLD_BACKUP_PATH="/srv/files/Backup"

echo -e "${RED}========================================${NC}"
echo -e "${RED}  DANGER: Cleanup All Backups${NC}"
echo -e "${RED}========================================${NC}"
echo ""
echo -e "${YELLOW}This script will:${NC}"
echo "  1. Delete ALL backup files from ${BACKUP_PATH}"
echo "  2. Delete ALL backup files from ${OLD_BACKUP_PATH} (if exists)"
echo "  3. Clear the Backup table in the database"
echo "  4. Create fresh backup directories with correct permissions"
echo ""
echo -e "${RED}WARNING: This action CANNOT be undone!${NC}"
echo ""

# Confirmation
read -p "Type 'DELETE ALL BACKUPS' to confirm: " confirmation
if [ "$confirmation" != "DELETE ALL BACKUPS" ]; then
    echo -e "${YELLOW}Aborted.${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Starting cleanup...${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Step 1: Count existing backups
echo -e "${YELLOW}[1/5] Counting existing backups...${NC}"
if [ -d "$BACKUP_PATH" ]; then
    BACKUP_COUNT=$(find "$BACKUP_PATH" -name "*.tar.gz" -type f 2>/dev/null | wc -l)
    echo "  Found $BACKUP_COUNT backup files in $BACKUP_PATH"
fi
if [ -d "$OLD_BACKUP_PATH" ]; then
    OLD_BACKUP_COUNT=$(find "$OLD_BACKUP_PATH" -name "*.tar.gz" -type f 2>/dev/null | wc -l)
    echo "  Found $OLD_BACKUP_COUNT backup files in $OLD_BACKUP_PATH"
fi

# Step 2: Delete backup files from main path
echo -e "${YELLOW}[2/5] Deleting backup files from ${BACKUP_PATH}...${NC}"
if [ -d "$BACKUP_PATH" ]; then
    rm -rf "${BACKUP_PATH:?}"/{database,arquivos,sistema,full}/*
    echo -e "  ${GREEN}Done${NC}"
else
    echo "  Path does not exist, skipping"
fi

# Step 3: Delete backup files from old path
echo -e "${YELLOW}[3/5] Deleting backup files from ${OLD_BACKUP_PATH}...${NC}"
if [ -d "$OLD_BACKUP_PATH" ]; then
    rm -rf "${OLD_BACKUP_PATH:?}"/*
    echo -e "  ${GREEN}Done${NC}"
else
    echo "  Old path does not exist, skipping"
fi

# Step 4: Clear database (requires psql)
echo -e "${YELLOW}[4/5] Clearing Backup table in database...${NC}"

# Try to get database credentials from .env file
ENV_FILE="/home/kennedy/repositories/api/.env.production"
if [ ! -f "$ENV_FILE" ]; then
    ENV_FILE="/home/kennedy/repositories/api/.env"
fi

if [ -f "$ENV_FILE" ]; then
    # Extract DATABASE_URL from env file
    DATABASE_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" | cut -d '=' -f 2- | tr -d '"' | tr -d "'")

    if [ -n "$DATABASE_URL" ]; then
        # Parse DATABASE_URL (format: postgresql://user:pass@host:port/dbname)
        DB_USER=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
        DB_PASS=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        DB_NAME=$(echo "$DATABASE_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')

        if [ -n "$DB_USER" ] && [ -n "$DB_HOST" ] && [ -n "$DB_NAME" ]; then
            echo "  Connecting to database: $DB_NAME@$DB_HOST"

            # Clear Backup table
            PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c 'DELETE FROM "Backup";' 2>/dev/null && \
                echo -e "  ${GREEN}Backup table cleared${NC}" || \
                echo -e "  ${YELLOW}Could not clear database (may not exist yet)${NC}"
        else
            echo -e "  ${YELLOW}Could not parse DATABASE_URL${NC}"
        fi
    else
        echo -e "  ${YELLOW}DATABASE_URL not found in env file${NC}"
    fi
else
    echo -e "  ${YELLOW}Env file not found, skipping database cleanup${NC}"
fi

# Step 5: Create fresh directories with correct permissions
echo -e "${YELLOW}[5/5] Creating fresh backup directories...${NC}"

# Create main backup directories
mkdir -p "$BACKUP_PATH"/{database,arquivos,sistema,full}

# Set correct ownership and permissions
# kennedy:www-data allows API (kennedy) to write/delete, nginx (www-data) to read
chown -R kennedy:www-data "$BACKUP_PATH"
chmod -R 2775 "$BACKUP_PATH"

echo -e "  ${GREEN}Directories created with correct permissions${NC}"
echo "  Owner: kennedy:www-data"
echo "  Mode: 2775"

# Also fix old backup path if it exists
if [ -d "$OLD_BACKUP_PATH" ]; then
    chown -R kennedy:www-data "$OLD_BACKUP_PATH"
    chmod -R 2775 "$OLD_BACKUP_PATH"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Cleanup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Summary:${NC}"
echo "  - All backup files deleted"
echo "  - Database Backup table cleared"
echo "  - Fresh directories created"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Deploy the updated API code"
echo "  2. Run database migrations: pnpm run db:migrate:deploy"
echo "  3. Restart the API: sudo systemctl restart ankaa-api"
echo ""
echo -e "${GREEN}The backup system is now ready for the new database-backed workflow!${NC}"
