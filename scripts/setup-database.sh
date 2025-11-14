#!/bin/bash

# setup-database.sh
# Complete database setup script for all environments

set -e

echo "🚀 Ankaa Database Setup Script"
echo "=============================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get environment from argument or default to development
ENV=${1:-development}

echo -e "${YELLOW}Setting up environment: $ENV${NC}"

# Load environment variables
if [ -f ".env.$ENV" ]; then
    export $(cat .env.$ENV | grep -v '^#' | xargs)
    echo -e "${GREEN}✓ Loaded .env.$ENV${NC}"
elif [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo -e "${GREEN}✓ Loaded .env${NC}"
else
    echo -e "${RED}✗ No environment file found!${NC}"
    exit 1
fi

# Function to wait for PostgreSQL
wait_for_postgres() {
    echo "Waiting for PostgreSQL to be ready..."
    until docker exec ankaa-postgres pg_isready -U $POSTGRES_USER -d $POSTGRES_DB > /dev/null 2>&1; do
        echo -n "."
        sleep 1
    done
    echo -e "\n${GREEN}✓ PostgreSQL is ready!${NC}"
}

# Function to create shadow database
create_shadow_db() {
    local shadow_db="${POSTGRES_DB}_shadow"
    echo "Creating shadow database: $shadow_db"

    docker exec ankaa-postgres psql -U $POSTGRES_USER -d postgres -c "
        SELECT 'CREATE DATABASE ${shadow_db} OWNER $POSTGRES_USER'
        WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${shadow_db}')\\gexec
    " > /dev/null 2>&1 || true

    echo -e "${GREEN}✓ Shadow database ready${NC}"
}

# Main setup process
echo ""
echo "1. Starting Docker containers..."
docker compose down > /dev/null 2>&1 || true
docker compose up -d

echo ""
echo "2. Waiting for database..."
wait_for_postgres

echo ""
echo "3. Setting up shadow database..."
create_shadow_db

echo ""
echo "4. Running Prisma setup..."

# Generate Prisma Client
echo "   - Generating Prisma Client..."
npx prisma generate

# Push schema to database (for development)
if [ "$ENV" = "development" ]; then
    echo "   - Pushing schema to database..."
    npx prisma db push --accept-data-loss
    echo -e "${GREEN}✓ Database schema synced${NC}"
else
    echo "   - Running migrations..."
    npx prisma migrate deploy
    echo -e "${GREEN}✓ Migrations deployed${NC}"
fi

echo ""
echo "5. Seeding database (optional)..."
read -p "Do you want to seed the database? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run seed
    echo -e "${GREEN}✓ Database seeded${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Database setup complete!${NC}"
echo ""
echo "You can now:"
echo "  - Run the API: npm run dev"
echo "  - View database: npm run db:studio"
echo "  - Check logs: npm run docker:logs"
echo ""