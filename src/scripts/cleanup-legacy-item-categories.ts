/**
 * cleanup-legacy-item-categories.ts
 * ---------------------------------------------------------------------------
 * One-off, idempotent, SAFE cleanup of the 17 LEGACY level-1 ItemCategory rows
 * left behind by the taxonomy migration (backfill-category-taxonomy.ts).
 *
 * After that migration the canonical taxonomy is: 13 chart-of-accounts level-1
 * categories (each carrying a non-null `accountingType`) › operational
 * subcategories. The 17 original level-1 rows are identified as:
 *     categoryLevel = 1  AND  accountingType IS NULL  AND  name NOT IN (13 new)
 * They are now mostly empty, but ~177 items flagged `categoryReviewNeeded` still
 * sit in them.
 *
 * This script:
 *   1. Ensures an "A Revisar" level-1 ItemCategory exists (creates if absent).
 *   2. Moves every item still parented to a legacy category into "A Revisar"
 *      with categoryReviewNeeded = true.
 *   3. Re-parents any child ItemCategory of a legacy row to NULL (so the legacy
 *      rows become truly empty before deletion — never orphan a subcategory).
 *   4. Deletes the now-empty legacy categories. Prisma onDelete: SetNull on
 *      TransactionCategory.itemCategoryId nulls the mirror rows automatically;
 *      this script counts how many mirrors WILL be nulled and logs it so the
 *      mirror-sync track can rebuild them.
 *
 * SAFETY:
 *   - "A Revisar" itself, the 13 named chart-of-accounts categories, and any row
 *     with a non-null accountingType are NEVER touched.
 *   - A category is only deleted once it has zero items and zero children.
 *   - Idempotent: a second run finds no legacy rows and is a no-op.
 *   - DRY_RUN=1 reports everything without writing.
 *
 * Run (DO NOT run as part of this task):
 *   npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/cleanup-legacy-item-categories.ts
 *   DRY_RUN=1 npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/cleanup-legacy-item-categories.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AccountingType } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';

const REVIEW_CATEGORY_NAME = 'A Revisar';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// The 13 chart-of-accounts level-1 category names seeded by the taxonomy
// migration. Matched case/accent-insensitively so a legacy row whose name
// happens to collide with a new group is never mistaken for legacy. The
// authoritative discriminator is still `accountingType IS NULL`; this set is a
// belt-and-suspenders guard.
const NEW_LEVEL1_NAMES: ReadonlySet<string> = new Set(
  [
    'Salários',
    'Despesas Fixas',
    'Produtivo',
    'Imposto / Tarifas',
    'Matéria-Prima',
    'Investimento',
    'Manutenção',
    'Cozinha / Alimentação',
    'EPI',
    'Escritório',
    'Aplicação Financeira',
    'Estorno',
    'Lucro Distribuído',
  ].map(norm),
);

const DRY_RUN = process.env.DRY_RUN === '1';

async function main(): Promise<void> {
  const log = new Logger('cleanup-legacy-item-categories');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);

  try {
    if (DRY_RUN) log.warn('DRY_RUN=1 — no writes will be performed.');

    // --- 1. Identify legacy level-1 categories ---------------------------
    // Legacy = level-1, no chart-of-accounts rollup, and not one of the 13 new
    // names (also excludes "A Revisar" by name).
    const level1 = await prisma.itemCategory.findMany({
      where: { categoryLevel: 1, accountingType: null },
      select: { id: true, name: true },
    });
    const legacy = level1.filter(
      c => norm(c.name) !== norm(REVIEW_CATEGORY_NAME) && !NEW_LEVEL1_NAMES.has(norm(c.name)),
    );
    const legacyIds = legacy.map(c => c.id);

    log.log(`Legacy level-1 categories found: ${legacy.length}`);
    if (legacy.length) log.log(`  -> ${legacy.map(c => c.name).join(', ')}`);

    if (!legacyIds.length) {
      log.log('Nothing to clean up. Done.');
      return;
    }

    // --- 2. Ensure "A Revisar" exists -----------------------------------
    let review = await prisma.itemCategory.findFirst({
      where: { name: REVIEW_CATEGORY_NAME },
      select: { id: true },
    });
    if (!review) {
      if (DRY_RUN) {
        log.log(`[dry-run] would create "${REVIEW_CATEGORY_NAME}" (level-1).`);
      } else {
        review = await prisma.itemCategory.create({
          data: {
            name: REVIEW_CATEGORY_NAME,
            categoryLevel: 1,
            parentId: null,
            // Stays null so it is itself excluded from the chart-of-accounts
            // roll-up and is never re-classified as a real group.
            accountingType: null as AccountingType | null,
          },
          select: { id: true },
        });
        log.log(`Created "${REVIEW_CATEGORY_NAME}".`);
      }
    } else {
      log.log(`"${REVIEW_CATEGORY_NAME}" already exists.`);
    }
    const reviewId = review?.id ?? '(dry-run-pending)';

    // --- 3. Move items out of legacy categories -------------------------
    const itemCount = await prisma.item.count({
      where: { categoryId: { in: legacyIds } },
    });
    if (DRY_RUN) {
      log.log(`[dry-run] would move ${itemCount} item(s) to "${REVIEW_CATEGORY_NAME}" (categoryReviewNeeded=true).`);
    } else {
      const moved = await prisma.item.updateMany({
        where: { categoryId: { in: legacyIds } },
        data: { categoryId: reviewId, categoryReviewNeeded: true },
      });
      log.log(`Items moved to "${REVIEW_CATEGORY_NAME}": ${moved.count}`);
    }

    // --- 4. Detach any child subcategories from legacy rows --------------
    // The migration parents subcategories under the new groups, but guard
    // against a stray child so deletion never orphans a subcategory tree.
    const childCount = await prisma.itemCategory.count({
      where: { parentId: { in: legacyIds } },
    });
    if (childCount) {
      if (DRY_RUN) {
        log.log(`[dry-run] would detach ${childCount} child subcategory(ies) from legacy rows (parentId -> null).`);
      } else {
        const detached = await prisma.itemCategory.updateMany({
          where: { parentId: { in: legacyIds } },
          data: { parentId: null },
        });
        log.log(`Child subcategories detached: ${detached.count}`);
      }
    } else {
      log.log('No child subcategories under legacy rows.');
    }

    // --- 5. Count the TransactionCategory mirrors that SetNull will null --
    // onDelete: SetNull on TransactionCategory.itemCategoryId nulls these on
    // delete; report the count so the mirror-sync track can rebuild them.
    const mirrorsToNull = await prisma.transactionCategory.count({
      where: { itemCategoryId: { in: legacyIds } },
    });
    log.log(`TransactionCategory mirrors that will be nulled by SetNull: ${mirrorsToNull}`);

    // --- 6. Delete the now-empty legacy categories ----------------------
    // Re-check emptiness per row before deleting — never delete a row that
    // still has items or children (defensive; should be zero after steps 3-4).
    let deleted = 0;
    let skipped = 0;
    for (const cat of legacy) {
      const [items, children] = await Promise.all([
        prisma.item.count({ where: { categoryId: cat.id } }),
        prisma.itemCategory.count({ where: { parentId: cat.id } }),
      ]);
      if (items > 0 || children > 0) {
        log.warn(`Skipping "${cat.name}" — still has ${items} item(s), ${children} child(ren).`);
        skipped += 1;
        continue;
      }
      if (DRY_RUN) {
        log.log(`[dry-run] would delete legacy category "${cat.name}".`);
        deleted += 1;
        continue;
      }
      await prisma.itemCategory.delete({ where: { id: cat.id } });
      deleted += 1;
    }

    log.log(
      `Legacy categories deleted: ${deleted}${skipped ? ` (skipped ${skipped} non-empty)` : ''}`,
    );
    log.log(
      `Summary: items->revisar=${itemCount}, children-detached=${childCount}, mirrors-nulled=${mirrorsToNull}, deleted=${deleted}.`,
    );
    log.log(DRY_RUN ? 'Dry run complete (no writes).' : 'Done.');
  } catch (err) {
    log.error(`Failed: ${err instanceof Error ? err.stack : err}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
