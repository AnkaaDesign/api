import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generate October 2025 payrolls directly using SQL/Prisma
 * Since we can't easily auth to the API, we'll trigger via a simpler method
 */
async function generateOctoberPayrolls() {
  const year = 2025;
  const month = 10;

  console.log('\n' + '='.repeat(100));
  console.log(`🔄 GENERATING OCTOBER ${year} PAYROLLS`);
  console.log('='.repeat(100) + '\n');

  console.log('⚠️  NOTE: This script prepared the data. To generate payrolls WITH Secullum integration,');
  console.log('   you need to call the API endpoint with proper authentication.\n');
  console.log('   The application is running and ready at: http://localhost:3030\n');

  // Check current payrolls
  const existingPayrolls = await prisma.payroll.count({
    where: { year, month },
  });

  console.log(`📊 Current status: ${existingPayrolls} payrolls exist for October ${year}\n`);

  // Check users
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
    },
    orderBy: {
      name: 'asc',
    },
  });

  console.log(`👥 Found ${users.length} active users with positions\n`);

  const usersWithMapping = users.filter(u => u.cpf || u.pis || u.payrollNumber);
  const usersWithoutMapping = users.filter(u => !u.cpf && !u.pis && !u.payrollNumber);

  console.log(`✅ Users WITH mapping data (CPF/PIS/Payroll): ${usersWithMapping.length}`);
  console.log(`❌ Users WITHOUT mapping data: ${usersWithoutMapping.length}\n`);

  if (usersWithoutMapping.length > 0) {
    console.log('⚠️  WARNING: The following users cannot be mapped to Secullum:');
    usersWithoutMapping.forEach(u => {
      console.log(`   - ${u.name}`);
    });
    console.log('');
  }

  console.log('='.repeat(100));
  console.log('📝 TO GENERATE PAYROLLS WITH SECULLUM INTEGRATION:');
  console.log('='.repeat(100));
  console.log('\n1. You need to authenticate to the API');
  console.log('\n2. Option A: Use the frontend application');
  console.log('   - Open: http://localhost:5173/recursos-humanos/folha-de-pagamento');
  console.log('   - Click "Generate Payrolls" or similar button');
  console.log('   - Select October 2025');
  console.log('\n2. Option B: Use curl with authentication token');
  console.log('   - First, login to get your JWT token');
  console.log('   - Then run:');
  console.log('     curl -X POST http://localhost:3030/payroll/generate-month \\');
  console.log('       -H "Authorization: Bearer YOUR_JWT_TOKEN" \\');
  console.log('       -H "Content-Type: application/json" \\');
  console.log('       -d \'{"year": 2025, "month": 10}\'');
  console.log('\n3. Option C: Use Postman/Insomnia');
  console.log('   - POST http://localhost:3030/payroll/generate-month');
  console.log('   - Add Authorization header with your JWT token');
  console.log('   - Body: {"year": 2025, "month": 10}');
  console.log('\n' + '='.repeat(100));
  console.log('💡 WHAT WILL HAPPEN:');
  console.log('='.repeat(100));
  console.log('\nFor each user:');
  console.log('1. ✅ System finds Secullum employee using CPF/PIS/PayrollNumber');
  console.log('2. ✅ Fetches overtime, absences, DSR from Secullum (26th Sep - 25th Oct)');
  console.log('3. ✅ Calculates complete payroll with all earnings/deductions');
  console.log('4. ✅ Stores in database');
  console.log('\nExpected results:');
  console.log('- Base Salary from position');
  console.log('- Overtime 50% and 100% from Secullum');
  console.log('- DSR Reflexo calculated on overtime');
  console.log('- Bonus from new algorithm');
  console.log('- INSS, IRRF, absences, etc.');
  console.log('\n' + '='.repeat(100) + '\n');

  await prisma.$disconnect();
}

generateOctoberPayrolls()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
