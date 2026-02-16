# Production Database Setup Instructions

## Overview

Restore the database from a fully up-to-date backup. The backup already includes:
- All schema changes (representatives, pricing, inventory analytics, PPE cleanup, etc.)
- 10 Prisma migrations registered (0_init + 9 new)
- 113 notification configurations
- 8 feature announcement messages with sector targeting
- All data migrations applied (negotiatingWith → Representatives, invoiceToId → many-to-many, etc.)

**No consolidation scripts or seeds needed — everything is in the backup.**

---

## Prerequisites

1. The backup file: `backup_1771213535.sql.gz` (in this directory)
2. PostgreSQL 16+ installed

---

## Step 1: Restore the Backup

```bash
# Create a fresh database (or drop and recreate)
psql -U ankaa_prod -d postgres -c "DROP DATABASE IF EXISTS ankaa_production;"
psql -U ankaa_prod -d postgres -c "CREATE DATABASE ankaa_production OWNER ankaa_prod;"

# Decompress and restore
gunzip -k backup_1771213535.sql.gz
psql -U ankaa_prod -d ankaa_production < backup_1771213535.sql
```

---

## Step 2: Validate Schema with Prisma

```bash
cd /path/to/api

# Set DATABASE_URL to point to the production database
export DATABASE_URL="postgresql://ankaa_prod:PASSWORD@HOST:5432/ankaa_production?schema=public"

npx prisma validate
npx prisma migrate status
```

Expected output: `Database schema is up to date!`

---

## Step 3: Final Verification

```bash
psql -U ankaa_prod -d ankaa_production -c "
SELECT 'Migrations' as check, COUNT(*) as value FROM _prisma_migrations
UNION ALL SELECT 'Representatives', COUNT(*) FROM \"Representative\"
UNION ALL SELECT 'NotificationConfigurations', COUNT(*) FROM \"NotificationConfiguration\"
UNION ALL SELECT 'Feature Messages', COUNT(*) FROM \"Message\"
UNION ALL SELECT 'Notifications (should be 0)', COUNT(*) FROM \"Notification\"
ORDER BY check;
"
```

Expected:
| check | value |
|-------|-------|
| Feature Messages | 8 |
| Migrations | 10 |
| NotificationConfigurations | 113 |
| Notifications (should be 0) | 0 |
| Representatives | ~27 |

---

## Rollback

To start over, drop and restore:

```bash
psql -U ankaa_prod -d postgres -c "DROP DATABASE ankaa_production;"
psql -U ankaa_prod -d postgres -c "CREATE DATABASE ankaa_production OWNER ankaa_prod;"
gunzip -k backup_1771213535.sql.gz
psql -U ankaa_prod -d ankaa_production < backup_1771213535.sql
```
