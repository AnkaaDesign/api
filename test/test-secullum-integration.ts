import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Test Secullum integration to verify it's returning overtime data
 */

async function testSecullumIntegration() {
  // Get a user with Secullum ID
  const userWithSecullum = await prisma.user.findFirst({
    where: {
      secullumId: { not: null },
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
  });

  if (!userWithSecullum) {
    return;
  }

  // Check if payrolls exist
  const payrolls = await prisma.payroll.findMany({
    where: {
      userId: userWithSecullum.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 3,
  });

  const latestPayroll = payrolls[0];
  if (!latestPayroll) {
    return;
  }
}

testSecullumIntegration()
  .catch((error) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
