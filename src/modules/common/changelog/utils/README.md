# Changelog Utils

This directory contains utility functions for working with the changelog system
in the Ankaa API.

## Files

### `enum-converter.ts`

A utility for converting between `ENTITY_TYPE` and `CHANGE_LOG_ENTITY_TYPE`
enums to resolve TypeScript mismatch errors.

**Problem**: Throughout the codebase, there are 531 TypeScript errors caused by
passing `ENTITY_TYPE` values to functions that expect `CHANGE_LOG_ENTITY_TYPE`.
Both enums have identical string values, but TypeScript treats them as
incompatible types.

**Solution**: The `convertToChangeLogEntityType` function provides a type-safe
conversion between these enums.

#### Usage

```typescript
import { ENTITY_TYPE, CHANGE_LOG_ACTION } from '@ankaa/constants';
import { convertToChangeLogEntityType } from '@modules/common/changelog/utils';

// Before - TypeScript error
await this.changeLogService.logChange(
  ENTITY_TYPE.USER, // ❌ TypeScript error
  CHANGE_LOG_ACTION.CREATE,
  userId,
  null,
  userData,
  currentUserId,
);

// After - Clean and type-safe
await this.changeLogService.logChange(
  convertToChangeLogEntityType(ENTITY_TYPE.USER), // ✅ Works perfectly
  CHANGE_LOG_ACTION.CREATE,
  userId,
  null,
  userData,
  currentUserId,
);
```

#### Available Functions

- **`convertToChangeLogEntityType(entityType: ENTITY_TYPE): CHANGE_LOG_ENTITY_TYPE`**
  - Main conversion function
  - Throws error if conversion is not possible

- **`canConvertToChangeLogEntityType(entityType: ENTITY_TYPE): boolean`**
  - Type guard to check if conversion is possible
  - Returns `true` if conversion is safe, `false` otherwise

- **`batchConvertToChangeLogEntityType(entityTypes: ENTITY_TYPE[]): CHANGE_LOG_ENTITY_TYPE[]`**
  - Converts multiple entity types at once
  - Useful for batch operations

- **`createEntityTypeConversionMap(): Record<ENTITY_TYPE, CHANGE_LOG_ENTITY_TYPE>`**
  - Creates a mapping object for efficient lookups
  - Useful when doing many conversions

#### Error Handling

The converter includes comprehensive error handling:

```typescript
try {
  const changeLogType = convertToChangeLogEntityType(entityType);
  // Use changeLogType...
} catch (error) {
  console.error(`Cannot convert ${entityType}:`, error.message);
  // Handle error appropriately
}
```

#### Testing

Run the tests with:

```bash
npm test -- enum-converter.spec.ts
```

All functions are thoroughly tested with:

- Valid conversion scenarios
- Error cases for invalid types
- Batch operations
- Type consistency verification

### `changelog-helpers.ts`

Contains helper functions for working with changelog data structures and
operations.

### `serialize-changelog-value.ts`

Provides serialization utilities for changelog values to ensure consistent data
storage.

## Development Guidelines

1. **Always use the enum converter** when passing `ENTITY_TYPE` to changelog
   functions
2. **Include error handling** when using the converter in production code
3. **Add tests** for any new utility functions
4. **Document usage** with clear examples in JSDoc comments

## Integration Example

For a complete integration example, see `usage-example.ts` which demonstrates:

- Service-level integration
- Generic changelog helpers
- Base service class patterns
- Error handling strategies

This utility solves the systematic enum mismatch issue affecting 531 TypeScript
errors across the codebase, providing a clean and type-safe solution for
changelog logging.
