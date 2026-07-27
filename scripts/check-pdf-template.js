/**
 * Guarda de build: nenhum backtick pode existir dentro do bloco <style> do
 * template do orçamento.
 *
 * Este erro já apareceu QUATRO vezes: uma crase num comentário CSS encerra o
 * template literal, e o erro que o TypeScript reporta ("';' expected") aponta
 * para uma linha aparentemente inocente, muito longe da causa.
 *
 * Uso: node scripts/check-pdf-template.js
 */
const { readFileSync } = require('fs');
const path = 'src/modules/common/signature/document/quote-html.builder.ts';
const src = readFileSync(path, 'utf8');
const a = src.indexOf('<style>');
const z = src.indexOf('</style>');
if (a === -1 || z === -1) { console.error('bloco <style> nao encontrado'); process.exit(1); }
const inside = src.slice(a, z);
const count = (inside.match(/`/g) || []).length;
if (count > 0) {
  const line = src.slice(0, a + inside.indexOf('`')).split('\n').length;
  console.error(`ERRO: ${count} backtick(s) dentro do <style> (primeiro na linha ~${line}).`);
  console.error('Uma crase ali encerra o template literal. Use aspas simples ou nada.');
  process.exit(1);
}
console.log('OK: nenhum backtick dentro do <style>.');
