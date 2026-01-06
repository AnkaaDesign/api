import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Check if users have Secullum IDs populated
 */
async function checkSecullumIds() {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      positionId: { not: null },
    },
    select: {
      id: true,
      name: true,
      cpf: true,
      pis: true,
      payrollNumber: true,
      secullumId: true,
    },
    orderBy: {
      name: 'asc',
    },
  });
}

checkSecullumIds()
  .catch((error) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
