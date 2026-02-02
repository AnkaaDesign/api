import { PrismaClient } from '@prisma/client';

/**
 * Script to delete January 2026 bonuses
 * After deletion, the UI will show live-calculated bonuses with the NEW reversed logic
 *
 * Usage:
 *   npx ts-node scripts/delete-january-bonuses.ts
 */

const prisma = new PrismaClient();

async function main() {
  const year = 2026;
  const month = 1; // January

  console.log(`\n🗑️  Deleting bonuses for ${month}/${year}...\n`);

  try {
    // Delete bonuses (cascade will handle bonusExtras and bonusDiscounts automatically)
    const deleted = await prisma.bonus.deleteMany({
      where: {
        year,
        month,
      },
    });

    console.log(`✅ Successfully deleted ${deleted.count} bonus records\n`);
    console.log('🎉 Now refresh your UI and you\'ll see LIVE bonuses with the NEW reversed logic!\n');
    console.log('📊 Look for:');
    console.log('   - Holiday count in logs');
    console.log('   - "incorrectDays" in logs');
    console.log('   - "(reversed logic)" label in logs');
    console.log('   - Percentage = working days - incorrect days\n');

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
