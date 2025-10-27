import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Script to set initial isActive values for all users
 *
 * Rules:
 * - All CONTRACTED users -> isActive = true
 * - All DISMISSED users -> isActive = false
 * - Exceptions (should be isActive = true regardless of status):
 *   - kennedy.ankaa@gmail.com
 *   - claudema@gmail.com
 *   - arteviva@hotmail.com
 */
async function setInitialIsActiveValues() {
  console.log('Starting to set initial isActive values...\n');

  try {
    // Exception emails that should always be active
    const exceptionEmails = [
      'kennedy.ankaa@gmail.com',
      'claudema@gmail.com',
      'arteviva@hotmail.com',
    ];

    // Step 1: Set all CONTRACTED users to isActive = true
    console.log('Step 1: Setting all CONTRACTED users to isActive = true...');
    const contractedResult = await prisma.user.updateMany({
      where: {
        status: 'CONTRACTED',
      },
      data: {
        isActive: true,
      },
    });
    console.log(`✓ Updated ${contractedResult.count} CONTRACTED users to isActive = true\n`);

    // Step 2: Set all DISMISSED users to isActive = false
    console.log('Step 2: Setting all DISMISSED users to isActive = false...');
    const dismissedResult = await prisma.user.updateMany({
      where: {
        status: 'DISMISSED',
        email: {
          notIn: exceptionEmails,
        },
      },
      data: {
        isActive: false,
      },
    });
    console.log(`✓ Updated ${dismissedResult.count} DISMISSED users to isActive = false\n`);

    // Step 3: Set exception users to isActive = true (regardless of status)
    console.log('Step 3: Setting exception users to isActive = true...');
    const exceptionResult = await prisma.user.updateMany({
      where: {
        email: {
          in: exceptionEmails,
        },
      },
      data: {
        isActive: true,
      },
    });
    console.log(`✓ Updated ${exceptionResult.count} exception users to isActive = true\n`);

    // Step 4: Show summary
    console.log('='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const totalUsers = await prisma.user.count();
    const activeUsers = await prisma.user.count({
      where: { isActive: true },
    });
    const inactiveUsers = await prisma.user.count({
      where: { isActive: false },
    });

    console.log(`Total users: ${totalUsers}`);
    console.log(`Active users (isActive = true): ${activeUsers}`);
    console.log(`Inactive users (isActive = false): ${inactiveUsers}\n`);

    // Show exception users
    console.log('Exception users (should be active):');
    const exceptions = await prisma.user.findMany({
      where: {
        email: {
          in: exceptionEmails,
        },
      },
      select: {
        email: true,
        name: true,
        status: true,
        isActive: true,
      },
    });

    if (exceptions.length > 0) {
      exceptions.forEach(user => {
        console.log(`  - ${user.name} (${user.email}): status=${user.status}, isActive=${user.isActive}`);
      });
    } else {
      console.log('  No exception users found!');
    }

    console.log('\n✓ Script completed successfully!');
  } catch (error) {
    console.error('Error setting isActive values:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
setInitialIsActiveValues()
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
