import { PrismaClient } from '@prisma/client';
import { USER_STATUS } from './src/constants';

const prisma = new PrismaClient();

async function createPayrollsForActiveUsers() {
  console.log('📋 Creating payrolls for all active users...');

  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // Get all active users with positions
    const activeUsers = await prisma.user.findMany({
      where: {
        status: USER_STATUS.ACTIVE,
        positionId: { not: null }
      },
      include: {
        position: {
          include: {
            remunerations: {
              orderBy: {
                createdAt: 'desc'
              },
              take: 1
            }
          }
        }
      }
    });

    console.log(`Found ${activeUsers.length} active users with positions`);

    let created = 0;
    let skipped = 0;

    // Create payrolls for each month of the current year
    for (const user of activeUsers) {
      const remuneration = user.position?.remunerations[0];
      if (!remuneration) {
        console.log(`⚠️ No remuneration found for user ${user.name}`);
        continue;
      }

      for (let month = 1; month <= currentMonth; month++) {
        // Check if payroll already exists
        const existing = await prisma.payroll.findUnique({
          where: {
            userId_year_month: {
              userId: user.id,
              year: currentYear,
              month: month
            }
          }
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Create payroll
        const payroll = await prisma.payroll.create({
          data: {
            userId: user.id,
            year: currentYear,
            month: month,
            baseRemuneration: remuneration.value
          }
        });

        // Create standard discounts (INSS and Vale Transporte)
        await prisma.discount.createMany({
          data: [
            {
              payrollId: payroll.id,
              percentage: 11, // INSS 11%
              calculationOrder: 1,
              reference: 'INSS'
            },
            {
              payrollId: payroll.id,
              percentage: 6, // Vale Transporte 6%
              calculationOrder: 2,
              reference: 'Vale Transporte'
            }
          ]
        });

        created++;
      }
    }

    console.log(`✅ Created ${created} payrolls, skipped ${skipped} existing ones`);
    return { created, skipped };

  } catch (error) {
    console.error('❌ Error creating payrolls:', error);
    throw error;
  }
}

async function main() {
  try {
    await createPayrollsForActiveUsers();
    console.log('✅ Payroll creation completed successfully!');
  } catch (error) {
    console.error('❌ Failed to create payrolls:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();