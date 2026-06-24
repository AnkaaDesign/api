// migrate-recurring-categories-to-payables.ts
// One-time, idempotent backfill that promotes legacy recurring CATEGORIES
// (TransactionCategory.isRecurring = true) into first-class RecurrentPayables,
// so nothing is lost when the legacy "Recorrentes (categorias)" forecast page
// is retired in favour of the unified canonical "Recorrentes" page.
//
// Execução (NÃO rodar com o banco em restore):
//   cd api && npx tsx scripts/migrate-recurring-categories-to-payables.ts
//   # dry-run (não grava):
//   cd api && npx tsx scripts/migrate-recurring-categories-to-payables.ts --dry
//
// Mapping (category -> RecurrentPayable):
//   name            = category.name
//   categoryId      = category.id
//   amountKind      = category.recurrenceKind        (FIXED | VARIABLE)
//   fixedAmount     = category.fixedAmount            (FIXED only)
//   estimatedAmount = category.fixedAmount            (VARIABLE seed, optional)
//   dueDayOfMonth   = category.dueDayOfMonth ?? 5      (statutory fallback)
//   frequency       = MONTHLY,  frequencyCount = 1
//   expectsNf       = false,    isActive = true
//   nextRun         = today (materializes the current competence on next cron tick)
//
// Idempotência (check-before-insert):
//   - Skips any category that ALREADY has a RecurrentPayable (the "promoted"
//     guard PayablesService uses to avoid double-counting). Re-running is a no-op.
//   - Skips payroll/tax categories (slug 'folha' / accountingType IMPOSTO_TARIFAS):
//     those are sourced by their own payables pipelines, never as recurrents.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY = process.argv.includes('--dry');
const DEFAULT_DUE_DAY = 5;

async function main() {
  const categories = await prisma.transactionCategory.findMany({
    where: { isRecurring: true, isActive: true },
    include: { _count: { select: { recurrentPayables: true } } },
    orderBy: { name: 'asc' },
  });

  let created = 0;
  let skippedPromoted = 0;
  let skippedExcluded = 0;

  for (const cat of categories) {
    // Already promoted → skip (idempotent + matches PayablesService suppression).
    if (cat._count.recurrentPayables > 0) {
      skippedPromoted++;
      continue;
    }
    // Payroll & taxes are not recurrents — they have dedicated payable sources.
    if (cat.slug === 'folha' || cat.accountingType === 'IMPOSTO_TARIFAS') {
      skippedExcluded++;
      continue;
    }

    const amountKind = cat.recurrenceKind; // FIXED | VARIABLE (same enum)
    const dueDayOfMonth = cat.dueDayOfMonth ?? DEFAULT_DUE_DAY;
    const fixedAmount = amountKind === 'FIXED' ? cat.fixedAmount : null;
    const estimatedAmount = amountKind === 'VARIABLE' ? cat.fixedAmount : null;

    console.log(
      `${DRY ? '[dry] ' : ''}+ RecurrentPayable "${cat.name}" (${amountKind}, dia ${dueDayOfMonth})`,
    );

    if (!DRY) {
      await prisma.recurrentPayable.create({
        data: {
          name: cat.name,
          categoryId: cat.id,
          amountKind,
          fixedAmount,
          estimatedAmount,
          frequency: 'MONTHLY',
          frequencyCount: 1,
          dueDayOfMonth,
          expectsNf: false,
          isActive: true,
          nextRun: new Date(),
        },
      });
    }
    created++;
  }

  console.log('\n— Resumo —');
  console.log(`Categorias recorrentes analisadas: ${categories.length}`);
  console.log(`RecurrentPayables criadas:         ${created}${DRY ? ' (dry-run)' : ''}`);
  console.log(`Puladas (já promovidas):           ${skippedPromoted}`);
  console.log(`Puladas (folha/impostos):          ${skippedExcluded}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
