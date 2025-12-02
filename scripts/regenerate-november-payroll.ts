import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get month name in Portuguese
function getMonthName(month: number): string {
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  if (month > 12) return monthNames[0];
  return monthNames[month - 1] || 'Unknown';
}

async function regenerateCurrentMonth() {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-indexed
  const currentDay = currentDate.getDate();
  const currentYear = currentDate.getFullYear();

  // Current month data should only be saved on the 6th of NEXT month
  const previousMonth = currentMonth - 1 || 12;
  const previousMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  console.log('🔄 Current Month Data Management\n');
  console.log(`📅 Current date: ${currentDate.toLocaleDateString()}\n`);

  // We're managing the CURRENT month's data
  console.log(`📌 Managing: ${getMonthName(currentMonth)} ${currentYear}\n`);
  console.log('⚠️  Current month data is NOT yet finalized!');
  console.log('📌 Business Rule:');
  console.log('   - Payroll and bonus payment is made on the 5th of each month');
  console.log('   - Cronjob saves data to database at midnight on the 6th of NEXT month');
  console.log(`   - ${getMonthName(currentMonth)} data will be saved on ${getMonthName(currentMonth + 1)} 6th\n`);
  console.log(`✅ ${getMonthName(currentMonth)} bonuses and payrolls are currently calculated LIVE`);
  console.log(`   (they will be automatically saved on ${getMonthName(currentMonth + 1)} 6th by the cronjob)\n`);
  console.log('💡 To view current month data:');
  console.log('   - Open bonus page: http://localhost:5173/recursos-humanos/bonus');
  console.log('   - Open payroll page: http://localhost:5173/recursos-humanos/folha-de-pagamento');
  console.log('   - Data is calculated in real-time and reflects current tasks/attendance\n');

  // Also offer to clear previous month if it's after the 6th and previous month data exists
  if (currentDay >= 6 && previousMonth > 0) {
    const previousMonthBonusCount = await prisma.bonus.count({
      where: { year: previousMonthYear, month: previousMonth }
    });
    const previousMonthPayrollCount = await prisma.payroll.count({
      where: { year: previousMonthYear, month: previousMonth }
    });

    if (previousMonthBonusCount > 0 || previousMonthPayrollCount > 0) {
      console.log(`📊 Previous month (${getMonthName(previousMonth)} ${previousMonthYear}) data found in database:`);
      console.log(`   - Bonuses: ${previousMonthBonusCount}`);
      console.log(`   - Payrolls: ${previousMonthPayrollCount}`);
      console.log(`\n💡 This data was finalized on ${getMonthName(currentMonth)} 6th\n`);
    }
  }

  await prisma.$disconnect();
}

async function regeneratePreviousMonth() {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentDay = currentDate.getDate();
  const currentYear = currentDate.getFullYear();

  const previousMonth = currentMonth - 1 || 12;
  const previousMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  console.log('🔄 Previous Month Data Management\n');
  console.log(`📅 Current date: ${currentDate.toLocaleDateString()}\n`);
  console.log(`📌 Managing: ${getMonthName(previousMonth)} ${previousMonthYear}\n`);

  // Check if it's after the 6th (when previous month data should be finalized)
  const canFinalizePreviousMonth = currentDay >= 6;

  if (!canFinalizePreviousMonth) {
    console.log(`⚠️  ${getMonthName(previousMonth)} ${previousMonthYear} data is NOT yet finalized!`);
    console.log('📌 Business Rule:');
    console.log('   - Payroll and bonus payment is made on the 5th');
    console.log('   - Cronjob saves data to database at midnight on the 6th');
    console.log(`   - ${getMonthName(previousMonth)} data will be saved on ${getMonthName(currentMonth)} 6th\n`);
    console.log(`✅ ${getMonthName(previousMonth)} bonuses and payrolls are currently calculated LIVE\n`);
    await prisma.$disconnect();
    return;
  }

  // After the 6th - can finalize previous month data
  console.log(`✅ ${getMonthName(currentMonth)} 6th or later - ${getMonthName(previousMonth)} data can be finalized!\n`);

  // Delete existing previous month bonuses
  const deletedBonuses = await prisma.bonus.deleteMany({
    where: {
      year: previousMonthYear,
      month: previousMonth,
    },
  });

  console.log(`✅ Deleted ${deletedBonuses.count} existing ${getMonthName(previousMonth)} bonuses\n`);

  // Delete existing previous month payrolls
  const deletedPayrolls = await prisma.payroll.deleteMany({
    where: {
      year: previousMonthYear,
      month: previousMonth,
    },
  });

  console.log(`✅ Deleted ${deletedPayrolls.count} existing ${getMonthName(previousMonth)} payrolls\n`);

  console.log(`📝 To finalize ${getMonthName(previousMonth)} ${previousMonthYear} data, use the API endpoints:`);
  console.log('\n1. Calculate and save bonuses:');
  console.log(`   POST /api/bonus/calculate/${previousMonthYear}/${previousMonth}`);
  console.log('\n2. Generate payrolls:');
  console.log('   POST /api/payroll/generate-month');
  console.log(`   Body: { "year": ${previousMonthYear}, "month": ${previousMonth} }\n`);
  console.log(`💡 Or run the seed script again (it will now include ${getMonthName(previousMonth)}):\n`);
  console.log('   npm run seed\n');

  await prisma.$disconnect();
}

// Run current month management by default
regenerateCurrentMonth()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
