/**
 * Include and Select Helper Utilities
 *
 * This module provides type-safe utilities for building Prisma includes and selects.
 * It helps enforce consistent patterns across the application and improves performance
 * by providing reusable select patterns for common use cases.
 *
 * @module include-helpers
 */

import { Prisma } from '@prisma/client';

// =====================
// Type Definitions
// =====================

/**
 * Generic select pattern for minimal entity data (combobox/dropdown use)
 * Typically includes: id, name/label, status fields
 */
export type MinimalSelect<T> = {
  id: true;
} & Partial<T>;

/**
 * Generic select pattern for table/list views
 * Includes minimal fields plus essential display data
 */
export type TableSelect<T> = MinimalSelect<T>;

/**
 * Generic select pattern for detailed views
 * Includes all or most fields and common relations
 */
export type DetailedSelect<T> = T;

/**
 * Common file select pattern for optimized file queries
 */
export const FILE_SELECT_MINIMAL = {
  id: true,
  filename: true,
  path: true,
  mimetype: true,
  size: true,
  thumbnailUrl: true,
} as const;

/**
 * Common file select pattern with upload metadata
 */
export const FILE_SELECT_WITH_METADATA = {
  ...FILE_SELECT_MINIMAL,
  uploadedAt: true,
  uploadedById: true,
  category: true,
} as const;

/**
 * Generic user select for relations (minimal user info)
 */
export const USER_SELECT_MINIMAL = {
  id: true,
  name: true,
  email: true,
  avatarId: true,
  status: true,
  isActive: true,
} as const;

/**
 * User select with position information
 */
export const USER_SELECT_WITH_POSITION = {
  ...USER_SELECT_MINIMAL,
  positionId: true,
  position: {
    select: {
      id: true,
      name: true,
      hierarchy: true,
    },
  },
} as const;

/**
 * User select with employment details
 */
export const USER_SELECT_WITH_EMPLOYMENT = {
  ...USER_SELECT_WITH_POSITION,
  sectorId: true,
  sector: {
    select: {
      id: true,
      name: true,
    },
  },
  payrollNumber: true,
} as const;

/**
 * Generic customer select for relations
 */
export const CUSTOMER_SELECT_MINIMAL = {
  id: true,
  fantasyName: true,
  cnpj: true,
} as const;

/**
 * Customer select with logo
 */
export const CUSTOMER_SELECT_WITH_LOGO = {
  ...CUSTOMER_SELECT_MINIMAL,
  logo: {
    select: FILE_SELECT_MINIMAL,
  },
} as const;

/**
 * Generic sector select for relations
 */
export const SECTOR_SELECT_MINIMAL = {
  id: true,
  name: true,
} as const;

/**
 * Sector select with manager info
 */
export const SECTOR_SELECT_WITH_MANAGER = {
  ...SECTOR_SELECT_MINIMAL,
  managerId: true,
  manager: {
    select: USER_SELECT_MINIMAL,
  },
} as const;

/**
 * Generic position select for relations
 */
export const POSITION_SELECT_MINIMAL = {
  id: true,
  name: true,
  hierarchy: true,
} as const;

/**
 * Paint select pattern for minimal display
 */
export const PAINT_SELECT_MINIMAL = {
  id: true,
  name: true,
  code: true,
} as const;

/**
 * Paint select with type and brand
 */
export const PAINT_SELECT_WITH_DETAILS = {
  ...PAINT_SELECT_MINIMAL,
  paintTypeId: true,
  paintBrandId: true,
  paintType: {
    select: {
      id: true,
      name: true,
    },
  },
  paintBrand: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

// =====================
// Builder Functions
// =====================

/**
 * Builds a select object for file relations
 * @param includeMetadata - Whether to include upload metadata
 * @returns Prisma select object for files
 */
export function buildFileSelect(includeMetadata = false) {
  return includeMetadata ? FILE_SELECT_WITH_METADATA : FILE_SELECT_MINIMAL;
}

/**
 * Builds a select object for user relations
 * @param options - Configuration options
 * @returns Prisma select object for users
 */
export function buildUserSelect(options?: {
  includePosition?: boolean;
  includeSector?: boolean;
  includeEmployment?: boolean;
  includeAvatar?: boolean;
}) {
  const { includePosition, includeSector, includeEmployment, includeAvatar } = options || {};

  // If employment is requested, it includes position and sector
  if (includeEmployment) {
    return includeAvatar
      ? {
          ...USER_SELECT_WITH_EMPLOYMENT,
          avatar: { select: FILE_SELECT_MINIMAL },
        }
      : USER_SELECT_WITH_EMPLOYMENT;
  }

  // Build incrementally based on options
  let select = { ...USER_SELECT_MINIMAL };

  if (includePosition) {
    select = {
      ...select,
      positionId: true,
      position: {
        select: POSITION_SELECT_MINIMAL,
      },
    } as any;
  }

  if (includeSector) {
    select = {
      ...select,
      sectorId: true,
      sector: {
        select: SECTOR_SELECT_MINIMAL,
      },
    } as any;
  }

  if (includeAvatar) {
    select = {
      ...select,
      avatar: {
        select: FILE_SELECT_MINIMAL,
      },
    } as any;
  }

  return select;
}

/**
 * Builds a select object for customer relations
 * @param includeLogo - Whether to include customer logo
 * @returns Prisma select object for customers
 */
export function buildCustomerSelect(includeLogo = false) {
  return includeLogo ? CUSTOMER_SELECT_WITH_LOGO : CUSTOMER_SELECT_MINIMAL;
}

/**
 * Builds a select object for sector relations
 * @param includeManager - Whether to include sector manager
 * @returns Prisma select object for sectors
 */
export function buildSectorSelect(includeManager = false) {
  return includeManager ? SECTOR_SELECT_WITH_MANAGER : SECTOR_SELECT_MINIMAL;
}

/**
 * Builds a select object for paint relations
 * @param includeDetails - Whether to include paint type and brand
 * @returns Prisma select object for paints
 */
export function buildPaintSelect(includeDetails = false) {
  return includeDetails ? PAINT_SELECT_WITH_DETAILS : PAINT_SELECT_MINIMAL;
}

/**
 * Builds a select object for arrays of files with proper typing
 * @param includeMetadata - Whether to include upload metadata
 * @returns Prisma select configuration for file arrays
 */
export function buildFileArraySelect(includeMetadata = false) {
  return {
    select: buildFileSelect(includeMetadata),
  };
}

// =====================
// Include Builders
// =====================

/**
 * Creates a selective include configuration
 * This is useful when you want to include relations but with limited fields
 *
 * @example
 * ```typescript
 * const include = buildSelectiveInclude({
 *   customer: CUSTOMER_SELECT_MINIMAL,
 *   sector: SECTOR_SELECT_MINIMAL,
 *   createdBy: USER_SELECT_MINIMAL,
 * });
 * ```
 */
export function buildSelectiveInclude<T extends Record<string, any>>(
  selectMap: T,
): { [K in keyof T]: { select: T[K] } } {
  const result: any = {};

  for (const [key, selectConfig] of Object.entries(selectMap)) {
    result[key] = { select: selectConfig };
  }

  return result;
}

/**
 * Merges multiple include configurations into one
 * Later configurations override earlier ones for conflicting keys
 *
 * @example
 * ```typescript
 * const baseInclude = { customer: true, sector: true };
 * const customInclude = { sector: { select: { id: true, name: true } } };
 * const merged = mergeIncludes(baseInclude, customInclude);
 * // Result: { customer: true, sector: { select: { id: true, name: true } } }
 * ```
 */
export function mergeIncludes<T extends Record<string, any>>(
  ...includes: T[]
): T {
  return Object.assign({}, ...includes);
}

/**
 * Creates a minimal include configuration for common use cases
 * Automatically includes standard relations with minimal selects
 *
 * @param relations - Array of relation names to include
 * @returns Include configuration with minimal selects
 */
export function buildMinimalInclude(
  relations: Array<
    | 'customer'
    | 'sector'
    | 'position'
    | 'user'
    | 'createdBy'
    | 'updatedBy'
    | 'assignedTo'
    | 'manager'
  >,
) {
  const include: Record<string, any> = {};

  for (const relation of relations) {
    switch (relation) {
      case 'customer':
        include.customer = { select: CUSTOMER_SELECT_MINIMAL };
        break;
      case 'sector':
        include.sector = { select: SECTOR_SELECT_MINIMAL };
        break;
      case 'position':
        include.position = { select: POSITION_SELECT_MINIMAL };
        break;
      case 'user':
      case 'createdBy':
      case 'updatedBy':
      case 'assignedTo':
        include[relation] = { select: USER_SELECT_MINIMAL };
        break;
      case 'manager':
        include.manager = { select: USER_SELECT_MINIMAL };
        break;
    }
  }

  return include;
}

// =====================
// Query Pattern Helpers
// =====================

/**
 * Predefined query patterns for common use cases
 */
export const QueryPatterns = {
  /**
   * Pattern for combobox/dropdown queries
   * Returns minimal data for selection lists
   */
  combobox: {
    /**
     * Get combobox pattern for users
     */
    user: () => ({
      select: USER_SELECT_MINIMAL,
      orderBy: { name: 'asc' as const },
    }),

    /**
     * Get combobox pattern for customers
     */
    customer: () => ({
      select: CUSTOMER_SELECT_MINIMAL,
      orderBy: { fantasyName: 'asc' as const },
    }),

    /**
     * Get combobox pattern for sectors
     */
    sector: () => ({
      select: SECTOR_SELECT_MINIMAL,
      orderBy: { name: 'asc' as const },
    }),

    /**
     * Get combobox pattern for positions
     */
    position: () => ({
      select: POSITION_SELECT_MINIMAL,
      orderBy: { hierarchy: 'asc' as const },
    }),

    /**
     * Get combobox pattern for paints
     */
    paint: () => ({
      select: PAINT_SELECT_MINIMAL,
      orderBy: { name: 'asc' as const },
    }),
  },

  /**
   * Pattern for table/list queries
   * Returns data optimized for table displays
   */
  table: {
    /**
     * Creates a table query pattern with custom select and common relations
     */
    create: <T>(select: T, commonRelations: string[] = []) => ({
      select: {
        ...select,
        ...buildMinimalInclude(commonRelations as any),
      },
    }),
  },

  /**
   * Pattern for detailed/single item queries
   * Returns comprehensive data for detail views
   */
  detail: {
    /**
     * Creates a detailed query pattern with full relations
     */
    create: <T>(include: T) => ({
      include,
    }),
  },
} as const;

// =====================
// Count Helper
// =====================

/**
 * Builds a _count select configuration for entity relations
 *
 * @param relations - Array of relation names to count
 * @returns Prisma _count select configuration
 *
 * @example
 * ```typescript
 * const include = {
 *   customer: true,
 *   _count: buildCountSelect(['tasks', 'orders'])
 * };
 * ```
 */
export function buildCountSelect(relations: string[]) {
  const select: Record<string, boolean> = {};

  for (const relation of relations) {
    select[relation] = true;
  }

  return { select };
}

// =====================
// Performance Optimization Helpers
// =====================

/**
 * Checks if an include configuration is likely to cause performance issues
 * based on nesting depth and relation count
 *
 * @param include - The include configuration to check
 * @param maxDepth - Maximum allowed nesting depth (default: 3)
 * @returns Warning message if potential performance issue detected
 */
export function checkIncludePerformance(
  include: Record<string, any>,
  maxDepth = 3,
): string | null {
  let maxNestingDepth = 0;
  let relationCount = 0;

  function analyzeDepth(obj: any, currentDepth = 0): void {
    if (currentDepth > maxNestingDepth) {
      maxNestingDepth = currentDepth;
    }

    if (typeof obj !== 'object' || obj === null) {
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'include' || key === 'select') {
        if (typeof value === 'object') {
          relationCount += Object.keys(value as Record<string, any>).length;
          analyzeDepth(value, currentDepth + 1);
        }
      } else if (typeof value === 'object' && value !== null) {
        const valueObj = value as Record<string, any>;
        if (valueObj.include || valueObj.select) {
          relationCount++;
          analyzeDepth(value, currentDepth + 1);
        }
      }
    }
  }

  analyzeDepth(include);

  if (maxNestingDepth > maxDepth) {
    return `Include depth of ${maxNestingDepth} exceeds recommended maximum of ${maxDepth}. This may cause performance issues.`;
  }

  if (relationCount > 10) {
    return `Include contains ${relationCount} relations. Consider using select to limit fields and improve performance.`;
  }

  return null;
}

/**
 * Optimizes an include configuration by converting to select where possible
 * This can significantly improve query performance
 *
 * @param include - The include configuration to optimize
 * @returns Optimized select configuration
 */
export function optimizeIncludeToSelect(include: Record<string, any>): Record<string, any> {
  const optimized: Record<string, any> = {};

  for (const [key, value] of Object.entries(include)) {
    if (value === true) {
      // Keep as-is, cannot optimize without knowing entity structure
      optimized[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      if (value.select) {
        // Already optimized
        optimized[key] = value;
      } else if (value.include) {
        // Recursively optimize nested includes
        optimized[key] = {
          select: optimizeIncludeToSelect(value.include),
        };
      } else {
        optimized[key] = value;
      }
    }
  }

  return optimized;
}

// =====================
// Type Guards
// =====================

/**
 * Checks if a value is a boolean include (include: true)
 */
export function isBooleanInclude(value: any): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Checks if a value is a select configuration
 */
export function isSelectInclude(value: any): value is { select: any } {
  return typeof value === 'object' && value !== null && 'select' in value;
}

/**
 * Checks if a value is a nested include configuration
 */
export function isNestedInclude(value: any): value is { include: any } {
  return typeof value === 'object' && value !== null && 'include' in value;
}

// =====================
// Utility Types
// =====================

/**
 * Type helper for extracting select field names from a select configuration
 */
export type SelectFields<T> = {
  [K in keyof T]: T[K] extends true ? K : never;
}[keyof T];

/**
 * Type helper for building type-safe select configurations
 */
export type SafeSelect<T> = {
  [K in keyof T]?: boolean | { select: any } | { include: any };
};

// =====================
// Export Helpers
// =====================

/**
 * Common select patterns grouped by entity type
 * These provide quick access to frequently used select configurations
 */
export const SelectPatterns = {
  file: {
    minimal: FILE_SELECT_MINIMAL,
    withMetadata: FILE_SELECT_WITH_METADATA,
  },
  user: {
    minimal: USER_SELECT_MINIMAL,
    withPosition: USER_SELECT_WITH_POSITION,
    withEmployment: USER_SELECT_WITH_EMPLOYMENT,
  },
  customer: {
    minimal: CUSTOMER_SELECT_MINIMAL,
    withLogo: CUSTOMER_SELECT_WITH_LOGO,
  },
  sector: {
    minimal: SECTOR_SELECT_MINIMAL,
    withManager: SECTOR_SELECT_WITH_MANAGER,
  },
  position: {
    minimal: POSITION_SELECT_MINIMAL,
  },
  paint: {
    minimal: PAINT_SELECT_MINIMAL,
    withDetails: PAINT_SELECT_WITH_DETAILS,
  },
} as const;

/**
 * Validates that a select configuration only selects allowed fields
 * This is useful for security and data validation
 *
 * @param select - The select configuration to validate
 * @param allowedFields - Array of allowed field names
 * @throws Error if select contains disallowed fields
 */
export function validateSelectFields(
  select: Record<string, any>,
  allowedFields: string[],
): void {
  const selectedFields = Object.keys(select);
  const disallowedFields = selectedFields.filter(
    (field) => !allowedFields.includes(field) && field !== '_count',
  );

  if (disallowedFields.length > 0) {
    throw new Error(
      `Select contains disallowed fields: ${disallowedFields.join(', ')}. ` +
      `Allowed fields: ${allowedFields.join(', ')}`,
    );
  }
}

/**
 * Creates a safe select configuration that only includes allowed fields
 *
 * @param select - The select configuration to sanitize
 * @param allowedFields - Array of allowed field names
 * @returns Sanitized select configuration
 */
export function sanitizeSelect(
  select: Record<string, any>,
  allowedFields: string[],
): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(select)) {
    if (allowedFields.includes(key) || key === '_count') {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
