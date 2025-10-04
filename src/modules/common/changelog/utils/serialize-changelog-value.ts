import { Logger } from '@nestjs/common';

const logger = new Logger('ChangeLogSerializer');

/**
 * Safely serialize a value for changelog storage
 * Handles Prisma enums, circular references, and other non-serializable objects
 */
export function serializeChangelogValue(value: any, seen = new WeakSet()): any {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    // For primitive types, return as-is
    if (typeof value !== 'object') {
      return value;
    }

    // For Date objects, convert to ISO string
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Handle circular references
    if (seen.has(value)) {
      return '[Circular Reference]';
    }
    seen.add(value);

    // For arrays, map each element
    if (Array.isArray(value)) {
      return value.map(item => serializeChangelogValue(item, seen));
    }

    // For objects, create a clean copy
    const cleanObject: any = {};

    for (const [key, val] of Object.entries(value)) {
      // Skip Prisma internal fields and functions
      if (key.startsWith('_') || typeof val === 'function') {
        continue;
      }

      // Skip undefined values to prevent JSON issues
      if (val === undefined) {
        continue;
      }

      // Recursively serialize nested values
      cleanObject[key] = serializeChangelogValue(val, seen);
    }

    return cleanObject;
  } catch (error) {
    logger.error(`Failed to serialize value for changelog: ${error.message}`, error.stack);

    // Fallback: return a safe representation
    try {
      return {
        error: 'Serialization failed',
        type: value?.constructor?.name || 'Unknown',
        message: error.message,
      };
    } catch (fallbackError) {
      // Last resort: return error message
      return '[Unserializable Value]';
    }
  }
}

/**
 * Compare two values for changelog purposes
 * Returns true if values are different
 */
export function hasValueChanged(oldValue: any, newValue: any): boolean {
  const serializedOld = serializeChangelogValue(oldValue);
  const serializedNew = serializeChangelogValue(newValue);

  return JSON.stringify(serializedOld) !== JSON.stringify(serializedNew);
}
