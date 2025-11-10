import { PrismaClient, MeasureType } from '@prisma/client';

const prisma = new PrismaClient();

interface VerificationResult {
  step: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  message: string;
  details?: any;
}

interface ItemWithSizeCheck {
  id: string;
  name: string;
  ppeSize: string | null;
  ppeSizeOrder: number | null;
  hasSizeMeasure: boolean;
  sizeMeasureUnit: string | null;
}

async function verifyPpeSizeMigration(): Promise<void> {
  console.log('🔍 Starting ppeSize migration verification...\n');

  const results: VerificationResult[] = [];

  try {
    // Step 1: Check if ppeSize columns exist
    console.log('Step 1: Checking for ppeSize columns in Item table...');
    try {
      const columnCheck = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'Item'
        AND column_name IN ('ppeSize', 'ppeSizeOrder')
      `;

      const hasPpeSizeColumn = columnCheck.some(c => c.column_name === 'ppeSize');
      const hasPpeSizeOrderColumn = columnCheck.some(c => c.column_name === 'ppeSizeOrder');

      results.push({
        step: 'Column Existence Check',
        status: hasPpeSizeColumn ? 'WARNING' : 'PASS',
        message: hasPpeSizeColumn
          ? 'ppeSize column still exists in Item table'
          : 'ppeSize column has been removed from Item table',
        details: {
          ppeSize: hasPpeSizeColumn,
          ppeSizeOrder: hasPpeSizeOrderColumn,
        },
      });

      // Step 2: If columns exist, check for unmigrated data
      if (hasPpeSizeColumn) {
        console.log('Step 2: Checking for items with non-null ppeSize...');

        const itemsWithPpeSize = await prisma.$queryRaw<Array<{
          id: string;
          name: string;
          ppeSize: string;
        }>>`
          SELECT id, name, "ppeSize"
          FROM "Item"
          WHERE "ppeSize" IS NOT NULL
        `;

        if (itemsWithPpeSize.length > 0) {
          // Check if these items have corresponding SIZE measures
          const itemIds = itemsWithPpeSize.map(item => item.id);
          const sizeMeasures = await prisma.measure.findMany({
            where: {
              itemId: { in: itemIds },
              measureType: MeasureType.SIZE,
            },
            select: {
              itemId: true,
              unit: true,
            },
          });

          const measuresByItemId = new Map(sizeMeasures.map(m => [m.itemId, m.unit]));

          const unmigrated: ItemWithSizeCheck[] = [];
          const migrated: ItemWithSizeCheck[] = [];

          for (const item of itemsWithPpeSize) {
            const hasSizeMeasure = measuresByItemId.has(item.id);
            const itemCheck: ItemWithSizeCheck = {
              id: item.id,
              name: item.name,
              ppeSize: item.ppeSize,
              ppeSizeOrder: null,
              hasSizeMeasure,
              sizeMeasureUnit: measuresByItemId.get(item.id) || null,
            };

            if (hasSizeMeasure) {
              migrated.push(itemCheck);
            } else {
              unmigrated.push(itemCheck);
            }
          }

          results.push({
            step: 'Data Migration Check',
            status: unmigrated.length === 0 ? 'PASS' : 'FAIL',
            message:
              unmigrated.length === 0
                ? `All ${itemsWithPpeSize.length} items with ppeSize have been migrated to measures`
                : `${unmigrated.length} items with ppeSize have NOT been migrated`,
            details: {
              totalItemsWithPpeSize: itemsWithPpeSize.length,
              migratedItems: migrated.length,
              unmigratedItems: unmigrated.length,
              unmigrated: unmigrated.slice(0, 10), // Show first 10
            },
          });

          // Step 3: Verify data consistency
          console.log('Step 3: Verifying data consistency...');

          const inconsistencies: Array<{
            itemId: string;
            itemName: string;
            ppeSize: string;
            measureUnit: string;
            match: boolean;
          }> = [];

          for (const item of migrated) {
            const ppeSizeUpper = item.ppeSize?.toUpperCase();
            const measureUnitUpper = item.sizeMeasureUnit?.toUpperCase();

            // Check if they match (accounting for SIZE_ prefix in measures)
            const match =
              ppeSizeUpper === measureUnitUpper ||
              `SIZE_${ppeSizeUpper}` === measureUnitUpper ||
              ppeSizeUpper === measureUnitUpper?.replace('SIZE_', '');

            if (!match) {
              inconsistencies.push({
                itemId: item.id,
                itemName: item.name,
                ppeSize: item.ppeSize || '',
                measureUnit: item.sizeMeasureUnit || '',
                match,
              });
            }
          }

          results.push({
            step: 'Data Consistency Check',
            status: inconsistencies.length === 0 ? 'PASS' : 'FAIL',
            message:
              inconsistencies.length === 0
                ? 'All migrated data is consistent'
                : `Found ${inconsistencies.length} inconsistencies between ppeSize and measure.unit`,
            details: {
              totalChecked: migrated.length,
              inconsistencies: inconsistencies.slice(0, 10),
            },
          });
        } else {
          results.push({
            step: 'Data Migration Check',
            status: 'PASS',
            message: 'No items with ppeSize found in database',
          });
        }
      }
    } catch (error) {
      results.push({
        step: 'Column Existence Check',
        status: 'FAIL',
        message: 'Error checking for ppeSize columns',
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    // Step 4: Count total SIZE measures
    console.log('Step 4: Counting total SIZE measures...');
    const totalSizeMeasures = await prisma.measure.count({
      where: { measureType: MeasureType.SIZE },
    });

    results.push({
      step: 'SIZE Measures Count',
      status: 'PASS',
      message: `Found ${totalSizeMeasures} SIZE measures in the database`,
      details: { count: totalSizeMeasures },
    });

    // Step 5: Check for duplicate SIZE measures per item
    console.log('Step 5: Checking for duplicate SIZE measures...');
    const duplicateCheck = await prisma.$queryRaw<Array<{ itemId: string; count: number }>>`
      SELECT "itemId", COUNT(*) as count
      FROM "Measure"
      WHERE "measureType" = 'SIZE'
      GROUP BY "itemId"
      HAVING COUNT(*) > 1
    `;

    results.push({
      step: 'Duplicate SIZE Measures Check',
      status: duplicateCheck.length === 0 ? 'PASS' : 'FAIL',
      message:
        duplicateCheck.length === 0
          ? 'No duplicate SIZE measures found'
          : `Found ${duplicateCheck.length} items with duplicate SIZE measures`,
      details: {
        duplicates: duplicateCheck,
      },
    });

    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('📊 VERIFICATION RESULTS');
    console.log('='.repeat(70) + '\n');

    let hasFailures = false;
    let hasWarnings = false;

    for (const result of results) {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'WARNING' ? '⚠️' : '❌';
      console.log(`${icon} ${result.step}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   ${result.message}`);

      if (result.details && Object.keys(result.details).length > 0) {
        console.log(`   Details:`, JSON.stringify(result.details, null, 2).split('\n').join('\n   '));
      }

      console.log('');

      if (result.status === 'FAIL') hasFailures = true;
      if (result.status === 'WARNING') hasWarnings = true;
    }

    console.log('='.repeat(70));

    // Final summary
    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const warnCount = results.filter(r => r.status === 'WARNING').length;

    console.log('\n📈 Summary:');
    console.log(`   ✅ Passed: ${passCount}`);
    console.log(`   ⚠️  Warnings: ${warnCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log('');

    // Export verification report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = `./scripts/logs/ppesize-verification-${timestamp}.json`;

    try {
      const fs = require('fs');
      const path = require('path');

      const logsDir = path.dirname(reportPath);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      fs.writeFileSync(
        reportPath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            summary: { passed: passCount, warnings: warnCount, failed: failCount },
            results,
          },
          null,
          2
        )
      );
      console.log(`📝 Verification report saved to: ${reportPath}\n`);
    } catch (error) {
      console.warn(`⚠️  Could not save report file: ${error}\n`);
    }

    // Exit with appropriate code
    if (hasFailures) {
      console.log('❌ Verification FAILED\n');
      process.exit(1);
    } else if (hasWarnings) {
      console.log('⚠️  Verification passed with WARNINGS\n');
      process.exit(0);
    } else {
      console.log('✅ Verification PASSED\n');
      process.exit(0);
    }
  } catch (error) {
    console.error('💥 Verification failed with fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run verification
verifyPpeSizeMigration();
