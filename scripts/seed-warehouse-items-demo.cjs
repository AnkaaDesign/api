// Additive demo seed for the warehouse MAP — populates EXISTING structures with items.
// It NEVER creates/deletes warehouse locations (the floor map is hand-built); it only
// (re)assigns Item placement fields (warehouseLocationId / locationLevel / locationColumn).
//
//   • parafusos + rebites (+ other fasteners)  → kanban cells (level × column / caixa)
//   • adesivos, fitas, máscaras (321 & 328)     → paletes (single bin)
//   • one ESTANTE entirely a single item        → locationLevel = null  → "whole structure" banner
//   • one PALETE entirely a single item         → single item in the bin → "Palete completo" banner
//
// Idempotent: clears every item placement first, then re-places deterministically.
//   node scripts/seed-warehouse-items-demo.cjs
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const norm = (s) => (s || '').toLowerCase();
const anyOf = (name, terms) => terms.some((t) => norm(name).includes(t));

// per-level column count for a kanban (columnsPerLevel override, fallback to columns)
const colsForLevel = (loc, level) => {
  const o = loc.columnsPerLevel && loc.columnsPerLevel[level - 1];
  return o && o > 0 ? o : loc.columns;
};

async function main() {
  const locs = await prisma.warehouseLocation.findMany({
    select: { id: true, name: true, code: true, section: true, type: true, levels: true, columns: true, columnsPerLevel: true },
  });
  const byName = (n) => locs.find((l) => l.name === n);
  const kanbans = locs.filter((l) => l.type === 'ESTANTE_KANBAN');
  const paletes = locs.filter((l) => l.type === 'PALETE');
  if (!kanbans.length || !paletes.length) { console.error('No kanban/palete structures found — nothing to seed.'); return; }

  // --- clean slate for placements only (idempotent re-runs) -----------------
  const reset = await prisma.item.updateMany({
    where: { warehouseLocationId: { not: null } },
    data: { warehouseLocationId: null, locationLevel: null, locationColumn: null },
  });
  console.log(`[SEED-MAP-ITEMS] cleared ${reset.count} previous item placements`);

  const items = await prisma.item.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  const used = new Set();
  const take = (pred, n = Infinity) => {
    const out = [];
    for (const it of items) { if (out.length >= n) break; if (used.has(it.id)) continue; if (pred(it)) { out.push(it); used.add(it.id); } }
    return out;
  };
  const place = async (item, locId, level, column) => {
    await prisma.item.update({ where: { id: item.id }, data: { warehouseLocationId: locId, locationLevel: level, locationColumn: column } });
  };

  // ---------------------------------------------------------------------------
  // 1) SINGLE-ITEM WHOLE STRUCTURES (reserve these items first so they're unique)
  // ---------------------------------------------------------------------------
  const wholeEstante = byName('S1-E6');   // an entire estante of one product
  const wholePalete = byName('S4-PL5');   // an entire palete of one product
  let wholeNotes = [];
  if (wholeEstante) {
    const one = take((i) => anyOf(i.name, ['adesivo vinil']), 1)[0] || take(() => true, 1)[0];
    if (one) { await place(one, wholeEstante.id, null, null); wholeNotes.push(`${wholeEstante.name} ← "${one.name}" (estante inteira)`); }
  }
  if (wholePalete) {
    const one = take((i) => anyOf(i.name, ['fita']), 1)[0] || take(() => true, 1)[0];
    if (one) { await place(one, wholePalete.id, null, null); wholeNotes.push(`${wholePalete.name} ← "${one.name}" (palete inteiro)`); }
  }

  // ---------------------------------------------------------------------------
  // 2) KANBANS ← parafusos + rebites first, then other fasteners, into level×column cells
  // ---------------------------------------------------------------------------
  const fasteners = [
    ...take((i) => anyOf(i.name, ['parafuso'])),
    ...take((i) => anyOf(i.name, ['rebite'])),
    ...take((i) => anyOf(i.name, ['porca', 'arruela', 'abraçadeira', 'abracadeira', 'bucha', 'prego', 'rosca', 'grampo', 'fixad'])),
  ];
  // build per-rack cell lists, then INTERLEAVE them so every kanban gets filled evenly
  // (round-robin across racks instead of filling rack #1 to the brim first)
  const perRack = kanbans.map((k) => { const cs = []; for (let lvl = 1; lvl <= k.levels; lvl++) for (let col = 1; col <= colsForLevel(k, lvl); col++) cs.push({ k, lvl, col }); return cs; });
  const cells = [];
  for (let idx = 0, more = true; more; idx++) { more = false; for (const cs of perRack) if (idx < cs.length) { cells.push(cs[idx]); more = true; } }
  let kCount = 0;
  for (let i = 0; i < cells.length && i < fasteners.length; i++) { const c = cells[i]; await place(fasteners[i], c.k.id, c.lvl, c.col); kCount++; }
  console.log(`[SEED-MAP-ITEMS] kanbans: placed ${kCount} fasteners (${fasteners.length} available) across ${cells.length} cells`);

  // ---------------------------------------------------------------------------
  // 3) PALETES ← adesivos / fitas / máscaras (incl. 321 & 328), one product group per palete
  // ---------------------------------------------------------------------------
  const adesivos = take((i) => anyOf(i.name, ['adesivo']));
  const fitas = take((i) => anyOf(i.name, ['fita']));
  const mascaras = take((i) => anyOf(i.name, ['máscara', 'mascara']));
  // ensure 321 & 328 are present in the máscara pile
  for (const code of ['321', '328']) {
    if (!mascaras.some((m) => m.name.includes(code))) { const extra = take((i) => i.name.includes(code), 1); mascaras.push(...extra); }
  }
  // distribute groups across the remaining (non-whole) paletes
  const openPaletes = paletes.filter((p) => p.id !== (wholePalete && wholePalete.id));
  const groups = [adesivos.slice(0, 6), adesivos.slice(6), fitas, mascaras].filter((g) => g.length);
  let pCount = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const pal = openPaletes[gi % openPaletes.length];
    if (!pal) break;
    for (const it of groups[gi]) { await place(it, pal.id, null, null); pCount++; }
  }
  console.log(`[SEED-MAP-ITEMS] paletes: placed ${pCount} items (adesivos ${adesivos.length}, fitas ${fitas.length}, máscaras ${mascaras.length})`);

  // ---------------------------------------------------------------------------
  // 4) Sprinkle the rest into estantes/duplas so the map reads "lived-in"
  // ---------------------------------------------------------------------------
  const shelves = locs.filter((l) => (l.type === 'ESTANTE' || l.type === 'ESTANTE_DUPLA') && l.name !== 'S1-E6');
  const filler = take((i) => anyOf(i.name, ['tinta', 'verniz', 'lixa', 'disco', 'boina', 'pincel', 'rolo', 'solvente', 'thinner', 'cola', 'massa', 'primer', 'catalisador', 'aluminio', 'alumínio']), 80);
  let sCount = 0;
  for (let i = 0; i < filler.length && shelves.length; i++) {
    const loc = shelves[i % shelves.length];
    const level = (i % Math.max(1, loc.levels)) + 1;
    await place(filler[i], loc.id, level, null);
    sCount++;
  }
  console.log(`[SEED-MAP-ITEMS] shelves: placed ${sCount} filler items across ${shelves.length} estantes/duplas`);

  console.log('[SEED-MAP-ITEMS] whole-structure demos:');
  wholeNotes.forEach((n) => console.log('   • ' + n));
  console.log('[SEED-MAP-ITEMS] done');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
