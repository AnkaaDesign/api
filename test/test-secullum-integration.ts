import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Test Secullum integration to verify it's returning overtime data
 */

async function testSecullumIntegration() {
  console.log('\n' + '='.repeat(100));
  console.log('🔍 TESTING SECULLUM INTEGRATION');
  console.log('='.repeat(100) + '\n');

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
    console.log('❌ No user found with Secullum ID');
    return;
  }

  console.log(`👤 Testing with: ${userWithSecullum.name}`);
  console.log(`   Secullum ID: ${userWithSecullum.secullumId}`);
  console.log(`   Position: ${userWithSecullum.position?.name || 'N/A'}\n`);

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

  console.log(`📊 Found ${payrolls.length} payroll records:\n`);

  for (const payroll of payrolls) {
    console.log(`${'─'.repeat(100)}`);
    console.log(`📅 ${payroll.month}/${payroll.year}`);
    console.log(`${'─'.repeat(100)}`);
    console.log(`   Base Salary: R$ ${Number(payroll.baseRemuneration).toFixed(2)}`);
    console.log(`   Overtime 50%: ${Number(payroll.overtime50Hours || 0).toFixed(2)}h = R$ ${Number(payroll.overtime50Amount || 0).toFixed(2)}`);
    console.log(`   Overtime 100%: ${Number(payroll.overtime100Hours || 0).toFixed(2)}h = R$ ${Number(payroll.overtime100Amount || 0).toFixed(2)}`);
    console.log(`   DSR: R$ ${Number(payroll.dsrAmount || 0).toFixed(2)}`);
    console.log(`   Absences: ${Number(payroll.absenceHours || 0).toFixed(2)}h`);
    console.log(`   Gross Salary: R$ ${Number(payroll.grossSalary || 0).toFixed(2)}`);
    console.log(`   Net Salary: R$ ${Number(payroll.netSalary || 0).toFixed(2)}\n`);

    // Check if overtime is ZERO (problem!)
    const hasOvertime = Number(payroll.overtime50Amount || 0) > 0 || Number(payroll.overtime100Amount || 0) > 0;
    const hasDSR = Number(payroll.dsrAmount || 0) > 0;

    if (!hasOvertime) {
      console.log(`   ⚠️  WARNING: No overtime data! Secullum might not be returning data.`);
    }

    if (!hasDSR) {
      console.log(`   ⚠️  WARNING: No DSR data!`);
    }

    if (hasOvertime && hasDSR) {
      console.log(`   ✅ Overtime and DSR data present`);
    }
    console.log('');
  }

  console.log('='.repeat(100));
  console.log('\n🔍 DIAGNOSIS:\n');

  const latestPayroll = payrolls[0];
  if (!latestPayroll) {
    console.log('❌ No payroll records found. Run generateForMonth() first.\n');
    return;
  }

  const hasOvertimeData =
    Number(latestPayroll.overtime50Amount || 0) > 0 ||
    Number(latestPayroll.overtime100Amount || 0) > 0;

  if (hasOvertimeData) {
    console.log('✅ SUCCESS: Overtime data is being stored in the database!');
    console.log('   Issue: Frontend might not be displaying overtime fields.\n');
    console.log('   Solution: Check frontend Payroll display component.\n');
  } else {
    console.log('❌ PROBLEM: No overtime data in database!');
    console.log('   Possible causes:');
    console.log('   1. Secullum API is not returning overtime data');
    console.log('   2. Secullum ID might be incorrect');
    console.log('   3. Date range might not match Secullum period (26th-25th)');
    console.log('   4. Secullum integration might be failing silently\n');
    console.log('   Solution: Check Secullum API logs and verify integration.\n');
  }

  console.log('='.repeat(100) + '\n');
}

testSecullumIntegration()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
