#!/bin/bash
# ============================================
# Ankaa Samba Server Setup Script
# ============================================
# This script sets up the Samba file server for Ankaa
# User-facing name: "Arquivos" (Files in Portuguese)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Ankaa Samba (Arquivos) Setup${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Install Samba
echo -e "${YELLOW}Installing Samba...${NC}"
apt-get update
apt-get install -y samba samba-common-bin

# Create ankaa group if it doesn't exist
if ! getent group ankaa > /dev/null; then
    echo -e "${YELLOW}Creating 'ankaa' group...${NC}"
    groupadd ankaa
fi

# Add kennedy user to ankaa group
echo -e "${YELLOW}Adding kennedy to 'ankaa' group...${NC}"
usermod -aG ankaa kennedy

# Create files directory structure
echo -e "${YELLOW}Creating files directory structure...${NC}"
mkdir -p /srv/files/{Projetos,Orcamentos,Comprovantes,Logos,Colaboradores,Aerografias,Plotter,Thumbnails,Auxiliares,Fotos,Uploads,Publico}
mkdir -p /srv/files/Orcamentos/{Tarefas,Pedidos,Aerografias}
mkdir -p /srv/files/Comprovantes/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/"Notas Fiscais"/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/Reembolsos/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/"Notas Fiscais Reembolso"/{Tarefas,Pedidos,Aerografias,RetiradasExternas}
mkdir -p /srv/files/Logos/{Clientes,Fornecedores}
mkdir -p /srv/files/Recortes
mkdir -p /srv/files/Observacoes
mkdir -p /srv/files/Advertencias
mkdir -p /srv/files/Auxiliares/Traseiras/Fotos
mkdir -p /srv/files/Tintas

# Set ownership and permissions
echo -e "${YELLOW}Setting permissions...${NC}"
chown -R kennedy:ankaa /srv/files
chmod -R 2775 /srv/files  # setgid for group inheritance
find /srv/files -type f -exec chmod 664 {} \;

# Backup existing Samba config
if [ -f /etc/samba/smb.conf ]; then
    echo -e "${YELLOW}Backing up existing Samba config...${NC}"
    cp /etc/samba/smb.conf /etc/samba/smb.conf.backup.$(date +%Y%m%d%H%M%S)
fi

# Copy new Samba configuration
echo -e "${YELLOW}Installing Samba configuration...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../samba/smb.conf" ]; then
    cp "$SCRIPT_DIR/../samba/smb.conf" /etc/samba/smb.conf
else
    echo -e "${RED}Samba config not found at $SCRIPT_DIR/../samba/smb.conf${NC}"
    echo -e "${YELLOW}Please copy smb.conf manually to /etc/samba/smb.conf${NC}"
fi

# Test Samba configuration
echo -e "${YELLOW}Testing Samba configuration...${NC}"
testparm -s

# Create Samba user (same password as system user)
echo -e "${YELLOW}Setting up Samba user...${NC}"
echo -e "${YELLOW}You will be prompted to set a Samba password for 'kennedy':${NC}"
smbpasswd -a kennedy

# Enable and start Samba services
echo -e "${YELLOW}Enabling and starting Samba services...${NC}"
systemctl enable smbd nmbd
systemctl restart smbd nmbd

# Check Samba status
echo -e "${YELLOW}Checking Samba status...${NC}"
systemctl status smbd --no-pager

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Samba Setup Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Files directory: /srv/files${NC}"
echo ""
echo -e "${GREEN}Available shares:${NC}"
echo "  - Arquivos      : All files (main share)"
echo "  - Projetos      : Task artworks"
echo "  - Orcamentos    : Budgets"
echo "  - NotasFiscais  : Invoices"
echo "  - Comprovantes  : Receipts"
echo "  - Logos         : Company logos"
echo "  - Colaboradores : Employee files"
echo "  - Aerografias   : Airbrushing projects"
echo "  - Plotter       : Cut files"
echo "  - Publico       : Public read-only files"
echo ""
echo -e "${YELLOW}Connect from Windows:${NC}"
echo "  \\\\$(hostname -I | awk '{print $1}')\\Arquivos"
echo ""
echo -e "${YELLOW}Connect from macOS:${NC}"
echo "  smb://$(hostname -I | awk '{print $1}')/Arquivos"
echo ""
echo -e "${YELLOW}Connect from Linux:${NC}"
echo "  smb://$(hostname -I | awk '{print $1}')/Arquivos"
echo "  Or mount: sudo mount -t cifs //SERVER/Arquivos /mnt/arquivos -o username=kennedy"
