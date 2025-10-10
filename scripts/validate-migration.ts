/**
 * Migration Validation Script
 *
 * This script validates the CSV migration by running comprehensive checks
 * on data integrity, referential integrity, and production data preservation.
 *
 * Usage:
 *   npx ts-node scripts/validate-migration.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ValidationResult {
  check: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  message: string;
  details?: any;
}

const results: ValidationResult[] = [];

function addResult(check: string, status: 'PASS' | 'FAIL' | 'WARNING', message: string, details?: any) {
  results.push({ check, status, message, details });
}

// ========================================
// VALIDATION CHECKS
// ========================================

async function validateRecordCounts() {
  console.log('\n📊 Validating Record Counts...');

  try {
    const counts = {
      users: await prisma.user.count(),
      positions: await prisma.position.count(),
      sectors: await prisma.sector.count(),
      itemBrands: await prisma.itemBrand.count(),
      suppliers: await prisma.supplier.count(),
      items: await prisma.item.count(),
      prices: await prisma.price.count(),
      paints: await prisma.paint.count(),
      paintFormulas: await prisma.paintFormula.count(),
      paintFormulaComponents: await prisma.paintFormulaComponent.count(),
      orders: await prisma.order.count(),
      orderItems: await prisma.orderItem.count(),
      activities: await prisma.activity.count(),
      tasks: await prisma.task.count(),
      serviceOrders: await prisma.serviceOrder.count(),
    };

    console.log('   Record counts:', counts);

    // Validate production data preservation
    if (counts.users < 68) {
      addResult('User Count', 'FAIL', `Expected at least 68 users, found ${counts.users}`, counts.users);
    } else {
      addResult('User Count', 'PASS', `Users preserved: ${counts.users}`, counts.users);
    }

    if (counts.positions < 17) {
      addResult('Position Count', 'FAIL', `Expected at least 17 positions, found ${counts.positions}`, counts.positions);
    } else {
      addResult('Position Count', 'PASS', `Positions preserved: ${counts.positions}`, counts.positions);
    }

    if (counts.sectors < 8) {
      addResult('Sector Count', 'FAIL', `Expected at least 8 sectors, found ${counts.sectors}`, counts.sectors);
    } else {
      addResult('Sector Count', 'PASS', `Sectors preserved: ${counts.sectors}`, counts.sectors);
    }

    // Validate migrated data
    if (counts.itemBrands < 100) {
      addResult('ItemBrand Count', 'WARNING', `Expected ~514 brands, found ${counts.itemBrands}`, counts.itemBrands);
    } else {
      addResult('ItemBrand Count', 'PASS', `ItemBrands migrated: ${counts.itemBrands}`, counts.itemBrands);
    }

    if (counts.items < 100) {
      addResult('Item Count', 'WARNING', `Expected ~597 items, found ${counts.items}`, counts.items);
    } else {
      addResult('Item Count', 'PASS', `Items migrated: ${counts.items}`, counts.items);
    }

    if (counts.suppliers < 10) {
      addResult('Supplier Count', 'WARNING', `Expected ~39 suppliers, found ${counts.suppliers}`, counts.suppliers);
    } else {
      addResult('Supplier Count', 'PASS', `Suppliers migrated: ${counts.suppliers}`, counts.suppliers);
    }

    if (counts.paints < 100) {
      addResult('Paint Count', 'WARNING', `Expected ~453 paints, found ${counts.paints}`, counts.paints);
    } else {
      addResult('Paint Count', 'PASS', `Paints migrated: ${counts.paints}`, counts.paints);
    }

    if (counts.orders < 50) {
      addResult('Order Count', 'WARNING', `Expected ~173 orders, found ${counts.orders}`, counts.orders);
    } else {
      addResult('Order Count', 'PASS', `Orders migrated: ${counts.orders}`, counts.orders);
    }

    if (counts.activities < 1000) {
      addResult('Activity Count', 'WARNING', `Expected ~13,663 activities, found ${counts.activities}`, counts.activities);
    } else {
      addResult('Activity Count', 'PASS', `Activities migrated: ${counts.activities}`, counts.activities);
    }

    if (counts.tasks < 100) {
      addResult('Task Count', 'WARNING', `Expected ~1,521 tasks, found ${counts.tasks}`, counts.tasks);
    } else {
      addResult('Task Count', 'PASS', `Tasks migrated: ${counts.tasks}`, counts.tasks);
    }

  } catch (error) {
    addResult('Record Counts', 'FAIL', `Failed to count records: ${error}`);
  }
}

async function validateReferentialIntegrity() {
  console.log('\n🔗 Validating Referential Integrity...');

  try {
    // Check for orphaned items (items without valid brand)
    const itemsWithInvalidBrand = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Item" i
      LEFT JOIN "ItemBrand" b ON i."brandId" = b.id
      WHERE i."brandId" IS NOT NULL AND b.id IS NULL
    `;
    const orphanedItemsByBrand = Number(itemsWithInvalidBrand[0]?.count || 0);

    if (orphanedItemsByBrand > 0) {
      addResult('Item-Brand Integrity', 'FAIL', `Found ${orphanedItemsByBrand} items with invalid brandId`);
    } else {
      addResult('Item-Brand Integrity', 'PASS', 'All items have valid brand references');
    }

    // Check for orphaned items (items without valid category)
    const itemsWithInvalidCategory = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Item" i
      LEFT JOIN "ItemCategory" c ON i."categoryId" = c.id
      WHERE i."categoryId" IS NOT NULL AND c.id IS NULL
    `;
    const orphanedItemsByCategory = Number(itemsWithInvalidCategory[0]?.count || 0);

    if (orphanedItemsByCategory > 0) {
      addResult('Item-Category Integrity', 'FAIL', `Found ${orphanedItemsByCategory} items with invalid categoryId`);
    } else {
      addResult('Item-Category Integrity', 'PASS', 'All items have valid category references');
    }

    // Check for orphaned activities
    const activitiesWithInvalidItem = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Activity" a
      LEFT JOIN "Item" i ON a."itemId" = i.id
      WHERE i.id IS NULL
    `;
    const orphanedActivities = Number(activitiesWithInvalidItem[0]?.count || 0);

    if (orphanedActivities > 0) {
      addResult('Activity-Item Integrity', 'FAIL', `Found ${orphanedActivities} activities with invalid itemId`);
    } else {
      addResult('Activity-Item Integrity', 'PASS', 'All activities have valid item references');
    }

    // Check for orphaned order items
    const orderItemsWithInvalidItem = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "OrderItem" oi
      LEFT JOIN "Item" i ON oi."itemId" = i.id
      WHERE i.id IS NULL
    `;
    const orphanedOrderItems = Number(orderItemsWithInvalidItem[0]?.count || 0);

    if (orphanedOrderItems > 0) {
      addResult('OrderItem-Item Integrity', 'FAIL', `Found ${orphanedOrderItems} order items with invalid itemId`);
    } else {
      addResult('OrderItem-Item Integrity', 'PASS', 'All order items have valid item references');
    }

    // Check for orphaned paint formulas
    const formulasWithInvalidPaint = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "PaintFormula" pf
      LEFT JOIN "Paint" p ON pf."paintId" = p.id
      WHERE p.id IS NULL
    `;
    const orphanedFormulas = Number(formulasWithInvalidPaint[0]?.count || 0);

    if (orphanedFormulas > 0) {
      addResult('Formula-Paint Integrity', 'FAIL', `Found ${orphanedFormulas} formulas with invalid paintId`);
    } else {
      addResult('Formula-Paint Integrity', 'PASS', 'All formulas have valid paint references');
    }

    // Check for orphaned formula components
    const componentsWithInvalidFormula = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "PaintFormulaComponent" pfc
      LEFT JOIN "PaintFormula" pf ON pfc."formulaPaintId" = pf.id
      WHERE pf.id IS NULL
    `;
    const orphanedComponents = Number(componentsWithInvalidFormula[0]?.count || 0);

    if (orphanedComponents > 0) {
      addResult('Component-Formula Integrity', 'FAIL', `Found ${orphanedComponents} components with invalid formulaId`);
    } else {
      addResult('Component-Formula Integrity', 'PASS', 'All components have valid formula references');
    }

  } catch (error) {
    addResult('Referential Integrity', 'FAIL', `Failed to validate referential integrity: ${error}`);
  }
}

async function validateDataQuality() {
  console.log('\n✅ Validating Data Quality...');

  try {
    // Check for items without names
    const itemsWithoutName = await prisma.item.count({
      where: { name: '' },
    });

    if (itemsWithoutName > 0) {
      addResult('Item Names', 'FAIL', `Found ${itemsWithoutName} items without names`);
    } else {
      addResult('Item Names', 'PASS', 'All items have names');
    }

    // Check for items with negative quantities
    const itemsWithNegativeQuantity = await prisma.item.count({
      where: { quantity: { lt: 0 } },
    });

    if (itemsWithNegativeQuantity > 0) {
      addResult('Item Quantities', 'WARNING', `Found ${itemsWithNegativeQuantity} items with negative quantities`);
    } else {
      addResult('Item Quantities', 'PASS', 'All items have valid quantities');
    }

    // Check for prices with value = 0
    const pricesWithZeroValue = await prisma.price.count({
      where: { value: 0 },
    });

    if (pricesWithZeroValue > 0) {
      addResult('Price Values', 'WARNING', `Found ${pricesWithZeroValue} prices with zero value`, pricesWithZeroValue);
    } else {
      addResult('Price Values', 'PASS', 'All prices have non-zero values');
    }

    // Check for paints without hex codes
    const paintsWithoutHex = await prisma.paint.count({
      where: { hex: '' },
    });

    if (paintsWithoutHex > 0) {
      addResult('Paint Hex Codes', 'WARNING', `Found ${paintsWithoutHex} paints without hex codes`);
    } else {
      addResult('Paint Hex Codes', 'PASS', 'All paints have hex codes');
    }

    // Check for tasks without serial numbers
    const tasksWithoutSerial = await prisma.task.count({
      where: { serialNumber: null },
    });

    if (tasksWithoutSerial > 0) {
      addResult('Task Serial Numbers', 'WARNING', `Found ${tasksWithoutSerial} tasks without serial numbers`);
    } else {
      addResult('Task Serial Numbers', 'PASS', 'All tasks have serial numbers');
    }

    // Check for orders with items
    const ordersWithoutItems = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
      WHERE oi.id IS NULL
    `;
    const emptyOrders = Number(ordersWithoutItems[0]?.count || 0);

    if (emptyOrders > 0) {
      addResult('Order Items', 'WARNING', `Found ${emptyOrders} orders without items`);
    } else {
      addResult('Order Items', 'PASS', 'All orders have items');
    }

  } catch (error) {
    addResult('Data Quality', 'FAIL', `Failed to validate data quality: ${error}`);
  }
}

async function validateBusinessLogic() {
  console.log('\n🔍 Validating Business Logic...');

  try {
    // Check for completed tasks with missing dates
    const completedTasksWithoutFinishDate = await prisma.task.count({
      where: {
        status: 'COMPLETED',
        finishedAt: null,
      },
    });

    if (completedTasksWithoutFinishDate > 0) {
      addResult('Completed Tasks', 'WARNING', `Found ${completedTasksWithoutFinishDate} completed tasks without finish date`);
    } else {
      addResult('Completed Tasks', 'PASS', 'All completed tasks have finish dates');
    }

    // Check for received orders with unfulfilled items
    const receivedOrdersWithUnfulfilledItems = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT o.id) as count
      FROM "Order" o
      INNER JOIN "OrderItem" oi ON o.id = oi."orderId"
      WHERE o.status = 'RECEIVED'
        AND oi."receivedQuantity" < oi."orderedQuantity"
    `;
    const unfulfilledOrders = Number(receivedOrdersWithUnfulfilledItems[0]?.count || 0);

    if (unfulfilledOrders > 0) {
      addResult('Order Fulfillment', 'WARNING', `Found ${unfulfilledOrders} received orders with unfulfilled items`);
    } else {
      addResult('Order Fulfillment', 'PASS', 'All received orders are fully fulfilled');
    }

    // Check for activities without items
    const activitiesWithItems = await prisma.activity.count({
      where: { itemId: { not: null } },
    });

    const totalActivities = await prisma.activity.count();

    if (activitiesWithItems < totalActivities) {
      addResult('Activity Items', 'FAIL', `Found ${totalActivities - activitiesWithItems} activities without items`);
    } else {
      addResult('Activity Items', 'PASS', 'All activities have items');
    }

    // Check for paint formulas with components
    const formulas = await prisma.paintFormula.count();
    const formulasWithComponents = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT "formulaPaintId") as count
      FROM "PaintFormulaComponent"
    `;
    const formulasWithComponentsCount = Number(formulasWithComponents[0]?.count || 0);

    if (formulasWithComponentsCount < formulas * 0.5) {
      addResult('Formula Components', 'WARNING', `Only ${formulasWithComponentsCount}/${formulas} formulas have components`);
    } else {
      addResult('Formula Components', 'PASS', `${formulasWithComponentsCount}/${formulas} formulas have components`);
    }

  } catch (error) {
    addResult('Business Logic', 'FAIL', `Failed to validate business logic: ${error}`);
  }
}

async function validateUniqueConstraints() {
  console.log('\n🔑 Validating Unique Constraints...');

  try {
    // Check for duplicate brand names
    const duplicateBrands = await prisma.$queryRaw<Array<{ name: string; count: bigint }>>`
      SELECT name, COUNT(*) as count
      FROM "ItemBrand"
      GROUP BY name
      HAVING COUNT(*) > 1
    `;

    if (duplicateBrands.length > 0) {
      addResult('Unique Brand Names', 'FAIL', `Found ${duplicateBrands.length} duplicate brand names`, duplicateBrands);
    } else {
      addResult('Unique Brand Names', 'PASS', 'All brand names are unique');
    }

    // Check for duplicate supplier fantasy names
    const duplicateSuppliers = await prisma.$queryRaw<Array<{ fantasyName: string; count: bigint }>>`
      SELECT "fantasyName", COUNT(*) as count
      FROM "Supplier"
      GROUP BY "fantasyName"
      HAVING COUNT(*) > 1
    `;

    if (duplicateSuppliers.length > 0) {
      addResult('Unique Supplier Names', 'FAIL', `Found ${duplicateSuppliers.length} duplicate supplier names`, duplicateSuppliers);
    } else {
      addResult('Unique Supplier Names', 'PASS', 'All supplier names are unique');
    }

    // Check for duplicate task serial numbers
    const duplicateTaskSerials = await prisma.$queryRaw<Array<{ serialNumber: string; count: bigint }>>`
      SELECT "serialNumber", COUNT(*) as count
      FROM "Task"
      WHERE "serialNumber" IS NOT NULL
      GROUP BY "serialNumber"
      HAVING COUNT(*) > 1
    `;

    if (duplicateTaskSerials.length > 0) {
      addResult('Unique Task Serial Numbers', 'FAIL', `Found ${duplicateTaskSerials.length} duplicate task serial numbers`, duplicateTaskSerials);
    } else {
      addResult('Unique Task Serial Numbers', 'PASS', 'All task serial numbers are unique');
    }

  } catch (error) {
    addResult('Unique Constraints', 'FAIL', `Failed to validate unique constraints: ${error}`);
  }
}

async function validateTimestamps() {
  console.log('\n⏰ Validating Timestamps...');

  try {
    // Check for future dates in createdAt
    const futureCreatedAt = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Item"
      WHERE "createdAt" > NOW()
    `;
    const futureItems = Number(futureCreatedAt[0]?.count || 0);

    if (futureItems > 0) {
      addResult('Future CreatedAt Dates', 'WARNING', `Found ${futureItems} items with future createdAt dates`);
    } else {
      addResult('Future CreatedAt Dates', 'PASS', 'No items have future createdAt dates');
    }

    // Check for tasks with startedAt before entryDate
    const invalidTaskDates = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Task"
      WHERE "startedAt" IS NOT NULL
        AND "entryDate" IS NOT NULL
        AND "startedAt" < "entryDate"
    `;
    const invalidDates = Number(invalidTaskDates[0]?.count || 0);

    if (invalidDates > 0) {
      addResult('Task Date Logic', 'WARNING', `Found ${invalidDates} tasks where startedAt is before entryDate`);
    } else {
      addResult('Task Date Logic', 'PASS', 'All task dates are logically consistent');
    }

    // Check for activities with very old dates
    const oldActivities = await prisma.activity.count({
      where: {
        createdAt: { lt: new Date('2020-01-01') },
      },
    });

    if (oldActivities > 0) {
      addResult('Activity Dates', 'WARNING', `Found ${oldActivities} activities older than 2020`, oldActivities);
    } else {
      addResult('Activity Dates', 'PASS', 'All activity dates are recent');
    }

  } catch (error) {
    addResult('Timestamps', 'FAIL', `Failed to validate timestamps: ${error}`);
  }
}

// ========================================
// REPORT GENERATION
// ========================================

function printResults() {
  console.log('\n' + '='.repeat(80));
  console.log('📋 VALIDATION REPORT');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warnings = results.filter(r => r.status === 'WARNING').length;

  console.log(`\n✅ Passed:   ${passed}`);
  console.log(`❌ Failed:   ${failed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`📊 Total:    ${results.length}`);

  // Print failures
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('❌ FAILURES');
    console.log('='.repeat(80));
    failures.forEach(r => {
      console.log(`\n${r.check}:`);
      console.log(`   ${r.message}`);
      if (r.details) {
        console.log(`   Details:`, JSON.stringify(r.details, null, 2));
      }
    });
  }

  // Print warnings
  const warningsList = results.filter(r => r.status === 'WARNING');
  if (warningsList.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('⚠️  WARNINGS');
    console.log('='.repeat(80));
    warningsList.forEach(r => {
      console.log(`\n${r.check}:`);
      console.log(`   ${r.message}`);
    });
  }

  // Print successes
  console.log('\n' + '='.repeat(80));
  console.log('✅ PASSED CHECKS');
  console.log('='.repeat(80));
  const successes = results.filter(r => r.status === 'PASS');
  successes.forEach(r => {
    console.log(`✓ ${r.check}: ${r.message}`);
  });

  console.log('\n' + '='.repeat(80));

  // Overall result
  if (failed > 0) {
    console.log('\n❌ VALIDATION FAILED - Please review failures above');
    return 1;
  } else if (warnings > 0) {
    console.log('\n⚠️  VALIDATION PASSED WITH WARNINGS - Review warnings above');
    return 0;
  } else {
    console.log('\n✅ VALIDATION PASSED - All checks successful!');
    return 0;
  }
}

// ========================================
// MAIN EXECUTION
// ========================================

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 MIGRATION VALIDATION SCRIPT');
  console.log('='.repeat(80));
  console.log(`Database: ${process.env.DATABASE_URL?.split('@')[1] || 'Unknown'}`);
  console.log('='.repeat(80));

  try {
    await validateRecordCounts();
    await validateReferentialIntegrity();
    await validateDataQuality();
    await validateBusinessLogic();
    await validateUniqueConstraints();
    await validateTimestamps();

    const exitCode = printResults();
    process.exit(exitCode);

  } catch (error) {
    console.error('\n❌ Validation failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
