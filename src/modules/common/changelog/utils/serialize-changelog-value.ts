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
    // Prisma Json type will store this as a plain string (not double-encoded)
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
 * Normalize a Date to date-only string (YYYY-MM-DD) for comparison
 * This ensures dates are compared by calendar date, not exact timestamp
 * Handles timezone issues by extracting UTC date components
 */
function normalizeDateToString(date: Date): string {
  // Use UTC to avoid timezone shifts during comparison
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalize value for comparison
 * Handles numeric strings, Prisma Decimals, dates, and numbers to prevent false positives
 * @param value - The value to normalize
 * @param field - Optional field name for field-specific normalization
 */
function normalizeValue(value: any, field?: string): any {
  if (value === null || value === undefined) {
    // For commission field, treat null/undefined as NO_COMMISSION
    // This prevents false positive changelogs when both display as "Sem Comissão"
    if (field === 'commission') {
      return 'NO_COMMISSION';
    }
    return null;
  }

  // Handle Date objects - normalize to date-only string for comparison
  // This prevents false positives when comparing dates with different time components
  // e.g., "2024-02-01T00:00:00.000Z" vs "2024-02-01T03:00:00.000Z" should be equal
  if (value instanceof Date) {
    return normalizeDateToString(value);
  }

  // Handle ISO date strings - normalize to date-only format
  if (typeof value === 'string') {
    // Check if it looks like an ISO date string (contains T and ends with Z or timezone)
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (isoDatePattern.test(value)) {
      // Extract date part only (YYYY-MM-DD)
      return value.split('T')[0];
    }
  }

  // Handle Prisma Decimal objects - convert to number for comparison
  // Decimal objects have d, e, s properties and a toNumber() method
  if (
    value &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  ) {
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
 * @param oldValue - The old value
 * @param newValue - The new value
 * @param field - Optional field name for field-specific normalization (e.g., 'commission')
 */
export function hasValueChanged(oldValue: any, newValue: any, field?: string): boolean {
  // Normalize both values before serialization to handle type coercion
  const normalizedOld = normalizeValue(oldValue, field);
  const normalizedNew = normalizeValue(newValue, field);

  const serializedOld = serializeChangelogValue(normalizedOld);
  const serializedNew = serializeChangelogValue(normalizedNew);

  return JSON.stringify(serializedOld) !== JSON.stringify(serializedNew);
}
