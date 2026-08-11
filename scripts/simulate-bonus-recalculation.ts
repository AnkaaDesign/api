/**
 * simulate-bonus-recalculation.ts — DRY-RUN, SOMENTE LEITURA
 *
 * Mostra, pessoa a pessoa e período a período, quanto cada bônus passa a valer
 * com o divisor proporcional (headcount médio) e o prorrateio individual.
 * NÃO grava nada.
 *
 * Rode isto ANTES de recalcular períodos fechados: os valores de julho e
 * anteriores mudam, e quem já recebeu vai divergir do que o sistema passa a
 * mostrar.
 *
 * Uso:
 *   cd api && npx tsx scripts/simulate-bonus-recalculation.ts            # todos os períodos salvos
 *   cd api && npx tsx scripts/simulate-bonus-recalculation.ts 2026 7     # um período
 */

import { PrismaClient } from '@prisma/client';
import { BonusEligibilityService } from '../src/modules/personnel-department/bonus/bonus-eligibility.service';
import { BonusCalculationService } from '../src/modules/personnel-department/bonus/bonus-calculation.service';
import { BonusCalculationContextService } from '../src/modules/personnel-department/bonus/bonus-calculation-context.service';
import { businessPeriodStart, businessPeriodEnd } from '../src/utils/business-period';
import { roundCurrency, roundAverage } from '../src/utils/currency-precision.util';
import { BONIFICATION_STATUS, TASK_STATUS } from '../src/constants/enums';
import { neutralAbsenceService, ABSENCE_STUB_NOTICE } from './_bonus-absence-stub';

// O aviso é IMPRESSO, não só documentado: um divisor sem o eixo de afastamento
// pode divergir do real, e quem lê a saída precisa saber disso na hora.
console.log('\n' + ABSENCE_STUB_NOTICE);

const prisma = new PrismaClient();
const eligibilityService = new BonusEligibilityService(prisma as never, neutralAbsenceService() as never);
const calcService = new BonusCalculationService();
const contextService = new BonusCalculationContextService(prisma as never);

const brl = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pad = (s: string, n: number): string => s.padEnd(n).slice(0, n);

interface TaskWeights {
  raw: number;
  weighted: number;
}

async function taskWeightsFor(year: number, month: number): Promise<TaskWeights> {
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

  let raw = 0;
  let weighted = 0;
  for (const t of tasks) {
    if (t.bonification === BONIFICATION_STATUS.FULL_BONIFICATION) {
      raw += 1;
      weighted += 1;
    } else if (t.bonification === BONIFICATION_STATUS.PARTIAL_BONIFICATION) {
      raw += 0.5;
      weighted += 0.5;
    } else if (t.bonification === BONIFICATION_STATUS.SUSPENDED_BONIFICATION) {
      raw += 1; // raw conta suspensa como 1.0
    }
  }
  return { raw, weighted };
}

async function runPeriod(year: number, month: number): Promise<{ before: number; after: number }> {
  const [eligibility, weights, context, savedRows] = await Promise.all([
    eligibilityService.resolvePeriodEligibility(year, month),
    taskWeightsFor(year, month),
    contextService.load(),
    prisma.bonus.findMany({
      where: { year, month },
      select: {
        userId: true,
        baseBonus: true,
        netBonus: true,
        performanceLevel: true,
        averageTaskPerUser: true,
        calculationParams: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  // Reproduz o mesmo reajuste que a linha salva usou, para isolar o efeito do
  // divisor. Sem isto a comparação misturaria reajuste com proporcionalidade.
  const adjustment =
    (savedRows[0]?.calculationParams as { config?: { adjustment?: number } } | null)?.config
      ?.adjustment ?? 0;
  const calcConfig = { adjustment };

  const divisor = eligibility.divisor;
  const rawAvg = divisor > 0 ? roundAverage(weights.raw / divisor) : 0;
  const netAvg = divisor > 0 ? roundAverage(weights.weighted / divisor) : 0;

  const savedByUser = new Map(savedRows.map(r => [r.userId, r]));

  console.log('\n' + '='.repeat(94));
  console.log(
    `PERÍODO ${String(month).padStart(2, '0')}/${year}  ·  ` +
      `${eligibility.periodBusinessDays} dias úteis  ·  ` +
      `divisor ${divisor.toFixed(4)}  ·  B1 ${netAvg.toFixed(2)}`,
  );
  console.log('='.repeat(94));
  console.log(
    `\n${pad('COLABORADOR', 34)} ${pad('PESO', 7)} ${pad('ANTES', 13)} ${pad('DEPOIS', 13)} ${pad('DELTA', 13)} OBS`,
  );
  console.log('-'.repeat(94));

  let totalBefore = 0;
  let totalAfter = 0;
  const seen = new Set<string>();

  const rows = [...eligibility.entries].sort((a, b) => a.userName.localeCompare(b.userName));

  for (const e of rows) {
    seen.add(e.userId);
    const salary = context.salaryByPositionId.get(e.positionId ?? '') ?? 0;

    const fullBase = calcService.calculateBonus({
      salary,
      performanceLevel: e.performanceLevel,
      averageTasksPerUser: rawAvg,
      salaryRange: context.salaryRange,
      config: calcConfig,
    });
    const fullNet = calcService.calculateBonus({
      salary,
      performanceLevel: e.performanceLevel,
      averageTasksPerUser: netAvg,
      salaryRange: context.salaryRange,
      config: calcConfig,
    });
    const after = roundCurrency(Math.min(fullBase, fullNet) * e.weight);

    const saved = savedByUser.get(e.userId);
    const before = saved ? Number(saved.baseBonus) : 0;
    totalBefore += before;
    totalAfter += after;

    const obs = [
      e.weight < 1 ? `${e.eligibleDays}/${eligibility.periodBusinessDays} d.ú.` : null,
      e.terminatedInPeriod
        ? `desligado ${e.terminationDate?.toISOString().slice(0, 10)}`
        : null,
      !saved ? 'SEM LINHA HOJE' : null,
      !e.hasSecullumId ? 'sem ponto' : null,
    ]
      .filter(Boolean)
      .join(', ');

    const delta = after - before;
    console.log(
      `${pad(e.userName, 34)} ${pad(`${(e.weight * 100).toFixed(0)}%`, 7)} ` +
        `${pad(brl(before), 13)} ${pad(brl(after), 13)} ` +
        `${pad((delta >= 0 ? '+' : '') + brl(delta), 13)} ${obs}`,
    );
  }

  // Linhas salvas de gente que o novo cálculo NÃO considera elegível.
  const orphans = savedRows.filter(r => !seen.has(r.userId) && Number(r.baseBonus) > 0);
  if (orphans.length > 0) {
    console.log('-'.repeat(94));
    console.log('  LINHAS SALVAS QUE O NOVO CÁLCULO NÃO REPRODUZ (viram R$ 0,00):');
    for (const o of orphans) {
      totalBefore += Number(o.baseBonus);
      console.log(
        `  ${pad(o.user.name, 34)} ${pad('', 7)} ${pad(brl(Number(o.baseBonus)), 13)} ` +
          `${pad(brl(0), 13)} ${pad('-' + brl(Number(o.baseBonus)), 13)} conferir manualmente`,
      );
    }
  }

  console.log('-'.repeat(94));
  const totalDelta = totalAfter - totalBefore;
  console.log(
    `${pad('TOTAL', 34)} ${pad('', 7)} ${pad(brl(totalBefore), 13)} ${pad(brl(totalAfter), 13)} ` +
      `${pad((totalDelta >= 0 ? '+' : '') + brl(totalDelta), 13)} ` +
      `${totalBefore > 0 ? ((totalAfter / totalBefore - 1) * 100).toFixed(1) + '%' : ''}`,
  );

  return { before: totalBefore, after: totalAfter };
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

  let grandBefore = 0;
  let grandAfter = 0;
  for (const p of periods) {
    const { before, after } = await runPeriod(p.year, p.month);
    grandBefore += before;
    grandAfter += after;
  }

  console.log('\n' + '='.repeat(94));
  console.log(
    `TOTAL GERAL (${periods.length} período(s)):  antes ${brl(grandBefore)}  →  depois ${brl(grandAfter)}  ` +
      `(${grandBefore > 0 ? ((grandAfter / grandBefore - 1) * 100).toFixed(1) + '%' : '—'})`,
  );
  console.log('NADA FOI GRAVADO. Este script é somente leitura.');
  console.log('='.repeat(94) + '\n');
}

main()
  .catch(err => {
    console.error('\nFalhou:', err instanceof Error ? err.stack : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
