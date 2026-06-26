/**
 * One-off: generate saved Payroll rows for given months so the payroll pages
 * (and loan/consignado discounts, which attach to saved payrolls) have data.
 * Idempotent — generateForMonth skips users that already have a payroll for
 * the month.
 *
 * Run in dev: BACKUP_PATH=/tmp/ankaa-backup npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/generate-payrolls-once.ts
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { PayrollService } from '../modules/personnel-department/payroll/payroll.service';
import { PrismaService } from '../modules/common/prisma/prisma.service';

const MONTHS: Array<{ year: number; month: number }> = [
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
];

async function main(): Promise<void> {
  const logger = new Logger('GeneratePayrollsOnce');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const payrollService = app.get(PayrollService);

    const admin = await prisma.user.findFirst({
      where: { sector: { privileges: 'ADMIN' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!admin) throw new Error('Nenhum usuário ADMIN encontrado');
    logger.log(`Gerando como: ${admin.name}`);

    for (const { year, month } of MONTHS) {
      const result = await payrollService.generateForMonth(year, month, admin.id);
      logger.log(
        `${year}/${String(month).padStart(2, '0')}: created=${result.created} skipped=${result.skipped} errors=${result.errors.length}`,
      );
      for (const err of result.errors.slice(0, 5)) {
        logger.warn(`  erro: ${JSON.stringify(err).slice(0, 200)}`);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
