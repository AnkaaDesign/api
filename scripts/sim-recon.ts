/* eslint-disable no-console */
// Recon for the order-schedule year simulation: dumps active schedules, their
// items' stocking fields, and last-12-months OUTBOUND consumption (monthly
// buckets) so we can model realistic consumption.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const schedules = await prisma.orderSchedule.findMany({
    where: { isActive: true, finishedAt: null },
    include: { weeklyConfig: true, monthlyConfig: true, yearlyConfig: true, supplier: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n===== ACTIVE ORDER SCHEDULES: ${schedules.length} =====`);
  const allItemIds = new Set<string>();
  for (const s of schedules) {
    console.log(
      JSON.stringify({
        id: s.id,
        name: s.name,
        frequency: s.frequency,
        frequencyCount: s.frequencyCount,
        nextRun: s.nextRun,
        dayOfMonth: s.dayOfMonth,
        dayOfWeek: s.dayOfWeek,
        month: s.month,
        monthlyConfig: s.monthlyConfig,
        weeklyConfig: s.weeklyConfig
          ? Object.entries(s.weeklyConfig)
              .filter(([k, v]) => v === true && k !== 'id')
              .map(([k]) => k)
          : null,
        itemCount: s.items.length,
        supplier: s.supplier?.fantasyName ?? null,
      }),
    );
    s.items.forEach(i => allItemIds.add(i));
  }

  const ids = [...allItemIds];
  const items = await prisma.item.findMany({
    where: { id: { in: ids } },
    include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 }, measures: true, supplier: true },
  });

  console.log(`\n===== ITEMS IN SCHEDULES: ${items.length} =====`);
  for (const it of items) {
    console.log(
      JSON.stringify({
        id: it.id,
        name: it.name,
        uniCode: it.uniCode,
        quantity: it.quantity,
        monthlyConsumption: Number(it.monthlyConsumption),
        trendPct: it.monthlyConsumptionTrendPercent ? Number(it.monthlyConsumptionTrendPercent) : null,
        reorderPoint: it.reorderPoint,
        maxQuantity: it.maxQuantity,
        estimatedLeadTime: it.estimatedLeadTime,
        boxQuantity: it.boxQuantity,
        price: it.prices[0]?.value ?? null,
        abc: it.abcCategory,
        xyz: it.xyzCategory,
        supplier: it.supplier?.fantasyName ?? null,
      }),
    );
  }

  // Last 12 months OUTBOUND activity, monthly buckets per item.
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const acts = await prisma.activity.findMany({
    where: {
      itemId: { in: ids },
      operation: 'OUTBOUND' as any,
      createdAt: { gte: since },
    },
    select: { itemId: true, quantity: true, createdAt: true, reason: true },
  });

  const byItemMonth = new Map<string, Map<string, number>>();
  for (const a of acts) {
    if (!a.itemId) continue;
    const key = `${a.createdAt.getFullYear()}-${String(a.createdAt.getMonth() + 1).padStart(2, '0')}`;
    const m = byItemMonth.get(a.itemId) ?? new Map();
    m.set(key, (m.get(key) ?? 0) + a.quantity);
    byItemMonth.set(a.itemId, m);
  }

  console.log(`\n===== LAST-12-MONTHS OUTBOUND CONSUMPTION (monthly buckets) =====`);
  console.log(`Total OUTBOUND activity rows in window: ${acts.length}`);
  const nameById = new Map(items.map(i => [i.id, i.name]));
  for (const id of ids) {
    const m = byItemMonth.get(id);
    if (!m) {
      console.log(JSON.stringify({ itemId: id, name: nameById.get(id), months: 0, total: 0 }));
      continue;
    }
    const entries = [...m.entries()].sort();
    const total = entries.reduce((s, [, v]) => s + v, 0);
    console.log(
      JSON.stringify({
        itemId: id,
        name: nameById.get(id),
        distinctMonths: entries.length,
        total: Math.round(total * 100) / 100,
        perMonth: Object.fromEntries(entries.map(([k, v]) => [k, Math.round(v * 100) / 100])),
      }),
    );
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
