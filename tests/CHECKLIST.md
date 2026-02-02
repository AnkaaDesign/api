# Optimization Testing Checklist

Use this checklist when validating optimizations or before deploying changes.

## Pre-Test Checklist

### Environment Setup
- [ ] Database is running (`docker compose ps`)
- [ ] Database has test data (at least 10 tasks)
- [ ] Prisma client is up to date (`npx prisma generate`)
- [ ] Schema is synchronized (`npx prisma db pull`)
- [ ] Dependencies installed (`npm install`)

### Code Changes
- [ ] All optimization changes committed
- [ ] Schema changes applied via migrations
- [ ] Prisma schema updated if needed
- [ ] No uncommitted changes that affect queries

## Running Tests

### Quick Validation
```bash
# Run all tests
npm run test:optimization
```
- [ ] All tests executed successfully
- [ ] No errors in console output
- [ ] Exit code is 0 (success)

### Detailed Validation

#### 1. Performance Tests
```bash
npm run test:performance
```
- [ ] List query performance meets targets (< 500ms)
- [ ] Detail query performance meets targets (< 800ms)
- [ ] Form query performance meets targets (< 300ms)
- [ ] Performance improvements >= 20%
- [ ] Memory usage is acceptable
- [ ] No N+1 query issues

#### 2. Compatibility Tests
```bash
npm run test:compatibility
```
- [ ] All required fields present
- [ ] Relation includes work correctly
- [ ] Select queries function properly
- [ ] Default behavior unchanged
- [ ] Representatives migration successful
- [ ] API response format correct

#### 3. Field Validation Tests
```bash
npm run test:validation
```
- [ ] List view has correct minimal fields
- [ ] Detail view has comprehensive fields
- [ ] Form view has editable fields only
- [ ] No sensitive fields exposed
- [ ] Heavy fields excluded from lists
- [ ] Nesting depth within limits (≤ 3)

#### 4. Payload Size Tests
```bash
npm run test:payload
```
- [ ] List payload reduced by >= 30%
- [ ] Detail payload reduced by >= 20%
- [ ] Heavy fields excluded properly
- [ ] Compression ratios acceptable
- [ ] Bandwidth savings calculated

#### 5. Context-Specific Tests
```bash
npm run test:scenarios
```
- [ ] List/table view optimized
- [ ] Form/edit view optimized
- [ ] Detail view optimized
- [ ] Search/filter working
- [ ] Dashboard/stats working

## Report Review

### HTML Report
```bash
open tests/reports/latest-report.html
```
- [ ] Overall status is PASSED
- [ ] All test suites show green (✅)
- [ ] No error messages in report
- [ ] Performance metrics meet targets
- [ ] Success rate is 100%

### Detailed Metrics
Review report sections:
- [ ] **Overall Status**: All tests passed
- [ ] **Total Tests**: Expected count (30+)
- [ ] **Success Rate**: 100%
- [ ] **Performance Metrics**: Meet targets
- [ ] **Payload Reduction**: >= 30%
- [ ] **Execution Time**: < 30 seconds total

## Validation Checklist

### Performance Validation
- [ ] Response times improved by 20%+
- [ ] Payload sizes reduced by 30%+
- [ ] No performance regressions
- [ ] Database queries optimized
- [ ] Memory usage acceptable

### Compatibility Validation
- [ ] All existing features work
- [ ] No breaking changes
- [ ] API contracts maintained
- [ ] Default behaviors unchanged
- [ ] Migrations successful

### Security Validation
- [ ] No password fields exposed
- [ ] No token fields exposed
- [ ] No API keys exposed
- [ ] No sensitive data in responses
- [ ] Access control working

### Data Validation
- [ ] All required fields present
- [ ] Nested relations work correctly
- [ ] Arrays handled properly
- [ ] Dates serialized correctly
- [ ] JSON fields handled correctly

## Post-Test Actions

### If All Tests Pass ✅
- [ ] Review HTML report summary
- [ ] Save report for documentation
- [ ] Update CHANGELOG if needed
- [ ] Create PR with test results
- [ ] Document optimization metrics
- [ ] Deploy changes

### If Tests Fail ❌

#### Immediate Actions
- [ ] Review HTML report for errors
- [ ] Identify which tests failed
- [ ] Review error messages
- [ ] Check database state
- [ ] Verify environment setup

#### Debug Individual Failures

**Performance Test Failure:**
- [ ] Check database connection speed
- [ ] Verify test data volume
- [ ] Review query execution plans
- [ ] Check for missing indexes
- [ ] Adjust thresholds if necessary

**Compatibility Test Failure:**
- [ ] Verify schema changes applied
- [ ] Check Prisma client regenerated
- [ ] Review migration status
- [ ] Validate field mappings
- [ ] Check relation definitions

**Field Validation Failure:**
- [ ] Review query select statements
- [ ] Check for missing fields
- [ ] Verify field exclusions
- [ ] Update test expectations
- [ ] Check nested selections

**Payload Test Failure:**
- [ ] Review payload size metrics
- [ ] Check for unnecessary fields
- [ ] Verify heavy field exclusions
- [ ] Adjust size targets if needed
- [ ] Review compression ratios

**Context Test Failure:**
- [ ] Review context-specific queries
- [ ] Check performance targets
- [ ] Verify field selections
- [ ] Test manually in UI
- [ ] Adjust context requirements

## Pre-Deployment Checklist

### Code Review
- [ ] All optimization changes reviewed
- [ ] Test results documented in PR
- [ ] Performance improvements documented
- [ ] Breaking changes documented
- [ ] Migration guide provided (if needed)

### Documentation
- [ ] README updated if needed
- [ ] API documentation updated
- [ ] Changelog updated
- [ ] Test results saved
- [ ] Optimization metrics documented

### Testing
- [ ] All optimization tests pass
- [ ] Manual testing completed
- [ ] Edge cases tested
- [ ] Integration tests pass
- [ ] E2E tests pass (if available)

### Deployment Preparation
- [ ] Database migrations ready
- [ ] Rollback plan documented
- [ ] Performance baselines documented
- [ ] Monitoring configured
- [ ] Alerts configured

## Post-Deployment Validation

### Immediate (First 15 minutes)
- [ ] Service started successfully
- [ ] Health checks passing
- [ ] No errors in logs
- [ ] Database connections healthy
- [ ] API responding correctly

### Short-term (First hour)
- [ ] Response times improved
- [ ] Error rates normal
- [ ] Memory usage stable
- [ ] Database load acceptable
- [ ] User reports positive

### Long-term (First day)
- [ ] Performance metrics stable
- [ ] No new errors
- [ ] Bandwidth usage reduced
- [ ] User experience improved
- [ ] No rollback needed

## Troubleshooting Guide

### Test Failures
1. Check error messages in report
2. Run individual failing test
3. Review test logs
4. Verify environment
5. Check database state
6. Update tests if needed

### Performance Issues
1. Check database connection
2. Verify indexes exist
3. Review query execution plans
4. Check test data volume
5. Adjust thresholds if needed

### Compatibility Issues
1. Verify schema changes
2. Check migration status
3. Regenerate Prisma client
4. Review field mappings
5. Test manually

## Quick Reference

### Run All Tests
```bash
npm run test:optimization
```

### View Latest Report
```bash
open tests/reports/latest-report.html
```

### Run Specific Suite
```bash
npm run test:performance      # Performance
npm run test:compatibility    # Compatibility
npm run test:validation       # Field validation
npm run test:payload          # Payload size
npm run test:scenarios        # Context-specific
```

### Common Commands
```bash
# Update Prisma client
npx prisma generate

# Check database
docker compose ps

# View logs
docker compose logs -f api

# Run migrations
npx prisma migrate dev
```

## Success Criteria

Tests are successful when:
- ✅ All test suites pass (100% success rate)
- ✅ Performance improved by 20%+
- ✅ Payload sizes reduced by 30%+
- ✅ No compatibility issues
- ✅ No sensitive data exposed
- ✅ All contexts optimized
- ✅ HTML report shows all green
- ✅ No errors in console

## Notes

- Run tests before every PR
- Include test results in PR description
- Update tests when schema changes
- Keep test thresholds realistic
- Document optimization strategies
- Monitor long-term performance

---

**Checklist Version:** 1.0.0
**Last Updated:** 2026-02-01

## Print This Checklist

For easy reference, print this checklist and check off items as you complete them.
