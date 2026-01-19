import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Include Access Control
 *
 * This module provides security controls for entity includes to prevent:
 * - Unauthorized data access
 * - Information disclosure
 * - Performance issues from excessive nesting
 */

// Maximum allowed nesting depth for includes
const MAX_INCLUDE_DEPTH = 3;

// Sensitive fields that should never be included
const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'salt',
  'resetToken',
  'accessToken',
  'refreshToken',
];

/**
 * Whitelist of allowed includes per entity type
 * Only fields listed here can be included in queries
 */
const INCLUDE_WHITELIST: Record<string, string[]> = {
  User: [
    'id',
    'name',
    'email', // ⚠️ Sensitive but allowed for authenticated requests
    'avatar',
    'position',
    'sector',
    'managedSector',
    'ppeSize',
    'preference',
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
};

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
    if (field === '_count' || field === 'include' || field === 'select') {
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

    // Recursively validate nested includes
    const fieldValue = includes[field];
    if (fieldValue && typeof fieldValue === 'object') {
      if (fieldValue.include) {
        // Determine nested entity type (simplified - could be enhanced)
        const nestedEntityType = field.charAt(0).toUpperCase() + field.slice(1);
        validateIncludes(nestedEntityType, fieldValue.include, currentDepth + 1);
      }
    }
  }
}

/**
 * Validates select fields to ensure sensitive data isn't exposed
 *
 * @param entityType - The type of entity being queried
 * @param select - The select object from the client request
 * @throws ForbiddenException if select contains sensitive fields
 */
export function validateSelect(
  entityType: string,
  select: any,
): void {
  if (!select || typeof select !== 'object') {
    return;
  }

  for (const field of Object.keys(select)) {
    if (SENSITIVE_FIELDS.includes(field) && select[field] === true) {
      throw new ForbiddenException(
        `Cannot select sensitive field '${field}' for security reasons`,
      );
    }
  }
}
