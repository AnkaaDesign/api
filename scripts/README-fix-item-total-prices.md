# Fix Item Total Prices Script

## Quick Start

```bash
# Preview what will change (safe)
npx tsx scripts/fix-item-total-prices.ts --dry-run

# Apply the fixes
npx tsx scripts/fix-item-total-prices.ts
```

## What it does

This script ensures all items have the correct `totalPrice` by:

1. Fetching all items with their current prices
2. Calculating: `totalPrice = quantity × currentPrice`
3. Updating items where the values don't match

## When to use

- After bulk imports
- After database migrations
- When you suspect data inconsistencies
- As part of deployment verification

## Safety

- ✅ Uses batched transactions (100 items per batch)
- ✅ Provides detailed preview with `--dry-run`
- ✅ Shows sample of changes before applying
- ✅ Atomic updates (all or nothing per batch)
- ✅ Read-only when using `--dry-run` flag

## Output Example

```
==========================================
Fix Item Total Prices Script
==========================================
Mode: DRY RUN (no changes)

[1/4] Fetching all items with prices...
✓ Found 510 items

[2/4] Analyzing items and calculating correct totalPrice...
✓ Analysis complete:
  - Items with correct totalPrice: 9
  - Items needing update: 444
  - Items with no price: 150

[3/4] Sample of changes (first 10):
  1. Copo Pistola de Pintura
     Quantity: 38 × Price: 30
     Current: null → Correct: 1140
  ...

[4/4] DRY RUN - No changes made
```

## Verification

After running, verify with:

```bash
PGPASSWORD=docker psql -h localhost -U docker -d ankaa -c "
SELECT
  COUNT(*) as total_items,
  COUNT(CASE WHEN ABS(COALESCE(i.\"totalPrice\", 0) -
    (i.quantity * COALESCE(mv.value, 0))) < 0.01 THEN 1 END) as correct_items
FROM \"Item\" i
LEFT JOIN \"MonetaryValue\" mv
  ON mv.\"itemId\" = i.id AND mv.current = true;
"
```

Expected output: `correct_items` should equal `total_items`

## Maintenance

This script should only be needed:
- Once (initial fix) ✅ Done
- Occasionally for verification
- After major data migrations

The application now automatically maintains `totalPrice` on all updates!
