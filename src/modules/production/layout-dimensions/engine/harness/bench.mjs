/**
 * Portão de regressão do cotador.
 *
 * Roda o motor no acervo inteiro, mede tudo que interessa numa passada só e
 * compara com um json de referência. A pergunta que ele responde é uma:
 * "a mudança que acabei de fazer melhorou ou piorou?"
 *
 * Três famílias de métrica:
 *
 *  1. FIDELIDADE ao projetista — recall editorial, precisão do valor quando as
 *     duas âncoras existem, cobertura das âncoras. Vem de `run.mjs`, com as
 *     mesmas tolerâncias, para que os números continuem comparáveis.
 *
 *  2. LEGIBILIDADE do desenho — quantos pares de cota se CRUZAM por face e
 *     quantas pontas de extensão caem no VAZIO. Nenhuma das duas existia: são o
 *     alvo direto de quem for mexer no roteamento da linha de cota.
 *
 *  3. EXCESSO — quantas cotas o motor desenha contra quantas o projetista
 *     desenhou, na mesma face. O motor cota TODO item; o dono do caminhão
 *     reclama de "muitas medidas desnecessárias". Sem este número, apertar o
 *     filtro parece melhoria e some com cota boa.
 *
 * Uso:
 *   node bench.mjs <pasta> [--save] [--baseline <arquivo>] [--out <arquivo>]
 *                          [--top <n>] [--quiet]
 *
 * `--save` grava o resultado como nova referência (bench.baseline.json).
 * `GROUPING` / `DOCTRINE` sobrescrevem parâmetros, como em `run.mjs`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, borderCrossings,
        DEFAULT_GROUPING, planDimensions, DEFAULT_DOCTRINE } = await import(`${LIB}/core.js`);

// ---------------------------------------------------------------- argumentos

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const VALUED = new Set(['--baseline', '--out', '--top']);
const CORPUS = (() => {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { if (VALUED.has(argv[i])) i += 1; continue; }
    return argv[i];
  }
  return null;
})();
const BASELINE = opt('--baseline', new URL('./bench.baseline.json', import.meta.url).pathname);
const OUT = opt('--out', null);
const TOP = Number(opt('--top', 8));
const QUIET = flag('--quiet');
const SAVE = flag('--save');

if (!CORPUS || CORPUS.startsWith('--')) {
  console.error('uso: node bench.mjs <pasta-de-pdfs> [--save] [--baseline <arquivo>] [--out <arquivo>] [--top <n>]');
  process.exit(2);
}

// ------------------------------------------------------------------- comuns

const PT_CM = 72 / 2.54 / 10;
const DIM_RGB = [0x33, 0x74, 0xa9];

/** Ordenado: o portão tem de dar o mesmo número duas vezes seguidas. */
const walk = (d, out = []) => {
  for (const e of readdirSync(d).sort()) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.toLowerCase().endsWith('.pdf')) out.push(p);
  }
  return out;
};
const near = (a, b, t) => Math.abs(a - b) <= t;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);
const pct = (a, b) => (b ? (100 * a) / b : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---------------------------------------- leitura das cotas do PROJETISTA
// Cópia fiel de run.mjs: acha o rótulo azul, procura as extensões
// perpendiculares e escolhe o par cuja distância reproduz o número escrito.

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

/** Faces do arquivo: retângulos grandes que não estão dentro de outro. */
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

// ------------------------------------------------- geometria da cota desenhada
// A cota é três segmentos: a linha (de aCm a bCm, na altura offsetCm) e as duas
// extensões, que saem de tieCm — a ponta na tinta — e passam 2,5 cm da linha.
// A sobra de 2,5 cm é medida: p10 a p75 todos em 2,5.

const OVERSHOOT_CM = 2.5;
/** margem para não contar como cruzamento o encosto em T de duas cotas que
 *  compartilham a mesma âncora — isso é convergência, não sujeira. */
const CROSS_EPS_CM = 0.5;
/** lado da célula da grade de tinta, em cm — a ponta "encosta" se cair na
 *  célula do traço ou numa vizinha (tolerância efetiva de ~2 a 4 cm). */
const INK_CELL_CM = 2;
/** ponta a menos disto de uma borda da face conta como âncora de BORDA. */
const EDGE_TOL_CM = 1.5;

function segmentsOf(d) {
  const lo = Math.min(d.aCm, d.bCm), hi = Math.max(d.aCm, d.bCm);
  const dir = d.offsetCm >= d.tieCm ? 1 : -1;
  const end = d.offsetCm + dir * OVERSHOOT_CM;
  const e0 = Math.min(d.tieCm, end), e1 = Math.max(d.tieCm, end);
  if (d.axis === 'H') {
    return [
      { horiz: true, y: d.offsetCm, x0: lo, x1: hi, line: true },
      { horiz: false, x: d.aCm, y0: e0, y1: e1, line: false },
      { horiz: false, x: d.bCm, y0: e0, y1: e1, line: false },
    ];
  }
  return [
    { horiz: false, x: d.offsetCm, y0: lo, y1: hi, line: true },
    { horiz: true, y: d.aCm, x0: e0, x1: e1, line: false },
    { horiz: true, y: d.bCm, x0: e0, x1: e1, line: false },
  ];
}

function segCross(s1, s2) {
  if (s1.horiz === s2.horiz) return false; // paralelas não se cruzam
  const h = s1.horiz ? s1 : s2, v = s1.horiz ? s2 : s1;
  return h.x0 + CROSS_EPS_CM < v.x && v.x < h.x1 - CROSS_EPS_CM &&
         v.y0 + CROSS_EPS_CM < h.y && h.y < v.y1 - CROSS_EPS_CM;
}

/**
 * Pares de cota que se cruzam na face, em três severidades.
 *
 * A separação não é preciosismo: nas 187 faces medidas o projetista cruza
 * EXTENSÃO com extensão 986 vezes (0,81 por cota) e não parece incomodado — é
 * fio de cabelo. O que ele não faz é cruzar uma LINHA de cota: 33 casos de
 * linha × extensão e 2 de linha × linha em 1.210 cotas. Um portão que somasse
 * tudo puniria o roteador justamente por fazer o que o desenhista faz.
 *
 *  `all`    — qualquer par (só para acompanhar)
 *  `severe` — o cruzamento envolve ao menos uma LINHA de cota (o que conta)
 *  `line`   — linha contra linha, o X que se vê de longe
 */
function crossingPairs(dims, mode = 'all', sameItemOnly = false) {
  const segs = dims.map((d) => segmentsOf(d));
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (sameItemOnly && dims[i].targetIndex !== dims[j].targetIndex) continue;
    const hit = segs[i].some((a) => segs[j].some((b) => {
      if (!segCross(a, b)) return false;
      if (mode === 'line') return a.line && b.line;
      if (mode === 'severe') return a.line || b.line;
      return true;
    }));
    if (hit) n++;
  }
  return n;
}

/** As duas pontas da cota, em cm da face. */
function tipsOf(d) {
  return d.axis === 'H'
    ? [{ x: d.aCm, y: d.tieCm, along: d.aCm }, { x: d.bCm, y: d.tieCm, along: d.bCm }]
    : [{ x: d.tieCm, y: d.aCm, along: d.aCm }, { x: d.tieCm, y: d.bCm, along: d.bCm }];
}

/**
 * Grade da TINTA REAL da face.
 *
 * Não é a caixa da peça: a caixa sempre contém a ponta, por construção, e o
 * teste não diria nada. O que se quer saber é se a ponta da extensão encosta
 * em traço DESENHADO — que é o que faz o aplicador entender a que adesivo o
 * número se refere. Marca-se a célula de cada trecho de contorno.
 */
function buildInkGrid(polys, widthCm, heightCm) {
  const nx = Math.ceil(widthCm / INK_CELL_CM) + 2;
  const ny = Math.ceil(heightCm / INK_CELL_CM) + 2;
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

/**
 * A ponta caiu em quê?
 *
 * `edge`  — na borda da face: referência legítima, é de onde a cota parte.
 * `ink`   — em traço desenhado: a cota se explica sozinha.
 * `frame` — dentro da MOLDURA de uma imagem, sem traço embaixo. É o caso que a
 *           doutrina chama de "moldura, não contorno": metade dos logotipos
 *           entra como raster e a caixa declarada carrega a folga transparente.
 *           Sem recortar a tinta por pixel, a seta aponta para o vazio.
 * `void`  — nem borda, nem traço, nem moldura: a cota flutua.
 */
function tipClass(tip, d, widthCm, heightCm, grid, frameRects) {
  const limit = d.axis === 'H' ? widthCm : heightCm;
  if (Math.abs(tip.along) <= EDGE_TOL_CM || Math.abs(tip.along - limit) <= EDGE_TOL_CM) return 'edge';
  if (gridHas(grid, tip.x, tip.y)) return 'ink';
  for (const r of frameRects) {
    if (tip.x >= r.x0 - INK_CELL_CM && tip.x <= r.x1 + INK_CELL_CM &&
        tip.y >= r.y0 - INK_CELL_CM && tip.y <= r.y1 + INK_CELL_CM) return 'frame';
  }
  return 'void';
}

// ------------------------------------------------------------------ a passada

const t0 = Date.now();
const files = walk(CORPUS);
const GR = { ...DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING ?? '{}') };
const DO = { ...DEFAULT_DOCTRINE, ...JSON.parse(process.env.DOCTRINE ?? '{}') };

const errors = [];
const perFace = [];
const skipped = { semFace: 0, semCotaLegivel: 0 };
let nFaces = 0, nRef = 0, nGen = 0, nHit = 0;
const cov = { ambas: 0, uma: 0, nenhuma: 0 };
const cov2 = { ambas: 0, uma: 0, nenhuma: 0 };
const covValue = { bate: 0, difere: 0 };
const missWhy = {};
const extraKind = {};
const tips = { edge: 0, ink: 0, frame: 0, void: 0 };
let nVoidDims = 0, nCrossPairs = 0, nLineCrossPairs = 0, nSevereCrossPairs = 0, nOwnCrossPairs = 0, nFacesWithCross = 0;
let filesRead = 0;

for (const f of files) {
  const short = f.slice(CORPUS.replace(/\/$/, '').length + 1);
  let doc = null;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const g = await readPageGeometry(page);
    const tc = await page.getTextContent();
    filesRead++;

    const ref = designerDims(g, tc.items);
    const rects = panelRects(g);
    if (!rects.length) { skipped.semFace++; await doc.destroy(); continue; }
    if (ref.length < 2) { skipped.semCotaLegivel++; await doc.destroy(); continue; }

    // cada cota do projetista fica com a face cujo EIXO ela encosta
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
      const widthCm = Math.round((R.x1 - R.x0) / PT_CM);
      const heightCm = Math.round((R.y1 - R.y0) / PT_CM);
      const panel = { side: 'MOTORISTA', heightCm, sections: [{ widthCm, isDoor: false }] };
      const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };

      const { pieces } = classify(g, scale, GR);
      const built = buildItems(pieces, scale, GR);
      const elements = pieces.filter((p) => !p.bleedAxes.edges.length).map((p) => p.obj);
      const bleeds = pieces.filter((p) => p.bleedAxes.edges.length).map((p) => p.obj);
      const stickers = built.items;
      const crossings = borderCrossings(built.objects, panel, scale, GR);
      const dims = planDimensions(panel, stickers, crossings, DO);

      const refP = owned[i].map((d) => d.vert
        ? { axis: 'V', a: (d.a - R.y0) / PT_CM, b: (d.b - R.y0) / PT_CM, v: d.v }
        : { axis: 'H', a: (d.a - R.x0) / PT_CM, b: (d.b - R.x0) / PT_CM, v: d.v });

      // -------- recall editorial: mesmo eixo, âncoras a <= 4 cm, valor a <= 3 cm
      const used = new Set();
      let hits = 0;
      for (const gd of dims) for (let k = 0; k < refP.length; k++) {
        const r = refP[k];
        if (used.has(k) || r.axis !== gd.axis) continue;
        if (Math.abs(r.a - gd.aCm) <= 4 && Math.abs(r.b - gd.bCm) <= 4 && Math.abs(r.v - gd.valueCm) <= 3) { used.add(k); hits++; break; }
      }
      for (let k = 0; k < refP.length; k++) {
        if (used.has(k)) continue;
        const r = refP[k];
        const sameAxis = dims.filter((d) => d.axis === r.axis);
        const anchors = new Set();
        for (const d of sameAxis) { anchors.add(+d.aCm.toFixed(1)); anchors.add(+d.bCm.toFixed(1)); }
        const hasA = [...anchors].some((v) => Math.abs(v - r.a) <= 4);
        const hasB = [...anchors].some((v) => Math.abs(v - r.b) <= 4);
        const isEdge = Math.abs(r.a) < 3 || Math.abs(r.b - (r.axis === 'H' ? widthCm : heightCm)) < 3;
        const why = hasA && hasB ? 'par-nao-emitido' : (hasA || hasB) ? (isEdge ? 'faltou-ancora-de-arte' : 'faltou-uma-ancora') : 'nenhuma-ancora';
        missWhy[`${r.axis} ${why}`] = (missWhy[`${r.axis} ${why}`] ?? 0) + 1;
      }
      for (const d of dims) {
        const ok = refP.some((r) => r.axis === d.axis && Math.abs(r.a - d.aCm) <= 4 && Math.abs(r.b - d.bCm) <= 4);
        if (!ok) extraKind[d.kind] = (extraKind[d.kind] ?? 0) + 1;
      }

      // -------- cobertura das âncoras na geometria que o motor enxerga
      const candH = new Set([0, widthCm]), candV = new Set([0, heightCm]);
      for (const st of stickers) {
        candH.add(st.boxCm.x0); candH.add(st.boxCm.x1);
        candV.add(st.boxCm.y0); candV.add(st.boxCm.y1);
        for (const pt of st.partsCm) { candH.add(pt.x0); candH.add(pt.x1); candV.add(pt.y0); candV.add(pt.y1); }
      }
      for (const c of crossings) { candH.add(c.startCm); candH.add(c.endCm); }
      const bleedCm = bleeds.map((bl) => ({
        x0: (bl.bbox.x0 - R.x0) / PT_CM, x1: (bl.bbox.x1 - R.x0) / PT_CM,
        y0: (bl.bbox.y0 - R.y0) / PT_CM, y1: (bl.bbox.y1 - R.y0) / PT_CM,
      }));
      for (const bl of bleedCm) { candH.add(bl.x0); candH.add(bl.x1); candV.add(bl.y0); candV.add(bl.y1); }
      // pool ampliado: cada caminho isolado, sem agrupar (é o que o ímã manual vê)
      const candH2 = new Set(candH), candV2 = new Set(candV);
      for (const el of elements) {
        candH2.add((el.bbox.x0 - R.x0) / PT_CM); candH2.add((el.bbox.x1 - R.x0) / PT_CM);
        candV2.add((el.bbox.y0 - R.y0) / PT_CM); candV2.add((el.bbox.y1 - R.y0) / PT_CM);
      }
      const poolH = [...candH], poolV = [...candV], poolH2 = [...candH2], poolV2 = [...candV2];
      for (const r of refP) {
        const p1 = r.axis === 'H' ? poolH : poolV;
        const a = p1.some((c) => Math.abs(c - r.a) <= 3), b = p1.some((c) => Math.abs(c - r.b) <= 3);
        cov[a && b ? 'ambas' : (a || b) ? 'uma' : 'nenhuma']++;
        if (a && b) covValue[Math.abs(r.v - Math.round(r.b - r.a)) <= 2 ? 'bate' : 'difere']++;
        const p2 = r.axis === 'H' ? poolH2 : poolV2;
        const a2 = p2.some((c) => Math.abs(c - r.a) <= 3), b2 = p2.some((c) => Math.abs(c - r.b) <= 3);
        cov2[a2 && b2 ? 'ambas' : (a2 || b2) ? 'uma' : 'nenhuma']++;
      }

      // -------- legibilidade: cruzamentos e pontas no vazio
      const cross = crossingPairs(dims, 'all');
      const severeCross = crossingPairs(dims, 'severe');
      const lineCross = crossingPairs(dims, 'line');
      const ownCross = crossingPairs(dims, 'severe', true);
      const toFaceCm = (poly) => poly.map((q) => ({ x: (q.x - R.x0) / PT_CM, y: (q.y - R.y0) / PT_CM }));
      const inkPolys = [];
      const frameRects = [];
      for (const o of [...elements, ...bleeds]) {
        if (o.op === 'image') {
          frameRects.push({
            x0: (o.bbox.x0 - R.x0) / PT_CM, x1: (o.bbox.x1 - R.x0) / PT_CM,
            y0: (o.bbox.y0 - R.y0) / PT_CM, y1: (o.bbox.y1 - R.y0) / PT_CM,
          });
          continue;
        }
        for (const poly of o.outline) inkPolys.push(toFaceCm(poly));
      }
      const grid = buildInkGrid(inkPolys, widthCm, heightCm);
      let faceVoidTips = 0, faceVoidDims = 0, faceFrameTips = 0;
      for (const d of dims) {
        let bad = 0;
        for (const tip of tipsOf(d)) {
          const c = tipClass(tip, d, widthCm, heightCm, grid, frameRects);
          tips[c]++;
          if (c === 'void') bad++;
          if (c === 'frame') faceFrameTips++;
        }
        faceVoidTips += bad;
        if (bad) faceVoidDims++;
      }
      nVoidDims += faceVoidDims;
      nCrossPairs += cross;
      nSevereCrossPairs += severeCross;
      nOwnCrossPairs += ownCross;
      nLineCrossPairs += lineCross;
      if (severeCross) nFacesWithCross++;

      nFaces++; nRef += refP.length; nGen += dims.length; nHit += hits;
      perFace.push({
        file: short, face: i, w: widthCm, h: heightCm,
        ref: refP.length, gen: dims.length, hit: hits,
        stickers: stickers.length, crossings: crossings.length,
        crossPairs: cross, severeCrossPairs: severeCross, lineCrossPairs: lineCross,
        voidTips: faceVoidTips, voidDims: faceVoidDims, frameTips: faceFrameTips,
      });
    });
  } catch (err) {
    errors.push({ file: short, message: String(err && err.message ? err.message : err).slice(0, 200) });
  } finally {
    if (doc) { try { await doc.destroy(); } catch { /* já foi */ } }
  }
}

const elapsedMs = Date.now() - t0;

// ------------------------------------------------------------------ métricas

const genPerFace = perFace.map((p) => p.gen);
const refPerFace = perFace.map((p) => p.ref);
const covTotal = cov.ambas + cov.uma + cov.nenhuma;
const cov2Total = cov2.ambas + cov2.uma + cov2.nenhuma;
const tipTotal = tips.edge + tips.ink + tips.frame + tips.void;

const metrics = {
  // --- guarda: se estes mudam, a comparação com a referência não vale
  filesFound: files.length,
  filesRead,
  faces: nFaces,
  designerDims: nRef,
  // --- fidelidade
  recallPct: r1(pct(nHit, nRef)),
  precisionPct: r1(pct(nHit, nGen)),
  matchedDims: nHit,
  facesFullRecall: perFace.filter((p) => p.hit === p.ref).length,
  coverageBothPct: r1(pct(cov.ambas, covTotal)),
  coverageOnePct: r1(pct(cov.uma, covTotal)),
  coverageNonePct: r1(pct(cov.nenhuma, covTotal)),
  poolBothPct: r1(pct(cov2.ambas, cov2Total)),
  valueMatch: covValue.bate,
  valueMismatch: covValue.difere,
  valueAccuracyPct: r1(pct(covValue.bate, covValue.bate + covValue.difere)),
  // --- excesso
  generatedDims: nGen,
  genPerFaceMean: r2(nGen / Math.max(nFaces, 1)),
  genPerFaceMedian: median(genPerFace),
  refPerFaceMean: r2(nRef / Math.max(nFaces, 1)),
  refPerFaceMedian: median(refPerFace),
  excessRatio: r3(nGen / Math.max(nRef, 1)),
  excessPerFaceMedian: median(perFace.map((p) => p.gen - p.ref)),
  // --- legibilidade
  crossPairsTotal: nCrossPairs,
  crossPairsPerFace: r3(nCrossPairs / Math.max(nFaces, 1)),
  facesWithCrossPct: r1(pct(nFacesWithCross, nFaces)),
  severeCrossPairsTotal: nSevereCrossPairs,
  severeCrossPairsPerFace: r3(nSevereCrossPairs / Math.max(nFaces, 1)),
  // O que o operador VÊ: só as cotas do item escolhido aparecem juntas.
  ownCrossPairsTotal: nOwnCrossPairs,
  ownCrossPairsPerFace: r3(nOwnCrossPairs / Math.max(nFaces, 1)),
  lineCrossPairsTotal: nLineCrossPairs,
  lineCrossPairsPerFace: r3(nLineCrossPairs / Math.max(nFaces, 1)),
  voidTips: tips.void,
  voidTipPct: r1(pct(tips.void, tipTotal)),
  frameTips: tips.frame,
  frameTipPct: r1(pct(tips.frame, tipTotal)),
  inkTipPct: r1(pct(tips.ink, tipTotal)),
  edgeTipPct: r1(pct(tips.edge, tipTotal)),
  voidDims: nVoidDims,
  voidDimPct: r1(pct(nVoidDims, nGen)),
  // --- saúde
  errorFiles: errors.length,
};

const sourceHash = (() => {
  const dir = new URL('..', import.meta.url).pathname;
  const h = createHash('sha256');
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.ts')) continue;
    h.update(f).update(readFileSync(join(dir, f)));
  }
  return h.digest('hex').slice(0, 12);
})();

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    corpus: CORPUS,
    node: process.version,
    engineSourceSha256: sourceHash,
    grouping: GR,
    doctrine: DO,
    elapsedMs,
    msPerFile: r1(elapsedMs / Math.max(files.length, 1)),
  },
  metrics,
  breakdown: { coverage: cov, coveragePoolExpanded: cov2, value: covValue, missWhy, extraKind, skipped, tips },
  errors,
  perFace,
};

// --------------------------------------------------------------------- delta

const SPEC = [
  ['recallPct', 'up', 'recall editorial', '%', 0.05],
  ['valueAccuracyPct', 'up', 'valor certo c/ 2 âncoras', '%', 0.05],
  ['coverageBothPct', 'up', 'cobertura das 2 âncoras', '%', 0.05],
  ['facesFullRecall', 'up', 'faces 100% reproduzidas', '', 0],
  ['ownCrossPairsPerFace', 'down', 'cruzamentos GRAVES no MESMO item/face (o que se vê)', '', 0.005],
  ['severeCrossPairsPerFace', 'down', 'cruzamentos GRAVES/face (face inteira)', '', 0.005],
  ['crossPairsPerFace', 'down', 'pares de cota cruzados/face', '', 0.005],
  ['lineCrossPairsPerFace', 'down', 'linhas de cota cruzadas/face', '', 0.005],
  ['voidTipPct', 'down', 'pontas no vazio', '%', 0.05],
  ['excessRatio', 'down', 'cotas geradas ÷ do projetista', '×', 0.005],
  ['errorFiles', 'down', 'PDFs que quebram o motor', '', 0],
];
const INFO = [
  ['precisionPct', 'precisão bruta', '%'],
  ['poolBothPct', 'cobertura, pool ampliado', '%'],
  ['genPerFaceMean', 'cotas geradas por face', ''],
  ['refPerFaceMean', 'cotas do projetista por face', ''],
  ['frameTipPct', 'pontas na moldura de imagem (bench não rasteriza)', '%'],
  ['voidDimPct', 'cotas com >=1 ponta no vazio', '%'],
  ['inkTipPct', 'pontas na tinta', '%'],
];
const GUARD = ['filesFound', 'filesRead', 'faces', 'designerDims'];

const fmt = (v, unit) => (typeof v === 'number' ? `${v}${unit}` : String(v));
const pad = (s, n) => String(s).padEnd(n);

function printReport(base) {
  console.log(`\n=== BANCADA ===  ${files.length} PDFs, ${nFaces} faces em ${new Set(perFace.map((p) => p.file)).size} arquivos`);
  console.log(`    ${(elapsedMs / 1000).toFixed(1)} s  (${r1(elapsedMs / Math.max(files.length, 1))} ms/arquivo)   motor sha ${sourceHash}`);
  if (base) console.log(`    referência: ${base.meta.generatedAt}  motor sha ${base.meta.engineSourceSha256}`);

  const line = (key, label, unit, dir, eps) => {
    const now = metrics[key];
    if (!base) { console.log(`   ${pad(label, 30)} ${pad(fmt(now, unit), 12)}`); return null; }
    const was = base.metrics?.[key];
    if (typeof was !== 'number' || typeof now !== 'number') {
      console.log(`   ${pad(label, 30)} ${pad(fmt(now, unit), 12)} (novo)`);
      return null;
    }
    const d = r3(now - was);
    let mark = '=', verdict = 'neutro';
    if (dir && Math.abs(d) > eps) {
      const good = dir === 'up' ? d > 0 : d < 0;
      mark = good ? '+' : '!';
      verdict = good ? 'melhorou' : 'piorou';
    }
    const sign = d > 0 ? `+${d}` : `${d}`;
    console.log(`   ${mark} ${pad(label, 28)} ${pad(fmt(now, unit), 12)} era ${pad(fmt(was, unit), 12)} ${pad(sign, 9)} ${verdict}`);
    return verdict;
  };

  console.log('\n-- PORTÃO --');
  const verdicts = [];
  for (const [key, dir, label, unit, eps] of SPEC) {
    const v = line(key, label, unit, dir, eps);
    if (v) verdicts.push([label, v]);
  }
  console.log('\n-- informativo (não conta no veredito) --');
  for (const [key, label, unit] of INFO) line(key, label, unit, null, 0);

  console.log('\n-- guarda (tem de ficar igual, senão a comparação não vale) --');
  let guardBroke = false;
  for (const key of GUARD) {
    const now = metrics[key], was = base?.metrics?.[key];
    const changed = base && typeof was === 'number' && was !== now;
    if (changed) guardBroke = true;
    console.log(`   ${changed ? '!' : ' '} ${pad(key, 28)} ${pad(now, 12)}${base ? ` era ${was}` : ''}`);
  }

  if (errors.length) {
    console.log(`\n-- ${errors.length} PDF(s) QUEBRAM o motor --`);
    for (const e of errors) console.log(`   ${e.file}\n      ${e.message}`);
  } else {
    console.log('\n   nenhum PDF quebra o motor.');
  }

  if (TOP > 0) {
    console.log(`\n-- ${TOP} piores faces por cruzamento --`);
    for (const p of [...perFace].sort((a, b) => b.severeCrossPairs - a.severeCrossPairs || b.voidTips - a.voidTips).slice(0, TOP)) {
      console.log(`   ${pad(`${p.severeCrossPairs} graves`, 9)} ${pad(`${p.voidTips} vazio`, 10)} ${pad(`gen ${p.gen}/ref ${p.ref}`, 16)} ${p.file} #${p.face}`);
    }
  }

  if (base) {
    const worse = verdicts.filter(([, v]) => v === 'piorou');
    const better = verdicts.filter(([, v]) => v === 'melhorou');
    console.log('\n=== VEREDITO ===');
    if (guardBroke) {
      console.log('   INCONCLUSIVO — a base mudou (corpus, leitura de PDF ou extração das cotas do projetista).');
      console.log('   Refaça a referência antes de julgar a mudança.');
    } else if (!better.length && !worse.length) {
      console.log('   NEUTRO — nenhuma métrica do portão se moveu.');
    } else if (!worse.length) {
      console.log(`   MELHOROU — ${better.length} métrica(s) para cima, nenhuma para baixo:`);
      for (const [l] of better) console.log(`      + ${l}`);
    } else if (!better.length) {
      console.log(`   PIOROU — ${worse.length} métrica(s) para baixo:`);
      for (const [l] of worse) console.log(`      ! ${l}`);
    } else {
      console.log(`   MISTO — ${better.length} melhorou, ${worse.length} piorou. Decida a troca:`);
      for (const [l] of better) console.log(`      + ${l}`);
      for (const [l] of worse) console.log(`      ! ${l}`);
    }
  } else {
    console.log('\n   sem referência para comparar. Rode com --save para gravar esta como referência.');
  }
}

let base = null;
if (existsSync(BASELINE)) {
  try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); }
  catch (e) { console.error(`referência ilegível (${BASELINE}): ${e.message}`); }
}
if (!QUIET) printReport(base);

if (OUT) { writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`); console.log(`\njson em ${OUT}`); }
if (SAVE) { writeFileSync(BASELINE, `${JSON.stringify(report, null, 2)}\n`); console.log(`\nreferência gravada em ${BASELINE}`); }
