import { PrismaClient } from '@prisma/client';
import { CompletePayrollCalculatorService } from '../src/modules/human-resources/payroll/utils/complete-payroll-calculator.service';
import { BrazilianTaxCalculatorService } from '../src/modules/human-resources/payroll/utils/brazilian-tax-calculator.service';
import { SecullumPayrollIntegrationService } from '../src/modules/human-resources/payroll/services/secullum-payroll-integration.service';
import { SecullumService } from '../src/modules/integrations/secullum/secullum.service';
import { PrismaService } from '../src/modules/common/prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

const prisma = new PrismaClient();

/**
 * Test payroll generation with Secullum integration (using direct CPF/PIS/payroll mapping)
 */
async function testPayrollGeneration() {
  console.log('\n' + '='.repeat(100));
  console.log('🔍 TESTING PAYROLL GENERATION WITH SECULLUM INTEGRATION');
  console.log('='.repeat(100) + '\n');

  // Initialize services
  const prismaService = new PrismaService();
  const configService = new ConfigService();
  const httpService = new HttpService();
  const secullumService = new SecullumService(httpService, configService);
  const secullumIntegration = new SecullumPayrollIntegrationService(secullumService);
  const taxCalculator = new BrazilianTaxCalculatorService(prismaService);
  const payrollCalculator = new CompletePayrollCalculatorService(
    prismaService,
    taxCalculator,
    secullumIntegration,
  );

  // Find a test user
  const testUser = await prisma.user.findFirst({
    where: {
      isActive: true,
      positionId: { not: null },
      OR: [{ cpf: { not: null } }, { pis: { not: null } }, { payrollNumber: { not: null } }],
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

  if (!testUser) {
    console.log('❌ No test user found with CPF, PIS, or Payroll Number');
    return;
  }

  console.log(`👤 Testing with: ${testUser.name}`);
  console.log(`   CPF: ${testUser.cpf || 'N/A'}`);
  console.log(`   PIS: ${testUser.pis || 'N/A'}`);
  console.log(`   Payroll Number: ${testUser.payrollNumber || 'N/A'}`);
  console.log(`   Position: ${testUser.position?.name || 'N/A'}\n`);

  const baseSalary =
    testUser.position?.remunerations?.[0]?.value
      ? Number(testUser.position.remunerations[0].value)
      : 2500;

  console.log(`💰 Base Salary: R$ ${baseSalary.toFixed(2)}\n`);

  // Test October 2025 (same as the PDFs)
  const year = 2025;
  const month = 10;

  console.log('='.repeat(100));
  console.log(`📅 Generating payroll for ${month}/${year}`);
  console.log('='.repeat(100) + '\n');

  try {
    const calculation = await payrollCalculator.calculateCompletePayroll({
      employeeId: testUser.id,
      year,
      month,
      baseSalary,
      bonusAmount: 0,
      cpf: testUser.cpf || undefined,
      pis: testUser.pis || undefined,
      payrollNumber: testUser.payrollNumber?.toString() || undefined,
      dependentsCount: 0,
      useSimplifiedDeduction: true,
      unionMember: false,
      isApprentice: false,
    });

    console.log('✅ PAYROLL CALCULATION COMPLETED\n');

    console.log('='.repeat(100));
    console.log('📊 EARNINGS BREAKDOWN');
    console.log('='.repeat(100));
    console.log(`   Base Salary:           R$ ${calculation.baseRemuneration.toFixed(2)}`);
    console.log(
      `   Overtime 50% (${calculation.overtimeEarnings.overtime50Hours.toFixed(2)}h): R$ ${calculation.overtimeEarnings.overtime50Amount.toFixed(2)}`,
    );
    console.log(
      `   Overtime 100% (${calculation.overtimeEarnings.overtime100Hours.toFixed(2)}h): R$ ${calculation.overtimeEarnings.overtime100Amount.toFixed(2)}`,
    );
    console.log(
      `   Night Differential (${calculation.overtimeEarnings.nightHours.toFixed(2)}h): R$ ${calculation.overtimeEarnings.nightDifferentialAmount.toFixed(2)}`,
    );
    console.log(`   DSR (Reflexo):         R$ ${calculation.dsrEarnings.totalDSR.toFixed(2)}`);
    console.log(`   Bonus:                 R$ ${calculation.bonus.toFixed(2)}`);
    console.log(`   ${'─'.repeat(98)}`);
    console.log(`   GROSS SALARY:          R$ ${calculation.grossSalary.toFixed(2)}\n`);

    console.log('='.repeat(100));
    console.log('📉 DEDUCTIONS BREAKDOWN');
    console.log('='.repeat(100));
    console.log(`   INSS:                  R$ ${calculation.taxDeductions.inssAmount.toFixed(2)}`);
    console.log(`   IRRF:                  R$ ${calculation.taxDeductions.irrfAmount.toFixed(2)}`);
    console.log(
      `   Absences (${calculation.absenceDeductions.absenceHours.toFixed(2)}h): R$ ${calculation.absenceDeductions.absenceAmount.toFixed(2)}`,
    );
    console.log(`   ${'─'.repeat(98)}`);
    console.log(`   TOTAL DEDUCTIONS:      R$ ${calculation.totalDeductions.toFixed(2)}\n`);

    console.log('='.repeat(100));
    console.log(`💵 NET SALARY:            R$ ${calculation.netSalary.toFixed(2)}`);
    console.log('='.repeat(100) + '\n');

    // Check if Secullum data was fetched
    const hasOvertimeData =
      calculation.overtimeEarnings.overtime50Amount > 0 ||
      calculation.overtimeEarnings.overtime100Amount > 0;
    const hasDSRData = calculation.dsrEarnings.totalDSR > 0;

    console.log('='.repeat(100));
    console.log('🔍 SECULLUM INTEGRATION STATUS');
    console.log('='.repeat(100));

    if (hasOvertimeData) {
      console.log('✅ Overtime data fetched from Secullum');
    } else {
      console.log('⚠️  No overtime data - employee may not have overtime this period');
    }

    if (hasDSRData) {
      console.log('✅ DSR data calculated');
    } else {
      console.log('⚠️  No DSR data');
    }

    if (!hasOvertimeData && !hasDSRData) {
      console.log('\n❌ PROBLEM: No Secullum data was fetched!');
      console.log('   Possible causes:');
      console.log('   1. User mapping failed (CPF/PIS/Payroll not found in Secullum)');
      console.log('   2. Secullum API is not responding');
      console.log('   3. Column name matching is incorrect');
      console.log('   4. No overtime/DSR for this period in Secullum');
    } else {
      console.log('\n✅ SUCCESS: Secullum integration working!');
    }

    console.log('\n' + '='.repeat(100) + '\n');
  } catch (error) {
    console.error('❌ ERROR:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
  }
}

testPayrollGeneration()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
