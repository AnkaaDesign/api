/**
 * Backward Compatibility Test Suite
 *
 * Ensures that optimizations maintain backward compatibility:
 * - Existing API contracts are preserved
 * - All required fields are still available
 * - Default behaviors remain unchanged
 * - Migration paths are smooth
 */

import { PrismaClient } from '@prisma/client';

interface CompatibilityTestResult {
  testName: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Test 1: Verify all required Task fields are available
 */
export async function testTaskRequiredFields(prisma: PrismaClient): Promise<CompatibilityTestResult> {
  console.log('\n🧪 Testing Task Required Fields Availability...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const task = await prisma.task.findFirst();

    if (!task) {
      warnings.push('No tasks found in database - skipping field validation');
      return {
        testName: 'Task Required Fields',
        passed: true,
        errors,
        warnings,
      };
    }

    // Required fields that must always be present
    const requiredFields = [
      'id',
      'name',
      'status',
      'statusOrder',
      'serialNumber',
      'createdAt',
      'updatedAt',
      'sectorId',
    ];

    requiredFields.forEach((field) => {
      if (!(field in task)) {
        errors.push(`Required field '${field}' is missing from Task entity`);
      }
    });

    // Verify field types
    if (typeof task.id !== 'string') {
      errors.push('Task.id must be a string (UUID)');
    }
    if (typeof task.name !== 'string') {
      errors.push('Task.name must be a string');
    }
    if (typeof task.status !== 'string') {
      errors.push('Task.status must be a string');
    }
    if (typeof task.statusOrder !== 'number') {
      errors.push('Task.statusOrder must be a number');
    }
    if (typeof task.serialNumber !== 'number') {
      errors.push('Task.serialNumber must be a number');
    }

    console.log(`✓ Validated ${requiredFields.length} required fields`);
  } catch (error) {
    errors.push(`Failed to query task: ${error.message}`);
  }

  return {
    testName: 'Task Required Fields',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Test 2: Verify relation fields are accessible via include
 */
export async function testTaskRelationIncludes(prisma: PrismaClient): Promise<CompatibilityTestResult> {
  console.log('\n🧪 Testing Task Relation Includes...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const task = await prisma.task.findFirst({
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
        baseFiles: true,
        budgets: true,
        invoices: true,
        receipts: true,
        reimbursements: true,
        invoiceReimbursements: true,
        representatives: true,
        relatedTasks: true,
        relatedTo: true,
      },
    });

    if (!task) {
      warnings.push('No tasks found in database - skipping relation validation');
      return {
        testName: 'Task Relation Includes',
        passed: true,
        errors,
        warnings,
      };
    }

    // Verify all relation fields are accessible
    const relationFields = [
      'sector',
      'customer',
      'invoiceTo',
      'createdBy',
      'generalPainting',
      'truck',
      'serviceOrders',
      'pricing',
      'artworks',
      'cuts',
      'airbrushings',
      'baseFiles',
      'budgets',
      'invoices',
      'receipts',
      'reimbursements',
      'invoiceReimbursements',
      'representatives',
      'relatedTasks',
      'relatedTo',
    ];

    relationFields.forEach((field) => {
      if (!(field in task)) {
        errors.push(`Relation field '${field}' is not accessible via include`);
      }
    });

    // Verify representatives (migrated from negotiatingWith)
    if ('representatives' in task) {
      if (!Array.isArray(task.representatives)) {
        errors.push('Task.representatives must be an array');
      }
    } else {
      errors.push('Task.representatives is missing (migration from negotiatingWith may have failed)');
    }

    console.log(`✓ Validated ${relationFields.length} relation fields`);
  } catch (error) {
    errors.push(`Failed to query task with includes: ${error.message}`);
  }

  return {
    testName: 'Task Relation Includes',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Test 3: Verify select-based queries work
 */
export async function testTaskSelectQueries(prisma: PrismaClient): Promise<CompatibilityTestResult> {
  console.log('\n🧪 Testing Task Select Queries...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Test basic select
    const task1 = await prisma.task.findFirst({
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    if (task1) {
      if (!task1.id || !task1.name || !task1.status) {
        errors.push('Select query did not return requested fields');
      }
      if ('createdAt' in task1) {
        errors.push('Select query returned non-selected field (createdAt)');
      }
    }

    // Test select with nested relations
    const task2 = await prisma.task.findFirst({
      select: {
        id: true,
        name: true,
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
    });

    if (task2) {
      if (!task2.id || !task2.name) {
        errors.push('Nested select query did not return root fields');
      }
      if (task2.customer && (!task2.customer.id || !task2.customer.fantasyName)) {
        errors.push('Nested select query did not return nested fields correctly');
      }
    }

    // Test select with array relations
    const task3 = await prisma.task.findFirst({
      select: {
        id: true,
        representatives: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (task3) {
      if (!Array.isArray(task3.representatives)) {
        errors.push('Array relation in select query did not return array');
      }
    }

    console.log('✓ Validated select-based queries');
  } catch (error) {
    errors.push(`Failed to execute select queries: ${error.message}`);
  }

  return {
    testName: 'Task Select Queries',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Test 4: Verify default behavior (no select/include) still works
 */
export async function testTaskDefaultBehavior(prisma: PrismaClient): Promise<CompatibilityTestResult> {
  console.log('\n🧪 Testing Task Default Query Behavior...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Query without select or include should return all scalar fields
    const task = await prisma.task.findFirst();

    if (!task) {
      warnings.push('No tasks found in database - skipping default behavior validation');
      return {
        testName: 'Task Default Behavior',
        passed: true,
        errors,
        warnings,
      };
    }

    // Should have all scalar fields
    const expectedScalarFields = [
      'id',
      'name',
      'status',
      'statusOrder',
      'serialNumber',
      'details',
      'entryDate',
      'term',
      'forecastDate',
      'startedAt',
      'finishedAt',
      'commission',
      'sectorId',
      'customerId',
      'invoiceToId',
      'paintId',
      'createdById',
      'pricingId',
      'createdAt',
      'updatedAt',
    ];

    expectedScalarFields.forEach((field) => {
      if (!(field in task)) {
        errors.push(`Default query missing scalar field: ${field}`);
      }
    });

    // Should NOT have relation fields (unless explicitly included)
    const relationFields = ['sector', 'customer', 'invoiceTo', 'serviceOrders'];

    relationFields.forEach((field) => {
      if (field in task && task[field] !== null && task[field] !== undefined) {
        // If the field exists and is not just the foreign key
        if (typeof task[field] === 'object') {
          warnings.push(`Default query included relation field: ${field} (may impact performance)`);
        }
      }
    });

    console.log('✓ Validated default query behavior');
  } catch (error) {
    errors.push(`Failed to execute default query: ${error.message}`);
  }

  return {
    testName: 'Task Default Behavior',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Test 5: Verify representatives migration from negotiatingWith
 */
export async function testRepresentativesMigration(prisma: PrismaClient): Promise<CompatibilityTestResult> {
  console.log('\n🧪 Testing Representatives Migration...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Check that Representative entity exists
    const representativeCount = await prisma.representative.count();
    console.log(`  Found ${representativeCount} representatives in database`);

    // Check task-representative relation
    const taskWithReps = await prisma.task.findFirst({
      where: {
        representatives: {
          some: {},
        },
      },
      include: {
        representatives: true,
      },
    });

    if (taskWithReps) {
      if (!Array.isArray(taskWithReps.representatives)) {
        errors.push('Task.representatives is not an array');
      } else if (taskWithReps.representatives.length > 0) {
        const rep = taskWithReps.representatives[0];
        const requiredRepFields = ['id', 'name', 'role', 'phone'];

        requiredRepFields.forEach((field) => {
          if (!(field in rep)) {
            errors.push(`Representative missing required field: ${field}`);
          }
        });
      }
    } else {
      warnings.push('No tasks with representatives found - migration may be incomplete');
    }

    // Verify old negotiatingWith field doesn't exist
    const task = await prisma.task.findFirst();
    if (task && 'negotiatingWith' in task) {
      warnings.push('Old negotiatingWith field still exists - should be removed after migration');
    }

    console.log('✓ Validated representatives migration');
  } catch (error) {
    errors.push(`Failed to validate representatives migration: ${error.message}`);
  }

  return {
    testName: 'Representatives Migration',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Test 6: Verify API response format compatibility
 */
export async function testAPIResponseFormat(prisma: PrismaClient): Promise<CompatibilityTestResult> {
  console.log('\n🧪 Testing API Response Format Compatibility...');

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Test findMany response
    const tasks = await prisma.task.findMany({
      take: 5,
      include: {
        customer: true,
        sector: true,
      },
    });

    if (!Array.isArray(tasks)) {
      errors.push('findMany must return an array');
    }

    // Test findUnique response
    const task = await prisma.task.findFirst({
      include: {
        customer: true,
        sector: true,
      },
    });

    if (task) {
      // Verify JSON serialization works
      try {
        const json = JSON.stringify(task);
        const parsed = JSON.parse(json);

        if (parsed.id !== task.id) {
          errors.push('JSON serialization/deserialization corrupted data');
        }

        // Verify dates are serializable
        if (task.createdAt) {
          if (!(parsed.createdAt instanceof Date || typeof parsed.createdAt === 'string')) {
            errors.push('Date fields must be serializable');
          }
        }
      } catch (error) {
        errors.push(`JSON serialization failed: ${error.message}`);
      }
    }

    // Test pagination metadata
    const count = await prisma.task.count();
    if (typeof count !== 'number') {
      errors.push('count() must return a number');
    }

    console.log('✓ Validated API response format');
  } catch (error) {
    errors.push(`Failed to validate API response format: ${error.message}`);
  }

  return {
    testName: 'API Response Format',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print compatibility test results
 */
export function printCompatibilityResults(results: CompatibilityTestResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('🔄 BACKWARD COMPATIBILITY TEST RESULTS');
  console.log('='.repeat(80));

  let totalErrors = 0;
  let totalWarnings = 0;
  let allPassed = true;

  results.forEach((result) => {
    console.log(`\n${result.passed ? '✅' : '❌'} ${result.testName}`);
    console.log('-'.repeat(80));

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach((error) => {
        console.log(`  - ${error}`);
      });
      totalErrors += result.errors.length;
      allPassed = false;
    } else {
      console.log('  No errors detected');
    }

    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.forEach((warning) => {
        console.log(`  - ${warning}`);
      });
      totalWarnings += result.warnings.length;
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log(`📊 Summary: ${results.filter((r) => r.passed).length}/${results.length} tests passed`);
  console.log(`   Errors: ${totalErrors}`);
  console.log(`   Warnings: ${totalWarnings}`);
  console.log('='.repeat(80));
  console.log(allPassed ? '✅ ALL COMPATIBILITY TESTS PASSED' : '❌ SOME COMPATIBILITY TESTS FAILED');
  console.log('='.repeat(80) + '\n');
}

/**
 * Run all compatibility tests
 */
export async function runCompatibilityTests(): Promise<void> {
  console.log('🚀 Starting Backward Compatibility Tests...\n');

  const prisma = new PrismaClient();

  try {
    const results: CompatibilityTestResult[] = [];

    // Run all tests
    results.push(await testTaskRequiredFields(prisma));
    results.push(await testTaskRelationIncludes(prisma));
    results.push(await testTaskSelectQueries(prisma));
    results.push(await testTaskDefaultBehavior(prisma));
    results.push(await testRepresentativesMigration(prisma));
    results.push(await testAPIResponseFormat(prisma));

    // Print results
    printCompatibilityResults(results);

    // Exit with appropriate code
    const allPassed = results.every((r) => r.passed);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('❌ Compatibility tests failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests if executed directly
if (require.main === module) {
  runCompatibilityTests();
}
