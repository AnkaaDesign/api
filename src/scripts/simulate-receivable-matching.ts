/**
 * simulate-receivable-matching.ts
 * READ-ONLY dry-run of the identity-first receivable matcher over all pending
 * credits. Constructs ReceivableMatchService directly (real code, stubbed deps)
 * so it exercises the actual resolution/planning logic without the DI graph.
 * Mutates nothing.
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register src/scripts/simulate-receivable-matching.ts
 */

import { PrismaClient } from '@prisma/client';
import { ReceivableMatchService } from '../modules/financial/reconciliation/receivable-match.service';

const brl = (n: number): string =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  // Stub deps: simulate() never calls the cascade; config.get returns the
  // provided default (so every RECEIVABLE_* flag is its default — all on).
  const cascade = { cascadeFromInstallment: async () => undefined } as any;
  const config = { get: (_key: string, def: unknown) => def } as any;
  const svc = new ReceivableMatchService(prisma as any, cascade, config);

  try {
    const r = await svc.simulateInflowMatching();
    const pct = (n: number): string =>
      r.totalPending ? `${Math.round((n / r.totalPending) * 100)}%` : '0%';

    const L = (s: string) => process.stdout.write(s + '\n');
    L('================ RECEIVABLE MATCHING DRY-RUN ================');
    L(`Pending credits: ${r.totalPending}  (${brl(r.totalPendingValue)})`);
    L('');
    L(`AUTO-MATCH        : ${r.wouldAutoMatch.count} (${pct(r.wouldAutoMatch.count)})  ${brl(r.wouldAutoMatch.value)}`);
    L(`    via CNPJ=${r.wouldAutoMatch.byVia.cnpj}  via name=${r.wouldAutoMatch.byVia.name}`);
    L(`    by kind: ${JSON.stringify(r.wouldAutoMatch.byKind)}`);
    L(`SUGGESTION(1-clk) : ${r.suggestion.count} (${pct(r.suggestion.count)})  ${brl(r.suggestion.value)}`);
    L(`resolved no-value : ${r.resolvedNoValue.count} (${pct(r.resolvedNoValue.count)})  ${brl(r.resolvedNoValue.value)}`);
    L(`unresolved        : ${r.unresolved.count} (${pct(r.unresolved.count)})  ${brl(r.unresolved.value)}`);
    L('');
    L('Samples (amount / via / auto / kind / #inst / counterparty):');
    for (const s of r.samples) {
      L(
        `  ${brl(s.amount).padStart(16)}  ${(s.via ?? '-').padEnd(5)} ${s.auto ? 'AUTO ' : '     '} ` +
          `${(s.kind ?? '-').padEnd(11)} ${String(s.installments).padStart(2)}  ${(s.counterparty ?? '').slice(0, 45)}`,
      );
    }
    L('============================================================');
  } catch (err) {
    process.stderr.write(`Simulation failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
