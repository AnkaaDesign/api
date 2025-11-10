import { PrismaClient, MeasureType, MeasureUnit } from '@prisma/client';

const prisma = new PrismaClient();

interface MigrationResult {
  itemId: string;
  itemName: string;
  ppeSizeValue: string;
  measureCreated: boolean;
  error?: string;
}

interface MigrationSummary {
  totalItems: number;
  successfulMigrations: number;
  failedMigrations: number;
  skippedItems: number;
  results: MigrationResult[];
}

/**
 * Maps PPE_SIZE enum values to MeasureUnit enum values
 */
function mapPpeSizeToMeasureUnit(ppeSize: string): MeasureUnit | null {
  const mapping: Record<string, MeasureUnit> = {
    'P': MeasureUnit.P,
    'M': MeasureUnit.M,
    'G': MeasureUnit.G,
    'GG': MeasureUnit.GG,
    'XG': MeasureUnit.XG,
    'SIZE_35': MeasureUnit.SIZE_35,
    'SIZE_36': MeasureUnit.SIZE_36,
    'SIZE_37': MeasureUnit.SIZE_37,
    'SIZE_38': MeasureUnit.SIZE_38,
    'SIZE_39': MeasureUnit.SIZE_39,
    'SIZE_40': MeasureUnit.SIZE_40,
    'SIZE_41': MeasureUnit.SIZE_41,
    'SIZE_42': MeasureUnit.SIZE_42,
    'SIZE_43': MeasureUnit.SIZE_43,
    'SIZE_44': MeasureUnit.SIZE_44,
    'SIZE_45': MeasureUnit.SIZE_45,
    'SIZE_46': MeasureUnit.SIZE_46,
    'SIZE_47': MeasureUnit.SIZE_47,
    'SIZE_48': MeasureUnit.SIZE_48,
  };

  return mapping[ppeSize] || null;
}

async function migratePpeSizeToMeasures(): Promise<MigrationSummary> {
  console.log('🚀 Starting ppeSize to measures migration...\n');

  const summary: MigrationSummary = {
    totalItems: 0,
    successfulMigrations: 0,
    failedMigrations: 0,
    skippedItems: 0,
    results: [],
  };

  try {
    // Check if ppeSize column exists in the database
    // This is a raw query to inspect the table structure
    const columnCheck = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Item'
      AND column_name IN ('ppeSize', 'ppeSizeOrder')
    `;

    if (columnCheck.length === 0) {
      console.log('⚠️  WARNING: ppeSize and ppeSizeOrder columns do not exist in the Item table.');
      console.log('This migration may not be necessary or has already been completed.');
      console.log('Checking for items with SIZE measures instead...\n');

      // Check if there are already SIZE measures
      const sizeMeasuresCount = await prisma.measure.count({
        where: { measureType: MeasureType.SIZE }
      });

      console.log(`Found ${sizeMeasuresCount} existing SIZE measures in the database.`);
      return summary;
    }

    console.log('✅ Found ppeSize column in Item table. Proceeding with migration...\n');

    // Fetch all items with non-null ppeSize
    const itemsWithPpeSize = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      ppeSize: string;
      ppeSizeOrder: number | null;
    }>>`
      SELECT id, name, "ppeSize", "ppeSizeOrder"
      FROM "Item"
      WHERE "ppeSize" IS NOT NULL
    `;

    summary.totalItems = itemsWithPpeSize.length;
    console.log(`📊 Found ${summary.totalItems} items with ppeSize values\n`);

    if (summary.totalItems === 0) {
      console.log('✅ No items to migrate. All done!');
      return summary;
    }

    // Process each item in a transaction
    for (const item of itemsWithPpeSize) {
      const result: MigrationResult = {
        itemId: item.id,
        itemName: item.name,
        ppeSizeValue: item.ppeSize,
        measureCreated: false,
      };

      try {
        await prisma.$transaction(async (tx) => {
          // Check if a SIZE measure already exists for this item
          const existingMeasure = await tx.measure.findFirst({
            where: {
              itemId: item.id,
              measureType: MeasureType.SIZE,
            },
          });

          if (existingMeasure) {
            console.log(`⏭️  Skipping ${item.name} (${item.id}) - SIZE measure already exists`);
            summary.skippedItems++;
            return;
          }

          // Map ppeSize to MeasureUnit
          const measureUnit = mapPpeSizeToMeasureUnit(item.ppeSize);

          if (!measureUnit) {
            throw new Error(`Unable to map ppeSize value: ${item.ppeSize}`);
          }

          // Create the measure record
          await tx.measure.create({
            data: {
              measureType: MeasureType.SIZE,
              unit: measureUnit,
              value: null, // Size doesn't use value, only unit
              itemId: item.id,
            },
          });

          result.measureCreated = true;
          summary.successfulMigrations++;

          console.log(
            `✅ Migrated: ${item.name} (${item.id}) - ppeSize: ${item.ppeSize} → Measure.unit: ${measureUnit}`
          );
        });
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        summary.failedMigrations++;
        console.error(
          `❌ Failed to migrate ${item.name} (${item.id}): ${result.error}`
        );
      }

      summary.results.push(result);
    }

    // Print summary
    console.log('\n📊 Migration Summary:');
    console.log('═══════════════════════════════════════════════');
    console.log(`Total items with ppeSize: ${summary.totalItems}`);
    console.log(`Successful migrations: ${summary.successfulMigrations}`);
    console.log(`Skipped (already migrated): ${summary.skippedItems}`);
    console.log(`Failed migrations: ${summary.failedMigrations}`);
    console.log('═══════════════════════════════════════════════\n');

    if (summary.failedMigrations > 0) {
      console.log('⚠️  Failed migrations:');
      summary.results
        .filter((r) => r.error)
        .forEach((r) => {
          console.log(`  - ${r.itemName} (${r.itemId}): ${r.error}`);
        });
      console.log('');
    }

    // Export detailed log
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = `./scripts/logs/ppesize-migration-${timestamp}.json`;

    try {
      const fs = require('fs');
      const path = require('path');

      // Ensure logs directory exists
      const logsDir = path.dirname(logPath);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      fs.writeFileSync(logPath, JSON.stringify(summary, null, 2));
      console.log(`📝 Detailed migration log saved to: ${logPath}\n`);
    } catch (error) {
      console.warn(`⚠️  Could not save log file: ${error}\n`);
    }

    return summary;
  } catch (error) {
    console.error('💥 Migration failed with fatal error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Rollback function (if needed)
async function rollbackMigration() {
  console.log('🔄 Starting rollback of ppeSize migration...\n');

  try {
    const result = await prisma.measure.deleteMany({
      where: {
        measureType: MeasureType.SIZE,
      },
    });

    console.log(`✅ Rollback complete: Deleted ${result.count} SIZE measures\n`);
  } catch (error) {
    console.error('💥 Rollback failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.includes('--rollback')) {
  rollbackMigration()
    .then(() => {
      console.log('✅ Rollback completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Rollback failed:', error);
      process.exit(1);
    });
} else {
  migratePpeSizeToMeasures()
    .then((summary) => {
      if (summary.failedMigrations > 0) {
        console.log('⚠️  Migration completed with errors');
        process.exit(1);
      } else {
        console.log('✅ Migration completed successfully');
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}
