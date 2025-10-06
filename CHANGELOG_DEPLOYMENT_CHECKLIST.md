# Changelog System - Deployment & Testing Checklist

## Pre-Deployment Checklist

### Database

- [x] **ChangeLog table exists**
  ```sql
  SELECT * FROM "ChangeLog" LIMIT 1;
  ```
  - ✅ Verified: Table exists in schema

- [x] **Database indexes are created**
  ```sql
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'ChangeLog';
  ```
  - ✅ Expected indexes:
    - `ChangeLog_entityType_entityId_idx`
    - `ChangeLog_createdAt_idx`

- [x] **Enum types are defined**
  ```sql
  SELECT typname FROM pg_type
  WHERE typname IN ('ChangeLogEntityType', 'ChangeLogAction', 'ChangeLogTriggeredByType');
  ```
  - ✅ Verified: All enum types exist

---

### Backend Code

- [x] **ChangeLogService is registered**
  - Location: `/src/modules/common/changelog/changelog.module.ts`
  - Verify: Service is exported and importable

- [x] **ChangeLogController routes work**
  - Test: `GET /api/changelogs`
  - Test: `GET /api/changelogs/entity/TASK/{id}`
  - Test: `GET /api/changelogs/task/{id}/history`

- [x] **Repository layer is functional**
  - Location: `/src/modules/common/changelog/repositories/changelog-prisma.repository.ts`
  - Verify: CRUD operations work

- [x] **Helper utilities are available**
  - Location: `/src/modules/common/changelog/utils/changelog-helpers.ts`
  - Exports: `trackAndLogFieldChanges`, `logEntityChange`, `hasValueChanged`

---

### Integration Status

#### Task Service ✅ **COMPLETE**

- [x] Simple field tracking (status, price, name, etc.)
- [x] Services tracking (add/remove)
- [x] Artworks tracking (add/remove)
- [x] Paint IDs tracking (add/remove)
- [ ] **Cuts tracking** ⚠️ NOT IMPLEMENTED
- [ ] **Airbrushings tracking** ⚠️ NOT IMPLEMENTED

**Action Required**: Implement cuts and airbrushings tracking (see `BACKEND_CUTS_CHANGELOG_FIX.md`)

---

#### Other Services (Status Unknown)

Services to verify changelog integration:

- [ ] **OrderService** - Order changes
- [ ] **UserService** - User profile changes
- [ ] **CustomerService** - Customer changes
- [ ] **SupplierService** - Supplier changes
- [ ] **ItemService** - Inventory item changes
- [ ] **ActivityService** - Inventory activity tracking

**Action Required**: Audit each service to ensure changelog tracking is implemented

---

### Frontend Code

- [x] **ChangelogHistory component exists**
  - Location: `/web/src/components/ui/changelog-history.tsx`
  - Verify: Component renders without errors

- [x] **Field mapping configuration**
  - Location: `/web/src/utils/changelog-fields.ts`
  - Verify: All entity fields have Portuguese translations

- [x] **API hooks configured**
  - Location: `/web/src/hooks/useChangeLogs.ts`
  - Verify: Hook fetches data correctly

- [x] **Constants defined**
  - Location: `/web/src/constants/changelogs.ts`
  - Verify: Entity types and action types match backend

---

## Deployment Steps

### Step 1: Database Migration (if needed)

If ChangeLog table doesn't exist:

```bash
cd /path/to/api
npx prisma migrate deploy
```

**Verify**:
```sql
SELECT COUNT(*) FROM "ChangeLog";
```
Expected: 0 or more (table should exist)

---

### Step 2: Backend Deployment

```bash
cd /path/to/api

# Install dependencies
npm install

# Run tests
npm run test

# Build
npm run build

# Deploy
# (Follow your deployment process)
```

**Verify**:
```bash
curl -X GET https://your-api.com/api/changelogs \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: `200 OK` with JSON response

---

### Step 3: Frontend Deployment

```bash
cd /path/to/web

# Install dependencies
npm install

# Run tests
npm run test

# Build
npm run build

# Deploy
# (Follow your deployment process)
```

**Verify**: Navigate to task detail page, check for "Histórico de Alterações" section

---

## Post-Deployment Testing

### Test 1: Basic CRUD with Changelog

**Objective**: Verify changelogs are created for create, update, delete operations

**Steps**:

1. **Create a task**:
   ```bash
   POST /api/tasks
   {
     "name": "Test Task",
     "status": "PENDING",
     "customerId": "{valid-customer-id}"
   }
   ```

2. **Check changelog created**:
   ```bash
   GET /api/changelogs/entity/TASK/{created-task-id}
   ```

   **Expected**:
   - 1 changelog entry
   - `action` = "CREATE"
   - `field` = null (entity-level)
   - `newValue` contains task data
   - `user` object populated

3. **Update the task**:
   ```bash
   PATCH /api/tasks/{task-id}
   {
     "status": "IN_PRODUCTION",
     "price": 1500.00
   }
   ```

4. **Check changelogs updated**:
   ```bash
   GET /api/changelogs/entity/TASK/{task-id}
   ```

   **Expected**:
   - 3 total changelog entries (1 CREATE + 2 UPDATE)
   - Entry 1: `field` = "status", `oldValue` = "PENDING", `newValue` = "IN_PRODUCTION"
   - Entry 2: `field` = "price", `oldValue` = null, `newValue` = 1500.00

5. **Delete the task**:
   ```bash
   DELETE /api/tasks/{task-id}
   ```

6. **Check final changelog**:
   ```bash
   GET /api/changelogs/entity/TASK/{task-id}
   ```

   **Expected**:
   - 4 total entries (1 CREATE + 2 UPDATE + 1 DELETE)
   - Last entry: `action` = "DELETE", `oldValue` contains task data

**Result**: ✅ PASS / ❌ FAIL

---

### Test 2: Complex Field Tracking (Services)

**Objective**: Verify array field tracking works

**Steps**:

1. **Create task with services**:
   ```bash
   POST /api/tasks
   {
     "name": "Service Test Task",
     "status": "PENDING",
     "services": [
       { "description": "Pintura completa" },
       { "description": "Polimento" }
     ]
   }
   ```

2. **Check changelog**:
   ```bash
   GET /api/changelogs/entity/TASK/{task-id}
   ```

   **Expected**:
   - CREATE entry includes services in `newValue`

3. **Add a service**:
   ```bash
   PATCH /api/tasks/{task-id}
   {
     "services": [
       { "description": "Pintura completa" },
       { "description": "Polimento" },
       { "description": "Aerografia" }
     ]
   }
   ```

4. **Check changelog**:
   ```bash
   GET /api/changelogs/entity/TASK/{task-id}
   ```

   **Expected**:
   - New UPDATE entry
   - `field` = "services"
   - `newValue` contains added service(s)
   - `reason` = "1 serviço(s) adicionado(s)"

**Result**: ✅ PASS / ❌ FAIL

---

### Test 3: User Attribution

**Objective**: Verify user information is tracked correctly

**Steps**:

1. **Create/update entity as User A**:
   ```bash
   POST /api/tasks
   Headers: { Authorization: "Bearer {user-a-token}" }
   {
     "name": "User A Task",
     "status": "PENDING"
   }
   ```

2. **Update entity as User B**:
   ```bash
   PATCH /api/tasks/{task-id}
   Headers: { Authorization: "Bearer {user-b-token}" }
   {
     "status": "IN_PRODUCTION"
   }
   ```

3. **Check changelogs**:
   ```bash
   GET /api/changelogs/entity/TASK/{task-id}
   ```

   **Expected**:
   - Entry 1 (CREATE): `userId` = User A ID, `user.name` = User A name
   - Entry 2 (UPDATE): `userId` = User B ID, `user.name` = User B name

**Result**: ✅ PASS / ❌ FAIL

---

### Test 4: Frontend Display

**Objective**: Verify frontend displays changelogs correctly

**Steps**:

1. **Navigate to task detail page**:
   ```
   https://your-app.com/producao/cronograma/detalhes/{task-id}
   ```

2. **Locate "Histórico de Alterações" section**

3. **Verify display**:
   - [ ] Section exists and is visible
   - [ ] Changelogs are in reverse chronological order (newest first)
   - [ ] Field names are in Portuguese
   - [ ] Values are formatted correctly:
     - Dates: "06/10/2025 15:30"
     - Currency: "R$ 1.500,00"
     - Status: "Pendente", "Em Produção"
   - [ ] User names and timestamps appear
   - [ ] Icons and colors are appropriate
   - [ ] Loading state works
   - [ ] Error state handled

4. **Test interactivity**:
   - [ ] Expand/collapse details works
   - [ ] Pagination works (if > 20 items)
   - [ ] Refresh/reload updates list

**Result**: ✅ PASS / ❌ FAIL

---

### Test 5: Pagination

**Objective**: Verify API pagination works correctly

**Steps**:

1. **Create 50+ changelogs** (for testing):
   ```bash
   # Create and update tasks multiple times
   # Or use existing data
   ```

2. **Test pagination**:
   ```bash
   # Page 1
   GET /api/changelogs?entityType=TASK&page=1&limit=20

   # Page 2
   GET /api/changelogs?entityType=TASK&page=2&limit=20

   # Page 3
   GET /api/changelogs?entityType=TASK&page=3&limit=20
   ```

   **Expected**:
   - Each response has exactly 20 items (or fewer on last page)
   - `meta.currentPage` increments correctly
   - `meta.totalPages` is accurate
   - `meta.hasNextPage` / `meta.hasPreviousPage` are correct
   - No duplicate entries across pages

**Result**: ✅ PASS / ❌ FAIL

---

### Test 6: Filtering

**Objective**: Verify filtering works correctly

**Steps**:

1. **Filter by entity type**:
   ```bash
   GET /api/changelogs?entityType=TASK
   GET /api/changelogs?entityType=ORDER
   ```

   **Expected**: Only matching entity types returned

2. **Filter by action**:
   ```bash
   GET /api/changelogs?action=CREATE
   GET /api/changelogs?action=UPDATE
   ```

   **Expected**: Only matching actions returned

3. **Filter by user**:
   ```bash
   GET /api/changelogs?userId={user-id}
   ```

   **Expected**: Only changes by that user

4. **Filter by date range**:
   ```bash
   GET /api/changelogs/date-range?startDate=2025-10-01&endDate=2025-10-06
   ```

   **Expected**: Only changes within date range

5. **Combined filters**:
   ```bash
   GET /api/changelogs?entityType=TASK&action=UPDATE&userId={user-id}
   ```

   **Expected**: Results match ALL filters

**Result**: ✅ PASS / ❌ FAIL

---

### Test 7: Performance

**Objective**: Verify system performs well under load

**Steps**:

1. **Measure query time**:
   ```bash
   time curl -X GET https://your-api.com/api/changelogs?limit=100
   ```

   **Expected**: < 500ms response time

2. **Check database query plan**:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM "ChangeLog"
   WHERE "entityType" = 'TASK'
     AND "entityId" = '{some-id}'
   ORDER BY "createdAt" DESC
   LIMIT 20;
   ```

   **Expected**: Index scan (not seq scan)

3. **Test with large dataset**:
   - Query with 1000+ changelog entries
   - Verify response time < 1s
   - Verify pagination works

4. **Monitor storage**:
   ```sql
   SELECT pg_size_pretty(pg_total_relation_size('ChangeLog')) as size;
   ```

   **Expected**: Reasonable size (< 100MB for < 100k entries)

**Result**: ✅ PASS / ❌ FAIL

---

### Test 8: Rollback Functionality

**Objective**: Verify changelog rollback works (if implemented)

**Steps**:

1. **Update a task field**:
   ```bash
   PATCH /api/tasks/{task-id}
   { "status": "IN_PRODUCTION" }
   ```

2. **Get the changelog ID**:
   ```bash
   GET /api/changelogs/entity/TASK/{task-id}
   ```

3. **Rollback the change**:
   ```bash
   POST /api/tasks/rollback/{task-id}/{changelog-id}
   ```

4. **Verify**:
   - Task status reverted to previous value
   - New ROLLBACK changelog entry created
   - `oldValue` and `newValue` swapped from original change

**Result**: ✅ PASS / ❌ FAIL / ⊘ NOT IMPLEMENTED

---

## Known Issues & Limitations

### Current Gaps

1. **Cuts field not tracked** ⚠️
   - Location: TaskService
   - Impact: Cut changes don't appear in changelog
   - Fix: Implement as per `BACKEND_CUTS_CHANGELOG_FIX.md`

2. **Airbrushings field not tracked** ⚠️
   - Location: TaskService
   - Impact: Airbrushing changes don't appear in changelog
   - Fix: Similar implementation to cuts

3. **Service integration incomplete** ⚠️
   - Many services may not have changelog tracking
   - Requires audit and implementation

### Edge Cases to Monitor

1. **Very large values**
   - JSON fields have no explicit size limit
   - Could cause storage issues with large arrays

2. **High-frequency updates**
   - Rapid updates create many changelog entries
   - Consider implementing debouncing or batching

3. **Circular references**
   - Serialization handles most cases
   - Complex nested objects might fail

4. **Concurrent updates**
   - Transaction handling should prevent race conditions
   - Monitor for any inconsistencies

---

## Monitoring & Maintenance

### Health Checks

**Daily**:
- [ ] Check API endpoint is responding: `GET /api/changelogs`
- [ ] Verify changelogs are being created for new changes
- [ ] Monitor error logs for serialization errors

**Weekly**:
- [ ] Check database size: `SELECT pg_size_pretty(pg_total_relation_size('ChangeLog'));`
- [ ] Review query performance: Check slow query logs
- [ ] Verify indexes are being used: `EXPLAIN ANALYZE` queries

**Monthly**:
- [ ] Run cleanup for old logs: `DELETE /api/changelogs/cleanup`
- [ ] Review storage usage trends
- [ ] Audit services for changelog integration completeness

---

### Performance Metrics

**Target SLAs**:
- API response time: < 500ms (p95)
- Database query time: < 100ms (p95)
- Changelog creation overhead: < 50ms per change
- Storage growth: < 1GB per month (depends on activity)

**Monitoring queries**:

```sql
-- Count changelogs by entity type
SELECT "entityType", COUNT(*)
FROM "ChangeLog"
GROUP BY "entityType"
ORDER BY COUNT(*) DESC;

-- Count changelogs by action
SELECT "action", COUNT(*)
FROM "ChangeLog"
GROUP BY "action"
ORDER BY COUNT(*) DESC;

-- Recent activity (last 24 hours)
SELECT COUNT(*)
FROM "ChangeLog"
WHERE "createdAt" > NOW() - INTERVAL '24 hours';

-- Top users creating changes
SELECT u.name, COUNT(*) as change_count
FROM "ChangeLog" cl
JOIN "User" u ON cl."userId" = u.id
GROUP BY u.name
ORDER BY change_count DESC
LIMIT 10;

-- Storage size
SELECT pg_size_pretty(pg_total_relation_size('ChangeLog')) as size;
```

---

## Rollback Plan

If issues occur after deployment:

### Option 1: Disable Changelog Creation (Emergency)

**Backend**:
```typescript
// In changeLogService.logChange(), add early return
async logChange(...) {
  // Emergency disable
  return;

  // ... rest of the code
}
```

**Impact**: Stops creating new changelogs, existing data preserved

---

### Option 2: Hide Frontend Component

**Frontend**:
```tsx
// In task detail page, comment out:
{/* <ChangelogHistory ... /> */}
```

**Impact**: Hides changelog display, API still works

---

### Option 3: Full Rollback

1. **Revert code changes** (if any breaking changes)
2. **Database remains** (no need to drop table)
3. **API endpoints removed** (if causing issues)

**Impact**: System returns to pre-changelog state, data preserved

---

## Success Criteria

Deployment is successful when:

- [ ] All Pre-Deployment checks pass
- [ ] All 8 Post-Deployment tests pass
- [ ] No errors in logs related to changelog
- [ ] Frontend displays changelogs correctly
- [ ] Performance meets SLA targets
- [ ] Users can see change history for tasks
- [ ] Team is trained on using the system

---

## Next Steps After Deployment

1. **Implement missing features**:
   - Cuts field tracking
   - Airbrushings field tracking
   - Other entity changelog integration

2. **Monitor and optimize**:
   - Review performance metrics
   - Adjust indexes if needed
   - Implement cleanup schedule

3. **User feedback**:
   - Gather user feedback on changelog display
   - Identify missing fields or entities
   - Improve UI/UX based on usage

4. **Documentation**:
   - Update internal wiki
   - Create user guide
   - Document common issues and solutions

---

**Checklist prepared by**: Claude
**Date**: October 6, 2025
**Status**: Ready for deployment review
