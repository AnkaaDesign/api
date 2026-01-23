#!/bin/bash
# ============================================
# Ankaa Complete Server Setup Script
# ============================================
# This script sets up a fresh Ubuntu server for Ankaa
# Run as root on a fresh Ubuntu 22.04+ server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Ankaa Server Setup${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ===================================
# 1. System Update
# ===================================
echo -e "${BLUE}[1/10] Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

# ===================================
# 2. Install Required Packages
# ===================================
echo -e "${BLUE}[2/10] Installing required packages...${NC}"
apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    nginx \
    ufw \
    certbot \
    python3-certbot-nginx \
    samba \
    samba-common-bin \
    postgresql-client \
    redis-tools \
    htop \
    tmux \
    unzip \
    jq

# ===================================
# 3. Install Node.js (v18 LTS)
# ===================================
echo -e "${BLUE}[3/10] Installing Node.js v18...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi
node --version

# Install pnpm
echo -e "${YELLOW}Installing pnpm...${NC}"
npm install -g pnpm
pnpm --version

# ===================================
# 4. Install Docker & Docker Compose
# ===================================
echo -e "${BLUE}[4/10] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | bash
    usermod -aG docker kennedy
fi
docker --version

# ===================================
# 5. Create User and Groups
# ===================================
echo -e "${BLUE}[5/10] Setting up users and groups...${NC}"

# Create ankaa group if it doesn't exist
if ! getent group ankaa > /dev/null; then
    groupadd ankaa
fi

# Create kennedy user if it doesn't exist
if ! id kennedy &>/dev/null; then
    useradd -m -s /bin/bash -g ankaa kennedy
    usermod -aG sudo,docker kennedy
    echo -e "${YELLOW}Please set password for kennedy user:${NC}"
    passwd kennedy
fi

# Add kennedy to ankaa group
usermod -aG ankaa kennedy

# Cross-group memberships for file access
# kennedy needs www-data group for backup file management
usermod -aG www-data kennedy
# www-data needs ankaa group for file storage access
usermod -aG ankaa www-data

echo -e "${GREEN}Group memberships configured:${NC}"
echo "  - kennedy: $(groups kennedy)"
echo "  - www-data: $(groups www-data)"

# ===================================
# 6. Create Directory Structure
# ===================================
echo -e "${BLUE}[6/10] Creating directory structure...${NC}"

# Application directories
mkdir -p /home/kennedy/ankaa/{api,web}
mkdir -p /home/kennedy/backups/{deployments,database}

# Files storage directory (Samba/Arquivos)
mkdir -p /srv/files/{Projetos,Orcamentos,Comprovantes,Logos,Colaboradores,Aerografias,Plotter,Thumbnails,Auxiliares,Fotos,Uploads,Publico,Recortes,Observacoes,Advertencias,Tintas}
mkdir -p /srv/files/Orcamentos/{Tarefas,Pedidos,Aerografias}
mkdir -p /srv/files/Comprovantes/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/"Notas Fiscais"/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/Reembolsos/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/"Notas Fiscais Reembolso"/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/Logos/{Clientes,Fornecedores}
mkdir -p /srv/files/Auxiliares/Traseiras/Fotos

# Logs directory
mkdir -p /var/log/ankaa

# Certbot webroot
mkdir -p /var/www/certbot

# Set ownership
chown -R kennedy:ankaa /home/kennedy/ankaa
chown -R kennedy:ankaa /home/kennedy/backups
chown -R kennedy:ankaa /srv/files
chown -R kennedy:ankaa /var/log/ankaa
chmod -R 2775 /srv/files

# Special handling for Backup directory
# Owned by kennedy:www-data so API can create/delete and nginx can read
mkdir -p /srv/files/Backup/{database,arquivos,sistema,full}
chown -R kennedy:www-data /srv/files/Backup
chmod -R 2775 /srv/files/Backup

echo -e "${GREEN}Backup directory configured:${NC}"
echo "  - Path: /srv/files/Backup"
echo "  - Owner: kennedy:www-data"
echo "  - Mode: 2775 (setgid)"

# ===================================
# 7. Configure Firewall
# ===================================
echo -e "${BLUE}[7/10] Configuring firewall...${NC}"
if [ -f "$SCRIPT_DIR/setup-firewall.sh" ]; then
    bash "$SCRIPT_DIR/setup-firewall.sh"
else
    echo -e "${YELLOW}Firewall script not found, configuring manually...${NC}"
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow from 192.168.0.0/16 to any port 445 proto tcp
    ufw allow from 192.168.0.0/16 to any port 139 proto tcp
    ufw --force enable
fi

# ===================================
# 8. Configure Samba
# ===================================
echo -e "${BLUE}[8/10] Configuring Samba...${NC}"
if [ -f "$SCRIPT_DIR/../samba/smb.conf" ]; then
    cp "$SCRIPT_DIR/../samba/smb.conf" /etc/samba/smb.conf
    testparm -s
    systemctl enable smbd nmbd
    systemctl restart smbd nmbd
    echo -e "${YELLOW}Set Samba password for kennedy:${NC}"
    smbpasswd -a kennedy
else
    echo -e "${YELLOW}Samba config not found, skipping...${NC}"
fi

# ===================================
# 9. Configure Nginx
# ===================================
echo -e "${BLUE}[9/10] Configuring Nginx...${NC}"

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Copy nginx configurations
NGINX_SRC="$SCRIPT_DIR/../nginx"
if [ -d "$NGINX_SRC" ] || [ -d "$SCRIPT_DIR/../../nginx" ]; then
    NGINX_SRC="${NGINX_SRC:-$SCRIPT_DIR/../../nginx}"
    cp "$NGINX_SRC"/*.conf /etc/nginx/sites-available/ 2>/dev/null || true
fi

# Create rate limiting zone configuration
cat > /etc/nginx/conf.d/rate-limiting.conf << 'EOF'
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=webhook_limit:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=general_limit:10m rate=30r/s;
EOF

# Test nginx configuration
nginx -t

# Enable and start nginx
systemctl enable nginx
systemctl start nginx

# ===================================
# 10. Install Sudoers Configuration
# ===================================
echo -e "${BLUE}[10/11] Installing sudoers configuration for backup operations...${NC}"

SUDOERS_SRC="$SCRIPT_DIR/../sudoers"
if [ -d "$SUDOERS_SRC" ]; then
    # Install sudoers file for backup operations
    if [ -f "$SUDOERS_SRC/ankaa-backup" ]; then
        cp "$SUDOERS_SRC/ankaa-backup" /etc/sudoers.d/ankaa-backup
        chmod 440 /etc/sudoers.d/ankaa-backup
        # Validate sudoers file
        if visudo -c -f /etc/sudoers.d/ankaa-backup; then
            echo -e "${GREEN}Sudoers configuration installed successfully${NC}"
        else
            echo -e "${RED}Invalid sudoers file, removing...${NC}"
            rm -f /etc/sudoers.d/ankaa-backup
        fi
    fi
else
    echo -e "${YELLOW}Sudoers configuration not found, skipping...${NC}"
fi

# ===================================
# 11. Install Systemd Services
# ===================================
echo -e "${BLUE}[11/11] Installing systemd services...${NC}"

SYSTEMD_SRC="$SCRIPT_DIR/../systemd"
if [ -d "$SYSTEMD_SRC" ]; then
    cp "$SYSTEMD_SRC"/*.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable ankaa-api ankaa-webhook
else
    echo -e "${YELLOW}Systemd service files not found, skipping...${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Server Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Clone your repositories to /home/kennedy/ankaa/"
echo "2. Set up SSL certificates: bash setup-ssl.sh"
echo "3. Enable nginx sites:"
echo "   ln -s /etc/nginx/sites-available/ankaadesign.com.br.conf /etc/nginx/sites-enabled/"
echo "   ln -s /etc/nginx/sites-available/api.ankaadesign.com.br.conf /etc/nginx/sites-enabled/"
echo "   ln -s /etc/nginx/sites-available/webhook.ankaadesign.com.br.conf /etc/nginx/sites-enabled/"
echo "   ln -s /etc/nginx/sites-available/arquivos.ankaadesign.com.br.conf /etc/nginx/sites-enabled/"
echo "4. Configure environment files (.env.production)"
echo "5. Start Docker services (PostgreSQL, Redis)"
echo "6. Run database migrations"
echo "7. Start application services"
echo ""
echo -e "${GREEN}Useful commands:${NC}"
echo "  - Check API status: systemctl status ankaa-api"
echo "  - Check webhook status: systemctl status ankaa-webhook"
echo "  - View API logs: journalctl -u ankaa-api -f"
echo "  - View nginx logs: tail -f /var/log/nginx/*.log"
echo ""
echo -e "${GREEN}Domains:${NC}"
echo "  - https://ankaadesign.com.br (Web)"
echo "  - https://api.ankaadesign.com.br (API)"
echo "  - https://webhook.ankaadesign.com.br (Webhooks)"
echo "  - https://arquivos.ankaadesign.com.br (Arquivos/Files)"
echo ""
echo -e "${GREEN}Samba shares:${NC}"
echo "  - smb://$(hostname -I | awk '{print $1}')/Arquivos"
