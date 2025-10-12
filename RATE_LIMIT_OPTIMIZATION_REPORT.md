# API Rate Limiting Optimization Report
**Date:** 2025-10-12
**Status:** Phase 1 Complete - Immediate Crisis Resolved

---

## EXECUTIVE SUMMARY

### Problem Identified
- **Default rate limit TOO LOW**: 60 req/min causing legitimate users to hit limits
- **70% of controllers UNPROTECTED**: Only 14/47 controllers had rate limiting
- **File operations UNLIMITED**: Complete bypass on file serving (security risk)
- **High-frequency endpoints INADEQUATE**: /auth/me and similar accessed on every page

### Changes Implemented (Phase 1)

#### 1. **Default Throttler Increased** ✅
- **Before**: 60 requests/minute (production)
- **After**: 300 requests/minute (production)
- **Impact**: 5x increase resolves immediate user experience issues
- **File**: `src/modules/common/throttler/throttler.module.ts:37`

#### 2. **New Throttler Types Created** ✅
Added 8 specialized throttler types:

| Throttler Name | Dev Limit | Prod Limit | Use Case |
|----------------|-----------|------------|----------|
| `high_frequency` | 2000/min | 500/min | /auth/me, common entities |
| `thumbnail_serve` | 2000/min | 500/min | Thumbnail requests |
| `file_serve` | 1000/min | 200/min | File serving |
| `file_download` | 500/min | 50/min | File downloads |
| `dashboard` | 100/min | 30/min | Dashboard loads |
| `dashboard_unified` | 50/min | 10/min | Unified dashboard |
| `statistics_heavy` | 100/min | 15/min | Complex statistics |
| `statistics_moderate` | 200/min | 30/min | Moderate statistics |

**File**: `src/modules/common/throttler/throttler.module.ts:102-150`

#### 3. **New Decorator Functions** ✅
Created decorator functions for all new throttler types:
- `HighFrequencyRateLimit()`
- `ThumbnailServeRateLimit()`
- `FileServeRateLimit()`
- `FileDownloadRateLimit()`
- `DashboardRateLimit()`
- `UnifiedDashboardRateLimit()`
- `HeavyStatisticsRateLimit()`
- `ModerateStatisticsRateLimit()`

**File**: `src/modules/common/throttler/throttler.decorators.ts:93-156`

#### 4. **Critical Endpoint Updated** ✅
- `/auth/me` changed from `ReadRateLimit` (100/min) to `HighFrequencyRateLimit` (500/min)
- **Impact**: Prevents rate limit hits on every route change
- **File**: `src/modules/common/auth/auth.controller.ts:106`

---

## PHASE 2 IMPLEMENTATION PLAN

### Priority 1: CRITICAL - Apply Within 24 Hours

#### A. File Controller (Security Risk)
**File**: `src/modules/common/file/file.controller.ts`

Replace `@FileOperationBypass()` and `@NoRateLimit()` with proper limits:

```typescript
// Line 85 - Thumbnail serving
@Get('thumbnail/:id')
@Public()
@ThumbnailServeRateLimit()  // CHANGE FROM: @NoRateLimit()
async getThumbnail(...)

// File serving endpoints
@Get('serve/:id')
@Public()
@FileServeRateLimit()  // CHANGE FROM: @FileOperationBypass()
async serveFile(...)

@Get(':id/download')
@Public()
@FileDownloadRateLimit()  // CHANGE FROM: @FileOperationBypass()
async downloadFile(...)

// List operations
@Get()
@ReadRateLimit()  // CHANGE FROM: @NoRateLimit()
async findMany(...)
```

#### B. Statistics Controller
**File**: `src/modules/system/statistics/statistics.controller.ts`

```typescript
// Heavy statistics endpoints
@Get('inventory/abc-xyz-analysis')
@HeavyStatisticsRateLimit()  // ADD THIS
async getAbcXyzAnalysis(...)

@Get('production/cycle-times')
@HeavyStatisticsRateLimit()  // ADD THIS
async getCycleTimes(...)

@Get('production/bottlenecks')
@HeavyStatisticsRateLimit()  // ADD THIS
async getBottlenecks(...)

@Get('financial/revenue-trends')
@HeavyStatisticsRateLimit()  // ADD THIS
async getRevenueTrends(...)

@Get('financial/cost-analysis')
@HeavyStatisticsRateLimit()  // ADD THIS
async getCostAnalysis(...)

@Get('financial/profitability')
@HeavyStatisticsRateLimit()  // ADD THIS
async getProfitability(...)

@Get('financial/budget-tracking')
@HeavyStatisticsRateLimit()  // ADD THIS
async getBudgetTracking(...)

// Moderate statistics endpoints
@Get('inventory/consumption-trends')
@ModerateStatisticsRateLimit()  // ADD THIS
async getConsumptionTrends(...)

@Get('orders/supplier-comparison')
@ModerateStatisticsRateLimit()  // ADD THIS
async getSupplierComparison(...)

// Standard statistics endpoints (all others)
@Get('inventory/overview')
@ReadRateLimit()  // ADD THIS
async getInventoryOverview(...)
// ... apply ReadRateLimit to all remaining GET endpoints
```

#### C. Dashboard Controller
**File**: `src/modules/domain/dashboard/dashboard.controller.ts`

```typescript
@Get('unified')
@Roles(SECTOR_PRIVILEGES.ADMIN)
@UnifiedDashboardRateLimit()  // ADD THIS
async getUnifiedDashboard(...)

@Get('inventory')
@Roles(SECTOR_PRIVILEGES.ADMIN)
@DashboardRateLimit()  // ADD THIS
async getInventoryDashboard(...)

@Get('hr')
@Roles(SECTOR_PRIVILEGES.ADMIN)
@DashboardRateLimit()  // ADD THIS
async getHRDashboard(...)

@Get('administration')
@Roles(SECTOR_PRIVILEGES.ADMIN)
@DashboardRateLimit()  // ADD THIS
async getAdministrationDashboard(...)

@Get('paint')
@Roles(SECTOR_PRIVILEGES.ADMIN)
@DashboardRateLimit()  // ADD THIS
async getPaintDashboard(...)

@Get('production')
@Roles(SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.LEADER)
@DashboardRateLimit()  // ADD THIS
async getProductionDashboard(...)
```

### Priority 2: HIGH - Apply Within 1 Week

#### D. Notification Controller
**File**: `src/modules/common/notification/notification.controller.ts`

```typescript
@Get()
@CustomRateLimit(200, 60000)  // ADD THIS - 200/min for polling
async findMany(...)

@Get(':id')
@ReadRateLimit()  // ADD THIS
async findOne(...)

@Post()
@WriteRateLimit()  // ADD THIS
async create(...)

// Seen notifications
@Get()  // seen-notifications route
@CustomRateLimit(200, 60000)  // ADD THIS
async findMany(...)

@Post('mark-as-read/:notificationId')
@CustomRateLimit(150, 60000)  // ADD THIS - 150/min
async markAsRead(...)
```

#### E. Preferences Controller
**File**: `src/modules/people/preferences/preferences.controller.ts`

```typescript
@Get()
@ReadRateLimit()  // ADD THIS
async findMany(...)

@Get(':id')
@ReadRateLimit()  // ADD THIS
async findOne(...)

@Post()
@WriteRateLimit()  // ADD THIS
async create(...)

@Put(':id')
@CustomRateLimit(50, 60000)  // ADD THIS - 50 updates/min
async update(...)

// Notification preferences
@Post('notification-preferences')
@WriteRateLimit()  // ADD THIS
async createNotificationPreference(...)

@Put('notification-preferences/:id')
@CustomRateLimit(50, 60000)  // ADD THIS
async updateNotificationPreference(...)
```

#### F. Warning & Vacation Controllers
**Files**:
- `src/modules/people/warning/warning.controller.ts`
- `src/modules/people/vacation/vacation.controller.ts`

```typescript
// Both controllers - apply these patterns

@Get()
@ReadRateLimit()  // ADD THIS
async findMany(...)

@Get('my-warnings')  // or 'my-vacations'
@ReadRateLimit()  // ADD THIS
async getMyItems(...)

@Get(':id')
@ReadRateLimit()  // ADD THIS
async findOne(...)

@Post()
@WriteRateLimit()  // ADD THIS
async create(...)

@Put(':id')
@WriteRateLimit()  // ADD THIS
async update(...)

@Delete(':id')
@WriteRateLimit()  // ADD THIS
async remove(...)
```

### Priority 3: MEDIUM - Apply Within 2 Weeks

#### G. Production Controllers
**Files**:
- `src/modules/production/task/task.controller.ts`
- `src/modules/production/service-order/service-order.controller.ts`
- `src/modules/production/customer/customer.controller.ts`
- `src/modules/production/truck/truck.controller.ts`
- `src/modules/production/garage/garage.controller.ts`

**Pattern**: Apply standard CRUD rate limiting

```typescript
@Get()
@ReadRateLimit()  // ADD THIS
async findMany(...)

@Get(':id')
@ReadRateLimit()  // ADD THIS
async findOne(...)

@Post()
@WriteRateLimit()  // ADD THIS
async create(...)

@Put(':id')
@WriteRateLimit()  // ADD THIS
async update(...)

@Delete(':id')
@WriteRateLimit()  // ADD THIS
async remove(...)

// Batch operations
@Post('batch')
@CustomRateLimit(10, 60000)  // ADD THIS - Stricter limit
async batchCreate(...)
```

#### H. Inventory Controllers
**Files**:
- `src/modules/inventory/item/item.controller.ts`
- `src/modules/inventory/order/order.controller.ts`
- `src/modules/inventory/supplier/supplier.controller.ts`
- `src/modules/inventory/activity/activity.controller.ts`

**Pattern**: Same as production controllers

```typescript
// Standard CRUD - ReadRateLimit/WriteRateLimit
// Batch operations - CustomRateLimit(10, 60000)

// Special for Items controller
@Post('recalculate-monthly-consumption')
@Roles(SECTOR_PRIVILEGES.ADMIN)
@CustomRateLimit(5, 60000)  // ADD THIS - Very expensive operation
async recalculateAllMonthlyConsumption(...)
```

#### I. Position & Sector Controllers (Autocomplete/Dropdowns)
**Files**:
- `src/modules/people/position/position.controller.ts`
- `src/modules/people/sector/sector.controller.ts`

```typescript
@Get()
@CustomRateLimit(200, 60000)  // ADD THIS - 200/min for autocomplete
async findMany(...)

@Get(':id')
@ReadRateLimit()  // ADD THIS
async findOne(...)

// Apply WriteRateLimit to POST/PUT/DELETE
```

### Priority 4: LOW - Apply Within 1 Month

#### J. Remaining Controllers
Apply standard rate limiting pattern to all remaining unprotected controllers:
- HR module controllers (payroll, discount, bonus)
- Paint controllers
- System controllers (throttler, app, deployment, etc.)
- Maintenance controllers
- PPE controllers
- Borrow controllers

---

## IMPLEMENTATION CHECKLIST

### Phase 1: ✅ COMPLETED
- [x] Increase default throttler from 60 to 300 req/min
- [x] Add 8 new throttler types to throttler.module.ts
- [x] Create 8 new decorator functions in throttler.decorators.ts
- [x] Update /auth/me to use HighFrequencyRateLimit
- [x] Build and deploy changes
- [x] Test API health after deployment

### Phase 2: Priority 1 (Within 24 Hours)
- [ ] Update file controller (security critical)
- [ ] Update statistics controller (26 endpoints)
- [ ] Update dashboard controller (6 endpoints)
- [ ] Build, test, and deploy
- [ ] Monitor for errors/rate limit hits

### Phase 3: Priority 2 (Within 1 Week)
- [ ] Update notification controller
- [ ] Update preferences controller
- [ ] Update warning controller
- [ ] Update vacation controller
- [ ] Build, test, and deploy

### Phase 4: Priority 3 (Within 2 Weeks)
- [ ] Update all production controllers (7 controllers)
- [ ] Update all inventory controllers (8 controllers)
- [ ] Update position and sector controllers
- [ ] Build, test, and deploy

### Phase 5: Priority 4 (Within 1 Month)
- [ ] Update all remaining controllers
- [ ] Comprehensive testing
- [ ] Performance monitoring
- [ ] Documentation update

---

## EXPECTED IMPACT

### Immediate (Phase 1 - COMPLETED)
- ✅ **Default limit increased 5x**: 60 → 300 req/min
- ✅ **User experience drastically improved**: No more random rate limit errors
- ✅ **High-frequency endpoint optimized**: /auth/me now 500/min (was 100/min)

### After Phase 2 (Critical Security)
- 🔐 **File operations protected**: No more unlimited bandwidth abuse
- 📊 **Statistics endpoints protected**: Prevent database overload
- 📈 **Dashboard endpoints protected**: Manage expensive queries

### After Phase 3 (User-Facing Features)
- 🔔 **Notifications optimized**: Proper polling limits
- ⚙️ **Preferences optimized**: Frequent updates supported
- 📋 **Personal data protected**: my-warnings, my-vacations, etc.

### After Phase 4 (Business Operations)
- 🏭 **Production endpoints protected**: Task, order, customer management
- 📦 **Inventory endpoints protected**: Item, stock, supplier management
- 🔍 **Autocomplete optimized**: Position, sector dropdowns

### After All Phases Complete
- ✅ **100% controller coverage**: All 47 controllers protected
- ✅ **Security hardened**: No unlimited endpoints
- ✅ **Performance optimized**: Appropriate limits for each use case
- ✅ **User experience excellent**: High limits where needed, strict where required

---

## RATE LIMIT HIERARCHY

### Understanding the Limits

```
PUBLIC ENDPOINTS (Strict - Prevent Abuse)
├─ Authentication: 5/min (AuthRateLimit)
├─ Verification Send: 2 per 5min (VerificationSendRateLimit)
├─ Verification Check: 3/min (VerificationRateLimit)
├─ File Downloads: 50/min (FileDownloadRateLimit)
└─ File Serving: 200/min (FileServeRateLimit)

AUTHENTICATED ENDPOINTS (Balanced)
├─ High Frequency: 500/min (HighFrequencyRateLimit)
│  └─ /auth/me, common entities, thumbnails
│
├─ Standard Reads: 300/min (Default) or 100/min (ReadRateLimit)
│  └─ List operations, detail views
│
├─ Standard Writes: 30/min (WriteRateLimit)
│  └─ Create, update, delete operations
│
├─ Heavy Operations: 15/min (HeavyStatisticsRateLimit)
│  └─ Complex statistics, financial reports
│
├─ Moderate Operations: 30/min (ModerateStatisticsRateLimit/DashboardRateLimit)
│  └─ Dashboards, aggregations
│
└─ Batch Operations: 10/min (CustomRateLimit)
   └─ Batch create/update/delete

ADMIN OPERATIONS (Stricter - Resource Intensive)
├─ Dashboard Unified: 10/min (UnifiedDashboardRateLimit)
├─ Heavy Statistics: 15/min (HeavyStatisticsRateLimit)
└─ System Operations: 5/min (CustomRateLimit)
```

---

## MONITORING & MAINTENANCE

### Post-Deployment Monitoring
1. **Check PM2 logs for rate limit violations**:
   ```bash
   pm2 logs ankaa-api-production | grep -i "rate\|throttle\|limit"
   ```

2. **Monitor Redis for throttler keys**:
   ```bash
   redis-cli --scan --pattern "throttler:*" | wc -l
   ```

3. **Check system throttler stats**:
   ```
   GET /system/throttler/stats
   GET /system/throttler/blocked-keys
   ```

### Adjusting Limits
If you need to adjust limits after deployment, edit:
- `src/modules/common/throttler/throttler.module.ts` (throttler definitions)
- `src/modules/common/throttler/throttler.decorators.ts` (decorator limits)

Then rebuild and redeploy:
```bash
npm run build
pm2 reload ecosystem.config.js --only ankaa-api-production
```

### Emergency: Disable Rate Limiting
If rate limiting causes production issues:
```bash
# Add to .env.production
DISABLE_RATE_LIMITING=true

# Restart API
pm2 reload ecosystem.config.js --only ankaa-api-production
```

---

## TESTING RECOMMENDATIONS

### Manual Testing
Test each updated controller after deployment:

```bash
# Test high-frequency endpoint
for i in {1..100}; do curl -s -o /dev/null -w "%{http_code}\n" https://api.ankaa.live/auth/me -H "Authorization: Bearer $TOKEN"; done

# Test file serving
for i in {1..50}; do curl -s -o /dev/null -w "%{http_code}\n" https://api.ankaa.live/files/thumbnail/FILE_ID; done

# Test dashboard
for i in {1..20}; do curl -s -o /dev/null -w "%{http_code}\n" https://api.ankaa.live/dashboards/production -H "Authorization: Bearer $TOKEN"; done
```

### Load Testing
Consider using k6, artillery, or similar tools:

```javascript
// k6 script example
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 10,
  duration: '30s',
};

export default function() {
  let res = http.get('https://api.ankaa.live/auth/me', {
    headers: { 'Authorization': `Bearer ${__ENV.TOKEN}` },
  });
  check(res, {
    'status is 200': (r) => r.status === 200,
    'not rate limited': (r) => r.status !== 429,
  });
}
```

---

## SUMMARY

### What Was Done
✅ **Immediate crisis resolved** - Default limit increased 5x (60 → 300 req/min)
✅ **Infrastructure prepared** - 8 new throttler types created
✅ **Critical endpoint fixed** - /auth/me now properly configured
✅ **Deployed to production** - Changes live and tested

### What Remains
⚠️ **36 controllers still unprotected** (70% of API)
⚠️ **File operations unlimited** (security risk)
⚠️ **Statistics endpoints unprotected** (database overload risk)
⚠️ **Dashboard endpoints unprotected** (expensive queries)

### Next Steps
1. Apply Priority 1 changes within 24 hours (file, statistics, dashboard)
2. Apply Priority 2 changes within 1 week (notifications, preferences)
3. Apply Priority 3 changes within 2 weeks (production, inventory)
4. Apply Priority 4 changes within 1 month (remaining controllers)

---

**Report Generated:** 2025-10-12 02:53 UTC
**Phase 1 Status:** ✅ COMPLETE AND DEPLOYED
**Next Action:** Implement Phase 2 (Priority 1) changes
