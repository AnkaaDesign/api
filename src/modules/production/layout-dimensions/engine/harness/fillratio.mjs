/**
 * When does the RECTANGLE lie?
 *
 * Distribution of ink/box for every built item, split by whether the item
 * touches the face border. The gate for "draw the contour instead of the box"
 * has to be picked from these numbers, not guessed: a lockup of glyphs is a
 * legitimate rectangle (the doctrine's whole alignedBox story rests on it), a
 * sickle that sweeps the face is not.
 *
 * Usage: node fillratio.mjs <folder>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10, GR = DEFAULT_GROUPING;
const CORPUS = process.argv[2] ?? `${process.env.HOME}/layouts`;
const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p); } return o; };
const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
function polyArea(outline) {
  let a = 0;
  for (const poly of outline) {
    for (let i = 0; i + 1 < poly.length; i++) a += poly[i].x * poly[i + 1].y - poly[i + 1].x * poly[i].y;
    if (poly.length > 2) { const p = poly[poly.length - 1], q = poly[0]; a += p.x * q.y - q.x * p.y; }
  }
  return Math.abs(a) / 2;
}
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
const q = (arr, p) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const show = (name, a) => console.log(`  ${name.padEnd(42)} n=${String(a.length).padStart(5)}  p10=${q(a, .1).toFixed(2)}  p25=${q(a, .25).toFixed(2)}  p50=${q(a, .5).toFixed(2)}  p75=${q(a, .75).toFixed(2)}  p90=${q(a, .9).toFixed(2)}`);

const files = walk(CORPUS).sort();
const bleedBig = [], bleedSmall = [], plainBig = [], plainSmall = [], wrapAll = [];
let nBleedBigUnder50 = 0, nPlainBigUnder50 = 0;

for (const f of files) {
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const g = await readPageGeometry(await doc.getPage(1));
    for (const R of panelRects(g)) {
      const scale = { ptPerCm: PT_CM, panelPt: R };
      const { pieces } = classify(g, scale, GR);
      const built = buildItems(pieces, scale, GR);
      const faceArea = area(R);
      built.items.forEach((it, i) => {
        const polys = built.objects[i].flatMap((o) => o.outline);
        if (!polys.length) return; // image: no contour to compare
        const ratio = Math.min(1, polyArea(polys) / Math.max(1, area(it.bbox)));
        const big = area(it.bbox) / faceArea >= 0.08;
        const bleeds = it.bleedAxes.edges.length > 0;
        if (it.bleeds) wrapAll.push(ratio);
        if (bleeds && big) { bleedBig.push(ratio); if (ratio < 0.5) nBleedBigUnder50++; }
        else if (bleeds) bleedSmall.push(ratio);
        else if (big) { plainBig.push(ratio); if (ratio < 0.5) nPlainBigUnder50++; }
        else plainSmall.push(ratio);
      });
    }
    await doc.destroy();
  } catch { if (doc) await doc.destroy().catch(() => {}); }
}

console.log('=== tinta / caixa, por item (1,00 = a caixa e honesta) ===');
show('encosta na borda E cobre >=8% da face', bleedBig);
show('encosta na borda, pequeno', bleedSmall);
show('NAO encosta, cobre >=8% da face', plainBig);
show('NAO encosta, pequeno', plainSmall);
show('ja classificado como wrap', wrapAll);
console.log(`\n  itens que encostam na borda, grandes, com tinta < 50% da caixa : ${nBleedBigUnder50} de ${bleedBig.length}`);
console.log(`  itens que NAO encostam, grandes, com tinta < 50% da caixa      : ${nPlainBigUnder50} de ${plainBig.length}`);
