import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignPayrollNumbers() {
  // Get all users without payroll numbers
  const usersWithoutPayrollNumbers = await prisma.user.findMany({
    where: {
      payrollNumber: null,
      status: { not: 'DISMISSED' }, // Only active users
    },
    orderBy: {
      name: 'asc',
    },
  });

  // Get the highest existing payroll number
  const userWithHighestNumber = await prisma.user.findFirst({
    where: {
      payrollNumber: { not: null },
    },
    orderBy: {
      payrollNumber: 'desc',
    },
  });

  let nextNumber = userWithHighestNumber?.payrollNumber ? userWithHighestNumber.payrollNumber + 1 : 1000;

  // Assign sequential numbers
  for (const user of usersWithoutPayrollNumbers) {
    await prisma.user.update({
      where: { id: user.id },
      data: { payrollNumber: nextNumber },
    });

    nextNumber++;
  }

  await prisma.$disconnect();
}

assignPayrollNumbers()
  .catch((e) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Error:', e);
    }
    process.exit(1);
  });
