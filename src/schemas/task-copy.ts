import { z } from 'zod';
import { SECTOR_PRIVILEGES } from '../constants/enums';

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
  'responsibles',
  // Reference IDs
  'customerId',
  'pricingId',
  'paintId',
  // Shared file IDs (many-to-many relations)
  'artworkIds',
  'baseFileIds',
  'projectFileIds',
  'logoPaintIds',
  // Individual resources (creates new records)
  'cuts',
  'airbrushings',
  'serviceOrders',
  // Truck/Vehicle related
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
  fields: z.array(z.enum(COPYABLE_TASK_FIELDS)).min(1, 'Selecione pelo menos um campo para copiar'),
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
export const COPYABLE_FIELD_PERMISSIONS: Record<Exclude<CopyableTaskField, 'all'>, SECTOR_PRIVILEGES[]> = {
  // Basic fields - disabled for Financial, Warehouse, Designer
  name: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  details: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  entryDate: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  term: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  forecastDate: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  responsibles: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  customerId: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Commission - disabled for Financial, Designer, Logistic, Warehouse
  commission: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Pricing - only visible to ADMIN, FINANCIAL, COMMERCIAL (canViewPricingSections)
  pricingId: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL],

  // Paint - editable by most sectors except Warehouse, Financial, Logistic
  paintId: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Artworks (Layouts files) - hidden for Warehouse, Financial, Logistic
  artworkIds: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Base files - accessible by most sectors
  baseFileIds: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.PLOTTING,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.MAINTENANCE,
  ],

  // Project files (Projetos) - editable by ADMIN, COMMERCIAL, LOGISTIC
  projectFileIds: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER],

  // Logo paints (Cores da Logomarca) - hidden for Commercial users
  logoPaintIds: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Cuts - hidden for Financial, Logistic, Commercial
  cuts: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.DESIGNER, SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Airbrushings - hidden for Warehouse, Financial, Designer, Logistic, Commercial
  airbrushings: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Service orders - hidden for Warehouse and Plotting
  serviceOrders: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.PRODUCTION_MANAGER,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.MAINTENANCE,
  ],

  // Vehicle fields - disabled for Warehouse, Designer, Financial
  implementType: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
  category: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.COMMERCIAL, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Medidas do Caminhão - hidden for Warehouse, Financial, Designer, Commercial
  layouts: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.LOGISTIC, SECTOR_PRIVILEGES.PRODUCTION_MANAGER, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],

  // Observation - hidden for Warehouse, Financial, Designer, Logistic, Commercial
  observation: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PLOTTING, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.MAINTENANCE],
};

/**
 * Filters copyable fields based on user's sector privilege.
 * Returns only fields the user has permission to copy.
 */
export function filterFieldsByUserPrivilege(
  fields: CopyableTaskField[],
  userPrivilege: SECTOR_PRIVILEGES | undefined,
): CopyableTaskField[] {
  if (!userPrivilege) return [];

  // ADMIN can copy everything
  if (userPrivilege === SECTOR_PRIVILEGES.ADMIN) {
    return fields;
  }

  return fields.filter(field => {
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
  userPrivilege: SECTOR_PRIVILEGES | undefined,
): CopyableTaskField[] {
  if (!fields.includes('all')) {
    return filterFieldsByUserPrivilege(fields, userPrivilege);
  }

  // Expand 'all' to individual fields the user can copy
  if (!userPrivilege) return [];

  if (userPrivilege === SECTOR_PRIVILEGES.ADMIN) {
    return COPYABLE_TASK_FIELDS.filter(f => f !== 'all');
  }

  // Filter fields by user privilege
  return COPYABLE_TASK_FIELDS.filter(field => {
    if (field === 'all') return false;
    const allowedPrivileges = COPYABLE_FIELD_PERMISSIONS[field];
    return allowedPrivileges?.includes(userPrivilege) ?? false;
  });
}
