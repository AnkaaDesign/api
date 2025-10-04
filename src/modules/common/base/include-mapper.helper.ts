/**
 * Deep clone function that preserves Date objects
 * Unlike JSON.parse(JSON.stringify()), this properly handles Date instances
 */
function deepClone(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // ✅ FIX: Preserve Date objects
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }

  if (typeof obj === 'object') {
    const cloned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      cloned[key] = deepClone(value);
    }
    return cloned;
  }

  return obj;
}

/**
 * Helper function to properly map include objects from schema types to Prisma types
 *
 * This function handles:
 * - Empty objects converted to `true` for including all fields
 * - Nested includes with proper recursion
 * - Objects with select, where, orderBy, take, skip properties
 * - Field name mappings when schema field names differ from database field names
 *
 * @param include - The include object from the schema
 * @param fieldMappings - Optional field name mappings (e.g., { paints: 'logoPaints' })
 * @returns The mapped include object for Prisma
 */
export function mapIncludeToDatabaseInclude<T extends Record<string, any>>(
  include?: T,
  fieldMappings?: Record<string, string>,
): any {
  if (!include) return undefined;

  // Deep clone to avoid mutating the original (Date-safe)
  const mappedInclude = deepClone(include);

  // Process each property in the include object
  for (const [key, value] of Object.entries(mappedInclude)) {
    const mappedKey = fieldMappings?.[key] || key;

    if (value === true || value === false) {
      // Boolean values pass through
      if (mappedKey !== key) {
        mappedInclude[mappedKey] = value;
        delete mappedInclude[key];
      }
    } else if (value && typeof value === 'object') {
      // Handle objects
      const hasNestedProperties = Object.keys(value).length > 0;
      const hasIncludeProperty = 'include' in value;
      const hasQueryProperties =
        'where' in value ||
        'orderBy' in value ||
        'take' in value ||
        'skip' in value ||
        'select' in value;

      if (!hasNestedProperties) {
        // Empty object means include all fields
        mappedInclude[mappedKey] = true;
        if (mappedKey !== key) delete mappedInclude[key];
      } else if (hasIncludeProperty || hasQueryProperties) {
        // Object with query properties
        const processedValue: any = { ...value };

        // Recursively process nested includes
        if ('include' in value && value.include !== undefined) {
          if (
            typeof value.include === 'object' &&
            value.include !== null &&
            Object.keys(value.include).length === 0
          ) {
            // Empty include object means include all
            processedValue.include = true;
          } else {
            // Recursively map nested includes
            processedValue.include = mapIncludeToDatabaseInclude(
              value.include as Record<string, any>,
              fieldMappings,
            );
          }
        }

        // Handle empty where clauses
        if (
          'where' in value &&
          value.where !== undefined &&
          typeof value.where === 'object' &&
          value.where !== null &&
          Object.keys(value.where).length === 0
        ) {
          delete processedValue.where;
        }

        mappedInclude[mappedKey] = processedValue;
        if (mappedKey !== key) delete mappedInclude[key];
      } else {
        // Other objects (like select) pass through
        if (mappedKey !== key) {
          mappedInclude[mappedKey] = value;
          delete mappedInclude[key];
        }
      }
    }
  }

  return mappedInclude;
}

/**
 * Helper function to handle specific nested relation patterns
 * Used when you need more control over specific relations
 *
 * @param include - The include object
 * @param relationHandlers - Object with custom handlers for specific relations
 * @returns The mapped include object
 */
export function mapIncludeWithHandlers<T extends Record<string, any>>(
  include?: T,
  relationHandlers?: Record<string, (value: any) => any>,
): any {
  if (!include) return undefined;

  const mappedInclude = deepClone(include);

  for (const [key, value] of Object.entries(mappedInclude)) {
    // Use custom handler if provided
    if (relationHandlers?.[key]) {
      mappedInclude[key] = relationHandlers[key](value);
      continue;
    }

    // Default handling
    if (value && typeof value === 'object' && Object.keys(value).length === 0) {
      mappedInclude[key] = true;
    } else if (value && typeof value === 'object' && 'include' in value) {
      const processedValue = { ...value };
      if (
        value.include &&
        typeof value.include === 'object' &&
        Object.keys(value.include).length === 0
      ) {
        processedValue.include = true;
      }
      mappedInclude[key] = processedValue;
    }
  }

  return mappedInclude;
}
