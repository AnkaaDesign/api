import { z } from 'zod';

/**
 * List of all fields that can be copied between tasks
 */
export const COPYABLE_TASK_FIELDS = [
  'all', // Special field to copy all supported fields
  // Simple fields
  'name',
  'details',
  'term',
  'entryDate',
  'forecastDate',
  'commission',
  'representatives',
  // Reference IDs
  'customerId',
  'invoiceToId',
  'pricingId',
  'paintId',
  // Shared file IDs (many-to-many relations)
  'artworkIds',
  'baseFileIds',
  'logoPaintIds',
  // Individual resources (creates new records)
  'cuts',
  'airbrushings',
  'serviceOrders',
  // Truck/Vehicle related (shared references)
  'implementType',
  'category',
  'layouts',
  // Other relations
  'observation',
] as const;

/**
 * Type for copyable task fields
 */
export type CopyableTaskField = (typeof COPYABLE_TASK_FIELDS)[number];

/**
 * Zod schema for task copy request validation
 */
export const taskCopyFromSchema = z.object({
  sourceTaskId: z.string().uuid('ID da tarefa de origem inválido'),
  fields: z
    .array(z.enum(COPYABLE_TASK_FIELDS))
    .min(1, 'Selecione pelo menos um campo para copiar'),
});

/**
 * Form data type inferred from the schema
 */
export type TaskCopyFromFormData = z.infer<typeof taskCopyFromSchema>;

/**
 * Maps each copyable field to the sector privileges that can edit that field.
 * Based on the field-level disabled checks in task-edit-form.tsx.
 * When user selects "copy ALL", only fields they have permission to edit will be copied.
 */
export const COPYABLE_FIELD_PERMISSIONS: Record<
  Exclude<CopyableTaskField, 'all'>,
  string[]
> = {
  // Basic fields - disabled for Financial, Warehouse, Designer
  name: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  details: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  entryDate: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  term: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  forecastDate: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  representatives: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  customerId: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Commission - disabled for Financial, Designer, Logistic, Warehouse
  commission: ['ADMIN', 'COMMERCIAL', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Invoice To - disabled for Financial, Warehouse, Designer, Logistic
  invoiceToId: ['ADMIN', 'COMMERCIAL', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Pricing - only visible to ADMIN, FINANCIAL, COMMERCIAL (canViewPricingSections)
  pricingId: ['ADMIN', 'FINANCIAL', 'COMMERCIAL'],

  // Paint/Artworks - hidden for Warehouse, Financial, Logistic (different rules)
  paintId: ['ADMIN', 'COMMERCIAL', 'DESIGNER', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  artworkIds: ['ADMIN', 'COMMERCIAL', 'DESIGNER', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  baseFileIds: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'DESIGNER', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Logo paints - hidden for Commercial users
  logoPaintIds: ['ADMIN', 'DESIGNER', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Cuts - hidden for Financial, Logistic, Commercial
  cuts: ['ADMIN', 'DESIGNER', 'WAREHOUSE', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Airbrushings - hidden for Warehouse, Financial, Designer, Logistic, Commercial
  airbrushings: ['ADMIN', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Service orders - hidden for Warehouse and Plotting
  serviceOrders: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'FINANCIAL', 'DESIGNER', 'PRODUCTION', 'MAINTENANCE'],

  // Vehicle fields - disabled for Warehouse, Designer, Financial
  implementType: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
  category: ['ADMIN', 'COMMERCIAL', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Layouts - hidden for Warehouse, Financial, Designer, Commercial
  layouts: ['ADMIN', 'LOGISTIC', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],

  // Observation - hidden for Warehouse, Financial, Designer, Logistic, Commercial
  observation: ['ADMIN', 'PLOTTING', 'PRODUCTION', 'MAINTENANCE'],
};

/**
 * Filters copyable fields based on user's sector privilege.
 * Returns only fields the user has permission to copy.
 */
export function filterFieldsByUserPrivilege(
  fields: CopyableTaskField[],
  userPrivilege: string | undefined,
): CopyableTaskField[] {
  if (!userPrivilege) return [];

  // ADMIN can copy everything
  if (userPrivilege === 'ADMIN') {
    return fields;
  }

  return fields.filter((field) => {
    if (field === 'all') {
      // If 'all' was included, it will be expanded separately
      return true;
    }
    const allowedPrivileges = COPYABLE_FIELD_PERMISSIONS[field];
    return allowedPrivileges?.includes(userPrivilege) ?? false;
  });
}

/**
 * Expands 'all' field to only the fields the user has permission to copy.
 */
export function expandAllFieldsForUser(
  fields: CopyableTaskField[],
  userPrivilege: string | undefined,
): CopyableTaskField[] {
  if (!fields.includes('all')) {
    return filterFieldsByUserPrivilege(fields, userPrivilege);
  }

  // Expand 'all' to individual fields the user can copy
  if (!userPrivilege) return [];

  if (userPrivilege === 'ADMIN') {
    return COPYABLE_TASK_FIELDS.filter((f) => f !== 'all');
  }

  // Filter fields by user privilege
  return COPYABLE_TASK_FIELDS.filter((field) => {
    if (field === 'all') return false;
    const allowedPrivileges = COPYABLE_FIELD_PERMISSIONS[field];
    return allowedPrivileges?.includes(userPrivilege) ?? false;
  });
}
