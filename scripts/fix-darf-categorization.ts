/**
 * Fix: DARF / arrecadação federal tax payments were miscategorized as "Tarifa
 * Bancária" (bank fees), inflating that category to ~R$77k/month in the Previsão
 * de Saídas. These "DEBITO ARRECADACAO-DARF…" debits are TAXES, not bank fees.
 *
 * This re-tags every DEBIT linked to the "Tarifa Bancária" category whose memo
 * looks like a tax payment (ARRECADACAO / DARF / DAS / GPS) onto the "Tributo"
 * category instead. Idempotent: re-running finds nothing left to move. Respects
 * the unique([transactionId, categoryId]) constraint.
 *
 * Run:  npx tsx scripts/fix-darf-categorization.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// Memo signatures of federal tax-collection debits (NOT bank fees).
const TAX_MEMO = /ARRECADACAO|DARF|\bDAS\b|\bGPS\b|\bDARE\b/i;

async function main() {
  console.log(`\n=== Fix DARF categorization ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const [tarifa, tributo] = await Promise.all([
    prisma.transactionCategory.findFirst({ where: { name: { equals: 'Tarifa Bancária' } } }),
    prisma.transactionCategory.findFirst({ where: { name: { equals: 'Tributo' } } }),
  ]);
  if (!tarifa) throw new Error('Category "Tarifa Bancária" not found');
  if (!tributo) throw new Error('Category "Tributo" not found');

  // All "Tarifa Bancária" tags whose transaction memo looks like a tax payment.
  const links = await prisma.bankTransactionCategory.findMany({
    where: {
      categoryId: tarifa.id,
      transaction: { type: 'DEBIT', OR: [{ memo: { contains: 'ARRECADACAO', mode: 'insensitive' } }, { memo: { contains: 'DARF', mode: 'insensitive' } }] },
    },
    select: { id: true, transactionId: true, transaction: { select: { memo: true, amount: true } } },
  });

  const matches = links.filter(l => TAX_MEMO.test(l.transaction.memo ?? ''));
  console.log(`Found ${matches.length} DARF/arrecadação debits tagged as Tarifa Bancária.`);

  // Which target transactions already carry a Tributo tag (would collide on unique)?
  const txIds = matches.map(m => m.transactionId);
  const existingTributo = new Set(
    (
      await prisma.bankTransactionCategory.findMany({
        where: { categoryId: tributo.id, transactionId: { in: txIds } },
        select: { transactionId: true },
      })
    ).map(r => r.transactionId),
  );

  let moved = 0;
  let deletedDup = 0;
  let total = 0;
  for (const m of matches) {
    total += Math.abs(Number(m.transaction.amount));
    if (DRY_RUN) continue;
    if (existingTributo.has(m.transactionId)) {
      // Already tagged Tributo — just drop the stray Tarifa tag.
      await prisma.bankTransactionCategory.delete({ where: { id: m.id } });
      deletedDup++;
    } else {
      await prisma.bankTransactionCategory.update({
        where: { id: m.id },
        data: { categoryId: tributo.id, source: 'MANUAL' },
      });
      moved++;
    }
  }

  console.log(
    `${DRY_RUN ? 'Would move' : 'Moved'} ${DRY_RUN ? matches.length : moved} tag(s) → Tributo` +
      (deletedDup ? `, removed ${deletedDup} duplicate Tarifa tag(s)` : '') +
      ` (R$${total.toFixed(2)} reclassified).`,
  );
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
