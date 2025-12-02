import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Analyze current positions and user salaries to understand the mapping
 */

async function analyzePositions() {
  console.log('\n📊 CURRENT USERS AND POSITIONS\n');
  console.log('='.repeat(100));

  const users = await prisma.user.findMany({
    where: {
      payrollNumber: { not: null },
    },
    include: {
      position: {
        include: {
          remunerations: {
            where: { current: true },
            take: 1,
          },
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });

  console.log(`\nTotal Users with Payroll: ${users.length}\n`);

  for (const user of users) {
    const position = user.position;
    const salary = position?.remunerations?.[0]?.value || 0;

    console.log(`${user.name.padEnd(30)} | Position: ${position?.name.padEnd(30) || 'NO POSITION'} | Salary: R$ ${salary.toFixed(2)}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log('\n📋 ALL POSITIONS IN DATABASE\n');
  console.log('='.repeat(100));

  const positions = await prisma.position.findMany({
    include: {
      remunerations: {
        where: { current: true },
        take: 1,
      },
      users: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });

  for (const pos of positions) {
    const salary = pos.remunerations?.[0]?.value || 0;
    const userCount = pos.users.length;

    console.log(`\n${pos.name}`);
    console.log(`  Salary: R$ ${salary.toFixed(2)}`);
    console.log(`  Users (${userCount}): ${pos.users.map(u => u.name).join(', ') || 'None'}`);
  }

  console.log('\n' + '='.repeat(100));
}

// Execute
analyzePositions()
  .catch(e => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
