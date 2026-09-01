/**
 * O ímã tem de puxar o clique para a quina REAL da arte. Teste: para cada
 * extremo de adesivo detectado, clica com erro de mira e confere se a medida
 * entre dois extremos sai exata.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry, findPanel, classify, buildStickers, DEFAULT_GROUPING, SnapIndex, measureBetween } = await import(`${LIB}/core.js`);
const PT=72/2.54/10;
const walk=(d,o=[])=>{for(const e of readdirSync(d)){const p=join(d,e);statSync(p).isDirectory()?walk(p,o):e.toLowerCase().endsWith('.pdf')&&o.push(p);}return o;};

const JITTER_CM = Number(process.argv[3] ?? 3);
const RADIUS_CM = Number(process.argv[4] ?? 8);
let tried=0, exact=0, close=0; const errs=[];
for(const f of walk(process.argv[2])){
  let doc,pg,g;
  try{doc=await pdfjs.getDocument({data:new Uint8Array(readFileSync(f)),verbosity:0}).promise;pg=await doc.getPage(1);g=await readPageGeometry(pg);}catch{continue;}
  const rects=g.objects.filter(o=>o.outline.length===1&&(o.outline[0].length===4||o.outline[0].length===5)&&
    (o.bbox.x1-o.bbox.x0)/PT>=350&&(o.bbox.y1-o.bbox.y0)/PT>=150&&(o.bbox.x1-o.bbox.x0)<g.width*0.99);
  if(!rects.length){await doc.destroy();continue;}
  rects.sort((a,b)=>(b.bbox.x1-b.bbox.x0)*(b.bbox.y1-b.bbox.y0)-(a.bbox.x1-a.bbox.x0)*(a.bbox.y1-a.bbox.y0));
  const R=rects[0].bbox;
  const panel={side:'MOTORISTA',heightCm:Math.round((R.y1-R.y0)/PT),sections:[{widthCm:Math.round((R.x1-R.x0)/PT),isDoor:false}]};
  const scale={ptPerCm:PT,panelPt:R,from:'rectangle',aspectErrorPct:0};
  const {elements}=classify(g,scale,DEFAULT_GROUPING);
  const stickers=buildStickers(elements,scale,DEFAULT_GROUPING);
  if(stickers.length<1){await doc.destroy();continue;}
  const idx=new SnapIndex(g,scale,{});
  const radius=RADIUS_CM*PT, jit=JITTER_CM*PT;
  for(const s of stickers.slice(0,4)){
    // mede da borda esquerda da face ate' a quina esquerda do adesivo
    const yMid=(s.bbox.y0+s.bbox.y1)/2;
    const pairs=[
      [{x:R.x0+jit,y:yMid},{x:s.bbox.x0-jit,y:yMid}, (s.bbox.x0-R.x0)/PT],
      [{x:s.bbox.x1+jit,y:yMid},{x:R.x1-jit,y:yMid}, (R.x1-s.bbox.x1)/PT],
    ];
    const xMid=(s.bbox.x0+s.bbox.x1)/2;
    pairs.push([{x:xMid,y:R.y0+jit},{x:xMid,y:s.bbox.y0-jit},(s.bbox.y0-R.y0)/PT]);
    for(const [p1,p2,truth] of pairs){
      if(truth<5) continue;
      const s1=idx.snap(p1,radius);
      const s2=idx.snap(p2,radius,s1?.orientation);
      tried++;
      if(!s1||!s2) continue;
      const m=measureBetween(s1,s2,scale);
      const err=Math.abs(m.valueCm-truth);
      errs.push(err);
      if(err<=1) exact++; else if(err<=3) close++;
    }
  }
  await doc.destroy();
}
errs.sort((a,b)=>a-b);
console.log(`erro de mira ${JITTER_CM} cm, raio de ímã ${RADIUS_CM} cm — ${tried} medições simuladas`);
console.log(`  exata (<= 1 cm): ${exact} (${(100*exact/tried).toFixed(1)}%)`);
console.log(`  útil  (<= 3 cm): ${exact+close} (${(100*(exact+close)/tried).toFixed(1)}%)`);
if(errs.length) console.log(`  erro p50 ${errs[errs.length>>1].toFixed(2)} cm  p90 ${errs[Math.floor(errs.length*0.9)].toFixed(2)} cm`);
