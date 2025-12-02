import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Delete October 2025 payrolls to prepare for regeneration
 */
async function deleteOctoberPayrolls() {
  const year = 2025;
  const month = 10;

  console.log('\n' + '='.repeat(100));
  console.log(`🔄 PREPARING TO REGENERATE OCTOBER ${year} PAYROLLS`);
  console.log('='.repeat(100) + '\n');

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

  console.log(`📊 Found ${existingPayrolls.length} existing October payrolls:\n`);

  if (existingPayrolls.length > 0) {
    existingPayrolls.forEach(p => {
      console.log(`   - ${p.user.name}: Net R$ ${Number(p.netSalary).toFixed(2)}`);
    });
    console.log('');

    // Delete them
    const deleted = await prisma.payroll.deleteMany({
      where: { year, month },
    });

    console.log(`✅ Deleted ${deleted.count} payroll records\n`);
  }

  console.log('='.repeat(100));
  console.log('📝 TO REGENERATE PAYROLLS:');
  console.log('='.repeat(100));
  console.log('\n1. Ensure the application is running (npm run start:dev)');
  console.log('\n2. Call the API endpoint to generate payrolls:');
  console.log('   POST http://localhost:3000/api/payroll/generate-month');
  console.log(`   Headers: { "Authorization": "Bearer YOUR_TOKEN" }`);
  console.log(`   Body: { "year": ${year}, "month": ${month} }`);
  console.log('\n3. Or use curl:');
  console.log('   curl -X POST http://localhost:3000/api/payroll/generate-month \\');
  console.log(`     -H "Authorization: Bearer YOUR_TOKEN" \\`);
  console.log('     -H "Content-Type: application/json" \\');
  console.log(`     -d '{"year": ${year}, "month": ${month}}'`);
  console.log('\n' + '='.repeat(100));
  console.log('💡 WHAT TO EXPECT:');
  console.log('='.repeat(100));
  console.log('\nWith the new direct CPF/PIS/payroll mapping:');
  console.log('1. ✅ System will automatically find Secullum employee using CPF, PIS, or Payroll Number');
  console.log('2. ✅ Fetch overtime, absences, and DSR data from Secullum');
  console.log('3. ✅ Calculate complete payroll with all earnings and deductions');
  console.log('4. ✅ Store in database');
  console.log('\nCheck the logs for:');
  console.log('- "Fetching Secullum payroll data for employee..."');
  console.log('- "Mapped to Secullum employee ID: X"');
  console.log('- "Successfully extracted payroll data..."');
  console.log('\n' + '='.repeat(100) + '\n');

  await prisma.$disconnect();
}

deleteOctoberPayrolls()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
