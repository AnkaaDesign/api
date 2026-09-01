/**
 * The designer's own dimensions, resolved to face coordinates, next to the
 * engine's. Answers "what number should this ornament have carried?".
 *
 * The resolver is the one used across the harness: find the blue label, find
 * the perpendicular extension lines that touch the dimension line, and keep the
 * pair whose distance reproduces the printed number.
 *
 * Usage: node designerdims.mjs <pdf>
 */
import { readFileSync } from 'node:fs';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, borderCrossings, planDimensions, DEFAULT_GROUPING, DEFAULT_DOCTRINE } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10, DIM = [0x33, 0x74, 0xa9];
const near = (a, b, t) => Math.abs(a - b) <= t;
const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);

function panelRects(g) {
  const isRect = (o) => {
    if (o.outline.length !== 1) return false;
    const p = o.outline[0];
    const pts = p.length >= 2 && Math.abs(p[0].x - p[p.length - 1].x) < 1.5 && Math.abs(p[0].y - p[p.length - 1].y) < 1.5 ? p.slice(0, -1) : p;
    if (pts.length !== 4) return false;
    for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; if (Math.abs(a.x - b.x) > 1.5 && Math.abs(a.y - b.y) > 1.5) return false; }
    return true;
  };
  const out = [];
  for (const o of g.objects) {
    if (o.op === 'clip' || o.op === 'image' || !isRect(o)) continue;
    const w = o.bbox.x1 - o.bbox.x0, h = o.bbox.y1 - o.bbox.y0;
    if (w / PT_CM < 150 || h / PT_CM < 100) continue;
    if (w > g.width * 0.995 && h > g.height * 0.995) continue;
    out.push(o.bbox);
  }
  out.sort((a, b) => area(b) - area(a));
  const keep = [];
  for (const r of out) {
    if (keep.some((k) => Math.abs(k.x0 - r.x0) < 6 && Math.abs(k.x1 - r.x1) < 6 && Math.abs(k.y0 - r.y0) < 6 && Math.abs(k.y1 - r.y1) < 6)) continue;
    if (keep.some((k) => k.x0 - 3 <= r.x0 && r.x1 <= k.x1 + 3 && k.y0 - 3 <= r.y0 && r.y1 <= k.y1 + 3)) continue;
    keep.push(r);
  }
  keep.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return keep;
}

const file = process.argv[2];
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const g = await readPageGeometry(page);
const tc = await page.getTextContent();

const blue = g.objects.filter((o) => o.stroke && near(o.stroke[0], DIM[0], 12) && near(o.stroke[1], DIM[1], 12) && near(o.stroke[2], DIM[2], 12));
const Hs = [], Vs = [];
for (const o of blue) for (const poly of o.outline) for (let i = 0; i + 1 < poly.length; i++) {
  const a = poly[i], b = poly[i + 1];
  if (Math.abs(a.y - b.y) < .6 && Math.abs(a.x - b.x) >= 1) Hs.push([Math.min(a.x, b.x), Math.max(a.x, b.x), (a.y + b.y) / 2]);
  else if (Math.abs(a.x - b.x) < .6 && Math.abs(a.y - b.y) >= 1) Vs.push([Math.min(a.y, b.y), Math.max(a.y, b.y), (a.x + b.x) / 2]);
}
const resolved = [];
for (const t of tc.items) {
  const v = Number(String(t.str).replace(/cm/gi, '').trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0 || v > 3000) continue;
  const m = t.transform, vert = Math.abs(m[1]) > Math.abs(m[0]);
  const lx = m[4] + (vert ? 0 : t.width / 2), ly = g.height - m[5] - (vert ? t.width / 2 : 0);
  const target = v * PT_CM; let best = null;
  for (const ax of new Set((vert ? Vs : Hs).filter((s) => Math.abs(s[2] - (vert ? lx : ly)) < 45).map((s) => +s[2].toFixed(1)))) {
    const pts = [...new Set((vert ? Hs : Vs).filter((s) => s[0] - 6 <= ax && ax <= s[1] + 6).map((s) => +s[2].toFixed(1)))].sort((p, q) => p - q);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const err = Math.abs(pts[j] - pts[i] - target); if (!best || err < best.err) best = { err, ax, a: pts[i], b: pts[j] }; }
  }
  resolved.push({ v, vert, best: best && best.err < Math.max(6, target * 0.06) ? best : null });
}

const rects = panelRects(g);
console.log(`${file.split('/').pop()}  ${rects.length} faces  ${resolved.length} rotulos azuis`);
rects.forEach((R, fi) => {
  const W = (R.x1 - R.x0) / PT_CM, H = (R.y1 - R.y0) / PT_CM;
  const cx = (v) => +((v - R.x0) / PT_CM).toFixed(1), cy = (v) => +((v - R.y0) / PT_CM).toFixed(1);
  const panel = { side: 'MOTORISTA', heightCm: Math.round(H), sections: [{ widthCm: Math.round(W), isDoor: false }] };
  const scale = { ptPerCm: PT_CM, panelPt: R };
  const { pieces } = classify(g, scale, DEFAULT_GROUPING);
  const built = buildItems(pieces, scale, DEFAULT_GROUPING);
  const crossings = borderCrossings(built.objects, panel, scale, DEFAULT_GROUPING);
  const dims = planDimensions(panel, built.items, crossings, DEFAULT_DOCTRINE);
  console.log(`\n== face #${fi} ${W.toFixed(0)}x${H.toFixed(0)} cm`);
  console.log('  -- PROJETISTA --');
  for (const r of resolved) {
    if (!r.best) continue;
    const A = r.vert ? cy(r.best.a) : cx(r.best.a), B = r.vert ? cy(r.best.b) : cx(r.best.b);
    const span = r.vert ? H : W;
    if (B < -20 || A > span + 20) continue;
    const ax = r.vert ? cx(r.best.ax) : cy(r.best.ax);
    if (ax < -70 || ax > (r.vert ? W : H) + 70) continue;
    console.log(`     ${String(r.v).padStart(6)} ${r.vert ? 'V' : 'H'}  ${A.toFixed(1).padStart(8)} -> ${B.toFixed(1).padStart(8)}   (linha em ${ax.toFixed(0)})`);
  }
  console.log('  -- MOTOR --');
  for (const d of dims) console.log(`     ${d.valueCm.toFixed(0).padStart(6)} ${d.axis}  ${d.aCm.toFixed(1).padStart(8)} -> ${d.bCm.toFixed(1).padStart(8)}   ${d.kind}  item#${d.targetIndex}`);
  console.log('  -- TRAVESSIAS CRUAS --');
  for (const c of crossings) console.log(`     ${c.edge.padEnd(7)} ${c.startCm.toFixed(1).padStart(8)} .. ${c.endCm.toFixed(1).padStart(8)}   (${(c.endCm - c.startCm).toFixed(0)} cm, item#${c.wrapIndex})`);
});
await doc.destroy();
