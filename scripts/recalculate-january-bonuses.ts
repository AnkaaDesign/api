import { PrismaClient } from '@prisma/client';

/**
 * Script to delete January 2026 bonuses and trigger recalculation
 *
 * Usage:
 *   npx ts-node scripts/recalculate-january-bonuses.ts
 *
 * Or via the API:
 *   POST /bonus/calculate/2026/1
 */

const prisma = new PrismaClient();

async function main() {
  const year = 2026;
  const month = 1; // January

  console.log(`\n🗑️  Deleting existing bonuses for ${month}/${year}...\n`);

  try {
    // Find bonuses to delete
    const existingBonuses = await prisma.bonus.findMany({
      where: {
        year,
        month,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        bonusExtras: true,
        bonusDiscounts: true,
      },
    });

    console.log(`Found ${existingBonuses.length} bonuses to delete:`);
    existingBonuses.forEach(bonus => {
      console.log(`  - ${bonus.user.name}: Base=${bonus.baseBonus}, Net=${bonus.netBonus}, Extras=${bonus.bonusExtras.length}, Discounts=${bonus.bonusDiscounts.length}`);
    });

    if (existingBonuses.length === 0) {
      console.log('\n✅ No bonuses found for this period. Ready for fresh calculation.\n');
      return;
    }

    // Delete bonusExtras and bonusDiscounts first (cascade should handle this, but explicit is safer)
    const extraIds = existingBonuses.flatMap(b => b.bonusExtras.map(e => e.id));
    const discountIds = existingBonuses.flatMap(b => b.bonusDiscounts.map(d => d.id));

    if (extraIds.length > 0) {
      const deletedExtras = await prisma.bonusExtra.deleteMany({
        where: {
          id: { in: extraIds },
        },
      });
      console.log(`\n🗑️  Deleted ${deletedExtras.count} bonusExtras`);
    }

    if (discountIds.length > 0) {
      const deletedDiscounts = await prisma.bonusDiscount.deleteMany({
        where: {
          id: { in: discountIds },
        },
      });
      console.log(`🗑️  Deleted ${deletedDiscounts.count} bonusDiscounts`);
    }

    // Delete the bonuses
    const deleted = await prisma.bonus.deleteMany({
      where: {
        year,
        month,
      },
    });

    console.log(`\n✅ Successfully deleted ${deleted.count} bonuses for ${month}/${year}\n`);
    console.log('📊 Now you can recalculate using one of these methods:\n');
    console.log('   1. Via API (requires authentication):');
    console.log(`      POST http://localhost:3000/bonus/calculate/${year}/${month}`);
    console.log('');
    console.log('   2. Via Admin UI:');
    console.log('      Navigate to Bonus page → "Recalcular Bônus" button');
    console.log('');
    console.log('   3. Wait for automatic cron job:');
    console.log('      Runs on 6th of each month at 00:00');
    console.log('');

  } catch (error) {
    console.error('\n❌ Error deleting bonuses:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
