# Merge Feature - Comprehensive Specification and Test Cases

## Overview
This document outlines the complete specification for merging items and paints in the Ankaa system, including validation rules, edge cases, test scenarios, and implementation guidelines.

## 1. Business Requirements

### 1.1 Purpose
- Consolidate duplicate or similar items/paints into a single entity
- Preserve all historical data and relationships
- Maintain data integrity across all related entities

### 1.2 Scope
- **Items**: Merge inventory items with all their relationships
- **Paints**: Merge paint entities with formulas and relationships

## 2. Validation Rules

### 2.1 Pre-Merge Validation

#### Common Validations (Items and Paints)
1. **Minimum Selection**: At least 2 entities must be selected for merge
   - Error: "É necessário selecionar pelo menos 2 itens para realizar a mesclagem"

2. **Entity Status**: Cannot merge CANCELLED entities
   - Error: "Não é possível mesclar itens com status CANCELADO"

3. **Permission Check**: User must have edit permission for all entities
   - Error: "Você não tem permissão para editar todos os itens selecionados"

4. **Existence Check**: All selected entities must exist
   - Error: "Um ou mais itens selecionados não foram encontrados"

5. **Active Status**: All items must be active (isActive = true)
   - Error: "Não é possível mesclar itens inativos"

#### Item-Specific Validations
6. **Supplier Match**: All items must have the same supplier (or all null)
   - Error: "Não é possível mesclar itens de fornecedores diferentes"

7. **Category Match**: All items should have the same category
   - Warning: "Os itens possuem categorias diferentes. A categoria do item principal será mantida"

8. **Brand Match**: All items should have the same brand
   - Warning: "Os itens possuem marcas diferentes. A marca do item principal será mantida"

9. **Active Orders**: Cannot merge if any item has active orders
   - Error: "Não é possível mesclar itens que possuem pedidos ativos (status: PARTIALLY_FULFILLED, FULFILLED, PARTIALLY_RECEIVED)"
   - Check: OrderItem relationships where Order.status is in active statuses

10. **Measure Type Compatibility**: Items should have compatible measure types
    - Warning: "Os itens possuem tipos de medida diferentes. As medidas serão combinadas"

11. **PPE Configuration**: Cannot merge PPE items with non-PPE items
    - Error: "Não é possível mesclar itens de EPIs com itens normais"

#### Paint-Specific Validations
12. **Paint Type Match**: All paints should have the same paint type
    - Warning: "As tintas possuem tipos diferentes. O tipo da tinta principal será mantido"

13. **Brand Match**: All paints should have the same brand
    - Warning: "As tintas possuem marcas diferentes. A marca da tinta principal será mantida"

14. **Formula Compatibility**: Check for formula conflicts
    - Warning: "As tintas possuem fórmulas diferentes. As fórmulas serão combinadas"

15. **Ground Paint Cycles**: Prevent circular references in ground paint relationships
    - Error: "Mesclar estas tintas criaria uma referência circular nas tintas de fundo"

### 2.2 Merge Strategy Selection

The user must select one entity as the "primary" (target):
- Primary entity's core attributes are preserved
- Other entities' data is aggregated
- User is prompted to resolve conflicts

## 3. Merge Process

### 3.1 Item Merge Process

```typescript
interface ItemMergeRequest {
  primaryItemId: string;        // The item to keep
  itemsToMergeIds: string[];    // Items to merge into primary
  resolveConflicts?: {
    keepPrimaryPrice?: boolean;
    keepPrimaryDescription?: boolean;
    combineBarc: boolean;
    combineTags?: boolean;
  };
}
```

#### 3.1.1 Core Fields (Primary Wins)
- name
- uniCode
- description (unless user chooses otherwise)
- brandId
- categoryId
- supplierId
- ppeType, ppeSize, ppeCA, ppeDeliveryMode (PPE fields)
- status, statusOrder
- isActive

#### 3.1.2 Numeric Fields (Aggregate)
- **quantity**: Sum of all quantities
- **reorderPoint**: Weighted average based on quantities
- **maxQuantity**: Maximum of all maxQuantity values
- **estimatedLeadTime**: Average of all lead times
- **monthlyConsumption**: Weighted average

#### 3.1.3 Arrays (Combine)
- **barcodes**: Combine all unique barcodes
- **measures**: Combine all unique measures (by measureType)

#### 3.1.4 Relationships (Reassign)
- **Activities**: All activities point to primary item
- **Prices**: All price history preserved, pointing to primary
- **Borrows**: All borrow records point to primary
- **OrderItems**: All order items point to primary
- **External Withdrawal Items**: Point to primary
- **PPE Deliveries**: Point to primary
- **Paint Formula Components**: Point to primary
- **Paint Type Component Items**: Update references
- **Related Items**: Update both sides of relationship

#### 3.1.5 Changelog
- Create detailed changelog entries for:
  - Primary item update (merged fields)
  - Each merged item deletion
  - Quantity aggregation
  - Relationship reassignments

### 3.2 Paint Merge Process

```typescript
interface PaintMergeRequest {
  primaryPaintId: string;       // The paint to keep
  paintsToMergeIds: string[];   // Paints to merge into primary
  resolveConflicts?: {
    keepPrimaryHex?: boolean;
    keepPrimaryFinish?: boolean;
    combineTags?: boolean;
    combineFormulas?: boolean;
  };
}
```

#### 3.2.1 Core Fields (Primary Wins)
- name
- code
- hex (unless user chooses otherwise)
- finish (unless user chooses otherwise)
- brand
- manufacturer
- palette, paletteOrder
- paintTypeId
- status, statusOrder

#### 3.2.2 Arrays (Combine)
- **tags**: Combine all unique tags (normalized to lowercase)

#### 3.2.3 Relationships (Reassign)
- **Formulas**: All formulas point to primary paint
- **Productions**: All production records point to primary
- **Tasks (generalPaintings)**: All tasks using paint point to primary
- **Tasks (logoTasks)**: Update many-to-many relationship
- **Paint Grounds (groundPaints)**: Update relationships
- **Paint Grounds (groundPaintFor)**: Update reverse relationships

#### 3.2.4 Changelog
- Create detailed changelog entries for:
  - Primary paint update (merged fields)
  - Each merged paint deletion
  - Formula reassignments
  - Ground paint relationship updates

## 4. Edge Cases

### 4.1 Circular References
**Scenario**: Paint A has ground paint B, Paint B has ground paint A
**Prevention**: Validate ground paint relationships before merge
**Error**: "Mesclar estas tintas criaria uma referência circular nas tintas de fundo"

### 4.2 Already Merged Item
**Scenario**: Item A was merged into Item B, user tries to merge Item A again
**Prevention**: Check if item has been deleted/merged via changelog
**Error**: "Um ou mais itens já foram mesclados anteriormente"

### 4.3 Concurrent Merge Operations
**Scenario**: Two users try to merge overlapping sets of items simultaneously
**Prevention**: Use database transactions with row-level locks
**Handling**: Second merge fails with conflict error

### 4.4 Large Number of Related Records
**Scenario**: Merging items with thousands of activities/prices
**Handling**:
- Process in batches within transaction
- Show progress indicator
- Timeout protection (max 2 minutes)

### 4.5 Measure Type Conflicts
**Scenario**: Item A has WEIGHT measure, Item B has VOLUME measure
**Resolution**: Combine both measures in primary item

### 4.6 Price History
**Scenario**: Multiple items with extensive price histories
**Resolution**: Preserve all prices, mark with origin item in changelog

### 4.7 PPE Configuration Mismatch
**Scenario**: Merging HELMET with GLOVES
**Prevention**: Block merge with error
**Error**: "Não é possível mesclar tipos diferentes de EPIs"

## 5. Test Scenarios

### 5.1 Basic Merge Tests

#### Test 1.1: Merge 2 Identical Items (No Conflicts)
```typescript
describe('Item Merge - Basic Cases', () => {
  it('should successfully merge 2 identical items', async () => {
    // Arrange
    const item1 = createTestItem({
      name: 'Item A',
      quantity: 10,
      brandId: 'brand-1',
      categoryId: 'cat-1'
    });
    const item2 = createTestItem({
      name: 'Item A',
      quantity: 5,
      brandId: 'brand-1',
      categoryId: 'cat-1'
    });

    // Act
    const result = await mergeItems({
      primaryItemId: item1.id,
      itemsToMergeIds: [item2.id]
    });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data.quantity).toBe(15); // 10 + 5
    expect(await itemExists(item2.id)).toBe(false);
  });
});
```

#### Test 1.2: Merge Items with Different Quantities
```typescript
it('should sum quantities when merging items', async () => {
  const items = [
    createTestItem({ quantity: 100 }),
    createTestItem({ quantity: 50 }),
    createTestItem({ quantity: 25 })
  ];

  const result = await mergeItems({
    primaryItemId: items[0].id,
    itemsToMergeIds: [items[1].id, items[2].id]
  });

  expect(result.data.quantity).toBe(175);
});
```

#### Test 1.3: Merge Items with Different Prices
```typescript
it('should preserve all price history', async () => {
  const item1 = createTestItem({ name: 'Item A' });
  await createPrice(item1.id, 10.00);
  await createPrice(item1.id, 12.00);

  const item2 = createTestItem({ name: 'Item A' });
  await createPrice(item2.id, 11.00);

  const result = await mergeItems({
    primaryItemId: item1.id,
    itemsToMergeIds: [item2.id]
  });

  const prices = await getPrices(result.data.id);
  expect(prices.length).toBe(3);
  expect(prices.map(p => p.value)).toContain(10.00);
  expect(prices.map(p => p.value)).toContain(11.00);
  expect(prices.map(p => p.value)).toContain(12.00);
});
```

### 5.2 Paint Merge Tests

#### Test 2.1: Merge Paints with Different Formulas
```typescript
describe('Paint Merge - Formula Handling', () => {
  it('should combine formulas from multiple paints', async () => {
    const paint1 = createTestPaint({ name: 'Red Paint' });
    const formula1 = createFormula(paint1.id, [
      { componentId: 'comp-1', quantity: 100 }
    ]);

    const paint2 = createTestPaint({ name: 'Red Paint' });
    const formula2 = createFormula(paint2.id, [
      { componentId: 'comp-2', quantity: 50 }
    ]);

    const result = await mergePaints({
      primaryPaintId: paint1.id,
      paintsToMergeIds: [paint2.id],
      resolveConflicts: { combineFormulas: true }
    });

    const formulas = await getFormulas(result.data.id);
    expect(formulas.length).toBe(2);
  });
});
```

### 5.3 Validation Tests

#### Test 3.1: Block Merge with Active Orders
```typescript
it('should reject merge when item has active orders', async () => {
  const item1 = createTestItem({ name: 'Item A' });
  const item2 = createTestItem({ name: 'Item A' });

  // Create active order for item1
  await createOrder({
    items: [{ itemId: item1.id, quantity: 5 }],
    status: ORDER_STATUS.PARTIALLY_FULFILLED
  });

  await expect(
    mergeItems({
      primaryItemId: item1.id,
      itemsToMergeIds: [item2.id]
    })
  ).rejects.toThrow('Não é possível mesclar itens que possuem pedidos ativos');
});
```

#### Test 3.2: Block Merge with Different Suppliers
```typescript
it('should reject merge when items have different suppliers', async () => {
  const item1 = createTestItem({ supplierId: 'supplier-1' });
  const item2 = createTestItem({ supplierId: 'supplier-2' });

  await expect(
    mergeItems({
      primaryItemId: item1.id,
      itemsToMergeIds: [item2.id]
    })
  ).rejects.toThrow('Não é possível mesclar itens de fornecedores diferentes');
});
```

#### Test 3.3: Block Merge with Circular Ground Paint References
```typescript
it('should reject merge that creates circular ground paint reference', async () => {
  const paintA = createTestPaint({ name: 'Paint A' });
  const paintB = createTestPaint({ name: 'Paint B', groundIds: [paintA.id] });
  const paintC = createTestPaint({ name: 'Paint C', groundIds: [paintB.id] });

  // Trying to make paintA use paintC as ground would create: A -> C -> B -> A
  await expect(
    mergePaints({
      primaryPaintId: paintA.id,
      paintsToMergeIds: [paintC.id]
    })
  ).rejects.toThrow('Mesclar estas tintas criaria uma referência circular');
});
```

### 5.4 Permission Tests

#### Test 4.1: Reject Merge Without Permission
```typescript
it('should reject merge when user lacks permission', async () => {
  const item1 = createTestItem({});
  const item2 = createTestItem({});

  const userWithoutPermission = createUser({
    privilege: SECTOR_PRIVILEGES.BASIC
  });

  await expect(
    mergeItems(
      {
        primaryItemId: item1.id,
        itemsToMergeIds: [item2.id]
      },
      userWithoutPermission.id
    )
  ).rejects.toThrow('Você não tem permissão para editar todos os itens');
});
```

### 5.5 Edge Case Tests

#### Test 5.1: Handle Concurrent Merge Attempts
```typescript
it('should handle concurrent merge attempts gracefully', async () => {
  const items = createTestItems(5);

  const merge1 = mergeItems({
    primaryItemId: items[0].id,
    itemsToMergeIds: [items[1].id, items[2].id]
  });

  const merge2 = mergeItems({
    primaryItemId: items[1].id,
    itemsToMergeIds: [items[3].id, items[4].id]
  });

  const results = await Promise.allSettled([merge1, merge2]);

  // One should succeed, one should fail
  expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
  expect(results.filter(r => r.status === 'rejected').length).toBe(1);
});
```

#### Test 5.2: Handle Large Number of Related Records
```typescript
it('should handle merging items with thousands of activities', async () => {
  const item1 = createTestItem({});
  const item2 = createTestItem({});

  // Create 2000 activities for item1
  await createActivities(item1.id, 2000);
  // Create 1500 activities for item2
  await createActivities(item2.id, 1500);

  const startTime = Date.now();
  const result = await mergeItems({
    primaryItemId: item1.id,
    itemsToMergeIds: [item2.id]
  });
  const duration = Date.now() - startTime;

  expect(result.success).toBe(true);
  expect(duration).toBeLessThan(120000); // Less than 2 minutes

  const activities = await getActivities(result.data.id);
  expect(activities.length).toBe(3500);
});
```

## 6. Implementation Guidelines

### 6.1 API Endpoints

```typescript
// Item Merge
POST /api/items/merge
Body: {
  primaryItemId: string;
  itemsToMergeIds: string[];
  resolveConflicts?: ItemMergeConflicts;
}

// Paint Merge
POST /api/paints/merge
Body: {
  primaryPaintId: string;
  paintsToMergeIds: string[];
  resolveConflicts?: PaintMergeConflicts;
}
```

### 6.2 Response Format

```typescript
interface MergeResponse {
  success: boolean;
  message: string;
  data: {
    mergedEntity: Item | Paint;
    mergedCount: number;
    warnings: string[];
    aggregations: {
      totalQuantity?: number;
      totalPrices?: number;
      totalActivities?: number;
      totalFormulas?: number;
    };
  };
}
```

### 6.3 Transaction Management

```typescript
async mergeItems(request: ItemMergeRequest): Promise<MergeResponse> {
  return await this.prisma.$transaction(async (tx) => {
    // 1. Validate all items
    await this.validateMerge(request, tx);

    // 2. Lock items for update
    await this.lockItems(request, tx);

    // 3. Aggregate numeric fields
    const aggregated = await this.aggregateFields(request, tx);

    // 4. Reassign relationships
    await this.reassignRelationships(request, tx);

    // 5. Update primary item
    const updated = await this.updatePrimaryItem(request, aggregated, tx);

    // 6. Delete merged items
    await this.deleteMergedItems(request, tx);

    // 7. Create changelog entries
    await this.logMerge(request, updated, tx);

    return updated;
  }, {
    maxWait: 5000,
    timeout: 120000, // 2 minutes max
    isolationLevel: 'Serializable'
  });
}
```

### 6.4 Changelog Pattern

```typescript
// Log primary item update
await this.changeLogService.logChange({
  entityType: ENTITY_TYPE.ITEM,
  entityId: primaryItem.id,
  action: CHANGE_ACTION.UPDATE,
  field: 'quantity',
  oldValue: primaryItem.quantity,
  newValue: mergedItem.quantity,
  reason: `Mesclado com ${mergedIds.length} item(ns): ${mergedIds.join(', ')}`,
  triggeredBy: CHANGE_TRIGGERED_BY.ITEM_MERGE,
  triggeredById: primaryItem.id,
  userId,
  transaction: tx,
});

// Log each merged item deletion
for (const mergedId of mergedIds) {
  await this.changeLogService.logChange({
    entityType: ENTITY_TYPE.ITEM,
    entityId: mergedId,
    action: CHANGE_ACTION.DELETE,
    reason: `Mesclado no item: ${primaryItem.name} (${primaryItem.id})`,
    triggeredBy: CHANGE_TRIGGERED_BY.ITEM_MERGE,
    triggeredById: primaryItem.id,
    userId,
    transaction: tx,
  });
}
```

## 7. Known Limitations

### 7.1 Performance
- Maximum 10 items can be merged in a single operation
- Operations with >10,000 total related records may timeout
- Recommended to merge in smaller batches

### 7.2 Data Loss Scenarios
- Custom fields not in merge strategy are lost
- Some changelog detail may be compressed for performance
- Original entity IDs are not recoverable after merge

### 7.3 Rollback
- Merge operations cannot be automatically rolled back
- Manual data restoration required from changelog
- Recommended to backup before major merges

## 8. Testing Checklist

### Pre-Implementation
- [ ] Review all validation rules
- [ ] Design database migration for merge history table
- [ ] Create test data generator
- [ ] Set up test database with realistic data

### Unit Tests
- [ ] Validation functions for all rules
- [ ] Aggregation logic for numeric fields
- [ ] Array combination logic
- [ ] Relationship reassignment logic

### Integration Tests
- [ ] Basic merge (2 items, no conflicts)
- [ ] Complex merge (multiple items with relationships)
- [ ] Merge with conflicts (require user resolution)
- [ ] Permission validation
- [ ] Concurrent merge handling

### Edge Case Tests
- [ ] Circular reference prevention
- [ ] Large dataset handling
- [ ] Transaction rollback scenarios
- [ ] Already merged entity handling

### Performance Tests
- [ ] Merge with 10,000+ activities
- [ ] Merge with 100+ price records
- [ ] Concurrent merge stress test
- [ ] Memory usage profiling

### User Acceptance Tests
- [ ] Merge flow in UI
- [ ] Conflict resolution interface
- [ ] Success/error messaging
- [ ] Changelog verification
- [ ] Data integrity verification

## 9. Success Criteria

### Functional
- ✓ All validation rules enforced
- ✓ No data loss in merge process
- ✓ All relationships correctly reassigned
- ✓ Changelog accurately reflects changes
- ✓ Transaction rollback works on error

### Performance
- ✓ Merge completes in < 2 minutes for typical cases
- ✓ UI remains responsive during merge
- ✓ No memory leaks
- ✓ Concurrent operations handled gracefully

### Security
- ✓ Permission checks enforced
- ✓ Audit trail complete
- ✓ SQL injection prevented
- ✓ XSS prevented in error messages

## 10. Error Messages Reference

### Portuguese Error Messages
```typescript
export const MERGE_ERRORS = {
  MIN_ITEMS: 'É necessário selecionar pelo menos 2 itens para realizar a mesclagem',
  CANCELLED_STATUS: 'Não é possível mesclar itens com status CANCELADO',
  NO_PERMISSION: 'Você não tem permissão para editar todos os itens selecionados',
  NOT_FOUND: 'Um ou mais itens selecionados não foram encontrados',
  INACTIVE_ITEMS: 'Não é possível mesclar itens inativos',
  DIFFERENT_SUPPLIERS: 'Não é possível mesclar itens de fornecedores diferentes',
  ACTIVE_ORDERS: 'Não é possível mesclar itens que possuem pedidos ativos',
  PPE_MISMATCH: 'Não é possível mesclar tipos diferentes de EPIs',
  CIRCULAR_REFERENCE: 'Mesclar estas tintas criaria uma referência circular nas tintas de fundo',
  ALREADY_MERGED: 'Um ou mais itens já foram mesclados anteriormente',
  CONCURRENT_CONFLICT: 'Conflito detectado: outro usuário está modificando estes itens',
  TIMEOUT: 'Operação de mesclagem excedeu o tempo limite',
};

export const MERGE_WARNINGS = {
  DIFFERENT_CATEGORIES: 'Os itens possuem categorias diferentes. A categoria do item principal será mantida',
  DIFFERENT_BRANDS: 'Os itens possuem marcas diferentes. A marca do item principal será mantida',
  MEASURE_COMBINATION: 'Os itens possuem tipos de medida diferentes. As medidas serão combinadas',
  DIFFERENT_TYPES: 'As tintas possuem tipos diferentes. O tipo da tinta principal será mantido',
  FORMULA_COMBINATION: 'As tintas possuem fórmulas diferentes. As fórmulas serão combinadas',
};
```
