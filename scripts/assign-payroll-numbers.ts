import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignPayrollNumbers() {
  console.log('🔄 Assigning payroll numbers to users...\n');

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

  console.log(`📊 Found ${usersWithoutPayrollNumbers.length} users without payroll numbers\n`);

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

    console.log(`✅ Assigned payroll number ${nextNumber} to ${user.name}`);
    nextNumber++;
  }

  console.log(`\n✅ Assigned ${usersWithoutPayrollNumbers.length} payroll numbers!`);
  console.log(`📊 Range: ${userWithHighestNumber?.payrollNumber || 1000} - ${nextNumber - 1}\n`);

  await prisma.$disconnect();
}

assignPayrollNumbers()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
