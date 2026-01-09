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
    // Check arguments
    const args = process.argv.slice(2);
    const shouldSeedNotifications = args.includes('--notifications') || args.includes('--all');
    const shouldSeedMessages = args.includes('--messages') || args.includes('--all');
    const onlyNotifications = args.includes('--notifications-only');
    const onlyMessages = args.includes('--messages-only');

    if (onlyNotifications) {
      console.log('📬 Running notification seed only...\n');
      execSync('tsx prisma/seeds/notification.seed.ts', { stdio: 'inherit' });
      console.log('\n✅ Notification seeding completed!');
      return;
    }

    if (onlyMessages) {
      console.log('💬 Running message seed only...\n');
      execSync('tsx prisma/seeds/message.seed.ts', { stdio: 'inherit' });
      console.log('\n✅ Message seeding completed!');
      return;
    }

    if (!shouldSeedNotifications && !shouldSeedMessages) {
      console.log('ℹ️  No seeding operations selected.\n');
      console.log('Available options:');
      console.log('   --notifications       Seed notifications');
      console.log('   --messages           Seed messages');
      console.log('   --all                Seed everything');
      console.log('   --notifications-only  Only notifications');
      console.log('   --messages-only      Only messages\n');
      console.log('Examples:');
      console.log('   npm run seed -- --notifications');
      console.log('   npm run seed -- --messages');
      console.log('   npm run seed -- --all\n');
      return;
    }

    // Run notification seed
    if (shouldSeedNotifications) {
      console.log('📬 Seeding notifications...\n');
      execSync('tsx prisma/seeds/notification.seed.ts', { stdio: 'inherit' });
      console.log('');
    }

    // Run message seed
    if (shouldSeedMessages) {
      console.log('💬 Seeding messages...\n');
      execSync('tsx prisma/seeds/message.seed.ts', { stdio: 'inherit' });
      console.log('');
    }

    console.log('✅ All seeding operations completed successfully!');
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
