# Test Suite Directory Structure

```
tests/
├── README.md                              # Comprehensive documentation
├── QUICK_START.md                         # Quick reference guide
├── STRUCTURE.md                           # This file - directory structure
├── .gitignore                             # Git ignore for test reports
│
├── run-all-optimization-tests.ts          # Main test runner - executes all suites
│
├── config/
│   └── test-config.ts                     # Centralized test configuration
│
├── performance/
│   └── performance-measurement.test.ts    # Performance metrics tests
│       ├── testTaskListPerformance()      #   - List query performance
│       ├── testTaskDetailPerformance()    #   - Detail query performance
│       └── testTaskFormPerformance()      #   - Form query performance
│
├── compatibility/
│   └── backward-compatibility.test.ts     # Backward compatibility tests
│       ├── testTaskRequiredFields()       #   - Required fields validation
│       ├── testTaskRelationIncludes()     #   - Relation includes validation
│       ├── testTaskSelectQueries()        #   - Select queries validation
│       ├── testTaskDefaultBehavior()      #   - Default behavior validation
│       ├── testRepresentativesMigration() #   - Migration validation
│       └── testAPIResponseFormat()        #   - Response format validation
│
├── validation/
│   └── field-validation.test.ts           # Field validation tests
│       ├── testListViewFields()           #   - List view field validation
│       ├── testDetailViewFields()         #   - Detail view field validation
│       ├── testFormViewFields()           #   - Form view field validation
│       ├── testExcludedSensitiveFields()  #   - Sensitive field exclusion
│       ├── testExcludedHeavyFields()      #   - Heavy field exclusion
│       └── testNestedSelectionDepth()     #   - Nesting depth validation
│
├── payload/
│   └── payload-size-measurement.ts        # Payload size measurement tests
│       ├── testTaskListPayloadSize()      #   - List payload measurement
│       ├── testTaskDetailPayloadSize()    #   - Detail payload measurement
│       ├── testHeavyFieldImpact()         #   - Heavy field impact analysis
│       └── testNetworkTransferSize()      #   - Network bandwidth calculation
│
├── scenarios/
│   └── context-specific.test.ts           # Context-specific scenario tests
│       ├── testListTableView()            #   - List/table view scenario
│       ├── testFormEditView()             #   - Form/edit view scenario
│       ├── testDetailView()               #   - Detail view scenario
│       ├── testSearchFilter()             #   - Search/filter scenario
│       └── testDashboardStats()           #   - Dashboard/stats scenario
│
└── reports/                               # Generated test reports
    ├── .gitkeep                           # Keep directory in git
    ├── optimization-test-report-*.json    # Timestamped JSON reports (gitignored)
    ├── optimization-test-report-*.html    # Timestamped HTML reports (gitignored)
    ├── latest-report.json                 # Latest JSON report (gitignored)
    └── latest-report.html                 # Latest HTML report (gitignored)
```

## File Descriptions

### Root Level Files

**README.md**
- Comprehensive documentation for all test suites
- Usage instructions and examples
- Performance targets and thresholds
- Debugging tips and troubleshooting
- Best practices and guidelines

**QUICK_START.md**
- Quick reference guide
- Common commands
- Expected results
- Common issues and solutions
- Quick troubleshooting steps

**STRUCTURE.md** (this file)
- Directory structure visualization
- File descriptions
- Test suite organization
- Module dependencies

**run-all-optimization-tests.ts**
- Main test orchestrator
- Runs all 5 test suites sequentially
- Generates comprehensive reports
- Provides summary statistics
- Exits with appropriate status code

### Configuration

**config/test-config.ts**
- Performance thresholds (response time, payload size)
- Required fields definitions
- Sensitive fields list
- Heavy fields list
- Environment-specific overrides
- Bandwidth calculation parameters

### Test Suites

#### Performance Tests
**performance/performance-measurement.test.ts**
- Measures query execution time
- Tracks memory usage
- Calculates payload sizes
- Counts database queries (N+1 detection)
- Validates performance improvements
- Tests: List, Detail, Form queries

#### Compatibility Tests
**compatibility/backward-compatibility.test.ts**
- Validates required fields presence
- Tests relation includes functionality
- Checks select-based queries
- Validates default behavior
- Tests migration paths (negotiatingWith → representatives)
- Validates API response format

#### Field Validation Tests
**validation/field-validation.test.ts**
- Validates list view fields (minimal)
- Validates detail view fields (comprehensive)
- Validates form view fields (editable)
- Checks sensitive field exclusion
- Checks heavy field exclusion
- Validates nesting depth limits

#### Payload Size Tests
**payload/payload-size-measurement.ts**
- Measures uncompressed payload sizes
- Measures compressed (gzip) payload sizes
- Calculates compression ratios
- Tests heavy field impact
- Simulates network transfers
- Calculates bandwidth savings

#### Context-Specific Tests
**scenarios/context-specific.test.ts**
- Tests list/table view optimization
- Tests form/edit view optimization
- Tests detail view optimization
- Tests search/filter scenarios
- Tests dashboard/statistics scenarios
- Validates context-specific requirements

## Test Flow

```
npm run test:optimization
        ↓
run-all-optimization-tests.ts
        ↓
    ┌───┴───┬───────┬──────────┬──────────┐
    ↓       ↓       ↓          ↓          ↓
Performance Compat Field   Payload  Scenarios
  Tests    Tests   Tests    Tests    Tests
    ↓       ↓       ↓          ↓          ↓
    └───┬───┴───────┴──────────┴──────────┘
        ↓
   Generate Reports
        ↓
  ┌─────┴─────┐
  ↓           ↓
JSON Report  HTML Report
  ↓           ↓
Save to    Save to
reports/   reports/
```

## Running Tests

### All Tests
```bash
npm run test:optimization
```

### Individual Suites
```bash
npm run test:performance      # Performance tests only
npm run test:compatibility    # Compatibility tests only
npm run test:validation       # Field validation tests only
npm run test:payload          # Payload size tests only
npm run test:scenarios        # Context-specific tests only
```

### With Report
```bash
npm run test:optimization:report  # Run and open HTML report
```

## Report Structure

### JSON Report
```json
{
  "timestamp": "2026-02-01T...",
  "totalDuration": 15230,
  "suites": [
    {
      "suiteName": "Performance Measurement",
      "passed": true,
      "duration": 3450,
      "testCount": 3,
      "passedCount": 3,
      "failedCount": 0,
      "errors": []
    },
    // ... more suites
  ],
  "overallPassed": true,
  "summary": {
    "totalTests": 30,
    "totalPassed": 30,
    "totalFailed": 0,
    "successRate": 100
  }
}
```

### HTML Report
- Visual dashboard
- Summary cards (overall status, total tests, passed/failed)
- Suite details with metrics
- Error messages if any
- Duration statistics
- Success rate visualization

## Dependencies

### Test Suite Dependencies
- `@prisma/client` - Database access
- `zlib` - Payload compression for size testing
- `perf_hooks` - Performance measurement

### No Additional Packages Required
All tests use Node.js built-in modules and existing dependencies.

## Configuration

### Environment Variables
- `NODE_ENV` - Environment (development/staging/production)
  - Affects performance thresholds
  - Development: Standard thresholds
  - Staging: Relaxed thresholds (+10-20%)
  - Production: Stricter thresholds (-10-20%)

### Customization
Edit `config/test-config.ts` to customize:
- Performance thresholds
- Required fields
- Sensitive fields
- Heavy fields
- Report settings
- Bandwidth estimates

## Adding New Tests

1. Create test file in appropriate directory
2. Export test functions following naming convention
3. Import in `run-all-optimization-tests.ts`
4. Add to test execution sequence
5. Update documentation

Example:
```typescript
// tests/custom/my-test.test.ts
export async function testMyScenario(prisma: PrismaClient) {
  // Test implementation
  return {
    testName: 'My Test',
    passed: true,
    // ... metrics
  };
}
```

## Maintenance

### Updating Thresholds
1. Edit `config/test-config.ts`
2. Adjust performance/payload thresholds
3. Document reasons for changes
4. Re-run tests to validate

### Adding Fields
1. Update schema
2. Run migrations
3. Update `config/test-config.ts` (required fields)
4. Update individual tests if needed
5. Re-run tests

### Removing Fields
1. Update schema
2. Run migrations
3. Update tests to remove field expectations
4. Re-run tests

## Best Practices

### Test Organization
- One test suite per optimization aspect
- Clear test function names (testXxxYyy)
- Comprehensive error messages
- Detailed metrics collection

### Test Isolation
- Each test suite can run independently
- No shared state between tests
- Clean database queries (no modifications)
- Idempotent test execution

### Performance
- Tests run sequentially (not parallel)
- Minimal database load
- Fast execution (< 30 seconds total)
- Efficient queries

### Reporting
- Both JSON and HTML reports
- Latest report always available
- Timestamped historical reports
- Clear success/failure indicators

---

**Test Suite Version:** 1.0.0
**Last Updated:** 2026-02-01
