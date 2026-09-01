/**
 * Corpus scan for the BAND / big concave ornament defect.
 *
 * Counts, over every face of every PDF:
 *   (a) wrap items with NOTHING to draw — `outlinePt` missing, empty, or with
 *       fewer than 3 points in every subpath (the overlay skips the rectangle
 *       fallback whenever `outline.length` is truthy, so a poly-but-no-points
 *       contour renders an invisible path);
 *   (a2) the DUAL failure: an item that bleeds on exactly one axis (or covers a
 *       big slice of the face) and is NOT flagged as a wrap, so it draws the
 *       bounding rectangle of a concave shape;
 *   (b) items whose bbox exceeds the face by more than 20% (area, or spill
 *       outside the panel rectangle);
 *   (c) faces where a single source path ends up in 3+ different items.
 *
 * Also reports the ink-fill ratio of each item (polygon area / bbox area): a
 * low ratio on a big item is the measurable signature of "the rectangle lies".
 *
 * Usage: node wrapscan.mjs <folder> [--json out.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, borderCrossings, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10;
const GR = DEFAULT_GROUPING;
const CORPUS = process.argv[2] ?? `${process.env.HOME}/layouts`;
const jsonAt = process.argv.indexOf('--json');
const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p); } return o; };
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

/** |shoelace| over every subpath — holes subtract because they wind the other way */
function polyArea(outline) {
  let a = 0;
  for (const poly of outline) {
    for (let i = 0; i + 1 < poly.length; i++) a += poly[i].x * poly[i + 1].y - poly[i + 1].x * poly[i].y;
    if (poly.length > 2) { const p = poly[poly.length - 1], q = poly[0]; a += p.x * q.y - q.x * p.y; }
  }
  return Math.abs(a) / 2;
}

const files = walk(CORPUS).sort();
const rows = [];
let nFaces = 0, nItems = 0, nWraps = 0, broken = 0;
const cnt = { aNoDraw: 0, aEmpty: 0, aDegenerate: 0, a2FalseRect: 0, bOversize: 0, bSpill: 0, cShattered: 0 };

for (const f of files) {
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const g = await readPageGeometry(page);
    const rects = panelRects(g);
    const short = f.slice(CORPUS.replace(/\/$/, '').length + 1);

    rects.forEach((R, fi) => {
      const W = (R.x1 - R.x0) / PT_CM, H = (R.y1 - R.y0) / PT_CM;
      const panel = { side: 'MOTORISTA', heightCm: Math.round(H), sections: [{ widthCm: Math.round(W), isDoor: false }] };
      const scale = { ptPerCm: PT_CM, panelPt: R };
      const faceArea = area(R);
      const { pieces } = classify(g, scale, GR);
      const built = buildItems(pieces, scale, GR);
      nFaces++;

      // --- (c) map every built piece back to the SOURCE path.
      // `splitDisjoint` keeps the very same poly array objects, so reference
      // identity recovers the origin without touching production code.
      const origOf = new Map();
      for (const o of g.objects) for (const poly of o.outline) if (!origOf.has(poly)) origOf.set(poly, o.index);
      const itemsOfSource = new Map();
      built.objects.forEach((objs, itemIdx) => {
        for (const o of objs) {
          const src = o.outline.length ? origOf.get(o.outline[0]) : undefined;
          if (src === undefined) continue;
          const set = itemsOfSource.get(src) ?? new Set();
          set.add(itemIdx);
          itemsOfSource.set(src, set);
        }
      });
      let worstShatter = 0, worstSrc = -1;
      for (const [src, set] of itemsOfSource) if (set.size > worstShatter) { worstShatter = set.size; worstSrc = src; }
      const shattered = worstShatter >= 3;
      if (shattered) cnt.cShattered++;

      const faceRow = { file: short, face: fi, W: Math.round(W), H: Math.round(H), items: built.items.length, wraps: built.wraps.length, shatter: worstShatter, shatterSrc: worstSrc, flags: [] };

      built.items.forEach((it, i) => {
        nItems++;
        if (it.bleeds) nWraps++;
        const o = it.outlinePt;
        const verts = o ? o.reduce((n, p) => n + p.length, 0) : 0;
        const drawablePolys = o ? o.filter((p) => p.length >= 3).length : 0;
        const ink = polyArea(o ?? []);
        const fill = area(it.bbox) > 0 ? ink / area(it.bbox) : 0;
        const cover = area(it.bbox) / faceArea;

        // (a) wrap with nothing to draw
        if (it.bleeds) {
          if (!o) { cnt.aNoDraw++; faceRow.flags.push(`a:item${i} SEM outlinePt`); }
          else if (!o.length) { cnt.aEmpty++; cnt.aNoDraw++; faceRow.flags.push(`a:item${i} outlinePt VAZIO`); }
          else if (!drawablePolys) { cnt.aDegenerate++; cnt.aNoDraw++; faceRow.flags.push(`a:item${i} contorno DEGENERADO (${o.length} polis/${verts} pts)`); }
        }

        // (a2) bleeds on exactly one axis, or covers a lot, yet draws a rectangle
        const oneAxis = it.bleedAxes.horizontal !== it.bleedAxes.vertical;
        if (!it.bleeds && (oneAxis || cover >= 0.15) && cover >= 0.08) {
          // the rectangle only lies when the ink does not fill it
          const inkRatio = (() => {
            const polys = built.objects[i].flatMap((x) => x.outline);
            return area(it.bbox) > 0 ? polyArea(polys) / area(it.bbox) : 1;
          })();
          if (inkRatio < 0.7) {
            cnt.a2FalseRect++;
            faceRow.flags.push(`a2:item${i} faixa cotada por CAIXA (cobre ${(cover * 100).toFixed(0)}%, tinta ${(inkRatio * 100).toFixed(0)}% da caixa, eixos ${it.bleedAxes.edges.join('+') || '-'})`);
          }
        }

        // (b) box bigger than the face
        if (cover > 1.2) { cnt.bOversize++; faceRow.flags.push(`b:item${i} caixa ${(cover * 100).toFixed(0)}% da face`); }
        const spillX = (Math.max(0, R.x0 - it.bbox.x0) + Math.max(0, it.bbox.x1 - R.x1)) / (R.x1 - R.x0);
        const spillY = (Math.max(0, R.y0 - it.bbox.y0) + Math.max(0, it.bbox.y1 - R.y1)) / (R.y1 - R.y0);
        if (spillX > 0.2 || spillY > 0.2) { cnt.bSpill++; faceRow.flags.push(`b:item${i} transborda ${(Math.max(spillX, spillY) * 100).toFixed(0)}% fora da face`); }
        void fill; void verts;
      });

      if (shattered) faceRow.flags.push(`c:caminho#${worstSrc} virou ${worstShatter} itens`);
      if (faceRow.flags.length) rows.push(faceRow);
    });
    await doc.destroy();
  } catch (e) {
    broken++;
    if (doc) await doc.destroy().catch(() => {});
  }
}

const severity = (r) => r.flags.filter((f) => f.startsWith('a:')).length * 100 + r.flags.filter((f) => f.startsWith('b:')).length * 50 + (r.shatter >= 3 ? r.shatter * 10 : 0) + r.flags.filter((f) => f.startsWith('a2:')).length * 5;
rows.sort((a, b) => severity(b) - severity(a));

console.log(`=== VARREDURA DE FAIXAS ===  ${files.length} PDFs, ${nFaces} faces, ${nItems} itens (${nWraps} wraps), ${broken} arquivos ilegiveis`);
console.log(`(a)  envelopamentos SEM contorno para desenhar : ${cnt.aNoDraw}   (ausente/vazio: ${cnt.aEmpty}, degenerado: ${cnt.aDegenerate})`);
console.log(`(a2) faixa concava cotada pela CAIXA (nao virou wrap) : ${cnt.a2FalseRect} itens`);
console.log(`(b)  caixa > 120% da face                     : ${cnt.bOversize} itens`);
console.log(`     caixa transborda >20% fora da face       : ${cnt.bSpill} itens`);
console.log(`(c)  faces em que UM caminho virou 3+ itens   : ${cnt.cShattered} de ${nFaces}`);
console.log(`\n-- 20 piores faces --`);
for (const r of rows.slice(0, 20)) {
  console.log(`  ${r.file} #${r.face} (${r.W}x${r.H}, ${r.items} itens)`);
  for (const fl of r.flags.slice(0, 5)) console.log(`      ${fl}`);
}
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ cnt, nFaces, nItems, nWraps, rows }, null, 1));
