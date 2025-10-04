#!/bin/bash

# Setup Staging Database Script
# Creates a separate staging database for testing

set -e

echo "🗄️  Setting up Staging Database"
echo "================================"
echo ""

# Database configuration
PROD_DB="ankaa"
STAGING_DB="ankaa_staging"
DB_USER="docker"
DB_HOST="localhost"
DB_PORT="5432"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if PostgreSQL is accessible
if ! psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -lqt 2>/dev/null; then
  echo -e "${RED}❌ Cannot connect to PostgreSQL${NC}"
  echo "Please ensure PostgreSQL is running and credentials are correct"
  echo "Connection: postgresql://$DB_USER@$DB_HOST:$DB_PORT"
  exit 1
fi

echo -e "${GREEN}✓${NC} Connected to PostgreSQL"

# Check if staging database already exists
if psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -lqt | cut -d \| -f 1 | grep -qw "$STAGING_DB"; then
  echo ""
  echo -e "${YELLOW}⚠ Staging database '$STAGING_DB' already exists${NC}"
  echo ""
  echo "Options:"
  echo "  1) Keep existing database"
  echo "  2) Drop and recreate (WARNING: All data will be lost)"
  echo "  3) Cancel"
  echo ""
  read -p "Choose option [1-3]: " choice

  case $choice in
    1)
      echo "Keeping existing database"
      ;;
    2)
      echo -e "${YELLOW}Dropping existing database...${NC}"
      psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -c "DROP DATABASE IF EXISTS $STAGING_DB;"
      echo -e "${GREEN}✓${NC} Database dropped"
      ;;
    3)
      echo "Cancelled"
      exit 0
      ;;
    *)
      echo "Invalid option"
      exit 1
      ;;
  esac
fi

# Create staging database if it doesn't exist
if ! psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -lqt | cut -d \| -f 1 | grep -qw "$STAGING_DB"; then
  echo ""
  echo "Creating staging database..."
  psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -c "CREATE DATABASE $STAGING_DB;"
  echo -e "${GREEN}✓${NC} Database '$STAGING_DB' created"
fi

echo ""
echo "Database setup options:"
echo "  1) Copy schema only (empty tables)"
echo "  2) Copy schema + data (full clone)"
echo "  3) Skip (database already configured)"
echo ""
read -p "Choose option [1-3]: " setup_choice

case $setup_choice in
  1)
    echo ""
    echo "Copying schema from production..."
    pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" "$PROD_DB" --schema-only | \
      psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" "$STAGING_DB"
    echo -e "${GREEN}✓${NC} Schema copied successfully"
    ;;
  2)
    echo ""
    echo "Copying schema and data from production..."
    echo -e "${YELLOW}⚠ This may take a while...${NC}"
    pg_dump -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" "$PROD_DB" | \
      psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" "$STAGING_DB"
    echo -e "${GREEN}✓${NC} Schema and data copied successfully"
    ;;
  3)
    echo "Skipping schema setup"
    ;;
  *)
    echo "Invalid option"
    exit 1
    ;;
esac

echo ""
echo "================================"
echo -e "${GREEN}✅ Staging database setup complete!${NC}"
echo "================================"
echo ""
echo "Database details:"
echo "  Production: postgresql://$DB_USER@$DB_HOST:$DB_PORT/$PROD_DB"
echo "  Staging:    postgresql://$DB_USER@$DB_HOST:$DB_PORT/$STAGING_DB"
echo ""
echo "Next steps:"
echo "  1. Update ecosystem.config.js with staging DB URL (if needed)"
echo "  2. Start staging environment: ./pm2-start-staging.sh"
echo "  3. Test staging API: curl http://localhost:3031/api/health"
echo ""
echo "Note: Staging database URL should be in ecosystem.config.js:"
echo "  DATABASE_URL: postgresql://$DB_USER@$DB_HOST:$DB_PORT/$STAGING_DB?schema=public"
