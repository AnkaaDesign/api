/**
 * Auditoria da SOLDA DE GLIFOS no acervo inteiro.
 *
 * Responde três perguntas com número:
 *  1. quantos itens gerados são PEDAÇO DE PALAVRA (detector automático);
 *  2. quantos pares `weldAlignFrac` veta, e quantos desses eram da mesma linha;
 *  3. como se distribuem as folgas entre glifos de um mesmo run, e quanto
 *     falta para a solda alcançá-las.
 *
 * uso: node weld-audit.mjs <pasta> [--json <arq>] [--list <n>]
 *      LIB=/tmp/ldim-x  para auditar um motor remendado
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10;
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const CORPUS = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--json' && argv[argv.indexOf(a) - 1] !== '--list');
const JSONOUT = opt('--json', null);
const LIST = Number(opt('--list', 12));

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
const dist = (a, b) => (!a || !b ? Infinity : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
const ovl = (a0, a1, b0, b1) => {
  const span = Math.min(a1, b1) - Math.max(a0, b0);
  const smaller = Math.min(a1 - a0, b1 - b0);
  return smaller > 0 ? span / smaller : 0;
};
const gapOf = (a0, a1, b0, b1) => Math.max(0, Math.max(b0 - a1, a0 - b1));
const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
const r1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- detectores

/**
 * Este par de ITENS é uma palavra partida?
 *
 * Mesma cor, sobreposição vertical > 70%, folga horizontal menor que a altura
 * deles e AMBOS com mais de uma subforma — um traço solto não é sílaba.
 */
function isWordSplit(A, B) {
  if (dist(A.color, B.color) > GR.colorMergeDelta) return false;
  if (A.subs <= 1 || B.subs <= 1) return false;
  const a = A.box, b = B.box;
  const vo = ovl(a.y0, a.y1, b.y0, b.y1);
  if (vo <= 0.7) return false;
  const ha = a.y1 - a.y0, hb = b.y1 - b.y0;
  const dx = gapOf(a.x0, a.x1, b.x0, b.x1);
  const dy = gapOf(a.y0, a.y1, b.y0, b.y1);
  if (dy > 0) return false;              // empilhados não é palavra partida
  if (dx <= 0) return false;             // sobrepostos já são o mesmo item
  return dx < Math.min(ha, hb);
}

// --------------------------------------------------------------------- passe

const files = walk(CORPUS);
let nFaces = 0, nItems = 0;
let splitPairs = 0, facesWithSplit = 0, itemsInSplit = 0;
const worst = [];
// weldAlignFrac
let vetoes = 0, vetoSameLine = 0, vetoStacked = 0, vetoSameColor = 0, vetoCorner = 0, nearPairs = 0;
// distribuição de folgas em runs de glifos
const runGaps = [], runNeeded = [], runXH = [];
let runs = 0, runGlyphs = 0;
const perFile = [];

for (const f of files) {
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const g = await readPageGeometry(page);
    const short = f.split('/').pop();
    for (const R of panelRects(g)) {
      const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
      const { pieces } = classify(g, scale, GR);
      if (!pieces.length) continue;
      const built = buildItems(pieces, scale, GR);
      nFaces++;
      nItems += built.items.length;

      const info = built.items.map((it, k) => ({
        box: it.boxCm,
        subs: built.objects[k].reduce((n, o) => n + o.outline.length, 0),
        color: (() => { let best = null; for (const o of built.objects[k]) { const c = o.fill ?? o.stroke; if (!c) continue; const ar = (o.bbox.x1 - o.bbox.x0) * (o.bbox.y1 - o.bbox.y0); if (!best || ar > best.a) best = { a: ar, c }; } return best?.c ?? null; })(),
      }));
      let faceSplit = 0;
      const inSplit = new Set();
      for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
        if (isWordSplit(info[i], info[j])) { faceSplit++; inSplit.add(i); inSplit.add(j); }
      }
      if (faceSplit) { facesWithSplit++; splitPairs += faceSplit; itemsInSplit += inSplit.size; }
      worst.push({ file: short, split: faceSplit, items: built.items.length });

      // ---- weldAlignFrac: pares que a DISTÂNCIA permitiria
      const els = pieces.map((p) => p.obj);
      const boxes = els.map((o) => o.bbox);
      const gp = boxes.map((b) => Math.min(GR.maxPartGapCm * PT_CM, Math.max(GR.partGapCm * PT_CM, GR.textGapFactor * (b.y1 - b.y0))));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const reach = (gp[i] + gp[j]) / 2;
        if (gapOf(a.x0, a.x1, b.x0, b.x1) > reach || gapOf(a.y0, a.y1, b.y0, b.y1) > reach) continue;
        nearPairs++;
        const ox = ovl(a.x0, a.x1, b.x0, b.x1), oy = ovl(a.y0, a.y1, b.y0, b.y1);
        if (ox >= GR.weldAlignFrac || oy >= GR.weldAlignFrac) continue;
        vetoes++;
        const ca = els[i].fill ?? els[i].stroke ?? null, cb = els[j].fill ?? els[j].stroke ?? null;
        if (dist(ca, cb) <= GR.colorMergeDelta) vetoSameColor++;
        if (oy > 0.15) vetoSameLine++;         // partilham a linha, mas pouco
        else if (ox > 0.15) vetoStacked++;     // partilham a coluna
        else vetoCorner++;
      }

      // ---- runs de glifos: objetos que dividem a mesma linha de base
      const idx = boxes.map((_, i) => i).sort((x, y) => boxes[x].x0 - boxes[y].x0);
      const used = new Set();
      for (const seed of idx) {
        if (used.has(seed)) continue;
        const base = boxes[seed].y1, h0 = boxes[seed].y1 - boxes[seed].y0;
        const run = idx.filter((i) => !used.has(i) &&
          Math.abs(boxes[i].y1 - base) <= 0.18 * h0 &&
          (boxes[i].y1 - boxes[i].y0) / h0 >= 0.5 && (boxes[i].y1 - boxes[i].y0) / h0 <= 2.2);
        if (run.length < 4) continue;
        // corta o run onde a folga passa de 4x a mediana (outra coisa, não a linha)
        const gs = [];
        for (let n = 0; n + 1 < run.length; n++) gs.push((boxes[run[n + 1]].x0 - boxes[run[n]].x1) / PT_CM);
        const med = q(gs, 0.5);
        if (med < 0) continue;
        const keep = [run[0]];
        for (let n = 0; n < gs.length; n++) { if (gs[n] > Math.max(6, med * 4)) break; keep.push(run[n + 1]); }
        if (keep.length < 4) continue;
        for (const i of keep) used.add(i);
        runs++; runGlyphs += keep.length;
        const kg = [];
        for (let n = 0; n + 1 < keep.length; n++) kg.push((boxes[keep[n + 1]].x0 - boxes[keep[n]].x1) / PT_CM);
        const hs = keep.map((i) => (boxes[i].y1 - boxes[i].y0) / PT_CM);
        const xh = q(hs, 0.5);
        runXH.push(xh);
        for (const gg of kg) { runGaps.push(gg); runNeeded.push(gg / xh); }
      }
    }
    perFile.push(short);
  } catch (e) { /* ignora arquivo ilegível */ }
  finally { if (doc) await doc.destroy(); }
}

const P = (xs) => `p10 ${r1(q(xs,0.10))} p25 ${r1(q(xs,0.25))} p50 ${r1(q(xs,0.5))} p75 ${r1(q(xs,0.75))} p90 ${r1(q(xs,0.90))} p99 ${r1(q(xs,0.99))} max ${r1(Math.max(...xs))}`;

console.log(`=== AUDITORIA DA SOLDA ===  ${nFaces} faces, ${nItems} itens  (LIB=${LIB})`);
console.log(`    params: partGapCm=${GR.partGapCm} textGapFactor=${GR.textGapFactor} maxPartGapCm=${GR.maxPartGapCm} lockupGapCm=${GR.lockupGapCm} weldAlignFrac=${GR.weldAlignFrac}`);
console.log(`\n-- PALAVRA PARTIDA (mesma cor, sobrep. vert. >70%, folga < altura, ambos >1 subforma)`);
console.log(`   pares partidos           ${splitPairs}`);
console.log(`   itens envolvidos         ${itemsInSplit}  (${r1(100*itemsInSplit/nItems)}% dos itens)`);
console.log(`   faces com ao menos 1     ${facesWithSplit} de ${nFaces}  (${r1(100*facesWithSplit/nFaces)}%)`);
console.log(`   pares por face           ${r1(splitPairs/nFaces)}`);
console.log(`\n-- weldAlignFrac = ${GR.weldAlignFrac}`);
console.log(`   pares que a distância permitiria   ${nearPairs}`);
console.log(`   vetados pelo alinhamento           ${vetoes}  (${r1(100*vetoes/Math.max(1,nearPairs))}%)`);
console.log(`     dos vetados, mesma cor           ${vetoSameColor}`);
console.log(`     partilham a LINHA (oy>0.15)      ${vetoSameLine}   <- risco de vetar letra`);
console.log(`     partilham a COLUNA (ox>0.15)     ${vetoStacked}`);
console.log(`     só a quina                       ${vetoCorner}`);
console.log(`\n-- RUNS de glifos (>=4 na mesma linha de base): ${runs} runs, ${runGlyphs} glifos`);
if (runGaps.length) {
  console.log(`   folga entre glifos (cm)  ${P(runGaps)}`);
  console.log(`   folga / altura mediana do run  ${P(runNeeded)}`);
  console.log(`   altura mediana do run (cm)     ${P(runXH)}`);
  const cap = GR.maxPartGapCm, lk = GR.lockupGapCm;
  const reach = Math.max(cap, lk);
  console.log(`   alcance efetivo hoje = max(maxPartGapCm, lockupGapCm) = ${reach} cm`);
  console.log(`   folgas de run ACIMA do alcance: ${runGaps.filter((x) => x > reach).length} de ${runGaps.length} (${r1(100*runGaps.filter((x)=>x>reach).length/runGaps.length)}%)  <- cada uma parte um run`);
}
worst.sort((a, b) => b.split - a.split);
console.log(`\n-- ${LIST} piores faces por palavra partida`);
for (const w of worst.slice(0, LIST)) if (w.split) console.log(`   ${String(w.split).padStart(3)} pares / ${String(w.items).padStart(3)} itens   ${w.file}`);
if (JSONOUT) writeFileSync(JSONOUT, JSON.stringify({ nFaces, nItems, splitPairs, itemsInSplit, facesWithSplit, vetoes, nearPairs, vetoSameLine, vetoStacked, vetoCorner, vetoSameColor, runs, runGlyphs, runGaps, runNeeded, runXH, worst: worst.slice(0, 60) }, null, 1));
