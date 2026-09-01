/**
 * Bancada de EVIDÊNCIA: mede como o projetista humano cota, cota a cota.
 *
 * Não avalia o motor. Extrai a geometria REAL das cotas azuis desenhadas nos
 * PDFs (linha de cota, linhas de extensão, rótulo) e a cruza com os adesivos
 * que o motor enxerga, para responder: quantas cotas por face, quais elementos
 * ficam sem cota, qual o afastamento da linha, se as cotas se cruzam.
 *
 * Saída: JSONL em três arquivos (dims, faces, files) + stickers.
 *   node evidence.mjs <pasta> <prefixo-de-saída>
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, findPanel, classify, buildStickers, buildWraps, borderCrossings,
        DEFAULT_GROUPING, detectScaleFrom } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10;
const DIM_RGB = [0x33, 0x74, 0xa9];
const near = (a, b, t) => Math.abs(a - b) <= t;
const walk = (d, o = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p);
  }
  return o;
};

/** Segmentos azuis da página, separados por orientação. */
function blueSegments(g) {
  const blue = g.objects.filter(o => o.stroke && near(o.stroke[0], DIM_RGB[0], 12) &&
    near(o.stroke[1], DIM_RGB[1], 12) && near(o.stroke[2], DIM_RGB[2], 12));
  const hor = [], ver = [];
  for (const o of blue) for (const poly of o.outline) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    if (Math.abs(a.y - b.y) < 0.6 && Math.abs(a.x - b.x) >= 1)
      hor.push({ lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), at: (a.y + b.y) / 2, w: o.lineWidth });
    else if (Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) >= 1)
      ver.push({ lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), at: (a.x + b.x) / 2, w: o.lineWidth });
  }
  return { blue, hor, ver };
}

/**
 * Cotas do projetista, com a geometria completa.
 * `vert` = cota que mede ao longo de Y (linha de cota vertical).
 */
function designerDims(g, items) {
  const { hor, ver } = blueSegments(g);
  const out = [];
  for (const t of items) {
    const v = Number(String(t.str).replace(/cm/gi, '').trim().replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0 || v > 3000) continue;
    const m = t.transform, vert = Math.abs(m[1]) > Math.abs(m[0]);
    const fontPt = Math.hypot(m[0], m[1]) || Math.hypot(m[2], m[3]);
    const cx = m[4] + (vert ? 0 : t.width / 2), cy = g.height - m[5] - (vert ? t.width / 2 : 0);
    const target = v * PT_CM;
    const lineSegs = vert ? ver : hor, extSegs = vert ? hor : ver;
    let best = null;
    for (const ax of new Set(lineSegs.filter(s => Math.abs(s.at - (vert ? cx : cy)) < 45).map(s => +s.at.toFixed(1)))) {
      const pts = [...new Set(extSegs.filter(s => s.lo - 6 <= ax && ax <= s.hi + 6).map(s => +s.at.toFixed(1)))].sort((p, q) => p - q);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const err = Math.abs(pts[j] - pts[i] - target);
        if (!best || err < best.err) best = { err, ax, a: pts[i], b: pts[j] };
      }
    }
    if (!best || best.err >= Math.max(6, target * 0.06)) continue;
    // extensão em cada âncora: extensão perpendicular que toca a linha de cota
    const extentOf = (anchor) => {
      const hit = extSegs.filter(s => Math.abs(s.at - anchor) < 0.8 && s.lo - 6 <= best.ax && best.ax <= s.hi + 6);
      if (!hit.length) return null;
      return { lo: Math.min(...hit.map(s => s.lo)), hi: Math.max(...hit.map(s => s.hi)) };
    };
    // linha de cota: extensão real do traço azul no eixo da cota
    const lineHit = lineSegs.filter(s => Math.abs(s.at - best.ax) < 0.8 &&
      s.hi >= best.a - 3 && s.lo <= best.b + 3);
    const line = lineHit.length
      ? { lo: Math.min(...lineHit.map(s => s.lo)), hi: Math.max(...lineHit.map(s => s.hi)) }
      : { lo: best.a, hi: best.b };
    const strokes = lineHit.map(s => s.w).filter(Number.isFinite);
    out.push({ v, vert, ax: best.ax, a: best.a, b: best.b, err: best.err,
               extA: extentOf(best.a), extB: extentOf(best.b), line, fontPt,
               lineWidth: strokes.length ? strokes[0] : null });
  }
  return out;
}

/** Faces do arquivo: retângulos grandes que não estão dentro de outro. */
function panelRects(g) {
  const cands = g.objects.filter(o => o.outline.length === 1 &&
    (o.outline[0].length === 4 || o.outline[0].length === 5) &&
    (o.bbox.x1 - o.bbox.x0) / PT_CM >= 300 && (o.bbox.y1 - o.bbox.y0) / PT_CM >= 140 &&
    (o.bbox.x1 - o.bbox.x0) < g.width * 0.99);
  cands.sort((a, b) => (b.bbox.x1 - b.bbox.x0) * (b.bbox.y1 - b.bbox.y0) - (a.bbox.x1 - a.bbox.x0) * (a.bbox.y1 - a.bbox.y0));
  const keep = [];
  for (const c of cands) {
    const r = c.bbox;
    if (keep.some(k => Math.abs(k.x0 - r.x0) < 6 && Math.abs(k.x1 - r.x1) < 6 && Math.abs(k.y0 - r.y0) < 6 && Math.abs(k.y1 - r.y1) < 6)) continue;
    if (keep.some(k => k.x0 - 3 <= r.x0 && r.x1 <= k.x1 + 3 && k.y0 - 3 <= r.y0 && r.y1 <= k.y1 + 3)) continue;
    keep.push(r);
  }
  return keep;
}

/** Cruzamento próprio (interior) entre dois segmentos ortogonais. */
function crossesProper(p, q, margin = 1) {
  // p e q em forma {axis:'H'|'V', at, lo, hi}
  if (p.axis === q.axis) {
    if (Math.abs(p.at - q.at) > margin) return false;
    return Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) > margin; // sobreposição colinear
  }
  const h = p.axis === 'H' ? p : q, v = p.axis === 'H' ? q : p;
  return h.lo + margin < v.at && v.at < h.hi - margin &&
         v.lo + margin < h.at && h.at < v.hi - margin;
}

const files = walk(process.argv[2]);
const outPrefix = process.argv[3] ?? '/tmp/evidence';
const dimRows = [], faceRows = [], fileRows = [], stickerRows = [];
const GR = { ...DEFAULT_GROUPING, alignEdges: true };

let done = 0;
for (const f of files) {
  const name = f.split('/').pop();
  let doc, page, g, tc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    page = await doc.getPage(1);
    g = await readPageGeometry(page);
    tc = await page.getTextContent();
  } catch (e) { fileRows.push({ file: name, error: String(e).slice(0, 80) }); continue; }
  done++;
  const { blue } = blueSegments(g);
  const ref = designerDims(g, tc.items);
  const rects = panelRects(g);
  let scale = null;
  try { scale = detectScaleFrom(g, tc.items); } catch {}

  // cor exata dos traços azuis
  const colorTally = new Map();
  for (const o of blue) {
    const k = o.stroke.map(c => Math.round(c)).join(',');
    colorTally.set(k, (colorTally.get(k) ?? 0) + 1);
  }
  // largura de traço dos objetos azuis
  const widths = blue.map(o => +Number(o.lineWidth ?? 0).toFixed(2));
  // rótulos: corpo da fonte
  const fonts = ref.map(d => +d.fontPt.toFixed(1));

  // empilhamento das faces
  let stacking = 'n/a';
  if (rects.length >= 2) {
    const sorted = [...rects].sort((a, b) => a.y0 - b.y0);
    let vstack = 0, hstack = 0;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const xOv = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const yOv = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (xOv > 0 && yOv <= 0) vstack++; else if (yOv > 0 && xOv <= 0) hstack++;
    }
    stacking = vstack > hstack ? 'vertical' : hstack > vstack ? 'horizontal' : 'misto';
  }

  fileRows.push({
    file: name, pages: doc.numPages, objects: g.objects.length, blueObjects: blue.length,
    designerDims: ref.length, faceRects: rects.length, stacking,
    scaleDen: scale?.denominator ?? null, scaleAgree: scale?.agree ?? null,
    scaleLabels: scale?.labels ?? null, scaleSource: scale?.source ?? null,
    colors: [...colorTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    widthMode: mode(widths), fontMode: mode(fonts),
    pageW: +g.width.toFixed(1), pageH: +g.height.toFixed(1),
  });

  if (!rects.length) { await doc.destroy(); continue; }

  // cada cota do projetista fica com a face cujo eixo ela encosta
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

  rects.forEach((R, fi) => {
    const widthCm = (R.x1 - R.x0) / PT_CM, heightCm = (R.y1 - R.y0) / PT_CM;
    const match = { ptPerCm: PT_CM, panelPt: R, from: 'rectangle', aspectErrorPct: 0 };
    const panel = { side: 'MOTORISTA', heightCm: Math.round(heightCm), sections: [{ widthCm: Math.round(widthCm), isDoor: false }] };
    let elements, bleeds, stickers, wraps, crossings;
    try {
      ({ elements, bleeds } = classify(g, match, GR));
      stickers = buildStickers(elements, match, GR);
      wraps = buildWraps(bleeds, match, GR);
      crossings = borderCrossings(bleeds, panel, match, GR);
    } catch { return; }

    const toCmX = p => (p - R.x0) / PT_CM, toCmY = p => (p - R.y0) / PT_CM;
    // cor dominante por elemento, para contar cores dentro de um adesivo
    const elCm = elements.map(o => ({
      x0: toCmX(o.bbox.x0), x1: toCmX(o.bbox.x1), y0: toCmY(o.bbox.y0), y1: toCmY(o.bbox.y1),
      color: (o.fill ?? o.stroke ?? [0, 0, 0]).map(c => Math.round(c / 24)).join(','),
      op: o.op,
    }));

    // adesivos em cm + cores/repetição
    const st = stickers.map((s, i) => {
      const inside = elCm.filter(e => e.x0 >= s.boxCm.x0 - 0.5 && e.x1 <= s.boxCm.x1 + 0.5 &&
        e.y0 >= s.boxCm.y0 - 0.5 && e.y1 <= s.boxCm.y1 + 0.5);
      // objetos que a peça REALMENTE contém: centro dentro de uma das partes soldadas
      const owned = elCm.filter(e => {
        const mx = (e.x0 + e.x1) / 2, my = (e.y0 + e.y1) / 2;
        return s.partsCm.some(p => mx >= p.x0 - 0.5 && mx <= p.x1 + 0.5 && my >= p.y0 - 0.5 && my <= p.y1 + 0.5);
      });
      return {
        i, box: s.boxCm, aligned: s.alignedBoxCm, area: s.areaCm2, parts: s.parts.length,
        colors: new Set(inside.map(e => e.color)).size, objects: inside.length,
        ownedObjects: owned.length, ownedColors: new Set(owned.map(e => e.color)).size,
        ownedImages: owned.filter(e => e.op === 'image').length,
        images: inside.filter(e => e.op === 'image').length,
        w: s.boxCm.x1 - s.boxCm.x0, h: s.boxCm.y1 - s.boxCm.y0,
      };
    });
    // repetição: mesmo tamanho (±5%) em outro lugar da face
    st.forEach(s => {
      s.repeats = st.filter(o => o !== s && Math.abs(o.w - s.w) < 0.05 * Math.max(o.w, s.w) &&
        Math.abs(o.h - s.h) < 0.05 * Math.max(o.h, s.h)).length;
    });
    // envelopamentos: quantas bordas encostam
    const wrapRows = wraps.map(w => {
      const b = w.boxCm, tol = 1.5;
      const edges = (b.x0 <= tol ? 1 : 0) + (b.y0 <= tol ? 1 : 0) +
        (b.x1 >= widthCm - tol ? 1 : 0) + (b.y1 >= heightCm - tol ? 1 : 0);
      return { edges, area: w.areaCm2, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    });

    const dims = owned[fi];
    const faceDims = [];
    for (const d of dims) {
      const axis = d.vert ? 'V' : 'H';
      const axCm = d.vert ? toCmX(d.ax) : toCmY(d.ax);
      const aCm = d.vert ? toCmY(d.a) : toCmX(d.a);
      const bCm = d.vert ? toCmY(d.b) : toCmX(d.b);
      const span = d.vert ? heightCm : widthCm, perp = d.vert ? widthCm : heightCm;
      const cvt = d.vert ? toCmX : toCmY; // extensões são perpendiculares
      const extCm = e => e ? { lo: cvt(e.lo), hi: cvt(e.hi) } : null;
      const eA = extCm(d.extA), eB = extCm(d.extB);
      const far = e => e ? (Math.abs(e.hi - axCm) > Math.abs(e.lo - axCm) ? e.hi : e.lo) : null;
      const nearEnd = e => e ? (Math.abs(e.hi - axCm) > Math.abs(e.lo - axCm) ? e.lo : e.hi) : null;
      const tieA = far(eA), tieB = far(eB);
      const ties = [tieA, tieB].filter(v => v !== null);
      const tie = ties.length ? ties.reduce((x, y) => x + y, 0) / ties.length : null;
      const lineLo = d.vert ? toCmY(d.line.lo) : toCmX(d.line.lo);
      const lineHi = d.vert ? toCmY(d.line.hi) : toCmX(d.line.hi);

      // âncora → adesivo (com verificação perpendicular)
      const matchAnchor = (val) => {
        let bestS = null, bestD = 3.0, bestEdge = null;
        for (const s of st) {
          const cands = d.vert
            ? [['TOP', s.box.y0], ['BOTTOM', s.box.y1]]
            : [['LEFT', s.box.x0], ['RIGHT', s.box.x1]];
          const perpLo = d.vert ? s.box.x0 : s.box.y0, perpHi = d.vert ? s.box.x1 : s.box.y1;
          const perpOk = tie === null ? true : (tie >= perpLo - 25 && tie <= perpHi + 25);
          for (const [e, v] of cands) {
            const dd = Math.abs(val - v);
            if (dd < bestD && perpOk) { bestD = dd; bestS = s; bestEdge = e; }
          }
        }
        return bestS ? { i: bestS.i, edge: bestEdge, err: bestD, s: bestS } : null;
      };
      const isEdge = v => Math.abs(v) < 2.5 ? 'FACE_INI' : Math.abs(v - span) < 2.5 ? 'FACE_FIM' : null;
      const kindA = isEdge(aCm), kindB = isEdge(bCm);
      const mA = kindA ? null : matchAnchor(aCm), mB = kindB ? null : matchAnchor(bCm);

      const row = {
        file: name, face: fi, w: +widthCm.toFixed(1), h: +heightCm.toFixed(1),
        axis, v: d.v, a: +aCm.toFixed(1), b: +bCm.toFixed(1), ax: +axCm.toFixed(1),
        span: +span.toFixed(1), perp: +perp.toFixed(1),
        tieA: tieA === null ? null : +tieA.toFixed(1), tieB: tieB === null ? null : +tieB.toFixed(1),
        tie: tie === null ? null : +tie.toFixed(1),
        overA: eA ? +Math.abs(nearEnd(eA) - axCm).toFixed(1) : null,
        overB: eB ? +Math.abs(nearEnd(eB) - axCm).toFixed(1) : null,
        offset: tie === null ? null : +Math.abs(tie - axCm).toFixed(1),
        inside: axCm >= 0 && axCm <= perp ? 1 : 0,
        outSide: axCm < 0 ? 'min' : axCm > perp ? 'max' : 'in',
        tieBorderDist: tie === null ? null : +Math.min(Math.abs(tie), Math.abs(perp - tie)).toFixed(1),
        kindA: kindA ?? (mA ? `ST${mA.i}_${mA.edge}` : '?'),
        kindB: kindB ?? (mB ? `ST${mB.i}_${mB.edge}` : '?'),
        stA: mA ? mA.i : null, stB: mB ? mB.i : null,
        stAparts: mA ? mA.s.parts : null, stAcolors: mA ? mA.s.ownedColors : null, stAobjs: mA ? mA.s.ownedObjects : null,
        stAimgs: mA ? mA.s.ownedImages : null, stAarea: mA ? +mA.s.area.toFixed(0) : null,
        stBparts: mB ? mB.s.parts : null, stBcolors: mB ? mB.s.ownedColors : null, stBobjs: mB ? mB.s.ownedObjects : null,
        stBimgs: mB ? mB.s.ownedImages : null, stBarea: mB ? +mB.s.area.toFixed(0) : null,
        lineLo: +lineLo.toFixed(1), lineHi: +lineHi.toFixed(1),
        fontPt: +d.fontPt.toFixed(1), stroke: d.lineWidth,
      };
      // SONDA DE LINHA DE BASE: escolhe o bloco pela sobreposição perpendicular,
      // não pela distância vertical — senão a escolha já decide a resposta.
      if (d.vert) for (const [tag, val] of [['A', aCm], ['B', bCm]]) {
        if (tie === null) continue;
        let pick = null;
        for (const s of st) {
          const hh = s.box.y1 - s.box.y0;
          if (hh <= 3) continue;
          if (tie < s.box.x0 - 20 || tie > s.box.x1 + 20) continue;
          if (val < s.box.y0 - 0.10 * hh || val > s.box.y1 + 0.10 * hh) continue;
          if (!pick || hh > pick.h) pick = { s, h: hh };
        }
        if (!pick) continue;
        const s = pick.s, hh = pick.h;
        const dTop = (val - s.box.y0) / hh, dBot = (s.box.y1 - val) / hh;
        const edge = dTop <= dBot ? 'TOP' : 'BOTTOM';
        row[`probe${tag}`] = +(edge === 'TOP' ? dTop : dBot).toFixed(4);
        row[`probeEdge${tag}`] = edge;
        row[`probeH${tag}`] = +hh.toFixed(1);
        row[`probeParts${tag}`] = s.parts;
        row[`probeObjs${tag}`] = s.ownedObjects;
        const alg = edge === 'TOP' ? (s.aligned.y0 - s.box.y0) / hh : (s.box.y1 - s.aligned.y1) / hh;
        row[`probeAlg${tag}`] = +alg.toFixed(4);
      }
      // desvio da âncora vertical em relação ao extremo absoluto do adesivo
      for (const [tag, m, val] of [['A', mA, aCm], ['B', mB, bCm]]) {
        if (!m || !d.vert) continue;
        const s = m.s, hh = s.box.y1 - s.box.y0;
        const abs = m.edge === 'TOP' ? s.box.y0 : s.box.y1;
        const alg = m.edge === 'TOP' ? s.aligned.y0 : s.aligned.y1;
        const inward = m.edge === 'TOP' ? (val - abs) : (abs - val);
        row[`inFrac${tag}`] = hh > 0 ? +(inward / hh).toFixed(4) : null;
        row[`algFrac${tag}`] = hh > 0 ? +(((m.edge === 'TOP' ? alg - abs : abs - alg)) / hh).toFixed(4) : null;
        row[`blockH${tag}`] = +hh.toFixed(1);
        row[`blockParts${tag}`] = s.parts;
      }
      dimRows.push(row);
      faceDims.push({ ...row, axisV: d.vert, eA, eB, axCm, aCm, bCm, lineLo, lineHi });
    }

    // cruzamentos entre as cotas humanas desta face
    const segs = faceDims.map((d, i) => {
      const lineAxis = d.axisV ? 'V' : 'H';
      const line = { axis: lineAxis, at: d.axCm, lo: Math.min(d.lineLo, d.lineHi), hi: Math.max(d.lineLo, d.lineHi), i };
      const exts = [];
      for (const [e, at] of [[d.eA, d.aCm], [d.eB, d.bCm]]) {
        if (!e) continue;
        exts.push({ axis: d.axisV ? 'H' : 'V', at, lo: Math.min(e.lo, e.hi), hi: Math.max(e.lo, e.hi), i });
      }
      return { line, exts };
    });
    let xLineLine = 0, xExtLine = 0, xExtLineSameAxis = 0, xExtExt = 0, pairs = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      pairs++;
      if (crossesProper(segs[i].line, segs[j].line)) xLineLine++;
      const sameAxis = segs[i].line.axis === segs[j].line.axis;
      for (const e of segs[i].exts) if (crossesProper(e, segs[j].line)) { xExtLine++; if (sameAxis) xExtLineSameAxis++; }
      for (const e of segs[j].exts) if (crossesProper(e, segs[i].line)) { xExtLine++; if (sameAxis) xExtLineSameAxis++; }
      for (const e of segs[i].exts) for (const e2 of segs[j].exts) if (crossesProper(e, e2)) xExtExt++;
    }

    // que adesivos receberam cota
    const anchored = new Set();
    for (const d of faceDims) { if (d.stA !== null) anchored.add(d.stA); if (d.stB !== null) anchored.add(d.stB); }
    const dimsPerSticker = new Map();
    for (const d of faceDims) for (const s of [d.stA, d.stB]) {
      if (s === null) continue;
      const cur = dimsPerSticker.get(s) ?? { H: 0, V: 0, leftToFace: 0, rightToFace: 0, topToFace: 0, botToFace: 0 };
      if (d.axis === 'H') {
        cur.H++;
        if (d.kindA === 'FACE_INI') cur.leftToFace++;
        if (d.kindB === 'FACE_FIM') cur.rightToFace++;
      } else {
        cur.V++;
        if (d.kindA === 'FACE_INI') cur.topToFace++;
        if (d.kindB === 'FACE_FIM') cur.botToFace++;
      }
      dimsPerSticker.set(s, cur);
    }
    for (const s of st) {
      const c = dimsPerSticker.get(s.i);
      stickerRows.push({
        file: name, face: fi, i: s.i, area: +s.area.toFixed(1), w: +s.w.toFixed(1), h: +s.h.toFixed(1),
        parts: s.parts, colors: s.colors, objects: s.objects, images: s.images, repeats: s.repeats,
        ownedObjects: s.ownedObjects, ownedColors: s.ownedColors, ownedImages: s.ownedImages,
        cx: +((s.box.x0 + s.box.x1) / 2).toFixed(1), cy: +((s.box.y0 + s.box.y1) / 2).toFixed(1),
        faceW: +widthCm.toFixed(1), faceH: +heightCm.toFixed(1),
        dimsH: c?.H ?? 0, dimsV: c?.V ?? 0,
        leftToFace: c?.leftToFace ?? 0, rightToFace: c?.rightToFace ?? 0,
        topToFace: c?.topToFace ?? 0, botToFace: c?.botToFace ?? 0,
        anchored: anchored.has(s.i) ? 1 : 0,
        faceDims: faceDims.length, faceStickers: st.length,
      });
    }

    faceRows.push({
      file: name, face: fi, w: +widthCm.toFixed(1), h: +heightCm.toFixed(1),
      dims: faceDims.length, dimsH: faceDims.filter(d => d.axis === 'H').length,
      dimsV: faceDims.filter(d => d.axis === 'V').length,
      stickers: st.length, anchoredStickers: anchored.size, elements: elements.length,
      bleeds: bleeds.length, wraps: wraps.length, crossings: crossings.length,
      wrapEdges: wrapRows.map(w => w.edges),
      xLineLine, xExtLine, xExtLineSameAxis, xExtExt, pairs,
    });
  });
  await doc.destroy();
  if (done % 40 === 0) process.stderr.write(`  ${done}/${files.length}\n`);
}

function mode(arr) {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1);
  let best = null, n = 0;
  for (const [k, c] of m) if (c > n) { n = c; best = k; }
  return best === null ? null : [best, n, arr.length];
}

const jl = rows => rows.map(r => JSON.stringify(r)).join('\n');
writeFileSync(`${outPrefix}.dims.jsonl`, jl(dimRows));
writeFileSync(`${outPrefix}.faces.jsonl`, jl(faceRows));
writeFileSync(`${outPrefix}.files.jsonl`, jl(fileRows));
writeFileSync(`${outPrefix}.stickers.jsonl`, jl(stickerRows));
console.log(`arquivos lidos ${done}/${files.length}`);
console.log(`cotas ${dimRows.length}  faces ${faceRows.length}  adesivos ${stickerRows.length}`);
