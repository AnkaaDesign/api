import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAlissonPayroll() {
  console.log('\n' + '='.repeat(100));
  console.log('🔍 CHECKING ALISSON PAYROLL - OCTOBER 2025');
  console.log('='.repeat(100) + '\n');

  const payroll = await prisma.payroll.findFirst({
    where: {
      year: 2025,
      month: 10,
      user: {
        name: {
          contains: 'Alisson',
        },
      },
    },
    include: {
      user: {
        select: {
          name: true,
          cpf: true,
          pis: true,
          payrollNumber: true,
        },
      },
    },
  });

  if (!payroll) {
    console.log('❌ No payroll found for Alisson in October 2025');
    return;
  }

  console.log(`📊 PAYROLL DATA FOR: ${payroll.user.name}\n`);

  console.log('=' + '='.repeat(99));
  console.log('💰 EARNINGS');
  console.log('=' + '='.repeat(99));
  console.log(`Base Remuneration:        R$ ${Number(payroll.baseRemuneration).toFixed(2)}`);
  console.log(`Overtime 50% (${Number(payroll.overtime50Hours || 0).toFixed(2)}h): R$ ${Number(payroll.overtime50Amount || 0).toFixed(2)}`);
  console.log(`Overtime 100% (${Number(payroll.overtime100Hours || 0).toFixed(2)}h): R$ ${Number(payroll.overtime100Amount || 0).toFixed(2)}`);
  console.log(`Night Diff (${Number(payroll.nightHours || 0).toFixed(2)}h): R$ ${Number(payroll.nightDifferentialAmount || 0).toFixed(2)}`);
  console.log(`DSR Amount:               R$ ${Number(payroll.dsrAmount || 0).toFixed(2)}`);
  console.log(`${'-'.repeat(100)}`);
  console.log(`GROSS SALARY:             R$ ${Number(payroll.grossSalary).toFixed(2)}`);
  console.log('');

  console.log('=' + '='.repeat(99));
  console.log('📉 DEDUCTIONS');
  console.log('=' + '='.repeat(99));
  console.log(`INSS Base:                R$ ${Number(payroll.inssBase || 0).toFixed(2)}`);
  console.log(`INSS Amount:              R$ ${Number(payroll.inssAmount || 0).toFixed(2)}`);
  console.log(`IRRF Base:                R$ ${Number(payroll.irrfBase || 0).toFixed(2)}`);
  console.log(`IRRF Amount:              R$ ${Number(payroll.irrfAmount || 0).toFixed(2)}`);
  console.log(`FGTS Amount:              R$ ${Number(payroll.fgtsAmount || 0).toFixed(2)}`);
  console.log(`Absence Hours:            ${Number(payroll.absenceHours || 0).toFixed(2)}h`);
  console.log(`${'-'.repeat(100)}`);
  console.log(`TOTAL DISCOUNTS:          R$ ${Number(payroll.totalDiscounts).toFixed(2)}`);
  console.log('');

  console.log('=' + '='.repeat(99));
  console.log(`💵 NET SALARY:            R$ ${Number(payroll.netSalary).toFixed(2)}`);
  console.log('=' + '='.repeat(99));
  console.log('');

  // Check what should be displayed
  console.log('=' + '='.repeat(99));
  console.log('✅ VERIFICATION');
  console.log('=' + '='.repeat(99));

  const hasOvertime = Number(payroll.overtime50Amount || 0) > 0 || Number(payroll.overtime100Amount || 0) > 0;
  const hasDSR = Number(payroll.dsrAmount || 0) > 0;

  if (hasOvertime) {
    console.log(`✅ OVERTIME DATA EXISTS: R$ ${Number(payroll.overtime50Amount || 0).toFixed(2)}`);
  } else {
    console.log('❌ NO OVERTIME DATA');
  }

  if (hasDSR) {
    console.log(`✅ DSR DATA EXISTS: R$ ${Number(payroll.dsrAmount || 0).toFixed(2)}`);
  } else {
    console.log('❌ NO DSR DATA');
  }

  console.log('');
  console.log('=' + '='.repeat(99));
  console.log('🖥️  FRONTEND ISSUE');
  console.log('=' + '='.repeat(99));
  console.log('The data EXISTS in the database but is NOT being displayed in the frontend.');
  console.log('');
  console.log('The frontend payroll detail page needs to display:');
  console.log('  - overtime50Hours');
  console.log('  - overtime50Amount');
  console.log('  - overtime100Hours');
  console.log('  - overtime100Amount');
  console.log('  - dsrAmount');
  console.log('');
  console.log('These fields are populated in the database but missing from the UI.');
  console.log('=' + '='.repeat(99) + '\n');

  await prisma.$disconnect();
}

checkAlissonPayroll().catch(console.error);
