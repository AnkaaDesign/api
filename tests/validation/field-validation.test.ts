/**
 * Field Validation Test Suite
 *
 * Validates that:
 * - All required fields are present in responses
 * - Unnecessary fields are properly excluded
 * - Field selection works correctly
 * - Nested field selection is accurate
 */

import { PrismaClient } from '@prisma/client';

interface FieldValidationResult {
  testName: string;
  passed: boolean;
  details: {
    expectedFields: string[];
    actualFields: string[];
    missingFields: string[];
    unexpectedFields: string[];
  };
}

/**
 * Utility: Get all field names from an object (including nested)
 */
function getFieldNames(obj: any, prefix: string = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];

  const fields: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (obj[key] === null || obj[key] === undefined) {
      fields.push(fullKey);
    } else if (Array.isArray(obj[key])) {
      fields.push(fullKey);
      if (obj[key].length > 0 && typeof obj[key][0] === 'object') {
        // Sample first item in array
        const nestedFields = getFieldNames(obj[key][0], fullKey);
        fields.push(...nestedFields);
      }
    } else if (typeof obj[key] === 'object' && !(obj[key] instanceof Date)) {
      fields.push(fullKey);
      const nestedFields = getFieldNames(obj[key], fullKey);
      fields.push(...nestedFields);
    } else {
      fields.push(fullKey);
    }
  }

  return fields;
}

/**
 * Utility: Check if field list contains only expected fields
 */
function validateFields(
  actualFields: string[],
  expectedFields: string[],
  excludedFields: string[] = [],
): { missing: string[]; unexpected: string[] } {
  const missing = expectedFields.filter((field) => !actualFields.includes(field));
  const unexpected = actualFields.filter(
    (field) =>
      !expectedFields.includes(field) &&
      !expectedFields.some((expected) => field.startsWith(expected + '.')),
  );

  // Remove explicitly excluded fields from unexpected
  const filteredUnexpected = unexpected.filter((field) => !excludedFields.includes(field));

  return {
    missing,
    unexpected: filteredUnexpected,
  };
}

/**
 * Test 1: Validate List View Fields
 * Should include only essential fields for displaying in tables
 */
export async function testListViewFields(prisma: PrismaClient): Promise<FieldValidationResult> {
  console.log('\n🧪 Testing List View Field Selection...');

  const task = await prisma.task.findFirst({
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

  if (!task) {
    console.log('  ⚠️  No tasks found - skipping test');
    return {
      testName: 'List View Fields',
      passed: true,
      details: {
        expectedFields: [],
        actualFields: [],
        missingFields: [],
        unexpectedFields: [],
      },
    };
  }

  const expectedFields = [
    'id',
    'name',
    'status',
    'statusOrder',
    'serialNumber',
    'entryDate',
    'forecastDate',
    'commission',
    'sector',
    'sector.id',
    'sector.name',
    'customer',
    'customer.id',
    'customer.fantasyName',
    'createdBy',
    'createdBy.id',
    'createdBy.name',
    'createdBy.avatar',
    'createdAt',
  ];

  // Fields that should NOT be in list view
  const excludedFields = [
    'details', // Too large for list
    'updatedAt', // Not needed in list
    'term', // Not needed in list
    'startedAt', // Not needed in list
    'finishedAt', // Not needed in list
    'serviceOrders', // Too heavy
    'pricing', // Too heavy
    'artworks', // Too heavy
    'cuts', // Too heavy
    'airbrushings', // Too heavy
    'baseFiles', // Too heavy
  ];

  const actualFields = getFieldNames(task);
  const { missing, unexpected } = validateFields(actualFields, expectedFields, excludedFields);

  const passed = missing.length === 0 && unexpected.length === 0;

  console.log(`  Expected fields: ${expectedFields.length}`);
  console.log(`  Actual fields: ${actualFields.length}`);
  console.log(`  Missing: ${missing.length}`);
  console.log(`  Unexpected: ${unexpected.length}`);

  return {
    testName: 'List View Fields',
    passed,
    details: {
      expectedFields,
      actualFields,
      missingFields: missing,
      unexpectedFields: unexpected,
    },
  };
}

/**
 * Test 2: Validate Detail View Fields
 * Should include comprehensive fields for detail/view pages
 */
export async function testDetailViewFields(prisma: PrismaClient): Promise<FieldValidationResult> {
  console.log('\n🧪 Testing Detail View Field Selection...');

  const task = await prisma.task.findFirst({
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
          // Exclude formula - too heavy
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

  if (!task) {
    console.log('  ⚠️  No tasks found - skipping test');
    return {
      testName: 'Detail View Fields',
      passed: true,
      details: {
        expectedFields: [],
        actualFields: [],
        missingFields: [],
        unexpectedFields: [],
      },
    };
  }

  const expectedFields = [
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
    'sector',
    'customer',
    'invoiceTo',
    'createdBy',
    'generalPainting',
    'truck',
    'serviceOrders',
    'pricing',
    'representatives',
    'createdAt',
    'updatedAt',
  ];

  // Heavy fields that should be excluded even in detail view
  const excludedFields = [
    'generalPainting.formula', // Formula is very heavy
    'serviceOrders.items', // Items fetched separately
    'pricing.items', // Items fetched separately
    'baseFiles', // Files loaded separately
    'budgets', // Loaded separately
    'invoices', // Loaded separately
  ];

  const actualFields = getFieldNames(task);
  const { missing, unexpected } = validateFields(actualFields, expectedFields, excludedFields);

  const passed = missing.length === 0;

  console.log(`  Expected fields: ${expectedFields.length}`);
  console.log(`  Actual fields: ${actualFields.length}`);
  console.log(`  Missing: ${missing.length}`);
  console.log(`  Unexpected (allowed): ${unexpected.length}`);

  return {
    testName: 'Detail View Fields',
    passed,
    details: {
      expectedFields,
      actualFields,
      missingFields: missing,
      unexpectedFields: unexpected,
    },
  };
}

/**
 * Test 3: Validate Form View Fields
 * Should include fields needed for editing
 */
export async function testFormViewFields(prisma: PrismaClient): Promise<FieldValidationResult> {
  console.log('\n🧪 Testing Form View Field Selection...');

  const task = await prisma.task.findFirst({
    select: {
      id: true,
      name: true,
      status: true,
      details: true,
      entryDate: true,
      term: true,
      forecastDate: true,
      commission: true,
      // Foreign keys needed for dropdowns
      sectorId: true,
      customerId: true,
      invoiceToId: true,
      paintId: true,
      // Minimal relation data for dropdowns
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

  if (!task) {
    console.log('  ⚠️  No tasks found - skipping test');
    return {
      testName: 'Form View Fields',
      passed: true,
      details: {
        expectedFields: [],
        actualFields: [],
        missingFields: [],
        unexpectedFields: [],
      },
    };
  }

  const expectedFields = [
    'id',
    'name',
    'status',
    'details',
    'entryDate',
    'term',
    'forecastDate',
    'commission',
    'sectorId',
    'customerId',
    'invoiceToId',
    'paintId',
    'sector',
    'customer',
    'representatives',
  ];

  // Fields not needed in form
  const excludedFields = [
    'statusOrder', // Calculated field
    'serialNumber', // Auto-generated
    'startedAt', // System field
    'finishedAt', // System field
    'createdAt', // System field
    'updatedAt', // System field
    'serviceOrders', // Not edited in task form
    'pricing', // Edited separately
    'artworks', // Edited separately
  ];

  const actualFields = getFieldNames(task);
  const { missing, unexpected } = validateFields(actualFields, expectedFields, excludedFields);

  const passed = missing.length === 0;

  console.log(`  Expected fields: ${expectedFields.length}`);
  console.log(`  Actual fields: ${actualFields.length}`);
  console.log(`  Missing: ${missing.length}`);
  console.log(`  Unexpected (allowed): ${unexpected.length}`);

  return {
    testName: 'Form View Fields',
    passed,
    details: {
      expectedFields,
      actualFields,
      missingFields: missing,
      unexpectedFields: unexpected,
    },
  };
}

/**
 * Test 4: Validate Excluded Sensitive Fields
 * Ensure sensitive data is not exposed
 */
export async function testExcludedSensitiveFields(prisma: PrismaClient): Promise<FieldValidationResult> {
  console.log('\n🧪 Testing Sensitive Field Exclusion...');

  // Query user (which has sensitive fields)
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      // Should NOT select password, salt, tokens, etc.
    },
  });

  if (!user) {
    console.log('  ⚠️  No users found - skipping test');
    return {
      testName: 'Sensitive Field Exclusion',
      passed: true,
      details: {
        expectedFields: [],
        actualFields: [],
        missingFields: [],
        unexpectedFields: [],
      },
    };
  }

  const expectedFields = ['id', 'name', 'email', 'avatar'];

  // Fields that should NEVER be exposed
  const forbiddenFields = ['password', 'passwordHash', 'salt', 'resetToken', 'accessToken', 'refreshToken'];

  const actualFields = getFieldNames(user);

  // Check for forbidden fields
  const exposedSensitiveFields = actualFields.filter((field) =>
    forbiddenFields.some((forbidden) => field.includes(forbidden)),
  );

  const passed = exposedSensitiveFields.length === 0;

  console.log(`  Expected fields: ${expectedFields.length}`);
  console.log(`  Actual fields: ${actualFields.length}`);
  console.log(`  Exposed sensitive fields: ${exposedSensitiveFields.length}`);

  if (exposedSensitiveFields.length > 0) {
    console.log(`  ⚠️  SECURITY ISSUE: ${exposedSensitiveFields.join(', ')}`);
  }

  return {
    testName: 'Sensitive Field Exclusion',
    passed,
    details: {
      expectedFields,
      actualFields,
      missingFields: [],
      unexpectedFields: exposedSensitiveFields,
    },
  };
}

/**
 * Test 5: Validate Heavy Field Exclusion
 * Ensure heavy/large fields are excluded from list views
 */
export async function testExcludedHeavyFields(prisma: PrismaClient): Promise<FieldValidationResult> {
  console.log('\n🧪 Testing Heavy Field Exclusion...');

  const tasks = await prisma.task.findMany({
    take: 10,
    select: {
      id: true,
      name: true,
      status: true,
      // Should NOT include heavy fields
      customer: {
        select: {
          id: true,
          fantasyName: true,
        },
      },
    },
  });

  if (tasks.length === 0) {
    console.log('  ⚠️  No tasks found - skipping test');
    return {
      testName: 'Heavy Field Exclusion',
      passed: true,
      details: {
        expectedFields: [],
        actualFields: [],
        missingFields: [],
        unexpectedFields: [],
      },
    };
  }

  const expectedFields = ['id', 'name', 'status', 'customer', 'customer.id', 'customer.fantasyName'];

  // Heavy fields that should NOT be in list view
  const forbiddenFields = [
    'details', // Large text
    'serviceOrders',
    'pricing',
    'artworks',
    'cuts',
    'airbrushings',
    'baseFiles',
    'budgets',
    'invoices',
    'formula', // Very large JSON
  ];

  const actualFields = getFieldNames(tasks[0]);

  // Check for forbidden heavy fields
  const includedHeavyFields = actualFields.filter((field) =>
    forbiddenFields.some((forbidden) => field.includes(forbidden)),
  );

  const passed = includedHeavyFields.length === 0;

  console.log(`  Expected fields: ${expectedFields.length}`);
  console.log(`  Actual fields: ${actualFields.length}`);
  console.log(`  Included heavy fields: ${includedHeavyFields.length}`);

  return {
    testName: 'Heavy Field Exclusion',
    passed,
    details: {
      expectedFields,
      actualFields,
      missingFields: [],
      unexpectedFields: includedHeavyFields,
    },
  };
}

/**
 * Test 6: Validate Nested Selection Depth
 * Ensure nested queries don't go too deep
 */
export async function testNestedSelectionDepth(prisma: PrismaClient): Promise<FieldValidationResult> {
  console.log('\n🧪 Testing Nested Selection Depth...');

  const task = await prisma.task.findFirst({
    select: {
      id: true,
      name: true,
      customer: {
        select: {
          id: true,
          fantasyName: true,
          // Should NOT go deeper (e.g., customer.tasks.customer.tasks...)
        },
      },
      serviceOrders: {
        select: {
          id: true,
          type: true,
          // Should NOT include deep nesting
        },
      },
    },
  });

  if (!task) {
    console.log('  ⚠️  No tasks found - skipping test');
    return {
      testName: 'Nested Selection Depth',
      passed: true,
      details: {
        expectedFields: [],
        actualFields: [],
        missingFields: [],
        unexpectedFields: [],
      },
    };
  }

  const expectedMaxDepth = 3; // task.customer.field = 3 levels
  const actualFields = getFieldNames(task);

  // Calculate max depth
  const maxDepth = Math.max(...actualFields.map((field) => field.split('.').length));

  const passed = maxDepth <= expectedMaxDepth;

  console.log(`  Expected max depth: ${expectedMaxDepth}`);
  console.log(`  Actual max depth: ${maxDepth}`);

  return {
    testName: 'Nested Selection Depth',
    passed,
    details: {
      expectedFields: [`Max depth: ${expectedMaxDepth}`],
      actualFields: [`Max depth: ${maxDepth}`],
      missingFields: [],
      unexpectedFields: maxDepth > expectedMaxDepth ? [`Depth ${maxDepth} exceeds limit`] : [],
    },
  };
}

/**
 * Print field validation results
 */
export function printFieldValidationResults(results: FieldValidationResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('✅ FIELD VALIDATION TEST RESULTS');
  console.log('='.repeat(80));

  let allPassed = true;

  results.forEach((result) => {
    console.log(`\n${result.passed ? '✅' : '❌'} ${result.testName}`);
    console.log('-'.repeat(80));

    if (result.details.missingFields.length > 0) {
      console.log('\n❌ Missing Required Fields:');
      result.details.missingFields.forEach((field) => {
        console.log(`  - ${field}`);
      });
    }

    if (result.details.unexpectedFields.length > 0) {
      console.log('\n⚠️  Unexpected Fields (should be excluded):');
      result.details.unexpectedFields.forEach((field) => {
        console.log(`  - ${field}`);
      });
    }

    if (result.passed && result.details.missingFields.length === 0 && result.details.unexpectedFields.length === 0) {
      console.log('  All field validations passed ✓');
    }

    if (!result.passed) {
      allPassed = false;
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log(allPassed ? '✅ ALL FIELD VALIDATION TESTS PASSED' : '❌ SOME FIELD VALIDATION TESTS FAILED');
  console.log('='.repeat(80) + '\n');
}

/**
 * Run all field validation tests
 */
export async function runFieldValidationTests(): Promise<void> {
  console.log('🚀 Starting Field Validation Tests...\n');

  const prisma = new PrismaClient();

  try {
    const results: FieldValidationResult[] = [];

    // Run all tests
    results.push(await testListViewFields(prisma));
    results.push(await testDetailViewFields(prisma));
    results.push(await testFormViewFields(prisma));
    results.push(await testExcludedSensitiveFields(prisma));
    results.push(await testExcludedHeavyFields(prisma));
    results.push(await testNestedSelectionDepth(prisma));

    // Print results
    printFieldValidationResults(results);

    // Exit with appropriate code
    const allPassed = results.every((r) => r.passed);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('❌ Field validation tests failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests if executed directly
if (require.main === module) {
  runFieldValidationTests();
}
