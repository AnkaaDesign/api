#!/bin/bash

# Script to reset database and run seed
echo "🔄 Database Reset and Seed Script"
echo "=================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Confirm with user
echo -e "${YELLOW}⚠️  WARNING: This will delete ALL data in the database!${NC}"
echo "Do you want to continue? (y/N)"
read -r response

if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo -e "${RED}❌ Operation cancelled${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Step 1: Clearing database...${NC}"
echo "----------------------------------------"
npx tsx scripts/clear-database.ts

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to clear database${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Step 2: Running seed script...${NC}"
echo "----------------------------------------"
npm run seed

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to seed database${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✨ Database reset and seeded successfully!${NC}"
echo ""
echo "Summary:"
echo "  • All old data removed"
echo "  • Missing users created automatically"
echo "  • All users marked as verified"
echo "  • Plates migrated to trucks properly"
echo "  • Default password for new users: ankaa123"
echo ""
echo -e "${YELLOW}📝 Note: New users should change their password on first login${NC}"