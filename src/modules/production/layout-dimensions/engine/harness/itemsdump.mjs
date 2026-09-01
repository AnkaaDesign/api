/**
 * Exactly what the VIEWER receives: `buildLayoutFaces` -> LayoutItem[].
 *
 * The overlay draws `outlinePt` when it is non-empty and the `alignedBoxPt`
 * rectangle otherwise, and it hit-tests the same way. So this dump answers
 * "does clicking this ornament draw anything, and what dimensions come out".
 *
 * Usage: node itemsdump.mjs <pdf> <W>x<H> [<W>x<H> ...]
 */
import { readFileSync } from 'node:fs';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { buildLayoutFaces } = await import(`${LIB}/core.js`);

const file = process.argv[2];
const sides = ['MOTORISTA', 'SAPO', 'TRASEIRA'];
const panels = process.argv.slice(3).map((s, i) => {
  const [w, h] = s.split('x').map(Number);
  return { side: sides[Math.min(i, 2)], heightCm: h, sections: [{ widthCm: w, isDoor: false }] };
});

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const res = await buildLayoutFaces(page, panels);
console.log(`${file.split('/').pop()}`);
console.log(`faces=${res.faces.length}  itens=${res.items.length}  cotas=${res.dimensions.length}`);
if (res.warnings.length) console.log('avisos: ' + res.warnings.join(' | '));

for (const f of res.faces) {
  const s = f.scale, cx = (v) => +((v - s.panelPt.x0) / s.ptPerCm).toFixed(1), cy = (v) => +((v - s.panelPt.y0) / s.ptPerCm).toFixed(1);
  console.log(`\n== face #${f.index} ${f.side} ${f.panel.sections[0].widthCm}x${f.panel.heightCm} cm  ptPerCm=${s.ptPerCm.toFixed(3)}  erroAspecto=${f.aspectErrorPct.toFixed(1)}%`);
  for (const it of res.items.filter((i) => i.faceIndex === f.index)) {
    const o = it.outlinePt;
    const verts = o ? o.reduce((n, p) => n + p.length, 0) : 0;
    const draw = it.alignedBoxPt;
    const drawW = cx(draw.x1) - cx(draw.x0), drawH = cy(draw.y1) - cy(draw.y0);
    const desenha = o && o.length ? `CONTORNO ${o.length} polis / ${verts} pts` :
      (drawW < 0.5 || drawH < 0.5 ? `!! RETANGULO DEGENERADO ${drawW.toFixed(1)}x${drawH.toFixed(1)}` : `retangulo ${drawW.toFixed(0)}x${drawH.toFixed(0)} cm`);
    const dims = res.dimensions.filter((d) => d.targetIndex === it.index);
    console.log(`  item#${String(it.index).padStart(2)} ${it.kind.padEnd(7)} tinta[${cx(it.bbox.x0)},${cy(it.bbox.y0)} .. ${cx(it.bbox.x1)},${cy(it.bbox.y1)}]  ${it.widthCm.toFixed(0)}x${it.heightCm.toFixed(0)} cm  ${desenha}`);
    console.log(`        cotas: ${dims.map((d) => `${d.axis} ${d.kind}=${d.valueCm.toFixed(0)}`).join(', ') || '(nenhuma)'}`);
  }
}
await doc.destroy();
