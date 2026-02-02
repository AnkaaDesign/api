/**
 * Performance Measurement Test Suite
 *
 * Measures and validates performance improvements from optimizations:
 * - Query execution time
 * - Memory usage
 * - Payload size
 * - Database query count
 */

import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';

interface PerformanceMetrics {
  executionTime: number;
  memoryUsed: number;
  payloadSize: number;
  queryCount: number;
  queryTime: number;
}

interface PerformanceTestResult {
  testName: string;
  baseline: PerformanceMetrics;
  optimized: PerformanceMetrics;
  improvement: {
    executionTime: number; // percentage
    memoryUsed: number; // percentage
    payloadSize: number; // percentage
    queryCount: number; // count reduction
    queryTime: number; // percentage
  };
  passed: boolean;
  details?: string;
}

/**
 * Performance Test Configuration
 */
const PERFORMANCE_THRESHOLDS = {
  // Minimum expected improvements (percentages)
  MIN_EXECUTION_TIME_IMPROVEMENT: 20, // 20% faster
  MIN_MEMORY_IMPROVEMENT: 15, // 15% less memory
  MIN_PAYLOAD_SIZE_IMPROVEMENT: 30, // 30% smaller payload
  MIN_QUERY_TIME_IMPROVEMENT: 25, // 25% faster queries

  // Maximum acceptable values
  MAX_EXECUTION_TIME_MS: 1000, // 1 second max
  MAX_PAYLOAD_SIZE_KB: 500, // 500KB max for single entity
  MAX_QUERY_COUNT: 10, // Max N+1 queries
};

/**
 * Measure performance metrics for a query execution
 */
async function measurePerformance<T>(
  name: string,
  executor: () => Promise<T>,
  queryCounter?: { count: number; time: number },
): Promise<{ result: T; metrics: PerformanceMetrics }> {
  // Clear query counter
  if (queryCounter) {
    queryCounter.count = 0;
    queryCounter.time = 0;
  }

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const initialMemory = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  const result = await executor();

  const endTime = performance.now();
  const finalMemory = process.memoryUsage().heapUsed;

  const payloadSize = JSON.stringify(result).length;
  const executionTime = endTime - startTime;
  const memoryUsed = finalMemory - initialMemory;

  const metrics: PerformanceMetrics = {
    executionTime,
    memoryUsed,
    payloadSize,
    queryCount: queryCounter?.count || 0,
    queryTime: queryCounter?.time || 0,
  };

  return { result, metrics };
}

/**
 * Calculate improvement percentage
 */
function calculateImprovement(baseline: number, optimized: number): number {
  if (baseline === 0) return 0;
  return ((baseline - optimized) / baseline) * 100;
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format milliseconds to human-readable format
 */
function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Test 1: Task List Query Performance
 * Baseline: Full includes with all relations
 * Optimized: Minimal fields for list view
 */
export async function testTaskListPerformance(prisma: PrismaClient): Promise<PerformanceTestResult> {
  console.log('\n🧪 Testing Task List Performance...');

  // Query counter for tracking N+1 queries
  const queryCounter = { count: 0, time: 0 };

  // Baseline: Full query with all includes
  const baselineExecutor = async () => {
    return await prisma.task.findMany({
      take: 50,
      include: {
        sector: true,
        customer: true,
        invoiceTo: true,
        createdBy: true,
        generalPainting: true,
        truck: true,
        serviceOrders: {
          include: {
            items: true,
          },
        },
        pricing: {
          include: {
            items: true,
          },
        },
        artworks: true,
        cuts: true,
        airbrushings: true,
        baseFiles: true,
        budgets: true,
        invoices: true,
        receipts: true,
        representatives: true,
      },
    });
  };

  // Optimized: Minimal fields for list view
  const optimizedExecutor = async () => {
    return await prisma.task.findMany({
      take: 50,
      select: {
        id: true,
        name: true,
        status: true,
        statusOrder: true,
        serialNumber: true,
        entryDate: true,
        forecastDate: true,
        commission: true,
        sector: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            fantasyName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        createdAt: true,
      },
    });
  };

  const baseline = await measurePerformance('baseline', baselineExecutor, queryCounter);
  const optimized = await measurePerformance('optimized', optimizedExecutor, queryCounter);

  const improvement = {
    executionTime: calculateImprovement(baseline.metrics.executionTime, optimized.metrics.executionTime),
    memoryUsed: calculateImprovement(baseline.metrics.memoryUsed, optimized.metrics.memoryUsed),
    payloadSize: calculateImprovement(baseline.metrics.payloadSize, optimized.metrics.payloadSize),
    queryCount: baseline.metrics.queryCount - optimized.metrics.queryCount,
    queryTime: calculateImprovement(baseline.metrics.queryTime, optimized.metrics.queryTime),
  };

  const passed =
    improvement.executionTime >= PERFORMANCE_THRESHOLDS.MIN_EXECUTION_TIME_IMPROVEMENT &&
    improvement.payloadSize >= PERFORMANCE_THRESHOLDS.MIN_PAYLOAD_SIZE_IMPROVEMENT &&
    optimized.metrics.executionTime <= PERFORMANCE_THRESHOLDS.MAX_EXECUTION_TIME_MS;

  return {
    testName: 'Task List Query Performance',
    baseline: baseline.metrics,
    optimized: optimized.metrics,
    improvement,
    passed,
    details: passed ? 'All performance targets met' : 'Some performance targets not met',
  };
}

/**
 * Test 2: Task Detail Query Performance
 * Baseline: All includes without selection
 * Optimized: Selective includes with field selection
 */
export async function testTaskDetailPerformance(prisma: PrismaClient): Promise<PerformanceTestResult> {
  console.log('\n🧪 Testing Task Detail Performance...');

  const queryCounter = { count: 0, time: 0 };

  // Get a task ID for testing
  const task = await prisma.task.findFirst({ select: { id: true } });
  if (!task) {
    throw new Error('No tasks found in database for testing');
  }

  // Baseline: Full includes
  const baselineExecutor = async () => {
    return await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        sector: true,
        customer: true,
        invoiceTo: true,
        createdBy: true,
        generalPainting: true,
        truck: true,
        serviceOrders: {
          include: {
            items: true,
          },
        },
        pricing: {
          include: {
            items: true,
          },
        },
        artworks: true,
        cuts: true,
        airbrushings: true,
        baseFiles: true,
        budgets: true,
        invoices: true,
        receipts: true,
        representatives: true,
        relatedTasks: true,
        relatedTo: true,
      },
    });
  };

  // Optimized: Selective includes with field selection
  const optimizedExecutor = async () => {
    return await prisma.task.findUnique({
      where: { id: task.id },
      select: {
        id: true,
        name: true,
        status: true,
        statusOrder: true,
        serialNumber: true,
        details: true,
        entryDate: true,
        term: true,
        forecastDate: true,
        startedAt: true,
        finishedAt: true,
        commission: true,
        sector: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            fantasyName: true,
            phone: true,
            email: true,
          },
        },
        invoiceTo: {
          select: {
            id: true,
            fantasyName: true,
            cnpj: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        generalPainting: {
          select: {
            id: true,
            name: true,
            code: true,
            // Exclude heavy formula field
          },
        },
        truck: {
          select: {
            id: true,
            licensePlate: true,
            category: true,
          },
        },
        serviceOrders: {
          select: {
            id: true,
            type: true,
            status: true,
            quantity: true,
            items: {
              select: {
                id: true,
                description: true,
                quantity: true,
              },
            },
          },
        },
        pricing: {
          select: {
            id: true,
            totalPrice: true,
            items: {
              select: {
                id: true,
                description: true,
                price: true,
                quantity: true,
              },
            },
          },
        },
        representatives: {
          select: {
            id: true,
            name: true,
            role: true,
            phone: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });
  };

  const baseline = await measurePerformance('baseline', baselineExecutor, queryCounter);
  const optimized = await measurePerformance('optimized', optimizedExecutor, queryCounter);

  const improvement = {
    executionTime: calculateImprovement(baseline.metrics.executionTime, optimized.metrics.executionTime),
    memoryUsed: calculateImprovement(baseline.metrics.memoryUsed, optimized.metrics.memoryUsed),
    payloadSize: calculateImprovement(baseline.metrics.payloadSize, optimized.metrics.payloadSize),
    queryCount: baseline.metrics.queryCount - optimized.metrics.queryCount,
    queryTime: calculateImprovement(baseline.metrics.queryTime, optimized.metrics.queryTime),
  };

  const passed =
    improvement.executionTime >= PERFORMANCE_THRESHOLDS.MIN_EXECUTION_TIME_IMPROVEMENT &&
    improvement.payloadSize >= PERFORMANCE_THRESHOLDS.MIN_PAYLOAD_SIZE_IMPROVEMENT;

  return {
    testName: 'Task Detail Query Performance',
    baseline: baseline.metrics,
    optimized: optimized.metrics,
    improvement,
    passed,
  };
}

/**
 * Test 3: Task Form Query Performance
 * Tests performance for form edit scenarios
 */
export async function testTaskFormPerformance(prisma: PrismaClient): Promise<PerformanceTestResult> {
  console.log('\n🧪 Testing Task Form Performance...');

  const queryCounter = { count: 0, time: 0 };

  const task = await prisma.task.findFirst({ select: { id: true } });
  if (!task) {
    throw new Error('No tasks found in database for testing');
  }

  // Baseline: Include all relations
  const baselineExecutor = async () => {
    return await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        sector: true,
        customer: true,
        invoiceTo: true,
        createdBy: true,
        generalPainting: true,
        truck: true,
        serviceOrders: true,
        pricing: true,
        artworks: true,
        cuts: true,
        airbrushings: true,
        representatives: true,
      },
    });
  };

  // Optimized: Only fields needed for form
  const optimizedExecutor = async () => {
    return await prisma.task.findUnique({
      where: { id: task.id },
      select: {
        id: true,
        name: true,
        status: true,
        details: true,
        entryDate: true,
        term: true,
        forecastDate: true,
        commission: true,
        sectorId: true,
        customerId: true,
        invoiceToId: true,
        paintId: true,
        // Include only IDs for relations (for dropdowns)
        sector: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            fantasyName: true,
          },
        },
        representatives: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });
  };

  const baseline = await measurePerformance('baseline', baselineExecutor, queryCounter);
  const optimized = await measurePerformance('optimized', optimizedExecutor, queryCounter);

  const improvement = {
    executionTime: calculateImprovement(baseline.metrics.executionTime, optimized.metrics.executionTime),
    memoryUsed: calculateImprovement(baseline.metrics.memoryUsed, optimized.metrics.memoryUsed),
    payloadSize: calculateImprovement(baseline.metrics.payloadSize, optimized.metrics.payloadSize),
    queryCount: baseline.metrics.queryCount - optimized.metrics.queryCount,
    queryTime: calculateImprovement(baseline.metrics.queryTime, optimized.metrics.queryTime),
  };

  const passed = improvement.payloadSize >= PERFORMANCE_THRESHOLDS.MIN_PAYLOAD_SIZE_IMPROVEMENT;

  return {
    testName: 'Task Form Query Performance',
    baseline: baseline.metrics,
    optimized: optimized.metrics,
    improvement,
    passed,
  };
}

/**
 * Print performance test results
 */
export function printPerformanceResults(results: PerformanceTestResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 PERFORMANCE TEST RESULTS');
  console.log('='.repeat(80));

  let allPassed = true;

  results.forEach((result) => {
    console.log(`\n${result.passed ? '✅' : '❌'} ${result.testName}`);
    console.log('-'.repeat(80));

    // Baseline metrics
    console.log('\n📈 Baseline Metrics:');
    console.log(`  Execution Time: ${formatMs(result.baseline.executionTime)}`);
    console.log(`  Memory Used: ${formatBytes(result.baseline.memoryUsed)}`);
    console.log(`  Payload Size: ${formatBytes(result.baseline.payloadSize)}`);
    console.log(`  Query Count: ${result.baseline.queryCount}`);

    // Optimized metrics
    console.log('\n⚡ Optimized Metrics:');
    console.log(`  Execution Time: ${formatMs(result.optimized.executionTime)}`);
    console.log(`  Memory Used: ${formatBytes(result.optimized.memoryUsed)}`);
    console.log(`  Payload Size: ${formatBytes(result.optimized.payloadSize)}`);
    console.log(`  Query Count: ${result.optimized.queryCount}`);

    // Improvements
    console.log('\n📊 Improvements:');
    console.log(`  Execution Time: ${result.improvement.executionTime.toFixed(2)}% faster`);
    console.log(`  Memory Used: ${result.improvement.memoryUsed.toFixed(2)}% less`);
    console.log(`  Payload Size: ${result.improvement.payloadSize.toFixed(2)}% smaller`);
    console.log(`  Query Count: ${result.improvement.queryCount} fewer queries`);

    // Size reduction details
    const baselineKB = (result.baseline.payloadSize / 1024).toFixed(2);
    const optimizedKB = (result.optimized.payloadSize / 1024).toFixed(2);
    const savedKB = (parseFloat(baselineKB) - parseFloat(optimizedKB)).toFixed(2);
    console.log(`\n💾 Payload Size Reduction:`);
    console.log(`  Before: ${baselineKB} KB`);
    console.log(`  After: ${optimizedKB} KB`);
    console.log(`  Saved: ${savedKB} KB (${result.improvement.payloadSize.toFixed(2)}% reduction)`);

    if (result.details) {
      console.log(`\n📝 Details: ${result.details}`);
    }

    if (!result.passed) {
      allPassed = false;
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log(allPassed ? '✅ ALL PERFORMANCE TESTS PASSED' : '❌ SOME PERFORMANCE TESTS FAILED');
  console.log('='.repeat(80) + '\n');
}

/**
 * Run all performance tests
 */
export async function runPerformanceTests(): Promise<void> {
  console.log('🚀 Starting Performance Measurement Tests...\n');

  const prisma = new PrismaClient({
    log: [
      {
        emit: 'event',
        level: 'query',
      },
    ],
  });

  try {
    const results: PerformanceTestResult[] = [];

    // Run all tests
    results.push(await testTaskListPerformance(prisma));
    results.push(await testTaskDetailPerformance(prisma));
    results.push(await testTaskFormPerformance(prisma));

    // Print results
    printPerformanceResults(results);

    // Exit with appropriate code
    const allPassed = results.every((r) => r.passed);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('❌ Performance tests failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests if executed directly
if (require.main === module) {
  runPerformanceTests();
}
