# BaseStringPrismaRepository Implementation Guide

## Overview

This guide provides solutions for common generic type parameter issues in
BaseStringPrismaRepository implementations, focusing on database entity mapping
failures, `_count` property handling, tags arrays, and nested includes.

## Key Fixes Implemented

### 1. Enhanced Type Constraints

The base repository now uses proper generic type constraints:

```typescript
export abstract class BaseStringPrismaRepository<
  Entity,
  CreateFormData,
  UpdateFormData,
  Include = any,
  OrderBy = any,
  Where = any,
  DatabaseEntity extends Record<string, unknown> = Record<string, unknown>, // ✓ Fixed
  DatabaseCreateInput = any,
  DatabaseUpdateInput = any,
  DatabaseInclude = any,
  DatabaseOrderBy = any,
  DatabaseWhere = any,
> extends BaseStringRepository<Entity, CreateFormData, UpdateFormData, Include, OrderBy, Where>
```

### 2. Utility Methods for Common Patterns

The base class now provides utility methods for common mapping scenarios:

#### `handleSpecialProperties(databaseEntity: DatabaseEntity)`

- Properly handles `_count` properties from Prisma queries
- Preserves special properties while allowing safe destructuring

#### `mapArrayProperties(databaseEntity: DatabaseEntity, arrayProperties: string[])`

- Ensures array properties are properly initialized as empty arrays
- Prevents null/undefined array access errors

#### `mapIncludeWithNestedHandling(include?: Include, defaultInclude?: DatabaseInclude)`

- Handles nested includes with `_count` support
- Properly maps include structures to Prisma format

## Implementation Examples

### 1. Proper Repository Type Declaration

```typescript
@Injectable()
export class EntityPrismaRepository
  extends BaseStringPrismaRepository<
    Entity,
    EntityCreateFormData,
    EntityUpdateFormData,
    EntityInclude,
    EntityOrderBy,
    EntityWhere,
    Prisma.EntityGetPayload<{ include: any }>, // ✓ Use GetPayload
    Prisma.EntityCreateInput,
    Prisma.EntityUpdateInput,
    Prisma.EntityInclude,
    Prisma.EntityOrderByWithRelationInput,
    Prisma.EntityWhereInput
  >
  implements EntityRepository
```

### 2. Enhanced mapDatabaseEntityToEntity Method

```typescript
protected mapDatabaseEntityToEntity(databaseEntity: Prisma.EntityGetPayload<{ include: any }>): Entity {
  // Use base class utility to handle special properties like _count
  const processedEntity = this.handleSpecialProperties(databaseEntity);

  // Ensure arrays are properly handled using base class utility
  const entityWithArrays = this.mapArrayProperties(processedEntity as any, ['phones', 'tags', 'items']);

  // Create the final entity
  const entity: Entity = {
    ...entityWithArrays,
    // Explicit array initialization for critical arrays
    phones: entityWithArrays.phones ?? [],
    tags: entityWithArrays.tags ?? [],
  };

  // Preserve _count if it exists (for queries that include counts)
  if ('_count' in processedEntity) {
    (entity as any)._count = processedEntity._count;
  }

  return entity;
}
```

### 3. Simplified Include Mapping

```typescript
protected mapIncludeToDatabaseInclude(include?: EntityInclude): Prisma.EntityInclude | undefined {
  // Use base class utility for handling nested includes with _count
  return this.mapIncludeWithNestedHandling(include, this.getDefaultInclude()) as Prisma.EntityInclude | undefined;
}
```

## Common Problems and Solutions

### Problem 1: `_count` Property Handling

**Issue**: `_count` properties from Prisma queries cause type conflicts when
mapping to domain entities.

**Solution**: Use the `handleSpecialProperties` utility:

```typescript
const processedEntity = this.handleSpecialProperties(databaseEntity);
```

### Problem 2: Array Properties Null/Undefined

**Issue**: Array properties (like `tags`, `phones`) can be null/undefined
causing runtime errors.

**Solution**: Use the `mapArrayProperties` utility:

```typescript
const entityWithArrays = this.mapArrayProperties(processedEntity as any, [
  'phones',
  'tags',
]);
```

### Problem 3: Complex Include Structures with `_count`

**Issue**: Include structures with `_count` need special handling for Prisma
compatibility.

**Solution**: Use the `mapIncludeWithNestedHandling` utility:

```typescript
return this.mapIncludeWithNestedHandling(include, defaultInclude) as
  | Prisma.EntityInclude
  | undefined;
```

### Problem 4: Generic Type Parameter Mismatches

**Issue**: Using generic `any` types or incorrect Prisma types causes
compilation errors.

**Solution**: Use proper Prisma `GetPayload` types:

```typescript
// ❌ Wrong
DatabaseEntity = any,
// or
Prisma.Entity & Record<string, unknown>,

// ✅ Correct
Prisma.EntityGetPayload<{ include: any }>,
```

## Best Practices

### 1. Always Use GetPayload Types

- Use `Prisma.EntityGetPayload<{ include: any }>` for database entity types
- This ensures proper type inference for included relations and special
  properties

### 2. Leverage Base Class Utilities

- Use `handleSpecialProperties` for `_count` handling
- Use `mapArrayProperties` for array initialization
- Use `mapIncludeWithNestedHandling` for include mapping

### 3. Explicit Array Handling

- Always ensure array properties are explicitly set to empty arrays
- Use the spread operator with nullish coalescing:
  `array: entityWithArrays.array ?? []`

### 4. Preserve Special Properties

- Always check for and preserve `_count` properties
- Use type assertions carefully when adding special properties

### 5. Consistent Error Handling

- Use the base class error logging methods
- Follow the established error message patterns in Portuguese

## Migration Guide

To update an existing repository:

1. **Update the type parameters** to use `GetPayload`:

   ```diff
   - DatabaseEntity = any,
   + DatabaseEntity extends Record<string, unknown> = Record<string, unknown>,
   ```

2. **Replace manual `_count` handling** with utility method:

   ```diff
   - const { _count, ...entityData } = databaseEntity as any;
   + const processedEntity = this.handleSpecialProperties(databaseEntity);
   ```

3. **Replace manual array initialization** with utility method:

   ```diff
   - phones: customerData.phones ?? [],
   - tags: customerData.tags ?? [],
   + const entityWithArrays = this.mapArrayProperties(processedEntity as any, ['phones', 'tags']);
   ```

4. **Simplify include mapping**:
   ```diff
   - // Complex manual _count handling
   + return this.mapIncludeWithNestedHandling(include, defaultInclude);
   ```

## Testing Considerations

When implementing these changes:

1. **Test `_count` queries** to ensure they work correctly
2. **Test array properties** with null/undefined values
3. **Test nested includes** with various combinations
4. **Test error scenarios** to ensure proper error handling
5. **Verify type safety** during compilation

## Performance Impact

The utility methods have minimal performance impact:

- Object destructuring and spread operations are optimized by V8
- Utility methods are inline and don't add significant overhead
- The improved type safety can actually improve runtime performance by
  preventing type-related errors

## Conclusion

These improvements provide:

- **Better type safety** with proper generic constraints
- **Consistent handling** of common patterns like `_count` and arrays
- **Reduced code duplication** through utility methods
- **Easier maintenance** and debugging
- **Improved error handling** and logging

Follow this guide when implementing new repositories or updating existing ones
to ensure consistent, type-safe, and maintainable code.
