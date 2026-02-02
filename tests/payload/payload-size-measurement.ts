/**
 * Payload Size Measurement Script
 *
 * Measures and compares payload sizes across different scenarios:
 * - List views vs detail views
 * - With/without field selection
 * - With/without nested relations
 * - Provides detailed size breakdowns
 */

import { PrismaClient } from '@prisma/client';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

interface PayloadSizeMetrics {
  testName: string;
  scenario: string;
  uncompressedSize: number;
  compressedSize: number;
  recordCount: number;
  avgSizePerRecord: number;
  avgCompressedSizePerRecord: number;
  compressionRatio: number;
  fields: number;
  nestedFields: number;
}

interface PayloadComparison {
  baseline: PayloadSizeMetrics;
  optimized: PayloadSizeMetrics;
  reduction: {
    uncompressed: number; // bytes
    compressed: number; // bytes
    uncompressedPercent: number;
    compressedPercent: number;
  };
  passed: boolean;
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Count fields in an object (including nested)
 */
function countFields(obj: any): { total: number; nested: number } {
  if (!obj || typeof obj !== 'object') return { total: 0, nested: 0 };

  let total = 0;
  let nested = 0;

  for (const key of Object.keys(obj)) {
    total++;
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)) {
      nested++;
      const subCount = countFields(obj[key]);
      total += subCount.total;
      nested += subCount.nested;
    } else if (Array.isArray(obj[key]) && obj[key].length > 0 && typeof obj[key][0] === 'object') {
      nested++;
      const subCount = countFields(obj[key][0]);
      total += subCount.total;
      nested += subCount.nested;
    }
  }

  return { total, nested };
}

/**
 * Measure payload size for a query result
 */
async function measurePayloadSize(
  testName: string,
  scenario: string,
  data: any,
): Promise<PayloadSizeMetrics> {
  const json = JSON.stringify(data);
  const uncompressedSize = Buffer.byteLength(json, 'utf8');

  // Measure compressed size (as it would be sent over network with gzip)
  const compressed = await gzip(json);
  const compressedSize = compressed.length;

  const recordCount = Array.isArray(data) ? data.length : 1;
  const sampleRecord = Array.isArray(data) ? data[0] : data;
  const { total: fields, nested: nestedFields } = countFields(sampleRecord);

  return {
    testName,
    scenario,
    uncompressedSize,
    compressedSize,
    recordCount,
    avgSizePerRecord: recordCount > 0 ? uncompressedSize / recordCount : 0,
    avgCompressedSizePerRecord: recordCount > 0 ? compressedSize / recordCount : 0,
    compressionRatio: uncompressedSize > 0 ? (compressedSize / uncompressedSize) * 100 : 0,
    fields,
    nestedFields,
  };
}

/**
 * Test 1: Task List Payload Size
 */
export async function testTaskListPayloadSize(prisma: PrismaClient): Promise<PayloadComparison> {
  console.log('\n📦 Measuring Task List Payload Size...');

  // Baseline: Full includes
  const baseline = await prisma.task.findMany({
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

  // Optimized: Minimal fields for list
  const optimized = await prisma.task.findMany({
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

  const baselineMetrics = await measurePayloadSize('Task List', 'Baseline (Full Include)', baseline);
  const optimizedMetrics = await measurePayloadSize('Task List', 'Optimized (Minimal Select)', optimized);

  const reduction = {
    uncompressed: baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize,
    compressed: baselineMetrics.compressedSize - optimizedMetrics.compressedSize,
    uncompressedPercent:
      baselineMetrics.uncompressedSize > 0
        ? ((baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize) /
            baselineMetrics.uncompressedSize) *
          100
        : 0,
    compressedPercent:
      baselineMetrics.compressedSize > 0
        ? ((baselineMetrics.compressedSize - optimizedMetrics.compressedSize) / baselineMetrics.compressedSize) *
          100
        : 0,
  };

  const passed = reduction.uncompressedPercent >= 30; // At least 30% reduction

  return {
    baseline: baselineMetrics,
    optimized: optimizedMetrics,
    reduction,
    passed,
  };
}

/**
 * Test 2: Task Detail Payload Size
 */
export async function testTaskDetailPayloadSize(prisma: PrismaClient): Promise<PayloadComparison> {
  console.log('\n📦 Measuring Task Detail Payload Size...');

  const task = await prisma.task.findFirst({ select: { id: true } });
  if (!task) {
    throw new Error('No tasks found for testing');
  }

  // Baseline: Full includes
  const baseline = await prisma.task.findUnique({
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

  // Optimized: Selective fields
  const optimized = await prisma.task.findUnique({
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
        },
      },
      pricing: {
        select: {
          id: true,
          totalPrice: true,
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

  const baselineMetrics = await measurePayloadSize('Task Detail', 'Baseline (Full Include)', baseline);
  const optimizedMetrics = await measurePayloadSize('Task Detail', 'Optimized (Selective Fields)', optimized);

  const reduction = {
    uncompressed: baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize,
    compressed: baselineMetrics.compressedSize - optimizedMetrics.compressedSize,
    uncompressedPercent:
      baselineMetrics.uncompressedSize > 0
        ? ((baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize) /
            baselineMetrics.uncompressedSize) *
          100
        : 0,
    compressedPercent:
      baselineMetrics.compressedSize > 0
        ? ((baselineMetrics.compressedSize - optimizedMetrics.compressedSize) / baselineMetrics.compressedSize) *
          100
        : 0,
  };

  const passed = reduction.uncompressedPercent >= 20; // At least 20% reduction

  return {
    baseline: baselineMetrics,
    optimized: optimizedMetrics,
    reduction,
    passed,
  };
}

/**
 * Test 3: Heavy Field Impact
 */
export async function testHeavyFieldImpact(prisma: PrismaClient): Promise<PayloadComparison> {
  console.log('\n📦 Measuring Heavy Field Impact...');

  const task = await prisma.task.findFirst({
    where: {
      generalPainting: {
        isNot: null,
      },
    },
    select: { id: true },
  });

  if (!task) {
    console.log('  ⚠️  No tasks with paint found - using first task');
    const anyTask = await prisma.task.findFirst({ select: { id: true } });
    if (!anyTask) throw new Error('No tasks found');
    task.id = anyTask.id;
  }

  // With heavy formula field
  const withFormula = await prisma.task.findUnique({
    where: { id: task.id },
    select: {
      id: true,
      name: true,
      generalPainting: {
        select: {
          id: true,
          name: true,
          code: true,
          formula: true, // Heavy JSON field
        },
      },
    },
  });

  // Without heavy formula field
  const withoutFormula = await prisma.task.findUnique({
    where: { id: task.id },
    select: {
      id: true,
      name: true,
      generalPainting: {
        select: {
          id: true,
          name: true,
          code: true,
          // Exclude formula
        },
      },
    },
  });

  const baselineMetrics = await measurePayloadSize('Heavy Field Impact', 'With Formula', withFormula);
  const optimizedMetrics = await measurePayloadSize('Heavy Field Impact', 'Without Formula', withoutFormula);

  const reduction = {
    uncompressed: baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize,
    compressed: baselineMetrics.compressedSize - optimizedMetrics.compressedSize,
    uncompressedPercent:
      baselineMetrics.uncompressedSize > 0
        ? ((baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize) /
            baselineMetrics.uncompressedSize) *
          100
        : 0,
    compressedPercent:
      baselineMetrics.compressedSize > 0
        ? ((baselineMetrics.compressedSize - optimizedMetrics.compressedSize) / baselineMetrics.compressedSize) *
          100
        : 0,
  };

  const passed = true; // Information only, always pass

  return {
    baseline: baselineMetrics,
    optimized: optimizedMetrics,
    reduction,
    passed,
  };
}

/**
 * Test 4: Network Transfer Simulation
 */
export async function testNetworkTransferSize(prisma: PrismaClient): Promise<PayloadComparison> {
  console.log('\n📦 Measuring Network Transfer Size...');

  // Simulate typical API response with pagination
  const baseline = await prisma.task.findMany({
    take: 20,
    include: {
      sector: true,
      customer: true,
      createdBy: true,
      serviceOrders: true,
      pricing: true,
    },
  });

  const optimized = await prisma.task.findMany({
    take: 20,
    select: {
      id: true,
      name: true,
      status: true,
      serialNumber: true,
      customer: {
        select: {
          id: true,
          fantasyName: true,
        },
      },
    },
  });

  // Wrap in typical API response format
  const baselineResponse = {
    data: baseline,
    meta: {
      total: baseline.length,
      page: 1,
      pageSize: 20,
    },
  };

  const optimizedResponse = {
    data: optimized,
    meta: {
      total: optimized.length,
      page: 1,
      pageSize: 20,
    },
  };

  const baselineMetrics = await measurePayloadSize('Network Transfer', 'Full Response', baselineResponse);
  const optimizedMetrics = await measurePayloadSize('Network Transfer', 'Optimized Response', optimizedResponse);

  const reduction = {
    uncompressed: baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize,
    compressed: baselineMetrics.compressedSize - optimizedMetrics.compressedSize,
    uncompressedPercent:
      baselineMetrics.uncompressedSize > 0
        ? ((baselineMetrics.uncompressedSize - optimizedMetrics.uncompressedSize) /
            baselineMetrics.uncompressedSize) *
          100
        : 0,
    compressedPercent:
      baselineMetrics.compressedSize > 0
        ? ((baselineMetrics.compressedSize - optimizedMetrics.compressedSize) / baselineMetrics.compressedSize) *
          100
        : 0,
  };

  // Calculate bandwidth savings for typical usage
  const requestsPerDay = 1000; // Estimated API requests per day
  const dailySavingsKB = (reduction.compressed * requestsPerDay) / 1024;
  const monthlySavingsKB = dailySavingsKB * 30;

  console.log(`  💾 Daily bandwidth savings: ${dailySavingsKB.toFixed(2)} KB`);
  console.log(`  💾 Monthly bandwidth savings: ${monthlySavingsKB.toFixed(2)} KB (${(monthlySavingsKB / 1024).toFixed(2)} MB)`);

  const passed = reduction.compressedPercent >= 30;

  return {
    baseline: baselineMetrics,
    optimized: optimizedMetrics,
    reduction,
    passed,
  };
}

/**
 * Print payload size comparison results
 */
function printPayloadComparison(comparison: PayloadComparison): void {
  console.log(`\n${comparison.passed ? '✅' : '❌'} ${comparison.baseline.testName}`);
  console.log('-'.repeat(80));

  // Baseline
  console.log(`\n📊 ${comparison.baseline.scenario}:`);
  console.log(`  Uncompressed: ${formatBytes(comparison.baseline.uncompressedSize)}`);
  console.log(`  Compressed (gzip): ${formatBytes(comparison.baseline.compressedSize)}`);
  console.log(`  Compression Ratio: ${comparison.baseline.compressionRatio.toFixed(2)}%`);
  console.log(`  Records: ${comparison.baseline.recordCount}`);
  console.log(`  Avg per Record: ${formatBytes(comparison.baseline.avgSizePerRecord)}`);
  console.log(`  Fields: ${comparison.baseline.fields} (${comparison.baseline.nestedFields} nested)`);

  // Optimized
  console.log(`\n⚡ ${comparison.optimized.scenario}:`);
  console.log(`  Uncompressed: ${formatBytes(comparison.optimized.uncompressedSize)}`);
  console.log(`  Compressed (gzip): ${formatBytes(comparison.optimized.compressedSize)}`);
  console.log(`  Compression Ratio: ${comparison.optimized.compressionRatio.toFixed(2)}%`);
  console.log(`  Records: ${comparison.optimized.recordCount}`);
  console.log(`  Avg per Record: ${formatBytes(comparison.optimized.avgSizePerRecord)}`);
  console.log(`  Fields: ${comparison.optimized.fields} (${comparison.optimized.nestedFields} nested)`);

  // Reduction
  console.log(`\n📉 Reduction:`);
  console.log(`  Uncompressed: ${formatBytes(comparison.reduction.uncompressed)} (${comparison.reduction.uncompressedPercent.toFixed(2)}%)`);
  console.log(`  Compressed: ${formatBytes(comparison.reduction.compressed)} (${comparison.reduction.compressedPercent.toFixed(2)}%)`);
  console.log(
    `  Field Count: ${comparison.baseline.fields - comparison.optimized.fields} fields removed (${((1 - comparison.optimized.fields / comparison.baseline.fields) * 100).toFixed(2)}%)`,
  );
}

/**
 * Run all payload size tests
 */
export async function runPayloadSizeTests(): Promise<void> {
  console.log('🚀 Starting Payload Size Measurement Tests...\n');
  console.log('='.repeat(80));

  const prisma = new PrismaClient();

  try {
    const comparisons: PayloadComparison[] = [];

    // Run all tests
    comparisons.push(await testTaskListPayloadSize(prisma));
    comparisons.push(await testTaskDetailPayloadSize(prisma));
    comparisons.push(await testHeavyFieldImpact(prisma));
    comparisons.push(await testNetworkTransferSize(prisma));

    // Print results
    console.log('\n' + '='.repeat(80));
    console.log('📊 PAYLOAD SIZE TEST RESULTS');
    console.log('='.repeat(80));

    comparisons.forEach(printPayloadComparison);

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📈 SUMMARY');
    console.log('='.repeat(80));

    const avgReduction =
      comparisons.reduce((sum, c) => sum + c.reduction.compressedPercent, 0) / comparisons.length;
    const totalBaselineSize = comparisons.reduce((sum, c) => sum + c.baseline.compressedSize, 0);
    const totalOptimizedSize = comparisons.reduce((sum, c) => sum + c.optimized.compressedSize, 0);
    const totalReduction = totalBaselineSize - totalOptimizedSize;

    console.log(`\n  Average Payload Reduction: ${avgReduction.toFixed(2)}%`);
    console.log(`  Total Baseline Size: ${formatBytes(totalBaselineSize)}`);
    console.log(`  Total Optimized Size: ${formatBytes(totalOptimizedSize)}`);
    console.log(`  Total Reduction: ${formatBytes(totalReduction)}`);

    const allPassed = comparisons.every((c) => c.passed);
    console.log(`\n  ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    console.log('='.repeat(80) + '\n');

    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('❌ Payload size tests failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests if executed directly
if (require.main === module) {
  runPayloadSizeTests();
}
