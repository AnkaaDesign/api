/**
 * Perfil de SOBREPOSIÇÃO par a par, para calibrar a fusão de degradê.
 *
 * Para cada par de objetos de uma face imprime: folga, aninhamento de caixa,
 * razão de diagonais, razão de ÁREAS e o `insideFrac`/`runFrac` que o
 * `companionProfile` mede. É com esses números que se decide o limiar.
 *
 * uso: node pair-probe.mjs <pasta> <trecho> [--face N]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);
const PT_CM = 72 / 2.54 / 10;
const [CORPUS, NEEDLE] = process.argv.slice(2);
const walk = (d, out = []) => { for (const e of readdirSync(d).sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, out); else if (e.toLowerCase().endsWith('.pdf')) out.push(p); } return out; };
function panelRects(g) {
  const c = g.objects.filter((o) => o.outline.length === 1 && (o.outline[0].length === 4 || o.outline[0].length === 5) &&
    (o.bbox.x1 - o.bbox.x0) / PT_CM >= 300 && (o.bbox.y1 - o.bbox.y0) / PT_CM >= 140 && (o.bbox.x1 - o.bbox.x0) < g.width * 0.99);
  c.sort((a, b) => (b.bbox.x1 - b.bbox.x0) * (b.bbox.y1 - b.bbox.y0) - (a.bbox.x1 - a.bbox.x0) * (a.bbox.y1 - a.bbox.y0));
  const keep = [];
  for (const k of c) { const r = k.bbox;
    if (keep.some((q) => Math.abs(q.x0 - r.x0) < 6 && Math.abs(q.x1 - r.x1) < 6 && Math.abs(q.y0 - r.y0) < 6 && Math.abs(q.y1 - r.y1) < 6)) continue;
    if (keep.some((q) => q.x0 - 3 <= r.x0 && r.x1 <= q.x1 + 3 && q.y0 - 3 <= r.y0 && r.y1 <= q.y1 + 3)) continue;
    keep.push(r); }
  return keep;
}
const GR = { ...DEFAULT_GROUPING };
const hex = (c) => (c ? '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('') : 'null');
const r2 = (x) => Math.round(x * 100) / 100;
const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
const diag = (r) => Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
function pointToSegment(px, py, a, b) { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)); }
function inside(polys, p) { let s = false; for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) {
  const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) s = !s; } return s; }
function profile(innerP, outerP, gapPt) { const samples = []; const total = innerP.reduce((n, q) => n + q.length, 0);
  const stride = Math.max(1, Math.ceil(total / 200));
  for (const poly of innerP) for (let i = 0; i < poly.length; i += stride) samples.push(poly[i]);
  if (!samples.length) return { runFrac: 0, insideFrac: 0 };
  let near = 0, ins = 0;
  for (const p of samples) { let best = Infinity;
    for (const poly of outerP) { for (let i = 0; i + 1 < poly.length; i++) { const d = pointToSegment(p.x, p.y, poly[i], poly[i + 1]); if (d < best) best = d; if (best <= gapPt) break; } if (best <= gapPt) break; }
    if (best <= gapPt) near++; if (inside(outerP, p)) ins++; }
  return { runFrac: near / samples.length, insideFrac: ins / samples.length }; }

for (const f of walk(CORPUS)) {
  if (NEEDLE && !f.toLowerCase().includes(NEEDLE.toLowerCase())) continue;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
  const g = await readPageGeometry(await doc.getPage(1));
  console.log('### ' + f.split('/').pop());
  panelRects(g).forEach((R, fi) => {
    const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
    const { pieces } = classify(g, scale, GR);
    const els = pieces.map((p) => p.obj);
    if (els.length > 40) { console.log(`-- face ${fi}: ${els.length} objetos (pulado, grande demais)`); return; }
    console.log(`-- face ${fi}: ${els.length} objetos`);
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i].bbox, b = els[j].bbox;
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) continue;                    // só pares que se sobrepõem em caixa
      const nested = (ix * iy) / Math.min(area(a), area(b));
      const dR = Math.min(diag(a), diag(b)) / Math.max(diag(a), diag(b));
      const aR = Math.min(area(a), area(b)) / Math.max(area(a), area(b));
      const [inn, out] = diag(a) <= diag(b) ? [els[i], els[j]] : [els[j], els[i]];
      const pr = profile(inn.outline, out.outline, GR.partGapCm * PT_CM);
      const pr8 = profile(inn.outline, out.outline, GR.companionGapCm * PT_CM);
      console.log(`   ${hex(els[i].fill ?? els[i].stroke)} x ${hex(els[j].fill ?? els[j].stroke)}  ` +
        `${r2((a.x1-a.x0)/PT_CM)}x${r2((a.y1-a.y0)/PT_CM)} vs ${r2((b.x1-b.x0)/PT_CM)}x${r2((b.y1-b.y0)/PT_CM)}  ` +
        `nested=${r2(nested)} diagR=${r2(dR)} areaR=${r2(aR)} insideFrac=${r2(pr.insideFrac)} runFrac1.5=${r2(pr.runFrac)} runFrac8=${r2(pr8.runFrac)}`);
    }
  });
  await doc.destroy();
}
