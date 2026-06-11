/**
 * backfill-category-taxonomy.ts
 * ---------------------------------------------------------------------------
 * One-off, idempotent migration of the stock-item taxonomy to the new
 * 3-level model (AccountingType rollup › operational Category › Subcategory).
 *
 * Source of truth: Working Files/itens-classificados.csv
 *   columns: idx, nome, categoria, subcategoria, grupoContabil, confianca
 *
 * It (1) builds the operational ItemCategory tree (parentId self-relation,
 * categoryLevel, accountingType, physical `type`), (2) repoints each Item to its
 * leaf subcategory by name-match (flagging confianca!=alta as categoryReviewNeeded),
 * (3) flags DB items absent from the CSV for review, (4) seeds the missing
 * transactions-only resolving categories (Aplicação Financeira, Lucro Distribuído)
 * and backfills accountingType on existing transaction categories.
 *
 * Run: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/backfill-category-taxonomy.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AccountingType, ItemCategoryType, TransactionCategoryKind } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../modules/common/prisma/prisma.service';

const CSV_PATH = path.join(
  process.cwd(),
  '..',
  'Working Files',
  'itens-classificados.csv',
);

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** First token of grupoContabil → AccountingType. */
function grupoToAccounting(grupo: string): AccountingType | null {
  // Use the HEAD group (before the first "›"), letters-only, so "MATÉRIA-PRIMA ›
  // Tintas" → "materia prima" and "PRODUTIVO › Peças / MANUTENÇÃO" → "produtivo".
  const head = norm(grupo).split('›')[0].replace(/[^a-z ]/g, ' ').trim();
  if (head.includes('investimento')) return AccountingType.INVESTIMENTO;
  if (head.includes('materia')) return AccountingType.MATERIA_PRIMA;
  if (head.includes('produtivo')) return AccountingType.PRODUTIVO;
  if (head.includes('manutencao')) return AccountingType.MANUTENCAO;
  if (head.startsWith('epi')) return AccountingType.EPI;
  if (head.includes('escritorio')) return AccountingType.ESCRITORIO;
  if (head.includes('cozinha')) return AccountingType.COZINHA_ALIMENTACAO;
  if (head.includes('salario')) return AccountingType.SALARIOS;
  return null;
}

/** Operational categoria → physical ItemCategoryType (preserves PPE/tool filtering). */
function categoriaToPhysicalType(cat: string): ItemCategoryType {
  const n = norm(cat);
  if (n.includes('epi') || n.includes('uniforme')) return ItemCategoryType.PPE;
  // Historical note: elétricas/pneumáticas/equipamentos originally mapped to
  // ItemCategoryType.ELECTRONIC_TOOL. That enum value was dropped on
  // 2026-06-09 (0 rows; behavior gates moved to Item.stockModel/isBorrowable
  // — see TYPE_SYSTEM_CONTRACT.md), so they now fold into TOOL.
  if (n.includes('eletricas') || n.includes('pneumaticas') || n.includes('equipamentos'))
    return ItemCategoryType.TOOL;
  if (n.includes('ferramentas manuais')) return ItemCategoryType.TOOL;
  return ItemCategoryType.REGULAR;
}

/** Existing transaction-category name → AccountingType (resolving + item-ish). */
function txNameToAccounting(name: string): AccountingType | null {
  const n = norm(name);
  if (/(folha|pro-?labore|salario|aerograf|bonific)/.test(n)) return AccountingType.SALARIOS;
  if (/(tributo|imposto|tarifa|taxa|darf)/.test(n)) return AccountingType.IMPOSTO_TARIFAS;
  if (/(aluguel|convenio|energia|agua|combustivel|telefonia|internet)/.test(n)) return AccountingType.DESPESAS_FIXAS;
  if (/estorno|devoluc/.test(n)) return AccountingType.ESTORNO;
  if (/(tinta|verniz|base|toner|thinner|removedor|diluente|endurecedor|catalisador|primer|pigmento)/.test(n))
    return AccountingType.MATERIA_PRIMA;
  if (/(abrasiv|lixa|disco|massa|adesiv|fita|mascara|papel|peca|consumiv|material)/.test(n))
    return AccountingType.PRODUTIVO;
  if (/(ferramenta|equipamento)/.test(n)) return AccountingType.INVESTIMENTO;
  if (/epi|luva|mascara|uniforme/.test(n)) return AccountingType.EPI;
  if (/escritorio|cozinha|limpeza|cortesia/.test(n)) return AccountingType.ESCRITORIO;
  return null;
}

function mode<T>(xs: T[]): T | null {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const [k, v] of m) if (v > bestN) { bestN = v; best = k; }
  return best;
}

async function main() {
  const log = new Logger('CategoryTaxonomyBackfill');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  try {
    const raw = await fs.readFile(CSV_PATH, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    lines.shift(); // header
    interface Row { nome: string; categoria: string; subcategoria: string; grupo: string; confianca: string }
    const rows: Row[] = lines.map(l => {
      const f = l.replace(/^"/, '').replace(/"$/, '').split('","');
      return { nome: f[1] ?? '', categoria: f[2] ?? '', subcategoria: f[3] ?? '', grupo: f[4] ?? '', confianca: (f[5] ?? '').toLowerCase() };
    }).filter(r => r.categoria);
    log.log(`CSV rows: ${rows.length}`);

    // --- Derive accountingType per categoria and per (categoria,subcategoria) ---
    const byCat = new Map<string, AccountingType[]>();
    const byLeaf = new Map<string, AccountingType[]>();
    for (const r of rows) {
      const acc = grupoToAccounting(r.grupo);
      if (!acc) continue;
      (byCat.get(r.categoria) ?? byCat.set(r.categoria, []).get(r.categoria)!).push(acc);
      const lk = `${r.categoria}||${r.subcategoria}`;
      (byLeaf.get(lk) ?? byLeaf.set(lk, []).get(lk)!).push(acc);
    }

    // --- Unique-name helper (ItemCategory.name is @unique) ---
    const existing = await prisma.itemCategory.findMany({ select: { name: true } });
    const used = new Set(existing.map(e => e.name));
    const uniqueName = (base: string) => {
      let name = base;
      let i = 2;
      while (used.has(name)) name = `${base} (${i++})`;
      used.add(name);
      return name;
    };

    // --- Upsert level-1 categories ---
    const catId = new Map<string, string>(); // categoria -> id
    for (const categoria of [...new Set(rows.map(r => r.categoria))]) {
      const acc = mode(byCat.get(categoria) ?? []);
      const physical = categoriaToPhysicalType(categoria);
      const found = await prisma.itemCategory.findUnique({ where: { name: categoria }, select: { id: true } });
      if (found) {
        await prisma.itemCategory.update({
          where: { id: found.id },
          data: { categoryLevel: 1, parentId: null, accountingType: acc ?? undefined, type: physical },
        });
        catId.set(categoria, found.id);
        used.add(categoria);
      } else {
        const created = await prisma.itemCategory.create({
          data: { name: uniqueName(categoria), categoryLevel: 1, accountingType: acc ?? undefined, type: physical },
          select: { id: true },
        });
        catId.set(categoria, created.id);
      }
    }
    log.log(`Level-1 categories: ${catId.size}`);

    // --- Upsert level-2 subcategories ---
    const leafId = new Map<string, string>(); // "categoria||subcategoria" -> id
    let leafCount = 0;
    for (const r of rows) {
      const lk = `${r.categoria}||${r.subcategoria}`;
      if (!r.subcategoria || leafId.has(lk)) continue;
      const parent = catId.get(r.categoria)!;
      const acc = mode(byLeaf.get(lk) ?? []) ?? mode(byCat.get(r.categoria) ?? []);
      const physical = categoriaToPhysicalType(r.categoria);
      // leaf name may collide across categories → disambiguate
      const existingLeaf = await prisma.itemCategory.findUnique({ where: { name: r.subcategoria }, select: { id: true, parentId: true } });
      if (existingLeaf && existingLeaf.parentId === parent) {
        await prisma.itemCategory.update({ where: { id: existingLeaf.id }, data: { categoryLevel: 2, parentId: parent, accountingType: acc ?? undefined, type: physical } });
        leafId.set(lk, existingLeaf.id);
      } else {
        const created = await prisma.itemCategory.create({
          data: { name: uniqueName(r.subcategoria), categoryLevel: 2, parentId: parent, accountingType: acc ?? undefined, type: physical },
          select: { id: true },
        });
        leafId.set(lk, created.id);
      }
      leafCount++;
    }
    log.log(`Level-2 subcategories: ${leafCount}`);

    // --- Migrate items by name → leaf subcategory ---
    const items = await prisma.item.findMany({ select: { id: true, name: true } });
    const itemByNorm = new Map<string, string>();
    for (const it of items) if (!itemByNorm.has(norm(it.name))) itemByNorm.set(norm(it.name), it.id);
    let matched = 0, reviewFlagged = 0;
    const matchedIds = new Set<string>();
    for (const r of rows) {
      const id = itemByNorm.get(norm(r.nome));
      if (!id) continue;
      const lk = `${r.categoria}||${r.subcategoria}`;
      const target = leafId.get(lk) ?? catId.get(r.categoria);
      if (!target) continue;
      const needsReview = r.confianca !== 'alta';
      await prisma.item.update({ where: { id }, data: { categoryId: target, categoryReviewNeeded: needsReview } });
      matched++; matchedIds.add(id);
      if (needsReview) reviewFlagged++;
    }
    log.log(`Items matched & repointed: ${matched} (flagged review: ${reviewFlagged})`);

    // --- Flag DB items absent from the CSV for review ---
    const orphanIds = items.filter(i => !matchedIds.has(i.id)).map(i => i.id);
    if (orphanIds.length) {
      await prisma.item.updateMany({ where: { id: { in: orphanIds } }, data: { categoryReviewNeeded: true } });
    }
    log.log(`Items absent from CSV (flagged review): ${orphanIds.length}`);

    // --- Seed missing transactions-only resolving categories ---
    const ensureTxCat = async (name: string, slug: string, acc: AccountingType) => {
      const found = await prisma.transactionCategory.findFirst({ where: { OR: [{ name }, { slug }] }, select: { id: true } });
      if (found) {
        await prisma.transactionCategory.update({ where: { id: found.id }, data: { accountingType: acc, isResolving: true } });
        return 'updated';
      }
      await prisma.transactionCategory.create({
        data: { name, slug, kind: TransactionCategoryKind.TRANSACTION_ONLY, isResolving: true, accountingType: acc, isActive: true },
      });
      return 'created';
    };
    log.log(`Aplicação Financeira: ${await ensureTxCat('Aplicação Financeira', 'aplicacao-financeira', AccountingType.APLICACAO_FINANCEIRA)}`);
    log.log(`Lucro Distribuído: ${await ensureTxCat('Lucro Distribuído', 'lucro-distribuido', AccountingType.LUCRO_DISTRIBUIDO)}`);

    // --- Backfill accountingType on existing transaction categories ---
    const txCats = await prisma.transactionCategory.findMany({ where: { accountingType: null }, select: { id: true, name: true } });
    let txBack = 0;
    for (const tc of txCats) {
      const acc = txNameToAccounting(tc.name);
      if (acc) { await prisma.transactionCategory.update({ where: { id: tc.id }, data: { accountingType: acc } }); txBack++; }
    }
    log.log(`TransactionCategory accountingType backfilled: ${txBack}/${txCats.length}`);

    log.log('Done.');
  } catch (err) {
    log.error(`Failed: ${err instanceof Error ? err.stack : err}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
void main();
