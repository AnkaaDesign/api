# Item Category Migration — Proposal & Artifacts

Working artifacts for the item-category / accounting-type taxonomy restructure.
The DB foundation already shipped: migration `prisma/migrations/20260602140000_category_taxonomy_3level`
plus the backfill/mirror scripts under `src/scripts/`. These files are the **design and
migration source data** used to produce and review that change — kept here so the work can be
analyzed and continued from any machine.

## Design
- `proposta-reestruturacao-categorizacao.md` — full restructure design: 4 orthogonal axes
  (AccountingType chart-of-accounts · operational Category→Subcategoria tree · ItemCategoryType ·
  TransactionCategoryKind), the 13 fixed AccountingType values, and the phased plan.
- `proposta-categorizacao-itens.html` — the original 13-category / ~60-subcategory proposal (visual).

## Source datasets
- `itens-base.tsv` — raw item export the proposal was built from.
- `itens-classificados.csv` — 729 items classified (`nome, categoria, subcategoria, grupoContabil, confianca`);
  the migration source.

## Reclassification toolkit — `category-reclassify/`
- `merged-taxonomy.json` — the agreed taxonomy (13 categories → ~40 merged leaf subcategories).
- `classified-batch-1..8.json` — 730 items classified by 8 batches (0 leaf mismatches; ~628 alta / 66 média / 36 baixa confidence).
- `items.json`, `item-categories.json`, `tx-categories.json` — read-only DB dumps used as input.
- `build-reclassify-html.js` → `item-reclassify.html` — the review tool (uniCode / name / category-select per item).
  Open the HTML, adjust assignments, and **export `reclassification.json`** — the input for the seed script that
  creates the merged leaves, repoints items, deletes legacy categories, and re-runs the mirror sync.

> Note: `items.json` / `tx-categories.json` contain real business data (private repo).
