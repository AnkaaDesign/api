/**
 * Click simulator: replays the overlay's hit test over a grid of points and
 * reports WHICH item wins and WHICH dimensions the user then sees.
 *
 * The rule is copied verbatim from pdf-measure-overlay.tsx (handleClick):
 *   - reject when the point is outside bbox +- tol;
 *   - accept immediately when the item has no outline (the rectangle case);
 *   - otherwise require point-in-polygon or a contour within tol;
 *   - the SMALLEST bounding box among the hits wins.
 *
 * Usage: node clicksim.mjs <pdf> <W>x<H> [<W>x<H> ...] [--face N] [--step cm]
 */
import { readFileSync } from 'node:fs';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { buildLayoutFaces } = await import(`${LIB}/core.js`);

const args = process.argv.slice(2);
const file = args[0];
const faceArg = args.indexOf('--face');
const onlyFace = faceArg > 0 ? Number(args[faceArg + 1]) : null;
const stepArg = args.indexOf('--step');
const stepCm = stepArg > 0 ? Number(args[stepArg + 1]) : 10;
const sides = ['MOTORISTA', 'SAPO', 'TRASEIRA'];
const panels = args.slice(1).filter((s) => /^\d+x\d+$/.test(s)).map((s, i) => {
  const [w, h] = s.split('x').map(Number);
  return { side: sides[Math.min(i, 2)], heightCm: h, sections: [{ widthCm: w, isDoor: false }] };
});

function pointInPolys(polys, p) {
  let inside = false;
  for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function distToPolys(polys, p) {
  let best = Infinity;
  for (const poly of polys) for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
const page = await doc.getPage(1);
const res = await buildLayoutFaces(page, panels);
const tolPt = 4; // MIN_HIT_PX / zoom, ~4 pt at 1x

for (const f of res.faces) {
  if (onlyFace !== null && f.index !== onlyFace) continue;
  const s = f.scale, R = s.panelPt;
  const W = f.panel.sections.reduce((a, x) => a + x.widthCm, 0), H = f.panel.heightCm;
  const own = res.items.filter((i) => i.faceIndex === f.index);
  const label = new Map();
  for (const it of own) label.set(it.index, res.dimensions.filter((d) => d.targetIndex === it.index).map((d) => `${d.kind.replace('EDGE_', 'E:').replace('BLEED_', 'B:')}${d.valueCm.toFixed(0)}`).join('+') || '-');
  console.log(`\n== face #${f.index} ${f.side} ${W}x${H} cm  (${own.length} itens, passo ${stepCm} cm)`);
  for (const it of own) console.log(`   item#${it.index} ${it.kind} caixa ${it.widthCm.toFixed(0)}x${it.heightCm.toFixed(0)} contorno=${it.outlinePt?.length ?? 0} -> ${label.get(it.index)}`);

  const grid = [];
  for (let y = stepCm / 2; y < H; y += stepCm) {
    let row = '';
    for (let x = stepCm / 2; x < W; x += stepCm) {
      const p = { x: R.x0 + x * s.ptPerCm, y: R.y0 + y * s.ptPerCm };
      const hits = own.filter((o) => {
        if (p.x < o.bbox.x0 - tolPt || p.x > o.bbox.x1 + tolPt || p.y < o.bbox.y0 - tolPt || p.y > o.bbox.y1 + tolPt) return false;
        if (!o.outlinePt?.length) return true;
        return pointInPolys(o.outlinePt, p) || distToPolys(o.outlinePt, p) <= tolPt;
      });
      hits.sort((a, b) => (a.bbox.x1 - a.bbox.x0) * (a.bbox.y1 - a.bbox.y0) - (b.bbox.x1 - b.bbox.x0) * (b.bbox.y1 - b.bbox.y0));
      row += hits.length ? String.fromCharCode(65 + (hits[0].index % 26)) : '.';
    }
    grid.push(row);
  }
  console.log('   mapa do clique (letra = item vencedor, A=item0, B=item1, ...):');
  for (const r of grid) console.log('     ' + r);
  const seen = new Map();
  for (const r of grid) for (const ch of r) if (ch !== '.') seen.set(ch, (seen.get(ch) ?? 0) + 1);
  console.log('   ' + [...seen].map(([c, n]) => `${c}=item#${own.find((o) => String.fromCharCode(65 + (o.index % 26)) === c)?.index} (${n} celulas) ${label.get(own.find((o) => String.fromCharCode(65 + (o.index % 26)) === c)?.index)}`).join('\n   '));
}
await doc.destroy();
