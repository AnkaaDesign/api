/**
 * O MOTOR ENTREGUE, e não o motor medido.
 *
 * `bench.mjs` e `grouping-bench.mjs` rodam em Node puro, e ali
 * `createPageInkTrimmer` — que é do DOM — devolve `undefined`: a moldura de uma
 * imagem entra crua e o agrupamento decide diferente do que o operador vê. A
 * onda em bitmap do DiCasa engolia o logotipo NO NAVEGADOR e em lugar nenhum
 * mais. Aqui a página é rasterizada com `@napi-rs/canvas` e o recortador é
 * montado à mão, então o que se mede é o que a tela faz.
 *
 * Responde três perguntas, nesta ordem de importância:
 *  - quanto CUSTA cada face (é o que congelava a aba do operador);
 *  - quantas faces devolvem a face inteira num clique (item único, ou um item
 *    cobrindo quase tudo);
 *  - quantas faces não têm peça posicionável nenhuma para escolher.
 *
 * ```sh
 * cd web
 * npx esbuild src/lib/layout-dimensions/index.ts \
 *   --bundle --format=esm --platform=node --outfile=/tmp/ldim/core.js
 * node src/lib/layout-dimensions/harness/prodsweep.mjs ~/layouts [--out arq.json]
 * ```
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../../../../', import.meta.url).pathname;
const pdfjs = await import(process.env.PDFJS ??
  `${ROOT}node_modules/pdfjs-dist/legacy/build/pdf.mjs`);
const { createCanvas, DOMMatrix, Path2D, ImageData } = await import(
  process.env.CANVAS ?? `${ROOT}node_modules/@napi-rs/canvas/index.js`
);
// pdf.js desenha com as classes do DOM; o canvas nativo traz as dele.
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = DOMMatrix;
if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = Path2D;
if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageData;

const LIB = process.env.LIB ?? '/tmp/ldim';
const core = await import(`${LIB}/core.js`);
const { readPageGeometry, findPanelRects, buildLayoutFaces, makeInkTrimmer } = core;

const PT_CM = 72 / 2.54 / 10;
const walk = (d, o = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p);
  }
  return o;
};

/** `createPageInkTrimmer` fora do DOM, pixel por pixel igual. */
async function inkTrimmer(page, pxPerPt = 0.5) {
  const viewport = page.getViewport({ scale: pxPerPt, rotation: 0 });
  const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return makeInkTrimmer({ data: image.data, width: image.width, height: image.height, pxPerPt });
}

/** As medidas do implemento não vêm no arquivo: valem os retângulos, a 1:10. */
function panelsFrom(geometry) {
  const sides = ['MOTORISTA', 'SAPO', 'TRASEIRA'];
  return findPanelRects(geometry).map((r, i) => ({
    side: sides[Math.min(i, 2)],
    heightCm: Math.round((r.y1 - r.y0) / PT_CM),
    sections: [{ widthCm: Math.round((r.x1 - r.x0) / PT_CM), isDoor: false }],
  }));
}

const dir = process.argv[2] ?? `${process.env.HOME}/layouts`;
const outArg = process.argv.indexOf('--out');
const files = walk(dir).sort();
const perFace = [];
const perFile = [];
let broken = 0;

for (const f of files) {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const geo = await readPageGeometry(page, { rotation: 0 });
    const panels = panelsFrom(geo);
    const trimToInk = await inkTrimmer(page, 0.5);
    const t0 = performance.now();
    const result = await buildLayoutFaces(page, panels, { rotation: 0, trimToInk });
    const ms = performance.now() - t0;
    perFile.push({ file: f.split('/').pop(), ms, objects: geo.objects.length, faces: result.faces.length });
    result.faces.forEach((face) => {
      const own = result.items.filter((it) => it.faceIndex === face.index);
      const panelArea =
        (face.scale.panelPt.x1 - face.scale.panelPt.x0) * (face.scale.panelPt.y1 - face.scale.panelPt.y0);
      const covers = own.map(
        (it) => ((it.bbox.x1 - it.bbox.x0) * (it.bbox.y1 - it.bbox.y0)) / panelArea,
      );
      const points = [...face.stickers, ...face.wraps].reduce(
        (n, s) => n + (s.outlinePt ? s.outlinePt.reduce((m, p) => m + p.length, 0) : 0),
        0,
      );
      perFace.push({
        file: f.split('/').pop(),
        face: face.index,
        w: Math.round((face.scale.panelPt.x1 - face.scale.panelPt.x0) / face.scale.ptPerCm),
        h: Math.round((face.scale.panelPt.y1 - face.scale.panelPt.y0) / face.scale.ptPerCm),
        items: own.length,
        stickers: own.filter((it) => it.kind === 'sticker').length,
        maxCover: covers.length ? Math.max(...covers) : 0,
        points,
        dims: result.dimensions.filter((d) => own.some((it) => it.index === d.targetIndex)).length,
        unusable: face.unusable ?? null,
      });
    });
    await doc.destroy();
  } catch (err) {
    broken += 1;
    if (doc) await doc.destroy().catch(() => {});
  }
}

const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};
const ms = perFile.map((r) => r.ms);
const oneItem = perFace.filter((r) => r.items <= 1).length;
const noSticker = perFace.filter((r) => r.stickers === 0).length;
const bigCover = perFace.filter((r) => r.maxCover >= 0.85).length;
const mute = perFace.filter((r) => r.dims === 0).length;

console.log(`=== MODO NAVEGADOR · ${files.length} PDFs · ${perFace.length} faces · ${broken} ilegíveis`);
console.log(`  custo do cotador por arquivo (ms)  p50 ${q(ms, 0.5).toFixed(0)}  p90 ${q(ms, 0.9).toFixed(0)}  p99 ${q(ms, 0.99).toFixed(0)}  máx ${Math.max(...ms).toFixed(0)}`);
console.log(`  faces com UM item só               ${oneItem}  (${((oneItem / perFace.length) * 100).toFixed(1)}%)`);
console.log(`  faces sem adesivo posicionável     ${noSticker}  (${((noSticker / perFace.length) * 100).toFixed(1)}%)`);
console.log(`  faces com item cobrindo >=85%      ${bigCover}  (${((bigCover / perFace.length) * 100).toFixed(1)}%)`);
console.log(`  faces sem cota nenhuma             ${mute}  (${((mute / perFace.length) * 100).toFixed(1)}%)`);
console.log(`  pontos de contorno por face        p50 ${q(perFace.map((r) => r.points), 0.5)}  p99 ${q(perFace.map((r) => r.points), 0.99)}  máx ${Math.max(...perFace.map((r) => r.points))}`);
const dead = perFace.filter((r) => r.unusable);
console.log(`  faces declaradas inutilizáveis     ${dead.length}  (${((dead.length / perFace.length) * 100).toFixed(1)}%)`);
const byReason = {};
for (const r of dead) byReason[r.unusable] = (byReason[r.unusable] ?? 0) + 1;
for (const [k, v] of Object.entries(byReason)) console.log(`      ${String(v).padStart(4)}  ${k}`);
console.log('\n-- faces inutilizáveis que NÃO eram vazias');
for (const r of dead.filter((x) => x.items > 0)) {
  console.log(`  ${r.file} #${r.face}  ${r.w}x${r.h}  itens=${r.items} cobre=${(r.maxCover * 100).toFixed(0)}%  (${r.unusable})`);
}
console.log('\n-- 12 arquivos mais caros');
for (const r of [...perFile].sort((a, b) => b.ms - a.ms).slice(0, 12)) {
  console.log(`  ${r.ms.toFixed(0).padStart(6)} ms  ${String(r.objects).padStart(5)} obj  ${r.faces} faces  ${r.file}`);
}
if (outArg > 0 && process.argv[outArg + 1]) {
  writeFileSync(process.argv[outArg + 1], JSON.stringify({ perFile, perFace }, null, 1));
  console.log(`\njson em ${process.argv[outArg + 1]}`);
}
process.exit(0);
