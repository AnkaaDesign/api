# Optimization Tests - Quick Start Guide

## 🚀 Quick Commands

### Run All Tests
```bash
npm run test:optimization
```

### Run Individual Test Suites
```bash
npm run test:performance      # Performance measurements
npm run test:compatibility    # Backward compatibility
npm run test:validation       # Field validation
npm run test:payload          # Payload size measurements
npm run test:scenarios        # Context-specific scenarios
```

### View Results
```bash
# Run tests and open HTML report
npm run test:optimization:report

# Or manually open the report
open tests/reports/latest-report.html
```

## 📊 What Gets Tested

### ✅ Performance
- Query execution time
- Memory usage
- Payload size reduction
- Database query count

### ✅ Compatibility
- All required fields present
- Relation includes work
- Select queries work
- Default behavior unchanged

### ✅ Field Validation
- Correct fields in list/form/detail views
- Sensitive fields excluded
- Heavy fields excluded from lists

### ✅ Payload Size
- 30-70% reduction in list views
- 20-50% reduction in detail views
- Network bandwidth savings

### ✅ Context-Specific
- List/Table views optimized
- Form views optimized
- Detail views optimized
- Search/Filter optimized

## 🎯 Expected Results

All tests should pass with:
- ✅ List queries **50%+ faster**
- ✅ Payload sizes **40%+ smaller**
- ✅ All required fields present
- ✅ No sensitive data exposed
- ✅ All contexts optimized

## 🐛 If Tests Fail

### 1. Check Database Connection
```bash
# Make sure database is running
docker compose ps

# If not running
docker compose up -d
```

### 2. Update Prisma Client
```bash
npx prisma generate
```

### 3. Check Schema
```bash
npx prisma db pull
```

### 4. Review HTML Report
```bash
open tests/reports/latest-report.html
```

Look for:
- Which tests failed
- Error messages
- Performance metrics

### 5. Run Individual Test
```bash
# Run specific test suite to isolate issue
npm run test:performance
npm run test:compatibility
npm run test:validation
```

## 📈 Performance Targets

### List Views
- ⚡ Response Time: < 500ms
- 💾 Payload Size: < 100KB
- 📝 Fields: < 15 per record

### Form Views
- ⚡ Response Time: < 300ms
- 💾 Payload Size: < 50KB
- 📝 Fields: < 20 per record

### Detail Views
- ⚡ Response Time: < 800ms
- 💾 Payload Size: < 200KB
- 📝 Fields: < 50 per record

## 🔧 Common Issues

### Issue: "No tasks found in database"
**Solution:** Seed the database with test data

### Issue: "Query timeout"
**Solution:** Check database connection and indexes

### Issue: "Field validation failed"
**Solution:** Check if schema was recently changed

### Issue: "Performance targets not met"
**Solution:** Check if database needs optimization or running on slow hardware

## 📝 Example Test Output

```
🚀 Starting Comprehensive Optimization Test Suite...

1️⃣  PERFORMANCE MEASUREMENT TESTS
✅ Task List Query Performance
  Expected fields: 15
  Actual fields: 15
  Execution Time: 245ms
  Payload Size: 45KB
  Improvement: 52% faster, 68% smaller

2️⃣  BACKWARD COMPATIBILITY TESTS
✅ Task Required Fields
  All required fields present

3️⃣  FIELD VALIDATION TESTS
✅ List View Fields
  No missing fields
  No unexpected fields

4️⃣  PAYLOAD SIZE MEASUREMENT TESTS
✅ Task List Payload Size
  Before: 150KB
  After: 48KB
  Reduction: 68%

5️⃣  CONTEXT-SPECIFIC TESTS
✅ List/Table View
  Response Time: 312ms
  Payload Size: 52KB
  All validations passed

📊 COMPREHENSIVE TEST SUMMARY
⏱️  Total Duration: 15.23s
✅ ALL OPTIMIZATION TESTS PASSED
```

## 🎓 Best Practices

### When Adding New Features
1. ✅ Add required fields to schema
2. ✅ Update select queries to include new fields
3. ✅ Run tests to ensure no regression
4. ✅ Update test expectations if needed

### When Optimizing Queries
1. ✅ Use `select` instead of `include` for list views
2. ✅ Exclude heavy fields (formulas, large JSON)
3. ✅ Limit nested depth to 3 levels
4. ✅ Run tests to measure improvements

### When Changing Schema
1. ✅ Update Prisma schema
2. ✅ Run migrations
3. ✅ Generate Prisma client
4. ✅ Run all tests
5. ✅ Update test expectations if needed

## 📚 Next Steps

1. Run tests: `npm run test:optimization`
2. Review HTML report
3. Fix any failing tests
4. Commit changes
5. Create PR with test results

## 💡 Tips

- Run tests before committing code
- Include test results in PR description
- Update tests when adding features
- Monitor performance metrics over time
- Keep test thresholds realistic

## 📞 Need Help?

1. Check the detailed README: `tests/README.md`
2. Review HTML report for specific errors
3. Run individual test suites to isolate issues
4. Check database connection and schema

---

**Quick Reference:**
- All tests: `npm run test:optimization`
- View report: `open tests/reports/latest-report.html`
- Individual tests: `npm run test:performance|compatibility|validation|payload|scenarios`
