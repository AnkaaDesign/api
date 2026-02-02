# Optimization Test Suite

Comprehensive testing suite to validate API optimizations including performance improvements, backward compatibility, field validation, and payload size reduction.

## 📋 Test Suites

### 1. Performance Measurement Tests
**Location:** `tests/performance/performance-measurement.test.ts`

Measures and validates performance improvements:
- Query execution time reduction
- Memory usage optimization
- Database query count (N+1 prevention)
- Response time benchmarks

**Run:**
```bash
npm run test:performance
# or
tsx tests/performance/performance-measurement.test.ts
```

**Targets:**
- Minimum 20% execution time improvement
- Maximum 1 second response time
- Minimum 30% payload size reduction

### 2. Backward Compatibility Tests
**Location:** `tests/compatibility/backward-compatibility.test.ts`

Ensures optimizations maintain backward compatibility:
- All required fields still available
- Existing API contracts preserved
- Default behaviors unchanged
- Migration paths validated

**Run:**
```bash
npm run test:compatibility
# or
tsx tests/compatibility/backward-compatibility.test.ts
```

**Validates:**
- Task required fields (id, name, status, etc.)
- Relation includes (sector, customer, representatives, etc.)
- Select-based queries
- Default query behavior
- Representatives migration from negotiatingWith

### 3. Field Validation Tests
**Location:** `tests/validation/field-validation.test.ts`

Validates field selection accuracy:
- Required fields are present
- Unnecessary fields are excluded
- Sensitive data is protected
- Heavy fields are excluded from lists
- Nested selection depth limits

**Run:**
```bash
npm run test:validation
# or
tsx tests/validation/field-validation.test.ts
```

**Checks:**
- List view fields (minimal for tables)
- Detail view fields (comprehensive for viewing)
- Form view fields (editable fields only)
- Sensitive field exclusion (passwords, tokens)
- Heavy field exclusion (formulas, large JSON)

### 4. Payload Size Measurement Tests
**Location:** `tests/payload/payload-size-measurement.ts`

Measures payload size reduction:
- Uncompressed vs compressed sizes
- Network bandwidth savings
- Per-record size analysis
- Compression ratio improvements

**Run:**
```bash
npm run test:payload
# or
tsx tests/payload/payload-size-measurement.ts
```

**Measures:**
- Task list payload sizes
- Task detail payload sizes
- Heavy field impact (e.g., formula)
- Network transfer simulation
- Bandwidth savings calculation

### 5. Context-Specific Tests
**Location:** `tests/scenarios/context-specific.test.ts`

Tests different use cases:
- List/Table views
- Form/Edit views
- Detail views
- Search/Filter scenarios
- Dashboard/Statistics views

**Run:**
```bash
npm run test:scenarios
# or
tsx tests/scenarios/context-specific.test.ts
```

**Validates:**
- Each context has appropriate fields
- Performance targets met per context
- Payload size targets met per context

## 🚀 Running All Tests

Run all optimization tests in one command:

```bash
npm run test:optimization
# or
tsx tests/run-all-optimization-tests.ts
```

This will:
1. Run all 5 test suites sequentially
2. Generate a comprehensive report
3. Save JSON and HTML reports to `tests/reports/`
4. Exit with code 0 (success) or 1 (failure)

## 📊 Reports

Test reports are saved to `tests/reports/`:
- `optimization-test-report-{timestamp}.json` - Detailed JSON report
- `optimization-test-report-{timestamp}.html` - Visual HTML report
- `latest-report.json` - Latest JSON report
- `latest-report.html` - Latest HTML report (open in browser)

### Viewing HTML Report

```bash
# Open latest report in browser
open tests/reports/latest-report.html
# or on Linux
xdg-open tests/reports/latest-report.html
```

## 🎯 Performance Targets

### List Views
- Max Response Time: 500ms
- Max Payload Size: 100KB
- Max Fields Per Record: 15

### Form Views
- Max Response Time: 300ms
- Max Payload Size: 50KB
- Max Fields Per Record: 20

### Detail Views
- Max Response Time: 800ms
- Max Payload Size: 200KB
- Max Fields Per Record: 50

### Export Views
- Max Response Time: 5000ms (5s)
- Max Payload Size: 5000KB (5MB)
- Max Fields Per Record: 100

## 📝 Test Scenarios

### Task List (Table View)
```typescript
// Optimized query for list view
const tasks = await prisma.task.findMany({
  take: 50,
  select: {
    id: true,
    name: true,
    status: true,
    statusOrder: true,
    serialNumber: true,
    customer: {
      select: { id: true, fantasyName: true }
    },
    sector: {
      select: { id: true, name: true }
    },
  },
});
// ✅ Minimal fields, fast response, small payload
```

### Task Detail (View Page)
```typescript
// Optimized query for detail view
const task = await prisma.task.findUnique({
  where: { id },
  select: {
    // All relevant fields
    id: true,
    name: true,
    details: true,
    // ... more fields
    generalPainting: {
      select: {
        id: true,
        name: true,
        code: true,
        // ❌ Exclude heavy 'formula' field
      },
    },
  },
});
// ✅ Comprehensive but excludes heavy fields
```

### Task Form (Edit)
```typescript
// Optimized query for form editing
const task = await prisma.task.findUnique({
  where: { id },
  select: {
    id: true,
    name: true,
    status: true,
    // Foreign keys for dropdowns
    sectorId: true,
    customerId: true,
    // Minimal relation data
    sector: {
      select: { id: true, name: true }
    },
  },
});
// ✅ Only editable fields + IDs for dropdowns
```

## 🔍 What Gets Tested

### Required Fields (Must Always Be Present)
- ✅ id
- ✅ name
- ✅ status
- ✅ statusOrder
- ✅ serialNumber
- ✅ createdAt
- ✅ updatedAt

### Excluded Heavy Fields (Should NOT Be in List Views)
- ❌ details (large text)
- ❌ serviceOrders (large array)
- ❌ pricing.items (large array)
- ❌ generalPainting.formula (very large JSON)
- ❌ artworks (array of images)
- ❌ baseFiles (array of files)

### Excluded Sensitive Fields (Should NEVER Be Exposed)
- ❌ password
- ❌ passwordHash
- ❌ salt
- ❌ resetToken
- ❌ accessToken
- ❌ refreshToken

## 🐛 Debugging Failed Tests

### Performance Test Failures
```bash
# Run with verbose logging
DEBUG=* tsx tests/performance/performance-measurement.test.ts

# Common issues:
# - Slow database connection
# - Missing indexes
# - Large dataset (run on smaller dataset)
```

### Compatibility Test Failures
```bash
# Check database schema
npx prisma db pull
npx prisma generate

# Common issues:
# - Schema changes not applied
# - Missing migrations
# - Prisma client out of sync
```

### Field Validation Failures
```bash
# Common issues:
# - New fields added without updating tests
# - Schema changes
# - Missing field selections
```

## 📈 Expected Improvements

Based on optimization targets:

### Payload Size Reduction
- List views: **50-70% smaller**
- Detail views: **30-50% smaller**
- Form views: **40-60% smaller**

### Performance Improvement
- List queries: **30-50% faster**
- Detail queries: **20-40% faster**
- Form queries: **25-45% faster**

### Bandwidth Savings
For 1,000 requests/day:
- **Daily:** ~2-5 MB saved
- **Monthly:** ~60-150 MB saved
- **Yearly:** ~720 MB - 1.8 GB saved

## 🔧 Adding New Tests

### 1. Create Test File
```typescript
// tests/custom/my-test.test.ts
export async function testMyScenario(prisma: PrismaClient) {
  // Your test logic
  return {
    testName: 'My Test',
    passed: true,
    // ... results
  };
}
```

### 2. Add to Main Runner
```typescript
// tests/run-all-optimization-tests.ts
import { testMyScenario } from './custom/my-test.test';

// In main():
const myResults = await testMyScenario(prisma);
suites.push({ /* results */ });
```

### 3. Add npm Script
```json
// package.json
{
  "scripts": {
    "test:custom": "tsx tests/custom/my-test.test.ts"
  }
}
```

## 📚 Resources

- [Prisma Performance Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)
- [GraphQL Field Selection Patterns](https://graphql.org/learn/queries/#fields)
- [REST API Performance Optimization](https://restfulapi.net/performance/)

## 🤝 Contributing

When adding new features or optimizations:

1. ✅ Add relevant tests
2. ✅ Update performance targets if needed
3. ✅ Run full test suite before committing
4. ✅ Update this README with new scenarios

## 📞 Support

If tests are failing unexpectedly:

1. Check database connection
2. Verify schema is up to date (`npx prisma generate`)
3. Review recent code changes
4. Check test thresholds (may need adjustment)
5. Review HTML report for detailed errors

---

**Last Updated:** 2026-02-01
**Test Suite Version:** 1.0.0
