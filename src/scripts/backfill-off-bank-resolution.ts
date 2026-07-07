/**
 * backfill-off-bank-resolution.ts
 * ---------------------------------------------------------------------------
 * One-off: apply the off-bank settlement detection (credit-card / bonificação /
 * no-payment) to EXISTING received notes that have no bank match yet, so the
 * VMD bonus note, Google credit-card services, etc. immediately drop out of the
 * "Pendentes" list and every transaction's candidate pool.
 *
 * Idempotent + conservative:
 *   - only ENTRADA + AUTHORIZED,
 *   - only notes with NO non-reversed ReconciliationMatch,
 *   - only notes not already off-bank-resolved (offBankResolvedAt IS NULL),
 *   - source = AUTO (a manual resolution is never touched).
 *
 * Run: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/backfill-off-bank-resolution.ts
 * Dry-run: append `--dry`.
 */
import { PrismaClient, ReconciliationSource } from '@prisma/client';
import { detectOffBankResolution } from '../modules/financial/reconciliation/off-bank-resolution';

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const prisma = new PrismaClient();

  const docs = await prisma.fiscalDocument.findMany({
    where: {
      operationType: 'ENTRADA',
      status: 'AUTHORIZED',
      offBankResolvedAt: null,
      matches: { none: { reversedAt: null } },
    },
    select: {
      id: true,
      nfNumber: true,
      emitName: true,
      emitCnpj: true,
      naturezaOperacao: true,
      paymentMethods: true,
    },
  });

  const counts: Record<string, number> = {};
  let applied = 0;
  for (const d of docs) {
    const resolution = detectOffBankResolution({
      operationType: 'ENTRADA',
      naturezaOperacao: d.naturezaOperacao,
      paymentMethods: d.paymentMethods,
      emitCnpj: d.emitCnpj,
    });
    if (!resolution) continue;
    counts[resolution] = (counts[resolution] ?? 0) + 1;
    applied += 1;
    if (applied <= 25) {
      console.log(
        `  ${resolution.padEnd(15)} NF ${String(d.nfNumber ?? '—').padStart(8)}  ${(d.emitName ?? '—').slice(0, 42)}`,
      );
    }
    if (!dry) {
      await prisma.fiscalDocument.update({
        where: { id: d.id },
        data: {
          offBankResolution: resolution,
          offBankResolvedAt: new Date(),
          offBankResolutionSource: ReconciliationSource.AUTO,
        },
      });
    }
  }

  console.log(
    `\n${dry ? '[DRY] would resolve' : 'Resolved'} ${applied}/${docs.length} scanned. By reason: ${JSON.stringify(counts)}`,
  );
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
