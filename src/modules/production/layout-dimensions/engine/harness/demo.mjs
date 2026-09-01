/** Gera a face cotada a partir de uma arte de layout + medidas do caminhão. */
import { readFileSync, writeFileSync } from 'node:fs';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { buildLayoutFaces, annotatePdf } = await import(`${LIB}/core.js`);

const [, , file, out, side, heightArg, sectionsArg] = process.argv;
const bytes = new Uint8Array(readFileSync(file));
const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
const page = await doc.getPage(1);

const sections = sectionsArg.split(',').map(s => {
  const [w, kind, h] = s.split(':');
  return { widthCm: Number(w), isDoor: (kind ?? '').startsWith('porta'), doorHeightCm: h ? Number(h) : null };
});
const panels = [
  { side, heightCm: Number(heightArg), sections },
  { side: side === 'MOTORISTA' ? 'SAPO' : 'MOTORISTA', heightCm: Number(heightArg), sections },
];
const result = await buildLayoutFaces(page, panels);
console.log(`escala 1:${result.detectedScale.denominator.toFixed(1)} (${result.detectedScale.source})`);
result.faces.forEach(f => console.log(`  face ${f.index} ${f.side}: ${f.stickers.length} adesivos, ${f.wraps.length} envelopamentos`));
console.log(`  ${result.items.length} itens, ${result.dimensions.length} cotas`);
for (const w of result.warnings) console.log(`  aviso: ${w}`);
const entries = result.dimensions.map((dimension) => {
  const item = result.items[dimension.targetIndex ?? -1];
  const face = result.faces[item?.faceIndex ?? 0];
  return face ? { dimension, panel: face.panel, scale: face.scale } : null;
}).filter(Boolean);
writeFileSync(out, await annotatePdf(bytes, entries, { drawPanel: false }));
console.log(`  -> ${out}`);
