import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Analyze current positions and user salaries to understand the mapping
 */

async function analyzePositions() {
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
}

// Execute
analyzePositions()
  .catch(e => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Error:', e);
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
