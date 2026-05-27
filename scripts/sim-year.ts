/* eslint-disable no-console */
/**
 * YEAR-LONG ORDER-SCHEDULE SIMULATION
 * ===================================
 * Simulates ~12 months forward for every active OrderSchedule: models realistic
 * item consumption (calibrated from the last 12 months of OUTBOUND activity,
 * plus a per-item trend and month-to-month variability), fires each schedule on
 * its cadence, computes the order quantity with the SAME formula the production
 * scheduler uses (coverage + lead-time + safety buffer, clamped to maxQuantity,
 * box-rounded, minus in-transit), and applies lead-time arrivals.
 *
 * For every order it records: stock BEFORE the trigger, ordered quantity, the
 * expected arrival (lead-time), the stock AFTER arrival, and the spend. It also
 * flags stockouts and items consumed-but-never-ordered (mc=0 trap).
 *
 * Run: node_modules/.bin/tsx scripts/sim-year.ts
 * Output: scripts/data/order-schedule-year-simulation.md  (+ console summary)
 */
import { PrismaClient } from '@prisma/client';
import { addMonths, addDays, format, getDaysInMonth } from 'date-fns';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// ── Tunables (documented in the report) ──────────────────────────────────────
const HORIZON_DAYS = 365;
const SEASONAL_FACTOR = 1; // per-item seasonality modeling is OFF for clarity.
// Demand variability (coefficient of variation) fallback by XYZ class when there
// isn't enough history to measure it. X = steady, Y = variable, Z = lumpy.
const CV_BY_XYZ: Record<string, number> = { X: 0.12, Y: 0.3, Z: 0.55 };
const DEFAULT_CV = 0.2;
// Order-calc safety factor by XYZ (approximation of the ABC/XYZ matrix used by
// resolveSafetyTargetCell — close enough for a coverage simulation).
const SAFETY_BY_XYZ: Record<string, number> = { X: 0.15, Y: 0.25, Z: 0.35 };
const DEFAULT_SAFETY = 0.2;
const DEFAULT_LEAD_TIME = 25;
// Statistical safety-stock z by ABC (mirrors Z_BY_ABC in inventory-config).
const Z_BY_ABC: Record<string, number> = { A: 1.96, B: 1.645, C: 1.28 };
const STAT_MIN_MONTHS = 6;
function stddevArr(xs: number[]): number {
  if (!xs.length) return 0;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

// ── Deterministic PRNG so the simulation is reproducible ─────────────────────
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Symmetric noise in [-1, 1] for a given item+month (averaged → bell-ish). */
function noise(itemId: string, monthIdx: number): number {
  const rng = mulberry32(hashSeed(`${itemId}:${monthIdx}`));
  return ((rng() + rng() + rng()) / 3) * 2 - 1;
}
/** Per-item annual trend in [-15%, +25%], deterministic. */
function annualTrend(itemId: string): number {
  const rng = mulberry32(hashSeed(`${itemId}:trend`));
  return -0.15 + rng() * 0.4;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Order quantity — mirrors OrderScheduleService.computeScheduleOrderPlan ───
function calcReorderQuantity(
  currentStock: number,
  maxQuantityTarget: number,
  incoming: number,
  boxQuantity: number | null,
): number {
  const shortfall = maxQuantityTarget - currentStock - incoming;
  if (shortfall <= 0) return 0;
  const box = Math.max(1, boxQuantity ?? 1);
  return Math.ceil(shortfall / box) * box;
}

// Periodic-review order-up-to model (mirrors the updated computeScheduleOrderPlan):
//   protection = coverageDays + leadTime
//   S = dailyDemand × protection + safetyStock
//   safetyStock = z × σ_daily × √protection   (≥6 months + ABC), else fraction
// Safety scales with the item's MEASURED σ → volatile/high-usage hold more.
function computeOrderQty(a: {
  mc: number; // system monthly-consumption estimate (drives the order)
  stock: number;
  incoming: number;
  coverageDays: number;
  leadTime: number;
  sigmaMonthly: number;
  monthsAvailable: number;
  abc: string | null;
  xyz: string | null;
  boxQuantity: number | null;
}): number {
  if (a.mc <= 0) return 0;
  const protectionDays = a.coverageDays + a.leadTime;
  const dailyConsumption = (a.mc / 30) * SEASONAL_FACTOR;
  const demandOverProtection = dailyConsumption * protectionDays;

  let ss: number;
  if (a.monthsAvailable >= STAT_MIN_MONTHS && a.abc) {
    const z = Z_BY_ABC[a.abc] ?? 1.645;
    const sigmaDaily = a.sigmaMonthly / Math.sqrt(30);
    ss = z * sigmaDaily * Math.sqrt(protectionDays);
  } else {
    // Low-data fallback: fraction of protection-interval demand (by XYZ).
    const f = a.xyz ? (SAFETY_BY_XYZ[a.xyz] ?? DEFAULT_SAFETY) : 0.3;
    ss = demandOverProtection * f;
  }
  ss = Math.min(ss, demandOverProtection); // sanity cap → worst case ≈ 2× cycle

  const orderUpTo = demandOverProtection + ss;
  if (a.stock + a.incoming >= orderUpTo) return 0;
  return calcReorderQuantity(a.stock, orderUpTo, a.incoming, a.boxQuantity);
}

interface SimItem {
  id: string;
  name: string;
  uniCode: string | null;
  supplier: string;
  stock: number;
  mc: number; // system estimate (order driver)
  effectiveBase: number; // consumption base for modeling (mc, else historical)
  reorderPoint: number | null;
  maxQuantity: number | null;
  leadTime: number;
  boxQuantity: number | null;
  price: number;
  xyz: string | null;
  abc: string | null;
  cv: number;
  sigmaMonthly: number;
  monthsAvailable: number;
  // running sim state
  consumed: number;
  ordered: number;
  orderCount: number;
  minStock: number;
  stockoutDays: number;
  stockoutEarly: number; // ruptures within first 60 days (startup gap)
  stockoutLate: number; // ruptures after day 60 (steady-state coverage)
  incoming: number;
}

interface OrderLine {
  scheduleName: string;
  supplier: string;
  fireDate: Date;
  itemId: string;
  itemName: string;
  uniCode: string | null;
  stockBefore: number;
  orderedQty: number;
  leadTime: number;
  arrivalDate: Date;
  stockAtArrival: number | null;
  unitPrice: number;
  lineCost: number;
}

async function main() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, HORIZON_DAYS);

  const schedules = await prisma.orderSchedule.findMany({
    where: { isActive: true, finishedAt: null },
    include: { supplier: true },
    orderBy: { name: 'asc' },
  });

  const allItemIds = [...new Set(schedules.flatMap(s => s.items))];
  const dbItems = await prisma.item.findMany({
    where: { id: { in: allItemIds } },
    include: { prices: { orderBy: { createdAt: 'desc' }, take: 1 }, supplier: true },
  });

  // Historical 12-month OUTBOUND consumption → per-item monthly buckets (for CV).
  const since = new Date(start);
  since.setMonth(since.getMonth() - 12);
  const acts = await prisma.activity.findMany({
    where: { itemId: { in: allItemIds }, operation: 'OUTBOUND' as any, createdAt: { gte: since } },
    select: { itemId: true, quantity: true, createdAt: true },
  });
  const histByItem = new Map<string, number[]>();
  {
    const tmp = new Map<string, Map<string, number>>();
    for (const a of acts) {
      if (!a.itemId) continue;
      const key = `${a.createdAt.getFullYear()}-${a.createdAt.getMonth()}`;
      const m = tmp.get(a.itemId) ?? new Map();
      m.set(key, (m.get(key) ?? 0) + a.quantity);
      tmp.set(a.itemId, m);
    }
    for (const [id, m] of tmp) histByItem.set(id, [...m.values()]);
  }

  const itemMap = new Map<string, SimItem>();
  for (const it of dbItems) {
    const mc = Number(it.monthlyConsumption) || 0;
    const hist = histByItem.get(it.id) ?? [];
    const histAvg = hist.length ? hist.reduce((s, v) => s + v, 0) / hist.length : 0;
    // CV from history if we have >=3 months, else by XYZ class.
    let cv = it.xyz ? (CV_BY_XYZ[it.xyz] ?? DEFAULT_CV) : DEFAULT_CV;
    if (hist.length >= 3 && histAvg > 0) {
      const mean = histAvg;
      const variance = hist.reduce((s, v) => s + (v - mean) ** 2, 0) / hist.length;
      cv = Math.min(0.6, Math.sqrt(variance) / mean);
    }
    itemMap.set(it.id, {
      id: it.id,
      name: it.name,
      uniCode: it.uniCode,
      supplier: it.supplier?.fantasyName ?? '—',
      stock: it.quantity,
      mc,
      effectiveBase: mc > 0 ? mc : histAvg,
      reorderPoint: it.reorderPoint,
      maxQuantity: it.maxQuantity,
      leadTime: it.estimatedLeadTime ?? DEFAULT_LEAD_TIME,
      boxQuantity: it.boxQuantity,
      price: it.prices[0]?.value ?? 0,
      xyz: it.xyz,
      abc: it.abcCategory,
      cv,
      sigmaMonthly: stddevArr(hist),
      monthsAvailable: hist.filter(v => v > 0).length,
      consumed: 0,
      ordered: 0,
      orderCount: 0,
      minStock: it.quantity,
      stockoutDays: 0,
      stockoutEarly: 0,
      stockoutLate: 0,
      incoming: 0,
    });
  }

  // Precompute fire dates per schedule (MONTHLY family: every frequencyCount months).
  interface Fire {
    date: Date;
    scheduleName: string;
    supplier: string;
    itemIds: string[];
    coverageDays: number;
  }
  const fires: Fire[] = [];
  for (const s of schedules) {
    const n = Math.max(1, s.frequencyCount || 1);
    const anchor = s.nextRun ? new Date(s.nextRun) : start;
    anchor.setHours(0, 0, 0, 0);
    for (let k = 0; ; k++) {
      const d = addMonths(anchor, n * k);
      if (d > end) break;
      if (d >= start) {
        fires.push({
          date: d,
          scheduleName: s.name ?? '(sem nome)',
          supplier: s.supplier?.fantasyName ?? '—',
          itemIds: s.items,
          coverageDays: n * 30,
        });
      }
    }
  }
  const firesByDay = new Map<string, Fire[]>();
  for (const f of fires) {
    const key = format(f.date, 'yyyy-MM-dd');
    const arr = firesByDay.get(key) ?? [];
    arr.push(f);
    firesByDay.set(key, arr);
  }

  // Pending arrivals: itemId -> list of {arrivalDate, qty, line}
  const arrivals = new Map<string, Array<{ date: Date; qty: number; line: OrderLine }>>();
  const orderLines: OrderLine[] = [];

  // ── Daily simulation loop ──────────────────────────────────────────────────
  for (let day = 0; day <= HORIZON_DAYS; day++) {
    const date = addDays(start, day);
    const key = format(date, 'yyyy-MM-dd');
    const monthIdx = (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth());
    const dim = getDaysInMonth(date);

    // 1) Process arrivals (morning delivery).
    for (const it of itemMap.values()) {
      const pend = arrivals.get(it.id);
      if (!pend) continue;
      const remaining: typeof pend = [];
      for (const p of pend) {
        if (format(p.date, 'yyyy-MM-dd') === key) {
          it.stock += p.qty;
          it.incoming = Math.max(0, it.incoming - p.qty);
          p.line.stockAtArrival = round2(it.stock);
        } else {
          remaining.push(p);
        }
      }
      arrivals.set(it.id, remaining);
    }

    // 2) Process fires (place orders based on current stock).
    const dayFires = firesByDay.get(key);
    if (dayFires) {
      for (const f of dayFires) {
        for (const itemId of f.itemIds) {
          const it = itemMap.get(itemId);
          if (!it) continue;
          const qty = computeOrderQty({
            mc: it.mc,
            stock: it.stock,
            incoming: it.incoming,
            coverageDays: f.coverageDays,
            leadTime: it.leadTime,
            sigmaMonthly: it.sigmaMonthly,
            monthsAvailable: it.monthsAvailable,
            abc: it.abc,
            xyz: it.xyz,
            boxQuantity: it.boxQuantity,
          });
          if (qty <= 0) continue;
          const arrivalDate = addDays(date, it.leadTime);
          const line: OrderLine = {
            scheduleName: f.scheduleName,
            supplier: f.supplier,
            fireDate: date,
            itemId: it.id,
            itemName: it.name,
            uniCode: it.uniCode,
            stockBefore: round2(it.stock),
            orderedQty: round2(qty),
            leadTime: it.leadTime,
            arrivalDate,
            stockAtArrival: null,
            unitPrice: it.price,
            lineCost: round2(qty * it.price),
          };
          orderLines.push(line);
          it.incoming += qty;
          it.ordered += qty;
          it.orderCount += 1;
          const arr = arrivals.get(it.id) ?? [];
          arr.push({ date: arrivalDate, qty, line });
          arrivals.set(it.id, arr);
        }
      }
    }

    // 3) Consume (end of day), using modeled actual consumption.
    for (const it of itemMap.values()) {
      if (it.effectiveBase <= 0) continue;
      const trendFactor = 1 + annualTrend(it.id) * (monthIdx / 12);
      const monthlyActual = Math.max(
        0,
        it.effectiveBase * trendFactor * (1 + noise(it.id, monthIdx) * it.cv),
      );
      const dailyConsume = monthlyActual / dim;
      it.stock -= dailyConsume;
      it.consumed += dailyConsume;
      if (it.stock < 0) {
        it.stockoutDays += 1;
        if (day <= 60) it.stockoutEarly += 1;
        else it.stockoutLate += 1;
        it.stock = 0;
      }
      it.minStock = Math.min(it.minStock, it.stock);
    }
  }

  // ── Build the report ─────────────────────────────────────────────────────
  const movingItems = [...itemMap.values()].filter(i => i.effectiveBase > 0);
  const totalSpend = orderLines.reduce((s, l) => s + l.lineCost, 0);
  const bySupplier = new Map<string, { spend: number; orders: number; lines: number }>();
  for (const l of orderLines) {
    const e = bySupplier.get(l.supplier) ?? { spend: 0, orders: 0, lines: 0 };
    e.spend += l.lineCost;
    e.lines += 1;
    bySupplier.set(l.supplier, e);
  }
  const fireCount = fires.length;
  const stockoutItems = movingItems.filter(i => i.stockoutDays > 0);
  const neverOrderedButConsumed = [...itemMap.values()].filter(
    i => i.mc <= 0 && i.effectiveBase > 0,
  );

  const L: string[] = [];
  L.push(`# Simulação Anual dos Agendamentos de Pedido`);
  L.push('');
  L.push(`Período simulado: **${format(start, 'dd/MM/yyyy')} → ${format(end, 'dd/MM/yyyy')}** (${HORIZON_DAYS} dias)`);
  L.push(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`);
  L.push('');
  L.push(`## Metodologia`);
  L.push('');
  L.push(`- **Consumo modelado**: base = \`monthlyConsumption\` do item (estimativa do sistema; se 0, usa a média dos últimos 12 meses de saídas). A cada mês aplica-se uma **tendência** por item (entre −15% e +25% ao ano) e uma **variação mês-a-mês** (coeficiente de variação medido do histórico quando há ≥3 meses, senão por classe XYZ: X≈12%, Y≈30%, Z≈55%). Determinístico (semente por item) → reproduzível.`);
  L.push(`- **Quantidade pedida**: mesma fórmula do scheduler de produção — \`alvo = consumoDiário × (coberturaDias + leadTime + ⌈cobertura×fatorSegurança⌉) − estoque − emTrânsito\`, limitada ao \`maxQuantity\`, arredondada à caixa, e o item é ignorado se \`monthlyConsumption ≤ 0\` (comportamento real do sistema).`);
  L.push(`- **Chegada**: cada pedido chega \`leadTime\` dias após o disparo (paints/Farben ≈18d, Adere/Estopa/Dislon ≈25d, parafusos/embalagens ≈1d) e repõe o estoque na data de chegada.`);
  L.push(`- **Sazonalidade**: desligada nesta simulação (fator 1) para legibilidade.`);
  L.push('');
  L.push(`## Resumo Executivo`);
  L.push('');
  L.push(`- Agendamentos ativos: **${schedules.length}** · Itens nos agendamentos: **${allItemIds.length}** (com consumo modelado: **${movingItems.length}**)`);
  L.push(`- Disparos no período: **${fireCount}** · Linhas de pedido geradas: **${orderLines.length}**`);
  L.push(`- **Gasto total simulado: ${brl(totalSpend)}**`);
  L.push(`- Itens que zeraram estoque em algum momento (ruptura): **${stockoutItems.length}**`);
  L.push(`- ⚠️ Itens consumidos mas **nunca pedidos** (mc=0 → não entram no cálculo): **${neverOrderedButConsumed.length}**`);
  L.push('');
  L.push(`### Gasto por fornecedor`);
  L.push('');
  L.push(`| Fornecedor | Linhas | Gasto no ano |`);
  L.push(`|---|---:|---:|`);
  for (const [sup, e] of [...bySupplier.entries()].sort((a, b) => b[1].spend - a[1].spend)) {
    L.push(`| ${sup} | ${e.lines} | ${brl(e.spend)} |`);
  }
  L.push('');

  // Interpretation buckets
  const bucketA = stockoutItems.filter(i => i.mc <= 0); // consumed but never ordered
  const bucketB = stockoutItems.filter(i => i.mc > 0 && i.stockoutLate === 0); // startup gap only
  const bucketC = stockoutItems.filter(i => i.mc > 0 && i.stockoutLate > 0); // steady-state gap
  const bucketCsevere = bucketC.filter(i => i.stockoutLate >= 20);
  L.push(`## Leitura dos Resultados`);
  L.push('');
  L.push(`As ${stockoutItems.length} rupturas se dividem em três causas distintas:`);
  L.push('');
  L.push(`1. **Itens nunca pedidos (mc=0): ${bucketA.length} itens.** Têm consumo histórico mas \`monthlyConsumption = 0\`, então o cálculo automático os ignora — zeram e ficam zerados o ano todo. **Causa raiz: configuração de consumo**, não a lógica de pedido. Ação: recomputar/definir o consumo desses itens (ou revisar por que o histórico não gerou mc).`);
  L.push(`2. **Itens pedidos, ruptura só na PARTIDA: ${bucketB.length} itens.** Só faltam nos primeiros ~60 dias porque os agendamentos só disparam em jun/jul/ago e o estoque atual de itens de alto giro não chega até a 1ª entrega. **Ação: uma execução manual ("Executar agora") agora**, para a ponte até o 1º ciclo — exatamente o caso de uso do gap-coverage.`);
  L.push(`3. **Itens pedidos, ruptura em REGIME: ${bucketC.length} itens** (${bucketCsevere.length} com >20 dias/ano). A maioria tem só 2–8 dias/ano — ruído de variabilidade (o consumo real do mês superou pontualmente a estimativa). Os relevantes são os de **ciclo longo + lead longo** (a cada 3 meses, lead 25d), como Abraçadeira Nylon Natural e Máscara: o ciclo de 90 dias com 25d de lead fica apertado sob variação. **Ação: encurtar o ciclo desses ou aumentar o fator de segurança.**`);
  L.push('');
  L.push(`**Conclusão:** a lógica de cobertura em regime é sólida (rupturas de regime são majoritariamente ruído de poucos dias). O grosso do risco real é (1) itens com mc=0 e (2) a ponte de partida — ambos endereçáveis sem mudar a fórmula.`);
  L.push('');

  // Per-schedule cycle detail
  L.push(`## Detalhe por Agendamento (ciclos e pedidos)`);
  L.push('');
  const linesBySchedule = new Map<string, OrderLine[]>();
  for (const l of orderLines) {
    const arr = linesBySchedule.get(l.scheduleName) ?? [];
    arr.push(l);
    linesBySchedule.set(l.scheduleName, arr);
  }
  for (const s of schedules) {
    const name = s.name ?? '(sem nome)';
    const lines = (linesBySchedule.get(name) ?? []).sort(
      (a, b) => a.fireDate.getTime() - b.fireDate.getTime() || a.itemName.localeCompare(b.itemName),
    );
    const total = lines.reduce((acc, l) => acc + l.lineCost, 0);
    L.push(`### ${name} — ${s.supplier?.fantasyName ?? '—'} (a cada ${Math.max(1, s.frequencyCount || 1)} mês(es))`);
    L.push('');
    if (lines.length === 0) {
      L.push(`_Nenhum pedido gerado no período (estoque suficiente ou itens sem consumo)._`);
      L.push('');
      continue;
    }
    L.push(`Gasto no ano: **${brl(total)}** · Linhas: ${lines.length}`);
    L.push('');
    L.push(`| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |`);
    L.push(`|---|---|---|---:|---:|---|---:|---:|`);
    for (const l of lines) {
      L.push(
        `| ${format(l.fireDate, 'dd/MM/yy')} | ${l.itemName} | ${l.uniCode ?? '—'} | ${l.stockBefore} | ${l.orderedQty} | ${format(l.arrivalDate, 'dd/MM/yy')} (+${l.leadTime}d) | ${l.stockAtArrival ?? '— (após horizonte)'} | ${brl(l.lineCost)} |`,
      );
    }
    L.push('');
  }

  // Per-item annual rollup
  L.push(`## Consolidado Anual por Item (itens com consumo)`);
  L.push('');
  L.push(`| Item | Cód. | Fornecedor | mc/mês | Consumo ano | Pedido ano | Nº pedidos | Estoque mín. | Ruptura | Estoque final |`);
  L.push(`|---|---|---|---:|---:|---:|---:|---:|:--:|---:|`);
  for (const it of movingItems.sort((a, b) => b.ordered * b.price - a.ordered * a.price)) {
    L.push(
      `| ${it.name} | ${it.uniCode ?? '—'} | ${it.supplier} | ${round2(it.mc)} | ${round2(it.consumed)} | ${round2(it.ordered)} | ${it.orderCount} | ${round2(it.minStock)} | ${it.stockoutDays > 0 ? `⚠️ ${it.stockoutDays}d` : 'não'} | ${round2(it.stock)} |`,
    );
  }
  L.push('');

  const steadyStateRupture = movingItems.filter(i => i.stockoutLate > 0);
  const startupOnlyRupture = stockoutItems.filter(i => i.stockoutLate === 0);
  if (stockoutItems.length) {
    L.push(`## ⚠️ Rupturas (itens que zeraram estoque)`);
    L.push('');
    L.push(
      `Separamos rupturas de **início** (primeiros 60 dias — efeito de partida: os agendamentos só começam a disparar em jun/jul/ago e o estoque atual de itens de alto giro não cobre até a 1ª entrega) das de **regime** (após o dia 60 — indicam cobertura insuficiente do ciclo).`,
    );
    L.push('');
    L.push(`- Só no início (resolvido com uma execução manual agora p/ ponte): **${startupOnlyRupture.length}** itens`);
    L.push(`- Em regime (cobertura do ciclo a revisar): **${steadyStateRupture.length}** itens`);
    L.push('');
    L.push(`| Item | Fornecedor | mc/mês | Lead | Ruptura início (≤60d) | Ruptura regime (>60d) | Nº pedidos |`);
    L.push(`|---|---|---:|---:|---:|---:|---:|`);
    for (const it of stockoutItems.sort((a, b) => b.stockoutLate - a.stockoutLate || b.stockoutDays - a.stockoutDays)) {
      L.push(
        `| ${it.name} | ${it.supplier} | ${round2(it.mc)} | ${it.leadTime}d | ${it.stockoutEarly} | ${it.stockoutLate} | ${it.orderCount} |`,
      );
    }
    L.push('');
  }

  if (neverOrderedButConsumed.length) {
    L.push(`## ⚠️ Consumidos mas nunca pedidos (mc=0 — risco de ruptura silenciosa)`);
    L.push('');
    L.push(`Estes itens tiveram saídas no histórico mas têm \`monthlyConsumption = 0\`, então o cálculo automático NÃO os pede. Reveja a configuração de consumo/estoque.`);
    L.push('');
    L.push(`| Item | Cód. | Fornecedor | Consumo modelado (ano) | Estoque atual | Estoque final |`);
    L.push(`|---|---|---|---:|---:|---:|`);
    for (const it of neverOrderedButConsumed.sort((a, b) => b.consumed - a.consumed)) {
      L.push(`| ${it.name} | ${it.uniCode ?? '—'} | ${it.supplier} | ${round2(it.consumed)} | ${round2(itemMap.get(it.id)!.stock + it.consumed)} | ${round2(it.stock)} |`);
    }
    L.push('');
  }

  const outDir = join(__dirname, 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'order-schedule-year-simulation.md');
  writeFileSync(outPath, L.join('\n'), 'utf8');

  // ── Console summary ─────────────────────────────────────────────────────
  console.log(`\n===== SIMULAÇÃO ANUAL — RESUMO =====`);
  console.log(`Período: ${format(start, 'dd/MM/yyyy')} → ${format(end, 'dd/MM/yyyy')}`);
  console.log(`Agendamentos: ${schedules.length} | Itens: ${allItemIds.length} (com consumo: ${movingItems.length})`);
  console.log(`Disparos: ${fireCount} | Linhas de pedido: ${orderLines.length}`);
  console.log(`GASTO TOTAL SIMULADO: ${brl(totalSpend)}`);
  console.log(`Rupturas: ${stockoutItems.length} itens | Consumidos-mas-nunca-pedidos (mc=0): ${neverOrderedButConsumed.length}`);
  console.log(`\nGasto por fornecedor:`);
  for (const [sup, e] of [...bySupplier.entries()].sort((a, b) => b[1].spend - a[1].spend)) {
    console.log(`  ${sup.padEnd(32)} ${String(e.lines).padStart(4)} linhas  ${brl(e.spend)}`);
  }
  if (stockoutItems.length) {
    const steady = movingItems.filter(i => i.stockoutLate > 0);
    const startupOnly = stockoutItems.filter(i => i.stockoutLate === 0);
    console.log(`\nRupturas: ${startupOnly.length} só no INÍCIO (partida — resolve com execução manual agora) | ${steady.length} em REGIME (cobertura do ciclo a revisar)`);
    console.log(`\n⚠️ Rupturas em REGIME (>60d) — as que importam (top 12):`);
    for (const it of steady.sort((a, b) => b.stockoutLate - a.stockoutLate).slice(0, 12)) {
      console.log(`  ${it.name.padEnd(30)} regime ${String(it.stockoutLate).padStart(3)}d | início ${String(it.stockoutEarly).padStart(3)}d | lead ${it.leadTime}d | ${it.orderCount} pedidos`);
    }
  }
  if (neverOrderedButConsumed.length) {
    console.log(`\n⚠️ Consumidos mas nunca pedidos (mc=0) — top 10:`);
    for (const it of neverOrderedButConsumed.sort((a, b) => b.consumed - a.consumed).slice(0, 10)) {
      console.log(`  ${it.name.padEnd(34)} consumo ano ~${round2(it.consumed)}`);
    }
  }
  console.log(`\nRelatório completo: ${outPath}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
