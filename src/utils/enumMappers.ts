/**
 * Generic enum mapping utilities
 * These functions help map between application enums and Prisma generated enums
 */

// Define a type for supported where clause values
type WhereClauseValue = string | number | boolean | Date | null | undefined;

// Define a recursive type for where clauses
type WhereClause = WhereClauseValue | WhereClause[] | { [key: string]: WhereClause };

/**
 * Map where clause for Prisma queries
 * This generic mapper handles the conversion of where clauses that may contain enum values
 * @param where The where clause object
 * @returns The mapped where clause
 */
export function mapWhereClause(where: WhereClause): WhereClause {
  if (!where) return where;

  // If it's a primitive value, return as is
  if (typeof where !== "object" || where === null) {
    return where;
  }

  // ✅ FIX: Don't process Date objects - they are valid values
  if (where instanceof Date) {
    return where;
  }

  // If it's an array, map each element
  if (Array.isArray(where)) {
    return where.map((item) => mapWhereClause(item));
  }

  // If it's an object, recursively map each property
  const mapped: { [key: string]: WhereClause } = {};
  for (const [key, value] of Object.entries(where)) {
    // Recursively map nested objects
    mapped[key] = mapWhereClause(value);
  }

  return mapped;
}
