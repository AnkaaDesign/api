#!/bin/bash
# ============================================
# Ankaa Server Firewall Setup Script
# ============================================
# This script configures UFW firewall for the Ankaa server
# Required ports:
# - 22: SSH
# - 80: HTTP (redirect to HTTPS)
# - 443: HTTPS
# - 445: SMB/Samba (local network only)
# - 139: NetBIOS (local network only)
# - 5432: PostgreSQL (localhost only)
# - 6379: Redis (localhost only)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Ankaa Server Firewall Setup${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Check if UFW is installed
if ! command -v ufw &> /dev/null; then
    echo -e "${YELLOW}Installing UFW...${NC}"
    apt-get update
    apt-get install -y ufw
fi

echo -e "${YELLOW}Configuring UFW firewall...${NC}"

# Reset UFW to default (deny all incoming, allow all outgoing)
ufw --force reset

# Set default policies
ufw default deny incoming
ufw default allow outgoing

# ===================================
# SSH - Allow from anywhere (port 22)
# ===================================
echo -e "${GREEN}Allowing SSH (port 22)...${NC}"
ufw allow 22/tcp comment 'SSH'

# ===================================
# HTTP/HTTPS - Web traffic
# ===================================
echo -e "${GREEN}Allowing HTTP (port 80)...${NC}"
ufw allow 80/tcp comment 'HTTP'

echo -e "${GREEN}Allowing HTTPS (port 443)...${NC}"
ufw allow 443/tcp comment 'HTTPS'

# ===================================
# Samba/SMB - Local network only
# ===================================
# Adjust the IP range to match your local network
LOCAL_NETWORK="192.168.0.0/16"

echo -e "${GREEN}Allowing Samba (ports 139,445) from local network...${NC}"
ufw allow from $LOCAL_NETWORK to any port 139 proto tcp comment 'Samba NetBIOS'
ufw allow from $LOCAL_NETWORK to any port 445 proto tcp comment 'Samba SMB'
ufw allow from $LOCAL_NETWORK to any port 137 proto udp comment 'Samba NetBIOS Name'
ufw allow from $LOCAL_NETWORK to any port 138 proto udp comment 'Samba NetBIOS Datagram'

# Also allow from 10.x.x.x networks (common for VPNs)
ufw allow from 10.0.0.0/8 to any port 139 proto tcp comment 'Samba NetBIOS VPN'
ufw allow from 10.0.0.0/8 to any port 445 proto tcp comment 'Samba SMB VPN'

# ===================================
# PostgreSQL - Localhost only
# ===================================
echo -e "${GREEN}PostgreSQL (port 5432) - localhost only by default${NC}"
# PostgreSQL is bound to localhost by default, no UFW rule needed
# If you need remote access, uncomment and adjust:
# ufw allow from YOUR_IP to any port 5432 proto tcp comment 'PostgreSQL'

# ===================================
# Redis - Localhost only
# ===================================
echo -e "${GREEN}Redis (port 6379) - localhost only by default${NC}"
# Redis is bound to localhost by default, no UFW rule needed
# If you need remote access, uncomment and adjust:
# ufw allow from YOUR_IP to any port 6379 proto tcp comment 'Redis'

# ===================================
# Rate limiting for SSH (prevent brute force)
# ===================================
echo -e "${GREEN}Enabling rate limiting for SSH...${NC}"
ufw limit ssh/tcp comment 'SSH rate limit'

# ===================================
# Enable UFW
# ===================================
echo -e "${YELLOW}Enabling UFW...${NC}"
ufw --force enable

# ===================================
# Show status
# ===================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Firewall Configuration Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
ufw status verbose

echo ""
echo -e "${GREEN}Firewall setup complete!${NC}"
echo ""
echo -e "${YELLOW}Open ports:${NC}"
echo "  - 22/tcp  : SSH (rate limited)"
echo "  - 80/tcp  : HTTP"
echo "  - 443/tcp : HTTPS"
echo "  - 139/tcp : Samba NetBIOS (local network)"
echo "  - 445/tcp : Samba SMB (local network)"
echo ""
echo -e "${YELLOW}Note:${NC} PostgreSQL (5432) and Redis (6379) are bound to localhost only."
