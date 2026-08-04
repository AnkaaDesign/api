#!/usr/bin/env node
/**
 * Grava uma RECEITA do paint-lab em `Paint.previewConfig`.
 *
 * O laboratório (`paint-lab.html`) é onde a tinta é ajustada no olho, contra
 * geometria e luz de verdade. O que ele produz é um JSON — e até agora esse JSON
 * voltava para o estúdio por transcrição manual, que é exatamente onde uma
 * medição vira um typo. Este script fecha esse trecho: cole o JSON, ele acha a
 * tinta pelo nome e grava.
 *
 * A coluna aceita DOIS formatos e o estúdio distingue sozinho (ver
 * `paintEffectFrom` em web/src/pages/tools/truck-studio/index.tsx):
 *   - receita do laboratório  → tem `pearlFlip`/`pearlMid`; governa o 3D inteiro
 *   - config do gerador 2D    → tem `lights[]`/`flipColor`; só a intenção de cor
 *
 * Uso:
 *   node scripts/paint/set-recipe.cjs "Vermelho Ruby" ./recipe.json
 *   node scripts/paint/set-recipe.cjs "Vermelho Ruby" --stdin < recipe.json
 *   node scripts/paint/set-recipe.cjs --list "Ruby"        # só procura
 *
 * O nome é `contains`, sem distinguir maiúsculas. Se casar com mais de uma
 * tinta o script PARA e lista — gravar a receita errada em silêncio é pior do
 * que não gravar.
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const args = process.argv.slice(2);
const listOnly = args[0] === '--list';
const name = listOnly ? args[1] : args[0];
const src = args[1];

if (!name) {
  console.error('uso: set-recipe.cjs "<nome da tinta>" <arquivo.json|--stdin>');
  process.exit(2);
}

function readRecipe() {
  const raw = src === '--stdin' || !src
    ? fs.readFileSync(0, 'utf8')
    : fs.readFileSync(src, 'utf8');
  const r = JSON.parse(raw);
  if (!r || typeof r !== 'object') throw new Error('receita não é um objeto');
  /* Marcador do formato: sem um destes o estúdio trataria o JSON como config do
     gerador 2D e ignoraria as amplitudes. Falhar aqui é bem mais barato do que
     descobrir isso olhando o caminhão. */
  if (typeof r.pearlFlip !== 'string' && typeof r.pearlMid !== 'string') {
    throw new Error('não parece receita do laboratório: falta pearlFlip/pearlMid');
  }
  return r;
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.paint.findMany({
      where: { name: { contains: name, mode: 'insensitive' } },
      select: { id: true, name: true, hex: true, finish: true, manufacturer: true },
      orderBy: { name: 'asc' },
    });
    if (!rows.length) { console.error(`nenhuma tinta casa com "${name}"`); process.exit(1); }
    if (listOnly || rows.length > 1) {
      console.log(rows.length + ' tinta(s):');
      for (const r of rows) {
        console.log(`  ${r.name}  ${r.hex}  ${r.finish}  ${r.manufacturer ?? '(sem montadora)'}`);
      }
      if (!listOnly) { console.error('\nambíguo — refine o nome.'); process.exit(1); }
      return;
    }
    const paint = rows[0];
    const recipe = readRecipe();
    await prisma.paint.update({ where: { id: paint.id }, data: { previewConfig: recipe } });
    console.log(`✓ ${paint.name} (${paint.manufacturer ?? 'sem montadora'})`);
    console.log(`  catálogo: ${paint.hex} ${paint.finish}`);
    console.log(`  receita : ${recipe.color ?? '(mantém)'} ${recipe.finish ?? '(mantém)'}`
      + `  flip ${recipe.pearlFlip ?? '—'}  floco ${recipe.flakeColor ?? '—'}`);
    if (recipe.color && recipe.color.toLowerCase() !== paint.hex.toLowerCase()) {
      console.log(`  NOTA: a receita pinta ${recipe.color}, o catálogo diz ${paint.hex}.`);
      console.log('        O 3D usa a receita; a amostra do card segue o catálogo.');
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
