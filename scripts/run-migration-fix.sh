#!/bin/bash

# Script to run the migration fix
echo "🔧 Running Migration Fix Script..."
echo "=================================="

# Check if tsx is installed
if ! command -v tsx &> /dev/null; then
    echo "📦 Installing tsx..."
    npm install -g tsx
fi

# Run the migration fix script
echo "🚀 Executing migration fixes..."
tsx scripts/fix-migration-issues.ts

echo "✅ Migration fix completed!"