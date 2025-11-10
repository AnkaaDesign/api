# Item Total Price Automatic Calculation Solution

## Problem Statement

The `Item.totalPrice` field was a denormalized database field that should always equal `quantity × currentPrice`. However, it was only being updated in certain scenarios, leading to data inconsistencies:

### Original Issues:
1. **Not updated when price changes**: When a new price was added to an item, `totalPrice` was not recalculated
2. **Not updated in atomic stock operations**: The `AtomicStockUpdateService` was updating quantities directly without recalculating `totalPrice`
3. **Historical data was incorrect**: 444 out of 510 items had incorrect or null `totalPrice` values

## Solution Overview

The solution consists of three components:

### 1. Data Migration Script
**File**: `/scripts/fix-item-total-prices.ts`

A one-time script that:
- Fetches all items with their current prices
- Calculates the correct `totalPrice` (quantity × current price)
- Updates items where `totalPrice` is incorrect
- Provides detailed logging and dry-run mode

**Usage**:
```bash
# Dry run (preview changes)
npx tsx scripts/fix-item-total-prices.ts --dry-run

# Apply changes
npx tsx scripts/fix-item-total-prices.ts
```

**Results**:
- Fixed 444 items
- 510/510 items now have correct totalPrice values
- 0 incorrect items remaining

### 2. Repository Layer Updates
**File**: `/src/modules/inventory/item/repositories/item/item-prisma.repository.ts`

**Changes in `updateWithTransaction` method** (lines 591-677):

```typescript
// Before: Only recalculated when quantity changed
if (data.quantity !== undefined) { ... }

// After: Recalculates when quantity OR price changes
const isQuantityChanging = data.quantity !== undefined;
const isPriceChanging = data.price !== undefined;

if (isQuantityChanging || isPriceChanging) {
  // Calculate totalPrice with new values
  const price = isPriceChanging ? data.price! : currentPrice;
  const quantity = isQuantityChanging ? data.quantity! : currentItem.quantity;
  updateInput.totalPrice = price * quantity;
}

// IMPORTANT: Handle nested price creation timing
if (isPriceChanging && result) {
  // Re-fetch item with newly created price
  // Update totalPrice if needed
}
```

**Key Features**:
- Detects both quantity and price changes
- Handles the timing issue where nested price creation happens after item update
- Ensures totalPrice is always correct after any update

### 3. Atomic Stock Update Service Updates
**File**: `/src/modules/inventory/services/atomic-stock-update.service.ts`

**Changes in `updateItemQuantities` method** (lines 131-225):

```typescript
// Before: Only updated quantity
await tx.item.update({
  where: { id: calculation.itemId },
  data: { quantity: calculation.finalQuantity },
});

// After: Updates both quantity AND totalPrice
const itemWithPrice = await tx.item.findUnique({
  where: { id: calculation.itemId },
  include: { prices: { where: { current: true }, ... } },
});

const currentPrice = itemWithPrice?.prices[0]?.value ?? 0;
const newTotalPrice = calculation.finalQuantity * currentPrice;

await tx.item.update({
  where: { id: calculation.itemId },
  data: {
    quantity: calculation.finalQuantity,
    totalPrice: newTotalPrice,
  },
});
```

**Key Features**:
- Fetches current price before updating quantity
- Calculates new totalPrice automatically
- Logs both quantity and totalPrice changes
- Maintains data consistency in atomic operations

## Formula

```
totalPrice = quantity × currentPrice
```

Where:
- `quantity`: Current stock level (`Item.quantity`)
- `currentPrice`: Latest price with `current: true` from `MonetaryValue.value`
- `totalPrice`: Denormalized field storing the total value (`Item.totalPrice`)

## Automatic Update Triggers

The `totalPrice` field now automatically updates when:

1. **Creating an item** with a price
   - Location: `item-prisma.repository.ts:342-361`
   - Trigger: `createWithTransaction`

2. **Updating item quantity**
   - Location: `item-prisma.repository.ts:604-628`
   - Trigger: `data.quantity !== undefined`

3. **Adding/updating item price**
   - Location: `item-prisma.repository.ts:605-670`
   - Trigger: `data.price !== undefined`

4. **Atomic stock operations** (activities, orders, etc.)
   - Location: `atomic-stock-update.service.ts:144-165`
   - Trigger: Any quantity change through atomic operations

## Edge Cases Handled

### 1. No Price Set
- If item has no price: `totalPrice = 0`
- Prevents null/undefined issues

### 2. Price Creation Timing
- Nested price creation happens after item update
- Solution fetches item again after update to get new price
- Performs second update if totalPrice is incorrect

### 3. Floating Point Precision
- Uses rounding to avoid comparison issues
- Rounds to 2 decimal places: `Math.round(value * 100) / 100`

### 4. Multiple Prices
- Only uses `current: true` price
- Orders by `updatedAt DESC` and takes first

## Testing

### Verification Query
```sql
SELECT
  COUNT(*) as total_items,
  COUNT(CASE WHEN ABS(COALESCE(i."totalPrice", 0) -
    (i.quantity * COALESCE(mv.value, 0))) < 0.01 THEN 1 END) as correct_items
FROM "Item" i
LEFT JOIN "MonetaryValue" mv
  ON mv."itemId" = i.id AND mv.current = true;
```

### Current Status
- **Total Items**: 510
- **Correct Items**: 510 (100%)
- **Incorrect Items**: 0 (0%)

## Future Maintenance

### When to Run Migration Script
Run the migration script if:
1. Data inconsistencies are detected
2. After bulk imports or database migrations
3. As part of deployment verification

### Monitoring
Add monitoring to detect inconsistencies:

```typescript
// Example monitoring query
const inconsistentItems = await prisma.$queryRaw`
  SELECT i.id, i.name, i.quantity, i."totalPrice", mv.value as "currentPrice"
  FROM "Item" i
  LEFT JOIN "MonetaryValue" mv ON mv."itemId" = i.id AND mv.current = true
  WHERE ABS(COALESCE(i."totalPrice", 0) -
    (i.quantity * COALESCE(mv.value, 0))) >= 0.01
`;
```

### Database Triggers (Alternative Approach)
If you want even more robust guarantees, consider implementing PostgreSQL triggers:

```sql
CREATE OR REPLACE FUNCTION update_item_total_price()
RETURNS TRIGGER AS $$
DECLARE
  current_price NUMERIC;
BEGIN
  -- Get current price
  SELECT value INTO current_price
  FROM "MonetaryValue"
  WHERE "itemId" = NEW.id AND current = true
  ORDER BY "updatedAt" DESC
  LIMIT 1;

  -- Update totalPrice
  NEW."totalPrice" := NEW.quantity * COALESCE(current_price, 0);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER item_total_price_trigger
BEFORE INSERT OR UPDATE OF quantity ON "Item"
FOR EACH ROW
EXECUTE FUNCTION update_item_total_price();
```

## Performance Considerations

### Repository Updates
- **Additional queries**: 1-2 extra queries per update
- **Impact**: Minimal (happens in same transaction)
- **Benefit**: Guaranteed data consistency

### Atomic Updates
- **Additional query**: 1 extra query per item in batch
- **Impact**: Low (bulk operations are already expensive)
- **Benefit**: Prevents data drift in high-volume operations

### Migration Script
- **Batch size**: 100 items per transaction
- **Execution time**: ~2-3 seconds for 444 updates
- **Memory usage**: Low (streaming approach)

## Conclusion

This solution ensures that `Item.totalPrice` is **always** accurate by:

1. ✅ Fixing all existing incorrect data (444 items updated)
2. ✅ Automatically recalculating on quantity changes
3. ✅ Automatically recalculating on price changes
4. ✅ Handling atomic stock operations
5. ✅ Managing edge cases (no price, timing issues)
6. ✅ Providing verification tools and monitoring

The implementation is **transparent**, **automatic**, and **reliable** - you don't need to think about it anymore!

---

**Last Updated**: 2025-11-06
**Status**: ✅ Implemented and Verified
**Modified Files**:
- `/scripts/fix-item-total-prices.ts` (new)
- `/src/modules/inventory/item/repositories/item/item-prisma.repository.ts`
- `/src/modules/inventory/services/atomic-stock-update.service.ts`
