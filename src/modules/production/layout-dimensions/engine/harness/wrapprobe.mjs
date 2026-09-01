/**
 * Wrap/band probe: why a big concave ornament draws no box and dimensions drift.
 *
 * For one PDF, per detected face, dumps:
 *  - the raw paths that survive `classify`, with bleed axes and cover fraction;
 *  - what `splitDisjoint` did to each of them (1 path -> N pieces);
 *  - the built items, flagging wraps with an EMPTY or missing `outlinePt`;
 *  - the companion profile (runFrac / insideFrac / sizeRatio) of the biggest
 *    cross-colour pairs, so we can see whether `isCompanionPiece` should fire;
 *  - the border crossings each item produces.
 *
 * Usage: node wrapprobe.mjs <pdf> [faceIndex]
 */
import { readFileSync } from 'node:fs';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, borderCrossings,
        DEFAULT_GROUPING, planDimensions, DEFAULT_DOCTRINE } = await import(`${LIB}/core.js`);
const { splitDisjoint } = await import(`${LIB}/grouping.js`);

const PT_CM = 72 / 2.54 / 10;
const GR = DEFAULT_GROUPING;

const hex = (c) => (c ? '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '   -   ');
const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
const diag = (r) => Math.hypot(r.x1 - r.x0, r.y1 - r.y0);

/** same rectangle sweep bench.mjs uses, so the faces match the gate */
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

/* --- local copies of the private helpers, to MEASURE what the engine decides --- */
function pointToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
function pointInsidePolys(polys, p) {
  let inside = false;
  for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function companionProfile(inner, outer, gapPt) {
  const samples = [];
  const total = inner.reduce((n, poly) => n + poly.length, 0);
  const stride = Math.max(1, Math.ceil(total / 200));
  for (const poly of inner) for (let i = 0; i < poly.length; i += stride) samples.push(poly[i]);
  if (!samples.length) return { runFrac: 0, insideFrac: 0 };
  let near = 0, inside = 0;
  for (const p of samples) {
    let best = Infinity;
    for (const poly of outer) { for (let i = 0; i + 1 < poly.length; i++) { const d = pointToSegment(p.x, p.y, poly[i], poly[i + 1]); if (d < best) best = d; if (best <= gapPt) break; } if (best <= gapPt) break; }
    if (best <= gapPt) near++;
    if (pointInsidePolys(outer, p)) inside++;
  }
  return { runFrac: near / samples.length, insideFrac: inside / samples.length };
}
function nestedFraction(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? (w * h) / smaller : 0;
}
function alignedEnough(a, b, frac) {
  const ov = (a0, a1, b0, b1) => { const s = Math.min(a1, b1) - Math.max(a0, b0); const m = Math.min(a1 - a0, b1 - b0); return m > 0 ? s / m : 0; };
  return ov(a.x0, a.x1, b.x0, b.x1) >= frac || ov(a.y0, a.y1, b.y0, b.y1) >= frac;
}
const colorDist = (a, b) => (!a || !b ? Infinity : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));

const file = process.argv[2];
const onlyFace = process.argv[3] !== undefined ? Number(process.argv[3]) : null;
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const g = await readPageGeometry(page);
const tc = await page.getTextContent();
const rects = panelRects(g);
console.log(`${file.split('/').pop()}  pagina ${g.width.toFixed(0)}x${g.height.toFixed(0)} pt  ${g.objects.length} objetos  ${rects.length} faces`);

rects.forEach((R, fi) => {
  if (onlyFace !== null && fi !== onlyFace) return;
  const W = (R.x1 - R.x0) / PT_CM, H = (R.y1 - R.y0) / PT_CM;
  const panel = { side: 'MOTORISTA', heightCm: Math.round(H), sections: [{ widthCm: Math.round(W), isDoor: false }] };
  const scale = { ptPerCm: PT_CM, panelPt: R };
  const cx = (v) => +((v - R.x0) / PT_CM).toFixed(1), cy = (v) => +((v - R.y0) / PT_CM).toFixed(1);
  console.log(`\n================ FACE #${fi}  ${W.toFixed(0)} x ${H.toFixed(0)} cm ================`);

  // ---- what classify keeps, and what splitDisjoint did to it
  const { pieces } = classify(g, scale, GR);
  const splitGapPt = GR.lockupGapCm * PT_CM;
  console.log(`\n-- pool de classify: ${pieces.length} pecas --`);
  console.log('  idx op        x0     y0     x1     y1   fill     stroke   subp  cover%  eixos            areaCm2');
  const sorted = [...pieces].sort((a, b) => area(b.obj.bbox) - area(a.obj.bbox));
  for (const p of sorted.slice(0, 25)) {
    const b = p.obj.bbox;
    console.log(`  ${String(p.obj.index).padStart(4)} ${p.obj.op.padEnd(6)} ${String(cx(b.x0)).padStart(6)} ${String(cy(b.y0)).padStart(6)} ${String(cx(b.x1)).padStart(6)} ${String(cy(b.y1)).padStart(6)}  ${hex(p.obj.fill).padEnd(8)} ${hex(p.obj.stroke).padEnd(8)} ${String(p.obj.outline.length).padStart(4)} ${(p.coversFrac * 100).toFixed(1).padStart(6)}  ${(p.bleedAxes.edges.join(',') || '-').padEnd(16)} ${(area(b) / (PT_CM * PT_CM)).toFixed(0).padStart(8)}${p.bleedAxes.horizontal ? ' H' : ''}${p.bleedAxes.vertical ? ' V' : ''}`);
  }

  // ---- splitDisjoint accounting on the raw geometry inside this face
  const panelArea = area(R);
  const tolPt = GR.bleedTouchCm * PT_CM;
  console.log(`\n-- splitDisjoint (folga ${GR.lockupGapCm} cm) sobre os caminhos grandes da face --`);
  for (const o of g.objects) {
    if (o.op === 'clip' || o.outline.length < 2) continue;
    const b = o.bbox;
    if (b.x1 < R.x0 || b.x0 > R.x1 || b.y1 < R.y0 || b.y0 > R.y1) continue;
    if (area(b) / panelArea < 0.02) continue;
    const parts = splitDisjoint([o], splitGapPt);
    if (parts.length < 2) continue;
    console.log(`  obj#${o.index} ${hex(o.fill)}/${hex(o.stroke)} caixa [${cx(b.x0)},${cy(b.y0)} .. ${cx(b.x1)},${cy(b.y1)}] ${o.outline.length} subformas -> ${parts.length} pecas`);
    parts.slice(0, 10).forEach((q, k) => console.log(`      p${k} [${cx(q.bbox.x0)},${cy(q.bbox.y0)} .. ${cx(q.bbox.x1)},${cy(q.bbox.y1)}] ${q.outline.length} subformas  ${(area(q.bbox) / (PT_CM * PT_CM)).toFixed(0)} cm2`));
  }

  // ---- built items
  const built = buildItems(pieces, scale, GR);
  console.log(`\n-- buildItems: ${built.items.length} itens (${built.wraps.length} wrap, ${built.stickers.length} adesivo) --`);
  built.items.forEach((it, i) => {
    const outlines = it.outlinePt;
    const verts = outlines ? outlines.reduce((n, p) => n + p.length, 0) : 0;
    const over = area(it.bbox) / panelArea;
    const flag = [];
    if (it.bleeds && (!outlines || !outlines.length)) flag.push('!! WRAP SEM CONTORNO');
    if (it.bleeds && outlines && outlines.length && verts < 6) flag.push('!! CONTORNO DEGENERADO');
    if (over > 1.2) flag.push('!! CAIXA > FACE+20%');
    console.log(`  #${String(i).padStart(2)} ${it.bleeds ? 'WRAP  ' : 'sticker'} [${it.boxCm.x0.toFixed(0)},${it.boxCm.y0.toFixed(0)} .. ${it.boxCm.x1.toFixed(0)},${it.boxCm.y1.toFixed(0)}] partes=${String(it.partsCm.length).padStart(3)} area=${it.areaCm2.toFixed(0).padStart(7)} cover=${(over * 100).toFixed(0)}% eixos=${(it.bleedAxes.edges.join(',') || '-').padEnd(20)} contorno=${outlines ? outlines.length + ' polis/' + verts + ' pts' : 'AUSENTE'} ${flag.join(' ')}`);
  });

  // ---- companion profile for the biggest cross-colour pairs
  console.log(`\n-- pares candidatos a companheiro (as 8 maiores pecas) --`);
  const big = sorted.slice(0, 8).map((p) => p.obj);
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const a = big[i], b = big[j];
    if (!a.outline.length || !b.outline.length) continue;
    const da = diag(a.bbox), db = diag(b.bbox);
    const ratio = Math.min(da, db) / Math.max(da, db);
    const [inner, outer] = da <= db ? [a, b] : [b, a];
    const prof = companionProfile(inner.outline, outer.outline, GR.companionGapCm * PT_CM);
    const cA = a.fill ?? a.stroke, cB = b.fill ?? b.stroke;
    const cd = colorDist(cA, cB);
    const nest = nestedFraction(a.bbox, b.bbox);
    const align = alignedEnough(a.bbox, b.bbox, GR.weldAlignFrac);
    const fires = ratio >= GR.companionSizeRatio && prof.insideFrac <= GR.companionInsideFrac && prof.runFrac >= GR.companionRunFrac;
    const verdict = !align ? 'ALINHAMENTO reprova' : cd <= GR.colorMergeDelta ? 'MESMA COR (funde)' : fires ? 'COMPANHEIRO (funde)' : 'separado';
    console.log(`  ${String(a.index).padStart(4)}(${hex(cA)}) x ${String(b.index).padStart(4)}(${hex(cB)})  dCor=${cd === Infinity ? 'inf' : cd.toFixed(0).padStart(3)}  razao=${ratio.toFixed(2)}  runFrac=${prof.runFrac.toFixed(2)}  insideFrac=${prof.insideFrac.toFixed(2)}  nested=${nest.toFixed(2)}  align=${align ? 'sim' : 'NAO'}  -> ${verdict}`);
  }

  // ---- crossings + planned dimensions
  const crossings = borderCrossings(built.objects, panel, scale, GR);
  console.log(`\n-- travessias: ${crossings.map((c) => `${c.edge} ${c.startCm.toFixed(0)}..${c.endCm.toFixed(0)} (item#${c.wrapIndex}, ${(c.endCm - c.startCm).toFixed(0)} cm)`).join(' | ') || '(nenhuma)'}`);
  const dims = planDimensions(panel, built.items, crossings, DEFAULT_DOCTRINE);
  console.log(`\n-- cotas geradas: ${dims.length} --`);
  for (const d of dims.slice(0, 40)) {
    console.log(`   item#${String(d.targetIndex).padStart(2)} ${d.axis} ${d.kind.padEnd(12)} ${d.aCm.toFixed(0).padStart(5)} -> ${d.bCm.toFixed(0).padStart(5)}  = ${d.valueCm.toFixed(0).padStart(4)} cm   linha em ${d.offsetCm.toFixed(0)}  ${d.target ?? ''}`);
  }
});

await doc.destroy();
