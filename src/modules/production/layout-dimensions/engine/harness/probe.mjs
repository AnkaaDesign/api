/** Dumps the vector objects of one face, in face centimetres, with colour. */
import { readFileSync } from 'node:fs';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, findPanel, classify, buildStickers, buildWraps, borderCrossings, DEFAULT_GROUPING } = await import(`${LIB}/core.js`);
const PT_CM = 72 / 2.54 / 10, DIM = [0x33,0x74,0xa9];
const near = (a,b,t)=>Math.abs(a-b)<=t;
const file = process.argv[2];
const xLimit = Number(process.argv[3] ?? Infinity);
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const g = await readPageGeometry(page);
const tc = await page.getTextContent();
const rects = g.objects.filter(o => o.outline.length <= 1 && (o.bbox.x1-o.bbox.x0)/PT_CM >= 350 &&
  (o.bbox.y1-o.bbox.y0)/PT_CM >= 150 && (o.bbox.x1-o.bbox.x0) < g.width*0.99 &&
  (o.outline[0]?.length === 4 || o.outline[0]?.length === 5));
rects.sort((a,b)=>(b.bbox.x1-b.bbox.x0)*(b.bbox.y1-b.bbox.y0)-(a.bbox.x1-a.bbox.x0)*(a.bbox.y1-a.bbox.y0));
const R = rects[0].bbox;
const W = Math.round((R.x1-R.x0)/PT_CM), H = Math.round((R.y1-R.y0)/PT_CM);
console.log(`FACE ${W} x ${H} cm  (pagina ${g.width.toFixed(0)}x${g.height.toFixed(0)} pt, ${g.objects.length} objetos)`);
const cx = v => +((v-R.x0)/PT_CM).toFixed(1), cy = v => +((v-R.y0)/PT_CM).toFixed(1);
const hex = c => c ? '#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('') : '-';
const area = o => { let a=0; for (const p of o.outline){for(let i=0;i+1<p.length;i++)a+=p[i].x*p[i+1].y-p[i+1].x*p[i].y; if(p.length>2){const u=p[p.length-1],v=p[0];a+=u.x*v.y-v.x*u.y;}} return Math.abs(a)/2/(PT_CM*PT_CM); };
const crossAt = (o,y) => { const xs=[]; for(const p of o.outline)for(let i=0;i+1<p.length;i++){const a=p[i],b=p[i+1];if(a.y===b.y)continue;const lo=Math.min(a.y,b.y),hi=Math.max(a.y,b.y);if(y<lo||y>=hi)continue;xs.push(a.x+((y-a.y)/(b.y-a.y))*(b.x-a.x));} return xs.sort((p,q)=>p-q).map(cx); };
console.log('\n--- objetos na regiao (nao-azuis) ---');
console.log('idx  op        x0    y0    x1    y1   fill      stroke    subp  areaCm2  cruzaTopo               cruzaBase');
for (const o of g.objects) {
  if (o.op === 'clip') continue;
  const b = o.bbox;
  if (cx(b.x0) > xLimit) continue;
  if (b.x1 < R.x0-2 || b.x0 > R.x1+2 || b.y1 < R.y0-2 || b.y0 > R.y1+2) continue;
  const s = o.stroke;
  if (s && near(s[0],DIM[0],14) && near(s[1],DIM[1],14) && near(s[2],DIM[2],14)) continue;
  const a = area(o);
  if (a < 20 && !o.text) continue;
  console.log(`${String(o.index).padStart(4)} ${o.op.padEnd(9)} ${String(cx(b.x0)).padStart(6)}${String(cy(b.y0)).padStart(6)}${String(cx(b.x1)).padStart(6)}${String(cy(b.y1)).padStart(6)}  ${hex(o.fill).padEnd(9)} ${hex(o.stroke).padEnd(9)} ${String(o.outline.length).padStart(4)} ${a.toFixed(0).padStart(8)}  ${JSON.stringify(crossAt(o,R.y0+0.4*PT_CM)).padEnd(22)} ${JSON.stringify(crossAt(o,R.y1-0.4*PT_CM))}`);
}
const panel = { side:'MOTORISTA', heightCm:H, sections:[{widthCm:W,isDoor:false}] };
const match = findPanel(g, panel);
const { elements, bleeds } = classify(g, match, DEFAULT_GROUPING);
const wraps = buildWraps(bleeds, match, DEFAULT_GROUPING);
const stickers = buildStickers(elements, match, DEFAULT_GROUPING);
const cr = borderCrossings(bleeds, panel, match, DEFAULT_GROUPING, wraps);
console.log(`\n--- o que o motor ve: ${elements.length} elementos, ${bleeds.length} sangrias, ${wraps.length} wraps, ${stickers.length} adesivos ---`);
wraps.forEach((w,i)=>console.log(`  wrap#${i} [${w.boxCm.x0.toFixed(0)},${w.boxCm.y0.toFixed(0)} .. ${w.boxCm.x1.toFixed(0)},${w.boxCm.y1.toFixed(0)}] partes=${w.partsCm.length} area=${w.areaCm2.toFixed(0)}`));
stickers.slice(0,10).forEach((s,i)=>console.log(`  adesivo#${i} [${s.boxCm.x0.toFixed(0)},${s.boxCm.y0.toFixed(0)} .. ${s.boxCm.x1.toFixed(0)},${s.boxCm.y1.toFixed(0)}] partes=${s.partsCm.length} area=${s.areaCm2.toFixed(0)}`));
console.log('  travessias:', cr.map(c=>`${c.edge} ${c.startCm.toFixed(0)}..${c.endCm.toFixed(0)} (wrap#${c.wrapIndex})`).join(' | '));
console.log('\n--- rotulos azuis do projetista ---');
const labels = tc.items.map(t=>({v:Number(String(t.str).replace(/cm/gi,'').trim().replace(',','.')), m:t.transform, w:t.width}))
  .filter(t=>Number.isFinite(t.v)&&t.v>0&&t.v<3000);
for (const t of labels) {
  const vert = Math.abs(t.m[1])>Math.abs(t.m[0]);
  console.log(`  ${String(t.v).padStart(6)}  ${vert?'V':'H'}  em (${cx(t.m[4]).toFixed(0)}, ${cy(g.height-t.m[5]).toFixed(0)}) cm da face`);
}
await doc.destroy();
// resolved designer dimensions (endpoint pair recovered from the extension lines)
{
  const blue = g.objects.filter(o => o.stroke && near(o.stroke[0],DIM[0],12) && near(o.stroke[1],DIM[1],12) && near(o.stroke[2],DIM[2],12));
  const Hs=[],Vs=[];
  for (const o of blue) for (const poly of o.outline) for (let i=0;i+1<poly.length;i++){const a=poly[i],b=poly[i+1];
    if(Math.abs(a.y-b.y)<.6&&Math.abs(a.x-b.x)>=1)Hs.push([Math.min(a.x,b.x),Math.max(a.x,b.x),(a.y+b.y)/2]);
    else if(Math.abs(a.x-b.x)<.6&&Math.abs(a.y-b.y)>=1)Vs.push([Math.min(a.y,b.y),Math.max(a.y,b.y),(a.x+b.x)/2]);}
  console.log('\n--- cotas do projetista resolvidas (de -> ate, em cm da face) ---');
  for (const t of tc.items) {
    const v = Number(String(t.str).replace(/cm/gi,'').trim().replace(',','.'));
    if(!Number.isFinite(v)||v<=0||v>3000)continue;
    const m=t.transform, vert=Math.abs(m[1])>Math.abs(m[0]);
    const lx=m[4]+(vert?0:t.width/2), ly=g.height-m[5]-(vert?t.width/2:0);
    const target=v*PT_CM; let best=null;
    for (const ax of new Set((vert?Vs:Hs).filter(s=>Math.abs(s[2]-(vert?lx:ly))<45).map(s=>+s[2].toFixed(1)))) {
      const pts=[...new Set((vert?Hs:Vs).filter(s=>s[0]-6<=ax&&ax<=s[1]+6).map(s=>+s[2].toFixed(1)))].sort((p,q)=>p-q);
      for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){const err=Math.abs(pts[j]-pts[i]-target);if(!best||err<best.err)best={err,ax,a:pts[i],b:pts[j]};}
    }
    if (best && best.err < Math.max(6,target*0.06)) {
      const A = vert?cy(best.a):cx(best.a), B = vert?cy(best.b):cx(best.b), AX = vert?cx(best.ax):cy(best.ax);
      console.log(`  ${String(v).padStart(6)} ${vert?'V':'H'}  ${String(A.toFixed(1)).padStart(8)} -> ${String(B.toFixed(1)).padStart(8)}   (linha em ${AX.toFixed(0)})`);
    } else console.log(`  ${String(v).padStart(6)} ${vert?'V':'H'}  (nao resolvida)`);
  }
}
