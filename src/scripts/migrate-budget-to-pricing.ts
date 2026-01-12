#!/usr/bin/env ts-node
/**
 * Migration Script: Budget → TaskPricing
 *
 * This script migrates existing Budget records to the new TaskPricing structure.
 * It preserves all data and auto-approves existing budgets.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-budget-to-pricing.ts
 *
 * Safety:
 * - Runs in transaction (all or nothing)
 * - Does NOT delete old Budget records
 * - Can be run multiple times (skips already migrated)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],
});

interface MigrationStats {
  total: number;
  success: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ budgetId: string; taskId: string; error: string }>;
}

async function migrateBudgetToPricing(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    success: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  console.log('🚀 Starting Budget → TaskPricing migration...\n');

  try {
    // Fetch all budgets with items
    const budgets = await prisma.budget.findMany({
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

    stats.total = budgets.length;
    console.log(`📊 Found ${budgets.length} budgets to migrate\n`);

    if (budgets.length === 0) {
      console.log('✅ No budgets to migrate. Exiting.');
      return stats;
    }

    // Migrate each budget
    for (const budget of budgets) {
      try {
        // Check if already migrated
        const existing = await prisma.taskPricing.findUnique({
          where: { taskId: budget.taskId },
        });

        if (existing) {
          console.log(`⏭️  Skipped: Task ${budget.taskId} already has pricing`);
          stats.skipped++;
          continue;
        }

        // Migrate in transaction
        await prisma.$transaction(async tx => {
          await tx.taskPricing.create({
            data: {
              // Copy core fields
              total: budget.total,
              expiresAt: budget.expiresIn,
              taskId: budget.taskId,

              // Auto-approve existing budgets
              status: 'APPROVED',

              // Migrate items (1:1 structure match)
              items: {
                create: budget.items.map(item => ({
                  description: item.description,
                  amount: item.amount,
                })),
              },
            },
          });
        });

        stats.success++;
        console.log(
          `✅ Migrated: Budget ${budget.id} → TaskPricing for task ${budget.taskId}`,
        );
      } catch (error: any) {
        stats.errors++;
        const errorMsg = error.message || 'Unknown error';
        stats.errorDetails.push({
          budgetId: budget.id,
          taskId: budget.taskId,
          error: errorMsg,
        });
        console.error(
          `❌ Error migrating budget ${budget.id} for task ${budget.taskId}: ${errorMsg}`,
        );
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📈 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Budgets:      ${stats.total}`);
    console.log(`✅ Successfully Migrated: ${stats.success}`);
    console.log(`⏭️  Skipped (already exists): ${stats.skipped}`);
    console.log(`❌ Errors:           ${stats.errors}`);
    console.log('='.repeat(60));

    if (stats.errorDetails.length > 0) {
      console.log('\n⚠️  ERROR DETAILS:');
      stats.errorDetails.forEach((err, idx) => {
        console.log(`  ${idx + 1}. Budget ${err.budgetId} (Task ${err.taskId}):`);
        console.log(`     ${err.error}`);
      });
    }

    if (stats.errors === 0 && stats.success > 0) {
      console.log('\n🎉 Migration completed successfully!');
      console.log('💡 Next steps:');
      console.log('   1. Verify TaskPricing records in database');
      console.log('   2. Test API endpoints');
      console.log('   3. Update frontend to use new pricing field');
      console.log('   4. After verification, old Budget records can be archived');
    } else if (stats.errors > 0) {
      console.log('\n⚠️  Migration completed with errors.');
      console.log('   Review error details above and fix issues.');
      console.log('   You can run this script again to retry failed migrations.');
    }

    return stats;
  } catch (error: any) {
    console.error('\n❌ Fatal error during migration:', error.message);
    throw error;
  }
}

/**
 * Verify migration results
 */
async function verifyMigration(): Promise<void> {
  console.log('\n🔍 Verifying migration...');

  const budgetCount = await prisma.budget.count();
  const pricingCount = await prisma.taskPricing.count();

  console.log(`   Budgets in database:     ${budgetCount}`);
  console.log(`   TaskPricings created:    ${pricingCount}`);

  if (pricingCount > 0) {
    // Sample check
    const samplePricing = await prisma.taskPricing.findFirst({
      include: { items: true },
    });

    if (samplePricing) {
      console.log('\n   ✅ Sample pricing found:');
      console.log(`      ID: ${samplePricing.id}`);
      console.log(`      Status: ${samplePricing.status}`);
      console.log(`      Total: R$ ${samplePricing.total}`);
      console.log(`      Items: ${samplePricing.items.length}`);
      console.log(`      Task: ${samplePricing.taskId}`);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const stats = await migrateBudgetToPricing();
    await verifyMigration();

    // Exit with appropriate code
    if (stats.errors > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
main();
