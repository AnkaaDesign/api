// Realistic demo seed for the warehouse map — rows of racks in walking aisles,
// filling the L-shaped floor, all grid-aligned (10 cm) and INSIDE the floor.
//   sector code = S1..S4 (by Y band)  ·  structure code = E#/D#/K#/PN#/PL#
//   item full location: estante → S1-E2-P4 ; kanban → S1-K1-P4-C2 (C = caixa)
// Clean slate: wipes ALL warehouse locations first (local demo DB).
//   node scripts/seed-warehouse-map-demo.cjs
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// floor: main body x[0,518] y[0,1351] (3 sectors) + extension x[0,275] y[1351,1969] (S4)
const SECTOR_BANDS = [
  { id: 'S1', yMin: 0, yMax: 666 },
  { id: 'S2', yMin: 666, yMax: 1183 },
  { id: 'S3', yMin: 1183, yMax: 1351 },
  { id: 'S4', yMin: 1351, yMax: 1969 },
];
const sectorAt = (y, h) => (SECTOR_BANDS.find((b) => y + h / 2 >= b.yMin && y + h / 2 < b.yMax) || SECTOR_BANDS[0]).id;

const PREFIX = { ESTANTE: 'E', ESTANTE_DUPLA: 'D', ESTANTE_KANBAN: 'K', PAINEL: 'PN', PALETE: 'PL' };
const counters = {};
const STRUCTURES = [];
const add = (type, x, y, w, h, levels, columns, columnsPerLevel = []) => {
  const p = PREFIX[type];
  counters[p] = (counters[p] || 0) + 1;
  STRUCTURES.push({ code: `${p}${counters[p]}`, section: sectorAt(y, h), type, positionX: x, positionY: y, width: w, height: h, levels, columns, columnsPerLevel });
};

// --- Main hall LEFT: horizontal rack rows (2 columns) with walking aisles ---
const COLS = [20, 180]; // each rack 150 wide
const RW = 150;
let row = 0;
for (let y = 30; y + 80 <= 1330; y += 170, row++) {
  for (let ci = 0; ci < COLS.length; ci++) {
    const x = COLS[ci];
    if (row === 1 && ci === 1) add('ESTANTE_KANBAN', x, y, RW, 40, 5, 4, [3, 4, 5, 6, 6]);
    else if (row === 4) add('PALETE', x, y, 120, 100, 1, 1); // a palete staging row
    else if (row % 3 === 2) add('ESTANTE', x, y, RW, 40, 5, 1); // single-depth shelf row
    else add('ESTANTE_DUPLA', x, y, RW, 80, 6, 1); // back-to-back rack row
  }
}
// --- Main hall RIGHT: VERTICAL estantes along the wall (narrow & tall) ---
const VX = [360, 430]; // two columns of vertical estantes, 60 wide
for (let y = 30, vr = 0; y + 160 <= 1330; y += 180, vr++) {
  for (let ci = 0; ci < VX.length; ci++) {
    const x = VX[ci];
    if (vr === 2 && ci === 0) add('ESTANTE_KANBAN', x, y, 60, 160, 6, 3, [3, 3, 4, 4, 5, 5]);
    else add('ESTANTE', x, y, 60, 160, 6, 1);
  }
}
// painel on the front wall
add('PAINEL', 20, 5, 320, 15, 3, 8);

// --- Extension wing (narrow, x 0–275) ---
add('PALETE', 20, 1380, 120, 100, 1, 1);
add('PALETE', 150, 1380, 120, 100, 1, 1);
add('PALETE', 20, 1500, 120, 100, 1, 1);
add('PALETE', 150, 1500, 120, 100, 1, 1);
add('ESTANTE', 20, 1640, 140, 40, 5, 1);
add('ESTANTE', 20, 1700, 140, 40, 5, 1);
add('ESTANTE_KANBAN', 20, 1790, 140, 40, 5, 4, [4, 4, 5, 6, 6]);

async function main() {
  const del = await prisma.warehouseLocation.deleteMany({});
  console.log(`[SEED-MAP-DEMO] cleared ${del.count} existing structures (clean slate)`);

  const created = [];
  for (const s of STRUCTURES) {
    const loc = await prisma.warehouseLocation.create({
      data: {
        name: `${s.section}-${s.code}`,
        type: s.type, section: s.section, code: s.code, description: '[SEED-MAP-DEMO]', isActive: true,
        positionX: s.positionX, positionY: s.positionY, width: s.width, height: s.height, rotation: 0,
        levels: s.levels, columns: s.columns, columnsPerLevel: s.columnsPerLevel,
      },
    });
    created.push({ ...loc, type: s.type, levels: s.levels, columns: s.columns });
  }
  console.log(`[SEED-MAP-DEMO] created ${created.length} structures`);

  // place items: estantes/kanban get items; kanban also gets a column (caixa).
  const placeable = created.filter((s) => s.type === 'ESTANTE' || s.type === 'ESTANTE_DUPLA' || s.type === 'ESTANTE_KANBAN');
  const items = await prisma.item.findMany({ where: { isActive: true }, take: 36, orderBy: { name: 'asc' }, select: { id: true } });
  let placed = 0;
  for (let i = 0; i < items.length; i++) {
    const loc = placeable[i % placeable.length];
    if (!loc) break;
    const level = (i % Math.max(1, loc.levels)) + 1;
    const column = loc.type === 'ESTANTE_KANBAN' ? (i % Math.max(1, Math.min(loc.columns, 4))) + 1 : null;
    await prisma.item.update({ where: { id: items[i].id }, data: { warehouseLocationId: loc.id, locationLevel: level, locationColumn: column } });
    placed++;
  }
  console.log(`[SEED-MAP-DEMO] placed ${placed} items`);
  console.log('[SEED-MAP-DEMO] done');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
