/**
 * One-shot: run the off-schedule occurrence reaper NOW.
 *
 * Cancels FUTURE, unpaid, unlinked RecurrentPayableOccurrences whose due date no
 * longer belongs to their payable's configured schedule, writing a ChangeLog row
 * for each. Rows that are paid / bank-linked / NF-linked / match-backed are
 * reported and left alone.
 *
 * The reaper also runs nightly from RecurrentPayableScheduler. This script exists
 * so the first pass can be run and inspected deliberately instead of waiting for
 * 05:15 — `--dry-run` prints exactly what it WOULD do, using the same predicate
 * the real run uses (it calls the same method with `dryRun: true`), so the preview
 * and the action cannot disagree.
 *
 *   npx ts-node -r tsconfig-paths/register src/scripts/reap-off-schedule-payable-occurrences.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/scripts/reap-off-schedule-payable-occurrences.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RecurrentPayableService } from '../modules/financial/recurrent-payable/recurrent-payable.service';

const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// The report goes to stdout, not the Nest logger — the script must print its
// findings regardless of how the app context's log level is configured.
/* eslint-disable no-console */
function out(line = ''): void {
  console.log(line);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const service = app.get(RecurrentPayableService);
    const result = await service.reapOffScheduleOccurrences({ dryRun });

    out();
    out('='.repeat(78));
    out(`REAPER${dryRun ? ' — DRY RUN (nada foi gravado)' : ''}`);
    out(`Congelamento: nada com vencimento antes de ${result.horizonStart.toISOString()} é tocado.`);
    out('='.repeat(78));

    if (result.details.length === 0) {
      out('Nenhuma ocorrência futura fora de agenda.');
      return;
    }

    let lastPayable = '';
    for (const d of result.details) {
      if (d.payableName !== lastPayable) {
        lastPayable = d.payableName;
        const sched = d.daysOfWeek.length
          ? `dias=[${d.daysOfWeek.map(n => WEEKDAY[n]).join(',')}]`
          : `dia do mês=${d.dueDayOfMonth}`;
        out();
        out(`${d.payableName}  —  ${d.frequency} ${sched}`);
      }
      const sp = new Date(d.dueDate.getTime() + SP_OFFSET_MS);
      out(
        `  ${sp.toISOString().slice(0, 10)} (${WEEKDAY[sp.getUTCDay()]})  ` +
          `${d.status.padEnd(9)} R$ ${d.estimatedAmount.toFixed(2).padStart(9)}  ` +
          `${d.action === 'cancelled' ? (dryRun ? '→ SERIA CANCELADA' : '→ CANCELADA') : '→ mantida (paga/vinculada)'}`,
      );
    }

    const total = result.details
      .filter(d => d.action === 'cancelled')
      .reduce((s, d) => s + d.estimatedAmount, 0);
    out();
    out('-'.repeat(78));
    out(
      `${result.cancelled} ocorrência(s) ${dryRun ? 'seriam canceladas' : 'canceladas'} ` +
        `(R$ ${total.toFixed(2)}); ${result.stranded} mantida(s) por já estarem pagas/vinculadas.`,
    );
    if (dryRun) out('Rode sem --dry-run para aplicar.');
  } finally {
    await app.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
