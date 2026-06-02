/**
 * tx-category-utilities-cleanup.ts  (idempotent)
 * Phase 1 (safe): add proper recurring utility categories (replacing the generic
 * "Convênio"), and delete categories with ZERO references. Destructive deletes of
 * in-use categories are handled separately after confirmation.
 *
 * Run: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/tx-category-utilities-cleanup.ts
 */
import { NestFactory } from '@nestjs/core';
import { AccountingType, TransactionCategoryKind } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../modules/common/prisma/prisma.service';

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Recurring fixed-cost utilities. isResolving=true so tagging an NF-less bill
// payment resolves the transaction (same behaviour the old Aluguel/Convênio had).
const UTILITIES = ['Água', 'Energia Elétrica', 'Internet / Telefone'];

// Categories safe to remove now (verified 0 references).
const SAFE_DELETE = ['Outros'];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);

  for (const name of UTILITIES) {
    const existing = await prisma.transactionCategory.findFirst({ where: { name } });
    if (existing) {
      await prisma.transactionCategory.update({
        where: { id: existing.id },
        data: { accountingType: AccountingType.DESPESAS_FIXAS, isRecurring: true, isResolving: true, isActive: true },
      });
      console.log('UPDATED', name);
    } else {
      await prisma.transactionCategory.create({
        data: {
          name, slug: slug(name), kind: TransactionCategoryKind.TRANSACTION_ONLY,
          accountingType: AccountingType.DESPESAS_FIXAS, isRecurring: true, isResolving: true, isActive: true,
        },
      });
      console.log('CREATED', name);
    }
  }

  for (const name of SAFE_DELETE) {
    const c = await prisma.transactionCategory.findFirst({ where: { name } });
    if (!c) { console.log('SKIP (missing)', name); continue; }
    const refs = await prisma.bankTransactionCategory.count({ where: { categoryId: c.id } });
    const fiscal = await prisma.fiscalDocumentItem.count({ where: { categoryId: c.id } });
    if (refs > 0 || fiscal > 0) { console.log('SKIP (in use)', name, { refs, fiscal }); continue; }
    await prisma.reconciliationAlias.updateMany({ where: { categoryId: c.id }, data: { categoryId: null } });
    await prisma.transactionCategory.delete({ where: { id: c.id } });
    console.log('DELETED', name);
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
