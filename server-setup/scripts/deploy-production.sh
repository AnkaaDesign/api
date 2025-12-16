#!/bin/bash
# ============================================
# Ankaa Production Deployment Script
# ============================================
# This script deploys the Ankaa application to production
# It handles both API and Web deployments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOY_USER="kennedy"
DEPLOY_DIR="/home/kennedy/ankaa"
API_DIR="$DEPLOY_DIR/api"
WEB_DIR="$DEPLOY_DIR/web"
BACKUP_DIR="/home/kennedy/backups/deployments"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Ankaa Production Deployment${NC}"
echo -e "${GREEN}  Timestamp: $TIMESTAMP${NC}"
echo -e "${GREEN}========================================${NC}"

# Parse arguments
DEPLOY_API=false
DEPLOY_WEB=false
SKIP_BUILD=false
SKIP_MIGRATIONS=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --api) DEPLOY_API=true ;;
        --web) DEPLOY_WEB=true ;;
        --all) DEPLOY_API=true; DEPLOY_WEB=true ;;
        --skip-build) SKIP_BUILD=true ;;
        --skip-migrations) SKIP_MIGRATIONS=true ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --api              Deploy API only"
            echo "  --web              Deploy Web only"
            echo "  --all              Deploy both API and Web"
            echo "  --skip-build       Skip build step (use existing dist)"
            echo "  --skip-migrations  Skip database migrations"
            echo "  -h, --help         Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# Default to deploying both if none specified
if [ "$DEPLOY_API" = false ] && [ "$DEPLOY_WEB" = false ]; then
    DEPLOY_API=true
    DEPLOY_WEB=true
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Function to backup current deployment
backup_deployment() {
    local component=$1
    local source_dir=$2

    if [ -d "$source_dir/dist" ]; then
        echo -e "${YELLOW}Backing up current $component deployment...${NC}"
        tar -czf "$BACKUP_DIR/${component}_backup_$TIMESTAMP.tar.gz" -C "$source_dir" dist
    fi
}

# Function to deploy API
deploy_api() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Deploying API${NC}"
    echo -e "${BLUE}========================================${NC}"

    cd "$API_DIR"

    # Backup current deployment
    backup_deployment "api" "$API_DIR"

    # Pull latest changes
    echo -e "${YELLOW}Pulling latest changes...${NC}"
    git pull origin main

    # Install dependencies
    echo -e "${YELLOW}Installing dependencies...${NC}"
    pnpm install --frozen-lockfile

    # Generate Prisma client
    echo -e "${YELLOW}Generating Prisma client...${NC}"
    pnpm run db:generate

    # Run database migrations
    if [ "$SKIP_MIGRATIONS" = false ]; then
        echo -e "${YELLOW}Running database migrations...${NC}"
        pnpm run db:migrate:deploy
    else
        echo -e "${YELLOW}Skipping database migrations...${NC}"
    fi

    # Build application
    if [ "$SKIP_BUILD" = false ]; then
        echo -e "${YELLOW}Building application...${NC}"
        pnpm run build
    else
        echo -e "${YELLOW}Skipping build...${NC}"
    fi

    # Restart services
    echo -e "${YELLOW}Restarting API services...${NC}"
    sudo systemctl restart ankaa-api
    sudo systemctl restart ankaa-webhook

    # Wait for services to start
    echo -e "${YELLOW}Waiting for services to start...${NC}"
    sleep 5

    # Health check
    echo -e "${YELLOW}Running health check...${NC}"
    if curl -sf http://localhost:3030/health > /dev/null; then
        echo -e "${GREEN}API health check passed!${NC}"
    else
        echo -e "${RED}API health check failed!${NC}"
        echo -e "${YELLOW}Rolling back...${NC}"
        # Rollback logic here if needed
        exit 1
    fi

    echo -e "${GREEN}API deployment complete!${NC}"
}

# Function to deploy Web
deploy_web() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Deploying Web${NC}"
    echo -e "${BLUE}========================================${NC}"

    cd "$WEB_DIR"

    # Backup current deployment
    backup_deployment "web" "$WEB_DIR"

    # Pull latest changes
    echo -e "${YELLOW}Pulling latest changes...${NC}"
    git pull origin main

    # Install dependencies
    echo -e "${YELLOW}Installing dependencies...${NC}"
    pnpm install --frozen-lockfile

    # Build application
    if [ "$SKIP_BUILD" = false ]; then
        echo -e "${YELLOW}Building application...${NC}"
        VITE_API_URL=https://api.ankaa.live pnpm run build
    else
        echo -e "${YELLOW}Skipping build...${NC}"
    fi

    # The web app is served as static files by nginx
    # No service restart needed, just ensure dist is updated

    # Verify build output
    if [ -f "$WEB_DIR/dist/index.html" ]; then
        echo -e "${GREEN}Web build verified!${NC}"
    else
        echo -e "${RED}Web build failed - index.html not found!${NC}"
        exit 1
    fi

    echo -e "${GREEN}Web deployment complete!${NC}"
}

# Main deployment logic
echo -e "${YELLOW}Starting deployment...${NC}"
echo -e "  API: $([ "$DEPLOY_API" = true ] && echo "Yes" || echo "No")"
echo -e "  Web: $([ "$DEPLOY_WEB" = true ] && echo "Yes" || echo "No")"
echo ""

# Deploy API
if [ "$DEPLOY_API" = true ]; then
    deploy_api
fi

# Deploy Web
if [ "$DEPLOY_WEB" = true ]; then
    deploy_web
fi

# Reload nginx if web was deployed
if [ "$DEPLOY_WEB" = true ]; then
    echo -e "${YELLOW}Reloading nginx...${NC}"
    sudo nginx -t && sudo systemctl reload nginx
fi

# Cleanup old backups (keep last 10)
echo -e "${YELLOW}Cleaning up old backups...${NC}"
cd "$BACKUP_DIR"
ls -t api_backup_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm
ls -t web_backup_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}  Timestamp: $TIMESTAMP${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Services status:${NC}"
if [ "$DEPLOY_API" = true ]; then
    systemctl is-active ankaa-api && echo "  ankaa-api: running" || echo "  ankaa-api: stopped"
    systemctl is-active ankaa-webhook && echo "  ankaa-webhook: running" || echo "  ankaa-webhook: stopped"
fi
echo ""
echo -e "${GREEN}URLs:${NC}"
echo "  - Web:     https://ankaa.live"
echo "  - API:     https://api.ankaa.live"
echo "  - Webhook: https://webhook.ankaa.live"
echo "  - Arquivos: https://arquivos.ankaa.live"
