# 🚀 Ankaa API - Database Setup & Migration Guide

## Table of Contents
- [Overview](#overview)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Docker Setup](#docker-setup)
- [Database Management](#database-management)
- [Migration Strategy](#migration-strategy)
- [Troubleshooting](#troubleshooting)
- [Security Recommendations](#security-recommendations)

## Overview

This project uses:
- **PostgreSQL 17** (Alpine) as the primary database
- **Redis 7** (Alpine) for caching and queue management
- **Prisma ORM** for database management
- **Docker Compose** for container orchestration

## Quick Start

### 1. Initial Setup (First Time)

```bash
# Clone the repository
git clone <repository-url>
cd api

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
nano .env

# Run the automated setup
./scripts/setup-database.sh
```

### 2. Daily Development

```bash
# Start services
npm run docker:up

# Start the API
npm run dev

# View database
npm run db:studio
```

## Environment Configuration

### File Structure

```
api/
├── .env                    # Active environment (development)
├── .env.development       # Development config
├── .env.staging          # Staging config
├── .env.production      # Production config
└── .env.example         # Template file
```

### Required Variables

```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/database"
SHADOW_DATABASE_URL="postgresql://user:password@host:5432/database_shadow"

# Docker PostgreSQL
POSTGRES_USER="ankaadesign"
POSTGRES_PASSWORD="your-secure-password"
POSTGRES_DB="ankaa_dev"

# Redis
REDIS_HOST="127.0.0.1"
REDIS_PORT=6379
REDIS_PASSWORD="your-redis-password"
```

## Docker Setup

### Services Configuration

Our `docker-compose.yml` includes:

1. **PostgreSQL** - Main database with health checks
2. **Redis** - Cache and queue management
3. **API** (optional) - NestJS application

### Docker Commands

```bash
# Start all services
npm run docker:up

# Stop services
npm run docker:down

# Reset everything (CAUTION: Deletes all data)
npm run docker:reset

# View logs
npm run docker:logs

# Access PostgreSQL
docker exec -it ankaa-postgres psql -U ankaadesign -d ankaa_dev

# Access Redis
docker exec -it ankaa-redis redis-cli
```

## Database Management

### Prisma Commands

```bash
# Push schema to database (development)
npm run db:push

# Create migration
npm run db:migrate

# Deploy migrations (production)
npm run db:migrate:deploy

# Reset database
npm run db:migrate:reset

# Open Prisma Studio
npm run db:studio

# Generate Prisma Client
npm run db:generate
```

### Migration Workflow

#### Development Environment

```bash
# 1. Make schema changes in prisma/schema.prisma

# 2. Push changes to database
npm run db:push

# 3. Test your changes

# 4. When ready, create migration
npm run db:migrate:create --name feature_name
```

#### Staging/Production

```bash
# 1. Ensure migrations are committed to git

# 2. Deploy migrations
NODE_ENV=production npm run db:migrate:deploy

# 3. Verify deployment
npm run db:studio
```

## Migration Strategy

### Development
- Use `prisma db push` for rapid iteration
- No migration files needed
- Database can be reset anytime

### Staging
- Use migrations for testing deployment
- Mirror production workflow
- Test rollback procedures

### Production
- Always use migrations
- Never use `db push`
- Maintain migration history
- Test in staging first

### Creating Migrations

```bash
# Development to Production workflow
1. Develop feature with db:push
2. Create migration: npx prisma migrate dev --name feature_name
3. Test migration locally
4. Push to git
5. Deploy to staging
6. Deploy to production
```

## Troubleshooting

### Common Issues

#### 1. Shadow Database Error

**Problem:** "Prisma Migrate could not create the shadow database"

**Solution:**
```bash
# For development, use db:push instead
npm run db:push

# Or manually create shadow database
docker exec ankaa-postgres psql -U ankaadesign -d postgres \
  -c "CREATE DATABASE ankaa_dev_shadow;"
```

#### 2. Connection Refused

**Problem:** Cannot connect to database

**Solution:**
```bash
# Check if containers are running
docker ps

# Restart containers
npm run docker:reset

# Check logs
npm run docker:logs
```

#### 3. Permission Denied

**Problem:** User doesn't have permissions

**Solution:**
```bash
# Grant superuser permissions
docker exec ankaa-postgres psql -U postgres \
  -c "ALTER USER ankaadesign WITH SUPERUSER;"
```

### Debug Commands

```bash
# Check database connection
docker exec ankaa-postgres pg_isready

# List databases
docker exec ankaa-postgres psql -U ankaadesign -c '\l'

# Check user permissions
docker exec ankaa-postgres psql -U ankaadesign -c '\du'

# Test Redis connection
docker exec ankaa-redis redis-cli ping
```

## Security Recommendations

### ⚠️ CRITICAL SECURITY ISSUES TO FIX

1. **Change Default Passwords**
   ```bash
   # Generate secure passwords
   openssl rand -base64 32
   ```

2. **Different Passwords per Environment**
   - Never use same password for dev/staging/prod
   - Use password managers
   - Rotate credentials regularly

3. **Secure JWT Secrets**
   ```bash
   # Generate JWT secret
   openssl rand -base64 64
   ```

4. **Environment Variables**
   - Never commit .env files
   - Use secrets management in production
   - Audit access logs

5. **Database Security**
   - Enable SSL for production
   - Restrict network access
   - Regular backups
   - Monitor access logs

### Production Checklist

- [ ] Unique, strong passwords for each environment
- [ ] JWT secrets rotated
- [ ] SSL/TLS enabled
- [ ] Firewall configured
- [ ] Backup strategy implemented
- [ ] Monitoring configured
- [ ] Access logs enabled
- [ ] Rate limiting enabled
- [ ] CORS properly configured

## Backup & Recovery

### Manual Backup

```bash
# Backup database
docker exec ankaa-postgres pg_dump -U ankaadesign ankaa_dev > backup.sql

# Restore database
docker exec -i ankaa-postgres psql -U ankaadesign ankaa_dev < backup.sql
```

### Automated Backup Script

```bash
# Run backup script
./scripts/backup-database.sh
```

## Monitoring

### Health Checks

```bash
# API health
curl http://localhost:3030/health

# Database health
docker exec ankaa-postgres pg_isready

# Redis health
docker exec ankaa-redis redis-cli ping
```

### Logs

```bash
# All logs
npm run docker:logs

# PostgreSQL logs
docker logs ankaa-postgres

# Redis logs
docker logs ankaa-redis
```

## Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/documentation)
- [Docker Documentation](https://docs.docker.com/)

## Support

For issues or questions:
1. Check this documentation
2. Review troubleshooting section
3. Check logs: `npm run docker:logs`
4. Create an issue in the repository

---

**Last Updated:** November 2024
**Version:** 1.0.0