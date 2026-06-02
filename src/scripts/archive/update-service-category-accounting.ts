/**
 * update-service-category-accounting.ts  (idempotent data update)
 * Assigns grupo contábil (accountingType) + recurrence to the explicitly-directed
 * SERVICE transaction categories. Only touches the named rows; safe to re-run.
 *
 * Run: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/update-service-category-accounting.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AccountingType } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../modules/common/prisma/prisma.service';

// name → { accountingType, isRecurring }. Extend after user confirms the rest.
const UPDATES: Record<string, { accountingType: AccountingType; isRecurring?: boolean }> = {
  Monitoramento: { accountingType: AccountingType.DESPESAS_FIXAS, isRecurring: true },
  Contabilidade: { accountingType: AccountingType.DESPESAS_FIXAS, isRecurring: true },
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const log = new Logger('update');

  for (const [name, patch] of Object.entries(UPDATES)) {
    const res = await prisma.transactionCategory.updateMany({
      where: { name, kind: 'SERVICE' },
      data: { accountingType: patch.accountingType, ...(patch.isRecurring !== undefined ? { isRecurring: patch.isRecurring } : {}) },
    });
    log.log(`${name}: ${patch.accountingType}${patch.isRecurring ? ' + recorrente' : ''} → ${res.count} row(s)`);
  }
  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
