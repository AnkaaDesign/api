/**
 * Bancada: roda o cotador em TODAS as faces de cada PDF e compara com as cotas
 * que o projetista desenhou no mesmo arquivo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, findPanel, classify, buildItems, borderCrossings,
        DEFAULT_GROUPING, planDimensions, DEFAULT_DOCTRINE } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10, DIM = [0x33, 0x74, 0xa9];
const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p); } return o; };
const near = (a, b, t) => Math.abs(a - b) <= t;

function designerDims(g, items) {
  const blue = g.objects.filter(o => o.stroke && near(o.stroke[0], DIM[0], 12) && near(o.stroke[1], DIM[1], 12) && near(o.stroke[2], DIM[2], 12));
  const Hs = [], Vs = [];
  for (const o of blue) for (const poly of o.outline) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    if (Math.abs(a.y - b.y) < .6 && Math.abs(a.x - b.x) >= 1) Hs.push([Math.min(a.x,b.x), Math.max(a.x,b.x), (a.y+b.y)/2]);
    else if (Math.abs(a.x - b.x) < .6 && Math.abs(a.y - b.y) >= 1) Vs.push([Math.min(a.y,b.y), Math.max(a.y,b.y), (a.x+b.x)/2]);
  }
  const out = [];
  for (const t of items) {
    const v = Number(String(t.str).replace(/cm/gi,'').trim().replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0 || v > 3000) continue;
    const m = t.transform, vert = Math.abs(m[1]) > Math.abs(m[0]);
    const cx = m[4] + (vert ? 0 : t.width/2), cy = g.height - m[5] - (vert ? t.width/2 : 0);
    const target = v * PT_CM; let best = null;
    for (const ax of new Set((vert?Vs:Hs).filter(s => Math.abs(s[2]-(vert?cx:cy)) < 45).map(s => +s[2].toFixed(1)))) {
      const pts = [...new Set((vert?Hs:Vs).filter(s => s[0]-6 <= ax && ax <= s[1]+6).map(s => +s[2].toFixed(1)))].sort((p,q)=>p-q);
      for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) {
        const err = Math.abs(pts[j]-pts[i]-target);
        if (!best || err < best.err) best = { err, ax, a: pts[i], b: pts[j] };
      }
    }
    if (best && best.err < Math.max(6, target*0.06)) out.push({ v, vert, ...best });
  }
  return out;
}

/** Faces do arquivo: retângulos grandes que não estão dentro de outro. */
function panelRects(g) {
  const cands = g.objects.filter(o => o.outline.length === 1 &&
    (o.outline[0].length === 4 || o.outline[0].length === 5) &&
    (o.bbox.x1-o.bbox.x0)/PT_CM >= 300 && (o.bbox.y1-o.bbox.y0)/PT_CM >= 140 &&
    (o.bbox.x1-o.bbox.x0) < g.width*0.99);
  cands.sort((a,b)=>(b.bbox.x1-b.bbox.x0)*(b.bbox.y1-b.bbox.y0)-(a.bbox.x1-a.bbox.x0)*(a.bbox.y1-a.bbox.y0));
  const keep = [];
  for (const c of cands) {
    const r = c.bbox;
    if (keep.some(k => Math.abs(k.x0-r.x0)<6 && Math.abs(k.x1-r.x1)<6 && Math.abs(k.y0-r.y0)<6 && Math.abs(k.y1-r.y1)<6)) continue;
    if (keep.some(k => k.x0-3 <= r.x0 && r.x1 <= k.x1+3 && k.y0-3 <= r.y0 && r.y1 <= k.y1+3)) continue;
    keep.push(r);
  }
  return keep;
}

const files = walk(process.argv[2]);
let nFaces = 0, nRef = 0, nGen = 0, nHit = 0;
const miss = {}, missAxis = {}, extra = {}, cov = {}, covValue = {}, cov2 = {};
const perFace = [];
for (const f of files) {
  let doc, page, g, tc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    page = await doc.getPage(1); g = await readPageGeometry(page); tc = await page.getTextContent();
  } catch { continue; }
  const ref = designerDims(g, tc.items);
  const rects = panelRects(g);
  if (ref.length < 2 || !rects.length) { await doc.destroy(); continue; }

  // cada cota do projetista fica com a face cujo EIXO ela encosta
  const owned = rects.map(() => []);
  for (const d of ref) {
    let best = -1, score = Infinity;
    rects.forEach((R, i) => {
      const W = (R.x1-R.x0)/PT_CM, H = (R.y1-R.y0)/PT_CM;
      const ax = d.vert ? (d.ax-R.x0)/PT_CM : (d.ax-R.y0)/PT_CM;
      const a = d.vert ? (d.a-R.y0)/PT_CM : (d.a-R.x0)/PT_CM;
      const b = d.vert ? (d.b-R.y0)/PT_CM : (d.b-R.x0)/PT_CM;
      const span = d.vert ? H : W, perp = d.vert ? W : H;
      if (ax < -70 || ax > perp+70 || b < -30 || a > span+30) return;
      const s = Math.abs(ax - perp/2) + Math.max(0,-a) + Math.max(0,b-span);
      if (s < score) { score = s; best = i; }
    });
    if (best >= 0) owned[best].push(d);
  }

  rects.forEach((R, i) => {
    if (owned[i].length < 2) return;
    const widthCm = Math.round((R.x1-R.x0)/PT_CM), heightCm = Math.round((R.y1-R.y0)/PT_CM);
    const panel = { side:'MOTORISTA', heightCm, sections:[{widthCm,isDoor:false}] };
    const match = { ptPerCm: PT_CM, panelPt: R, from:'rectangle', aspectErrorPct: 0 };
    const GR = { ...DEFAULT_GROUPING, ...JSON.parse(process.env.GROUPING ?? '{}') };
    const DO = { ...DEFAULT_DOCTRINE, ...JSON.parse(process.env.DOCTRINE ?? '{}') };
    const { pieces } = classify(g, match, GR);
    const built = buildItems(pieces, match, GR);
    const bleeds = pieces.filter((p) => p.bleedAxes.edges.length).map((p) => p.obj);
    const stickers = built.items;
    const crossings = borderCrossings(built.objects, panel, match, GR);
    const dims = planDimensions(panel, stickers, crossings, DO);
    const refP = owned[i].map(d => d.vert
      ? { axis:'V', a:(d.a-R.y0)/PT_CM, b:(d.b-R.y0)/PT_CM, v:d.v }
      : { axis:'H', a:(d.a-R.x0)/PT_CM, b:(d.b-R.x0)/PT_CM, v:d.v });
    const used = new Set(); let hits = 0;
    for (const gd of dims) for (let k = 0; k < refP.length; k++) {
      const r = refP[k];
      if (used.has(k) || r.axis !== gd.axis) continue;
      if (Math.abs(r.a-gd.aCm) <= 4 && Math.abs(r.b-gd.bCm) <= 4 && Math.abs(r.v-gd.valueCm) <= 3) { used.add(k); hits++; break; }
    }
    // por que a cota do projetista nao foi reproduzida
    for (let k = 0; k < refP.length; k++) {
      if (used.has(k)) continue;
      const r = refP[k];
      const sameAxis = dims.filter(d => d.axis === r.axis);
      const anchorsA = new Set(), anchorsB = new Set();
      for (const d of sameAxis) { anchorsA.add(+d.aCm.toFixed(1)); anchorsB.add(+d.bCm.toFixed(1)); }
      const hasA = [...anchorsA, ...anchorsB].some(v => Math.abs(v - r.a) <= 4);
      const hasB = [...anchorsA, ...anchorsB].some(v => Math.abs(v - r.b) <= 4);
      const isEdge = Math.abs(r.a) < 3 || Math.abs(r.b - (r.axis === 'H' ? widthCm : heightCm)) < 3;
      const why = hasA && hasB ? 'par-nao-emitido' : (hasA || hasB) ? (isEdge ? 'faltou-ancora-de-arte' : 'faltou-uma-ancora') : 'nenhuma-ancora';
      miss[why] = (miss[why] ?? 0) + 1;
      missAxis[`${r.axis} ${why}`] = (missAxis[`${r.axis} ${why}`] ?? 0) + 1;
    }
    // e quantas cotas geradas nao existem no projetista
    for (const d of dims) {
      const ok = refP.some(r => r.axis === d.axis && Math.abs(r.a-d.aCm) <= 4 && Math.abs(r.b-d.bCm) <= 4);
      if (!ok) extra[d.kind] = (extra[d.kind] ?? 0) + 1;
    }
    // COBERTURA: a ancora do projetista existe na geometria que o motor enxerga?
    const candH = new Set([0, widthCm]), candV = new Set([0, heightCm]);
    for (const st of stickers) {
      candH.add(st.boxCm.x0); candH.add(st.boxCm.x1);
      candV.add(st.boxCm.y0); candV.add(st.boxCm.y1);
      for (const pt of st.partsCm) { candH.add(pt.x0); candH.add(pt.x1); candV.add(pt.y0); candV.add(pt.y1); }
    }
    for (const c of crossings) { candH.add(c.startCm); candH.add(c.endCm); }
    for (const bl of bleeds) {
      candH.add((bl.bbox.x0-R.x0)/PT_CM); candH.add((bl.bbox.x1-R.x0)/PT_CM);
      candV.add((bl.bbox.y0-R.y0)/PT_CM); candV.add((bl.bbox.y1-R.y0)/PT_CM);
    }
    // pool ampliado: cada caminho isolado, sem agrupar
    const candH2 = new Set(candH), candV2 = new Set(candV);
    for (const el of elements) {
      candH2.add((el.bbox.x0-R.x0)/PT_CM); candH2.add((el.bbox.x1-R.x0)/PT_CM);
      candV2.add((el.bbox.y0-R.y0)/PT_CM); candV2.add((el.bbox.y1-R.y0)/PT_CM);
    }
    for (const r of refP) {
      const pool = r.axis === 'H' ? candH : candV;
      const ok = v => [...pool].some(c => Math.abs(c - v) <= 3);
      const a = ok(r.a), b = ok(r.b);
      cov[a && b ? 'ambas' : (a || b) ? 'uma' : 'nenhuma'] = (cov[a && b ? 'ambas' : (a || b) ? 'uma' : 'nenhuma'] ?? 0) + 1;
      if (a && b) covValue[Math.abs(r.v - Math.round(r.b - r.a)) <= 2 ? 'valor-bate' : 'valor-difere'] =
        (covValue[Math.abs(r.v - Math.round(r.b - r.a)) <= 2 ? 'valor-bate' : 'valor-difere'] ?? 0) + 1;
      const pool2 = r.axis === 'H' ? candH2 : candV2;
      const ok2 = v => [...pool2].some(c => Math.abs(c - v) <= 3);
      const a2 = ok2(r.a), b2 = ok2(r.b);
      cov2[a2 && b2 ? 'ambas' : (a2 || b2) ? 'uma' : 'nenhuma'] = (cov2[a2 && b2 ? 'ambas' : (a2 || b2) ? 'uma' : 'nenhuma'] ?? 0) + 1;
    }
    nFaces++; nRef += refP.length; nGen += dims.length; nHit += hits;
    perFace.push({ f: f.split('/').pop(), i, w:widthCm, h:heightCm, ref:refP.length, gen:dims.length, hit:hits, st:stickers.length, cr:crossings.length });
    if (process.env.DUMP && f.includes(process.env.DUMP)) {
      console.log(`\n### ${f.split('/').pop()} face#${i} ${widthCm}x${heightCm}`);
      for (const s of stickers) console.log(`   adesivo x[${s.boxCm.x0.toFixed(0)}..${s.boxCm.x1.toFixed(0)}] y[${s.boxCm.y0.toFixed(0)}..${s.boxCm.y1.toFixed(0)}] pecas=${s.parts.length}`);
      console.log('   GERADAS:'); for (const d of dims) console.log(`     ${String(d.valueCm).padStart(5)} ${d.axis} ${d.kind.padEnd(12)} ${d.aCm.toFixed(1)} -> ${d.bCm.toFixed(1)}`);
      console.log('   PROJETISTA:'); for (const r of refP) console.log(`     ${String(r.v).padStart(5)} ${r.axis} ${r.a.toFixed(1)} -> ${r.b.toFixed(1)}`);
    }
  });
  await doc.destroy();
}
console.log(`\nfaces avaliadas ${nFaces} em ${new Set(perFace.map(p=>p.f)).size} arquivos`);
console.log(`cotas do projetista ${nRef}   geradas ${nGen}   coincidentes ${nHit}`);
console.log(`recall ${(100*nHit/Math.max(nRef,1)).toFixed(1)}%   precisão ${(100*nHit/Math.max(nGen,1)).toFixed(1)}%`);
const st = perFace.map(p=>p.st).sort((a,b)=>a-b);
console.log(`adesivos por face: mediana ${st[st.length>>1]}  p90 ${st[Math.floor(st.length*0.9)]}`);
const full = perFace.filter(p=>p.hit===p.ref).length;
console.log(`faces com recall 100%: ${full}/${nFaces}`);
console.log('\n-- COBERTURA: ancoras do projetista presentes na geometria lida --');
{ const t = Object.values(cov).reduce((a,b)=>a+b,0);
  for (const [k,v] of Object.entries(cov).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(10)} ${String(v).padStart(5)}  ${(100*v/t).toFixed(1)}%`);
  console.log('   (das cotas com as duas ancoras presentes:', JSON.stringify(covValue), ')');
  const t2 = Object.values(cov2).reduce((a,b)=>a+b,0);
  console.log('   com o pool AMPLIADO (cada caminho isolado):');
  for (const [k,v] of Object.entries(cov2).sort((a,b)=>b[1]-a[1])) console.log(`     ${k.padEnd(10)} ${String(v).padStart(5)}  ${(100*v/t2).toFixed(1)}%`); }
console.log('\n-- por que a cota do projetista escapou --');
for (const [k,v] of Object.entries(missAxis).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(28)} ${v}`);
console.log('\n-- cotas geradas que o projetista nao desenhou --');
for (const [k,v] of Object.entries(extra).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(16)} ${v}`);
