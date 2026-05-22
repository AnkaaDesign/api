/**
 * Simulate what an OrderSchedule would compute for the items contained in
 * the last 2 orders made to the supplier "Farben (Ronaldo)".
 *
 * Mirrors `OrderScheduleService.calculateOrderQuantitiesFromSchedule`.
 *
 * Two simulations are run:
 *   A) Current state — those 2 orders are still CREATED, so their
 *      quantities count as `incoming`.
 *   B) "Fresh" — those 2 orders are excluded from `incoming`, showing what
 *      the schedule would suggest if you hadn't already placed them.
 */

import { PrismaClient } from '@prisma/client';
import {
  calculateReorderQuantity,
  resolveSafetyTargetCell,
} from '@/utils/stock-health';
import {
  blendedFactorAcrossDays,
  buildSeasonalContextFromSnapshots,
} from '@/utils/seasonality';
import { balanceDepletionAcrossItems } from '@/utils/order-coverage';
import { DEFAULT_LEAD_TIME_DAYS } from '@/constants/inventory-config';
import {
  ITEM_CATEGORY_TYPE,
  ABC_CATEGORY,
  XYZ_CATEGORY,
} from '@/constants/enums';

const SUPPLIER_NAME_PATTERN = 'Farben';
const ORDERS_TO_INCLUDE = 2;
const CYCLE_DAYS = 30;

type Candidate = {
  itemId: string;
  itemName: string;
  currentStock: number;
  incoming: number;
  monthlyConsumption: number;
  dailyConsumption: number;
  seasonalFactor: number;
  safetyFactor: number;
  maxQuantity: number | null;
  leadTimeDays: number;
  reorderPoint: number;
  boxQuantity: number | null;
  orderRule:
    | {
        supplierId: string | null;
        minOrderQuantity?: number | null;
        maxOrderQuantity?: number | null;
        orderMultiple?: number | null;
      }
    | null;
  proposedQty: number;
  lastOrdered: number;
  skipReason: string | null;
};

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function padR(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s;
}

function runScenario(
  label: string,
  items: any[],
  snapshotsByItem: Map<string, any[]>,
  incomingByItem: Map<string, number>,
  lastOrderedByItem: Map<string, number>,
) {
  const now = new Date();
  const cycleDays = CYCLE_DAYS;

  const candidates: Candidate[] = [];
  const skipped: Candidate[] = [];

  for (const item of items) {
    const monthlyConsumption = Number(item.monthlyConsumption ?? 0);
    const incoming = incomingByItem.get(item.id) ?? 0;
    const currentStock = item.quantity ?? 0;
    const maxQuantity = item.maxQuantity ?? null;
    const leadTimeDays = item.estimatedLeadTime ?? DEFAULT_LEAD_TIME_DAYS;
    const { safetyFactor } = resolveSafetyTargetCell(
      (item.abcCategory as ABC_CATEGORY | null) ?? null,
      (item.xyzCategory as XYZ_CATEGORY | null) ?? null,
      item.ordersLast12Months ?? null,
    );
    const projectionStart = new Date(now);
    projectionStart.setDate(projectionStart.getDate() + leadTimeDays);
    const seasonalCtx = buildSeasonalContextFromSnapshots(snapshotsByItem.get(item.id));
    const buffer = Math.ceil(cycleDays * safetyFactor);
    const targetCoverageDays = cycleDays + leadTimeDays + buffer;
    const seasonal = blendedFactorAcrossDays(
      projectionStart,
      targetCoverageDays,
      seasonalCtx,
    );
    const dailyConsumption = (monthlyConsumption / 30) * seasonal;

    const matchingRule =
      item.orderRules.find((r: any) => r.supplierId === item.supplierId) ??
      item.orderRules[0] ??
      null;

    const base: Candidate = {
      itemId: item.id,
      itemName: item.name,
      currentStock,
      incoming,
      monthlyConsumption,
      dailyConsumption: monthlyConsumption / 30,
      seasonalFactor: seasonal,
      safetyFactor,
      maxQuantity,
      leadTimeDays,
      reorderPoint: item.reorderPoint ?? 0,
      boxQuantity: item.boxQuantity ?? null,
      orderRule: matchingRule,
      proposedQty: 0,
      lastOrdered: lastOrderedByItem.get(item.id) ?? 0,
      skipReason: null,
    };

    if (item.category?.type === ITEM_CATEGORY_TYPE.TOOL) {
      base.skipReason = 'TOOL category';
      skipped.push(base);
      continue;
    }
    if (monthlyConsumption <= 0) {
      base.skipReason = 'monthlyConsumption ≤ 0';
      skipped.push(base);
      continue;
    }
    if (maxQuantity != null && currentStock + incoming >= maxQuantity) {
      base.skipReason = `stock+incoming (${currentStock.toFixed(1)}+${incoming}) ≥ max ${maxQuantity}`;
      skipped.push(base);
      continue;
    }

    let qty = dailyConsumption * targetCoverageDays - currentStock - incoming;
    if (qty <= 0) {
      base.skipReason = `covered: need ${(dailyConsumption * targetCoverageDays).toFixed(1)} ≤ have ${(currentStock + incoming).toFixed(1)}`;
      skipped.push(base);
      continue;
    }
    if (maxQuantity != null) {
      const headroom = maxQuantity - currentStock - incoming;
      qty = Math.min(qty, headroom);
      if (qty <= 0) {
        base.skipReason = 'no headroom under maxQuantity';
        skipped.push(base);
        continue;
      }
    }
    const proposedQty = calculateReorderQuantity({
      currentStock,
      maxQuantity: maxQuantity ?? currentStock + qty + incoming,
      incomingOrderedQuantity: incoming,
      boxQuantity: item.boxQuantity,
      orderRule: matchingRule,
    });
    if (proposedQty <= 0) {
      base.skipReason = 'rounded to 0 by box/orderRule';
      skipped.push(base);
      continue;
    }
    base.proposedQty = proposedQty;
    candidates.push(base);
  }

  let balanceResults: Array<{ balancedQty: number; coverageDays: number }> = [];
  if (candidates.length > 0) {
    balanceResults = balanceDepletionAcrossItems(
      candidates.map(c => ({
        currentQty: c.currentStock,
        proposedQty: c.proposedQty,
        dailyConsumption: c.dailyConsumption,
        maxQuantity: c.maxQuantity,
        reorderPoint: c.reorderPoint,
        leadTimeDays: c.leadTimeDays,
        incomingQty: c.incoming,
      })),
    );
  }

  const finalRows = candidates.map((c, i) => {
    const balanced = balanceResults[i];
    const rounded = calculateReorderQuantity({
      currentStock: c.currentStock,
      maxQuantity: c.maxQuantity ?? c.currentStock + balanced.balancedQty + c.incoming,
      incomingOrderedQuantity: c.incoming,
      boxQuantity: c.boxQuantity,
      orderRule: c.orderRule,
    });
    const finalQty = Math.min(rounded, balanced.balancedQty || rounded);
    return { ...c, balancedQty: balanced.balancedQty, coverageDays: balanced.coverageDays, finalQty };
  });

  console.log(`\n=== ${label} ===`);
  if (finalRows.length === 0) {
    console.log('(no items would be ordered)');
  } else {
    console.log(
      pad('Item', 24) +
        ' ' +
        padR('Stock', 7) +
        ' ' +
        padR('Incom', 6) +
        ' ' +
        padR('M/Cons', 7) +
        ' ' +
        padR('LT', 4) +
        ' ' +
        padR('Max', 6) +
        ' ' +
        padR('Last', 6) +
        ' ' +
        padR('Order', 7) +
        ' ' +
        padR('CovDays', 8),
    );
    console.log('-'.repeat(82));
    let totalQty = 0;
    for (const r of finalRows) {
      totalQty += r.finalQty;
      console.log(
        pad(r.itemName, 24) +
          ' ' +
          padR(r.currentStock.toFixed(1), 7) +
          ' ' +
          padR(r.incoming.toFixed(0), 6) +
          ' ' +
          padR(r.monthlyConsumption.toFixed(1), 7) +
          ' ' +
          padR(String(r.leadTimeDays), 4) +
          ' ' +
          padR(r.maxQuantity == null ? '—' : String(r.maxQuantity), 6) +
          ' ' +
          padR(String(r.lastOrdered), 6) +
          ' ' +
          padR(r.finalQty.toFixed(2), 7) +
          ' ' +
          padR(Math.round(r.coverageDays).toString(), 8),
      );
    }
    console.log('-'.repeat(82));
    console.log(`Total units: ${totalQty.toFixed(2)}`);
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) {
      console.log(
        `  ${pad(s.itemName, 24)} last=${padR(String(s.lastOrdered), 4)} stock=${padR(s.currentStock.toFixed(1), 6)} M/Cons=${padR(s.monthlyConsumption.toFixed(1), 6)} → ${s.skipReason}`,
      );
    }
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const supplier = await prisma.supplier.findFirst({
      where: {
        OR: [
          { fantasyName: { contains: SUPPLIER_NAME_PATTERN, mode: 'insensitive' } },
          { corporateName: { contains: SUPPLIER_NAME_PATTERN, mode: 'insensitive' } },
        ],
      },
      select: { id: true, fantasyName: true },
    });
    if (!supplier) throw new Error(`Supplier matching "${SUPPLIER_NAME_PATTERN}" not found`);

    console.log(`Supplier: ${supplier.fantasyName} (${supplier.id})`);

    const lastOrders = await prisma.order.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'desc' },
      take: ORDERS_TO_INCLUDE,
      select: {
        id: true,
        description: true,
        status: true,
        createdAt: true,
        items: { select: { itemId: true, orderedQuantity: true } },
      },
    });

    console.log(`\nLast ${lastOrders.length} order(s) used as the schedule template:`);
    for (const o of lastOrders) {
      console.log(
        `  - ${o.description ?? '(no description)'} [${o.status}] ${o.createdAt.toISOString().slice(0, 10)}  ${o.items.length} items`,
      );
    }

    const itemIds = Array.from(
      new Set(lastOrders.flatMap(o => o.items.map(oi => oi.itemId))),
    );
    console.log(`\nDistinct items: ${itemIds.length}`);
    console.log(`Cycle window: ${CYCLE_DAYS} days (default, no schedule date)`);

    const items = await prisma.item.findMany({
      where: { id: { in: itemIds }, isActive: true },
      include: {
        category: { select: { type: true } },
        orderRules: {
          where: { isActive: true },
          select: {
            supplierId: true,
            minOrderQuantity: true,
            maxOrderQuantity: true,
            orderMultiple: true,
          },
        },
      },
    });

    const snapshotRows = await prisma.consumptionSnapshot.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, year: true, month: true, seasonalFactor: true },
    });
    const snapshotsByItem = new Map<string, any[]>();
    for (const r of snapshotRows) {
      const arr = snapshotsByItem.get(r.itemId) ?? [];
      arr.push({ year: r.year, month: r.month, seasonalFactor: r.seasonalFactor });
      snapshotsByItem.set(r.itemId, arr);
    }

    const lastOrderIds = new Set(lastOrders.map(o => o.id));
    const activeOrderItems = await prisma.orderItem.findMany({
      where: {
        itemId: { in: itemIds },
        order: {
          status: {
            in: ['CREATED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'PARTIALLY_RECEIVED'],
          },
        },
      },
      select: {
        itemId: true,
        orderedQuantity: true,
        receivedQuantity: true,
        orderId: true,
      },
    });

    const incomingByItem = new Map<string, number>();
    const incomingByItemExcludingLast = new Map<string, number>();
    for (const oi of activeOrderItems) {
      const pending = Math.max(0, oi.orderedQuantity - oi.receivedQuantity);
      incomingByItem.set(oi.itemId, (incomingByItem.get(oi.itemId) ?? 0) + pending);
      if (!lastOrderIds.has(oi.orderId)) {
        incomingByItemExcludingLast.set(
          oi.itemId,
          (incomingByItemExcludingLast.get(oi.itemId) ?? 0) + pending,
        );
      }
    }

    const lastOrderedByItem = new Map<string, number>();
    for (const o of lastOrders) {
      for (const oi of o.items) {
        lastOrderedByItem.set(
          oi.itemId,
          (lastOrderedByItem.get(oi.itemId) ?? 0) + oi.orderedQuantity,
        );
      }
    }

    runScenario(
      'A) CURRENT STATE — the 2 Farben orders count as incoming',
      items,
      snapshotsByItem,
      incomingByItem,
      lastOrderedByItem,
    );

    runScenario(
      'B) FRESH SIMULATION — pretend the 2 Farben orders were never placed',
      items,
      snapshotsByItem,
      incomingByItemExcludingLast,
      lastOrderedByItem,
    );
  } finally {
    await (prisma as any).$disconnect();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
