/**
 * A/B PAREADO: dois motores, a MESMA leitura de geometria.
 *
 * `bench.mjs` abre 260 PDFs num processo só e o pdf.js não devolve sempre a
 * mesma lista de operadores — duas passadas idênticas do MESMO bundle deram
 * recall 41,2% e 41,6% e 3.444 contra 3.621 cotas geradas (111 das 325 faces
 * divergiram, com a MESMA lista de itens). Qualquer A/B feito com duas
 * passadas separadas mede esse ruído junto com a mudança.
 *
 * Aqui a página é lida UMA vez e os dois motores rodam sobre o mesmo `g`.
 * A diferença que sobra é a da mudança, e só dela.
 *
 * Uso:  node ab.mjs <pasta>            (A=/tmp/ldim, B=/tmp/ldim2)
 *       LIB_A=... LIB_B=... node ab.mjs <pasta>
 *       GROUPING_B='{"...":0}' para sobrescrever parâmetros só no B
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const A = await import(`${process.env.LIB_A ?? '/tmp/ldim'}/core.js`);
const B = await import(`${process.env.LIB_B ?? '/tmp/ldim2'}/core.js`);

const PT_CM = 72 / 2.54 / 10;
const DIM_RGB = [0x33, 0x74, 0xa9];
const OVERSHOOT_CM = 2.5;
const CROSS_EPS_CM = 0.5;
const INK_CELL_CM = 2;
const EDGE_TOL_CM = 1.5;
const near = (a, b, t) => Math.abs(a - b) <= t;
const GR_A = { ...A.DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING_A ?? '{}') };
const GR_B = { ...B.DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING_B ?? '{}') };
const DO_A = { ...A.DEFAULT_DOCTRINE, ...JSON.parse(process.env.DOCTRINE ?? '{}') };
const DO_B = { ...B.DEFAULT_DOCTRINE, ...JSON.parse(process.env.DOCTRINE ?? '{}') };

const walk = (d, out = []) => {
  for (const e of readdirSync(d).sort()) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.toLowerCase().endsWith('.pdf')) out.push(p);
  }
  return out;
};

function designerDims(g, items) {
  const blue = g.objects.filter((o) => o.stroke &&
    near(o.stroke[0], DIM_RGB[0], 12) && near(o.stroke[1], DIM_RGB[1], 12) && near(o.stroke[2], DIM_RGB[2], 12));
  const Hs = [], Vs = [];
  for (const o of blue) for (const poly of o.outline) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    if (Math.abs(a.y - b.y) < .6 && Math.abs(a.x - b.x) >= 1) Hs.push([Math.min(a.x, b.x), Math.max(a.x, b.x), (a.y + b.y) / 2]);
    else if (Math.abs(a.x - b.x) < .6 && Math.abs(a.y - b.y) >= 1) Vs.push([Math.min(a.y, b.y), Math.max(a.y, b.y), (a.x + b.x) / 2]);
  }
  const out = [];
  for (const t of items) {
    const v = Number(String(t.str).replace(/cm/gi, '').trim().replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0 || v > 3000) continue;
    const m = t.transform, vert = Math.abs(m[1]) > Math.abs(m[0]);
    const cx = m[4] + (vert ? 0 : t.width / 2), cy = g.height - m[5] - (vert ? t.width / 2 : 0);
    const target = v * PT_CM;
    let best = null;
    for (const ax of new Set((vert ? Vs : Hs).filter((s) => Math.abs(s[2] - (vert ? cx : cy)) < 45).map((s) => +s[2].toFixed(1)))) {
      const pts = [...new Set((vert ? Hs : Vs).filter((s) => s[0] - 6 <= ax && ax <= s[1] + 6).map((s) => +s[2].toFixed(1)))].sort((p, q) => p - q);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const err = Math.abs(pts[j] - pts[i] - target);
        if (!best || err < best.err) best = { err, ax, a: pts[i], b: pts[j] };
      }
    }
    if (best && best.err < Math.max(6, target * 0.06)) out.push({ v, vert, ...best });
  }
  return out;
}

function panelRects(g) {
  const cands = g.objects.filter((o) => o.outline.length === 1 &&
    (o.outline[0].length === 4 || o.outline[0].length === 5) &&
    (o.bbox.x1 - o.bbox.x0) / PT_CM >= 300 && (o.bbox.y1 - o.bbox.y0) / PT_CM >= 140 &&
    (o.bbox.x1 - o.bbox.x0) < g.width * 0.99);
  cands.sort((a, b) => (b.bbox.x1 - b.bbox.x0) * (b.bbox.y1 - b.bbox.y0) - (a.bbox.x1 - a.bbox.x0) * (a.bbox.y1 - a.bbox.y0));
  const keep = [];
  for (const c of cands) {
    const r = c.bbox;
    if (keep.some((k) => Math.abs(k.x0 - r.x0) < 6 && Math.abs(k.x1 - r.x1) < 6 && Math.abs(k.y0 - r.y0) < 6 && Math.abs(k.y1 - r.y1) < 6)) continue;
    if (keep.some((k) => k.x0 - 3 <= r.x0 && r.x1 <= k.x1 + 3 && k.y0 - 3 <= r.y0 && r.y1 <= k.y1 + 3)) continue;
    keep.push(r);
  }
  return keep;
}

function segmentsOf(d) {
  const lo = Math.min(d.aCm, d.bCm), hi = Math.max(d.aCm, d.bCm);
  const dir = d.offsetCm >= d.tieCm ? 1 : -1;
  const end = d.offsetCm + dir * OVERSHOOT_CM;
  const e0 = Math.min(d.tieCm, end), e1 = Math.max(d.tieCm, end);
  if (d.axis === 'H') return [
    { horiz: true, y: d.offsetCm, x0: lo, x1: hi, line: true },
    { horiz: false, x: d.aCm, y0: e0, y1: e1, line: false },
    { horiz: false, x: d.bCm, y0: e0, y1: e1, line: false }];
  return [
    { horiz: false, x: d.offsetCm, y0: lo, y1: hi, line: true },
    { horiz: true, y: d.aCm, x0: e0, x1: e1, line: false },
    { horiz: true, y: d.bCm, x0: e0, x1: e1, line: false }];
}
const segCross = (s1, s2) => {
  if (s1.horiz === s2.horiz) return false;
  const h = s1.horiz ? s1 : s2, v = s1.horiz ? s2 : s1;
  return h.x0 + CROSS_EPS_CM < v.x && v.x < h.x1 - CROSS_EPS_CM && v.y0 + CROSS_EPS_CM < h.y && h.y < v.y1 - CROSS_EPS_CM;
};
function severePairs(dims) {
  const segs = dims.map(segmentsOf);
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (segs[i].some((a) => segs[j].some((b) => segCross(a, b) && (a.line || b.line)))) n++;
  }
  return n;
}
const tipsOf = (d) => (d.axis === 'H'
  ? [{ x: d.aCm, y: d.tieCm, along: d.aCm }, { x: d.bCm, y: d.tieCm, along: d.bCm }]
  : [{ x: d.tieCm, y: d.aCm, along: d.aCm }, { x: d.tieCm, y: d.bCm, along: d.bCm }]);
function buildInkGrid(polys, widthCm, heightCm) {
  const nx = Math.ceil(widthCm / INK_CELL_CM) + 2, ny = Math.ceil(heightCm / INK_CELL_CM) + 2;
  const cells = new Set();
  const mark = (x, y) => {
    const ix = Math.floor(x / INK_CELL_CM) + 1, iy = Math.floor(y / INK_CELL_CM) + 1;
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return;
    cells.add(iy * nx + ix);
  };
  for (const poly of polys) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const steps = Math.min(4000, Math.ceil(Math.hypot(dx, dy) / (INK_CELL_CM / 2)) + 1);
    for (let s = 0; s <= steps; s++) mark(a.x + (dx * s) / steps, a.y + (dy * s) / steps);
  }
  return { cells, nx, ny };
}
function gridHas(grid, x, y) {
  const ix = Math.floor(x / INK_CELL_CM) + 1, iy = Math.floor(y / INK_CELL_CM) + 1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const jx = ix + dx, jy = iy + dy;
    if (jx < 0 || jy < 0 || jx >= grid.nx || jy >= grid.ny) continue;
    if (grid.cells.has(jy * grid.nx + jx)) return true;
  }
  return false;
}

console.log('A params:', Object.keys(A.DEFAULT_GROUPING).length, ' B params:', Object.keys(B.DEFAULT_GROUPING).length, ' B tem lineAttach:', 'lineAttachAreaFrac' in B.DEFAULT_GROUPING);
const itemDiff = [];
const CORPUS = process.argv[2];
const files = walk(CORPUS);
const stat = { A: blank(), B: blank() };
function blank() { return { ref: 0, gen: 0, hit: 0, items: 0, voidTips: 0, tips: 0, severe: 0, faces: 0 }; }
const worse = [];

for (const f of files) {
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const g = await A.readPageGeometry(page);
    const tc = await page.getTextContent();
    const ref = designerDims(g, tc.items);
    const rects = panelRects(g);
    if (!rects.length || ref.length < 2) { await doc.destroy(); continue; }
    const owned = rects.map(() => []);
    for (const d of ref) {
      let best = -1, score = Infinity;
      rects.forEach((R, i) => {
        const W = (R.x1 - R.x0) / PT_CM, H = (R.y1 - R.y0) / PT_CM;
        const ax = d.vert ? (d.ax - R.x0) / PT_CM : (d.ax - R.y0) / PT_CM;
        const a = d.vert ? (d.a - R.y0) / PT_CM : (d.a - R.x0) / PT_CM;
        const b = d.vert ? (d.b - R.y0) / PT_CM : (d.b - R.x0) / PT_CM;
        const span = d.vert ? H : W, perp = d.vert ? W : H;
        if (ax < -70 || ax > perp + 70 || b < -30 || a > span + 30) return;
        const s = Math.abs(ax - perp / 2) + Math.max(0, -a) + Math.max(0, b - span);
        if (s < score) { score = s; best = i; }
      });
      if (best >= 0) owned[best].push(d);
    }
    rects.forEach((R, i) => {
      if (owned[i].length < 2) return;
      const widthCm = Math.round((R.x1 - R.x0) / PT_CM), heightCm = Math.round((R.y1 - R.y0) / PT_CM);
      const panel = { side: 'MOTORISTA', heightCm, sections: [{ widthCm, isDoor: false }] };
      const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
      const refP = owned[i].map((d) => d.vert
        ? { axis: 'V', a: (d.a - R.y0) / PT_CM, b: (d.b - R.y0) / PT_CM, v: d.v }
        : { axis: 'H', a: (d.a - R.x0) / PT_CM, b: (d.b - R.x0) / PT_CM, v: d.v });
      const polys = [];
      for (const o of g.objects) {
        if (o.op === 'clip') continue;
        if (o.stroke && near(o.stroke[0], DIM_RGB[0], 12) && near(o.stroke[1], DIM_RGB[1], 12) && near(o.stroke[2], DIM_RGB[2], 12)) continue;
        for (const poly of o.outline) polys.push(poly.map((p) => ({ x: (p.x - R.x0) / PT_CM, y: (p.y - R.y0) / PT_CM })));
      }
      const grid = buildInkGrid(polys, widthCm, heightCm);
      const run = (M, GR, DO, key) => {
        const { pieces } = M.classify(g, scale, GR);
        const built = M.buildItems(pieces, scale, GR);
        const crossings = M.borderCrossings(built.objects, panel, scale, GR);
        const dims = M.planDimensions(panel, built.items, crossings, DO);
        const s = stat[key];
        s.faces++; s.ref += refP.length; s.gen += dims.length; s.items += built.items.length;
        const used = new Set();
        let hits = 0;
        for (const gd of dims) for (let k = 0; k < refP.length; k++) {
          const r = refP[k];
          if (used.has(k) || r.axis !== gd.axis) continue;
          if (Math.abs(r.a - gd.aCm) <= 4 && Math.abs(r.b - gd.bCm) <= 4 && Math.abs(r.v - gd.valueCm) <= 3) { used.add(k); hits++; break; }
        }
        s.hit += hits;
        s.severe += severePairs(dims);
        for (const d of dims) for (const tip of tipsOf(d)) {
          s.tips++;
          const limit = d.axis === 'H' ? widthCm : heightCm;
          if (Math.abs(tip.along) <= EDGE_TOL_CM || Math.abs(tip.along - limit) <= EDGE_TOL_CM) continue;
          if (!gridHas(grid, tip.x, tip.y)) s.voidTips++;
        }
        return hits;
      };
      const ia = stat.A.items, ib = stat.B.items;
      const ha = run(A, GR_A, DO_A, 'A');
      const da = stat.A.items - ia;
      const hb = run(B, GR_B, DO_B, 'B');
      const db = stat.B.items - ib;
      if (da !== db) itemDiff.push(`${db - da > 0 ? '+' : ''}${db - da}  itens ${da}->${db}  ${f.split('/').pop()}#${i}`);
      if (ha !== hb) worse.push(`${hb - ha > 0 ? '+' : ''}${hb - ha}  ${f.split('/').pop()}#${i}`);
    });
    await doc.destroy();
  } catch { try { await doc?.destroy(); } catch { /* */ } }
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(2) : '0');
for (const k of ['A', 'B']) {
  const s = stat[k];
  console.log(`${k}: faces=${s.faces} ref=${s.ref} gen=${s.gen} itens=${s.items}`);
  console.log(`   recall=${pct(s.hit, s.ref)}%  precisao=${pct(s.hit, s.gen)}%  voidTipPct=${pct(s.voidTips, s.tips)}%  genPerFaceMean=${(s.gen / s.faces).toFixed(2)}  graves/face=${(s.severe / s.faces).toFixed(3)}`);
}
console.log(`\nfaces com contagem de itens diferente (${itemDiff.length}):`);
itemDiff.slice(0,25).forEach((w) => console.log('  ' + w));
console.log(`\nfaces em que o recall mudou (${worse.length}):`);
worse.sort().forEach((w) => console.log('  ' + w));
