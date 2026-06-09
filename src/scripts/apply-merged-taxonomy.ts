/**
 * apply-merged-taxonomy.ts
 * ---------------------------------------------------------------------------
 * Applies the FINAL merged item taxonomy (docs/categorization/category-reclassify/
 * merged-taxonomy.json — 14 top categories › 47 leaf subcategories, each top
 * carrying an AccountingType rollup) to the live ItemCategory tree and repoints
 * every Item to its merged leaf, using the per-item classification in
 * classified-batch-1..8.json.
 *
 * It RECONCILES the batches (classified against an older leaf set) to the FINAL
 * leaf-authoritative taxonomy (the item's TOP is derived from its leaf):
 *   - "Toners e bases de cor" → "Pigmento"; "Tintas e bases prontas" → "Bases prontas / Tintas";
 *     "Linha vinílica de plotagem (tintas)" → "Linha Vinílica"
 *   - "Diluentes, thinners e preparadores de superfície" → "Solventes e thinners"
 *   - "Endurecedores, catalisadores e aditivos" → "Auxiliares" (additives) | "Endurecedores e catalisadores"
 *   - "Papel e plástico de cobertura" → "Embalagem e expedição" (filme/lona/bolha) | "Papel"
 *   - "Ferramentas elétricas e pneumáticas" → "Ferramentas pneumáticas" | "Ferramentas elétricas"
 *   Leaves carry an optional per-leaf accountingType override (e.g. Primers→MATERIA_PRIMA
 *   under the PRODUTIVO Funilaria top; Peças de manutenção→MANUTENCAO).
 *
 * Steps (idempotent):
 *   1. Build/refresh the 14 level-1 tops (parentId null, accountingType, physical type).
 *   2. Build/refresh the 43 level-2 leaves (parent = its top, accountingType + type inherited).
 *      Legacy rows whose name equals a leaf name ("Pigmento", "Base") are re-homed, not duplicated.
 *   3. Repoint each Item to its leaf — by item id (638 rows) or unique normalized
 *      name (batch 4, id-less). média/baixa confidence → categoryReviewNeeded=true.
 *   4. Any Item not covered (uncovered, name-collision, no-match) → "A Revisar" (review=true).
 *   5. Cleanup: delete the now-empty legacy categories (0 items, 0 children).
 *   6. Rebuild the ITEM_DERIVED TransactionCategory mirror.
 *
 * SAFETY: a legacy category is deleted only when it has zero items AND zero
 * children. "A Revisar" and the 14 named tops are never deleted. Idempotent:
 * a second run is a near no-op.
 *
 * Run (dry):   DRY_RUN=1 npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/apply-merged-taxonomy.ts
 * Run (apply):           npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/apply-merged-taxonomy.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AccountingType, ItemCategoryType } from '@prisma/client';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/common/prisma/prisma.service';
import { TransactionCategoryService } from '../modules/financial/reconciliation/transaction-category.service';

const DRY_RUN = process.env.DRY_RUN === '1';
const DOCS = path.join(process.cwd(), 'docs', 'categorization', 'category-reclassify');
const REVIEW_NAME = 'A Revisar';

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// --- Reconcile batch labels → final taxonomy (LEAF-authoritative) ---------
// The batches were classified against an older leaf set. We map each batch leaf
// to its FINAL leaf name; the item's TOP is then derived from the leaf (each leaf
// belongs to exactly one top), so re-homing a leaf to a different top — e.g.
// "Primers, seladoras e fundos" → Funilaria — needs no per-row top handling.
const LEAF_RENAME: Record<string, string> = {
  'Toners e bases de cor': 'Pigmento',
  'Tintas e bases prontas': 'Bases prontas / Tintas',
  'Linha vinílica de plotagem (tintas)': 'Linha Vinílica',
  'Diluentes, thinners e preparadores de superfície': 'Solventes e thinners',
  'Informática e eletrônicos de apoio': 'Informática e Eletrônicos',
};
function reconcileLeaf(leaf: string, name: string): string {
  const n = norm(name); // accent-folded for the keyword splits below
  // Power tools split: pneumatic vs electric, by item name.
  if (leaf === 'Ferramentas elétricas e pneumáticas')
    return /pneumat|à ar|\ba ar\b/i.test(name) ? 'Ferramentas pneumáticas' : 'Ferramentas elétricas';
  // Additives split out of the old hardener leaf into the new "Auxiliares" leaf.
  if (leaf === 'Endurecedores, catalisadores e aditivos')
    return /aditiv|flexibiliz|acelerador|anti.?cratera|fish.?eye|retardador|promotor|plastificante|anti.?silicone/i.test(
      name,
    )
      ? 'Auxiliares'
      : 'Endurecedores e catalisadores';
  // Plastic film/wrap leaves the paper masking leaf (trucks use paper only) → packaging.
  if (leaf === 'Papel e plástico de cobertura')
    return /filme|stretch|bolha|lona|fitilho|pl[áa]stic/i.test(name) ? 'Embalagem e expedição' : 'Papel';
  // Maintenance/infrastructure restructure (MANUTENCAO) -----------------------
  // Old electrical-infra leaf → install materials (Instalação elétrica) vs durable
  // power tools (→ Ferramentas elétricas) vs durable access gear (→ Equipamentos e acesso).
  if (leaf === 'Energia e infraestrutura elétrica') {
    if (/escada|banqueta/.test(n)) return 'Equipamentos e acesso';
    if (/ferro de solda|soprador|macarico/.test(n)) return 'Ferramentas elétricas';
    return 'Instalação elétrica';
  }
  // Old compressed-air leaf → pneumatic install materials.
  if (leaf === 'Linha de ar comprimido') return 'Instalação pneumática';
  // Connections leaf → pull electrical conduit + pneumatic/galvanized fittings into the
  // maintenance installs; keep water hoses + bench supports in Peças.
  if (leaf === 'Conexões, mangueiras e suportes') {
    if (/condulete/.test(n)) return 'Instalação elétrica';
    if (/galv|niple|cotov|reducao|bucha|valvula|veda rosca|plugue/.test(n)) return 'Instalação pneumática';
    return 'Conexões, mangueiras e suportes';
  }
  // Copa/cortesia split: brindes (bonés, chaveiros) → Cortesia; consumíveis de copa → Copa e alimentação.
  if (leaf === 'Copa, alimentação e cortesia')
    return /bone|brinde|chaveiro|cortesia|calendario|brinquedo/.test(n) ? 'Cortesia' : 'Copa e alimentação';
  // The "Clear <resina>" products (clear acrílico/epóxi/laca/poliéster/PU) are the resin
  // BASES per shop usage → Base; the "Verniz*" finishes stay (leaf renamed "Vernizes").
  if (leaf === 'Vernizes e clears') return /\bclear\b/i.test(name) ? 'Base' : 'Vernizes';
  // Plotagem: transfer masks → own leaf; application tools merge with plotter gear.
  if (leaf === 'Transfer e ferramentas de aplicação')
    return /mascara|transfer/.test(n) ? 'Máscaras de transferência' : 'Ferramentas e equipamentos de plotagem';
  if (leaf === 'Equipamento e consumíveis de plotter') return 'Ferramentas e equipamentos de plotagem';
  return LEAF_RENAME[leaf] ?? leaf;
}

// Name-keyed manual placements for DB items absent from the batches (else → A Revisar).
const ITEM_OVERRIDES: Record<string, string> = {
  'botina reposição - 38': 'Calçados de segurança',
  'galocha - 38': 'Calçados de segurança',
  'luva de proteção anticorte': 'Proteção das mãos (luvas)',
  'óculos de sobrepor escuro': 'Proteção visual, auditiva e corporal',
  'estopa fiapo': 'Higiene, limpeza e zeladoria',
  'disco de polir trizact p3000': 'Polimento e refino',
};
// Accent-insensitive lookup: norm() strips diacritics from item names, so the
// keys must be normalized the same way to match (e.g. "reposição" → "reposicao").
const overrideByNorm = new Map(Object.entries(ITEM_OVERRIDES).map(([k, v]) => [norm(k), v]));

// --- Physical nature (ortogonal axis preserved) ---------------------------
function physicalType(top: string): ItemCategoryType {
  const n = norm(top);
  if (n.includes('epi') || n.includes('uniforme')) return ItemCategoryType.PPE;
  // All tool/equipment tops → TOOL. (ELECTRONIC_TOOL was dropped from the DB enum
  // by migration 20260528; isToolType() only matches TOOL.) "Energia e
  // Infraestrutura" is NOT a tool top → REGULAR (stocked/consumed infra goods).
  if (n.includes('ferramentas')) return ItemCategoryType.TOOL;
  return ItemCategoryType.REGULAR;
}

type Tax = {
  categories: { top: string; acct: string | null; leaves: { leaf: string; acct?: string }[] }[];
};
type BatchRow = {
  id: string | null;
  name: string;
  top: string;
  leaf: string;
  confidence: string;
};

async function main(): Promise<void> {
  const log = new Logger('ApplyMergedTaxonomy');
  log.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Starting (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  let exitCode = 0;

  try {
    // ---- Load taxonomy -------------------------------------------------
    const tax: Tax = JSON.parse(readFileSync(path.join(DOCS, 'merged-taxonomy.json'), 'utf8'));
    const ACCT = (k: string | null | undefined): AccountingType | null => {
      if (!k) return null;
      const v = (AccountingType as Record<string, AccountingType>)[k] ?? null;
      if (!v) throw new Error(`Unknown AccountingType "${k}"`);
      return v;
    };
    const topAcct = new Map<string, AccountingType | null>();
    const topLeaves = new Map<string, string[]>();
    const leafToTop = new Map<string, string>();
    const leafAcct = new Map<string, AccountingType | null>(); // leaf → acct (per-leaf override or inherited)
    for (const c of tax.categories) {
      const tAcct = ACCT(c.acct);
      topAcct.set(c.top, tAcct);
      topLeaves.set(c.top, c.leaves.map((l) => l.leaf));
      for (const l of c.leaves) {
        leafToTop.set(l.leaf, c.top);
        leafAcct.set(l.leaf, l.acct ? ACCT(l.acct) : tAcct);
      }
    }
    log.log(`Taxonomy: ${topAcct.size} tops, ${leafToTop.size} leaves`);

    // ---- Load batches & reconcile -------------------------------------
    const rows: BatchRow[] = [];
    for (let i = 1; i <= 8; i++) {
      const b: BatchRow[] = JSON.parse(readFileSync(path.join(DOCS, `classified-batch-${i}.json`), 'utf8'));
      rows.push(...b);
    }
    const errors: string[] = [];
    const idAssign = new Map<string, { leaf: string; review: boolean }>();
    const nameGroups = new Map<string, { leaves: Set<string>; review: boolean }>();
    for (const r of rows) {
      const leaf = reconcileLeaf(r.leaf, r.name);
      if (!leafToTop.has(leaf)) {
        errors.push(`"${r.name.trim()}" → leaf="${leaf}" (from "${r.leaf}") not in taxonomy`);
        continue;
      }
      const review = (r.confidence ?? '').toLowerCase() !== 'alta';
      if (r.id) {
        idAssign.set(r.id, { leaf, review });
      } else {
        const k = norm(r.name);
        const g = nameGroups.get(k) ?? { leaves: new Set<string>(), review: false };
        g.leaves.add(leaf);
        g.review = g.review || review;
        nameGroups.set(k, g);
      }
    }
    if (errors.length) {
      log.error(`Taxonomy reconciliation errors (${errors.length}):`);
      errors.slice(0, 20).forEach((e) => log.error(`  ${e}`));
      throw new Error('Aborting: batch labels do not reconcile to the committed taxonomy.');
    }
    log.log(`Batches: ${rows.length} rows → ${idAssign.size} by-id, ${nameGroups.size} name groups`);

    // ---- Upsert tops (level 1) ----------------------------------------
    const topId = new Map<string, string>();
    for (const top of topAcct.keys()) {
      const acct = topAcct.get(top) ?? null;
      const type = physicalType(top);
      const found = await prisma.itemCategory.findUnique({ where: { name: top }, select: { id: true } });
      if (found) {
        topId.set(top, found.id);
        if (!DRY_RUN)
          await prisma.itemCategory.update({
            where: { id: found.id },
            data: { categoryLevel: 1, parentId: null, accountingType: acct, type },
          });
      } else if (!DRY_RUN) {
        const c = await prisma.itemCategory.create({
          data: { name: top, categoryLevel: 1, parentId: null, accountingType: acct, type },
          select: { id: true },
        });
        topId.set(top, c.id);
      } else {
        topId.set(top, `(new:${top})`);
      }
    }
    log.log(`Tops upserted: ${topId.size}`);

    // ---- Upsert leaves (level 2) --------------------------------------
    const leafId = new Map<string, string>();
    let leafCreated = 0;
    let leafRehomed = 0;
    for (const [top, leaves] of topLeaves) {
      const type = physicalType(top);
      const parent = topId.get(top)!;
      for (const leaf of leaves) {
        const acct = leafAcct.get(leaf) ?? null;
        const found = await prisma.itemCategory.findUnique({ where: { name: leaf }, select: { id: true } });
        if (found) {
          leafId.set(leaf, found.id);
          leafRehomed++;
          if (!DRY_RUN)
            await prisma.itemCategory.update({
              where: { id: found.id },
              data: { categoryLevel: 2, parentId: parent, accountingType: acct, type },
            });
        } else if (!DRY_RUN) {
          const c = await prisma.itemCategory.create({
            data: { name: leaf, categoryLevel: 2, parentId: parent, accountingType: acct, type },
            select: { id: true },
          });
          leafId.set(leaf, c.id);
          leafCreated++;
        } else {
          leafId.set(leaf, `(new:${leaf})`);
          leafCreated++;
        }
      }
    }
    log.log(`Leaves: ${leafCreated} created, ${leafRehomed} re-homed from existing rows`);

    // ---- Ensure "A Revisar" -------------------------------------------
    let review = await prisma.itemCategory.findFirst({ where: { name: REVIEW_NAME }, select: { id: true } });
    if (!review && !DRY_RUN) {
      review = await prisma.itemCategory.create({
        data: { name: REVIEW_NAME, categoryLevel: 1, parentId: null, accountingType: null },
        select: { id: true },
      });
    }
    const reviewId = review?.id ?? '(new:A Revisar)';

    // ---- Resolve every DB item → target leaf --------------------------
    const dbItems = await prisma.item.findMany({ select: { id: true, name: true } });
    const plan = new Map<string, { catId: string; review: boolean }>(); // itemId → target
    const stats = { byId: 0, byName: 0, conflict: 0, override: 0, uncovered: 0 };
    for (const it of dbItems) {
      const byId = idAssign.get(it.id);
      if (byId) {
        plan.set(it.id, { catId: leafId.get(byId.leaf)!, review: byId.review });
        stats.byId++;
        continue;
      }
      const g = nameGroups.get(norm(it.name));
      if (g && g.leaves.size === 1) {
        plan.set(it.id, { catId: leafId.get([...g.leaves][0])!, review: g.review });
        stats.byName++;
      } else if (g) {
        plan.set(it.id, { catId: reviewId, review: true }); // name maps to >1 leaf → review
        stats.conflict++;
      } else {
        const ov = overrideByNorm.get(norm(it.name));
        if (ov && leafId.has(ov)) {
          plan.set(it.id, { catId: leafId.get(ov)!, review: false }); // manual placement
          stats.override++;
        } else {
          plan.set(it.id, { catId: reviewId, review: true }); // not in any batch → review
          stats.uncovered++;
        }
      }
    }
    log.log(
      `Items resolved: by-id=${stats.byId} by-name=${stats.byName} override=${stats.override} ` +
        `conflict→revisar=${stats.conflict} uncovered→revisar=${stats.uncovered} (total ${dbItems.length})`,
    );

    // ---- Repoint items (batched updateMany by target) -----------------
    const groups = new Map<string, string[]>(); // `${catId}|${review}` → itemIds
    for (const [itemId, t] of plan) {
      const k = `${t.catId}|${t.review ? 1 : 0}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(itemId);
    }
    let repointed = 0;
    let flagged = 0;
    for (const [k, ids] of groups) {
      const [catId, rv] = k.split('|');
      const reviewFlag = rv === '1';
      if (reviewFlag) flagged += ids.length;
      if (!DRY_RUN) {
        for (let i = 0; i < ids.length; i += 500) {
          await prisma.item.updateMany({
            where: { id: { in: ids.slice(i, i + 500) } },
            data: { categoryId: catId, categoryReviewNeeded: reviewFlag },
          });
        }
      }
      repointed += ids.length;
    }
    log.log(`Items repointed: ${repointed} (flagged review: ${flagged})`);

    // ---- Cleanup empty legacy categories (transitive, bottom-up) ------
    // After the repoint above, no Item points at a legacy category, so a legacy
    // subtree is empty of items. The previous single-pass delete used a STALE
    // child-count snapshot: a legacy PARENT whose children were deleted in the
    // same batch was evaluated as still-populated and left orphaned. Compute
    // deletability transitively instead — a legacy row is deletable iff it holds
    // no items AND every child is itself a deletable legacy row. Kept rows (the
    // 14 tops, the leaves, "A Revisar") are never deleted and block any legacy
    // ancestor. (parentId is onDelete: SetNull, so deleting a whole deletable
    // subtree in one deleteMany is FK-safe and never strands a survivor.)
    const targetIds = new Set<string>([...topId.values(), ...leafId.values(), reviewId]);
    const all = await prisma.itemCategory.findMany({
      select: { id: true, name: true, parentId: true, _count: { select: { items: true } } },
    });
    const legacy = all.filter((c) => !targetIds.has(c.id) && c.name !== REVIEW_NAME);
    const legacyIds = new Set(legacy.map((c) => c.id));
    const itemsById = new Map(legacy.map((c) => [c.id, c._count.items]));
    const childrenOf = new Map<string, string[]>();
    for (const c of all) {
      if (c.parentId)
        (childrenOf.get(c.parentId) ?? childrenOf.set(c.parentId, []).get(c.parentId)!).push(c.id);
    }
    const memo = new Map<string, boolean>();
    const isDeletable = (id: string): boolean => {
      if (memo.has(id)) return memo.get(id)!;
      if (!legacyIds.has(id)) return false; // kept row → blocks its ancestors
      memo.set(id, false); // cycle guard (no cycles expected)
      let ok = (itemsById.get(id) ?? 0) === 0;
      if (ok)
        for (const childId of childrenOf.get(id) ?? [])
          if (!isDeletable(childId)) {
            ok = false;
            break;
          }
      memo.set(id, ok);
      return ok;
    };
    const deletable = legacy.filter((c) => isDeletable(c.id));
    const blocked = legacy.filter((c) => !isDeletable(c.id));
    if (blocked.length)
      log.warn(
        `Legacy rows NOT deleted (still populated): ${blocked
          .map((c) => `${c.name}[items=${itemsById.get(c.id) ?? 0},children=${(childrenOf.get(c.id) ?? []).length}]`)
          .join(', ')}`,
      );
    if (!DRY_RUN && deletable.length) {
      const ids = deletable.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 500)
        await prisma.itemCategory.deleteMany({ where: { id: { in: ids.slice(i, i + 500) } } });
    }
    log.log(`Legacy categories deleted: ${deletable.length}${DRY_RUN ? ' (dry-run, would delete)' : ''}`);
    if (deletable.length) log.log(`  -> ${deletable.map((c) => c.name).join(', ')}`);

    // ---- Rebuild the transaction-category mirror ----------------------
    if (!DRY_RUN) {
      const mirror = app.get(TransactionCategoryService);
      const r = await mirror.syncAllItemCategoryMirrors();
      log.log(
        `Mirror sync: created=${r.created} updated=${r.updated} deactivated=${r.deactivated} deleted=${r.deleted} unchanged=${r.unchanged}`,
      );
    } else {
      log.log('Mirror sync skipped (dry-run).');
    }

    log.log(DRY_RUN ? '[DRY-RUN] complete — no writes performed.' : 'Done.');
  } catch (err) {
    exitCode = 1;
    new Logger('ApplyMergedTaxonomy').error(`Failed: ${err instanceof Error ? err.stack : err}`);
  } finally {
    await app.close();
    process.exit(exitCode);
  }
}

void main();
