import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Delete October 2025 payrolls to prepare for regeneration
 */
async function deleteOctoberPayrolls() {
  const year = 2025;
  const month = 10;

  // Check existing payrolls
  const existingPayrolls = await prisma.payroll.findMany({
    where: { year, month },
    include: {
      user: {
        select: {
          name: true,
        },
      },
    },
  });

  if (existingPayrolls.length > 0) {
    // Delete them
    const deleted = await prisma.payroll.deleteMany({
      where: { year, month },
    });
  }

  await prisma.$disconnect();
}

deleteOctoberPayrolls()
  .catch((e) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Error:', e);
    }
    process.exit(1);
  });
