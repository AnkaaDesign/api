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
    return;
  }

  const baseSalary =
    testUser.position?.remunerations?.[0]?.value
      ? Number(testUser.position.remunerations[0].value)
      : 2500;

  // Test October 2025 (same as the PDFs)
  const year = 2025;
  const month = 10;

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
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ ERROR:', error);
      if (error instanceof Error) {
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
      }
    }
  }
}

testPayrollGeneration()
  .catch((error) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
