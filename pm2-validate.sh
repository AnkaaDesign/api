#!/bin/bash

# PM2 Configuration Validation Script

set -e

echo "🔍 Validating PM2 Configuration"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track validation status
ERRORS=0
WARNINGS=0

# Function to check directory exists
check_dir() {
  if [ -d "$1" ]; then
    echo -e "${GREEN}✓${NC} Directory exists: $1"
  else
    echo -e "${RED}✗${NC} Directory missing: $1"
    ERRORS=$((ERRORS + 1))
  fi
}

# Function to check file exists
check_file() {
  if [ -f "$1" ]; then
    echo -e "${GREEN}✓${NC} File exists: $1"
  else
    echo -e "${RED}✗${NC} File missing: $1"
    ERRORS=$((ERRORS + 1))
  fi
}

# Function to check port availability
check_port() {
  if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠${NC} Port $1 is already in use"
    lsof -Pi :$1 -sTCP:LISTEN
    WARNINGS=$((WARNINGS + 1))
  else
    echo -e "${GREEN}✓${NC} Port $1 is available"
  fi
}

# Navigate to API directory
cd "$(dirname "$0")"

echo "📁 Checking directories..."
check_dir "dist"
check_dir "logs"
check_dir "uploads"
check_dir "uploads-staging"
check_dir "scripts"

echo ""
echo "📄 Checking configuration files..."
check_file "ecosystem.config.js"
check_file "package.json"
check_file ".env"
check_file "dist/apps/api/src/main.js"
check_file "scripts/module-alias-setup.js"

echo ""
echo "🔌 Checking port availability..."
check_port 3030
check_port 3031

echo ""
echo "📦 Checking PM2 installation..."
if command -v pm2 &> /dev/null; then
  echo -e "${GREEN}✓${NC} PM2 is installed"
  pm2 --version
else
  echo -e "${RED}✗${NC} PM2 is not installed"
  echo "  Install with: npm install -g pm2"
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "🔍 Validating ecosystem.config.js syntax..."
if node -c ecosystem.config.js 2>/dev/null; then
  echo -e "${GREEN}✓${NC} ecosystem.config.js syntax is valid"
else
  echo -e "${RED}✗${NC} ecosystem.config.js has syntax errors"
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "📊 Checking Node.js version..."
NODE_VERSION=$(node --version)
echo "  Current version: $NODE_VERSION"
if [[ "$NODE_VERSION" =~ ^v(1[8-9]|[2-9][0-9]) ]]; then
  echo -e "${GREEN}✓${NC} Node.js version is compatible (>= 18)"
else
  echo -e "${YELLOW}⚠${NC} Node.js version may be too old (recommended >= 18)"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "🔐 Checking environment variables..."
if [ -f ".env" ]; then
  echo -e "${GREEN}✓${NC} .env file exists"

  # Check critical env vars
  if grep -q "DATABASE_URL" .env; then
    echo -e "${GREEN}✓${NC} DATABASE_URL is set"
  else
    echo -e "${YELLOW}⚠${NC} DATABASE_URL not found in .env"
    WARNINGS=$((WARNINGS + 1))
  fi

  if grep -q "JWT_SECRET" .env; then
    echo -e "${GREEN}✓${NC} JWT_SECRET is set"
  else
    echo -e "${YELLOW}⚠${NC} JWT_SECRET not found in .env"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${YELLOW}⚠${NC} .env file not found (will use ecosystem.config.js env vars)"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "📝 Checking log file permissions..."
if [ -d "logs" ]; then
  if [ -w "logs" ]; then
    echo -e "${GREEN}✓${NC} logs directory is writable"
  else
    echo -e "${RED}✗${NC} logs directory is not writable"
    echo "  Fix with: chmod -R 755 logs"
    ERRORS=$((ERRORS + 1))
  fi
fi

echo ""
echo "================================"
echo "📋 Validation Summary"
echo "================================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  echo ""
  echo "You can now start the API with:"
  echo "  ./pm2-start-both.sh       (start all)"
  echo "  ./pm2-start-production.sh (production only)"
  echo "  ./pm2-start-staging.sh    (staging only)"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠ Validation completed with ${WARNINGS} warning(s)${NC}"
  echo ""
  echo "You may proceed, but review the warnings above."
  exit 0
else
  echo -e "${RED}❌ Validation failed with ${ERRORS} error(s) and ${WARNINGS} warning(s)${NC}"
  echo ""
  echo "Please fix the errors above before starting PM2."
  exit 1
fi
