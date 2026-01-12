#!/bin/bash
# ============================================
# Ankaa Server SSL Setup Script (Let's Encrypt)
# ============================================
# This script sets up SSL certificates using Certbot
# for all Ankaa domains:
# - ankaadesign.com.br
# - api.ankaadesign.com.br
# - webhook.ankaadesign.com.br
# - arquivos.ankaadesign.com.br

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
EMAIL="admin@ankaadesign.com.br"  # Change this to your email
DOMAINS=(
    "ankaadesign.com.br"
    "www.ankaadesign.com.br"
    "api.ankaadesign.com.br"
    "webhook.ankaadesign.com.br"
    "arquivos.ankaadesign.com.br"
)

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Ankaa SSL Certificate Setup${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    echo -e "${YELLOW}Installing Certbot...${NC}"
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
fi

# Create webroot directory for ACME challenges
echo -e "${YELLOW}Creating webroot directory...${NC}"
mkdir -p /var/www/certbot

# Create initial nginx configuration for ACME challenges
echo -e "${YELLOW}Creating temporary nginx configuration for ACME challenges...${NC}"
cat > /etc/nginx/sites-available/acme-challenge.conf << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name ankaadesign.com.br www.ankaadesign.com.br api.ankaadesign.com.br webhook.ankaadesign.com.br arquivos.ankaadesign.com.br;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'ACME challenge server';
        add_header Content-Type text/plain;
    }
}
EOF

# Enable the ACME challenge configuration
ln -sf /etc/nginx/sites-available/acme-challenge.conf /etc/nginx/sites-enabled/

# Test nginx configuration
echo -e "${YELLOW}Testing nginx configuration...${NC}"
nginx -t

# Reload nginx
echo -e "${YELLOW}Reloading nginx...${NC}"
systemctl reload nginx

# Build domain arguments for certbot
DOMAIN_ARGS=""
for domain in "${DOMAINS[@]}"; do
    DOMAIN_ARGS="$DOMAIN_ARGS -d $domain"
done

# Request certificate
echo -e "${YELLOW}Requesting SSL certificate from Let's Encrypt...${NC}"
echo -e "${YELLOW}Domains: ${DOMAINS[*]}${NC}"

# Use webroot plugin for initial certificate
certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --expand \
    $DOMAIN_ARGS

# Check if certificate was obtained
if [ -f "/etc/letsencrypt/live/ankaadesign.com.br/fullchain.pem" ]; then
    echo -e "${GREEN}Certificate obtained successfully!${NC}"
else
    echo -e "${RED}Failed to obtain certificate${NC}"
    exit 1
fi

# Remove temporary ACME challenge configuration
rm -f /etc/nginx/sites-enabled/acme-challenge.conf

# Setup auto-renewal
echo -e "${YELLOW}Setting up automatic certificate renewal...${NC}"
cat > /etc/cron.d/certbot-renewal << 'EOF'
# Renew Let's Encrypt certificates twice daily
0 0,12 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"
EOF

# Test certificate renewal
echo -e "${YELLOW}Testing certificate renewal...${NC}"
certbot renew --dry-run

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SSL Setup Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Certificate files:${NC}"
echo "  - Fullchain: /etc/letsencrypt/live/ankaadesign.com.br/fullchain.pem"
echo "  - Private Key: /etc/letsencrypt/live/ankaadesign.com.br/privkey.pem"
echo ""
echo -e "${GREEN}Domains covered:${NC}"
for domain in "${DOMAINS[@]}"; do
    echo "  - $domain"
done
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy nginx configurations to /etc/nginx/sites-available/"
echo "2. Enable sites with: ln -s /etc/nginx/sites-available/SITE.conf /etc/nginx/sites-enabled/"
echo "3. Test: nginx -t"
echo "4. Reload: systemctl reload nginx"
echo ""
echo -e "${GREEN}Auto-renewal is configured via cron job.${NC}"
