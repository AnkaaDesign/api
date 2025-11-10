import { Logger } from '@nestjs/common';

const logger = new Logger('ChangeLogSerializer');

/**
 * Safely serialize a value for changelog storage
 * Handles Prisma enums, circular references, and other non-serializable objects
 */
export function serializeChangelogValue(value: any, seen = new WeakSet()): any {
  if (value === null || value === undefined || value === '') {
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

    // Handle Prisma Decimal objects - convert to number
    if (value && 'toNumber' in value && typeof value.toNumber === 'function') {
      return value.toNumber();
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
 * Normalize value for comparison
 * Handles numeric strings, Prisma Decimals, and numbers to prevent false positives
 */
function normalizeValue(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }

  // Handle Prisma Decimal objects - convert to number for comparison
  // Decimal objects have d, e, s properties and a toNumber() method
  if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }

  // Convert numeric strings to numbers for comparison
  // This prevents "0" (string) from being different than 0 (number)
  if (typeof value === 'string' && value.trim() !== '') {
    const numValue = Number(value);
    if (!isNaN(numValue) && String(numValue) === value) {
      return numValue;
    }
  }

  return value;
}

/**
 * Compare two values for changelog purposes
 * Returns true if values are different
 */
export function hasValueChanged(oldValue: any, newValue: any): boolean {
  // Normalize both values before serialization to handle type coercion
  const normalizedOld = normalizeValue(oldValue);
  const normalizedNew = normalizeValue(newValue);

  const serializedOld = serializeChangelogValue(normalizedOld);
  const serializedNew = serializeChangelogValue(normalizedNew);

  return JSON.stringify(serializedOld) !== JSON.stringify(serializedNew);
}
