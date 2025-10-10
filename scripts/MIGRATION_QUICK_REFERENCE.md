# CSV Migration Quick Reference

## 🚀 Quick Start

```bash
cd /home/kennedy/ankaa/apps/api

# 1. Backup database (CRITICAL!)
pg_dump postgresql://docker:docker@localhost:5432/ankaa > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Dry run (validate without changes)
npm run migrate:csv:dry

# 3. Run migration
npm run migrate:csv

# 4. Validate results
npm run validate:migration
```

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run migrate:csv` | Execute CSV migration (LIVE) |
| `npm run migrate:csv:dry` | Validate migration without changes (DRY RUN) |
| `npm run validate:migration` | Run validation checks after migration |

## 📊 Expected Results

### Record Counts

| Entity | Expected | CSV Source |
|--------|----------|------------|
| ItemBrand | ~514 | brands.csv |
| Supplier | ~39 | suppliers.csv |
| Item | ~597 | items.csv |
| Price | ~597 | items.csv (price field) |
| Paint | ~453 | colors.csv |
| PaintFormula | ~300-450 | colors.csv (formula arrays) |
| PaintFormulaComponent | ~1000-2000 | colors.csv (components) |
| Order | ~173 | orders.csv |
| OrderItem | ~800-1000 | orders.csv (items arrays) |
| Activity | ~13,663 | activities.csv |
| Task | ~1,521 | works.csv |
| ServiceOrder | ~3000-5000 | works.csv (service_order arrays) |

### Preserved Production Data

| Entity | Count | Status |
|--------|-------|--------|
| User | 68 | ✅ PRESERVED |
| Position | 17 | ✅ PRESERVED |
| Sector | 8 | ✅ PRESERVED |
| MonetaryValue | 383 | ✅ PRESERVED |
| PpeSize | varies | ✅ PRESERVED |
| Preferences | varies | ✅ PRESERVED |

## 🔍 Validation Checks

The validation script checks:

1. **Record Counts** - Verify expected migration counts
2. **Referential Integrity** - Check foreign key relationships
3. **Data Quality** - Validate required fields and values
4. **Business Logic** - Verify domain rules (completed tasks have finish dates, etc.)
5. **Unique Constraints** - Check for duplicates
6. **Timestamps** - Validate date logic and consistency

### Interpreting Validation Results

- ✅ **PASS** - Check successful, no issues
- ⚠️ **WARNING** - Check passed but with minor concerns (review recommended)
- ❌ **FAIL** - Critical issue found (must be fixed)

## 🛠️ Troubleshooting

### Common Issues

#### 1. User Mapping Failures
```
⚠️  No match: John Doe (john@example.com)
```
**Solution:** User doesn't exist in production. Will be mapped to System user for activity references.

#### 2. Skipped Records
```
ItemBrand: 512 created, 2 skipped
```
**Reason:** Records already exist (duplicate detection working correctly).

#### 3. Failed Records
```
Failed: 5
```
**Solution:** Check error details in statistics output. Common causes:
- Missing required fields
- Invalid foreign key references
- Constraint violations

### Debug Mode

To see detailed Prisma queries:

```typescript
// In migrate-from-csv.ts, change:
const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'], // Add 'query' for debugging
});
```

## 📁 File Locations

| File | Path |
|------|------|
| Migration Script | `/home/kennedy/ankaa/apps/api/scripts/migrate-from-csv.ts` |
| Validation Script | `/home/kennedy/ankaa/apps/api/scripts/validate-migration.ts` |
| Full README | `/home/kennedy/ankaa/apps/api/scripts/CSV_MIGRATION_README.md` |
| CSV Files | `/home/kennedy/ankaa/ankaa_db/*.csv` |

## ⚡ Performance Tips

- **Expected Duration:** 2-5 minutes for full migration
- **Bottleneck:** Activity table (~13,663 records)
- **Memory:** ~500MB peak usage
- **Database Load:** Moderate (uses single inserts, not bulk)

## 🔄 Re-running Migration

The script is **idempotent** - it safely skips existing records:

```bash
# Safe to run multiple times
npm run migrate:csv
```

Records are identified by:
- **ItemBrand:** name
- **Supplier:** fantasyName or cnpj
- **Item:** name
- **Paint:** name
- **Task:** serialNumber
- **Order:** Creates new (no unique identifier in CSV)

## 📊 Statistics Output Example

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
  Errors (showing first 5):
    - Failed to migrate item "Invalid Name": Brand not found

...

✅ Total Success: 17234
⚠️  Total Skipped: 223
❌ Total Failed:  12

⏱️  Migration completed in 125.43 seconds
```

## 🔒 Safety Features

1. **Dry Run Mode** - Test before executing
2. **Duplicate Detection** - Skips existing records
3. **Transaction Safety** - Each entity in its own transaction
4. **Error Isolation** - One failed record doesn't stop migration
5. **Detailed Logging** - Track every operation
6. **Production Data Protection** - Never modifies User/Position/Sector tables

## 📞 Support

For issues or questions:

1. **Check validation output:** `npm run validate:migration`
2. **Review error logs:** Check statistics section for detailed errors
3. **Inspect database:** Use psql to query specific records
4. **Check CSV data:** Verify source files have expected data

## 🎯 Success Criteria

Migration is successful when:

- ✅ No critical validation failures
- ✅ Expected record counts match (~90%+)
- ✅ All production data preserved (68 users, 17 positions, 8 sectors)
- ✅ Application starts without errors
- ✅ UI displays migrated data correctly

## 🔄 Rollback

If needed, restore from backup:

```bash
# Drop and recreate database
psql postgresql://docker:docker@localhost:5432/postgres -c "DROP DATABASE ankaa;"
psql postgresql://docker:docker@localhost:5432/postgres -c "CREATE DATABASE ankaa;"

# Restore backup
psql postgresql://docker:docker@localhost:5432/ankaa < backup_YYYYMMDD_HHMMSS.sql
```

## 📝 Migration Checklist

- [ ] Database backup created
- [ ] CSV files verified at `/home/kennedy/ankaa/ankaa_db/`
- [ ] PostgreSQL running and accessible
- [ ] Dry run completed successfully
- [ ] Dry run output reviewed
- [ ] Migration executed
- [ ] Validation script passed
- [ ] Application tested
- [ ] UI verified
- [ ] Backup archived

---

**Last Updated:** 2025-10-09
**Script Version:** 1.0.0
**Database:** PostgreSQL 16
