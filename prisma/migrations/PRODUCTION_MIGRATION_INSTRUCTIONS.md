# Production Backup Migration Instructions

## Overview

This guide migrates the production database from the backup state (19 old migrations through `20260130`) to the current schema (squashed `0_init` + 9 new migrations).

**What this does:**
- Creates the Representative system (migrating `negotiatingWith` JSONB data)
- Adds `commissionOrder`, `stateRegistration`, `discountReference`, `simultaneousTasks` columns
- Migrates `invoiceToId` to many-to-many `_TaskPricingInvoiceTo`
- Copies `User.admissional` → `exp1StartAt` then drops the column
- Transforms `NotificationType` enum (20 values → 5)
- Truncates all notification data (redesigned system)
- Creates notification configuration tables
- Adds inventory analytics (`ConsumptionSnapshot`, item deactivation fields)
- Creates `_TASK_BANK_SLIPS` join table
- Removes dead PPE delivery fields (`signatureBatchId`, `clicksignRequestKey`)
- Notification configurations and feature messages are already in the backup (seeded prior to backup)

---

## Prerequisites

1. The production backup file: `backup_1771205783046_wz36fa.sql`
2. PostgreSQL 16+ installed
3. The API codebase at the current commit (with all migration files)

---

## Step 1: Restore the Backup

```bash
# Create a fresh database (or drop and recreate)
psql -U ankaa_prod -d postgres -c "DROP DATABASE IF EXISTS ankaa_production;"
psql -U ankaa_prod -d postgres -c "CREATE DATABASE ankaa_production OWNER ankaa_prod;"

# Restore the backup
psql -U ankaa_prod -d ankaa_production < backup_1771205783046_wz36fa.sql
```

**Verify:** Should show 19 migrations applied:
```bash
psql -U ankaa_prod -d ankaa_production -c "SELECT COUNT(*) FROM _prisma_migrations;"
# Expected: 19
```

---

## Step 2: Run the Consolidated Migration

```bash
cd /path/to/api
psql -U ankaa_prod -d ankaa_production < prisma/migrations/consolidate_backup.sql
```

This runs inside a single transaction. If anything fails, the entire migration is rolled back.

**Verify:**
```bash
psql -U ankaa_prod -d ankaa_production -c "
SELECT 'Migrations' as check, COUNT(*) as value FROM _prisma_migrations
UNION ALL SELECT 'Representatives', COUNT(*) FROM \"Representative\"
UNION ALL SELECT '_TaskRepresentatives', COUNT(*) FROM \"_TaskRepresentatives\"
UNION ALL SELECT 'Notifications (should be 0)', COUNT(*) FROM \"Notification\"
UNION ALL SELECT '_TaskPricingInvoiceTo', COUNT(*) FROM \"_TaskPricingInvoiceTo\"
ORDER BY check;
"
```

Expected:
| check | value |
|-------|-------|
| Migrations | 10 |
| Representatives | ~27 |
| _TaskRepresentatives | ~74 |
| Notifications (should be 0) | 0 |
| _TaskPricingInvoiceTo | ~24 |

---

## Step 3: Validate Schema with Prisma

```bash
cd /path/to/api

# Set DATABASE_URL to point to the production database
export DATABASE_URL="postgresql://ankaa_prod:PASSWORD@HOST:5432/ankaa_production?schema=public"

npx prisma validate
npx prisma migrate status
```

Expected output: `Database schema is up to date!`

---

## Step 4: Final Verification

Run the full check:

```bash
psql -U ankaa_prod -d ankaa_production -c "
-- Schema checks
SELECT 'Task.negotiatingWith dropped' as check,
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'negotiatingWith') as ok
UNION ALL
SELECT 'Task.invoiceToId dropped',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'invoiceToId')
UNION ALL
SELECT 'User.admissional dropped',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'admissional')
UNION ALL
SELECT 'Task.commissionOrder exists',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Task' AND column_name = 'commissionOrder')
UNION ALL
SELECT 'Customer.stateRegistration exists',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Customer' AND column_name = 'stateRegistration')
UNION ALL
SELECT 'Representative table exists',
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Representative')
UNION ALL
SELECT 'NotificationConfiguration table exists',
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'NotificationConfiguration')
UNION ALL
SELECT 'ConsumptionSnapshot table exists',
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ConsumptionSnapshot')
UNION ALL
SELECT 'PpeDelivery.signatureBatchId dropped',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PpeDelivery' AND column_name = 'signatureBatchId')
UNION ALL
SELECT 'PpeDelivery.clicksignRequestKey dropped',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PpeDelivery' AND column_name = 'clicksignRequestKey')
ORDER BY check;
"
```

All checks should return `ok = true`.

---

## Data Migration Summary

| Data | Action | Count |
|------|--------|-------|
| `Task.negotiatingWith` | → `Representative` + `_TaskRepresentatives` | ~27 reps, ~74 links |
| `Task.invoiceToId` | → `_TaskPricingInvoiceTo` | ~24 records |
| `User.admissional` | → `User.exp1StartAt` | ~40 users |
| `Task.commissionOrder` | Backfilled from `commission` status | all tasks |
| Notifications | Truncated (redesigned system) | ~54k deleted |
| `NotificationType` | 20 values → 5 values | enum transformed |
| `PpeDelivery.signatureBatchId` | Dropped (never used) | column removed |
| `PpeDelivery.clicksignRequestKey` | Dropped (never read) | column removed |

---

## Rollback

If anything goes wrong, the consolidated migration runs in a transaction and will auto-rollback on error. To start over:

```bash
psql -U ankaa_prod -d postgres -c "DROP DATABASE ankaa_production;"
psql -U ankaa_prod -d postgres -c "CREATE DATABASE ankaa_production OWNER ankaa_prod;"
psql -U ankaa_prod -d ankaa_production < backup_1771205783046_wz36fa.sql
```

---

## Notes

- 2 tasks had `negotiatingWith` data with `phone: null` — these were skipped since Representative requires a phone
- Broadcast messages (targets = ALL) have an empty targets array; the app treats this as visible to everyone
- The `_prisma_migrations` table is cleaned: old 18 entries removed, 9 new entries added, keeping `0_init`
- The migration adds `IF NOT EXISTS` / `IF EXISTS` guards where safe to make it re-runnable for some steps
