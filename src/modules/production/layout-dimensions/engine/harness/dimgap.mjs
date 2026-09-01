/**
 * O BURACO do leitor de cotas: quanto do acervo o detector de traço azul não vê.
 *
 * O DOUTRINA.md avisa que alguns layouts desenham a cota com PREENCHIMENTO em
 * vez de traço. Aqui se mede o tamanho disso: por arquivo, quantos objetos
 * azuis existem por traço, quantos por preenchimento, quantos rótulos numéricos
 * a página tem e quantos deles o casador resolve.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const pdfjs = await import(process.env.PDFJS ??
  new URL('../../../../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const LIB = process.env.LIB ?? '/tmp/ldim';
const { readPageGeometry } = await import(`${LIB}/core.js`);

const PT_CM = 72 / 2.54 / 10, DIM = [0x33, 0x74, 0xa9];
const near = (a, b, t) => Math.abs(a - b) <= t;
const isBlue = c => c && near(c[0], DIM[0], 12) && near(c[1], DIM[1], 12) && near(c[2], DIM[2], 12);
const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : e.toLowerCase().endsWith('.pdf') && o.push(p); } return o; };

const rows = [];
for (const f of walk(process.argv[2])) {
  const name = f.split('/').pop();
  let doc, page, g, tc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), verbosity: 0 }).promise;
    page = await doc.getPage(1); g = await readPageGeometry(page); tc = await page.getTextContent();
  } catch (e) { rows.push({ file: name, error: 1 }); continue; }
  const strokeBlue = g.objects.filter(o => isBlue(o.stroke));
  const fillBlue = g.objects.filter(o => isBlue(o.fill) && !isBlue(o.stroke));
  // triângulos cheios: candidatos a seta
  const arrows = fillBlue.filter(o => {
    const w = (o.bbox.x1 - o.bbox.x0), h = (o.bbox.y1 - o.bbox.y0);
    const long = Math.max(w, h), short = Math.min(w, h);
    return long > 5 && long < 20 && short > 2 && short < 12;
  });
  // preenchimentos azuis FINOS: a linha desenhada como retângulo cheio
  const thinFills = fillBlue.filter(o => {
    const w = (o.bbox.x1 - o.bbox.x0), h = (o.bbox.y1 - o.bbox.y0);
    return Math.min(w, h) < 1.2 && Math.max(w, h) > 12;
  });
  const labels = tc.items.filter(t => {
    const v = Number(String(t.str).replace(/cm/gi, '').trim().replace(',', '.'));
    return Number.isFinite(v) && v > 0 && v <= 3000 && String(t.str).trim().length > 0;
  });
  rows.push({ file: name, objects: g.objects.length, strokeBlue: strokeBlue.length,
    fillBlue: fillBlue.length, arrows: arrows.length, thinFills: thinFills.length,
    labels: labels.length, anyBlue: strokeBlue.length + fillBlue.length });
  await doc.destroy();
}
writeFileSync(process.argv[3] ?? '/tmp/dimgap.jsonl', rows.map(r => JSON.stringify(r)).join('\n'));
const n = rows.length;
const p = (l, k) => console.log(`${l.padEnd(52)} ${k}`);
p('arquivos lidos', n - rows.filter(r => r.error).length);
p('com traço azul (o leitor funciona)', rows.filter(r => r.strokeBlue > 0).length);
p('SEM traço azul mas COM preenchimento azul', rows.filter(r => !r.strokeBlue && r.fillBlue > 0).length);
p('sem nada azul', rows.filter(r => !r.strokeBlue && !r.fillBlue).length);
p('sem traço azul mas com rótulo numérico', rows.filter(r => !r.strokeBlue && r.labels > 0).length);
p('rótulos numéricos em arquivos SEM traço azul', rows.filter(r => !r.strokeBlue).reduce((s, r) => s + (r.labels ?? 0), 0));
p('rótulos numéricos em arquivos COM traço azul', rows.filter(r => r.strokeBlue > 0).reduce((s, r) => s + (r.labels ?? 0), 0));
p('arquivos com preenchimento azul FINO (linha como retângulo)', rows.filter(r => r.thinFills > 0).length);
p('setas (triângulos azuis cheios) somadas', rows.reduce((s, r) => s + (r.arrows ?? 0), 0));
