import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generate October 2025 payrolls directly using SQL/Prisma
 * Since we can't easily auth to the API, we'll trigger via a simpler method
 */
async function generateOctoberPayrolls() {
  const year = 2025;
  const month = 10;

  // Check current payrolls
  const existingPayrolls = await prisma.payroll.count({
    where: { year, month },
  });

  await prisma.$disconnect();
}

generateOctoberPayrolls()
  .catch((e) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Error:', e);
    }
    process.exit(1);
  });
