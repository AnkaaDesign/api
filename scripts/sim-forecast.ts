/* eslint-disable no-console */
/**
 * FORECAST + TRIGGER-MODE DEMONSTRATION
 * =====================================
 * For each active schedule, shows the three quantities/spends the UI exposes,
 * computed with the SAME order-up-to model as computeScheduleOrderPlan:
 *
 *   1. PRÓXIMO DISPARO (forecast / "esperado")  — what the cron will order on
 *      nextRun: coverage = interval, stock forward-projected to nextRun.
 *   2. EXECUTAR AGORA · GAP_ONLY                — bridge until the next run:
 *      coverage = gapDays, current stock.
 *   3. EXECUTAR AGORA · GAP_PLUS_CYCLE          — skip the next run:
 *      coverage = gapDays + interval, current stock.
 *
 * Demonstrates that (a) the forecast spend is sensible per item/field, and
 * (b) the two trigger modes produce the expected, distinct windows.
 * Run: node_modules/.bin/tsx scripts/sim-forecast.ts
 */
import { PrismaClient } from '@prisma/client';
import { addMonths, differenceInCalendarDays } from 'date-fns';

const prisma = new PrismaClient();
const Z_BY_ABC: Record<string, number> = { A: 1.96, B: 1.645, C: 1.28 };
const SAFETY_BY_XYZ: Record<string, number> = { X: 0.15, Y: 0.25, Z: 0.35 };
const STAT_MIN_MONTHS = 6;
const DEFAULT_LEAD = 25;

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const r2 = (n: number) => Math.round(n * 100) / 100;
function stddev(xs: number[]): number {
  if (!xs.length) return 0;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

/** Mirrors computeScheduleOrderPlan's per-item order-up-to (seasonal flat = 1). */
function orderUpTo(a: {
  mc: number;
  stock: number;
  incoming: number;
  coverageDays: number;
  leadTime: number;
  sigmaMonthly: number;
  monthsAvailable: number;
  abc: string | null;
  xyz: string | null;
  box: number | null;
}): { qty: number; level: number; ss: number } {
  if (a.mc <= 0) return { qty: 0, level: 0, ss: 0 };
  const protection = a.coverageDays + a.leadTime;
  const daily = a.mc / 30;
  const demand = daily * protection;
  let ss: number;
  if (a.monthsAvailable >= STAT_MIN_MONTHS && a.abc) {
    const z = Z_BY_ABC[a.abc] ?? 1.645;
    ss = z * (a.sigmaMonthly / Math.sqrt(30)) * Math.sqrt(protection);
  } else {
    ss = demand * (a.xyz ? (SAFETY_BY_XYZ[a.xyz] ?? 0.2) : 0.3);
  }
  ss = Math.min(ss, demand);
  const level = demand + ss;
  const need = level - a.stock - a.incoming;
  if (need <= 0) return { qty: 0, level, ss };
  const box = Math.max(1, a.box ?? 1);
  return { qty: Math.ceil(need / box) * box, level, ss };
}

async function main() {
  const now = new Date();
  const schedules = await prisma.orderSchedule.findMany({
    where: { isActive: true, finishedAt: null },
    include: { supplier: true },
    orderBy: { name: 'asc' },
  });
  const allIds = [...new Set(schedules.flatMap(s => s.items))];
  const items = await prisma.item.findMany({
    where: { id: { in: allIds } },
    include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const itemById = new Map(items.map(i => [i.id, i]));

  const snaps = await prisma.consumptionSnapshot.findMany({
    where: { itemId: { in: allIds } },
    select: { itemId: true, normalizedConsumption: true },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  const histById = new Map<string, number[]>();
  for (const s of snaps) {
    const h = histById.get(s.itemId) ?? [];
    h.push(s.normalizedConsumption);
    histById.set(s.itemId, h);
  }

  const open = await prisma.orderItem.findMany({
    where: {
      itemId: { in: allIds },
      order: { status: { in: ['CREATED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'PARTIALLY_RECEIVED'] } },
    },
    select: { itemId: true, orderedQuantity: true, receivedQuantity: true },
  });
  const incomingById = new Map<string, number>();
  for (const o of open) {
    if (!o.itemId) continue;
    incomingById.set(
      o.itemId,
      (incomingById.get(o.itemId) ?? 0) + Math.max(0, o.orderedQuantity - o.receivedQuantity),
    );
  }

  let gForecast = 0;
  let gGap = 0;
  let gCycle = 0;

  console.log('\n===== FORECAST + MODOS DE EXECUÇÃO (por agendamento) =====\n');
  for (const s of schedules) {
    const n = Math.max(1, s.frequencyCount || 1);
    const nextRun = s.nextRun ? new Date(s.nextRun) : now;
    const interval = Math.max(1, differenceInCalendarDays(addMonths(nextRun, n), nextRun));
    const gapDays = Math.max(0, differenceInCalendarDays(nextRun, now));

    let fTot = 0;
    let gTot = 0;
    let cTot = 0;
    const rows: string[] = [];
    for (const id of s.items) {
      const it = itemById.get(id);
      if (!it) continue;
      const mc = Number(it.monthlyConsumption) || 0;
      if (mc <= 0) continue;
      const price = it.prices[0]?.value ?? 0;
      const lead = it.estimatedLeadTime ?? DEFAULT_LEAD;
      const hist = histById.get(id) ?? [];
      const common = {
        mc,
        incoming: incomingById.get(id) ?? 0,
        leadTime: lead,
        sigmaMonthly: stddev(hist),
        monthsAvailable: hist.filter(v => v > 0).length,
        abc: it.abcCategory,
        xyz: it.xyz,
        box: it.boxQuantity,
      };
      const stockAtNext = Math.max(0, it.quantity - (mc / 30) * gapDays);
      const fc = orderUpTo({ ...common, stock: stockAtNext, coverageDays: interval });
      const gap = orderUpTo({ ...common, stock: it.quantity, coverageDays: gapDays > 0 ? gapDays : interval });
      const cyc = orderUpTo({ ...common, stock: it.quantity, coverageDays: (gapDays > 0 ? gapDays : 0) + interval });
      fTot += fc.qty * price;
      gTot += gap.qty * price;
      cTot += cyc.qty * price;
      if (fc.qty > 0 || gap.qty > 0) {
        rows.push(
          `    ${it.name.slice(0, 26).padEnd(26)} estoque ${String(r2(it.quantity)).padStart(7)} | próx ${String(r2(fc.qty)).padStart(6)} | gap ${String(r2(gap.qty)).padStart(6)} | gap+ciclo ${String(r2(cyc.qty)).padStart(6)} | ${brl(price)}`,
        );
      }
    }
    gForecast += fTot;
    gGap += gTot;
    gCycle += cTot;
    console.log(
      `### ${s.name} — ${s.supplier?.fantasyName ?? '—'}  (a cada ${n} mês, lead varia, intervalo≈${interval}d, gap até próx.≈${gapDays}d)`,
    );
    console.log(
      `    PRÓXIMO DISPARO (forecast): ${brl(fTot)}  |  EXECUTAR AGORA gap-only: ${brl(gTot)}  |  gap+ciclo (pula próx.): ${brl(cTot)}`,
    );
    // show up to 6 representative item rows
    rows.slice(0, 6).forEach(r => console.log(r));
    if (rows.length > 6) console.log(`    … +${rows.length - 6} itens`);
    console.log('');
  }

  console.log('===== TOTAIS =====');
  console.log(`PRÓXIMO DISPARO (forecast do próximo ciclo): ${brl(gForecast)}`);
  console.log(`EXECUTAR AGORA · só até o próximo (GAP_ONLY): ${brl(gGap)}`);
  console.log(`EXECUTAR AGORA · pular o próximo (GAP_PLUS_CYCLE): ${brl(gCycle)}`);
  console.log(
    `\nLeitura: gap-only ≤ forecast (cobre só a ponte até o próximo) e gap+ciclo ≈ gap-only + um ciclo cheio (pula o próximo disparo).`,
  );
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
