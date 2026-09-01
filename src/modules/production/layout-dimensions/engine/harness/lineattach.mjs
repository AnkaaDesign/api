/**
 * O voto do projetista sobre o VIZINHO PEQUENO.
 *
 * Acha, no acervo, os pares (peça pequena, run) que estão na MESMA LINHA — a
 * pequena inteiramente antes ou depois do run no eixo de escrita, dividindo a
 * faixa vertical dele — e pergunta ao desenho do projetista de que lado ele
 * cotou:
 *
 *   `uniao`  — a âncora cai na aresta EXTERNA da pequena (a que só existe se
 *              as duas forem UM adesivo). Voto a favor de anexar.
 *   `costura`— a âncora cai na aresta do run virada para a pequena (o vão
 *              entre as duas). Voto a favor de separar.
 *
 * Também separa a classe SOBRESCRITA (o ®, o DDD) da classe LINHA DE BASE
 * (o ícone, o "www.", o ".com.br"), porque a doutrina trata o ® como item
 * próprio em alguns layouts e a pergunta é se isso se mede.
 *
 * Uso: node lineattach.mjs <pasta> [--top 20]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10;
const DIM_RGB = [0x33, 0x74, 0xa9];
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = argv.find((a) => !a.startsWith('--'));
const GR = { ...DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING ?? '{}') };
const near = (a, b, t) => Math.abs(a - b) <= t;

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

/**
 * Pares (pequena, run) na MESMA LINHA.
 *
 * Os testes são os da regra proposta, sem nenhum deles apertado: a pequena tem
 * de estar LATERALMENTE fora do run (é o que impede o HORTIFRUTI de se fundir
 * com a maçã, que o contém), dividir a faixa vertical dele e apoiar-se na
 * mesma linha.
 */
const BAND_FRAC = 0.8;      // da altura da PEQUENA dentro da faixa do run
const RUN_BAND_FRAC = 0.4;  // da altura do RUN coberta pela pequena
const GAP_FRAC = Number(process.env.GAP_FRAC ?? 1.2);       // folga lateral, em alturas da menor
const GAP_MAX_CM = Number(process.env.GAP_MAX_CM ?? 999);   // teto absoluto
const AREA_FRAC = 0.7;      // a pequena é mesmo menor

function linePairs(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = 0; j < items.length; j++) {
    if (i === j) continue;
    const P = items[i].boxCm, R = items[j].boxCm;
    if (items[i].bleeds || items[j].bleeds) continue;
    if (items[i].areaCm2 > items[j].areaCm2 * AREA_FRAC) continue;
    const ph = P.y1 - P.y0, rh = R.y1 - R.y0;
    // lateral: as faixas horizontais NÃO se sobrepõem
    const gapX = Math.max(P.x0 - R.x1, R.x0 - P.x1);
    if (gapX <= 0) continue;
    if (gapX > GAP_FRAC * Math.min(ph, rh) || gapX > GAP_MAX_CM) continue;
    const band = Math.min(P.y1, R.y1) - Math.max(P.y0, R.y0);
    if (band < BAND_FRAC * ph || band < RUN_BAND_FRAC * rh) continue;
    const side = P.x1 <= R.x0 ? 'L' : 'R';
    const baseGap = Math.abs(P.y1 - R.y1) / rh;   // linha de base compartilhada?
    const topGap = Math.abs(P.y0 - R.y0) / rh;
    out.push({ i, j, P, R, ph, rh, gapX, side, baseGap, topGap,
      pa: items[i].areaCm2, ra: items[j].areaCm2,
      klass: baseGap <= 0.15 ? 'base' : topGap <= 0.15 ? 'topo' : 'meio' });
  }
  // um run por pequena: o mais próximo
  const bestOf = new Map();
  for (const p of out) {
    const k = p.i;
    if (!bestOf.has(k) || p.gapX < bestOf.get(k).gapX) bestOf.set(k, p);
  }
  return [...bestOf.values()];
}

const files = walk(DIR);
const votes = { uniao: 0, costura: 0, mudo: 0 };
const byClass = {};
const byGap = {};
const byH = {};
const examples = [];
let nPairs = 0, nFaces = 0, nFiles = 0;
const gapStat = [], hRatio = [], aRatio = [];

for (const f of files) {
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const g = await readPageGeometry(page);
    const tc = await page.getTextContent();
    const rects = panelRects(g);
    if (!rects.length) { await doc.destroy(); continue; }
    nFiles++;
    const ref = designerDims(g, tc.items);
    rects.forEach((R) => {
      nFaces++;
      const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
      const { pieces } = classify(g, scale, GR);
      const built = buildItems(pieces, scale, GR);
      const pairs = linePairs(built.items);
      if (!pairs.length) return;
      // âncoras horizontais do projetista nesta face
      const anchors = [];
      for (const d of ref) {
        if (d.vert) continue;
        const a = (d.a - R.x0) / PT_CM, b = (d.b - R.x0) / PT_CM;
        const ax = (d.ax - R.y0) / PT_CM;
        const W = (R.x1 - R.x0) / PT_CM, H = (R.y1 - R.y0) / PT_CM;
        if (b < -30 || a > W + 30 || ax < -80 || ax > H + 80) continue;
        anchors.push(a, b);
      }
      for (const p of pairs) {
        nPairs++;
        gapStat.push(p.gapX); hRatio.push(p.ph / p.rh); aRatio.push(p.pa / p.ra);
        const outer = p.side === 'L' ? p.P.x0 : p.P.x1;   // aresta da UNIÃO
        const seam = p.side === 'L' ? p.R.x0 : p.R.x1;    // aresta do RUN sozinho
        const hitOuter = anchors.some((v) => Math.abs(v - outer) <= 3);
        const hitSeam = anchors.some((v) => Math.abs(v - seam) <= 3);
        const vote = hitOuter && !hitSeam ? 'uniao' : hitSeam && !hitOuter ? 'costura' : 'mudo';
        votes[vote]++;
        byClass[p.klass] = byClass[p.klass] ?? { uniao: 0, costura: 0, mudo: 0, n: 0 };
        byClass[p.klass][vote]++; byClass[p.klass].n++;
        const gb = p.gapX <= 3 ? '0-3' : p.gapX <= 6 ? '3-6' : p.gapX <= 10 ? '6-10' : p.gapX <= 20 ? '10-20' : '20+';
        byGap[gb] = byGap[gb] ?? { uniao: 0, costura: 0, mudo: 0, n: 0 };
        byGap[gb][vote]++; byGap[gb].n++;
        const hb = p.ph <= 20 ? 'h<=20' : p.ph <= 40 ? 'h20-40' : p.ph <= 80 ? 'h40-80' : 'h>80';
        byH[hb] = byH[hb] ?? { uniao: 0, costura: 0, mudo: 0, n: 0 };
        byH[hb][vote]++; byH[hb].n++;
        if (vote !== 'mudo' && examples.length < 40) {
          examples.push(`${vote.padEnd(8)} ${p.klass.padEnd(5)} peq ${(p.P.x1 - p.P.x0).toFixed(0)}x${p.ph.toFixed(0)} run ${(p.R.x1 - p.R.x0).toFixed(0)}x${p.rh.toFixed(0)} folga ${p.gapX.toFixed(1)}  ${f.split('/').pop().slice(0, 46)}`);
        }
      }
    });
    await doc.destroy();
  } catch { try { await doc?.destroy(); } catch { /* */ } }
}

const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] : 0);
console.log(`${nFiles} arquivos, ${nFaces} faces, ${nPairs} pares (pequena, run) na mesma linha`);
console.log(`folga lateral: p25=${q(gapStat, .25).toFixed(1)} p50=${q(gapStat, .5).toFixed(1)} p75=${q(gapStat, .75).toFixed(1)} p90=${q(gapStat, .9).toFixed(1)} cm`);
console.log(`altura pequena/run: p10=${q(hRatio, .1).toFixed(2)} p50=${q(hRatio, .5).toFixed(2)} p90=${q(hRatio, .9).toFixed(2)}`);
console.log(`área pequena/run:  p10=${q(aRatio, .1).toFixed(2)} p50=${q(aRatio, .5).toFixed(2)} p90=${q(aRatio, .9).toFixed(2)}`);
console.log(`\nVOTO DO PROJETISTA: união ${votes.uniao} · costura ${votes.costura} · mudo (não cotou nem um nem outro) ${votes.mudo}`);
for (const [k, v] of Object.entries(byClass)) {
  console.log(`  classe ${k.padEnd(5)} n=${String(v.n).padStart(4)}  união ${String(v.uniao).padStart(3)}  costura ${String(v.costura).padStart(3)}  mudo ${String(v.mudo).padStart(4)}`);
}
console.log('por FOLGA lateral (cm):');
for (const k of ['0-3','3-6','6-10','10-20','20+']) { const v = byGap[k]; if (v) console.log(`  ${k.padEnd(6)} n=${String(v.n).padStart(4)}  uniao ${String(v.uniao).padStart(3)}  costura ${String(v.costura).padStart(3)}  mudo ${String(v.mudo).padStart(4)}`); }
console.log('por ALTURA da pequena (cm):');
for (const k of ['h<=20','h20-40','h40-80','h>80']) { const v = byH[k]; if (v) console.log(`  ${k.padEnd(6)} n=${String(v.n).padStart(4)}  uniao ${String(v.uniao).padStart(3)}  costura ${String(v.costura).padStart(3)}  mudo ${String(v.mudo).padStart(4)}`); }
console.log('\n-- exemplos com voto --');
examples.forEach((e) => console.log('  ' + e));
