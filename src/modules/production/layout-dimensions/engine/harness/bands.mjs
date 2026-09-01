/**
 * Taxonomy study for bands, stripes and large ornaments.
 *
 * Measures, per face: the geometric signature of every bleeding element and
 * which of its edges the designer actually dimensioned.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, findPanel, classify, buildStickers, buildWraps, borderCrossings, DEFAULT_GROUPING } =
  await import(`${LIB}/core.js`);

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

/** shoelace over every subpath; holes subtract because they wind the other way */
function polyArea(outline) {
  let a = 0;
  for (const poly of outline) {
    for (let i = 0; i + 1 < poly.length; i++) a += poly[i].x * poly[i+1].y - poly[i+1].x * poly[i].y;
    if (poly.length > 2) { const p = poly[poly.length-1], q = poly[0]; a += p.x*q.y - q.x*p.y; }
  }
  return Math.abs(a) / 2;
}
function polyPerimeter(outline) {
  let s = 0;
  for (const poly of outline) for (let i = 0; i + 1 < poly.length; i++) s += Math.hypot(poly[i+1].x-poly[i].x, poly[i+1].y-poly[i].y);
  return s;
}
/** how many x-intervals the outline covers on the horizontal line y */
function runsAt(outline, y) {
  const xs = [];
  for (const poly of outline) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i+1];
    if (a.y === b.y) continue;
    const lo = Math.min(a.y,b.y), hi = Math.max(a.y,b.y);
    if (y < lo || y >= hi) continue;
    xs.push(a.x + ((y-a.y)/(b.y-a.y))*(b.x-a.x));
  }
  xs.sort((p,q)=>p-q);
  const spans = [];
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i+1]]);
  return spans;
}
function runsAtX(outline, x) {
  const ys = [];
  for (const poly of outline) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i+1];
    if (a.x === b.x) continue;
    const lo = Math.min(a.x,b.x), hi = Math.max(a.x,b.x);
    if (x < lo || x >= hi) continue;
    ys.push(a.y + ((x-a.y*0)-a.x)/(b.x-a.x)*(b.y-a.y));
  }
  ys.sort((p,q)=>p-q);
  const spans = [];
  for (let i = 0; i + 1 < ys.length; i += 2) spans.push([ys[i], ys[i+1]]);
  return spans;
}

const files = walk(process.argv[2]);
const rows = [];
let nfiles = 0;
for (const f of files) {
  let doc, page, g, tc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    page = await doc.getPage(1); g = await readPageGeometry(page); tc = await page.getTextContent();
  } catch { continue; }
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
  const wraps = buildWraps(bleeds, match, DEFAULT_GROUPING);
  const stickers = buildStickers(elements, match, DEFAULT_GROUPING);
  const crossings = borderCrossings(bleeds, panel, match, DEFAULT_GROUPING, wraps);
  const ref = designerDims(g, tc.items, g.height);
  const cm = (v, axis) => axis === 'x' ? (v - R.x0)/PT_CM : (v - R.y0)/PT_CM;

  const wrapRows = wraps.map((w, wi) => {
    const b = w.boxCm;
    const wCm = b.x1-b.x0, hCm = b.y1-b.y0;
    const out = w.outlinePt ?? [];
    const areaPt = polyArea(out), periPt = polyPerimeter(out);
    const areaCm2 = areaPt/(PT_CM*PT_CM), periCm = periPt/PT_CM;
    const bboxArea = wCm*hCm;
    const tol = 1.5;
    const edges = [
      b.x0 <= tol ? 'L' : '', b.x1 >= widthCm-tol ? 'R' : '',
      b.y0 <= tol ? 'T' : '', b.y1 >= heightCm-tol ? 'B' : ''].filter(Boolean).join('');
    // crossing run counts on the four face edges
    const runsTop = runsAt(out, R.y0 + 0.4*PT_CM).map(s => [cm(s[0],'x'), cm(s[1],'x')]).filter(s => s[1]-s[0] > 3);
    const runsBot = runsAt(out, R.y1 - 0.4*PT_CM).map(s => [cm(s[0],'x'), cm(s[1],'x')]).filter(s => s[1]-s[0] > 3);
    const vAt = (x) => { const ys=[]; for (const poly of out) for (let i=0;i+1<poly.length;i++){const a=poly[i],b=poly[i+1];
      if(a.x===b.x)continue; const lo=Math.min(a.x,b.x),hi=Math.max(a.x,b.x); if(x<lo||x>=hi)continue;
      ys.push(a.y+((x-a.x)/(b.x-a.x))*(b.y-a.y));} ys.sort((p,q)=>p-q);
      const sp=[]; for(let i=0;i+1<ys.length;i+=2)sp.push([cm(ys[i],'y'),cm(ys[i+1],'y')]); return sp.filter(s=>s[1]-s[0]>3); };
    const runsLeft = vAt(R.x0 + 0.4*PT_CM), runsRight = vAt(R.x1 - 0.4*PT_CM);
    // thickness estimate: for a long thin ribbon, 2*area/perimeter == thickness
    const thickness = periCm > 0 ? 2*areaCm2/periCm : 0;
    const col = (() => { // area-weighted-ish: dominant fill of the biggest sub-object
      let best = null, bestA = -1;
      for (const o of bleeds) {
        const a = (o.bbox.x1-o.bbox.x0)*(o.bbox.y1-o.bbox.y0);
        if (o.bbox.x0 < w.bbox.x0-1 || o.bbox.x1 > w.bbox.x1+1) continue;
        if (a > bestA) { bestA = a; best = o.fill ?? o.stroke; }
      }
      return best;
    })();
    const lum = col ? (0.2126*col[0]+0.7152*col[1]+0.0722*col[2])/255 : null;
    return {
      wi, x0:+b.x0.toFixed(1), y0:+b.y0.toFixed(1), x1:+b.x1.toFixed(1), y1:+b.y1.toFixed(1),
      wFrac:+(wCm/widthCm).toFixed(3), hFrac:+(hCm/heightCm).toFixed(3),
      areaFrac:+(bboxArea/(widthCm*heightCm)).toFixed(3),
      inkFrac:+(areaCm2/Math.max(1,bboxArea)).toFixed(3),
      thickCm:+thickness.toFixed(1),
      thickFrac:+(thickness/Math.min(widthCm,heightCm)).toFixed(3),
      edges, nRunsTop: runsTop.length, nRunsBot: runsBot.length,
      runsLeft: runsLeft.map(s=>[+s[0].toFixed(0),+s[1].toFixed(0)]),
      runsRight: runsRight.map(s=>[+s[0].toFixed(0),+s[1].toFixed(0)]),
      runsTop: runsTop.map(s=>[+s[0].toFixed(0),+s[1].toFixed(0)]),
      runsBot: runsBot.map(s=>[+s[0].toFixed(0),+s[1].toFixed(0)]),
      color: col, lum: lum === null ? null : +lum.toFixed(2),
      nParts: w.partsCm.length,
      /** distinct fill colours among the bleed objects inside this wrap */
      wrapColors: [...new Set(bleeds.filter(o => o.bbox.x0 >= w.bbox.x0-1 && o.bbox.x1 <= w.bbox.x1+1 &&
        o.bbox.y0 >= w.bbox.y0-1 && o.bbox.y1 <= w.bbox.y1+1).map(o => (o.fill??o.stroke??[0,0,0]).map(Math.round).join(',')))],
      /** non-bleeding art that lives mostly INSIDE this wrap: the composite case */
      riders: stickers.filter(s => {
        const a = s.bbox, ov = Math.max(0, Math.min(a.x1,w.bbox.x1)-Math.max(a.x0,w.bbox.x0)) *
                                Math.max(0, Math.min(a.y1,w.bbox.y1)-Math.max(a.y0,w.bbox.y0));
        return ov / Math.max(1,(a.x1-a.x0)*(a.y1-a.y0)) >= 0.5;
      }).map(s => ({ x0:+s.boxCm.x0.toFixed(0), y0:+s.boxCm.y0.toFixed(0), x1:+s.boxCm.x1.toFixed(0), y1:+s.boxCm.y1.toFixed(0), a:+s.areaCm2.toFixed(0) })),
    };
  });

  // which anchors the designer used, attributed to wraps
  const anchors = [];
  for (const d of ref) {
    const vert = d.vert;
    const ax = vert ? cm(d.ax,'x') : cm(d.ax,'y');
    const span = vert ? heightCm : widthCm, perp = vert ? widthCm : heightCm;
    const a = vert ? cm(d.a,'y') : cm(d.a,'x');
    const b2 = vert ? cm(d.b,'y') : cm(d.b,'x');
    if (ax < -70 || ax > perp+70 || b2 < -30 || a > span+30) continue;
    const labels = [];
    for (const val of [a, b2]) {
      let label = '?';
      if (Math.abs(val) < TOL) label = 'FACE_INI';
      else if (Math.abs(val - span) < TOL) label = 'FACE_FIM';
      if (label === '?') for (const w of wrapRows) {
        const c = vert ? [['WRAP_TOP',w.y0],['WRAP_BOT',w.y1]] : [['WRAP_LEFT',w.x0],['WRAP_RIGHT',w.x1]];
        for (const [n,v] of c) if (Math.abs(val-v) < TOL) { label = `${n}#${w.wi}`; break; }
        if (label !== '?') break;
        if (!vert) {
          for (const r of [...w.runsTop, ...w.runsBot]) for (const v of r)
            if (Math.abs(val-v) < TOL) { label = `WRAP_CROSS#${w.wi}`; break; }
        }
        if (label !== '?') break;
      }
      if (label === '?') for (const s of stickers) {
        const c = vert ? [['ST_TOP',s.boxCm.y0],['ST_BOT',s.boxCm.y1]] : [['ST_LEFT',s.boxCm.x0],['ST_RIGHT',s.boxCm.x1]];
        for (const [n,v] of c) if (Math.abs(val-v) < TOL) { label = n; break; }
        if (label !== '?') break;
        for (const p of s.partsCm) {
          const c2 = vert ? [['ST_TOP',p.y0],['ST_BOT',p.y1]] : [['ST_LEFT',p.x0],['ST_RIGHT',p.x1]];
          for (const [n,v] of c2) if (Math.abs(val-v) < TOL) { label = n; break; }
          if (label !== '?') break;
        }
        if (label !== '?') break;
      }
      labels.push(label);
    }
    anchors.push({ v: d.v, axis: vert ? 'V':'H', from: labels[0], to: labels[1] });
  }
  rows.push({ file: basename(f), widthCm, heightCm, nStickers: stickers.length,
              wraps: wrapRows, crossings: crossings.map(c=>({edge:c.edge,s:+c.startCm.toFixed(0),e:+c.endCm.toFixed(0),w:c.wrapIndex})),
              anchors, nRef: ref.length });
  nfiles++;
  await doc.destroy();
}
writeFileSync(process.env.OUT ?? '/tmp/ldim/bands.json', JSON.stringify(rows));
console.log(`faces ${nfiles}  wraps ${rows.reduce((s,r)=>s+r.wraps.length,0)}  ancoras ${rows.reduce((s,r)=>s+r.anchors.length,0)}`);
