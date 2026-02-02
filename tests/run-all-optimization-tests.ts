#!/usr/bin/env tsx
/**
 * Comprehensive Optimization Test Runner
 *
 * Runs all optimization validation tests in sequence:
 * 1. Performance Measurement Tests
 * 2. Backward Compatibility Tests
 * 3. Field Validation Tests
 * 4. Payload Size Measurement Tests
 * 5. Context-Specific Tests
 *
 * Provides a comprehensive report of all optimization validations.
 */

import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

// Import test suites
import {
  runPerformanceTests,
  testTaskListPerformance,
  testTaskDetailPerformance,
  testTaskFormPerformance,
  printPerformanceResults,
} from './performance/performance-measurement.test';

import {
  runCompatibilityTests,
  testTaskRequiredFields,
  testTaskRelationIncludes,
  testTaskSelectQueries,
  testTaskDefaultBehavior,
  testRepresentativesMigration,
  testAPIResponseFormat,
  printCompatibilityResults,
} from './compatibility/backward-compatibility.test';

import {
  runFieldValidationTests,
  testListViewFields,
  testDetailViewFields,
  testFormViewFields,
  testExcludedSensitiveFields,
  testExcludedHeavyFields,
  testNestedSelectionDepth,
  printFieldValidationResults,
} from './validation/field-validation.test';

import {
  runPayloadSizeTests,
  testTaskListPayloadSize,
  testTaskDetailPayloadSize,
  testHeavyFieldImpact,
  testNetworkTransferSize,
} from './payload/payload-size-measurement';

import {
  runContextSpecificTests,
  testListTableView,
  testFormEditView,
  testDetailView,
  testSearchFilter,
  testDashboardStats,
  printContextTestResults,
} from './scenarios/context-specific.test';

interface TestSuiteResult {
  suiteName: string;
  passed: boolean;
  duration: number;
  testCount: number;
  passedCount: number;
  failedCount: number;
  errors: string[];
}

interface ComprehensiveReport {
  timestamp: string;
  totalDuration: number;
  suites: TestSuiteResult[];
  overallPassed: boolean;
  summary: {
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    successRate: number;
  };
}

/**
 * Run a test suite and capture results
 */
async function runTestSuite(
  name: string,
  runner: () => Promise<void>,
): Promise<TestSuiteResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 Running ${name}...`);
  console.log('='.repeat(80));

  const startTime = performance.now();
  const errors: string[] = [];
  let passed = false;

  try {
    await runner();
    passed = true;
  } catch (error) {
    passed = false;
    errors.push(error.message || String(error));
  }

  const endTime = performance.now();
  const duration = endTime - startTime;

  return {
    suiteName: name,
    passed,
    duration,
    testCount: 0, // Will be updated by individual suites
    passedCount: 0,
    failedCount: 0,
    errors,
  };
}

/**
 * Generate HTML report
 */
function generateHTMLReport(report: ComprehensiveReport): string {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Optimization Test Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        .header h1 {
            margin: 0 0 10px 0;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            color: #666;
            font-size: 14px;
            text-transform: uppercase;
        }
        .summary-card .value {
            font-size: 32px;
            font-weight: bold;
            color: #333;
        }
        .summary-card.success .value {
            color: #10b981;
        }
        .summary-card.error .value {
            color: #ef4444;
        }
        .test-suite {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .test-suite h2 {
            margin: 0 0 15px 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
        }
        .badge.success {
            background: #d1fae5;
            color: #065f46;
        }
        .badge.error {
            background: #fee2e2;
            color: #991b1b;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .metric:last-child {
            border-bottom: none;
        }
        .metric .label {
            color: #666;
        }
        .metric .value {
            font-weight: 600;
        }
        .errors {
            background: #fef2f2;
            border-left: 4px solid #ef4444;
            padding: 15px;
            margin-top: 15px;
            border-radius: 4px;
        }
        .errors h4 {
            margin: 0 0 10px 0;
            color: #991b1b;
        }
        .errors ul {
            margin: 0;
            padding-left: 20px;
        }
        .errors li {
            color: #7f1d1d;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Optimization Test Report</h1>
        <p>Generated: ${report.timestamp}</p>
        <p>Total Duration: ${(report.totalDuration / 1000).toFixed(2)}s</p>
    </div>

    <div class="summary">
        <div class="summary-card ${report.overallPassed ? 'success' : 'error'}">
            <h3>Overall Status</h3>
            <div class="value">${report.overallPassed ? '✅ PASSED' : '❌ FAILED'}</div>
        </div>
        <div class="summary-card">
            <h3>Total Tests</h3>
            <div class="value">${report.summary.totalTests}</div>
        </div>
        <div class="summary-card success">
            <h3>Passed</h3>
            <div class="value">${report.summary.totalPassed}</div>
        </div>
        <div class="summary-card ${report.summary.totalFailed > 0 ? 'error' : ''}">
            <h3>Failed</h3>
            <div class="value">${report.summary.totalFailed}</div>
        </div>
        <div class="summary-card">
            <h3>Success Rate</h3>
            <div class="value">${report.summary.successRate.toFixed(1)}%</div>
        </div>
    </div>

    ${report.suites
      .map(
        (suite) => `
    <div class="test-suite">
        <h2>
            ${suite.suiteName}
            <span class="badge ${suite.passed ? 'success' : 'error'}">
                ${suite.passed ? 'PASSED' : 'FAILED'}
            </span>
        </h2>
        <div class="metric">
            <span class="label">Duration</span>
            <span class="value">${(suite.duration / 1000).toFixed(2)}s</span>
        </div>
        ${
          suite.errors.length > 0
            ? `
        <div class="errors">
            <h4>Errors</h4>
            <ul>
                ${suite.errors.map((error) => `<li>${error}</li>`).join('')}
            </ul>
        </div>
        `
            : ''
        }
    </div>
    `,
      )
      .join('')}

    <div class="footer">
        <p>Generated by Ankaa API Optimization Test Suite</p>
    </div>
</body>
</html>
  `;

  return html;
}

/**
 * Save report to file
 */
function saveReport(report: ComprehensiveReport): void {
  const reportsDir = path.join(__dirname, '../reports');

  // Create reports directory if it doesn't exist
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save JSON report
  const jsonPath = path.join(reportsDir, `optimization-test-report-${Date.now()}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 JSON report saved to: ${jsonPath}`);

  // Save HTML report
  const htmlPath = path.join(reportsDir, `optimization-test-report-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, generateHTMLReport(report));
  console.log(`📄 HTML report saved to: ${htmlPath}`);

  // Save latest report (for easy access)
  const latestJsonPath = path.join(reportsDir, 'latest-report.json');
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));

  const latestHtmlPath = path.join(reportsDir, 'latest-report.html');
  fs.writeFileSync(latestHtmlPath, generateHTMLReport(report));
  console.log(`📄 Latest reports updated\n`);
}

/**
 * Print summary to console
 */
function printSummary(report: ComprehensiveReport): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPREHENSIVE TEST SUMMARY');
  console.log('='.repeat(80));

  console.log(`\n⏱️  Total Duration: ${(report.totalDuration / 1000).toFixed(2)}s`);
  console.log(`📅 Timestamp: ${report.timestamp}`);

  console.log('\n📈 Test Suites:');
  report.suites.forEach((suite) => {
    const icon = suite.passed ? '✅' : '❌';
    console.log(
      `  ${icon} ${suite.suiteName.padEnd(40)} ${(suite.duration / 1000).toFixed(2)}s`,
    );
  });

  console.log('\n📊 Overall Statistics:');
  console.log(`  Total Tests: ${report.summary.totalTests}`);
  console.log(`  Passed: ${report.summary.totalPassed}`);
  console.log(`  Failed: ${report.summary.totalFailed}`);
  console.log(`  Success Rate: ${report.summary.successRate.toFixed(1)}%`);

  console.log('\n' + '='.repeat(80));
  if (report.overallPassed) {
    console.log('✅ ALL OPTIMIZATION TESTS PASSED');
  } else {
    console.log('❌ SOME OPTIMIZATION TESTS FAILED');
  }
  console.log('='.repeat(80) + '\n');
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log('🚀 Starting Comprehensive Optimization Test Suite...\n');
  console.log('This will run all optimization validation tests:');
  console.log('  1. Performance Measurement Tests');
  console.log('  2. Backward Compatibility Tests');
  console.log('  3. Field Validation Tests');
  console.log('  4. Payload Size Measurement Tests');
  console.log('  5. Context-Specific Tests');
  console.log('');

  const overallStartTime = performance.now();
  const suites: TestSuiteResult[] = [];

  const prisma = new PrismaClient();

  try {
    // 1. Performance Tests
    console.log('\n' + '█'.repeat(80));
    console.log('1️⃣  PERFORMANCE MEASUREMENT TESTS');
    console.log('█'.repeat(80));
    const perfResults = [];
    perfResults.push(await testTaskListPerformance(prisma));
    perfResults.push(await testTaskDetailPerformance(prisma));
    perfResults.push(await testTaskFormPerformance(prisma));
    printPerformanceResults(perfResults);
    const perfPassed = perfResults.every((r) => r.passed);
    suites.push({
      suiteName: 'Performance Measurement',
      passed: perfPassed,
      duration: 0,
      testCount: perfResults.length,
      passedCount: perfResults.filter((r) => r.passed).length,
      failedCount: perfResults.filter((r) => !r.passed).length,
      errors: perfPassed ? [] : ['Some performance tests failed'],
    });

    // 2. Compatibility Tests
    console.log('\n' + '█'.repeat(80));
    console.log('2️⃣  BACKWARD COMPATIBILITY TESTS');
    console.log('█'.repeat(80));
    const compatResults = [];
    compatResults.push(await testTaskRequiredFields(prisma));
    compatResults.push(await testTaskRelationIncludes(prisma));
    compatResults.push(await testTaskSelectQueries(prisma));
    compatResults.push(await testTaskDefaultBehavior(prisma));
    compatResults.push(await testRepresentativesMigration(prisma));
    compatResults.push(await testAPIResponseFormat(prisma));
    printCompatibilityResults(compatResults);
    const compatPassed = compatResults.every((r) => r.passed);
    suites.push({
      suiteName: 'Backward Compatibility',
      passed: compatPassed,
      duration: 0,
      testCount: compatResults.length,
      passedCount: compatResults.filter((r) => r.passed).length,
      failedCount: compatResults.filter((r) => !r.passed).length,
      errors: compatPassed ? [] : compatResults.flatMap((r) => r.errors),
    });

    // 3. Field Validation Tests
    console.log('\n' + '█'.repeat(80));
    console.log('3️⃣  FIELD VALIDATION TESTS');
    console.log('█'.repeat(80));
    const fieldResults = [];
    fieldResults.push(await testListViewFields(prisma));
    fieldResults.push(await testDetailViewFields(prisma));
    fieldResults.push(await testFormViewFields(prisma));
    fieldResults.push(await testExcludedSensitiveFields(prisma));
    fieldResults.push(await testExcludedHeavyFields(prisma));
    fieldResults.push(await testNestedSelectionDepth(prisma));
    printFieldValidationResults(fieldResults);
    const fieldPassed = fieldResults.every((r) => r.passed);
    suites.push({
      suiteName: 'Field Validation',
      passed: fieldPassed,
      duration: 0,
      testCount: fieldResults.length,
      passedCount: fieldResults.filter((r) => r.passed).length,
      failedCount: fieldResults.filter((r) => !r.passed).length,
      errors: fieldPassed ? [] : ['Some field validation tests failed'],
    });

    // 4. Payload Size Tests
    console.log('\n' + '█'.repeat(80));
    console.log('4️⃣  PAYLOAD SIZE MEASUREMENT TESTS');
    console.log('█'.repeat(80));
    const payloadResults = [];
    payloadResults.push(await testTaskListPayloadSize(prisma));
    payloadResults.push(await testTaskDetailPayloadSize(prisma));
    payloadResults.push(await testHeavyFieldImpact(prisma));
    payloadResults.push(await testNetworkTransferSize(prisma));
    const payloadPassed = payloadResults.every((r) => r.passed);
    suites.push({
      suiteName: 'Payload Size Measurement',
      passed: payloadPassed,
      duration: 0,
      testCount: payloadResults.length,
      passedCount: payloadResults.filter((r) => r.passed).length,
      failedCount: payloadResults.filter((r) => !r.passed).length,
      errors: payloadPassed ? [] : ['Some payload size tests failed'],
    });

    // 5. Context-Specific Tests
    console.log('\n' + '█'.repeat(80));
    console.log('5️⃣  CONTEXT-SPECIFIC TESTS');
    console.log('█'.repeat(80));
    const contextResults = [];
    contextResults.push(await testListTableView(prisma));
    contextResults.push(await testFormEditView(prisma));
    contextResults.push(await testDetailView(prisma));
    contextResults.push(await testSearchFilter(prisma));
    contextResults.push(await testDashboardStats(prisma));
    printContextTestResults(contextResults);
    const contextPassed = contextResults.every((r) => r.passed);
    suites.push({
      suiteName: 'Context-Specific Scenarios',
      passed: contextPassed,
      duration: 0,
      testCount: contextResults.length,
      passedCount: contextResults.filter((r) => r.passed).length,
      failedCount: contextResults.filter((r) => !r.passed).length,
      errors: contextPassed ? [] : contextResults.flatMap((r) => r.errors),
    });

    const overallEndTime = performance.now();
    const totalDuration = overallEndTime - overallStartTime;

    // Generate comprehensive report
    const report: ComprehensiveReport = {
      timestamp: new Date().toISOString(),
      totalDuration,
      suites,
      overallPassed: suites.every((s) => s.passed),
      summary: {
        totalTests: suites.reduce((sum, s) => sum + s.testCount, 0),
        totalPassed: suites.reduce((sum, s) => sum + s.passedCount, 0),
        totalFailed: suites.reduce((sum, s) => sum + s.failedCount, 0),
        successRate:
          (suites.reduce((sum, s) => sum + s.passedCount, 0) /
            suites.reduce((sum, s) => sum + s.testCount, 0)) *
          100,
      },
    };

    // Print summary
    printSummary(report);

    // Save report
    saveReport(report);

    // Exit with appropriate code
    process.exit(report.overallPassed ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run main function
if (require.main === module) {
  main();
}

export { main as runAllOptimizationTests };
