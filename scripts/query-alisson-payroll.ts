import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    // Get Alisson's user details
    const user = await prisma.user.findFirst({
      where: {
        name: {
          contains: 'Alisson',
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        cpf: true,
        payrollNumber: true,
      },
    });

    if (!user) {
      console.error('User Alisson not found');
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('=== USER DETAILS ===');
      console.log(JSON.stringify(user, null, 2));
    }

    // Get payroll data with discounts
    const payrolls = await prisma.payroll.findMany({
      where: {
        userId: user.id,
      },
      include: {
        discounts: true,
        position: {
          select: {
            name: true,
          },
        },
        bonus: {
          select: {
            id: true,
            baseBonus: true,
            netBonus: true,
            weightedTasks: true,
            performanceLevel: true,
          },
        },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n=== PAYROLL DATA ===');
      console.log(JSON.stringify(payrolls, null, 2));
    }

    // Specifically get October 2025 payroll
    const octoberPayroll = payrolls.find(p => p.year === 2025 && p.month === 10);

    if (octoberPayroll) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('\n=== OCTOBER 2025 PAYROLL (DETAILED) ===');
        console.log(JSON.stringify(octoberPayroll, null, 2));

        console.log('\n=== OCTOBER 2025 PAYROLL DISCOUNTS ===');
        if (octoberPayroll.discounts && octoberPayroll.discounts.length > 0) {
          octoberPayroll.discounts.forEach((discount, index) => {
            console.log(`\nDiscount ${index + 1}:`);
            console.log(JSON.stringify(discount, null, 2));
          });
        } else {
          console.log('No discounts found for October 2025');
        }
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        console.log('\n=== OCTOBER 2025 PAYROLL NOT FOUND ===');
      }
    }

  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
