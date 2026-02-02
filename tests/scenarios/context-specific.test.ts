/**
 * Context-Specific Test Scenarios
 *
 * Tests different use cases to ensure optimizations work correctly:
 * - List/Table views (minimal data for display)
 * - Form views (data for editing)
 * - Detail views (comprehensive data for viewing)
 * - Export scenarios (data for reports/exports)
 */

import { PrismaClient } from '@prisma/client';

interface ContextTestResult {
  context: string;
  scenario: string;
  passed: boolean;
  metrics: {
    responseTime: number;
    payloadSize: number;
    fieldCount: number;
    recordCount: number;
  };
  validations: {
    hasRequiredFields: boolean;
    excludesUnnecessaryFields: boolean;
    meetsPerformanceTarget: boolean;
    meetsSizeTarget: boolean;
  };
  errors: string[];
}

/**
 * Performance targets for different contexts
 */
const CONTEXT_TARGETS = {
  list: {
    maxResponseTimeMs: 500,
    maxPayloadSizeKB: 100,
    maxFieldsPerRecord: 15,
  },
  form: {
    maxResponseTimeMs: 300,
    maxPayloadSizeKB: 50,
    maxFieldsPerRecord: 20,
  },
  detail: {
    maxResponseTimeMs: 800,
    maxPayloadSizeKB: 200,
    maxFieldsPerRecord: 50,
  },
  export: {
    maxResponseTimeMs: 5000,
    maxPayloadSizeKB: 5000, // 5MB for exports
    maxFieldsPerRecord: 100,
  },
};

/**
 * Count fields in an object
 */
function countFields(obj: any): number {
  if (!obj || typeof obj !== 'object') return 0;
  let count = 0;
  for (const key of Object.keys(obj)) {
    count++;
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)) {
      count += countFields(obj[key]);
    }
  }
  return count;
}

/**
 * Scenario 1: List/Table View
 * Display tasks in a table with pagination
 */
export async function testListTableView(prisma: PrismaClient): Promise<ContextTestResult> {
  console.log('\n🔍 Testing List/Table View Scenario...');

  const errors: string[] = [];
  const startTime = performance.now();

  const tasks = await prisma.task.findMany({
    take: 50,
    skip: 0,
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
        },
      },
      createdAt: true,
    },
    orderBy: {
      serialNumber: 'desc',
    },
  });

  const endTime = performance.now();
  const responseTime = endTime - startTime;

  const payloadSize = Buffer.byteLength(JSON.stringify(tasks), 'utf8');
  const fieldCount = tasks.length > 0 ? countFields(tasks[0]) : 0;

  // Validations
  const requiredFields = ['id', 'name', 'status', 'serialNumber', 'customer'];
  const unnecessaryFields = ['details', 'serviceOrders', 'pricing', 'artworks'];

  let hasRequiredFields = true;
  if (tasks.length > 0) {
    const task = tasks[0];
    requiredFields.forEach((field) => {
      if (!(field in task)) {
        hasRequiredFields = false;
        errors.push(`Missing required field for list view: ${field}`);
      }
    });
  }

  let excludesUnnecessaryFields = true;
  if (tasks.length > 0) {
    const task = tasks[0];
    unnecessaryFields.forEach((field) => {
      if (field in task) {
        excludesUnnecessaryFields = false;
        errors.push(`Unnecessary field included in list view: ${field}`);
      }
    });
  }

  const meetsPerformanceTarget = responseTime <= CONTEXT_TARGETS.list.maxResponseTimeMs;
  const meetsSizeTarget = payloadSize / 1024 <= CONTEXT_TARGETS.list.maxPayloadSizeKB;

  if (!meetsPerformanceTarget) {
    errors.push(
      `Response time ${responseTime.toFixed(2)}ms exceeds target ${CONTEXT_TARGETS.list.maxResponseTimeMs}ms`,
    );
  }

  if (!meetsSizeTarget) {
    errors.push(
      `Payload size ${(payloadSize / 1024).toFixed(2)}KB exceeds target ${CONTEXT_TARGETS.list.maxPayloadSizeKB}KB`,
    );
  }

  const passed = hasRequiredFields && excludesUnnecessaryFields && meetsPerformanceTarget && meetsSizeTarget;

  console.log(`  Response Time: ${responseTime.toFixed(2)}ms`);
  console.log(`  Payload Size: ${(payloadSize / 1024).toFixed(2)}KB`);
  console.log(`  Field Count: ${fieldCount}`);
  console.log(`  Record Count: ${tasks.length}`);

  return {
    context: 'List/Table View',
    scenario: 'Display tasks in paginated table',
    passed,
    metrics: {
      responseTime,
      payloadSize,
      fieldCount,
      recordCount: tasks.length,
    },
    validations: {
      hasRequiredFields,
      excludesUnnecessaryFields,
      meetsPerformanceTarget,
      meetsSizeTarget,
    },
    errors,
  };
}

/**
 * Scenario 2: Form View (Edit)
 * Load task data for editing in a form
 */
export async function testFormEditView(prisma: PrismaClient): Promise<ContextTestResult> {
  console.log('\n🔍 Testing Form Edit View Scenario...');

  const errors: string[] = [];

  const task = await prisma.task.findFirst({ select: { id: true } });
  if (!task) {
    throw new Error('No tasks found for testing');
  }

  const startTime = performance.now();

  const formData = await prisma.task.findUnique({
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
      // Foreign keys for dropdowns
      sectorId: true,
      customerId: true,
      invoiceToId: true,
      paintId: true,
      // Minimal relation data for display
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
      invoiceTo: {
        select: {
          id: true,
          fantasyName: true,
        },
      },
      generalPainting: {
        select: {
          id: true,
          name: true,
          code: true,
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

  const endTime = performance.now();
  const responseTime = endTime - startTime;

  const payloadSize = Buffer.byteLength(JSON.stringify(formData), 'utf8');
  const fieldCount = formData ? countFields(formData) : 0;

  // Validations
  const requiredFields = ['id', 'name', 'status', 'sectorId', 'customerId'];
  const unnecessaryFields = ['serviceOrders', 'pricing', 'artworks', 'createdAt', 'updatedAt'];

  let hasRequiredFields = true;
  if (formData) {
    requiredFields.forEach((field) => {
      if (!(field in formData)) {
        hasRequiredFields = false;
        errors.push(`Missing required field for form view: ${field}`);
      }
    });
  }

  let excludesUnnecessaryFields = true;
  if (formData) {
    unnecessaryFields.forEach((field) => {
      if (field in formData) {
        excludesUnnecessaryFields = false;
        errors.push(`Unnecessary field included in form view: ${field}`);
      }
    });
  }

  const meetsPerformanceTarget = responseTime <= CONTEXT_TARGETS.form.maxResponseTimeMs;
  const meetsSizeTarget = payloadSize / 1024 <= CONTEXT_TARGETS.form.maxPayloadSizeKB;

  if (!meetsPerformanceTarget) {
    errors.push(
      `Response time ${responseTime.toFixed(2)}ms exceeds target ${CONTEXT_TARGETS.form.maxResponseTimeMs}ms`,
    );
  }

  if (!meetsSizeTarget) {
    errors.push(
      `Payload size ${(payloadSize / 1024).toFixed(2)}KB exceeds target ${CONTEXT_TARGETS.form.maxPayloadSizeKB}KB`,
    );
  }

  const passed = hasRequiredFields && excludesUnnecessaryFields && meetsPerformanceTarget && meetsSizeTarget;

  console.log(`  Response Time: ${responseTime.toFixed(2)}ms`);
  console.log(`  Payload Size: ${(payloadSize / 1024).toFixed(2)}KB`);
  console.log(`  Field Count: ${fieldCount}`);

  return {
    context: 'Form Edit View',
    scenario: 'Load task for editing',
    passed,
    metrics: {
      responseTime,
      payloadSize,
      fieldCount,
      recordCount: 1,
    },
    validations: {
      hasRequiredFields,
      excludesUnnecessaryFields,
      meetsPerformanceTarget,
      meetsSizeTarget,
    },
    errors,
  };
}

/**
 * Scenario 3: Detail View
 * Display comprehensive task information
 */
export async function testDetailView(prisma: PrismaClient): Promise<ContextTestResult> {
  console.log('\n🔍 Testing Detail View Scenario...');

  const errors: string[] = [];

  const task = await prisma.task.findFirst({ select: { id: true } });
  if (!task) {
    throw new Error('No tasks found for testing');
  }

  const startTime = performance.now();

  const detailData = await prisma.task.findUnique({
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
          description: true,
        },
      },
      customer: {
        select: {
          id: true,
          fantasyName: true,
          corporateName: true,
          phone: true,
          email: true,
          address: true,
        },
      },
      invoiceTo: {
        select: {
          id: true,
          fantasyName: true,
          corporateName: true,
          cnpj: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      generalPainting: {
        select: {
          id: true,
          name: true,
          code: true,
          // Exclude formula - loaded separately if needed
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
          position: true,
        },
      },
      pricing: {
        select: {
          id: true,
          totalPrice: true,
          discount: true,
          finalPrice: true,
        },
      },
      representatives: {
        select: {
          id: true,
          name: true,
          role: true,
          phone: true,
          email: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  });

  const endTime = performance.now();
  const responseTime = endTime - startTime;

  const payloadSize = Buffer.byteLength(JSON.stringify(detailData), 'utf8');
  const fieldCount = detailData ? countFields(detailData) : 0;

  // Validations
  const requiredFields = [
    'id',
    'name',
    'status',
    'details',
    'customer',
    'sector',
    'serviceOrders',
    'pricing',
    'representatives',
  ];
  const unnecessaryFields = [
    'generalPainting.formula', // Too heavy, load separately
  ];

  let hasRequiredFields = true;
  if (detailData) {
    requiredFields.forEach((field) => {
      const parts = field.split('.');
      let obj: any = detailData;
      for (const part of parts) {
        if (!(part in obj)) {
          hasRequiredFields = false;
          errors.push(`Missing required field for detail view: ${field}`);
          break;
        }
        obj = obj[part];
      }
    });
  }

  let excludesUnnecessaryFields = true;
  // Check that formula is not included
  if (detailData && detailData.generalPainting && 'formula' in (detailData.generalPainting as any)) {
    excludesUnnecessaryFields = false;
    errors.push('Heavy field (formula) should be excluded from detail view');
  }

  const meetsPerformanceTarget = responseTime <= CONTEXT_TARGETS.detail.maxResponseTimeMs;
  const meetsSizeTarget = payloadSize / 1024 <= CONTEXT_TARGETS.detail.maxPayloadSizeKB;

  if (!meetsPerformanceTarget) {
    errors.push(
      `Response time ${responseTime.toFixed(2)}ms exceeds target ${CONTEXT_TARGETS.detail.maxResponseTimeMs}ms`,
    );
  }

  if (!meetsSizeTarget) {
    errors.push(
      `Payload size ${(payloadSize / 1024).toFixed(2)}KB exceeds target ${CONTEXT_TARGETS.detail.maxPayloadSizeKB}KB`,
    );
  }

  const passed = hasRequiredFields && excludesUnnecessaryFields && meetsPerformanceTarget && meetsSizeTarget;

  console.log(`  Response Time: ${responseTime.toFixed(2)}ms`);
  console.log(`  Payload Size: ${(payloadSize / 1024).toFixed(2)}KB`);
  console.log(`  Field Count: ${fieldCount}`);

  return {
    context: 'Detail View',
    scenario: 'Display comprehensive task information',
    passed,
    metrics: {
      responseTime,
      payloadSize,
      fieldCount,
      recordCount: 1,
    },
    validations: {
      hasRequiredFields,
      excludesUnnecessaryFields,
      meetsPerformanceTarget,
      meetsSizeTarget,
    },
    errors,
  };
}

/**
 * Scenario 4: Search/Filter
 * Search tasks with filters
 */
export async function testSearchFilter(prisma: PrismaClient): Promise<ContextTestResult> {
  console.log('\n🔍 Testing Search/Filter Scenario...');

  const errors: string[] = [];
  const startTime = performance.now();

  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        {
          name: {
            contains: 'test',
            mode: 'insensitive',
          },
        },
        {
          customer: {
            fantasyName: {
              contains: 'test',
              mode: 'insensitive',
            },
          },
        },
      ],
      status: {
        in: ['PENDING', 'IN_PROGRESS'],
      },
    },
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
      sector: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      serialNumber: 'desc',
    },
  });

  const endTime = performance.now();
  const responseTime = endTime - startTime;

  const payloadSize = Buffer.byteLength(JSON.stringify(tasks), 'utf8');
  const fieldCount = tasks.length > 0 ? countFields(tasks[0]) : 0;

  const meetsPerformanceTarget = responseTime <= CONTEXT_TARGETS.list.maxResponseTimeMs;
  const meetsSizeTarget = payloadSize / 1024 <= CONTEXT_TARGETS.list.maxPayloadSizeKB;

  if (!meetsPerformanceTarget) {
    errors.push(
      `Response time ${responseTime.toFixed(2)}ms exceeds target ${CONTEXT_TARGETS.list.maxResponseTimeMs}ms`,
    );
  }

  const passed = meetsPerformanceTarget && meetsSizeTarget;

  console.log(`  Response Time: ${responseTime.toFixed(2)}ms`);
  console.log(`  Payload Size: ${(payloadSize / 1024).toFixed(2)}KB`);
  console.log(`  Field Count: ${fieldCount}`);
  console.log(`  Results: ${tasks.length}`);

  return {
    context: 'Search/Filter',
    scenario: 'Search tasks with filters',
    passed,
    metrics: {
      responseTime,
      payloadSize,
      fieldCount,
      recordCount: tasks.length,
    },
    validations: {
      hasRequiredFields: true,
      excludesUnnecessaryFields: true,
      meetsPerformanceTarget,
      meetsSizeTarget,
    },
    errors,
  };
}

/**
 * Scenario 5: Dashboard/Statistics
 * Load summary data for dashboard
 */
export async function testDashboardStats(prisma: PrismaClient): Promise<ContextTestResult> {
  console.log('\n🔍 Testing Dashboard/Statistics Scenario...');

  const errors: string[] = [];
  const startTime = performance.now();

  // Fetch minimal data for statistics
  const [totalTasks, pendingTasks, inProgressTasks, completedTasks, recentTasks] = await Promise.all([
    prisma.task.count(),
    prisma.task.count({ where: { status: 'PENDING' } }),
    prisma.task.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.task.count({ where: { status: 'COMPLETED' } }),
    prisma.task.findMany({
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        serialNumber: true,
        customer: {
          select: {
            fantasyName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  const endTime = performance.now();
  const responseTime = endTime - startTime;

  const dashboardData = {
    stats: {
      total: totalTasks,
      pending: pendingTasks,
      inProgress: inProgressTasks,
      completed: completedTasks,
    },
    recentTasks,
  };

  const payloadSize = Buffer.byteLength(JSON.stringify(dashboardData), 'utf8');
  const fieldCount = recentTasks.length > 0 ? countFields(recentTasks[0]) : 0;

  const meetsPerformanceTarget = responseTime <= CONTEXT_TARGETS.list.maxResponseTimeMs;
  const meetsSizeTarget = payloadSize / 1024 <= CONTEXT_TARGETS.list.maxPayloadSizeKB;

  if (!meetsPerformanceTarget) {
    errors.push(
      `Response time ${responseTime.toFixed(2)}ms exceeds target ${CONTEXT_TARGETS.list.maxResponseTimeMs}ms`,
    );
  }

  const passed = meetsPerformanceTarget && meetsSizeTarget;

  console.log(`  Response Time: ${responseTime.toFixed(2)}ms`);
  console.log(`  Payload Size: ${(payloadSize / 1024).toFixed(2)}KB`);
  console.log(`  Field Count: ${fieldCount}`);

  return {
    context: 'Dashboard/Statistics',
    scenario: 'Load summary data for dashboard',
    passed,
    metrics: {
      responseTime,
      payloadSize,
      fieldCount,
      recordCount: recentTasks.length,
    },
    validations: {
      hasRequiredFields: true,
      excludesUnnecessaryFields: true,
      meetsPerformanceTarget,
      meetsSizeTarget,
    },
    errors,
  };
}

/**
 * Print context test results
 */
export function printContextTestResults(results: ContextTestResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('📋 CONTEXT-SPECIFIC TEST RESULTS');
  console.log('='.repeat(80));

  let allPassed = true;

  results.forEach((result) => {
    console.log(`\n${result.passed ? '✅' : '❌'} ${result.context}: ${result.scenario}`);
    console.log('-'.repeat(80));

    console.log('\n📊 Metrics:');
    console.log(`  Response Time: ${result.metrics.responseTime.toFixed(2)}ms`);
    console.log(`  Payload Size: ${(result.metrics.payloadSize / 1024).toFixed(2)}KB`);
    console.log(`  Field Count: ${result.metrics.fieldCount}`);
    console.log(`  Record Count: ${result.metrics.recordCount}`);

    console.log('\n✓ Validations:');
    console.log(`  Has Required Fields: ${result.validations.hasRequiredFields ? '✅' : '❌'}`);
    console.log(`  Excludes Unnecessary Fields: ${result.validations.excludesUnnecessaryFields ? '✅' : '❌'}`);
    console.log(`  Meets Performance Target: ${result.validations.meetsPerformanceTarget ? '✅' : '❌'}`);
    console.log(`  Meets Size Target: ${result.validations.meetsSizeTarget ? '✅' : '❌'}`);

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach((error) => {
        console.log(`  - ${error}`);
      });
    }

    if (!result.passed) {
      allPassed = false;
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log(allPassed ? '✅ ALL CONTEXT TESTS PASSED' : '❌ SOME CONTEXT TESTS FAILED');
  console.log('='.repeat(80) + '\n');
}

/**
 * Run all context-specific tests
 */
export async function runContextSpecificTests(): Promise<void> {
  console.log('🚀 Starting Context-Specific Tests...\n');

  const prisma = new PrismaClient();

  try {
    const results: ContextTestResult[] = [];

    // Run all tests
    results.push(await testListTableView(prisma));
    results.push(await testFormEditView(prisma));
    results.push(await testDetailView(prisma));
    results.push(await testSearchFilter(prisma));
    results.push(await testDashboardStats(prisma));

    // Print results
    printContextTestResults(results);

    // Exit with appropriate code
    const allPassed = results.every((r) => r.passed);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('❌ Context-specific tests failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests if executed directly
if (require.main === module) {
  runContextSpecificTests();
}
