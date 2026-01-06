# Database Migration Instructions for Task Field Tracking

## Overview

This migration adds the `TaskFieldChangeLog` table and updates the `Task` and `User` models to support field-level change tracking.

## Changes to Schema

### New Model: TaskFieldChangeLog

- Tracks all field-level changes for tasks
- Stores old and new values
- Special support for file array changes
- Indexed for performance

### Updated Models

- `Task`: Added `fieldChangeLogs` relation
- `User`: Added `taskFieldChangeLogs` relation

## Migration Steps

### Development Environment

```bash
cd /home/kennedy/Documents/repositories/api

# Format the Prisma schema (already done)
npx prisma format

# Generate Prisma client with new models
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name add_task_field_change_log

# Verify migration
npx prisma migrate status
```

### Production Environment

```bash
cd /home/kennedy/Documents/repositories/api

# Review the migration SQL
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma \
  --script

# Apply migration
npx prisma migrate deploy

# Verify
npx prisma migrate status
```

## Expected SQL

The migration should create approximately the following SQL:

```sql
-- CreateTable
CREATE TABLE "TaskFieldChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFileArray" BOOLEAN NOT NULL DEFAULT false,
    "filesAdded" INTEGER NOT NULL DEFAULT 0,
    "filesRemoved" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    CONSTRAINT "TaskFieldChangeLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskFieldChangeLog_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User" ("id") ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TaskFieldChangeLog_taskId_idx" ON "TaskFieldChangeLog"("taskId");

-- CreateIndex
CREATE INDEX "TaskFieldChangeLog_field_idx" ON "TaskFieldChangeLog"("field");

-- CreateIndex
CREATE INDEX "TaskFieldChangeLog_changedAt_idx" ON "TaskFieldChangeLog"("changedAt");

-- CreateIndex
CREATE INDEX "TaskFieldChangeLog_changedBy_idx" ON "TaskFieldChangeLog"("changedBy");

-- CreateIndex
CREATE INDEX "TaskFieldChangeLog_taskId_field_idx" ON "TaskFieldChangeLog"("taskId", "field");
```

## Verification

After migration, verify the table exists:

```bash
# Using Prisma Studio
npx prisma studio

# Or using psql
psql -d your_database_name -c "\d TaskFieldChangeLog"
```

## Rollback (if needed)

If you need to rollback:

```bash
# Development
npx prisma migrate reset

# Production (manual SQL)
DROP TABLE "TaskFieldChangeLog";
```

## Post-Migration Tasks

1. Restart the application to load new Prisma client
2. Monitor logs for any field tracking errors
3. Test task updates to verify changes are being tracked
4. Check notifications for field change events

## Testing the Migration

```typescript
// Test query
const changes = await prisma.taskFieldChangeLog.findMany({
  take: 10,
  orderBy: { changedAt: 'desc' },
  include: {
    task: { select: { name: true } },
    user: { select: { name: true } },
  },
});

console.log('Recent field changes:', changes);
```

## Notes

- The migration is safe and non-destructive (only adds new table)
- Existing task data is not affected
- Foreign keys use CASCADE delete for cleanup
- All indexes are created for optimal query performance
- JSON columns use appropriate database type (JSONB in PostgreSQL)

## Support

If you encounter issues:
1. Check Prisma schema syntax: `npx prisma validate`
2. Review migration logs
3. Verify database permissions
4. Check for conflicting migrations
