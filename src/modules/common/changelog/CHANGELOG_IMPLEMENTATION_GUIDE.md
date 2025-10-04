# Changelog Implementation Guide

## Overview

This guide explains how to properly implement changelog tracking in Ankaa
services to avoid JSON serialization errors and maintain efficient, meaningful
audit trails.

## Common Issues and Solutions

### 1. JSON Serialization Errors

**Problem**: "value must be a valid json" errors in Prisma Studio

**Causes**:

- Circular references in entities with bidirectional relationships
- Undefined values in objects
- Non-serializable types (functions, symbols)
- Prisma internal fields (starting with `_`)

**Solution**: Use the `serializeChangelogValue` utility which handles all these
cases.

### 2. Large Changelog Entries

**Problem**: Storing entire entities with all relations creates huge changelog
entries

**Solution**:

- Use field-level tracking for updates
- Store only essential fields for create/delete operations
- Never include deep nested relations

## Best Practices

### 1. Field-Level Tracking for Updates

Instead of logging entire entities, track individual field changes:

```typescript
import { trackFieldChanges } from '@modules/common/changelog/utils/changelog-helpers';

// In your update method
await trackFieldChanges({
  changeLogService: this.changeLogService,
  entityType: ENTITY_TYPE.ITEM,
  entityId: id,
  oldEntity: existingItem,
  newEntity: updatedItem,
  fieldsToTrack: Object.keys(data), // Only track fields that were in the update request
  userId,
  transaction: tx,
});
```

### 2. Essential Fields Only for Create/Delete

When logging create or delete operations, store only essential fields:

```typescript
import {
  logEntityChange,
  extractEssentialFields,
  getEssentialFields,
} from '@modules/common/changelog/utils/changelog-helpers';

// For CREATE
const essentialFields = getEssentialFields(ENTITY_TYPE.ITEM);
const entityForLog = extractEssentialFields(newItem, essentialFields);

await logEntityChange({
  changeLogService: this.changeLogService,
  entityType: ENTITY_TYPE.ITEM,
  entityId: newItem.id,
  action: CHANGE_ACTION.CREATE,
  entity: entityForLog,
  reason: 'Item criado',
  userId,
  transaction: tx,
});

// For DELETE
await logEntityChange({
  changeLogService: this.changeLogService,
  entityType: ENTITY_TYPE.ITEM,
  entityId: id,
  action: CHANGE_ACTION.DELETE,
  oldEntity: extractEssentialFields(existingItem, essentialFields),
  reason: 'Item excluído',
  userId,
  transaction: tx,
});
```

### 3. Avoid Common Pitfalls

#### ❌ Don't do this:

```typescript
// Don't use redundant undefined checks
userId: userId || undefined  // BAD

// Don't pass entire entities with relations
oldValue: existingItem  // BAD if includes relations
newValue: updatedItem   // BAD if includes relations

// Don't use JSON.stringify for comparisons
if (JSON.stringify(oldValue) !== JSON.stringify(newValue))  // BAD
```

#### ✅ Do this instead:

```typescript
// Simple userId passing
userId,  // GOOD

// Use field-level tracking
field: "quantity",
oldValue: existingItem.quantity,  // GOOD
newValue: updatedItem.quantity,   // GOOD

// Use hasValueChanged utility
if (hasValueChanged(oldValue, newValue))  // GOOD
```

## Implementation Examples

### Example 1: Complete Service Implementation

```typescript
export class ItemService {
  async update(
    id: string,
    data: ItemUpdateFormData,
    userId: string,
  ): Promise<ItemUpdateResponse> {
    return await this.prisma.$transaction(async tx => {
      const existingItem = await this.itemRepository.findByIdWithTransaction(
        tx,
        id,
      );

      if (!existingItem) {
        throw new NotFoundException('Item não encontrado');
      }

      const updatedItem = await this.itemRepository.updateWithTransaction(
        tx,
        id,
        data,
      );

      // Track individual field changes
      await trackFieldChanges({
        changeLogService: this.changeLogService,
        entityType: ENTITY_TYPE.ITEM,
        entityId: id,
        oldEntity: existingItem,
        newEntity: updatedItem,
        fieldsToTrack: Object.keys(data),
        userId,
        transaction: tx,
      });

      return updatedItem;
    });
  }
}
```

### Example 2: Batch Operations

```typescript
// In batch create
for (const item of createdItems) {
  const essentialFields = getEssentialFields(ENTITY_TYPE.ITEM);
  await logEntityChange({
    changeLogService: this.changeLogService,
    entityType: ENTITY_TYPE.ITEM,
    entityId: item.id,
    action: CHANGE_ACTION.CREATE,
    entity: extractEssentialFields(item, essentialFields),
    reason: 'Item criado em lote',
    userId,
    triggeredBy: CHANGE_TRIGGERED_BY.BATCH_CREATE,
    transaction: tx,
  });
}
```

### Example 3: Special Field Changes

For fields that need special handling (like status changes):

```typescript
if (data.status && data.status !== existingOrder.status) {
  await this.changeLogService.logChange({
    entityType: ENTITY_TYPE.ORDER,
    entityId: id,
    action: CHANGE_ACTION.UPDATE,
    field: 'status',
    oldValue: existingOrder.status,
    newValue: data.status,
    reason: `Status alterado de ${existingOrder.status} para ${data.status}`,
    triggeredBy: CHANGE_TRIGGERED_BY.USER_ACTION,
    triggeredById: id,
    userId,
    transaction: tx,
  });
}
```

## Migration Strategy

To migrate existing services:

1. **Identify services with issues**: Look for services passing entire entities
   to changelog
2. **Update imports**: Add changelog helper imports
3. **Replace entity-level logging** with field-level tracking for updates
4. **Use essential fields** for create/delete operations
5. **Remove redundant patterns** like `userId || undefined`
6. **Test thoroughly**: Ensure changelogs are created correctly

## Checklist for New Services

- [ ] Import changelog helpers
- [ ] Use `trackFieldChanges` for all update operations
- [ ] Use `extractEssentialFields` for create/delete operations
- [ ] Define essential fields for your entity type
- [ ] Never pass entire entities with relations
- [ ] Always pass userId without redundant checks
- [ ] Use appropriate `triggeredBy` values
- [ ] Test changelog creation in all CRUD operations
