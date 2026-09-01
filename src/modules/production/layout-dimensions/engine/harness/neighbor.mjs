/**
 * O vizinho pequeno: ícone, símbolo e número solto que deveriam entrar no
 * mesmo adesivo do run ao lado.
 *
 * Uso:
 *   node neighbor.mjs <pdf> [--face n] [--box x0,y0,x1,y1]  → dissecação
 *   node neighbor.mjs <pasta> --orphans [--top 20]          → censo do acervo
 *
 * A dissecação imprime, para a face escolhida:
 *  - cada OBJETO do pool (caixa em cm da face, cor, altura, folga que pede);
 *  - a que PEÇA (partCluster) e a que ITEM (lockup) ele foi parar;
 *  - os itens DESCARTADOS pelo piso `minAreaCm2` — os "itens mudos";
 *  - para cada par vizinho, por que a solda passou ou não passou
 *    (alignedEnough, folga pedida × folga real, distância de cor).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, classify, buildItems, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10;
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const TARGET = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'));
const GR = { ...DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING ?? '{}') };

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

const hex = (c) => (c ? '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '   -   ');
const colorDist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);
const overlapFrac = (a0, a1, b0, b1) => {
  const span = Math.min(a1, b1) - Math.max(a0, b0);
  const smaller = Math.min(a1 - a0, b1 - b0);
  return smaller > 0 ? span / smaller : 0;
};
const alignedEnough = (a, b, f) =>
  overlapFrac(a.x0, a.x1, b.x0, b.x1) >= f || overlapFrac(a.y0, a.y1, b.y0, b.y1) >= f;
const gapBetween = (a, b) => {
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
  const dy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
  return Math.hypot(dx, dy);
};

// ------------------------------------------------------------- dissecação

async function dissect(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const g = await readPageGeometry(page);
  const rects = panelRects(g);
  const faceIdx = opt('--face', null);
  const box = opt('--box', null)?.split(',').map(Number);
  console.log(`# ${file.split('/').pop()}  —  ${rects.length} face(s), ${g.objects.length} objetos`);
  rects.forEach((R, fi) => {
    if (faceIdx !== null && Number(faceIdx) !== fi) return;
    const W = (R.x1 - R.x0) / PT_CM, H = (R.y1 - R.y0) / PT_CM;
    const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
    const cx = (v) => +((v - R.x0) / PT_CM).toFixed(1);
    const cy = (v) => +((v - R.y0) / PT_CM).toFixed(1);
    const toCm = (b) => ({ x0: cx(b.x0), y0: cy(b.y0), x1: cx(b.x1), y1: cy(b.y1) });
    const inBox = (b) => !box || (b.x1 >= box[0] && b.x0 <= box[2] && b.y1 >= box[1] && b.y0 <= box[3]);

    const { pieces } = classify(g, scale, GR);
    const built = buildItems(pieces, scale, GR);
    const loose = buildItems(pieces, scale, { ...GR, minAreaCm2: 0 });

    console.log(`\n=== FACE #${fi}  ${W.toFixed(0)} x ${H.toFixed(0)} cm — ${pieces.length} peças no pool, ${built.items.length} itens (${loose.items.length} sem o piso de área) ===`);

    // mapa objeto -> item
    const objItem = new Map();
    built.objects.forEach((objs, i) => objs.forEach((o) => objItem.set(o, i)));
    const looseItem = new Map();
    loose.objects.forEach((objs, i) => objs.forEach((o) => looseItem.set(o, i)));

    console.log('\n-- objetos do pool (na região pedida) --');
    console.log('  #  op        x0     y0     x1     y1    alt   folga  cor       item  itemSemPiso');
    pieces.forEach((p, i) => {
      const b = toCm(p.obj.bbox);
      if (!inBox(b)) return;
      const hCm = b.y1 - b.y0;
      const gap = Math.min(GR.maxPartGapCm, Math.max(GR.partGapCm, GR.textGapFactor * hCm));
      const col = p.obj.fill ?? p.obj.stroke ?? null;
      const it = objItem.get(p.obj);
      const li = looseItem.get(p.obj);
      console.log(`${String(i).padStart(4)} ${p.obj.op.padEnd(8)} ${String(b.x0).padStart(6)} ${String(b.y0).padStart(6)} ${String(b.x1).padStart(6)} ${String(b.y1).padStart(6)} ${hCm.toFixed(1).padStart(6)} ${gap.toFixed(1).padStart(6)}  ${hex(col)}  ${it === undefined ? '  --' : String(it).padStart(4)}  ${li === undefined ? '  --' : String(li).padStart(4)}`);
    });

    console.log('\n-- itens (com o piso de 90 cm²) --');
    built.items.forEach((s, i) => {
      const b = s.boxCm;
      if (!inBox(b)) return;
      const cols = [...new Set(built.objects[i].map((o) => hex(o.fill ?? o.stroke ?? null)))];
      console.log(`  item#${String(i).padStart(2)} [${b.x0.toFixed(0)},${b.y0.toFixed(0)} .. ${b.x1.toFixed(0)},${b.y1.toFixed(0)}] ${(b.x1 - b.x0).toFixed(0)}x${(b.y1 - b.y0).toFixed(0)}cm area=${s.areaCm2.toFixed(0)} partes=${s.partsCm.length} objs=${built.objects[i].length} cores=${cols.slice(0, 4).join(',')}${s.bleeds ? ' WRAP' : ''}`);
    });

    // itens que o piso engoliu
    const keptKeys = new Set(built.items.map((s) => `${s.bbox.x0.toFixed(2)}|${s.bbox.y0.toFixed(2)}|${s.bbox.x1.toFixed(2)}|${s.bbox.y1.toFixed(2)}`));
    const dropped = loose.items.filter((s) => !keptKeys.has(`${s.bbox.x0.toFixed(2)}|${s.bbox.y0.toFixed(2)}|${s.bbox.x1.toFixed(2)}|${s.bbox.y1.toFixed(2)}`));
    console.log(`\n-- ${dropped.length} item(ns) DESCARTADO(S) pelo piso minAreaCm2=${GR.minAreaCm2} (item mudo) --`);
    dropped.forEach((s) => {
      const b = s.boxCm;
      const near = built.items
        .map((o) => ({ o, d: gapBetween(s.boxCm, o.boxCm) }))
        .sort((a, b2) => a.d - b2.d)[0];
      console.log(`   [${b.x0.toFixed(0)},${b.y0.toFixed(0)} .. ${b.x1.toFixed(0)},${b.y1.toFixed(0)}] ${(b.x1 - b.x0).toFixed(1)}x${(b.y1 - b.y0).toFixed(1)}cm area=${s.areaCm2.toFixed(0)}  item vizinho a ${near ? near.d.toFixed(1) : '?'} cm`);
    });
  });
  await doc.destroy();
}

// ------------------------------------------------------- censo de órfãos
//
// Órfão = item de UMA subforma-peça só, área pequena, cuja caixa está a menos
// de meia altura do item maior mais próximo E compartilha a faixa vertical
// dele (a linha de base, não a caixa: sobreposição no eixo Y contra o run
// inteiro). É o candidato natural a virar sufixo/prefixo do vizinho.

const ORPHAN_MAX_AREA = 900;     // cm² — um ícone de 30x30 ainda é vizinho pequeno
const ORPHAN_HEIGHT_FRAC = 0.75; // altura do órfão contra a altura do run
const BAND_FRAC = 0.5;           // fração da altura do órfão dentro da faixa do run

function orphansOfFace(items) {
  const out = [];
  items.forEach((s, i) => {
    if (s.bleeds) return;
    if (s.partsCm.length > 1) return;
    const b = s.boxCm;
    const h = b.y1 - b.y0, w = b.x1 - b.x0;
    if (s.areaCm2 > ORPHAN_MAX_AREA) return;
    let best = null;
    items.forEach((o, j) => {
      if (i === j || o.bleeds) return;
      const ob = o.boxCm;
      const oh = ob.y1 - ob.y0;
      if (o.areaCm2 <= s.areaCm2) return;
      if (h > oh * ORPHAN_HEIGHT_FRAC) return;
      const d = gapBetween(b, ob);
      if (d > Math.max(h, oh) * 0.5) return;
      // compartilha a faixa vertical do run inteiro?
      const band = Math.min(b.y1, ob.y1) - Math.max(b.y0, ob.y0);
      if (band < h * BAND_FRAC) return;
      if (!best || d < best.d) best = { j, d, oh, band, ob, oa: o.areaCm2 };
    });
    if (best) out.push({ i, b, w, h, area: s.areaCm2, ...best });
  });
  return out;
}

async function census(dir) {
  const files = walk(dir);
  const perFile = [];
  let totalItems = 0, totalOrphans = 0, totalDropped = 0, facesSeen = 0, filesRead = 0;
  const gapHist = [], heightRatio = [], colorDelta = [];
  for (const f of files) {
    let doc = null;
    try {
      doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
      const page = await doc.getPage(1);
      const g = await readPageGeometry(page);
      const rects = panelRects(g);
      if (!rects.length) { await doc.destroy(); continue; }
      filesRead++;
      let orph = 0, items = 0, dropped = 0;
      const detail = [];
      for (const R of rects) {
        const scale = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
        const { pieces } = classify(g, scale, GR);
        const built = buildItems(pieces, scale, GR);
        const loose = buildItems(pieces, scale, { ...GR, minAreaCm2: 0 });
        facesSeen++;
        items += built.items.length;
        dropped += loose.items.length - built.items.length;
        const os = orphansOfFace(built.items);
        orph += os.length;
        for (const o of os) {
          gapHist.push(o.d);
          heightRatio.push(o.h / o.oh);
          detail.push(`${o.w.toFixed(0)}x${o.h.toFixed(0)}cm a ${o.d.toFixed(1)}cm de um ${(o.ob.x1 - o.ob.x0).toFixed(0)}x${o.oh.toFixed(0)}`);
        }
      }
      totalItems += items; totalOrphans += orph; totalDropped += dropped;
      if (orph || dropped) perFile.push({ f: f.split('/').pop(), orph, dropped, items, detail });
      await doc.destroy();
    } catch { try { await doc?.destroy(); } catch { /* */ } }
  }
  const q = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] : 0);
  console.log(`acervo: ${filesRead} arquivos legíveis, ${facesSeen} faces, ${totalItems} itens`);
  console.log(`ÓRFÃOS: ${totalOrphans} (${(100 * totalOrphans / Math.max(1, totalItems)).toFixed(1)}% dos itens; ${(totalOrphans / Math.max(1, facesSeen)).toFixed(2)}/face)`);
  console.log(`MUDOS (piso ${GR.minAreaCm2} cm²): ${totalDropped} (${(totalDropped / Math.max(1, facesSeen)).toFixed(2)}/face)`);
  console.log(`folga órfão→run: p25=${q(gapHist, .25).toFixed(1)} p50=${q(gapHist, .5).toFixed(1)} p75=${q(gapHist, .75).toFixed(1)} p90=${q(gapHist, .9).toFixed(1)} cm`);
  console.log(`razão de altura: p25=${q(heightRatio, .25).toFixed(2)} p50=${q(heightRatio, .5).toFixed(2)} p75=${q(heightRatio, .75).toFixed(2)}`);
  const top = Number(opt('--top', 20));
  console.log(`\n-- ${top} piores arquivos (órfãos + mudos) --`);
  perFile.sort((a, b) => (b.orph + b.dropped) - (a.orph + a.dropped));
  perFile.slice(0, top).forEach((p) => {
    console.log(`  ${String(p.orph).padStart(3)} órfãos ${String(p.dropped).padStart(3)} mudos  de ${String(p.items).padStart(3)} itens  ${p.f}`);
    p.detail.slice(0, 3).forEach((d) => console.log(`        ${d}`));
  });
}


// ------------------------------------------------ cotas do projetista

const DIM_RGB = [0x33, 0x74, 0xa9];
const near = (a, b, t) => Math.abs(a - b) <= t;

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
    out.push(best && best.err < Math.max(6, target * 0.06) ? { v, vert, ...best, ok: true } : { v, vert, ok: false, lx: cx, ly: cy });
  }
  return out;
}

async function dumpDims(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const g = await readPageGeometry(page);
  const tc = await page.getTextContent();
  const rects = panelRects(g);
  const ds = designerDims(g, tc.items);
  console.log(`# ${file.split('/').pop()}  ${ds.length} rotulos`);
  rects.forEach((R, i) => console.log(`face#${i} pt [${R.x0.toFixed(0)},${R.y0.toFixed(0)}..${R.x1.toFixed(0)},${R.y1.toFixed(0)}] = ${((R.x1-R.x0)/PT_CM).toFixed(0)}x${((R.y1-R.y0)/PT_CM).toFixed(0)}cm`));
  for (const d of ds) {
    if (!d.ok) { console.log(`  ${String(d.v).padStart(6)} ${d.vert?'V':'H'}  NAO RESOLVIDA (rotulo em pt ${d.lx.toFixed(0)},${d.ly.toFixed(0)})`); continue; }
    const fi = rects.findIndex((R) => d.ax > (d.vert ? R.x0 : R.y0) - 90 && d.ax < (d.vert ? R.x1 : R.y1) + 90 && d.a > (d.vert ? R.y0 : R.x0) - 90 && d.b < (d.vert ? R.y1 : R.x1) + 90);
    const R = rects[fi] ?? rects[0];
    const A = d.vert ? (d.a - R.y0) / PT_CM : (d.a - R.x0) / PT_CM;
    const B = d.vert ? (d.b - R.y0) / PT_CM : (d.b - R.x0) / PT_CM;
    const AX = d.vert ? (d.ax - R.x0) / PT_CM : (d.ax - R.y0) / PT_CM;
    console.log(`  ${String(d.v).padStart(6)} ${d.vert?'V':'H'}  face#${fi}  ${A.toFixed(1).padStart(8)} -> ${B.toFixed(1).padStart(8)}  (linha em ${AX.toFixed(0)})`);
  }
  await doc.destroy();
}

if (flag('--dims')) await dumpDims(TARGET);
else if (flag('--orphans')) await census(TARGET);
else await dissect(TARGET);
