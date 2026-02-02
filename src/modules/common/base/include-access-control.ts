import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Include Access Control
 *
 * This module provides security controls for entity includes and selects to prevent:
 * - Unauthorized data access
 * - Information disclosure
 * - Performance issues from excessive nesting
 * - Data leakage through partial field selection
 *
 * Features:
 * - Supports both include and select patterns
 * - Validates nested includes and selects
 * - Enforces field-level access control
 * - Optimizes performance through selective includes
 */

// Maximum allowed nesting depth for includes and selects
const MAX_INCLUDE_DEPTH = 3;
const MAX_SELECT_DEPTH = 3;

// Sensitive fields that should never be included or selected
const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'salt',
  'resetToken',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'secretKey',
];

/**
 * Whitelist of allowed includes per entity type
 * Only fields listed here can be included in queries
 */
const INCLUDE_WHITELIST: Record<string, string[]> = {
  User: [
    'id',
    'name',
    'email', // Sensitive but allowed for authenticated requests
    'avatar',
    'position',
    'sector',
    'managedSector',
    'ppeSize',
    'preference',
    'createdTasks',
    'activities',
  ],
  Task: [
    'id',
    'sector',
    'customer',
    'invoiceTo',
    'budgets',
    'invoices',
    'receipts',
    'reimbursements',
    'invoiceReimbursements',
    'baseFiles',
    'observation',
    'generalPainting',
    'createdBy',
    'artworks',
    'logoPaints',
    'serviceOrders',
    'pricing',
    'truck',
    'airbrushings',
    'cuts',
    'relatedTasks',
    'relatedTo',
    'representatives',
  ],
  Customer: [
    'id',
    'fantasyName',
    'corporateName',
    'cnpj',
    'cpf',
    'logo',
    'economicActivity',
    'tasks',
    'representatives',
  ],
  Order: [
    'id',
    'supplier',
    'items',
    'orderSchedule',
    'budgets',
    'invoices',
    'receipts',
    'reimbursements',
    'invoiceReimbursements',
    'activities',
  ],
  Representative: [
    'id',
    'name',
    'phone',
    'email',
    'role',
    'isActive',
    'customer',
    'tasks',
  ],
};

/**
 * Whitelist of allowed select fields per entity type
 * Only fields listed here can be selected in queries
 */
const SELECT_WHITELIST: Record<string, string[]> = {
  User: [
    'id',
    'name',
    'email',
    'avatar',
    'role',
    'isActive',
    'createdAt',
    'updatedAt',
    'positionId',
    'sectorId',
    'managedSectorId',
    'ppeSizeId',
    'preferenceId',
    'position',
    'sector',
    'managedSector',
    'ppeSize',
    'preference',
  ],
  Task: [
    'id',
    'name',
    'status',
    'statusOrder',
    'commission',
    'serialNumber',
    'details',
    'entryDate',
    'term',
    'startedAt',
    'finishedAt',
    'forecastDate',
    'createdAt',
    'updatedAt',
    'paintId',
    'customerId',
    'invoiceToId',
    'sectorId',
    'truckId',
    'createdById',
    'sector',
    'customer',
    'invoiceTo',
    'generalPainting',
    'createdBy',
    'truck',
    'budgets',
    'invoices',
    'receipts',
    'reimbursements',
    'invoiceReimbursements',
    'baseFiles',
    'observation',
    'artworks',
    'logoPaints',
    'serviceOrders',
    'pricing',
    'airbrushings',
    'cuts',
    'relatedTasks',
    'relatedTo',
    'representatives',
  ],
  Customer: [
    'id',
    'fantasyName',
    'corporateName',
    'cnpj',
    'cpf',
    'logoId',
    'economicActivityId',
    'createdAt',
    'updatedAt',
    'logo',
    'economicActivity',
    'tasks',
    'representatives',
  ],
  Order: [
    'id',
    'status',
    'createdAt',
    'updatedAt',
    'supplierId',
    'supplier',
    'items',
    'orderSchedule',
    'budgets',
    'invoices',
    'receipts',
    'reimbursements',
    'invoiceReimbursements',
    'activities',
  ],
  Representative: [
    'id',
    'name',
    'phone',
    'email',
    'role',
    'isActive',
    'customerId',
    'createdAt',
    'updatedAt',
    'customer',
  ],
};

/**
 * Determines the entity type from a relation field name
 * Handles plural and singular forms
 *
 * @param fieldName - The relation field name (e.g., 'tasks', 'customer')
 * @returns The entity type name (e.g., 'Task', 'Customer')
 */
function getEntityTypeFromField(fieldName: string): string {
  // Handle special cases
  const specialCases: Record<string, string> = {
    generalPainting: 'Paint',
    createdBy: 'User',
    invoiceTo: 'Customer',
    invoiceReimbursements: 'InvoiceReimbursement',
    baseFiles: 'File',
    logoPaints: 'Paint',
    serviceOrders: 'ServiceOrder',
    airbrushings: 'Airbrushing',
    economicActivity: 'EconomicActivity',
    ppeSize: 'PpeSize',
    managedSector: 'Sector',
  };

  if (specialCases[fieldName]) {
    return specialCases[fieldName];
  }

  // Remove trailing 's' for plural forms
  let singular = fieldName;
  if (singular.endsWith('s') && singular.length > 1) {
    singular = singular.slice(0, -1);
  }

  // Capitalize first letter
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

/**
 * Validates that requested includes are allowed and safe
 *
 * @param entityType - The type of entity being queried (e.g., 'Task', 'User')
 * @param includes - The include object from the client request
 * @param currentDepth - Current nesting depth (for recursive validation)
 * @throws BadRequestException if includes are invalid
 * @throws ForbiddenException if includes contain unauthorized fields
 */
export function validateIncludes(
  entityType: string,
  includes: any,
  currentDepth: number = 0,
): void {
  // Check maximum depth
  if (currentDepth > MAX_INCLUDE_DEPTH) {
    throw new BadRequestException(
      `Include depth exceeds maximum allowed (${MAX_INCLUDE_DEPTH}). Current depth: ${currentDepth}`,
    );
  }

  // If includes is null/undefined, nothing to validate
  if (!includes || typeof includes !== 'object') {
    return;
  }

  // Get whitelist for this entity type
  const allowedFields = INCLUDE_WHITELIST[entityType];
  if (!allowedFields) {
    // No whitelist defined - allow all (for backward compatibility)
    // TODO: Define whitelists for all entities
    return;
  }

  // Check each requested include
  for (const field of Object.keys(includes)) {
    // Skip special fields
    if (field === '_count') {
      // Validate _count select if present
      if (includes[field] && typeof includes[field] === 'object' && includes[field].select) {
        // _count.select is allowed, no further validation needed
        continue;
      }
      continue;
    }

    if (field === 'include' || field === 'select' || field === 'where' || field === 'orderBy') {
      continue;
    }

    // Check if field is in whitelist
    if (!allowedFields.includes(field)) {
      throw new ForbiddenException(
        `Include field '${field}' is not allowed for ${entityType}. ` +
        `Allowed fields: ${allowedFields.join(', ')}`,
      );
    }

    // Check for sensitive fields
    if (SENSITIVE_FIELDS.includes(field)) {
      throw new ForbiddenException(
        `Cannot include sensitive field '${field}' for security reasons`,
      );
    }

    // Recursively validate nested includes and selects
    const fieldValue = includes[field];
    if (fieldValue && typeof fieldValue === 'object') {
      const nestedEntityType = getEntityTypeFromField(field);

      // Validate nested include
      if (fieldValue.include) {
        validateIncludes(nestedEntityType, fieldValue.include, currentDepth + 1);
      }

      // Validate nested select
      if (fieldValue.select) {
        validateSelect(nestedEntityType, fieldValue.select, currentDepth + 1);
      }
    }
  }
}

/**
 * Validates select fields to ensure sensitive data isn't exposed
 *
 * @param entityType - The type of entity being queried
 * @param select - The select object from the client request
 * @param currentDepth - Current nesting depth (for recursive validation)
 * @throws BadRequestException if select is invalid
 * @throws ForbiddenException if select contains sensitive fields
 */
export function validateSelect(
  entityType: string,
  select: any,
  currentDepth: number = 0,
): void {
  // Check maximum depth
  if (currentDepth > MAX_SELECT_DEPTH) {
    throw new BadRequestException(
      `Select depth exceeds maximum allowed (${MAX_SELECT_DEPTH}). Current depth: ${currentDepth}`,
    );
  }

  if (!select || typeof select !== 'object') {
    return;
  }

  // Get whitelist for this entity type
  const allowedFields = SELECT_WHITELIST[entityType];
  if (!allowedFields) {
    // No whitelist defined - only check for sensitive fields
    for (const field of Object.keys(select)) {
      if (SENSITIVE_FIELDS.includes(field) && select[field] === true) {
        throw new ForbiddenException(
          `Cannot select sensitive field '${field}' for security reasons`,
        );
      }
    }
    return;
  }

  // Validate each selected field
  for (const field of Object.keys(select)) {
    const fieldValue = select[field];

    // Check for sensitive fields
    if (SENSITIVE_FIELDS.includes(field)) {
      throw new ForbiddenException(
        `Cannot select sensitive field '${field}' for security reasons`,
      );
    }

    // Check if field is in whitelist
    if (!allowedFields.includes(field)) {
      throw new ForbiddenException(
        `Select field '${field}' is not allowed for ${entityType}. ` +
        `Allowed fields: ${allowedFields.join(', ')}`,
      );
    }

    // Recursively validate nested selects and includes
    if (fieldValue && typeof fieldValue === 'object') {
      const nestedEntityType = getEntityTypeFromField(field);

      // Validate nested select
      if (fieldValue.select) {
        validateSelect(nestedEntityType, fieldValue.select, currentDepth + 1);
      }

      // Validate nested include
      if (fieldValue.include) {
        validateIncludes(nestedEntityType, fieldValue.include, currentDepth + 1);
      }
    }
  }
}

/**
 * Validates query parameters containing include and/or select
 * This is a convenience function that validates both in a single call
 *
 * @param entityType - The type of entity being queried
 * @param query - The query object containing include and/or select
 * @throws BadRequestException if query is invalid
 * @throws ForbiddenException if query contains unauthorized fields
 */
export function validateQuery(
  entityType: string,
  query: { include?: any; select?: any },
): void {
  // Validate that include and select are not used together at the top level
  if (query.include && query.select) {
    throw new BadRequestException(
      'Cannot use both "include" and "select" at the same level. Choose one.',
    );
  }

  // Validate include if present
  if (query.include) {
    validateIncludes(entityType, query.include);
  }

  // Validate select if present
  if (query.select) {
    validateSelect(entityType, query.select);
  }
}

/**
 * Sanitizes an include object by removing sensitive fields
 * This can be used as a fallback when validation fails
 *
 * @param includes - The include object to sanitize
 * @returns A sanitized include object
 */
export function sanitizeIncludes(includes: any): any {
  if (!includes || typeof includes !== 'object') {
    return includes;
  }

  const sanitized: any = {};

  for (const [field, value] of Object.entries(includes)) {
    // Skip sensitive fields
    if (SENSITIVE_FIELDS.includes(field)) {
      continue;
    }

    // Recursively sanitize nested includes
    if (value && typeof value === 'object') {
      const objValue = value as any;
      if (objValue.include) {
        sanitized[field] = {
          ...value,
          include: sanitizeIncludes(objValue.include),
        };
      } else if (objValue.select) {
        sanitized[field] = {
          ...value,
          select: sanitizeSelect(objValue.select),
        };
      } else {
        sanitized[field] = value;
      }
    } else {
      sanitized[field] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitizes a select object by removing sensitive fields
 * This can be used as a fallback when validation fails
 *
 * @param select - The select object to sanitize
 * @returns A sanitized select object
 */
export function sanitizeSelect(select: any): any {
  if (!select || typeof select !== 'object') {
    return select;
  }

  const sanitized: any = {};

  for (const [field, value] of Object.entries(select)) {
    // Skip sensitive fields
    if (SENSITIVE_FIELDS.includes(field)) {
      continue;
    }

    // Recursively sanitize nested selects
    if (value && typeof value === 'object') {
      const objValue = value as any;
      if (objValue.select) {
        sanitized[field] = {
          ...value,
          select: sanitizeSelect(objValue.select),
        };
      } else if (objValue.include) {
        sanitized[field] = {
          ...value,
          include: sanitizeIncludes(objValue.include),
        };
      } else {
        sanitized[field] = value;
      }
    } else {
      sanitized[field] = value;
    }
  }

  return sanitized;
}
