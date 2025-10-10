# CSV Migration Guide - MongoDB to PostgreSQL

This guide provides detailed instructions for migrating historical data from CSV files (exported from MongoDB) to the new PostgreSQL database.

## 📋 Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [What Gets Migrated](#what-gets-migrated)
- [What Gets Preserved](#what-gets-preserved)
- [Execution Steps](#execution-steps)
- [Validation](#validation)
- [Troubleshooting](#troubleshooting)
- [Rollback](#rollback)

## 🎯 Overview

The migration script (`migrate-from-csv.ts`) safely imports historical data from CSV files while preserving existing production data in PostgreSQL.

**Key Features:**
- ✅ Preserves all production users, positions, sectors
- ✅ Maintains referential integrity with ID mapping
- ✅ Handles duplicate detection and skipping
- ✅ Provides detailed progress logging
- ✅ Supports dry-run mode for validation
- ✅ Transaction-safe operations
- ✅ Comprehensive error handling

## 📦 Prerequisites

### 1. Install Dependencies

The script requires the following packages:

```bash
cd /home/kennedy/ankaa/apps/api

# Install required dependencies
npm install papaparse @types/papaparse uuid @types/uuid
```

### 2. Verify CSV Files

Ensure CSV files are present at: `/home/kennedy/ankaa/ankaa_db/`

Required files:
- ✅ `brands.csv` (514 records)
- ✅ `items.csv` (597 records)
- ✅ `suppliers.csv` (39 records)
- ✅ `colors.csv` (453 records)
- ✅ `orders.csv` (173 records)
- ✅ `activities.csv` (13,663 records)
- ✅ `works.csv` (1,521 records)

Optional files (not used - production data preserved):
- `users.csv` - Used only for ID mapping
- `positions.csv` - Not migrated
- `employees.csv` - Not migrated

### 3. Database Connection

Ensure PostgreSQL is running and accessible:

```bash
# Check database connection
psql postgresql://docker:docker@localhost:5432/ankaa -c "SELECT version();"
```

Verify `.env` file contains:
```env
DATABASE_URL="postgresql://docker:docker@localhost:5432/ankaa"
```

### 4. Backup Production Database

**CRITICAL: Always backup before migration!**

```bash
# Create backup
pg_dump postgresql://docker:docker@localhost:5432/ankaa > ankaa_backup_$(date +%Y%m%d_%H%M%S).sql

# Or use the provided backup script
cd /home/kennedy/ankaa/apps/api
./scripts/create-snapshot.sh
```

## 📊 What Gets Migrated

### From CSV Files:

| CSV File | Target Tables | Records | Dependencies |
|----------|--------------|---------|--------------|
| `brands.csv` | ItemBrand | ~514 | None |
| `suppliers.csv` | Supplier | ~39 | None |
| `items.csv` | Item, Price | ~597 | ItemBrand, Supplier |
| `colors.csv` | Paint, PaintFormula, PaintFormulaComponent | ~453 | Item (for components) |
| `orders.csv` | Order, OrderItem | ~173 | Item, Supplier |
| `activities.csv` | Activity | ~13,663 | Item, User |
| `works.csv` | Task, ServiceOrder | ~1,521 | Paint, User |

### Migration Flow:

```
1. Build User ID Map (from production)
   ↓
2. Migrate ItemBrand (independent)
   ↓
3. Migrate Supplier (independent)
   ↓
4. Migrate Item + Price (depends on ItemBrand, Supplier)
   ↓
5. Migrate Paint + Formula + Components (depends on Item)
   ↓
6. Migrate Order + OrderItem (depends on Item, Supplier)
   ↓
7. Migrate Activity (depends on Item, User)
   ↓
8. Migrate Task + ServiceOrder (depends on Paint, User)
```

## 🔒 What Gets Preserved

**These production tables are NOT modified:**

- ✅ **User** (68 users) - All existing users preserved
- ✅ **Position** (17 positions) - All position data preserved
- ✅ **Sector** (8 sectors) - All sector data preserved
- ✅ **MonetaryValue** (383 records) - Position remunerations preserved
- ✅ **PpeSize** - User PPE configurations preserved
- ✅ **Preferences** - User preferences preserved
- ✅ **ChangeLog** - Audit history preserved

The script only reads User table to map old MongoDB IDs to current PostgreSQL UUIDs.

## 🚀 Execution Steps

### Step 1: Dry Run (Recommended)

First, run in dry-run mode to validate the migration without making changes:

```bash
cd /home/kennedy/ankaa/apps/api

# Dry run - validates without changes
npx ts-node scripts/migrate-from-csv.ts --dry-run
```

**Expected output:**
```
🚀 CSV MIGRATION SCRIPT - MongoDB to PostgreSQL
================================================
Mode: 🔍 DRY RUN
CSV Directory: /home/kennedy/ankaa/ankaa_db
Database: localhost:5432/ankaa
================================================

🔍 Step 1: Building User ID Map from Production
================================================
📂 Parsed users.csv: 68 records
📊 CSV Users: 68
📊 Production Users: 68
   ✓ Mapped: Kennedy Campos (65c11fe18fada6df48f43805) → uuid-here
   ...
✅ Mapped 68/68 users

📦 Step 2: Migrating Item Brands
================================================
📂 Parsed brands.csv: 514 records
🔍 DRY RUN: Would migrate 514 brands
...
```

Review the output carefully. Check for:
- ✅ All CSV files parsed successfully
- ✅ User mapping completed
- ✅ No critical errors

### Step 2: Live Migration

If dry run looks good, execute the actual migration:

```bash
cd /home/kennedy/ankaa/apps/api

# Live migration
npx ts-node scripts/migrate-from-csv.ts
```

**The script will:**
1. Map production users to old MongoDB IDs
2. Migrate brands (create or skip existing)
3. Migrate suppliers (create or skip existing)
4. Migrate items + prices
5. Migrate paints + formulas + components
6. Migrate orders + order items
7. Migrate activities
8. Migrate tasks + services

**Progress output:**
```
📦 Step 2: Migrating Item Brands
================================================
📂 Parsed brands.csv: 514 records
   ItemBrand: 50/514 (9.7%)
   ItemBrand: 100/514 (19.5%)
   ...
   ItemBrand: 514/514 (100.0%)
✅ ItemBrand Migration Complete: 512 created, 2 skipped
```

### Step 3: Review Statistics

At the end, the script prints detailed statistics:

```
📊 MIGRATION STATISTICS
============================================================

ItemBrand:
  Total:   514
  Success: 512
  Skipped: 2
  Failed:  0

Item:
  Total:   597
  Success: 589
  Skipped: 8
  Failed:  0

Activity:
  Total:   13663
  Success: 13450
  Skipped: 213
  Failed:  0
  Errors (showing first 5):
    - Failed to migrate activity: Item not found

...

✅ Total Success: 17234
⚠️  Total Skipped: 223
❌ Total Failed:  0

⏱️  Migration completed in 125.43 seconds
```

## ✅ Validation

After migration, run validation queries to ensure data integrity:

```bash
cd /home/kennedy/ankaa/apps/api

# Run validation script
npx ts-node scripts/validate-migration.ts
```

Or manually check:

```sql
-- Check record counts
SELECT 'ItemBrand' as table_name, COUNT(*) as count FROM "ItemBrand"
UNION ALL
SELECT 'Item', COUNT(*) FROM "Item"
UNION ALL
SELECT 'Supplier', COUNT(*) FROM "Supplier"
UNION ALL
SELECT 'Paint', COUNT(*) FROM "Paint"
UNION ALL
SELECT 'Order', COUNT(*) FROM "Order"
UNION ALL
SELECT 'OrderItem', COUNT(*) FROM "OrderItem"
UNION ALL
SELECT 'Activity', COUNT(*) FROM "Activity"
UNION ALL
SELECT 'Task', COUNT(*) FROM "Task"
UNION ALL
SELECT 'ServiceOrder', COUNT(*) FROM "ServiceOrder";

-- Check for orphaned relations
SELECT COUNT(*) as orphaned_items
FROM "Item" i
LEFT JOIN "ItemBrand" b ON i."brandId" = b.id
WHERE i."brandId" IS NOT NULL AND b.id IS NULL;

-- Check activity references
SELECT COUNT(*) as activities_with_items
FROM "Activity" a
INNER JOIN "Item" i ON a."itemId" = i.id;

-- Check user preservation
SELECT COUNT(*) as user_count FROM "User";
-- Should return: 68 (unchanged)

SELECT COUNT(*) as position_count FROM "Position";
-- Should return: 17 (unchanged)

SELECT COUNT(*) as sector_count FROM "Sector";
-- Should return: 8 (unchanged)
```

## 🔧 Troubleshooting

### Issue: "File not found" error

**Solution:** Verify CSV directory path in script matches your setup:
```typescript
const CSV_DIR = '/home/kennedy/ankaa/ankaa_db';
```

### Issue: "Connection refused" error

**Solution:** Ensure PostgreSQL is running:
```bash
docker ps | grep postgres
# Or
sudo systemctl status postgresql
```

### Issue: Duplicate key errors

**Solution:** The script handles duplicates automatically. If you see persistent errors:
```bash
# Check for existing data
psql postgresql://docker:docker@localhost:5432/ankaa

# Example: Check existing brands
SELECT name FROM "ItemBrand" WHERE name = 'BrandName';
```

### Issue: User mapping failures

**Solution:** Check if production users match CSV users:
```sql
-- Compare emails
SELECT email FROM "User" ORDER BY email;
```

Update user emails in production to match CSV if needed.

### Issue: Foreign key violations

**Solution:** This usually means dependencies weren't migrated first. The script handles this by:
1. Checking if referenced entity exists
2. Skipping if not found
3. Logging the error

Review error logs to see which records were skipped.

### Issue: Out of memory

**Solution:** For large CSV files, modify batch size:
```typescript
// In migrateActivities function, add batching:
if (i % 1000 === 0) {
  await new Promise(resolve => setTimeout(resolve, 100));
}
```

## 🔄 Rollback

If migration fails or produces incorrect results:

### Option 1: Restore from Backup

```bash
# Drop current database
psql postgresql://docker:docker@localhost:5432/postgres -c "DROP DATABASE ankaa;"

# Recreate database
psql postgresql://docker:docker@localhost:5432/postgres -c "CREATE DATABASE ankaa;"

# Restore from backup
psql postgresql://docker:docker@localhost:5432/ankaa < ankaa_backup_YYYYMMDD_HHMMSS.sql
```

### Option 2: Selective Deletion

If only some entities need to be removed:

```sql
-- Delete migrated data (preserve production data)
-- Example: Delete all items without a supplier
DELETE FROM "Item" WHERE "supplierId" IS NULL;

-- Or delete by date range
DELETE FROM "Activity" WHERE "createdAt" < '2024-01-01';
```

### Option 3: Re-run Migration

The script is idempotent - it skips existing records. You can safely re-run after fixing issues:

```bash
# Fix the issue in CSV or script
# Then re-run
npx ts-node scripts/migrate-from-csv.ts
```

## 📝 Notes

### Performance Considerations

- **Expected duration:** 2-5 minutes for full migration
- **Bottleneck:** Activity table (13,663 records)
- **Optimization:** Uses batch operations where possible

### Data Quality

- **Name normalization:** All names are trimmed and cleaned
- **Date parsing:** Handles multiple date formats
- **Number parsing:** Defaults to 0 for invalid numbers
- **Boolean parsing:** Handles 'true', '1', 'yes'

### ID Mapping Strategy

The script maintains a Map of old MongoDB IDs to new PostgreSQL UUIDs:

```typescript
idMaps.items.set('65e87b66cb7a1ff3d9a823cc', 'uuid-v4-here');
```

This ensures referential integrity across all tables.

### Duplicate Handling

- **By unique fields:** Checks for existing records before creation
- **Skip strategy:** Existing records are skipped, not updated
- **Logging:** All skips are logged in statistics

## 🆘 Support

If you encounter issues:

1. Check the error messages in the statistics output
2. Review the validation queries
3. Check database constraints: `\d+ "TableName"` in psql
4. Review Prisma schema for required fields

For additional help, review:
- `/home/kennedy/ankaa/apps/api/prisma/schema.prisma` - Database schema
- `/home/kennedy/ankaa/apps/api/scripts/migrate-from-csv.ts` - Migration script
- `/home/kennedy/ankaa/apps/api/scripts/validate-migration.ts` - Validation queries

## ✅ Success Criteria

Migration is successful when:

- ✅ All CSV files parsed without errors
- ✅ All expected records migrated (check statistics)
- ✅ No foreign key violations
- ✅ Production users preserved (68 users)
- ✅ Production positions preserved (17 positions)
- ✅ Production sectors preserved (8 sectors)
- ✅ Validation queries pass
- ✅ Application starts without errors

## 🎉 Post-Migration

After successful migration:

1. **Test the application:**
   ```bash
   cd /home/kennedy/ankaa/apps/api
   npm run dev
   ```

2. **Verify data in UI:**
   - Check items list
   - Check orders list
   - Check tasks list
   - Check activities/history

3. **Monitor logs:**
   - Watch for any errors
   - Check for missing data

4. **Update documentation:**
   - Document migration date
   - Note any data discrepancies
   - Update team on changes

5. **Archive CSV files:**
   ```bash
   tar -czf ankaa_db_backup_$(date +%Y%m%d).tar.gz /home/kennedy/ankaa/ankaa_db/
   ```

Good luck! 🚀
