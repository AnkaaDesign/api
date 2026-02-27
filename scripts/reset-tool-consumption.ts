/**
 * Script to reset monthly consumption to 0 for all items with TOOL category
 * Usage: npx ts-node -r tsconfig-paths/register scripts/reset-tool-consumption.ts [--dry-run|--execute]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('Running in DRY RUN mode. Use --execute to actually update items.\n');
  } else {
    console.log('Running in EXECUTE mode. Items will be updated.\n');
  }

  try {
    // Find all items with TOOL category type
    const toolItems = await prisma.item.findMany({
      where: {
        category: {
          type: 'TOOL',
        },
      },
      select: {
        id: true,
        name: true,
        monthlyConsumption: true,
        category: {
          select: {
            name: true,
            type: true,
          },
        },
      },
    });

    console.log(`Found ${toolItems.length} items with TOOL category\n`);

    if (toolItems.length === 0) {
      console.log('No items to update.');
      return;
    }

    // Show items that will be updated
    const itemsWithConsumption = toolItems.filter(
      (item) => Number(item.monthlyConsumption) > 0,
    );

    console.log(
      `Items with non-zero monthly consumption: ${itemsWithConsumption.length}`,
    );

    if (itemsWithConsumption.length > 0) {
      console.log('\nItems to be updated:');
      itemsWithConsumption.slice(0, 20).forEach((item) => {
        console.log(
          `  - ${item.name} (current: ${item.monthlyConsumption}, category: ${item.category?.name})`,
        );
      });
      if (itemsWithConsumption.length > 20) {
        console.log(`  ... and ${itemsWithConsumption.length - 20} more`);
      }
    }

    if (!dryRun) {
      // Update all items with TOOL category to have monthlyConsumption = 0
      const result = await prisma.item.updateMany({
        where: {
          category: {
            type: 'TOOL',
          },
        },
        data: {
          monthlyConsumption: 0,
        },
      });

      console.log(`\nUpdated ${result.count} items to have monthlyConsumption = 0`);
    } else {
      console.log(
        `\n[DRY RUN] Would update ${toolItems.length} items to have monthlyConsumption = 0`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
