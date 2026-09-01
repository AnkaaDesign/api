/**
 * Sonda da SOLDA DE GLIFOS: por que uma palavra sai partida ao meio.
 *
 * Para um arquivo (ou trecho de nome) do acervo, imprime, por face:
 *  - os itens gerados, com cor, caixa e nº de subformas;
 *  - os objetos crus (glifos), com a folga real até o vizinho da direita;
 *  - o que `partGap` pede para cada um e o que o TETO (`maxPartGapCm`) corta;
 *  - se `alignedEnough` vetou o par.
 *
 * uso: node weld-probe.mjs <pasta> <trecho-do-nome> [--face N]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10;
const [CORPUS, NEEDLE] = process.argv.slice(2);
const walk = (d, out = []) => {
  for (const e of readdirSync(d).sort()) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.toLowerCase().endsWith('.pdf')) out.push(p);
  }
  return out;
};
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
const GR = { ...DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING ?? '{}') };
const r1 = (x) => Math.round(x * 10) / 10;
const hex = (c) => (c ? '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('') : 'null');
const ovl = (a0, a1, b0, b1) => {
  const span = Math.min(a1, b1) - Math.max(a0, b0);
  const smaller = Math.min(a1 - a0, b1 - b0);
  return smaller > 0 ? span / smaller : 0;
};

for (const f of walk(CORPUS)) {
  if (NEEDLE && !f.toLowerCase().includes(NEEDLE.toLowerCase())) continue;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const g = await readPageGeometry(page);
  console.log('\n### ' + f.split('/').pop());
  const rects = panelRects(g);
  rects.forEach((R, fi) => {
    const widthCm = Math.round((R.x1 - R.x0) / PT_CM), heightCm = Math.round((R.y1 - R.y0) / PT_CM);
    const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
    const { pieces } = classify(g, scale, GR);
    const built = buildItems(pieces, scale, GR);
    console.log(`\n-- face ${fi}: ${widthCm} x ${heightCm} cm, ${pieces.length} objetos, ${built.items.length} itens`);
    built.items.forEach((it, k) => {
      const objs = built.objects[k];
      const b = it.boxCm;
      const cols = [...new Set(objs.map((o) => hex(o.fill ?? o.stroke ?? null)))];
      console.log(`  [${k}] ${r1(b.x0)},${r1(b.y0)} .. ${r1(b.x1)},${r1(b.y1)}  ${r1(b.x1-b.x0)}x${r1(b.y1-b.y0)}cm  objs=${objs.length} partes=${it.parts.length} sub=${objs.reduce((n,o)=>n+o.outline.length,0)} cores=${cols.slice(0,3).join(',')}`);
    });
    // objetos crus ordenados por x, com folga ao vizinho da direita
    const els = pieces.map((p) => p.obj);
    const idx = els.map((_, i) => i).sort((a, b) => els[a].bbox.x0 - els[b].bbox.x0);
    console.log('  -- glifos (x0,y0..x1,y1 cm | h | partGap pedido/aplicado | folga p/ próximo do mesmo run)');
    for (let n = 0; n < idx.length; n++) {
      const i = idx[n];
      const o = els[i];
      const hPt = o.bbox.y1 - o.bbox.y0;
      const want = Math.max(GR.partGapCm * PT_CM, GR.textGapFactor * hPt);
      const got = Math.min(GR.maxPartGapCm * PT_CM, want);
      // vizinho da direita com maior sobreposição vertical
      let best = null;
      for (let m = n + 1; m < idx.length; m++) {
        const j = idx[m];
        const q = els[j];
        const vo = ovl(o.bbox.y0, o.bbox.y1, q.bbox.y0, q.bbox.y1);
        if (vo < 0.4) continue;
        const gap = (q.bbox.x0 - o.bbox.x1) / PT_CM;
        if (!best || gap < best.gap) best = { j, gap, vo };
        break;
      }
      const bx = { x0: (o.bbox.x0 - R.x0) / PT_CM, y0: (o.bbox.y0 - R.y0) / PT_CM, x1: (o.bbox.x1 - R.x0) / PT_CM, y1: (o.bbox.y1 - R.y0) / PT_CM };
      if (bx.x1 < -20 || bx.x0 > widthCm + 20 || bx.y1 < -20 || bx.y0 > heightCm + 20) continue;
      let nb = '';
      if (best) {
        const q = els[best.j];
        const avgGap = ((got + Math.min(GR.maxPartGapCm * PT_CM, Math.max(GR.partGapCm * PT_CM, GR.textGapFactor * (q.bbox.y1 - q.bbox.y0)))) / 2) / PT_CM;
        const al = ovl(o.bbox.x0, o.bbox.x1, q.bbox.x0, q.bbox.x1) >= GR.weldAlignFrac || ovl(o.bbox.y0, o.bbox.y1, q.bbox.y0, q.bbox.y1) >= GR.weldAlignFrac;
        nb = ` | prox folga=${r1(best.gap)} vo=${r1(best.vo*100)}% soldaSe<=${r1(avgGap)} ${best.gap<=avgGap?'SOLDA':'CORTA'}${al?'':' ALIGN-VETO'}`;
      }
      console.log(`   ${r1(bx.x0)},${r1(bx.y0)}..${r1(bx.x1)},${r1(bx.y1)} h=${r1(hPt/PT_CM)} sub=${o.outline.length} ${hex(o.fill ?? o.stroke ?? null)} pede=${r1(want/PT_CM)} usa=${r1(got/PT_CM)}${nb}`);
    }
  });
  await doc.destroy();
}
