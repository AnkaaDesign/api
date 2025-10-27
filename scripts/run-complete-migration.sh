#!/bin/bash

echo "🚀 Complete Fresh Migration Script"
echo "=================================="
echo ""
echo "This script will:"
echo "  1. Backup Users, Positions, Sectors"
echo "  2. Clean entire database"
echo "  3. Restore critical data"
echo "  4. Migrate all CSV data with intelligent parsing"
echo ""
echo "⚠️  WARNING: This will DELETE all data except Users, Positions, Sectors!"
echo ""

read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Migration cancelled"
    exit 1
fi

echo ""
echo "Starting migration..."
echo ""

cd /home/kennedy/repositories/api

# Run the migration
DATABASE_URL="postgresql://docker:docker@localhost:5432/ankaa?schema=public" \
tsx scripts/complete-fresh-migration.ts

echo ""
echo "✅ Migration script completed"
echo ""
echo "Check the output above for detailed results"
