import { BadRequestException } from '@nestjs/common';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

/**
 * Task update field domains — groups related fields together.
 * When adding a new task field, add it to the appropriate domain.
 */
export const TASK_FIELD_DOMAINS = {
  /** Task identity: name, customer, vehicle info */
  identity: ['name', 'details', 'customerId', 'serialNumber', 'chassis'],
  /** Scheduling dates */
  dates: ['entryDate', 'term', 'forecastDate', 'forecastReason', 'cleared'],
  /** Task lifecycle status */
  status: ['status', 'startedAt', 'finishedAt'],
  /** Free-text observation */
  observation: ['observation'],
  /** Sales commission */
  commission: ['commission'],
  /** Truck/vehicle info (plate, chassis, category, spot, layouts) */
  truck: ['truck'],
  /** Responsible users */
  responsibles: ['responsibleIds', 'responsibles'],
  /** Artwork files and approval statuses */
  artworks: ['artworkIds', 'artworkStatuses'],
  /** Paint selection */
  paint: ['paintId', 'paintIds'],
  /** Cutting plans */
  cuts: ['cuts'],
  /** Service orders */
  serviceOrders: ['serviceOrders'],
  /** Quote configuration */
  quote: ['quote'],
  /** Base reference files */
  baseFiles: ['baseFileIds'],
  /** Project files */
  projectFiles: ['projectFileIds'],
  /** Check-in files (arrival at facility) */
  checkinFiles: ['checkinFileIds'],
  /** Check-out files (departure from facility) */
  checkoutFiles: ['checkoutFileIds'],
  /** Service order file updates (checkin/checkout per SO) */
  serviceOrderFiles: ['serviceOrderFiles'],
  /** Financial documents: budgets, invoices, receipts, bank slips */
  financialDocs: ['budgetIds', 'invoiceIds', 'receiptIds', 'bankSlipIds'],
  /** Reimbursement documents */
  reimbursements: ['reimbursementIds', 'reimbursementInvoiceIds'],
  /** Sector assignment */
  sector: ['sectorId'],
  /** Internal markers (not user-facing) */
  meta: ['_hasFiles', '_soFileMapping'],
} as const;

type FieldDomain = keyof typeof TASK_FIELD_DOMAINS;

/**
 * Defines which field domains each sector can modify when updating a task.
 *
 * - ADMIN is omitted — admin has unrestricted access.
 * - Sectors not listed here cannot update tasks (enforced at route level via @Roles).
 * - Uses allowlist approach: if a new domain is added, no sector gets access until
 *   explicitly granted — secure by default.
 */
export const SECTOR_TASK_UPDATE_ACCESS: Partial<Record<SECTOR_PRIVILEGES, FieldDomain[]>> = {
  [SECTOR_PRIVILEGES.FINANCIAL]: [
    'quote', 'financialDocs', 'identity', 'serviceOrders',
    // Passthrough: form sends these to preserve existing state
    'artworks', 'baseFiles', 'truck',
    'meta',
  ],

  [SECTOR_PRIVILEGES.COMMERCIAL]: [
    'identity', 'dates', 'status', 'commission', 'truck', 'responsibles',
    'artworks', 'paint', 'serviceOrders', 'quote',
    'baseFiles', 'projectFiles', 'observation',
    'meta',
  ],

  [SECTOR_PRIVILEGES.PRODUCTION]: [
    'status', 'observation', 'cuts', 'commission',
    'meta',
  ],

  [SECTOR_PRIVILEGES.DESIGNER]: [
    'artworks', 'paint', 'cuts', 'serviceOrders', 'baseFiles',
    'meta',
  ],

  [SECTOR_PRIVILEGES.LOGISTIC]: [
    'identity', 'dates', 'status', 'truck', 'serviceOrders',
    'responsibles', 'baseFiles', 'projectFiles',
    'checkinFiles', 'checkoutFiles', 'serviceOrderFiles', 'observation',
    // Passthrough: form sends these to preserve existing state
    'artworks',
    'meta',
  ],

  [SECTOR_PRIVILEGES.PRODUCTION_MANAGER]: [
    'identity', 'dates', 'status', 'truck', 'serviceOrders',
    'responsibles', 'baseFiles', 'projectFiles',
    'checkinFiles', 'checkoutFiles', 'serviceOrderFiles', 'observation',
    'sector',
    // Passthrough: form sends these to preserve existing state
    'artworks',
    'meta',
  ],

  [SECTOR_PRIVILEGES.WAREHOUSE]: [
    'cuts',
    'meta',
  ],
};

/** Portuguese labels for error messages */
const FIELD_DOMAIN_LABELS: Record<FieldDomain, string> = {
  identity: 'identidade (nome, cliente, veículo)',
  dates: 'datas',
  status: 'status',
  observation: 'observação',
  commission: 'comissão',
  truck: 'caminhão',
  responsibles: 'responsáveis',
  artworks: 'artes',
  paint: 'tintas',
  cuts: 'plano de corte',
  serviceOrders: 'ordens de serviço',
  quote: 'orçamento/precificação',
  baseFiles: 'arquivos base',
  projectFiles: 'arquivos de projeto',
  checkinFiles: 'arquivos de check-in',
  checkoutFiles: 'arquivos de check-out',
  serviceOrderFiles: 'arquivos de check-in/check-out por OS',
  financialDocs: 'documentos financeiros',
  reimbursements: 'reembolsos',
  sector: 'setor',
  meta: 'metadados',
};

/**
 * Returns the flat list of allowed field names for a sector, or null for ADMIN (no restrictions).
 */
export function getAllowedTaskUpdateFields(privilege: SECTOR_PRIVILEGES): string[] | null {
  if (privilege === SECTOR_PRIVILEGES.ADMIN) return null;

  const domains = SECTOR_TASK_UPDATE_ACCESS[privilege];
  if (!domains) return [];

  return domains.flatMap(domain => [...TASK_FIELD_DOMAINS[domain]]);
}

/**
 * Validates that the sector only updates fields it has access to.
 * Throws BadRequestException with a clear Portuguese message on violation.
 */
export function validateSectorFieldAccess(
  userPrivilege: SECTOR_PRIVILEGES,
  data: Record<string, unknown>,
): void {
  const allowedFields = getAllowedTaskUpdateFields(userPrivilege);

  // ADMIN — no restrictions
  if (allowedFields === null) return;

  // Filter to fields that actually carry data (ignore undefined/null/empty arrays)
  const attemptedFields = Object.keys(data).filter(field => {
    const value = data[field];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });

  const disallowedFields = attemptedFields.filter(f => !allowedFields.includes(f));

  if (disallowedFields.length > 0) {
    const domains = SECTOR_TASK_UPDATE_ACCESS[userPrivilege] || [];
    const allowedDescription = domains
      .filter(d => d !== 'meta')
      .map(d => FIELD_DOMAIN_LABELS[d])
      .join(', ');

    throw new BadRequestException(
      `Setor não tem permissão para atualizar os seguintes campos: ${disallowedFields.join(', ')}. ` +
        `Campos permitidos: ${allowedDescription || 'nenhum'}.`,
    );
  }
}
