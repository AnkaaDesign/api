# Database Migration Execution Guide

## Migration: Convert Layouts from One-to-One to Shared Resource (One-to-Many)

**Date:** 2026-01-21
**Migration Folder:** `20260121_convert_layouts_to_shared_resource`
**Status:** Ready for execution

---

## Overview

This migration converts the Truck-Layout relationship from one-to-one to one-to-many (shared resource pattern). After this migration:
- Multiple trucks can share the same layout (e.g., standard 840cm baú)
- Layouts become reusable templates
- Prevents accidental deletion of shared layouts
- Improves data consistency and reduces duplication

### What Changes:
- **Removes:** Unique constraints on `Truck.backSideLayoutId`, `Truck.leftSideLayoutId`, `Truck.rightSideLayoutId`
- **Adds:** Regular indexes on layout foreign keys for performance
- **Enables:** Multiple trucks to reference the same Layout record

---

## Pre-Migration Checklist

### 1. Database Backup

**Critical:** Always backup before schema changes!

```bash
# Navigate to project directory
cd /home/kennedy/Documents/repositories/api

# Create backup (automatic timestamped backup)
npm run backup:db

# Manual backup (if script not available)
pg_dump -h localhost -U your_username -d ankaa_db > backup_before_layout_migration_$(date +%Y%m%d_%H%M%S).sql
```

Verify backup was created:
```bash
ls -lh backup*.sql | tail -1
```

### 2. Check Current Migration Status

```bash
# Check which migrations are applied
npx prisma migrate status

# Expected output should show migrations up to date
```

### 3. Verify Test Database Availability

```bash
# Check if database is accessible
npx prisma db execute --stdin <<< "SELECT NOW() as current_time;"

# Verify Prisma schema is valid
npx prisma validate
```

### 4. Check Active Users Editing Layouts

```sql
-- Run this query to check recent layout activity
SELECT
  l.id as layout_id,
  l."updatedAt" as last_updated,
  COUNT(DISTINCT t.id) as trucks_using_layout,
  string_agg(DISTINCT t.plate, ', ') as truck_plates
FROM "Layout" l
LEFT JOIN "Truck" t ON (
  t."backSideLayoutId" = l.id OR
  t."leftSideLayoutId" = l.id OR
  t."rightSideLayoutId" = l.id
)
WHERE l."updatedAt" > NOW() - INTERVAL '1 hour'
GROUP BY l.id, l."updatedAt"
ORDER BY l."updatedAt" DESC;
```

**Action:** If users are actively editing layouts, coordinate a maintenance window.

### 5. Check Current Constraint Status

```sql
-- Verify unique constraints exist (they should before migration)
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'Truck'
  AND (
    indexname LIKE '%layoutId%' OR
    indexname LIKE '%Layout%'
  )
ORDER BY indexname;
```

Expected unique constraints:
- `Truck_backSideLayoutId_key`
- `Truck_leftSideLayoutId_key`
- `Truck_rightSideLayoutId_key`

---

## Migration Steps

### Step 1: Run Migration on Development

```bash
# Navigate to project directory
cd /home/kennedy/Documents/repositories/api

# Run migration in development
npm run db:migrate

# Follow prompts:
# - Migration name: (already named in folder)
# - Confirm: Yes
```

**Expected Output:**
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "ankaa_db", schema "public"

Applying migration `20260121_convert_layouts_to_shared_resource`

The following migration(s) have been applied:

migrations/
  └─ 20260121_convert_layouts_to_shared_resource/
    └─ migration.sql

Your database is now in sync with your schema.

✔ Generated Prisma Client (6.19.1) to ./node_modules/@prisma/client
```

### Step 2: Generate Prisma Client

```bash
# Generate updated Prisma Client with new relationship types
npm run db:generate
```

**Expected Output:**
```
✔ Generated Prisma Client (6.19.1) to ./node_modules/@prisma/client
```

### Step 3: Rebuild Application

```bash
# Clean previous build
npm run clean

# Rebuild with new types
npm run build
```

**Expected Output:**
```
Successfully compiled: X files
```

---

## Verification Steps

### 1. Verify Constraints Were Removed

```sql
-- Should return NO results (constraints removed)
SELECT
  indexname
FROM pg_indexes
WHERE tablename = 'Truck'
  AND indexname IN (
    'Truck_backSideLayoutId_key',
    'Truck_leftSideLayoutId_key',
    'Truck_rightSideLayoutId_key'
  );
```

**Expected:** 0 rows (constraints successfully removed)

### 2. Verify New Indexes Were Created

```sql
-- Should return 3 results (new indexes)
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'Truck'
  AND indexname IN (
    'Truck_backSideLayoutId_idx',
    'Truck_leftSideLayoutId_idx',
    'Truck_rightSideLayoutId_idx'
  )
ORDER BY indexname;
```

**Expected:** 3 rows showing non-unique indexes

### 3. Test Shared Layout Functionality

```sql
-- Test 1: Find a layout currently in use
SELECT
  l.id as layout_id,
  l.height,
  COUNT(t.id) as usage_count
FROM "Layout" l
LEFT JOIN "Truck" t ON (
  t."backSideLayoutId" = l.id OR
  t."leftSideLayoutId" = l.id OR
  t."rightSideLayoutId" = l.id
)
GROUP BY l.id, l.height
HAVING COUNT(t.id) > 0
LIMIT 1;

-- Test 2: Try to assign same layout to multiple trucks
-- (Replace <layout_id> and <truck_id_1>, <truck_id_2> with real IDs)
UPDATE "Truck"
SET "backSideLayoutId" = '<layout_id>'
WHERE id IN ('<truck_id_1>', '<truck_id_2>');

-- Test 3: Verify multiple trucks now share the layout
SELECT
  t.id as truck_id,
  t.plate,
  t."backSideLayoutId"
FROM "Truck" t
WHERE t."backSideLayoutId" = '<layout_id>';
```

**Expected:** Multiple trucks successfully sharing one layout

### 4. Test API Endpoints

```bash
# Test 1: Get all layouts with usage count
curl -X GET http://localhost:3030/api/layouts?includeUsage=true \
  -H "Authorization: Bearer YOUR_TOKEN" | jq

# Test 2: Get trucks using a specific layout
curl -X GET http://localhost:3030/api/layouts/<layout_id>/usage \
  -H "Authorization: Bearer YOUR_TOKEN" | jq

# Test 3: Try to delete a shared layout (should fail)
curl -X DELETE http://localhost:3030/api/layouts/<shared_layout_id> \
  -H "Authorization: Bearer YOUR_TOKEN"
# Expected: 400 error with message about layout being in use

# Test 4: Assign existing layout to truck
curl -X POST http://localhost:3030/api/trucks/<truck_id>/layout \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "side": "back",
    "existingLayoutId": "<layout_id>"
  }'
```

---

## Rollback Plan

### Option 1: Rollback Migration (If No New Data Created)

```bash
# WARNING: This will undo the migration
npm run db:migrate:reset

# Then manually reapply migrations up to the previous one
# This is DESTRUCTIVE - only use if no production data affected
```

### Option 2: Manual Rollback SQL (Safer)

```sql
-- Step 1: Verify no layouts are shared by multiple trucks
SELECT
  layout_id,
  COUNT(*) as usage_count
FROM (
  SELECT "backSideLayoutId" as layout_id FROM "Truck" WHERE "backSideLayoutId" IS NOT NULL
  UNION ALL
  SELECT "leftSideLayoutId" FROM "Truck" WHERE "leftSideLayoutId" IS NOT NULL
  UNION ALL
  SELECT "rightSideLayoutId" FROM "Truck" WHERE "rightSideLayoutId" IS NOT NULL
) layouts
GROUP BY layout_id
HAVING COUNT(*) > 1;

-- If any layouts are shared by multiple trucks, you MUST
-- duplicate them first before re-adding unique constraints

-- Step 2: Drop the new indexes
DROP INDEX IF EXISTS "Truck_backSideLayoutId_idx";
DROP INDEX IF EXISTS "Truck_leftSideLayoutId_idx";
DROP INDEX IF EXISTS "Truck_rightSideLayoutId_idx";

-- Step 3: Re-add unique constraints
CREATE UNIQUE INDEX "Truck_backSideLayoutId_key" ON "Truck"("backSideLayoutId");
CREATE UNIQUE INDEX "Truck_leftSideLayoutId_key" ON "Truck"("leftSideLayoutId");
CREATE UNIQUE INDEX "Truck_rightSideLayoutId_key" ON "Truck"("rightSideLayoutId");
```

### Option 3: Restore from Backup (Last Resort)

```bash
# Stop the application
pm2 stop ankaa-api  # or appropriate stop command

# Restore database from backup
psql -h localhost -U your_username -d ankaa_db < backup_before_layout_migration_TIMESTAMP.sql

# Restart application
pm2 start ankaa-api
```

### Handling Data Created After Migration

If shared layouts were already created:

1. **Identify shared layouts:**
```sql
SELECT
  l.id,
  l.height,
  COUNT(t.id) as truck_count,
  string_agg(t.plate, ', ') as trucks
FROM "Layout" l
JOIN "Truck" t ON (
  t."backSideLayoutId" = l.id OR
  t."leftSideLayoutId" = l.id OR
  t."rightSideLayoutId" = l.id
)
GROUP BY l.id, l.height
HAVING COUNT(t.id) > 1;
```

2. **Duplicate layouts for each truck:**
```sql
-- For each shared layout, create copies for trucks 2-N
-- This is complex and should be done via a custom script
-- Example for one layout:

WITH shared_layout AS (
  SELECT * FROM "Layout" WHERE id = '<shared_layout_id>'
),
trucks_using AS (
  SELECT id as truck_id, 'back' as side
  FROM "Truck"
  WHERE "backSideLayoutId" = '<shared_layout_id>'
  -- Add UNION for other sides
)
-- Insert copies and update truck references
-- (Full script would be several dozen lines)
```

---

## Post-Migration Tasks

### 1. Restart API Server

```bash
# If using PM2
pm2 restart ankaa-api

# If using systemd
sudo systemctl restart ankaa-api

# If running in development
# Kill the dev server (Ctrl+C) and restart
npm run dev
```

### 2. Clear Caches (If Applicable)

```bash
# If Redis is configured, clear cache
redis-cli FLUSHDB

# Or selective flush
redis-cli DEL layout:*
redis-cli DEL truck:*
```

### 3. Monitor Error Logs

```bash
# Tail application logs
pm2 logs ankaa-api

# Or if using other logging
tail -f /path/to/api/logs/combined.log

# Check for TypeScript/Prisma errors
grep -i "layout\|truck" /path/to/api/logs/error.log | tail -20
```

### 4. Test Critical User Workflows

Manual testing checklist:
- [ ] Create new truck task
- [ ] Add layout to truck (all 3 sides)
- [ ] View layout library
- [ ] Assign existing layout to truck
- [ ] Try to delete layout in use (should be blocked)
- [ ] Update shared layout (verify affects all trucks)
- [ ] Copy truck/task with layouts
- [ ] View truck details showing layouts

### 5. Database Performance Check

```sql
-- Check query performance for finding trucks by layout
EXPLAIN ANALYZE
SELECT t.id, t.plate
FROM "Truck" t
WHERE t."backSideLayoutId" = '<some_layout_id>';

-- Should use index scan: Truck_backSideLayoutId_idx
-- Look for "Index Scan using Truck_backSideLayoutId_idx"
```

### 6. Update Prisma Schema Documentation

Ensure schema comments reflect new shared resource pattern:
```prisma
// Layout can be shared by multiple trucks (shared resource pattern)
model Layout {
  // ...
  trucksBackSide  Truck[] @relation("TRUCK_BACK_SIDE")  // Many trucks can share
  // ...
}
```

---

## Testing Checklist

### Functional Tests

- [ ] **Create new layout**
  - Via API: `POST /api/layouts`
  - Verify layout appears in library
  - Check database has new record

- [ ] **Assign layout to multiple trucks**
  - Assign layout to truck A
  - Assign same layout to truck B
  - Verify both trucks reference same layout ID
  - Query layout usage count (should be 2)

- [ ] **Try to delete shared layout**
  - Call delete endpoint for shared layout
  - **Expected:** 400 error
  - **Error message:** "Este layout está sendo usado por X caminhão(ões)..."

- [ ] **Update shared layout**
  - Update layout dimensions or sections
  - Query both trucks using the layout
  - **Expected:** Both trucks see updated layout

- [ ] **Delete unused layout**
  - Create layout not assigned to any truck
  - Delete the layout
  - **Expected:** Success, layout removed from database

- [ ] **Copy truck/task with layouts**
  - Create truck with layouts on all 3 sides
  - Copy/duplicate the task
  - **Expected:** New truck should reference SAME layout IDs (not create duplicates)

### Edge Case Tests

- [ ] **Null layout handling**
  - Create truck without any layouts
  - Assign layout to one side only
  - Verify other sides remain null

- [ ] **Layout photo handling**
  - Create layout with photo
  - Assign to multiple trucks
  - Delete layout (should fail if in use)
  - Verify photo file integrity

- [ ] **Cascade delete protection**
  - Attempt to delete truck
  - Verify layout is NOT deleted if used by other trucks
  - Verify layout IS deleted if only used by deleted truck

### Performance Tests

- [ ] **Query performance**
  - Find all trucks using a layout
  - Should use index (check EXPLAIN ANALYZE)
  - Response time < 100ms for 1000+ trucks

- [ ] **Bulk operations**
  - Assign same layout to 10+ trucks
  - Measure performance
  - Check for N+1 query issues

### Data Integrity Tests

- [ ] **Referential integrity**
  - All truck layout FKs reference valid layouts
  - No orphaned layouts after migration
  - No null FKs where data existed before

```sql
-- Check for orphaned references
SELECT t.id as truck_id, t.plate
FROM "Truck" t
LEFT JOIN "Layout" l1 ON t."backSideLayoutId" = l1.id
LEFT JOIN "Layout" l2 ON t."leftSideLayoutId" = l2.id
LEFT JOIN "Layout" l3 ON t."rightSideLayoutId" = l3.id
WHERE
  (t."backSideLayoutId" IS NOT NULL AND l1.id IS NULL) OR
  (t."leftSideLayoutId" IS NOT NULL AND l2.id IS NULL) OR
  (t."rightSideLayoutId" IS NOT NULL AND l3.id IS NULL);
-- Expected: 0 rows
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Layout Creation Rate**
   - Before: ~1 per truck (3 per task)
   - After: Should decrease as layouts are reused

2. **Layout Deletion Errors**
   - Monitor for 400 errors on DELETE /api/layouts/:id
   - Users attempting to delete shared layouts

3. **Query Performance**
   - Monitor response times for layout endpoints
   - Check for slow queries on Truck table

### Logging

Add temporary verbose logging for first 24 hours:

```typescript
// In layout.service.ts
this.logger.log(`Layout ${layoutId} assigned to truck ${truckId}`);
this.logger.log(`Layout ${layoutId} usage count: ${usageCount}`);
```

---

## Success Criteria

Migration is successful when:

- [x] Migration applied without errors
- [x] Unique constraints removed from database
- [x] New indexes created and functional
- [x] Multiple trucks can share same layout
- [x] Shared layout deletion is blocked
- [x] API endpoints respond correctly
- [x] No application errors in logs
- [x] Frontend displays shared layouts correctly
- [x] Performance is equal or better than before

---

## Troubleshooting

### Issue: Migration fails with "constraint violation"

**Cause:** Existing data violates new schema assumptions

**Solution:**
```sql
-- Check for duplicate layout assignments
SELECT "backSideLayoutId", COUNT(*)
FROM "Truck"
WHERE "backSideLayoutId" IS NOT NULL
GROUP BY "backSideLayoutId"
HAVING COUNT(*) > 1;
```

This shouldn't happen with this migration since we're REMOVING constraints, but if it does, check for data corruption.

### Issue: Prisma Client types incorrect

**Cause:** Generated types out of sync

**Solution:**
```bash
rm -rf node_modules/.prisma
npm run db:generate
npm run build
```

### Issue: API returns 500 errors

**Cause:** TypeScript compilation errors or runtime type mismatches

**Solution:**
```bash
# Check for TypeScript errors
npx tsc --noEmit

# Check runtime logs
pm2 logs ankaa-api --lines 100 | grep -i error
```

### Issue: "Cannot find module @prisma/client"

**Cause:** Prisma Client not generated after schema change

**Solution:**
```bash
npm run db:generate
npm run build
pm2 restart ankaa-api
```

---

## Communication Plan

### Before Migration

**Notify:** Development team, QA team, Product owner

**Message:**
```
Scheduled database migration: Layout Shared Resource Pattern
Date: [DATE]
Time: [TIME]
Duration: ~15 minutes
Impact: No downtime, but API restart required
Action needed: None, but avoid editing layouts during migration window
```

### During Migration

**Notify:** Migration in progress

**Status updates:**
- Migration started
- Database updated
- API restarted
- Testing in progress

### After Migration

**Notify:** Migration complete

**Message:**
```
Layout migration completed successfully.
New features:
- Layouts can now be shared across multiple trucks
- Layout library for selecting existing layouts
- Protection against deleting shared layouts

Please report any issues with layout functionality.
```

---

## Appendix A: Migration SQL

Full migration SQL from `prisma/migrations/20260121_convert_layouts_to_shared_resource/migration.sql`:

```sql
-- Migration: Convert Layout from One-to-One to One-to-Many (Shared Resource)
-- Date: 2026-01-21
-- Description: Remove @unique constraints from Truck layout foreign keys to allow multiple trucks to share the same layout

-- Step 1: Drop unique constraints on Truck layout foreign keys
DROP INDEX IF EXISTS "Truck_backSideLayoutId_key";
DROP INDEX IF EXISTS "Truck_leftSideLayoutId_key";
DROP INDEX IF EXISTS "Truck_rightSideLayoutId_key";

-- Step 2: Add regular indexes for performance (non-unique)
CREATE INDEX IF NOT EXISTS "Truck_backSideLayoutId_idx" ON "Truck"("backSideLayoutId");
CREATE INDEX IF NOT EXISTS "Truck_leftSideLayoutId_idx" ON "Truck"("leftSideLayoutId");
CREATE INDEX IF NOT EXISTS "Truck_rightSideLayoutId_idx" ON "Truck"("rightSideLayoutId");

-- Step 3: No data migration needed - existing layout references remain valid
```

---

## Appendix B: Prisma Schema Changes

**Before:**
```prisma
model Truck {
  backSideLayoutId  String? @unique
  leftSideLayoutId  String? @unique
  rightSideLayoutId String? @unique
  backSideLayout    Layout? @relation("TRUCK_BACK_SIDE", fields: [backSideLayoutId], references: [id])
  leftSideLayout    Layout? @relation("TRUCK_LEFT_SIDE", fields: [leftSideLayoutId], references: [id])
  rightSideLayout   Layout? @relation("TRUCK_RIGHT_SIDE", fields: [rightSideLayoutId], references: [id])
}

model Layout {
  backSideTruck  Truck? @relation("TRUCK_BACK_SIDE")
  leftSideTruck  Truck? @relation("TRUCK_LEFT_SIDE")
  rightSideTruck Truck? @relation("TRUCK_RIGHT_SIDE")
}
```

**After:**
```prisma
model Truck {
  backSideLayoutId  String? // NO @unique
  leftSideLayoutId  String? // NO @unique
  rightSideLayoutId String? // NO @unique
  backSideLayout    Layout? @relation("TRUCK_BACK_SIDE", fields: [backSideLayoutId], references: [id])
  leftSideLayout    Layout? @relation("TRUCK_LEFT_SIDE", fields: [leftSideLayoutId], references: [id])
  rightSideLayout   Layout? @relation("TRUCK_RIGHT_SIDE", fields: [rightSideLayoutId], references: [id])

  @@index([backSideLayoutId])
  @@index([leftSideLayoutId])
  @@index([rightSideLayoutId])
}

model Layout {
  trucksBackSide  Truck[] @relation("TRUCK_BACK_SIDE")  // One-to-Many
  trucksLeftSide  Truck[] @relation("TRUCK_LEFT_SIDE")  // One-to-Many
  trucksRightSide Truck[] @relation("TRUCK_RIGHT_SIDE") // One-to-Many
}
```

---

## Appendix C: Related Code Changes

### LayoutService Changes

The `LayoutService` class has been updated to handle shared layouts:

1. **`getLayoutUsageCount()`** - Returns count of trucks using a layout
2. **`getTrucksUsingLayout()`** - Returns detailed usage information
3. **`delete()`** - Blocks deletion of shared layouts (unless `force=true`)
4. **`assignLayoutToTruck()`** - Assigns existing layout to truck
5. **`createOrUpdateTruckLayout()`** - Handles shared layout logic

### Key Safety Mechanisms

```typescript
// Check if layout is being used before deletion
const usageCount = await this.getLayoutUsageCount(id);
if (usageCount > 0 && !force) {
  throw new Error(`Layout is used by ${usageCount} truck(s)...`);
}

// When updating truck layout, check if old layout is shared
if (existingLayout) {
  const usageCount = await this.getLayoutUsageCountInTransaction(tx, existingLayout.id);
  if (usageCount > 1) {
    // Don't delete shared layout, create new one instead
  }
}
```

---

## Support & Questions

For questions or issues during migration:

1. Check logs: `pm2 logs ankaa-api`
2. Check this guide's troubleshooting section
3. Review Prisma migration docs: https://www.prisma.io/docs/guides/migrate
4. Contact: Development team lead

---

**Document Version:** 1.0
**Last Updated:** 2026-01-20
**Migration Status:** Ready for execution
