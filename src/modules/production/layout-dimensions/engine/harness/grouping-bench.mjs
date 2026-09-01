/**
 * Portão de regressão do AGRUPAMENTO.
 *
 * `bench.mjs` responde "o motor reproduziu a cota que o projetista desenhou?".
 * Esta bancada responde outra pergunta, que aquela quase não enxerga: **o que o
 * motor chama de UM adesivo é mesmo um adesivo?** Palavra partida ao meio,
 * ícone descolado do texto, faixa picada em três, item que engole o vizinho —
 * defeitos de agrupamento, não de medida.
 *
 * Duas fontes de verdade, deliberadamente independentes:
 *
 *  1. AS COTAS DO PROJETISTA. A ponta de cada linha de extensão encosta numa
 *     peça real. Se a ponta cai no MEIO de um item nosso, longe de qualquer
 *     borda dele, aquele item é grande demais — engoliu a peça que o projetista
 *     estava apontando. Se o projetista cota a MESMA peça pelos dois lados
 *     (esquerda da face -> peça, peça -> direita da face) e as duas pontas caem
 *     em itens DIFERENTES nossos, aquela peça foi picada.
 *
 *  2. A PRÓPRIA GEOMETRIA. Seis detectores que não dependem de cota nenhuma e
 *     por isso rodam em toda face, inclusive nas 100+ que o projetista não
 *     cotou de forma legível. Cada um com definição fechada e contagem.
 *
 * Uso:
 *   node grouping-bench.mjs <pasta> [--save] [--baseline <arq>] [--out <arq>]
 *                                   [--top <n>] [--only <trecho>] [--quiet]
 *
 * `GROUPING` / `DOCTRINE` sobrescrevem parâmetros, como em `bench.mjs`.
 * NÃO toca em `bench.baseline.json`: a referência daqui é
 * `grouping.baseline.json`.
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
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const VALUED = new Set(['--baseline', '--out', '--top', '--only']);
const CORPUS = (() => {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { if (VALUED.has(argv[i])) i += 1; continue; }
    return argv[i];
  }
  return null;
})();
const BASELINE = opt('--baseline', new URL('./grouping.baseline.json', import.meta.url).pathname);
const OUT = opt('--out', null);
const TOP = Number(opt('--top', 20));
const ONLY = opt('--only', null);
const QUIET = flag('--quiet');
const SAVE = flag('--save');

if (!CORPUS || CORPUS.startsWith('--')) {
  console.error('uso: node grouping-bench.mjs <pasta-de-pdfs> [--save] [--baseline <arq>] [--out <arq>] [--top <n>] [--only <trecho>]');
  process.exit(2);
}

// -------------------------------------------------------------- os limiares
//
// Todo número aqui é limiar de DETECÇÃO, não de motor. Mudar um muda a régua e
// invalida a comparação com a referência — por isso vão gravados no `meta`.

const TH = {
  /** palavra partida: sobreposição vertical mínima entre os dois pedaços */
  splitOverlapFrac: 0.7,
  /** palavra partida: o vão tem de ser menor que ESTE fator da altura deles */
  splitGapHeightFactor: 1.0,
  /** palavra partida: altura mínima, para não contar respingo */
  splitMinHeightCm: 4,
  /** órfão: fração máxima da área do vizinho maior */
  orphanAreaFrac: 0.5,
  /** órfão: vão máximo, ou metade da própria altura se for maior */
  orphanGapCm: 3,
  /** órfão: quanto da própria altura tem de caber na faixa do vizinho */
  orphanBandFrac: 0.8,
  /** monstro: fração da face que a maior dimensão do item não pode passar */
  monsterSpanFrac: 0.55,
  /** monstro: número de cores distintas acima do qual o item é suspeito */
  monsterColors: 3,
  /** peça picada: distância de contorno abaixo da qual duas formas se encostam */
  touchCm: 1.5,
  /** peça picada: sobreposição mínima de caixa para valer o teste de contorno */
  cutOverlapFrac: 0.25,
  /** grande demais: distância mínima de TODA borda do item para a ponta contar
   *  como "no meio dele" */
  deepInsideCm: 10,
  /** grande demais / picado: tolerância para a ponta "encostar" numa borda */
  edgeTolCm: 4,
  /** picado: ponta a menos disto de uma borda da face é âncora de borda */
  faceEdgeTolCm: 3,
  /** picado: sobreposição de faixa para o par esquerda/direita valer */
  pairBandFrac: 0.5,
  /** grade de contorno, em cm */
  cellCm: 1,
  /** empilhado: a fileira estreita tem de cobrir ao menos ISTO da mais larga */
  rowCoverFrac: 0.7,
  /** empilhado: abaixo disto a fileira é ornamento (®, acento), não linha */
  rowMinCoverFrac: 0.25,
  /** empilhado: altura mínima de uma fileira, em cm */
  rowMinHeightCm: 3,
  /** empilhado: glifos mínimos numa fileira. Sem isto o acento do "é" e o til
   *  do "Amigão" viram "fileira estreita" — são uma e duas subformas. */
  rowMinAtoms: 3,
  /** empilhado: passo do histograma de linha, em cm */
  rowBinCm: 0.5,
  /** degradê: fração do contorno do menor que tem de cair DENTRO do maior */
  gradientInsideFrac: 0.25,
  /** degradê: razão de diagonais mínima — porte comparável, não texto sobre faixa */
  gradientDiagRatio: 0.5,
  /** degradê: razão de ÁREAS mínima. A diagonal sozinha deixa passar
   *  "FRIGORÍFICO" sob o rabo do "Carajás" (0,507) — a área não deixa (0,08). */
  gradientAreaRatio: 0.35,
  /** degradê: pontos amostrados no contorno de cada item, para medir a folga */
  gradientContourPts: 480,
  /** degradê: de quantos em quantos desses pontos se testa ponto-em-polígono */
  gradientInsideStride: 4,
};

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
const pct = (a, b) => (b ? (100 * a) / b : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);

// ---------------------------------------- leitura das cotas do PROJETISTA
// Cópia fiel de `evidence.mjs`: o rótulo azul, o par de extensões que reproduz
// o número escrito, e a EXTENSÃO de cada âncora — que é o que dá a ponta.

function blueSegments(g) {
  const blue = g.objects.filter((o) => o.stroke &&
    near(o.stroke[0], DIM_RGB[0], 12) && near(o.stroke[1], DIM_RGB[1], 12) && near(o.stroke[2], DIM_RGB[2], 12));
  const hor = [], ver = [];
  for (const o of blue) for (const poly of o.outline) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    if (Math.abs(a.y - b.y) < 0.6 && Math.abs(a.x - b.x) >= 1)
      hor.push({ lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), at: (a.y + b.y) / 2 });
    else if (Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) >= 1)
      ver.push({ lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), at: (a.x + b.x) / 2 });
  }
  return { hor, ver };
}

function designerDims(g, items) {
  const { hor, ver } = blueSegments(g);
  const out = [];
  for (const t of items) {
    const v = Number(String(t.str).replace(/cm/gi, '').trim().replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0 || v > 3000) continue;
    const m = t.transform, vert = Math.abs(m[1]) > Math.abs(m[0]);
    const cx = m[4] + (vert ? 0 : t.width / 2), cy = g.height - m[5] - (vert ? t.width / 2 : 0);
    const target = v * PT_CM;
    const lineSegs = vert ? ver : hor, extSegs = vert ? hor : ver;
    let best = null;
    for (const ax of new Set(lineSegs.filter((s) => Math.abs(s.at - (vert ? cx : cy)) < 45).map((s) => +s.at.toFixed(1)))) {
      const pts = [...new Set(extSegs.filter((s) => s.lo - 6 <= ax && ax <= s.hi + 6).map((s) => +s.at.toFixed(1)))].sort((p, q) => p - q);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const err = Math.abs(pts[j] - pts[i] - target);
        if (!best || err < best.err) best = { err, ax, a: pts[i], b: pts[j] };
      }
    }
    if (!best || best.err >= Math.max(6, target * 0.06)) continue;
    const extentOf = (anchor) => {
      const hit = extSegs.filter((s) => Math.abs(s.at - anchor) < 0.8 && s.lo - 6 <= best.ax && best.ax <= s.hi + 6);
      if (!hit.length) return null;
      return { lo: Math.min(...hit.map((s) => s.lo)), hi: Math.max(...hit.map((s) => s.hi)) };
    };
    out.push({ v, vert, ax: best.ax, a: best.a, b: best.b, extA: extentOf(best.a), extB: extentOf(best.b) });
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

// ------------------------------------------------------- utilidades de forma

const wOf = (b) => b.x1 - b.x0;
const hOf = (b) => b.y1 - b.y0;
const overlap1d = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const gap1d = (a0, a1, b0, b1) => Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
const colorDist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);

/** Cores do item, cada uma com a área que ocupa. Imagem não tem cor. */
function colorsOf(objs) {
  const buckets = [];
  for (const o of objs) {
    const c = o.fill ?? o.stroke;
    if (!c) continue;
    const area = Math.max(1, (o.bbox.x1 - o.bbox.x0) * (o.bbox.y1 - o.bbox.y0));
    const hit = buckets.find((b) => colorDist(b.color, c) <= DEFAULT_GROUPING.colorMergeDelta);
    if (hit) { hit.area += area; hit.objs.push(o); } else buckets.push({ color: c, area, objs: [o] });
  }
  buckets.sort((a, b) => b.area - a.area);
  return buckets;
}

/**
 * Grade de CONTORNO de um conjunto de objetos, em células de `TH.cellCm`.
 *
 * Serve a uma pergunta só: duas formas se ENCOSTAM? A caixa não responde —
 * "HORTIFRUTI" cai 99% dentro da caixa da maçã sem tocar nela, porque a maçã é
 * um traço em C e o texto vive no vão. Marcar o traço responde.
 */
function inkCells(objs, R) {
  const cells = new Set();
  const mark = (x, y) => cells.add(`${Math.floor(x / TH.cellCm)},${Math.floor(y / TH.cellCm)}`);
  for (const o of objs) {
    if (o.op === 'image') { // imagem é moldura: marca a caixa inteira
      const x0 = (o.bbox.x0 - R.x0) / PT_CM, x1 = (o.bbox.x1 - R.x0) / PT_CM;
      const y0 = (o.bbox.y0 - R.y0) / PT_CM, y1 = (o.bbox.y1 - R.y0) / PT_CM;
      for (let x = x0; x <= x1; x += TH.cellCm) { mark(x, y0); mark(x, y1); }
      for (let y = y0; y <= y1; y += TH.cellCm) { mark(x0, y); mark(x1, y); }
      continue;
    }
    for (const poly of o.outline) for (let i = 0; i + 1 < poly.length; i++) {
      const ax = (poly[i].x - R.x0) / PT_CM, ay = (poly[i].y - R.y0) / PT_CM;
      const bx = (poly[i + 1].x - R.x0) / PT_CM, by = (poly[i + 1].y - R.y0) / PT_CM;
      const steps = Math.min(3000, Math.ceil(Math.hypot(bx - ax, by - ay) / (TH.cellCm / 2)) + 1);
      for (let s = 0; s <= steps; s++) mark(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
    }
  }
  return cells;
}

/** As duas grades se encostam? Vizinhança de `radius` células. */
function cellsTouch(a, b, radius) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const key of small) {
    const [ix, iy] = key.split(',').map(Number);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (big.has(`${ix + dx},${iy + dy}`)) return true;
    }
  }
  return false;
}

// ----------------------------------------------------------- os detectores
//
// Cada um devolve uma lista de OCORRÊNCIAS com o suficiente para o humano ir
// olhar o arquivo: os índices dos itens e a evidência numérica.

/**
 * PALAVRA PARTIDA — dois itens de mesma cor, na mesma faixa, com um vão menor
 * que a altura deles. É a assinatura "Fruta é Vitamina Pura" saindo em nove
 * pedaços porque a folga de solda usa a altura do glifo minúsculo, não a da
 * linha. Conta PARES adjacentes: nove pedaços dão oito pares.
 */
function detectSplitWords(items, colors) {
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i].boxCm, B = items[j].boxCm;
    if (items[i].bleeds || items[j].bleeds) continue;
    const hA = hOf(A), hB = hOf(B);
    if (Math.min(hA, hB) < TH.splitMinHeightCm) continue;
    const ov = overlap1d(A.y0, A.y1, B.y0, B.y1) / Math.min(hA, hB);
    if (ov < TH.splitOverlapFrac) continue;
    const gap = gap1d(A.x0, A.x1, B.x0, B.x1);
    if (gap >= TH.splitGapHeightFactor * Math.min(hA, hB)) continue;
    // altura parecida: duas linhas de tamanhos muito diferentes não são a mesma palavra
    if (Math.min(hA, hB) / Math.max(hA, hB) < 0.5) continue;
    const cA = colors[i][0], cB = colors[j][0];
    if (!cA || !cB || colorDist(cA.color, cB.color) > DEFAULT_GROUPING.colorMergeDelta) continue;
    // só o par ADJACENTE: nenhum terceiro item da mesma faixa entre os dois
    const lo = Math.min(A.x1, B.x1), hi = Math.max(A.x0, B.x0);
    let blocked = false;
    for (let k = 0; k < items.length && !blocked; k++) {
      if (k === i || k === j) continue;
      const C = items[k].boxCm;
      if (overlap1d(C.y0, C.y1, Math.max(A.y0, B.y0), Math.min(A.y1, B.y1)) <= 0) continue;
      if (C.x0 > lo - 0.5 && C.x1 < hi + 0.5) blocked = true;
    }
    if (blocked) continue;
    out.push({ a: i, b: j, gapCm: r1(gap), hCm: r1(Math.min(hA, hB)) });
  }
  return out;
}

/**
 * ÓRFÃO — item de uma subforma só, pequeno, colado num item maior e dentro da
 * faixa vertical dele. É o ícone do Instagram que ficou de fora do
 * "@frutamina.oficial", e o ".oficial" que ficou de fora do "@frutamina".
 * O aplicador recebe três adesivos onde há um.
 */
function detectOrphans(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const A = items[i].boxCm;
    if (items[i].bleeds) continue;
    if (items[i].partsCm.length !== 1) continue;
    let best = null;
    for (let j = 0; j < items.length; j++) {
      if (j === i || items[j].bleeds) continue;
      const B = items[j].boxCm;
      if (items[i].areaCm2 > TH.orphanAreaFrac * items[j].areaCm2) continue;
      const band = overlap1d(A.y0, A.y1, B.y0, B.y1) / Math.max(1, hOf(A));
      if (band < TH.orphanBandFrac) continue;
      const gx = gap1d(A.x0, A.x1, B.x0, B.x1), gy = gap1d(A.y0, A.y1, B.y0, B.y1);
      const gap = Math.max(gx, gy);
      if (gap > Math.max(TH.orphanGapCm, 0.5 * hOf(A))) continue;
      if (!best || gap < best.gapCm) best = { i, host: j, gapCm: r1(gap), areaCm2: Math.round(items[i].areaCm2) };
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * MONSTRO — o item que engoliu o vizinho. Duas formas:
 *
 *  `span`   — item que não sangra e mesmo assim varre mais de 55% de um eixo da
 *             face. Um adesivo desses cota do teto ao piso e a cota não tem dono.
 *  `colors` — item que junta mais de três cores cujas FORMAS não se encostam.
 *             Vinil é cortado por cor: cor só se junta quando a forma encosta.
 */
function detectMonsters(items, colors, objs, R, widthCm, heightCm) {
  const out = [];
  items.forEach((it, i) => {
    if (it.bleeds) return;
    const b = it.boxCm;
    const span = Math.max(wOf(b) / widthCm, hOf(b) / heightCm);
    const cs = colors[i];
    let loose = 0;
    if (cs.length > TH.monsterColors) {
      const grids = cs.map((c) => inkCells(c.objs, R));
      for (let a = 0; a < grids.length; a++) {
        let touches = false;
        for (let z = 0; z < grids.length && !touches; z++) {
          if (z === a) continue;
          if (cellsTouch(grids[a], grids[z], 2)) touches = true;
        }
        if (!touches) loose++;
      }
    }
    // quem encosta numa aresta é arte de fundo: varrer a face é o ofício dela,
    // e o defeito dela já é contado em "sem contorno".
    const free = !it.bleedAxes || !it.bleedAxes.edges.length;
    const bySpan = free && span > TH.monsterSpanFrac;
    const byColor = cs.length > TH.monsterColors && loose > 0;
    if (bySpan || byColor) out.push({ i, spanFrac: r2(span), colors: cs.length, loose, why: bySpan && byColor ? 'span+colors' : bySpan ? 'span' : 'colors' });
  });
  return out;
}

/**
 * ITEM MUDO — item que não recebe cota nenhuma. O operador clica nele no
 * visualizador e não aparece número: o adesivo existe e não tem onde colar.
 */
function detectMute(items, dims) {
  const got = new Set(dims.map((d) => d.targetIndex).filter((x) => x != null));
  const out = [];
  items.forEach((_, i) => { if (!got.has(i)) out.push({ i }); });
  return out;
}

/**
 * SEM CONTORNO — item que ENCOSTA numa aresta da face (portanto se desenha
 * sobre a face, e a caixa dele mente sobre a silhueta) e não traz `outlinePt`.
 * Hoje só o envelopamento de dois eixos ganha contorno; a faixa que sangra por
 * um eixo só sai como retângulo, e a cota parece não bater com o desenho.
 */
function detectNoOutline(items) {
  const out = [];
  items.forEach((it, i) => {
    if (!it.bleedAxes || !it.bleedAxes.edges.length) return;
    if (it.outlinePt && it.outlinePt.length) return;
    out.push({ i, edges: it.bleedAxes.edges.join('+') });
  });
  return out;
}

/**
 * PEÇA PICADA — dois itens cujos CONTORNOS se encostam e que mesmo assim
 * saíram separados. É a foice de fundo da FRICARNE, cinza de um lado e vermelha
 * do outro, virando dois adesivos. A doutrina é explícita: "cores diferentes só
 * se juntam quando as FORMAS se encostam" — quando encostam e não se juntaram,
 * é defeito.
 *
 * O teste é de CONTORNO e não de caixa de propósito: a caixa juntaria
 * "HORTIFRUTI" com a maçã, que a doutrina manda separar.
 */
function detectCutPieces(items, objs, R) {
  const out = [];
  const cache = new Map();
  const cellsFor = (i) => {
    if (!cache.has(i)) cache.set(i, inkCells(objs[i], R));
    return cache.get(i);
  };
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i].boxCm, B = items[j].boxCm;
    const inter = overlap1d(A.x0, A.x1, B.x0, B.x1) * overlap1d(A.y0, A.y1, B.y0, B.y1);
    const small = Math.min(Math.max(1, wOf(A) * hOf(A)), Math.max(1, wOf(B) * hOf(B)));
    if (inter / small < TH.cutOverlapFrac) continue;
    if (!cellsTouch(cellsFor(i), cellsFor(j), Math.ceil(TH.touchCm / TH.cellCm))) continue;
    out.push({ a: i, b: j, overlapFrac: r2(inter / small) });
  }
  return out;
}

/**
 * EMPILHADO COM LARGURA INCOMPATÍVEL — a regra do dono, textual: "raramente
 * colamos 1 adesivo onde o componente abaixo não cubra a mesma largura".
 *
 * Duas fileiras horizontais sem sobreposição vertical, e a de baixo cobrindo
 * 57% da de cima, são dois adesivos: o aplicador cola a palavra grande e
 * depois centraliza a pequena. É o "clebin" (297 cm) com "distribuidora"
 * (168 cm) da Clebin Distribuidora.
 *
 * A fileira é apurada no GLIFO, não na `parte`: aquele item sai com
 * `parts = 1` porque as duas linhas já se fundiram na solda, e um detector que
 * olhasse `partsCm` não veria nada. Aqui as subformas de cada objeto entram num
 * histograma de altura e a fileira é um trecho contíguo de tinta.
 */
function detectStackedRows(items, objs, R) {
  const out = [];
  items.forEach((it, i) => {
    if (it.bleeds) return;
    const atoms = [];
    for (const o of objs[i]) {
      if (o.op === 'image') {
        atoms.push({ x0: (o.bbox.x0 - R.x0) / PT_CM, x1: (o.bbox.x1 - R.x0) / PT_CM,
                     y0: (o.bbox.y0 - R.y0) / PT_CM, y1: (o.bbox.y1 - R.y0) / PT_CM });
        continue;
      }
      for (const poly of o.outline) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const q of poly) {
          const x = (q.x - R.x0) / PT_CM, y = (q.y - R.y0) / PT_CM;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 >= x0) atoms.push({ x0, x1, y0, y1 });
      }
    }
    if (atoms.length < 2) return;
    const top = Math.min(...atoms.map((a) => a.y0)), bot = Math.max(...atoms.map((a) => a.y1));
    const nb = Math.ceil((bot - top) / TH.rowBinCm) + 1;
    if (nb < 2 || nb > 20000) return;
    const occ = new Uint8Array(nb);
    for (const a of atoms) {
      const b0 = Math.max(0, Math.floor((a.y0 - top) / TH.rowBinCm));
      const b1 = Math.min(nb - 1, Math.ceil((a.y1 - top) / TH.rowBinCm));
      for (let b = b0; b <= b1; b++) occ[b] = 1;
    }
    const runs = [];
    for (let b = 0; b < nb; b++) {
      if (!occ[b]) continue;
      let e = b; while (e + 1 < nb && occ[e + 1]) e++;
      runs.push({ y0: top + b * TH.rowBinCm, y1: top + (e + 1) * TH.rowBinCm });
      b = e;
    }
    if (runs.length < 2) return;
    const rows = runs.map((r) => {
      let x0 = Infinity, x1 = -Infinity, n = 0;
      for (const a of atoms) {
        const cy = (a.y0 + a.y1) / 2;
        if (cy < r.y0 - 1e-9 || cy > r.y1 + 1e-9) continue;
        n++;
        if (a.x0 < x0) x0 = a.x0; if (a.x1 > x1) x1 = a.x1;
      }
      return { ...r, w: x1 > x0 ? x1 - x0 : 0, h: r.y1 - r.y0, n };
    }).filter((r) => r.w > 0 && r.h >= TH.rowMinHeightCm && r.n >= TH.rowMinAtoms);
    if (rows.length < 2) return;
    const wide = Math.max(...rows.map((r) => r.w));
    const narrow = rows.filter((r) => r.w >= TH.rowMinCoverFrac * wide);
    if (narrow.length < 2) return;
    const min = Math.min(...narrow.map((r) => r.w));
    if (min >= TH.rowCoverFrac * wide) return;
    out.push({ i, rows: narrow.length, wideCm: r1(wide), narrowCm: r1(min), coverFrac: r2(min / wide),
               atoms: narrow.map((r) => r.n) });
  });
  return out;
}

/** Segmentos de contorno de um item, em cm da face. Imagem entra como caixa. */
function segsOf(objs, R) {
  const segs = [];
  const px = (v) => (v - R.x0) / PT_CM, py = (v) => (v - R.y0) / PT_CM;
  for (const o of objs) {
    if (o.op === 'image') {
      const x0 = px(o.bbox.x0), x1 = px(o.bbox.x1), y0 = py(o.bbox.y0), y1 = py(o.bbox.y1);
      segs.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]);
      continue;
    }
    for (const poly of o.outline) {
      for (let k = 0; k + 1 < poly.length; k++) segs.push([px(poly[k].x), py(poly[k].y), px(poly[k + 1].x), py(poly[k + 1].y)]);
      if (poly.length > 2) {
        const a = poly[poly.length - 1], b = poly[0];
        if (a.x !== b.x || a.y !== b.y) segs.push([px(a.x), py(a.y), px(b.x), py(b.y)]);
      }
    }
  }
  return segs;
}

/** Ponto dentro da tinta? Regra par-ímpar sobre TODOS os contornos do item. */
function insideSegs(segs, x, y) {
  let inside = false;
  for (let k = 0; k < segs.length; k++) {
    const [ax, ay, bx, by] = segs[k];
    if ((ay > y) === (by > y)) continue;
    if (x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside;
  }
  return inside;
}

/** Pontos amostrados ao longo dos contornos, uniformes por comprimento. */
function sampleSegs(segs, n) {
  let total = 0;
  const len = segs.map(([ax, ay, bx, by]) => { const l = Math.hypot(bx - ax, by - ay); total += l; return l; });
  if (total <= 0) return [];
  const step = total / n, pts = [];
  let acc = 0, want = step / 2;
  for (let k = 0; k < segs.length; k++) {
    const [ax, ay, bx, by] = segs[k];
    while (want < acc + len[k] && pts.length < n) {
      const t = len[k] > 0 ? (want - acc) / len[k] : 0;
      pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      want += step;
    }
    acc += len[k];
  }
  return pts;
}

/**
 * MARCA MULTICOR PARTIDA — dois itens cujas ÁREAS PINTADAS se sobrepõem de
 * verdade e que têm porte comparável.
 *
 * O degradê do CorelDRAW não é degradê: é uma pilha de formas chapadas de cores
 * vizinhas, uma por cima da outra. "Cor separa" transforma a marca "ga" da
 * Alvorada e o coração do Amigão em dois adesivos que ninguém consegue colar
 * separados — e faz a foice da FRICARNE virar meia foice cinza e meia vermelha.
 *
 * O teste é de ÁREA e não de caixa: amostra-se o contorno do menor e conta-se
 * quantos pontos caem DENTRO da tinta do maior. Mas medido no acervo o degradê
 * quase nunca se sobrepõe de verdade — as metades ENCOSTAM (o coração do
 * Amigão: 0,00 cm de distância, 2% de sobreposição) ou ficam separadas por um
 * filete branco (a foice da FRICARNE: 5,28 cm). Por isso o critério é
 * "sobrepõe OU está a menos da folga que a própria doutrina usaria para
 * soldar" — 0,6 × altura, entre 1,5 e 12 cm.
 *
 * Dois guardas contra falso positivo, e o segundo foi preciso acrescentar: a
 * razão de diagonais ≥ 0,5 pedida deixa passar o "FRIGORÍFICO" encaixado no
 * rabo do "Carajás" por 0,507. A razão de ÁREAS o reprova por 0,08.
 */
function detectGradientSplit(items, objs, colors, R) {
  const out = [];
  const cache = new Map();
  const segsFor = (i) => { if (!cache.has(i)) cache.set(i, segsOf(objs[i], R)); return cache.get(i); };
  const ptsCache = new Map();
  const ptsFor = (i) => { if (!ptsCache.has(i)) ptsCache.set(i, sampleSegs(segsFor(i), TH.gradientContourPts)); return ptsCache.get(i); };
  const diag = (b) => Math.hypot(wOf(b), hOf(b));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (items[i].bleeds || items[j].bleeds) continue;
    const A = items[i].boxCm, B = items[j].boxCm;
    const dA = diag(A), dB = diag(B);
    const diagRatio = Math.min(dA, dB) / Math.max(dA, dB);
    if (diagRatio < TH.gradientDiagRatio) continue;
    const areaA = Math.max(1, wOf(A) * hOf(A)), areaB = Math.max(1, wOf(B) * hOf(B));
    const areaRatio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
    if (areaRatio < TH.gradientAreaRatio) continue;
    // multicor: cores dominantes diferentes. Mesma cor já é palavra partida.
    const cA = (colors[i][0] || {}).color, cB = (colors[j][0] || {}).color;
    if (colorDist(cA, cB) <= DEFAULT_GROUPING.colorMergeDelta) continue;
    // a folga que a DOUTRINA usaria para soldar estes dois
    const weld = Math.max(DEFAULT_GROUPING.partGapCm,
      Math.min(DEFAULT_GROUPING.maxPartGapCm, DEFAULT_GROUPING.textGapFactor * Math.min(hOf(A), hOf(B))));
    // longe demais em caixa? nem vale medir
    if (gap1d(A.x0, A.x1, B.x0, B.x1) > weld || gap1d(A.y0, A.y1, B.y0, B.y1) > weld) continue;
    const [small, big] = areaA <= areaB ? [i, j] : [j, i];
    const pts = ptsFor(small);
    if (!pts.length) continue;
    // a folga é barata (hash de células); o ponto-em-polígono não é. Mede-se
    // primeiro, e só quem passa longe paga o teste de área.
    const gapCm = contourGap(pts, ptsFor(big), weld);
    let insideFrac = 0;
    if (gapCm > weld) {
      const bigSegs = segsFor(big);
      let inside = 0;
      const stride = TH.gradientInsideStride;
      for (let k = 0; k < pts.length; k += stride) if (insideSegs(bigSegs, pts[k][0], pts[k][1])) inside++;
      insideFrac = inside / Math.ceil(pts.length / stride);
      if (insideFrac < TH.gradientInsideFrac) continue;
    }
    out.push({ a: i, b: j, insideFrac: r2(insideFrac), gapCm: r2(gapCm), weldCm: r2(weld),
               diagRatio: r2(diagRatio), areaRatio: r2(areaRatio) });
  }
  return out;
}

/** Menor distância entre duas nuvens de pontos, com hash de células. */
function contourGap(P, Q, limit) {
  if (!P.length || !Q.length) return Infinity;
  const cell = Math.max(0.5, limit);
  const grid = new Map();
  for (const [x, y] of Q) {
    const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const l = grid.get(k); if (l) l.push([x, y]); else grid.set(k, [[x, y]]);
  }
  let best = Infinity;
  for (const [x, y] of P) {
    const ix = Math.floor(x / cell), iy = Math.floor(y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = grid.get(`${ix + dx},${iy + dy}`);
      if (!l) continue;
      for (const [qx, qy] of l) { const d = Math.hypot(x - qx, y - qy); if (d < best) best = d; }
    }
    if (best === 0) return 0;
  }
  return best;
}

// -------------------------------------------- verdade de campo: as cotas
//
// A ponta da extensão é a extremidade LONGE da linha de cota — o outro lado é
// a sobra de 2,5 cm que passa da linha.

function tipOf(ext, ax) {
  if (!ext) return null;
  return Math.abs(ext.lo - ax) > Math.abs(ext.hi - ax) ? ext.lo : ext.hi;
}

/**
 * GRANDE DEMAIS e PICADO, medidos contra o que o projetista desenhou.
 *
 * `deep`  — ponta que cai a mais de 10 cm de TODA borda da caixa de um item
 *           nosso: o item cobre a peça que ela aponta e mais um pedaço.
 *           A doutrina avisa que este é o erro caro: item grande demais engole
 *           o vizinho e a cota fica sem dono.
 * `chopped` — o projetista cotou a mesma peça pelos dois lados (uma cota nasce
 *           na borda mínima da face, outra morre na máxima, as duas na mesma
 *           faixa) e as pontas livres caíram em itens DIFERENTES nossos.
 */
/**
 * A cadeia de itens que vai de `from` a `to` no eixo `axis`, na faixa dada.
 *
 * Devolve os índices em ordem, ou `null` quando não há cadeia — quando entre as
 * duas pontas existe um corredor vazio maior que a altura dos vizinhos, e
 * portanto são duas peças diferentes, não uma peça picada.
 */
function chainBetween(items, axis, from, to, bandA, bandB) {
  const band0 = Math.min(bandA, bandB), band1 = Math.max(bandA, bandB);
  const cand = [];
  items.forEach((it, i) => {
    if (it.bleeds) return;
    const b = it.boxCm;
    const lo = axis === 'H' ? b.x0 : b.y0, hi = axis === 'H' ? b.x1 : b.y1;
    const plo = axis === 'H' ? b.y0 : b.x0, phi = axis === 'H' ? b.y1 : b.x1;
    if (phi < band0 - TH.edgeTolCm || plo > band1 + TH.edgeTolCm) return;
    if (hi < from - TH.edgeTolCm || lo > to + TH.edgeTolCm) return;
    cand.push({ i, lo, hi, h: axis === 'H' ? b.y1 - b.y0 : b.x1 - b.x0 });
  });
  if (!cand.length) return null;
  cand.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const start = cand.find((c) => Math.abs(c.lo - from) <= TH.edgeTolCm);
  if (!start) return null;
  const chain = [start.i];
  let cur = start;
  while (Math.abs(cur.hi - to) > TH.edgeTolCm) {
    // o vão que a doutrina soldaria: menos que a altura dos vizinhos
    const next = cand.find((c) => c.lo >= cur.hi - TH.edgeTolCm && c.lo - cur.hi < Math.min(cur.h, c.h) && !chain.includes(c.i));
    if (!next || next.hi <= cur.hi) return null;
    chain.push(next.i);
    cur = next;
    if (chain.length > 40) return null;
  }
  return chain;
}

/**
 * O item `i` é um FRAGMENTO? Quantos itens formam a peça a que ele pertence.
 *
 * Mesma régua da cadeia: vizinho na mesma faixa, separado por menos que a
 * altura dos dois. Um elo = peça inteira; dois ou mais = peça picada.
 */
function fragmentSize(items, i, axis) {
  const b0 = items[i].boxCm;
  const perp0 = axis === 'H' ? [b0.y0, b0.y1] : [b0.x0, b0.x1];
  const nodes = [];
  items.forEach((it, k) => {
    if (it.bleeds) return;
    const b = it.boxCm;
    const plo = axis === 'H' ? b.y0 : b.x0, phi = axis === 'H' ? b.y1 : b.x1;
    const ov = overlap1d(plo, phi, perp0[0], perp0[1]);
    if (ov / Math.max(1, Math.min(phi - plo, perp0[1] - perp0[0])) < 0.5) return;
    nodes.push({ k, lo: axis === 'H' ? b.x0 : b.y0, hi: axis === 'H' ? b.x1 : b.y1, h: phi - plo });
  });
  nodes.sort((a, b) => a.lo - b.lo);
  const at = nodes.findIndex((n) => n.k === i);
  if (at < 0) return 1;
  let n = 1;
  for (let z = at; z + 1 < nodes.length; z++) {
    if (nodes[z + 1].lo - nodes[z].hi >= Math.min(nodes[z].h, nodes[z + 1].h)) break;
    n++;
  }
  for (let z = at; z > 0; z--) {
    if (nodes[z].lo - nodes[z - 1].hi >= Math.min(nodes[z].h, nodes[z - 1].h)) break;
    n++;
  }
  return n;
}

function fieldTruth(refP, items, widthCm, heightCm) {
  const boxes = items.map((it) => it.boxCm);
  const hitOf = (tip, axis, band) => {
    // qual item tem uma BORDA nessa coordenada, na faixa certa?
    let onEdge = null, deep = null;
    boxes.forEach((b, i) => {
      if (items[i].bleeds) return;
      const lo = axis === 'H' ? b.x0 : b.y0, hi = axis === 'H' ? b.x1 : b.y1;
      const blo = axis === 'H' ? b.y0 : b.x0, bhi = axis === 'H' ? b.y1 : b.x1;
      if (band != null && (band < blo - TH.edgeTolCm || band > bhi + TH.edgeTolCm)) return;
      const dEdge = Math.min(Math.abs(tip - lo), Math.abs(tip - hi));
      if (dEdge <= TH.edgeTolCm) { if (!onEdge || dEdge < onEdge.d) onEdge = { i, d: dEdge }; return; }
      if (tip > lo && tip < hi) {
        const d = Math.min(tip - lo, hi - tip);
        if (d > TH.deepInsideCm && (!deep || d > deep.d)) deep = { i, d };
      }
    });
    return { onEdge, deep };
  };

  const tips = [];
  for (const r of refP) {
    const limit = r.axis === 'H' ? widthCm : heightCm;
    for (const [tip, band] of [[r.tipA, r.bandA], [r.tipB, r.bandB]]) {
      if (tip == null) continue;
      if (Math.abs(tip) <= TH.faceEdgeTolCm || Math.abs(tip - limit) <= TH.faceEdgeTolCm) {
        tips.push({ axis: r.axis, tip, band, faceEdge: true, res: null, ref: r });
        continue;
      }
      tips.push({ axis: r.axis, tip, band, faceEdge: false, res: hitOf(tip, r.axis, band), ref: r });
    }
  }

  const resolved = tips.filter((t) => !t.faceEdge && t.res && (t.res.onEdge || t.res.deep));
  const deep = resolved.filter((t) => !t.res.onEdge && t.res.deep);
  // âncora que caiu na borda de um FRAGMENTO: o projetista apontou uma peça e o
  // motor tem ali dois ou mais itens em fila. Mesma pergunta do `chopped`, com
  // denominador 30 vezes maior — cada ponta que encosta em item vale uma medida.
  const onEdge = resolved.filter((t) => t.res.onEdge);
  const onFragment = onEdge.filter((t) => fragmentSize(items, t.res.onEdge.i, t.axis) > 1);

  // --- picado: par borda-mínima / borda-máxima que abraça a MESMA peça
  //
  // Não basta uma cota nascer na esquerda e outra morrer na direita: numa face
  // de 15 m isso emparelha dois adesivos que nada têm a ver um com o outro (o
  // AP RANCHARIA emparelhava 179 cm com 1.514 cm). O par só vale se, entre as
  // duas pontas, houver uma CADEIA contígua de itens nossos — cada vão menor
  // que a altura dos vizinhos, que é a régua da própria doutrina para dizer o
  // que é uma peça só. Se a cadeia tem um elo, o motor acertou; se tem dois ou
  // mais, ele picou a peça que o projetista mediu inteira.
  const chopped = [];
  const seenPair = new Set();
  let pairs = 0;
  const byAxis = { H: refP.filter((r) => r.axis === 'H'), V: refP.filter((r) => r.axis === 'V') };
  for (const axis of ['H', 'V']) {
    const limit = axis === 'H' ? widthCm : heightCm;
    const fromMin = [], fromMax = [];
    for (const r of byAxis[axis]) {
      const ends = [[r.tipA, r.bandA], [r.tipB, r.bandB]];
      const atMin = ends.find(([t]) => t != null && Math.abs(t) <= TH.faceEdgeTolCm);
      const atMax = ends.find(([t]) => t != null && Math.abs(t - limit) <= TH.faceEdgeTolCm);
      const free = ends.find(([t]) => t != null && Math.abs(t) > TH.faceEdgeTolCm && Math.abs(t - limit) > TH.faceEdgeTolCm);
      if (!free) continue;
      if (atMin && !atMax) fromMin.push({ tip: free[0], band: free[1] });
      else if (atMax && !atMin) fromMax.push({ tip: free[0], band: free[1] });
    }
    for (const p of fromMin) for (const q of fromMax) {
      if (p.band == null || q.band == null || q.tip <= p.tip) continue;
      const chain = chainBetween(items, axis, p.tip, q.tip, p.band, q.band);
      if (!chain) continue;
      const key = `${axis}:${chain[0]}:${chain[chain.length - 1]}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      pairs++;
      if (chain.length > 1) chopped.push({ axis, links: chain.length, items: chain.slice(0, 12), fromCm: r1(p.tip), toCm: r1(q.tip) });
    }
  }

  // --- por COTA: a cota do projetista está sobre item inteiro, sobre fragmento
  // ou sobre item que engoliu a peça? Serve para medir o PREÇO de cada defeito
  // sem o viés de face cheia (face com mais itens gera mais cota e acerta mais
  // por acaso).
  const byDim = refP.map((r) => {
    const mine = tips.filter((t) => t.ref === r);
    if (!mine.length) return null;
    if (mine.some((t) => !t.faceEdge && t.res && !t.res.onEdge && t.res.deep)) return 'deep';
    const edges = mine.filter((t) => !t.faceEdge && t.res && t.res.onEdge);
    if (!edges.length) return null;
    if (edges.some((t) => fragmentSize(items, t.res.onEdge.i, t.axis) > 1)) return 'fragment';
    return 'whole';
  });

  return {
    byDim,
    tipsTotal: tips.length,
    tipsFaceEdge: tips.filter((t) => t.faceEdge).length,
    tipsResolved: resolved.length,
    tipsDeep: deep.length,
    tipsOnEdge: onEdge.length,
    tipsOnFragment: onFragment.length,
    fragment: onFragment.slice(0, 8).map((t) => ({ i: t.res.onEdge.i, axis: t.axis, tipCm: r1(t.tip) })),
    deep: deep.map((t) => ({ i: t.res.deep.i, axis: t.axis, tipCm: r1(t.tip), depthCm: r1(t.res.deep.d) })),
    pairs,
    chopped,
  };
}

// ------------------------------------------------------------------ a passada

const t0 = Date.now();
let files = walk(CORPUS);
if (ONLY) files = files.filter((f) => f.includes(ONLY));
const GR = { ...DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING ?? '{}') };
const DO = { ...DEFAULT_DOCTRINE, ...JSON.parse(process.env.DOCTRINE ?? '{}') };

const errors = [];
const perFace = [];
let filesRead = 0, nFaces = 0, nItems = 0, nDims = 0;
const byClass = { deep: { total: 0, hit: 0 }, fragment: { total: 0, hit: 0 }, whole: { total: 0, hit: 0 } };
const tot = {
  splitPairs: 0, splitItems: 0,
  orphans: 0,
  monsters: 0, monsterSpan: 0, monsterColors: 0,
  mute: 0,
  noOutline: 0, edgeItems: 0,
  cutPairs: 0, cutItems: 0,
  stacked: 0,
  gradPairs: 0, gradItems: 0,
  tipsTotal: 0, tipsFaceEdge: 0, tipsResolved: 0, tipsDeep: 0, tipsOnEdge: 0, tipsOnFragment: 0,
  pairs: 0, chopped: 0,
};

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
    if (!rects.length) { await doc.destroy(); continue; }

    // cada cota do projetista fica com a face cujo EIXO ela encosta (igual bench.mjs)
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
      const widthCm = Math.round((R.x1 - R.x0) / PT_CM);
      const heightCm = Math.round((R.y1 - R.y0) / PT_CM);
      const panel = { side: 'MOTORISTA', heightCm, sections: [{ widthCm, isDoor: false }] };
      const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };

      const { pieces } = classify(g, scale, GR);
      const built = buildItems(pieces, scale, GR);
      const items = built.items;
      if (!items.length) return;
      const objs = built.objects;
      const crossings = borderCrossings(objs, panel, scale, GR);
      const dims = planDimensions(panel, items, crossings, DO);
      const colors = objs.map((o) => colorsOf(o));

      const split = detectSplitWords(items, colors);
      const orphans = detectOrphans(items);
      const monsters = detectMonsters(items, colors, objs, R, widthCm, heightCm);
      const mute = detectMute(items, dims);
      const noOutline = detectNoOutline(items);
      const cut = detectCutPieces(items, objs, R);
      const stacked = detectStackedRows(items, objs, R);
      const gradient = detectGradientSplit(items, objs, colors, R);

      // --- cotas do projetista desta face, já em cm e com as pontas resolvidas
      const refP = [];
      for (const d of owned[i]) {
        const toAlong = (v) => (d.vert ? (v - R.y0) : (v - R.x0)) / PT_CM;
        const toPerp = (v) => (d.vert ? (v - R.x0) : (v - R.y0)) / PT_CM;
        const tA = tipOf(d.extA, d.ax), tB = tipOf(d.extB, d.ax);
        refP.push({
          axis: d.vert ? 'V' : 'H', v: d.v,
          tipA: toAlong(d.a), bandA: tA == null ? null : toPerp(tA),
          tipB: toAlong(d.b), bandB: tB == null ? null : toPerp(tB),
        });
      }
      const ft = fieldTruth(refP, items, widthCm, heightCm);
      // recall por classe: mesma régua do bench.mjs (mesmo eixo, âncoras a 4 cm,
      // valor a 3 cm), mas contada POR COTA e cruzada com o defeito.
      refP.forEach((r, k) => {
        const cls = ft.byDim[k];
        if (!cls) return;
        const a = Math.min(r.tipA, r.tipB), b = Math.max(r.tipA, r.tipB);
        const ok = dims.some((d) => d.axis === r.axis &&
          Math.abs(Math.min(d.aCm, d.bCm) - a) <= 4 && Math.abs(Math.max(d.aCm, d.bCm) - b) <= 4 &&
          Math.abs(d.valueCm - r.v) <= 3);
        byClass[cls].total++; if (ok) byClass[cls].hit++;
      });

      const splitItems = new Set(); split.forEach((s) => { splitItems.add(s.a); splitItems.add(s.b); });
      const cutItems = new Set(); cut.forEach((s) => { cutItems.add(s.a); cutItems.add(s.b); });
      const gradItems = new Set(); gradient.forEach((s) => { gradItems.add(s.a); gradItems.add(s.b); });
      const edgeItems = items.filter((it) => it.bleedAxes && it.bleedAxes.edges.length).length;

      nFaces++; nItems += items.length; nDims += dims.length;
      tot.splitPairs += split.length; tot.splitItems += splitItems.size;
      tot.orphans += orphans.length;
      tot.monsters += monsters.length;
      tot.monsterSpan += monsters.filter((m) => m.why !== 'colors').length;
      tot.monsterColors += monsters.filter((m) => m.why !== 'span').length;
      tot.mute += mute.length;
      tot.noOutline += noOutline.length; tot.edgeItems += edgeItems;
      tot.cutPairs += cut.length; tot.cutItems += cutItems.size;
      tot.stacked += stacked.length;
      tot.gradPairs += gradient.length; tot.gradItems += gradItems.size;
      tot.tipsTotal += ft.tipsTotal; tot.tipsFaceEdge += ft.tipsFaceEdge;
      tot.tipsResolved += ft.tipsResolved; tot.tipsDeep += ft.tipsDeep;
      tot.tipsOnEdge += ft.tipsOnEdge; tot.tipsOnFragment += ft.tipsOnFragment;
      tot.pairs += ft.pairs; tot.chopped += ft.chopped.length;

      perFace.push({
        file: short, face: i, w: widthCm, h: heightCm,
        items: items.length, dims: dims.length, refDims: refP.length,
        splitPairs: split.length, splitItems: splitItems.size,
        orphans: orphans.length,
        monsters: monsters.length,
        mute: mute.length,
        noOutline: noOutline.length, edgeItems,
        cutPairs: cut.length,
        stacked: stacked.length,
        gradPairs: gradient.length,
        tipsResolved: ft.tipsResolved, tipsDeep: ft.tipsDeep,
        tipsOnEdge: ft.tipsOnEdge, tipsOnFragment: ft.tipsOnFragment,
        pairs: ft.pairs, chopped: ft.chopped.length,
        // o índice de sofrimento: quantos itens da face estão em algum defeito
        hurt: new Set([
          ...splitItems, ...cutItems,
          ...orphans.map((o) => o.i), ...monsters.map((m) => m.i),
          ...noOutline.map((n) => n.i), ...ft.deep.map((d) => d.i),
          ...gradItems, ...stacked.map((x) => x.i),
        ]).size,
        detail: {
          split: split.slice(0, 12), orphans: orphans.slice(0, 12),
          monsters: monsters.slice(0, 8), noOutline: noOutline.slice(0, 8),
          cut: cut.slice(0, 8), deep: ft.deep.slice(0, 8), chopped: ft.chopped.slice(0, 8),
          stacked: stacked.slice(0, 8), gradient: gradient.slice(0, 8), fragment: ft.fragment,
        },
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

const facesWith = (k) => perFace.filter((p) => p[k] > 0).length;

const metrics = {
  // --- guarda: se estes mudam, a comparação com a referência não vale
  filesFound: files.length,
  filesRead,
  faces: nFaces,
  items: nItems,
  designerTips: tot.tipsTotal,

  // --- verdade de campo 1: as cotas do projetista
  /** ponta que cai no MEIO de um item nosso, sobre as pontas que caem em item */
  oversizedRatePct: r1(pct(tot.tipsDeep, tot.tipsResolved)),
  oversizedTips: tot.tipsDeep,
  resolvedTips: tot.tipsResolved,
  /** par esquerda/direita da mesma peça que caiu em dois itens nossos */
  choppedRatePct: r1(pct(tot.chopped, tot.pairs)),
  choppedPairs: tot.chopped,
  sidePairs: tot.pairs,
  /** ponta que encosta na borda de um item que é fragmento de uma fila */
  anchorFragmentRatePct: r1(pct(tot.tipsOnFragment, tot.tipsOnEdge)),
  anchorsOnFragment: tot.tipsOnFragment,
  anchorsOnEdge: tot.tipsOnEdge,

  // --- verdade de campo 2: a geometria
  /** itens em par de palavra partida, sobre o total de itens */
  splitWordRatePct: r1(pct(tot.splitItems, nItems)),
  splitPairs: tot.splitPairs,
  splitItems: tot.splitItems,
  orphanRatePct: r1(pct(tot.orphans, nItems)),
  orphans: tot.orphans,
  monsterRatePct: r1(pct(tot.monsters, nItems)),
  monsters: tot.monsters,
  monsterBySpan: tot.monsterSpan,
  monsterByColor: tot.monsterColors,
  muteRatePct: r1(pct(tot.mute, nItems)),
  mute: tot.mute,
  /** sobre os itens que ENCOSTAM numa aresta — os únicos que precisam de contorno */
  noOutlineRatePct: r1(pct(tot.noOutline, tot.edgeItems)),
  noOutline: tot.noOutline,
  edgeItems: tot.edgeItems,
  cutPieceRatePct: r1(pct(tot.cutItems, nItems)),
  cutPairs: tot.cutPairs,
  cutItems: tot.cutItems,
  stackedRatePct: r1(pct(tot.stacked, nItems)),
  stacked: tot.stacked,
  gradientRatePct: r1(pct(tot.gradItems, nItems)),
  gradPairs: tot.gradPairs,
  gradItems: tot.gradItems,

  // --- resumo
  /** itens tocados por ALGUM defeito, sobre o total. O número único. */
  hurtItemRatePct: r1(pct(perFace.reduce((s, p) => s + p.hurt, 0), nItems)),
  hurtItems: perFace.reduce((s, p) => s + p.hurt, 0),
  facesClean: perFace.filter((p) => p.hurt === 0).length,
  itemsPerFace: r2(nItems / Math.max(1, nFaces)),
  facesWithSplit: facesWith('splitPairs'),
  facesWithOrphan: facesWith('orphans'),
  facesWithMonster: facesWith('monsters'),
  facesWithCut: facesWith('cutPairs'),
  facesWithNoOutline: facesWith('noOutline'),
  facesWithStacked: facesWith('stacked'),
  facesWithGradient: facesWith('gradPairs'),
  errors: errors.length,

  // --- informativo: o PREÇO de cada defeito, medido por cota e não por face
  dimsOverMerged: byClass.deep.total,
  recallOverMergedPct: r1(pct(byClass.deep.hit, byClass.deep.total)),
  dimsFragmented: byClass.fragment.total,
  recallFragmentedPct: r1(pct(byClass.fragment.hit, byClass.fragment.total)),
  dimsWhole: byClass.whole.total,
  recallWholePct: r1(pct(byClass.whole.hit, byClass.whole.total)),
};

const DIR = new URL('.', import.meta.url).pathname;
const srcSha = (() => {
  const h = createHash('sha1');
  for (const n of ['grouping.ts', 'doctrine.ts', 'faces.ts', 'geometry.ts', 'panel.ts', 'routing.ts', 'measure.ts'].sort()) {
    const p = join(DIR, '..', n);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  return h.digest('hex').slice(0, 12);
})();

const report = {
  meta: {
    at: new Date().toISOString(),
    corpus: CORPUS,
    elapsedMs,
    engineSha: srcSha,
    thresholds: TH,
    grouping: GR,
    doctrine: DO,
  },
  metrics,
  perFace: perFace.map((p) => ({ ...p })),
  errors,
};

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
if (SAVE) writeFileSync(BASELINE, JSON.stringify(report, null, 2));

// ------------------------------------------------------------------- saída

if (!QUIET) {
  const base = existsSync(BASELINE) && !SAVE ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
  const GUARD = ['filesFound', 'filesRead', 'faces', 'items', 'designerTips'];
  const DOWN = ['oversizedRatePct', 'choppedRatePct', 'splitWordRatePct', 'orphanRatePct',
                'monsterRatePct', 'muteRatePct', 'noOutlineRatePct', 'cutPieceRatePct',
                'stackedRatePct', 'gradientRatePct', 'anchorFragmentRatePct', 'hurtItemRatePct'];

  const line = (k, v, b) => {
    const d = b == null ? null : r2(v - b);
    const arrow = d == null || Math.abs(d) < 1e-9 ? '' :
      (DOWN.includes(k) ? (d < 0 ? '  MELHOR' : '  pior') : (d > 0 ? '  MELHOR' : '  pior'));
    console.log(`  ${k.padEnd(22)} ${String(v).padStart(9)}${d == null ? '' : `   (${d > 0 ? '+' : ''}${d})${arrow}`}`);
  };

  console.log(`\n=== AGRUPAMENTO · ${nFaces} faces · ${nItems} itens · ${(elapsedMs / 1000).toFixed(1)} s`);
  console.log(`\n-- guarda (tem de ficar igual)`);
  for (const k of GUARD) line(k, metrics[k], base?.metrics?.[k]);

  console.log(`\n-- verdade de campo 1: as cotas do projetista`);
  console.log(`  grande demais  ${metrics.oversizedRatePct}%  (${metrics.oversizedTips} de ${metrics.resolvedTips} pontas que caem em item)`);
  if (base) line('oversizedRatePct', metrics.oversizedRatePct, base.metrics.oversizedRatePct);
  console.log(`  picado         ${metrics.choppedRatePct}%  (${metrics.choppedPairs} de ${metrics.sidePairs} pares esquerda/direita)`);
  if (base) line('choppedRatePct', metrics.choppedRatePct, base.metrics.choppedRatePct);
  console.log(`  âncora em fragmento  ${metrics.anchorFragmentRatePct}%  (${metrics.anchorsOnFragment} de ${metrics.anchorsOnEdge} pontas que encostam em borda de item)`);
  if (base) line('anchorFragmentRatePct', metrics.anchorFragmentRatePct, base.metrics.anchorFragmentRatePct);

  console.log(`\n-- verdade de campo 2: a geometria`);
  const rows = [
    ['palavra partida', 'splitWordRatePct', `${metrics.splitItems} itens em ${metrics.splitPairs} pares`, 'facesWithSplit'],
    ['órfão', 'orphanRatePct', `${metrics.orphans} itens`, 'facesWithOrphan'],
    ['monstro', 'monsterRatePct', `${metrics.monsters} itens (${metrics.monsterBySpan} por vão, ${metrics.monsterByColor} por cor)`, 'facesWithMonster'],
    ['item mudo', 'muteRatePct', `${metrics.mute} itens sem cota`, null],
    ['sem contorno', 'noOutlineRatePct', `${metrics.noOutline} de ${metrics.edgeItems} itens que encostam na aresta`, 'facesWithNoOutline'],
    ['peça picada', 'cutPieceRatePct', `${metrics.cutItems} itens em ${metrics.cutPairs} pares`, 'facesWithCut'],
    ['empilhado', 'stackedRatePct', `${metrics.stacked} itens com fileira estreita`, 'facesWithStacked'],
    ['marca multicor', 'gradientRatePct', `${metrics.gradItems} itens em ${metrics.gradPairs} pares`, 'facesWithGradient'],
  ];
  for (const [name, key, extra, faceKey] of rows) {
    const b = base?.metrics?.[key];
    const d = b == null ? '' : ` (${metrics[key] - b > 0 ? '+' : ''}${r2(metrics[key] - b)})`;
    const fc = faceKey ? ` · ${metrics[faceKey]} faces` : '';
    console.log(`  ${name.padEnd(17)} ${String(metrics[key]).padStart(5)}%${d.padEnd(10)} ${extra}${fc}`);
  }
  console.log(`\n-- o preço de cada defeito (informativo, por COTA do projetista)`);
  console.log(`  cota sobre item INTEIRO      ${String(metrics.dimsWhole).padStart(5)} cotas · o motor reproduz ${metrics.recallWholePct}%`);
  console.log(`  cota sobre FRAGMENTO         ${String(metrics.dimsFragmented).padStart(5)} cotas · o motor reproduz ${metrics.recallFragmentedPct}%`);
  console.log(`  cota sobre item que ENGOLIU  ${String(metrics.dimsOverMerged).padStart(5)} cotas · o motor reproduz ${metrics.recallOverMergedPct}%`);
  console.log(`\n  ITENS FERIDOS  ${metrics.hurtItemRatePct}%  (${metrics.hurtItems} de ${nItems}) · faces limpas ${metrics.facesClean}/${nFaces}`);

  // ---- os piores
  const show = (title, key, fmt) => {
    const list = [...perFace].filter((p) => p[key] > 0)
      .sort((a, b) => b[key] - a[key] || a.file.localeCompare(b.file) || a.face - b.face)
      .slice(0, TOP);
    if (!list.length) return;
    console.log(`\n-- ${TOP} piores por ${title}`);
    for (const p of list) console.log(`  ${String(p[key]).padStart(4)}  ${p.file} [face ${p.face} ${p.w}x${p.h}, ${p.items} itens]${fmt ? fmt(p) : ''}`);
  };
  show('SOFRIMENTO (itens feridos)', 'hurt', (p) => `  split=${p.splitPairs} orf=${p.orphans} mon=${p.monsters} cut=${p.cutPairs} grad=${p.gradPairs} emp=${p.stacked} noOut=${p.noOutline} deep=${p.tipsDeep}`);
  show('palavra partida', 'splitPairs');
  show('empilhado (fileira estreita)', 'stacked');
  show('marca multicor partida', 'gradPairs');
  show('órfão', 'orphans');
  show('peça picada', 'cutPairs');
  show('sem contorno', 'noOutline');
  show('monstro', 'monsters');
  show('grande demais (cota no meio do item)', 'tipsDeep');
  show('âncora em fragmento', 'tipsOnFragment');
  show('item mudo', 'mute');

  if (errors.length) console.log(`\n-- ${errors.length} arquivo(s) com erro de leitura`);
  if (base) {
    const broke = GUARD.filter((k) => metrics[k] !== base.metrics[k]);
    if (broke.length) console.log(`\nVEREDITO: INCONCLUSIVO — a guarda mudou (${broke.join(', ')})`);
    else {
      const up = DOWN.filter((k) => metrics[k] > base.metrics[k] + 0.05);
      const dn = DOWN.filter((k) => metrics[k] < base.metrics[k] - 0.05);
      console.log(`\nVEREDITO: ${dn.length && !up.length ? 'MELHOROU' : up.length && !dn.length ? 'PIOROU' : up.length ? 'MISTO' : 'NEUTRO'}` +
        (dn.length ? `\n  melhor: ${dn.join(', ')}` : '') + (up.length ? `\n  pior:   ${up.join(', ')}` : ''));
    }
  } else console.log(`\n(sem referência em ${BASELINE} — rode com --save para gravar)`);
}
