/** A que geometria EXATA o projetista ancora cada cota. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, findPanel, classify, buildStickers, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10, DIM = [0x33, 0x74, 0xa9], TOL = 2.5;
const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p); } return o; };
const near = (a, b, t) => Math.abs(a - b) <= t;

function designerDims(g, items, H) {
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
    const cx = m[4] + (vert ? 0 : t.width/2), cy = H - m[5] - (vert ? t.width/2 : 0);
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

/** Extremos robustos de um conjunto: base tipográfica em vez do bbox. */
function robustExtremes(parts) {
  const tops = parts.map(p => p.y0).sort((a,b)=>a-b);
  const bots = parts.map(p => p.y1).sort((a,b)=>a-b);
  const lefts = parts.map(p => p.x0).sort((a,b)=>a-b);
  const rights = parts.map(p => p.x1).sort((a,b)=>a-b);
  const q = (arr, p) => arr[Math.min(arr.length-1, Math.max(0, Math.round((arr.length-1)*p)))];
  return { top: q(tops, 0), topQ: q(tops, .25), bottom: q(bots, 1), bottomQ: q(bots, .75),
           left: q(lefts, 0), right: q(rights, 1) };
}

const files = walk(process.argv[2]);
const tally = new Map();
const bump = k => tally.set(k, (tally.get(k) ?? 0) + 1);
let nfiles = 0, nanch = 0;
for (const f of files) {
  let doc, page, g, tc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    page = await doc.getPage(1); g = await readPageGeometry(page); tc = await page.getTextContent();
  } catch { continue; }
  const ref = designerDims(g, tc.items, g.height);
  if (ref.length < 3) { await doc.destroy(); continue; }
  const rects = g.objects.filter(o => o.outline.length <= 1 && (o.bbox.x1-o.bbox.x0)/PT_CM >= 350 &&
    (o.bbox.y1-o.bbox.y0)/PT_CM >= 150 && (o.bbox.x1-o.bbox.x0) < g.width*0.99 &&
    (o.outline[0]?.length === 4 || o.outline[0]?.length === 5));
  if (!rects.length) { await doc.destroy(); continue; }
  rects.sort((a,b)=>(b.bbox.x1-b.bbox.x0)*(b.bbox.y1-b.bbox.y0)-(a.bbox.x1-a.bbox.x0)*(a.bbox.y1-a.bbox.y0));
  const R = rects[0].bbox;
  const widthCm = Math.round((R.x1-R.x0)/PT_CM), heightCm = Math.round((R.y1-R.y0)/PT_CM);
  const panel = { side:'MOTORISTA', heightCm, sections:[{widthCm,isDoor:false}] };
  const match = findPanel(g, panel);
  const { elements, bleeds } = classify(g, match, DEFAULT_GROUPING);
  const stickers = buildStickers(elements, match, DEFAULT_GROUPING);
  const bleedCm = bleeds.map(o => ({ x0:(o.bbox.x0-R.x0)/PT_CM, x1:(o.bbox.x1-R.x0)/PT_CM,
                                     y0:(o.bbox.y0-R.y0)/PT_CM, y1:(o.bbox.y1-R.y0)/PT_CM, o }));
  nfiles++;
  for (const d of ref) {
    const vert = d.vert;
    const ax = vert ? (d.ax - R.x0)/PT_CM : (d.ax - R.y0)/PT_CM;
    const span = vert ? heightCm : widthCm, perp = vert ? widthCm : heightCm;
    const a = vert ? (d.a - R.y0)/PT_CM : (d.a - R.x0)/PT_CM;
    const b = vert ? (d.b - R.y0)/PT_CM : (d.b - R.x0)/PT_CM;
    if (ax < -70 || ax > perp+70 || b < -30 || a > span+30) continue;
    const labels = [];
    for (const val of [a, b]) {
      nanch++;
      let label = '?';
      if (Math.abs(val) < TOL) label = 'BORDA_INI';
      else if (Math.abs(val - span) < TOL) label = 'BORDA_FIM';
      else {
        for (const s of stickers) {
          const e = robustExtremes(s.partsCm);
          const cands = vert
            ? [['ADES_TOPO', s.boxCm.y0], ['ADES_BASE', s.boxCm.y1], ['PECA_BASE_TIP', e.bottomQ], ['PECA_TOPO_TIP', e.topQ]]
            : [['ADES_ESQ', s.boxCm.x0], ['ADES_DIR', s.boxCm.x1]];
          for (const [name, v] of cands) if (Math.abs(val - v) < TOL) { label = name; break; }
          if (label !== '?') break;
          for (const p of s.partsCm) {
            const c = vert ? [['PECA_TOPO', p.y0], ['PECA_BASE', p.y1]] : [['PECA_ESQ', p.x0], ['PECA_DIR', p.x1]];
            for (const [name, v] of c) if (Math.abs(val - v) < TOL) { label = name; break; }
            if (label !== '?') break;
          }
          if (label !== '?') break;
        }
      }
      if (label === '?') {
        for (const bl of bleedCm) {
          const c = vert ? [['SANGRA_TOPO', bl.y0], ['SANGRA_BASE', bl.y1]] : [['SANGRA_ESQ', bl.x0], ['SANGRA_DIR', bl.x1]];
          for (const [n2, v2] of c) if (Math.abs(val - v2) < TOL) { label = n2; break; }
          if (label !== '?') break;
        }
      }
      if (label === '?') {
        // travessia: onde a sangria cruza a aresta de cima/baixo
        for (const bl of bleedCm) {
          for (const [name, yEdge] of [['CRUZA_TOPO', 0], ['CRUZA_BASE', heightCm]]) {
            const yPt = R.y0 + (yEdge + (yEdge === 0 ? 1.5 : -1.5)) * PT_CM;
            if (bl.o.bbox.y0 > yPt || bl.o.bbox.y1 < yPt) continue;
            for (const poly of bl.o.outline) for (let i=0;i+1<poly.length;i++) {
              const p1 = poly[i], p2 = poly[i+1];
              if (p1.y === p2.y) continue;
              const lo = Math.min(p1.y,p2.y), hi = Math.max(p1.y,p2.y);
              if (yPt < lo || yPt >= hi) continue;
              const x = p1.x + ((yPt-p1.y)/(p2.y-p1.y))*(p2.x-p1.x);
              if (Math.abs(val - (x - R.x0)/PT_CM) < TOL) { label = name; break; }
            }
            if (label !== '?') break;
          }
          if (label !== '?') break;
        }
      }
      bump(`${vert ? 'V' : 'H'} ${label}`);
      labels.push(label);
    }
    bump(`PAR ${vert ? 'V' : 'H'} ${labels[0]} -> ${labels[1]}`);
  }
  await doc.destroy();
}
console.log(`faces ${nfiles}  âncoras ${nanch}\n`);
const single = [...tally.entries()].filter(([k])=>!k.startsWith('PAR ')).sort((a,b)=>b[1]-a[1]);
const tot = single.reduce((s,r)=>s+r[1],0);
console.log('--- ancoras isoladas ---');
for (const [k,v] of single) console.log(`  ${k.padEnd(22)} ${String(v).padStart(5)}  ${(100*v/tot).toFixed(1)}%`);
console.log('\n--- pares mais frequentes ---');
for (const [k,v] of [...tally.entries()].filter(([k])=>k.startsWith('PAR ')).sort((a,b)=>b[1]-a[1]).slice(0,24))
  console.log(`  ${k.slice(4).padEnd(34)} ${String(v).padStart(4)}`);
