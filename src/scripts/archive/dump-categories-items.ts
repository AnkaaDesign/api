/**
 * dump-categories-items.ts  (READ-ONLY)
 * ---------------------------------------------------------------------------
 * Dumps the current category taxonomy + items so we can plan a reclassification.
 * Writes full JSON to ../Working Files/category-reclassify/ and prints a compact
 * summary (taxonomy + floating tx-categories + duplicate-name candidates).
 *
 * Run: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/dump-categories-items.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';

const OUT_DIR = path.join(process.cwd(), '..', 'Working Files', 'category-reclassify');

const norm = (s: string) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const log = new Logger('dump');

  await fs.mkdir(OUT_DIR, { recursive: true });

  const [txCats, itemCats, items] = await Promise.all([
    prisma.transactionCategory.findMany({
      select: { id: true, name: true, kind: true, accountingType: true, isRecurring: true, isActive: true, isResolving: true, itemCategoryId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.itemCategory.findMany({
      select: { id: true, name: true, categoryLevel: true, parentId: true, accountingType: true, type: true, _count: { select: { items: true } } },
      orderBy: [{ categoryLevel: 'asc' }, { name: 'asc' }],
    }),
    prisma.item.findMany({
      select: { id: true, uniCode: true, name: true, categoryId: true, categoryReviewNeeded: true, category: { select: { name: true, categoryLevel: true, parentId: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  await fs.writeFile(path.join(OUT_DIR, 'tx-categories.json'), JSON.stringify(txCats, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'item-categories.json'), JSON.stringify(itemCats, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'items.json'), JSON.stringify(items, null, 2));

  const byId = new Map(itemCats.map(c => [c.id, c]));
  const level1 = itemCats.filter(c => c.categoryLevel === 1);
  const level2 = itemCats.filter(c => c.categoryLevel === 2);
  const orphans = itemCats.filter(c => c.categoryLevel !== 1 && (!c.parentId || !byId.has(c.parentId)));

  // ---- SUMMARY ----
  const line = '='.repeat(70);
  console.log(`\n${line}\nCOUNTS`);
  console.log(`  transactionCategories: ${txCats.length}  (byKind: ` +
    JSON.stringify(txCats.reduce((a, c) => ((a[c.kind] = (a[c.kind] || 0) + 1), a), {} as Record<string, number>)) + ')');
  console.log(`  itemCategories: ${itemCats.length}  (L1=${level1.length}, L2=${level2.length}, other=${itemCats.length - level1.length - level2.length})`);
  console.log(`  items: ${items.length}  (reviewNeeded=${items.filter(i => i.categoryReviewNeeded).length}, noCategory=${items.filter(i => !i.categoryId).length})`);

  console.log(`\n${line}\nFLOATING TRANSACTION CATEGORIES (accountingType = null):`);
  txCats.filter(c => !c.accountingType).forEach(c =>
    console.log(`  - ${c.name.padEnd(34)} kind=${c.kind.padEnd(16)} recurring=${c.isRecurring}`));

  console.log(`\n${line}\nITEM CATEGORY TAXONOMY (L1 › L2  [itemCount, accountingType]):`);
  for (const p of level1) {
    const kids = level2.filter(c => c.parentId === p.id).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    console.log(`\n■ ${p.name}  [self=${p._count.items}, acct=${p.accountingType ?? '—'}, type=${p.type}]`);
    for (const k of kids) console.log(`    └ ${k.name.padEnd(48)} [${k._count.items} itens, acct=${k.accountingType ?? '—'}]`);
  }
  if (orphans.length) {
    console.log(`\n${line}\nORPHAN / NON-L1-L2 categories (parent missing):`);
    orphans.forEach(c => console.log(`  - ${c.name} (level=${c.categoryLevel}, parentId=${c.parentId})`));
  }

  // Duplicate-name candidates (normalized-similar L1/L2 names)
  const nameGroups = new Map<string, string[]>();
  for (const c of itemCats) {
    const key = norm(c.name).replace(/s$/, ''); // crude singularize for abrasivo(s)
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(`${c.name} (L${c.categoryLevel}, ${c._count.items} itens)`);
  }
  const dups = [...nameGroups.values()].filter(v => v.length > 1);
  if (dups.length) {
    console.log(`\n${line}\nPOSSIBLE DUPLICATE/NEAR-DUPLICATE CATEGORY NAMES:`);
    dups.forEach(v => console.log(`  • ${v.join('   |   ')}`));
  }

  console.log(`\n${line}\nWrote: tx-categories.json, item-categories.json, items.json → ${OUT_DIR}\n`);
  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
