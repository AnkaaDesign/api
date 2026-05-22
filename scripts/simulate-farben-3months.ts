/**
 * Roll the OrderSchedule simulation forward 3 monthly cycles for the items
 * in the last 2 Farben orders, applying consumption between cycles.
 *
 * Each cycle:
 *   1. Run the schedule (same algorithm as OrderScheduleService) → order Qn
 *   2. During the cycle window (30 days):
 *        - Order Qn arrives after `leadTimeDays` (LT < 30 → arrives same month)
 *        - Consumption depletes stock by monthlyConsumption (seasonal-adjusted)
 *   3. End-of-month stock = startStock - monthlyConsumption + Qn
 *
 * The two May-2026 Farben orders are excluded from incoming (fresh start).
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
import { ITEM_CATEGORY_TYPE, ABC_CATEGORY, XYZ_CATEGORY } from '@/constants/enums';

const SUPPLIER_NAME_PATTERN = 'Farben';
const ORDERS_TO_INCLUDE = 2;
const CYCLE_DAYS = 30;
const MONTHS = 3;

type ItemState = {
  id: string;
  name: string;
  stock: number;
  monthlyConsumption: number;
  maxQuantity: number | null;
  leadTimeDays: number;
  reorderPoint: number;
  boxQuantity: number | null;
  abc: ABC_CATEGORY | null;
  xyz: XYZ_CATEGORY | null;
  ordersLast12Months: number | null;
  categoryType: string | null;
  supplierId: string | null;
  orderRules: any[];
  snapshots: Array<{ year: number; month: number; seasonalFactor: number }>;
};

type CycleResult = {
  ordered: number;
  finalStock: number;
  consumed: number;
  skipped: boolean;
  skipReason: string | null;
  coverageDays: number;
};

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function padR(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s;
}

function runSchedule(
  items: ItemState[],
  now: Date,
): Map<string, { qty: number; coverageDays: number; skipReason: string | null }> {
  const cycleDays = CYCLE_DAYS;
  const result = new Map<
    string,
    { qty: number; coverageDays: number; skipReason: string | null }
  >();

  type Cand = {
    state: ItemState;
    dailyBase: number;
    proposedQty: number;
  };
  const cands: Cand[] = [];

  for (const s of items) {
    if (s.categoryType === ITEM_CATEGORY_TYPE.TOOL) {
      result.set(s.id, { qty: 0, coverageDays: 0, skipReason: 'TOOL' });
      continue;
    }
    if (s.monthlyConsumption <= 0) {
      result.set(s.id, { qty: 0, coverageDays: 0, skipReason: 'M/Cons ≤ 0' });
      continue;
    }
    const currentStock = Math.max(0, s.stock);
    const incoming = 0;
    if (s.maxQuantity != null && currentStock + incoming >= s.maxQuantity) {
      result.set(s.id, {
        qty: 0,
        coverageDays: 0,
        skipReason: `stock ${currentStock.toFixed(1)} ≥ max ${s.maxQuantity}`,
      });
      continue;
    }

    const { safetyFactor } = resolveSafetyTargetCell(s.abc, s.xyz, s.ordersLast12Months);
    const buffer = Math.ceil(cycleDays * safetyFactor);
    const targetCoverageDays = cycleDays + s.leadTimeDays + buffer;
    const projectionStart = new Date(now);
    projectionStart.setDate(projectionStart.getDate() + s.leadTimeDays);
    const seasonalCtx = buildSeasonalContextFromSnapshots(s.snapshots);
    const seasonal = blendedFactorAcrossDays(projectionStart, targetCoverageDays, seasonalCtx);
    const dailyConsumption = (s.monthlyConsumption / 30) * seasonal;

    let qty = dailyConsumption * targetCoverageDays - currentStock - incoming;
    if (qty <= 0) {
      result.set(s.id, {
        qty: 0,
        coverageDays: 0,
        skipReason: `covered: need ${(dailyConsumption * targetCoverageDays).toFixed(1)} ≤ have ${currentStock.toFixed(1)}`,
      });
      continue;
    }
    if (s.maxQuantity != null) {
      const headroom = s.maxQuantity - currentStock - incoming;
      qty = Math.min(qty, headroom);
      if (qty <= 0) {
        result.set(s.id, { qty: 0, coverageDays: 0, skipReason: 'no headroom' });
        continue;
      }
    }
    const matchingRule =
      s.orderRules.find((r: any) => r.supplierId === s.supplierId) ?? s.orderRules[0] ?? null;
    const proposedQty = calculateReorderQuantity({
      currentStock,
      maxQuantity: s.maxQuantity ?? currentStock + qty + incoming,
      incomingOrderedQuantity: incoming,
      boxQuantity: s.boxQuantity,
      orderRule: matchingRule,
    });
    if (proposedQty <= 0) {
      result.set(s.id, { qty: 0, coverageDays: 0, skipReason: 'rounded to 0' });
      continue;
    }
    cands.push({ state: s, dailyBase: s.monthlyConsumption / 30, proposedQty });
  }

  if (cands.length === 0) return result;

  const balanced = balanceDepletionAcrossItems(
    cands.map(c => ({
      currentQty: Math.max(0, c.state.stock),
      proposedQty: c.proposedQty,
      dailyConsumption: c.dailyBase,
      maxQuantity: c.state.maxQuantity,
      reorderPoint: c.state.reorderPoint,
      leadTimeDays: c.state.leadTimeDays,
      incomingQty: 0,
    })),
  );

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const b = balanced[i];
    const matchingRule =
      c.state.orderRules.find((r: any) => r.supplierId === c.state.supplierId) ??
      c.state.orderRules[0] ??
      null;
    const rounded = calculateReorderQuantity({
      currentStock: Math.max(0, c.state.stock),
      maxQuantity: c.state.maxQuantity ?? Math.max(0, c.state.stock) + b.balancedQty,
      incomingOrderedQuantity: 0,
      boxQuantity: c.state.boxQuantity,
      orderRule: matchingRule,
    });
    const finalQty = Math.min(rounded, b.balancedQty || rounded);
    result.set(c.state.id, {
      qty: Math.max(0, finalQty),
      coverageDays: b.coverageDays,
      skipReason: null,
    });
  }

  return result;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: {
        OR: [
          { fantasyName: { contains: SUPPLIER_NAME_PATTERN, mode: 'insensitive' } },
          { corporateName: { contains: SUPPLIER_NAME_PATTERN, mode: 'insensitive' } },
        ],
      },
      select: { id: true, fantasyName: true },
    });

    const lastOrders = await prisma.order.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'desc' },
      take: ORDERS_TO_INCLUDE,
      select: { id: true, items: { select: { itemId: true } } },
    });
    const itemIds = Array.from(
      new Set(lastOrders.flatMap(o => o.items.map(oi => oi.itemId))),
    );

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

    let names = new Map<string, string>();
    const states: ItemState[] = items.map(it => {
      const name =
        it.name + (items.filter(x => x.name === it.name).length > 1 ? ` (${it.uniCode ?? it.id.slice(0, 4)})` : '');
      names.set(it.id, name);
      return {
        id: it.id,
        name,
        stock: it.quantity ?? 0,
        monthlyConsumption: Number(it.monthlyConsumption ?? 0),
        maxQuantity: it.maxQuantity ?? null,
        leadTimeDays: it.estimatedLeadTime ?? DEFAULT_LEAD_TIME_DAYS,
        reorderPoint: it.reorderPoint ?? 0,
        boxQuantity: it.boxQuantity ?? null,
        abc: (it.abcCategory as ABC_CATEGORY) ?? null,
        xyz: (it.xyzCategory as XYZ_CATEGORY) ?? null,
        ordersLast12Months: it.ordersLast12Months ?? null,
        categoryType: it.category?.type ?? null,
        supplierId: it.supplierId ?? null,
        orderRules: it.orderRules,
        snapshots: snapshotsByItem.get(it.id) ?? [],
      };
    });

    console.log(`Supplier: ${supplier.fantasyName}`);
    console.log(`Items: ${states.length}, cycle=${CYCLE_DAYS}d, months=${MONTHS}\n`);

    // Track history per item per month
    type Snap = {
      startStock: number;
      ordered: number;
      consumed: number;
      endStock: number;
      coverageDays: number;
      skipReason: string | null;
    };
    const history = new Map<string, Snap[]>();
    for (const s of states) history.set(s.id, []);

    const baseDate = new Date();
    for (let m = 1; m <= MONTHS; m++) {
      const now = new Date(baseDate);
      now.setDate(now.getDate() + (m - 1) * CYCLE_DAYS);

      const sched = runSchedule(states, now);

      for (const s of states) {
        const r = sched.get(s.id)!;
        const startStock = s.stock;
        // Apply month: consumption (full monthlyConsumption) + receive ordered qty
        const consumed = s.monthlyConsumption;
        const endStock = startStock - consumed + r.qty;
        history.get(s.id)!.push({
          startStock,
          ordered: r.qty,
          consumed,
          endStock,
          coverageDays: r.coverageDays,
          skipReason: r.skipReason,
        });
        s.stock = endStock;
      }
    }

    // Print per-month summary tables
    for (let m = 1; m <= MONTHS; m++) {
      console.log(`=== MONTH ${m} ===`);
      console.log(
        pad('Item', 24) +
          ' ' +
          padR('Start', 7) +
          ' ' +
          padR('M/Cons', 7) +
          ' ' +
          padR('Order', 7) +
          ' ' +
          padR('End', 7) +
          ' ' +
          padR('Cov', 5) +
          '  Skip',
      );
      console.log('-'.repeat(78));
      let totalOrdered = 0;
      let negStockItems = 0;
      for (const s of states) {
        const h = history.get(s.id)![m - 1];
        totalOrdered += h.ordered;
        if (h.endStock < 0) negStockItems++;
        const cov = h.skipReason ? '—' : Math.round(h.coverageDays).toString();
        console.log(
          pad(s.name, 24) +
            ' ' +
            padR(h.startStock.toFixed(1), 7) +
            ' ' +
            padR(s.monthlyConsumption.toFixed(1), 7) +
            ' ' +
            padR(h.ordered.toFixed(1), 7) +
            ' ' +
            padR(h.endStock.toFixed(1), 7) +
            ' ' +
            padR(cov, 5) +
            (h.skipReason ? '  ' + h.skipReason : ''),
        );
      }
      console.log('-'.repeat(78));
      console.log(
        `Total ordered: ${totalOrdered.toFixed(1)} units  |  Items ending negative: ${negStockItems}\n`,
      );
    }

    // Per-item 3-month trajectory
    console.log('=== PER-ITEM TRAJECTORY (Stock at end of each month) ===');
    console.log(
      pad('Item', 24) +
        ' ' +
        padR('Start', 7) +
        ' ' +
        padR('End M1', 8) +
        ' ' +
        padR('End M2', 8) +
        ' ' +
        padR('End M3', 8) +
        ' ' +
        padR('Order M1', 9) +
        ' ' +
        padR('Order M2', 9) +
        ' ' +
        padR('Order M3', 9),
    );
    console.log('-'.repeat(95));
    const initialStocks = new Map<string, number>();
    for (const it of items) initialStocks.set(it.id, it.quantity ?? 0);
    for (const s of states) {
      const h = history.get(s.id)!;
      console.log(
        pad(s.name, 24) +
          ' ' +
          padR((initialStocks.get(s.id) ?? 0).toFixed(1), 7) +
          ' ' +
          padR(h[0].endStock.toFixed(1), 8) +
          ' ' +
          padR(h[1].endStock.toFixed(1), 8) +
          ' ' +
          padR(h[2].endStock.toFixed(1), 8) +
          ' ' +
          padR(h[0].ordered.toFixed(1), 9) +
          ' ' +
          padR(h[1].ordered.toFixed(1), 9) +
          ' ' +
          padR(h[2].ordered.toFixed(1), 9),
      );
    }

    // Analysis
    console.log('\n=== ANALYSIS ===');
    const stockOutItems: string[] = [];
    const oversupplyItems: string[] = [];
    const stableItems: string[] = [];
    const unstableOrders: string[] = [];
    for (const s of states) {
      const h = history.get(s.id)!;
      const endStocks = h.map(x => x.endStock);
      const orders = h.map(x => x.ordered);
      if (endStocks.some(x => x < 0)) stockOutItems.push(s.name);
      const monthlyCovEnd = endStocks.map(x => (s.monthlyConsumption > 0 ? x / (s.monthlyConsumption / 30) : 0));
      if (monthlyCovEnd[2] > 90) oversupplyItems.push(`${s.name} (${Math.round(monthlyCovEnd[2])}d at M3)`);
      const orderRange = Math.max(...orders) - Math.min(...orders);
      const orderAvg = (orders[0] + orders[1] + orders[2]) / 3;
      if (orderAvg > 0 && orderRange / orderAvg > 0.5) {
        unstableOrders.push(
          `${s.name} (M1=${orders[0].toFixed(0)} M2=${orders[1].toFixed(0)} M3=${orders[2].toFixed(0)})`,
        );
      } else if (orderAvg > 0) {
        stableItems.push(s.name);
      }
    }
    console.log(`\n• Items going stock-out (negative stock at month end): ${stockOutItems.length}`);
    for (const n of stockOutItems) console.log(`    - ${n}`);
    console.log(`\n• Items with >90d coverage at end of month 3 (oversupply): ${oversupplyItems.length}`);
    for (const n of oversupplyItems) console.log(`    - ${n}`);
    console.log(`\n• Items with unstable order quantity (range >50% of avg): ${unstableOrders.length}`);
    for (const n of unstableOrders) console.log(`    - ${n}`);
    console.log(`\n• Items with stable orders across all 3 cycles: ${stableItems.length}`);
  } finally {
    await (prisma as any).$disconnect();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
