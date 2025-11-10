/**
 * Migration Script: Convert Fractional Inch Measures to Flexible Inch Values
 *
 * This script converts old fractional inch enum values (INCH_1_4, INCH_1_2, etc.)
 * to the new flexible format where users enter numeric values with INCHES unit.
 *
 * Old format: value=1, unit=INCH_1_4 (meaning "1x 1/4 inch")
 * New format: value=0.25, unit=INCHES (meaning "0.25 inches")
 *
 * The conversion preserves the actual measurement by multiplying the quantity
 * by the fractional value.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Mapping of fractional inch units to their decimal equivalents
const FRACTIONAL_INCH_VALUES: Record<string, number> = {
  INCH_1_8: 0.125,   // 1/8" = 0.125"
  INCH_1_4: 0.25,    // 1/4" = 0.25"
  INCH_3_8: 0.375,   // 3/8" = 0.375"
  INCH_1_2: 0.5,     // 1/2" = 0.5"
  INCH_5_8: 0.625,   // 5/8" = 0.625"
  INCH_3_4: 0.75,    // 3/4" = 0.75"
  INCH_7_8: 0.875,   // 7/8" = 0.875"
  INCH_1: 1.0,       // 1" = 1.0"
  INCH_1_1_4: 1.25,  // 1 1/4" = 1.25"
  INCH_1_1_2: 1.5,   // 1 1/2" = 1.5"
  INCH_2: 2.0,       // 2" = 2.0"
};

async function migrateFractionalInches() {
  console.log("🔍 Starting fractional inch migration...\n");

  const fractionalUnits = Object.keys(FRACTIONAL_INCH_VALUES);

  // Find all measures with fractional inch units
  const measuresToMigrate = await prisma.measure.findMany({
    where: {
      unit: {
        in: fractionalUnits as any[],
      },
    },
    include: {
      item: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  console.log(`📊 Found ${measuresToMigrate.length} measures to migrate:\n`);

  // Group by unit for summary
  const summary: Record<string, number> = {};
  fractionalUnits.forEach((unit) => {
    summary[unit] = measuresToMigrate.filter((m) => m.unit === unit).length;
  });

  Object.entries(summary).forEach(([unit, count]) => {
    if (count > 0) {
      console.log(`   ${unit}: ${count} measures`);
    }
  });

  console.log("\n");

  if (measuresToMigrate.length === 0) {
    console.log("✅ No measures to migrate. All done!");
    return;
  }

  // Ask for confirmation
  console.log("📝 Migration plan:");
  console.log("   - Convert fractional inch units to INCHES");
  console.log("   - Multiply quantity by fractional value");
  console.log("   - Example: value=2, unit=INCH_1_4 → value=0.5, unit=INCHES\n");

  // Perform migration
  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ id: string; error: string }> = [];

  console.log("🔄 Migrating measures...\n");

  for (const measure of measuresToMigrate) {
    try {
      const fractionalValue = FRACTIONAL_INCH_VALUES[measure.unit as string];
      const currentValue = measure.value || 1; // Default to 1 if null
      const newValue = currentValue * fractionalValue;

      await prisma.measure.update({
        where: { id: measure.id },
        data: {
          value: newValue,
          unit: "INCHES",
        },
      });

      console.log(
        `   ✓ ${measure.item?.name || "Unknown Item"}: ${currentValue} × ${measure.unit} → ${newValue}" (INCHES)`
      );

      successCount++;
    } catch (error) {
      errorCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ id: measure.id, error: errorMessage });
      console.log(`   ✗ Failed to migrate measure ${measure.id}: ${errorMessage}`);
    }
  }

  console.log("\n📊 Migration Results:");
  console.log(`   ✅ Successfully migrated: ${successCount}`);
  console.log(`   ❌ Failed: ${errorCount}`);

  if (errors.length > 0) {
    console.log("\n❌ Errors:");
    errors.forEach((err) => {
      console.log(`   - ${err.id}: ${err.error}`);
    });
  }

  // Verify migration
  console.log("\n🔍 Verifying migration...");
  const remainingFractional = await prisma.measure.count({
    where: {
      unit: {
        in: fractionalUnits as any[],
      },
    },
  });

  if (remainingFractional === 0) {
    console.log("✅ Migration complete! All fractional inch measures have been converted.");
  } else {
    console.log(`⚠️  Warning: ${remainingFractional} fractional inch measures still remain.`);
  }

  // Show sample of migrated data
  console.log("\n📋 Sample of migrated data:");
  const sampleMigrated = await prisma.measure.findMany({
    where: {
      unit: "INCHES",
      updatedAt: {
        gte: new Date(Date.now() - 60000), // Last minute
      },
    },
    include: {
      item: {
        select: {
          name: true,
        },
      },
    },
    take: 5,
  });

  sampleMigrated.forEach((measure) => {
    console.log(`   ${measure.item?.name || "Unknown"}: ${measure.value}" (${measure.measureType})`);
  });

  console.log("\n✅ Migration script completed!");
}

// Run migration
migrateFractionalInches()
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
