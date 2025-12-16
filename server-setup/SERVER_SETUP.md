# Ankaa Server Setup Guide

This guide provides comprehensive instructions for setting up the Ankaa server infrastructure.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Detailed Setup](#detailed-setup)
5. [Domain Configuration](#domain-configuration)
6. [Services](#services)
7. [File Storage (Arquivos)](#file-storage-arquivos)
8. [Security](#security)
9. [Maintenance](#maintenance)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### Architecture

```
                    Internet
                        │
                    ┌───┴───┐
                    │ nginx │
                    └───┬───┘
                        │
        ┌───────────────┼───────────────┬───────────────┐
        │               │               │               │
   ankaa.live     api.ankaa.live  webhook.ankaa.live  arquivos.ankaa.live
   (Web SPA)       (API :3030)    (Webhook :3001)     (Samba Files)
        │               │               │               │
        │         ┌─────┴─────┐         │         ┌─────┴─────┐
        │         │           │         │         │           │
        │    PostgreSQL    Redis        │      /srv/files    nginx
        │       (:5432)   (:6379)       │      (Samba SMB)   (static)
        │               │               │
        └───────────────┴───────────────┘
                        │
                  ┌─────┴─────┐
                  │   PM2 /   │
                  │  systemd  │
                  └───────────┘
```

### Domains

| Domain | Purpose | Port |
|--------|---------|------|
| `ankaa.live` | Web Application (React SPA) | 443 |
| `api.ankaa.live` | API Server (NestJS) | 3030 |
| `webhook.ankaa.live` | Webhook Server | 3001 |
| `arquivos.ankaa.live` | File Storage (Arquivos) | 445/443 |
| `ssh.ankaa.live` | SSH Access | 22 |

---

## Prerequisites

- Ubuntu 22.04 LTS or newer
- Root access
- Domain names pointing to server IP
- At least 4GB RAM, 50GB disk space

---

## Quick Start

```bash
# 1. Clone the repository
git clone git@github.com:your-org/ankaa-api.git /home/kennedy/ankaa/api
git clone git@github.com:your-org/ankaa-web.git /home/kennedy/ankaa/web

# 2. Run the setup script as root
sudo bash /home/kennedy/ankaa/api/server-setup/scripts/setup-server.sh

# 3. Set up SSL certificates
sudo bash /home/kennedy/ankaa/api/server-setup/scripts/setup-ssl.sh

# 4. Enable nginx sites
sudo ln -s /etc/nginx/sites-available/ankaa.live.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.ankaa.live.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/webhook.ankaa.live.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/arquivos.ankaa.live.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 5. Start services
cd /home/kennedy/ankaa/api
docker-compose up -d
pnpm install
pnpm run build
sudo systemctl start ankaa-api ankaa-webhook
```

---

## Detailed Setup

### 1. System Packages

```bash
sudo apt-get update
sudo apt-get install -y \
    curl wget git build-essential \
    nginx ufw certbot python3-certbot-nginx \
    samba samba-common-bin \
    postgresql-client redis-tools \
    htop tmux unzip jq
```

### 2. Node.js & pnpm

```bash
# Install Node.js v18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
sudo npm install -g pnpm
```

### 3. Docker

```bash
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker kennedy
```

### 4. User & Groups

```bash
# Create ankaa group
sudo groupadd ankaa

# Add user to groups
sudo usermod -aG ankaa,docker kennedy
```

### 5. Directory Structure

```bash
# Application directories
sudo mkdir -p /home/kennedy/ankaa/{api,web}
sudo mkdir -p /home/kennedy/backups/{deployments,database}

# Files storage (Arquivos)
sudo mkdir -p /srv/files/{Projetos,Orcamentos,Comprovantes,Logos,Colaboradores,Aerografias,Plotter,Thumbnails}

# Set permissions
sudo chown -R kennedy:ankaa /home/kennedy/ankaa
sudo chown -R kennedy:ankaa /srv/files
sudo chmod -R 2775 /srv/files
```

---

## Domain Configuration

### DNS Records

Configure the following A records pointing to your server's IP:

```
ankaa.live          A    YOUR_SERVER_IP
www.ankaa.live      A    YOUR_SERVER_IP
api.ankaa.live      A    YOUR_SERVER_IP
webhook.ankaa.live  A    YOUR_SERVER_IP
arquivos.ankaa.live A    YOUR_SERVER_IP
ssh.ankaa.live      A    YOUR_SERVER_IP
```

### SSL Certificates

```bash
# Run SSL setup script
sudo bash /home/kennedy/ankaa/api/server-setup/scripts/setup-ssl.sh

# Or manually with certbot
sudo certbot certonly --webroot \
    -w /var/www/certbot \
    -d ankaa.live \
    -d www.ankaa.live \
    -d api.ankaa.live \
    -d webhook.ankaa.live \
    -d arquivos.ankaa.live
```

### Nginx Configuration

```bash
# Copy configurations
sudo cp /home/kennedy/ankaa/api/nginx/*.conf /etc/nginx/sites-available/

# Enable sites
sudo ln -s /etc/nginx/sites-available/ankaa.live.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.ankaa.live.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/webhook.ankaa.live.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/arquivos.ankaa.live.conf /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

---

## Services

### Systemd Services

```bash
# Copy service files
sudo cp /home/kennedy/ankaa/api/server-setup/systemd/*.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable services
sudo systemctl enable ankaa-api ankaa-webhook

# Start services
sudo systemctl start ankaa-api ankaa-webhook

# Check status
sudo systemctl status ankaa-api
sudo systemctl status ankaa-webhook
```

### Service Commands

```bash
# API Service
sudo systemctl start ankaa-api
sudo systemctl stop ankaa-api
sudo systemctl restart ankaa-api
sudo systemctl status ankaa-api
journalctl -u ankaa-api -f

# Webhook Service
sudo systemctl start ankaa-webhook
sudo systemctl stop ankaa-webhook
sudo systemctl restart ankaa-webhook
journalctl -u ankaa-webhook -f
```

### Docker Services (PostgreSQL & Redis)

```bash
cd /home/kennedy/ankaa/api

# Start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

---

## File Storage (Arquivos)

### Overview

File storage uses Samba for network file sharing and nginx for web access:

- **Internal name**: `files`, `FilesStorage`
- **User-facing name**: `Arquivos`
- **Storage path**: `/srv/files`
- **Web URL**: `https://arquivos.ankaa.live`
- **SMB URL**: `smb://SERVER_IP/Arquivos`

### Folder Structure

```
/srv/files/
├── Projetos/              # Task artworks (by customer)
├── Orcamentos/            # Budgets
│   ├── Tarefas/
│   ├── Pedidos/
│   └── Aerografias/
├── Notas Fiscais/         # Invoices
│   ├── Tarefas/
│   ├── Pedidos/
│   └── Aerografias/
├── Comprovantes/          # Receipts
├── Logos/
│   ├── Clientes/
│   └── Fornecedores/
├── Colaboradores/         # Employee files
├── Aerografias/           # Airbrushing projects
├── Plotter/               # Cut files (Espovo/Adesivo)
├── Thumbnails/            # Generated thumbnails
├── Recortes/              # Cut request files
└── Auxiliares/            # General files
```

### Samba Setup

```bash
# Run Samba setup script
sudo bash /home/kennedy/ankaa/api/server-setup/scripts/setup-samba.sh

# Or manually:
sudo cp /home/kennedy/ankaa/api/server-setup/samba/smb.conf /etc/samba/smb.conf
sudo testparm -s
sudo systemctl restart smbd nmbd
sudo smbpasswd -a kennedy
```

### Connecting to Samba

**Windows:**
```
\\SERVER_IP\Arquivos
```

**macOS:**
```
smb://SERVER_IP/Arquivos
```

**Linux:**
```bash
# GUI
smb://SERVER_IP/Arquivos

# CLI mount
sudo mount -t cifs //SERVER_IP/Arquivos /mnt/arquivos -o username=kennedy
```

---

## Security

### Firewall (UFW)

```bash
# Run firewall setup
sudo bash /home/kennedy/ankaa/api/server-setup/scripts/setup-firewall.sh

# Or manually:
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow from 192.168.0.0/16 to any port 445 proto tcp  # Samba
sudo ufw enable
```

### Open Ports

| Port | Protocol | Service | Access |
|------|----------|---------|--------|
| 22 | TCP | SSH | Public (rate limited) |
| 80 | TCP | HTTP | Public (redirects to HTTPS) |
| 443 | TCP | HTTPS | Public |
| 139 | TCP | Samba NetBIOS | Local network only |
| 445 | TCP | Samba SMB | Local network only |
| 3030 | TCP | API | Localhost only |
| 3001 | TCP | Webhook | Localhost only |
| 5432 | TCP | PostgreSQL | Localhost only |
| 6379 | TCP | Redis | Localhost only |

### Environment Variables

Create `/home/kennedy/ankaa/api/.env.production`:

```env
NODE_ENV=production
PORT=3030

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ankaa_production
SHADOW_DATABASE_URL=postgresql://user:pass@localhost:5432/ankaa_production_shadow

# JWT (minimum 32 characters)
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRATION=7d

# API URLs
API_URL=https://api.ankaa.live
API_BASE_URL=https://api.ankaa.live
CLIENT_HOST=https://ankaa.live
CORS_ORIGINS=https://ankaa.live

# Files Storage (Arquivos)
FILES_ROOT=/srv/files
FILES_BASE_URL=https://arquivos.ankaa.live
USE_X_ACCEL_REDIRECT=true

# Redis (optional but recommended)
REDIS_HOST=localhost
REDIS_PORT=6379

# Webhook
WEBHOOK_SECRET=your-webhook-secret
WEBHOOK_PORT=3001
```

---

## Maintenance

### Deployment

```bash
# Deploy everything
sudo -u kennedy bash /home/kennedy/ankaa/api/server-setup/scripts/deploy-production.sh --all

# Deploy API only
sudo -u kennedy bash /home/kennedy/ankaa/api/server-setup/scripts/deploy-production.sh --api

# Deploy Web only
sudo -u kennedy bash /home/kennedy/ankaa/api/server-setup/scripts/deploy-production.sh --web
```

### Database Backup

```bash
# Backup
docker exec ankaa-postgres pg_dump -U ankaadesign ankaa_production > backup.sql

# Restore
cat backup.sql | docker exec -i ankaa-postgres psql -U ankaadesign ankaa_production
```

### Log Locations

| Log | Location |
|-----|----------|
| API | `journalctl -u ankaa-api` |
| Webhook | `journalctl -u ankaa-webhook` |
| Nginx access | `/var/log/nginx/*.access.log` |
| Nginx error | `/var/log/nginx/*.error.log` |
| Samba | `/var/log/samba/` |
| PostgreSQL | `docker logs ankaa-postgres` |

### SSL Certificate Renewal

Certbot auto-renewal is configured via cron. To test:

```bash
sudo certbot renew --dry-run
```

---

## Troubleshooting

### API Not Starting

```bash
# Check logs
journalctl -u ankaa-api -n 50

# Verify environment
cat /home/kennedy/ankaa/api/.env.production

# Check database connection
docker exec ankaa-postgres pg_isready

# Test manually
cd /home/kennedy/ankaa/api
node dist/main.js
```

### Nginx Issues

```bash
# Test configuration
sudo nginx -t

# Check error log
sudo tail -f /var/log/nginx/error.log

# Reload after changes
sudo systemctl reload nginx
```

### Samba Issues

```bash
# Test configuration
testparm -s

# Check Samba status
sudo systemctl status smbd

# View Samba logs
sudo tail -f /var/log/samba/log.*

# List connected users
sudo smbstatus
```

### Permission Issues

```bash
# Fix file ownership
sudo chown -R kennedy:ankaa /srv/files
sudo chmod -R 2775 /srv/files

# Fix application directories
sudo chown -R kennedy:ankaa /home/kennedy/ankaa
```

---

## Manual Tasks Checklist

The following tasks require manual intervention:

1. [ ] **DNS Configuration** - Point domains to server IP
2. [ ] **SSL Certificates** - Run `setup-ssl.sh` after DNS propagation
3. [ ] **Samba Password** - Set password with `smbpasswd -a kennedy`
4. [ ] **Environment Files** - Create `.env.production` with secrets
5. [ ] **Database Setup** - Run migrations after first deployment
6. [ ] **GitHub Webhook** - Configure webhook URL and secret
7. [ ] **Backup Schedule** - Set up automated database backups
8. [ ] **Monitoring** - Configure uptime monitoring (optional)

---

## Support

For issues or questions:
- Repository: https://github.com/ankaa-design/ankaa
- Issues: https://github.com/ankaa-design/ankaa/issues
