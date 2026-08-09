/**
 * verify-bonus-eligibility.ts — VERIFICAÇÃO SOMENTE-LEITURA
 *
 * Roda o BonusEligibilityService contra o banco e imprime, para cada período,
 * o divisor ponderado e o peso de cada pessoa — comparando com o divisor
 * "instantâneo" antigo e com o `averageTaskPerUser` que está persistido.
 *
 * Uso:
 *   cd api && npx tsx scripts/verify-bonus-eligibility.ts [ano] [mes]
 *   cd api && npx tsx scripts/verify-bonus-eligibility.ts          # 2026, todos os meses salvos
 */

import { PrismaClient } from '@prisma/client';
import { BonusEligibilityService } from '../src/modules/personnel-department/bonus/bonus-eligibility.service';
import { businessPeriodStart, businessPeriodEnd } from '../src/utils/business-period';
import { BONIFICATION_STATUS, TASK_STATUS } from '../src/constants/enums';

const prisma = new PrismaClient();

// O serviço só usa `this.prisma.user.findMany` — o PrismaClient satisfaz isso.
const service = new BonusEligibilityService(prisma as never);

const poly = (b: number): number =>
  3.31 * b ** 5 - 61.07 * b ** 4 + 364.82 * b ** 3 - 719.54 * b ** 2 + 465.16 * b - 3.24;
const anchor = (b: number): number => poly(Math.min(Math.max(0, b), 6)) * 0.4 * 1.05;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const brl = (v: number): string => `R$ ${v.toFixed(2).padStart(9)}`;

async function weightedTasksFor(year: number, month: number): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: {
      status: TASK_STATUS.COMPLETED,
      finishedAt: { gte: businessPeriodStart(year, month), lte: businessPeriodEnd(year, month) },
      bonification: {
        in: [
          BONIFICATION_STATUS.FULL_BONIFICATION,
          BONIFICATION_STATUS.PARTIAL_BONIFICATION,
          BONIFICATION_STATUS.SUSPENDED_BONIFICATION,
          BONIFICATION_STATUS.NO_BONIFICATION,
        ],
      },
    },
    select: { bonification: true },
  });
  return tasks.reduce((sum, t) => {
    if (t.bonification === BONIFICATION_STATUS.FULL_BONIFICATION) return sum + 1;
    if (t.bonification === BONIFICATION_STATUS.PARTIAL_BONIFICATION) return sum + 0.5;
    return sum;
  }, 0);
}

async function runPeriod(year: number, month: number): Promise<void> {
  const el = await service.resolvePeriodEligibility(year, month);
  const weighted = await weightedTasksFor(year, month);

  const saved = await prisma.bonus.findFirst({
    where: { year, month },
    select: { averageTaskPerUser: true, weightedTasks: true },
  });
  const savedAvg = saved ? Number(saved.averageTaskPerUser) : null;
  const savedDivisor = savedAvg && savedAvg > 0 ? Number(saved!.weightedTasks) / savedAvg : null;

  // Compara maçã com maçã: usa o MESMO numerador salvo, isolando o efeito do
  // divisor. O numerador também pode ter mudado (tarefas reclassificadas), mas
  // isso é ortogonal à correção do divisor.
  const savedWeighted = saved ? Number(saved.weightedTasks) : weighted;
  const newB1 = el.divisor > 0 ? round2(savedWeighted / el.divisor) : 0;
  const newB1Today = el.divisor > 0 ? round2(weighted / el.divisor) : 0;

  console.log('\n' + '='.repeat(76));
  console.log(
    `PERÍODO ${String(month).padStart(2, '0')}/${year}   ` +
      `${el.periodStart.toISOString().slice(0, 10)} → ${el.periodEnd.toISOString().slice(0, 10)}   ` +
      `${el.periodBusinessDays} dias úteis`,
  );
  console.log('='.repeat(76));

  console.log(
    `\n  tarefas ponderadas       : ${savedWeighted} (salvo)` +
      (weighted !== savedWeighted ? `   ⚠ hoje recontam ${weighted}` : ''),
  );
  if (savedDivisor !== null) {
    console.log(
      `  divisor ANTIGO (salvo)   : ${savedDivisor.toFixed(2)}   → B1 ${savedAvg!.toFixed(2)}   anchor ${brl(anchor(savedAvg!))}`,
    );
  }
  console.log(
    `  divisor NOVO (ponderado) : ${el.divisor.toFixed(4)}   → B1 ${newB1.toFixed(2)}   anchor ${brl(anchor(newB1))}`,
  );
  if (savedAvg !== null && savedAvg > 0) {
    const delta = (anchor(newB1) / anchor(savedAvg) - 1) * 100;
    console.log(
      `  efeito SÓ do divisor     : ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
    );
    if (weighted !== savedWeighted) {
      const deltaAll = (anchor(newB1Today) / anchor(savedAvg) - 1) * 100;
      console.log(
        `  efeito com o numerador de hoje: ${deltaAll >= 0 ? '+' : ''}${deltaAll.toFixed(1)}%`,
      );
    }
  }

  const partial = el.entries.filter(e => e.weight < 1).sort((a, b) => a.weight - b.weight);
  console.log(
    `\n  pessoas com peso > 0     : ${el.entries.length}  ` +
      `(${el.entries.filter(e => e.performanceLevel > 0).length} contam no divisor)`,
  );

  if (process.env.VERBOSE) {
    console.log('\n  TODOS:');
    for (const e of [...el.entries].sort((a, b) => a.userName.localeCompare(b.userName))) {
      console.log(
        `    ${e.userName.padEnd(38)} perf=${e.performanceLevel}  ` +
          `${String(e.eligibleDays).padStart(2)}/${el.periodBusinessDays}  peso ${e.weight.toFixed(4)}  ` +
          `${e.reason}${e.currentlyEmployed ? '' : '  [DESLIGADO hoje]'}`,
      );
    }
  }

  if (partial.length > 0) {
    console.log(`\n  PARCIAIS (${partial.length}):`);
    for (const e of partial) {
      const flags = [
        e.performanceLevel === 0 ? 'perf=0 (fora do divisor)' : null,
        !e.currentlyEmployed ? 'DESLIGADO hoje' : null,
        e.terminatedInPeriod
          ? `desligado em ${e.terminationDate?.toISOString().slice(0, 10)}`
          : null,
      ].filter(Boolean);
      console.log(
        `    ${e.userName.padEnd(36)} ${String(e.eligibleDays).padStart(2)}/${el.periodBusinessDays} d.ú.  ` +
          `peso ${e.weight.toFixed(4)}  ${e.reason}` +
          (flags.length ? `  [${flags.join(', ')}]` : ''),
      );
    }
  }

  const dismissed = el.entries.filter(e => !e.currentlyEmployed);
  if (dismissed.length > 0) {
    console.log(
      `\n  ${dismissed.length} pessoa(s) hoje DESLIGADAS mas com bônus no período ` +
        `(hoje o sistema as omite por completo):`,
    );
    for (const e of dismissed) {
      console.log(`    ${e.userName.padEnd(36)} peso ${e.weight.toFixed(4)}`);
    }
  }

  if (el.withoutSecullum.length > 0) {
    console.log(
      `\n  ${el.withoutSecullum.length} pessoa(s) SEM secullumEmployeeId — contam no divisor ` +
        `e recebem bônus, mas sem apuração de ponto:`,
    );
    for (const e of el.withoutSecullum) {
      console.log(
        `    ${e.userName.padEnd(36)} peso ${e.weight.toFixed(4)}  perf=${e.performanceLevel}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const [argYear, argMonth] = process.argv.slice(2).map(Number);

  let periods: Array<{ year: number; month: number }>;
  if (argYear && argMonth) {
    periods = [{ year: argYear, month: argMonth }];
  } else {
    const rows = await prisma.bonus.findMany({
      distinct: ['year', 'month'],
      select: { year: true, month: true },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    periods = rows.map(r => ({ year: r.year, month: r.month }));
  }

  for (const p of periods) await runPeriod(p.year, p.month);

  console.log('\n' + '='.repeat(76));
  console.log('Nenhum dado foi alterado.');
  console.log('='.repeat(76) + '\n');
}

main()
  .catch(err => {
    console.error('\nFalhou:', err instanceof Error ? err.stack : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
