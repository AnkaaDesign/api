import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

/**
 * Master seed file to orchestrate all seeding operations
 *
 * This file coordinates the execution of all seed scripts in the correct order.
 */

async function main() {
  console.log('🌱 Starting database seeding...\n');

  try {
    // Check if we should seed notifications
    const args = process.argv.slice(2);
    const shouldSeedNotifications = args.includes('--notifications') || args.includes('--all');
    const onlyNotifications = args.includes('--notifications-only');

    if (onlyNotifications) {
      console.log('📬 Running notification seed only...\n');
      execSync('tsx prisma/seeds/notification.seed.ts', { stdio: 'inherit' });
      console.log('\n✅ Notification seeding completed!');
      return;
    }

    if (!shouldSeedNotifications) {
      console.log('ℹ️  Notification seeding skipped. Use --notifications or --all to include it.\n');
      console.log('📝 To seed notifications separately, run:');
      console.log('   npm run seed:notification\n');
      return;
    }

    // Run notification seed
    console.log('📬 Seeding notifications...\n');
    execSync('tsx prisma/seeds/notification.seed.ts', { stdio: 'inherit' });

    console.log('\n✅ All seeding operations completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
