/**
 * How much of a band's crossing the doctrine throws away.
 *
 * `pickCrossings` keys each candidate by `${item}:${edge}:${aCm === 0 ? "start"
 * : "end"}` — that is, by WHICH SIDE the dimension starts from, not by WHICH
 * BOUNDARY of the crossing produced it. When both boundaries of one crossing
 * are nearer the same corner (the normal case for a band that ends in the
 * middle of an edge), the two collapse onto one key and the SMALLER value wins.
 * The number that survives is the near lip of the band; the one that is thrown
 * away is where the band actually ends — which is what the designer writes.
 *
 * Also counts the "invisible rectangle": a selected item with no contour whose
 * drawn box has 2+ sides sitting on the face border (they hide under the panel
 * outline the PDF already draws, so the selection reads as nothing).
 *
 * Usage: node crossloss.mjs <folder>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, borderCrossings, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10, DIM = [0x33, 0x74, 0xa9], MINV = 3;
const GR = DEFAULT_GROUPING;
const CORPUS = process.argv[2] ?? `${process.env.HOME}/layouts`;
const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p); } return o; };
const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
const near = (a, b, t) => Math.abs(a - b) <= t;

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

/** the designer's resolved dimensions, in page pt */
function designerDims(g, items) {
  const blue = g.objects.filter((o) => o.stroke && near(o.stroke[0], DIM[0], 12) && near(o.stroke[1], DIM[1], 12) && near(o.stroke[2], DIM[2], 12));
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
    const target = v * PT_CM; let best = null;
    for (const ax of new Set((vert ? Vs : Hs).filter((s) => Math.abs(s[2] - (vert ? cx : cy)) < 45).map((s) => +s[2].toFixed(1)))) {
      const pts = [...new Set((vert ? Hs : Vs).filter((s) => s[0] - 6 <= ax && ax <= s[1] + 6).map((s) => +s[2].toFixed(1)))].sort((p, q) => p - q);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const err = Math.abs(pts[j] - pts[i] - target); if (!best || err < best.err) best = { err, ax, a: pts[i], b: pts[j] }; }
    }
    if (best && best.err < Math.max(6, target * 0.06)) out.push({ v, vert, ...best });
  }
  return out;
}

const files = walk(CORPUS).sort();
let nFaces = 0, nCross = 0, nCollide = 0, nKeptWrong = 0, nInvisible = 0, nItems = 0;
let refHitKept = 0, refHitLost = 0, refHitNeither = 0, nRefOnEdge = 0;
const worst = [];

for (const f of files) {
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const g = await readPageGeometry(page);
    const tc = await page.getTextContent();
    const ref = designerDims(g, tc.items);
    const short = f.slice(CORPUS.replace(/\/$/, '').length + 1);
    const rects = panelRects(g);

    rects.forEach((R, fi) => {
      const W = (R.x1 - R.x0) / PT_CM, H = (R.y1 - R.y0) / PT_CM;
      const panel = { side: 'MOTORISTA', heightCm: Math.round(H), sections: [{ widthCm: Math.round(W), isDoor: false }] };
      const scale = { ptPerCm: PT_CM, panelPt: R };
      const { pieces } = classify(g, scale, GR);
      const built = buildItems(pieces, scale, GR);
      const crossings = borderCrossings(built.objects, panel, scale, GR);
      nFaces++;

      // the designer's dimensions expressed in this face's frame
      const refFace = ref.map((d) => d.vert
        ? { axis: 'V', a: (d.a - R.y0) / PT_CM, b: (d.b - R.y0) / PT_CM, v: d.v, ax: (d.ax - R.x0) / PT_CM }
        : { axis: 'H', a: (d.a - R.x0) / PT_CM, b: (d.b - R.x0) / PT_CM, v: d.v, ax: (d.ax - R.y0) / PT_CM })
        .filter((d) => d.b > -20 && d.a < (d.axis === 'V' ? H : W) + 20 && d.ax > -70 && d.ax < (d.axis === 'V' ? W : H) + 70);

      built.items.forEach((it, i) => {
        nItems++;
        if (it.outlinePt?.length) return;
        const b = it.boxCm ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
        const sides = [Math.abs(b.x0 - 0) < 1, Math.abs(b.x1 - W) < 1, Math.abs(b.y0 - 0) < 1, Math.abs(b.y1 - H) < 1].filter(Boolean).length;
        const cover = (b.x1 - b.x0) * (b.y1 - b.y0) / (W * H);
        if (sides >= 2 && cover >= 0.08) nInvisible++;
      });

      for (const c of crossings) {
        nCross++;
        const lengthCm = c.edge === 'left' || c.edge === 'right' ? H : W;
        const cands = [];
        for (const boundary of [c.startCm, c.endCm]) {
          const fromStart = boundary, fromEnd = lengthCm - boundary;
          if (Math.min(fromStart, fromEnd) < MINV) continue;
          cands.push({ boundary, value: Math.min(fromStart, fromEnd), key: fromStart <= fromEnd ? 'start' : 'end' });
        }
        if (cands.length < 2) continue;
        if (cands[0].key !== cands[1].key) continue;
        nCollide++;
        const kept = cands[0].value <= cands[1].value ? cands[0] : cands[1];
        const lost = kept === cands[0] ? cands[1] : cands[0];
        nKeptWrong++;
        // did the designer write the LOST value on this edge?
        const axis = c.edge === 'left' || c.edge === 'right' ? 'V' : 'H';
        const matchesLost = refFace.some((d) => d.axis === axis && Math.abs(d.v - lost.value) <= 3);
        const matchesKept = refFace.some((d) => d.axis === axis && Math.abs(d.v - kept.value) <= 3);
        if (matchesLost || matchesKept) nRefOnEdge++;
        if (matchesLost && !matchesKept) { refHitLost++; worst.push({ file: short, face: fi, edge: c.edge, kept: kept.value, lost: lost.value, run: c.endCm - c.startCm }); }
        else if (matchesKept && !matchesLost) refHitKept++;
        else if (!matchesKept && !matchesLost) refHitNeither++;
      }
    });
    await doc.destroy();
  } catch { if (doc) await doc.destroy().catch(() => {}); }
}

console.log(`=== TRAVESSIA: a fronteira descartada ===  ${nFaces} faces, ${nItems} itens, ${nCross} travessias`);
console.log(`  travessias cujas DUAS fronteiras colidem na mesma chave : ${nCollide}  (${(nCollide / Math.max(1, nCross) * 100).toFixed(0)}% das travessias)`);
console.log(`  dessas, o projetista escreveu a DESCARTADA e nao a mantida : ${refHitLost}`);
console.log(`  dessas, o projetista escreveu a MANTIDA                    : ${refHitKept}`);
console.log(`  dessas, o projetista nao escreveu nenhuma das duas         : ${refHitNeither}`);
console.log(`\n=== QUADRO INVISIVEL ===`);
console.log(`  itens sem contorno cuja caixa tem 2+ lados na borda da face e cobre >=8%: ${nInvisible}`);
console.log(`\n-- 20 casos em que a cota certa foi a descartada --`);
for (const w of worst.slice(0, 20)) console.log(`   ${w.file} #${w.face} ${w.edge}: motor ${w.kept.toFixed(0)}, projetista ${w.lost.toFixed(0)} (trecho ${w.run.toFixed(0)} cm)`);
