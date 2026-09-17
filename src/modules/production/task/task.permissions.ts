import { BadRequestException } from '@nestjs/common';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';

/**
 * Task update field domains — groups related fields together.
 * When adding a new task field, add it to the appropriate domain.
 */
export const TASK_FIELD_DOMAINS = {
  /** Task identity: name, customer, vehicle info (incl. create-only serial range helpers) */
  identity: ['name', 'details', 'customerId', 'serialNumber', 'chassis', 'serialNumberFrom', 'serialNumberTo'],
  /**
   * Scheduling dates that every date-capable sector shares: the internal
   * forecast (Previsão de Liberação) and the "cleared" release flag.
   * `entryDate` and `term` are DELIBERATELY split out below — they belong to
   * different desks and are granted separately.
   */
  dates: ['forecastDate', 'forecastReason', 'cleared'],
  /**
   * Data de Entrada — when the vehicle physically arrived at the yard.
   * Owned by the desks that receive it (LOGISTIC / PRODUCTION_MANAGER) + ADMIN;
   * COMMERCIAL must NOT write it.
   */
  entryDate: ['entryDate'],
  /**
   * Prazo de Entrega — the delivery deadline the shop commits to.
   * PRODUCTION_MANAGER + ADMIN only. COMMERCIAL lost it (17/09/2026): the desk
   * that sells the job no longer promises the date, the desk that runs the
   * floor does. LOGISTIC never had it.
   */
  term: ['term'],
  /**
   * Nº do Pedido do cliente, DESTE veículo (`Task.customerOrderNumber`).
   *
   * ⚠️ Estava em domínio NENHUM. Um campo que o schema de update aceita e que
   * nenhum domínio declara é 400 para todo setor que não seja ADMIN — e este é
   * exatamente o campo da grade de edição em lote (com o botão "repetir nas
   * demais"), do formulário de edição e do detalhe do faturamento. A coluna
   * mudou de dono em 17/09 (era do pagador, virou da tarefa) e a permissão não
   * veio junto.
   *
   * Audiência: a mesma de `PATCH /budgets/:id/customer-config-order-number` —
   * ADMIN, FINANCEIRO e COMERCIAL. É um dado comercial/fiscal, não de chão.
   */
  orderNumber: ['customerOrderNumber'],
  /** Task lifecycle status */
  status: ['status', 'startedAt', 'finishedAt'],
  /** Free-text observation */
  observation: ['observation'],
  /** Task bonification status */
  bonification: ['bonification'],
  /** Truck/vehicle info (plate, chassis, category, spot, layouts) */
  truck: ['truck'],
  /** Responsible users (incl. inline-created responsibles on create) */
  responsibles: ['responsibleIds', 'responsibles', 'newResponsibles'],
  /**
   * Layout files and approval statuses.
   *
   * ⚠️ QUEM ACRESCENTA TEM DE PODER REMOVER. Os `remove*` deste bloco e dos
   * quatro abaixo estavam fora de todo domínio: o designer adicionava layout e
   * tomava 400 ao apagar um. Um campo ausente do mapa não é "negado a todos" —
   * é negado a todos MENOS ao ADMIN, silenciosamente, e só aparece no dia em que
   * alguém tenta remover.
   */
  layouts: ['layoutIds', 'layoutStatuses', 'newLayoutStatuses'],
  /**
   * APAGAR arquivo de layout — separado de `layouts` de propósito.
   *
   * FINANCEIRO, LOGÍSTICA e GERENTE DE PRODUÇÃO têm `layouts` como PASSTHROUGH:
   * o formulário reenvia `layoutIds` só para preservar o estado, e o comentário
   * de `SECTOR_TASK_UPDATE_ACCESS` diz isso. Pôr `removeLayoutIds` no mesmo
   * domínio daria aos três o poder de APAGAR a arte — um direito que o
   * passthrough nunca pretendeu conceder.
   *
   * Fica com quem de fato cura o layout: comercial, designer e o gerente que
   * responde pela produção. (`layoutStatuses` já estava em `layouts` antes e
   * segue lá: aprovar não destrói.)
   */
  layoutRemoval: ['removeLayoutIds'],
  /** Paint selection */
  paint: ['paintId', 'paintIds', 'removeGeneralPainting', 'removeLogoPaints'],
  /** Cutting plans */
  cuts: ['cuts', 'cut', 'removeCutIds'],
  /** Airbrushings (nested create through the task form) */
  airbrushings: ['airbrushings', 'removeAirbrushingIds'],
  /** Service orders */
  serviceOrders: ['serviceOrders'],
  /** Quote configuration */
  quote: ['quote', 'quoteId'],
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
  financialDocs: [
    'budgetIds',
    'invoiceIds',
    'receiptIds',
    'bankSlipIds',
    'removeBudgetIds',
    'removeInvoiceIds',
    'removeReceiptIds',
  ],
  /** Reimbursement documents */
  reimbursements: [
    'reimbursementIds',
    'reimbursementInvoiceIds',
    'removeReimbursementIds',
    'removeReimbursementInvoiceIds',
  ],
  /** Sector assignment */
  sector: ['sectorId'],
  /**
   * Internal markers (not user-facing).
   *
   * `expectedUpdatedAt` é a TRAVA OTIMISTA que o app manda — controle de
   * concorrência, não dado. Fora do mapa ela derrubava a gravação do app com
   * "setor não tem permissão para atualizar" num campo que o usuário nem vê.
   */
  meta: ['_hasFiles', '_soFileMapping', 'expectedUpdatedAt'],
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
    'quote',
    'financialDocs',
    'identity',
    'orderNumber',
    'serviceOrders',
    // Passthrough: form sends these to preserve existing state
    'layouts',
    'baseFiles',
    'truck',
    'meta',
  ],

  [SECTOR_PRIVILEGES.COMMERCIAL]: [
    'identity',
    'orderNumber',
    'dates',
    // 'entryDate' is intentionally ABSENT — the commercial desk does not record
    // when the vehicle arrived; logistics/production management does.
    // 'term' is intentionally ABSENT — the delivery deadline moved to
    // PRODUCTION_MANAGER + ADMIN (17/09/2026).
    'status',
    'bonification',
    'truck',
    'responsibles',
    'layouts',
    'layoutRemoval',
    'paint',
    'serviceOrders',
    'quote',
    'baseFiles',
    'projectFiles',
    'observation',
    'meta',
  ],

  [SECTOR_PRIVILEGES.PRODUCTION]: ['status', 'meta'],

  [SECTOR_PRIVILEGES.DESIGNER]: [
    'layouts',
    'layoutRemoval',
    'paint',
    'cuts',
    'serviceOrders',
    'baseFiles',
    'meta',
  ],

  [SECTOR_PRIVILEGES.LOGISTIC]: [
    'identity',
    'dates',
    'entryDate',
    // 'term' is intentionally ABSENT — the delivery deadline is production
    // management's (and ADMIN's) to set and change.
    'status',
    'truck',
    'responsibles',
    'baseFiles',
    'projectFiles',
    'checkinFiles',
    'checkoutFiles',
    'serviceOrderFiles',
    'observation',
    // Passthrough: form sends these to preserve existing state
    'layouts',
    'meta',
  ],

  [SECTOR_PRIVILEGES.PRODUCTION_MANAGER]: [
    'identity',
    'dates',
    'entryDate',
    'term',
    'status',
    'truck',
    'serviceOrders',
    'responsibles',
    'baseFiles',
    'projectFiles',
    'checkinFiles',
    'checkoutFiles',
    'serviceOrderFiles',
    'observation',
    'sector',
    'layouts',
    'layoutRemoval',
    'meta',
  ],

  [SECTOR_PRIVILEGES.WAREHOUSE]: ['meta'],
};

/**
 * Defines which field domains each sector may provide when CREATING a task
 * (POST /tasks, POST /tasks/batch, serial-range create).
 *
 * Creation is broader than update on purpose: the create form submits the full
 * task snapshot (dates, status default, sector, default "Em Negociação" SO,
 * truck, files...), so every creator role needs the structural domains.
 * What stays restricted at create:
 * - term (Prazo de Entrega): PRODUCTION_MANAGER only (same rule as update). A
 *   task created by the commercial desk is born WITHOUT a deadline; production
 *   management fills it in afterwards.
 * - entryDate (Data de Entrada): LOGISTIC + PRODUCTION_MANAGER only (same rule
 *   as update). No create form exposes it today, so this is belt-and-braces.
 * - bonification: COMMERCIAL only (payroll-adjacent)
 * - quote/airbrushings (money): COMMERCIAL + FINANCIAL only
 * - financialDocs/reimbursements: FINANCIAL only
 * - cuts: nobody below ADMIN (cut creation is DESIGNER/ADMIN via /cuts, and
 *   DESIGNER cannot create tasks)
 * - ADMIN is omitted — unrestricted.
 */
export const SECTOR_TASK_CREATE_ACCESS: Partial<Record<SECTOR_PRIVILEGES, FieldDomain[]>> = {
  [SECTOR_PRIVILEGES.COMMERCIAL]: [
    'identity',
    'orderNumber',
    'dates',
    // No 'entryDate' — commercial never records the vehicle's arrival.
    // No 'term' — the deadline is production management's (17/09/2026).
    'status',
    'bonification',
    'truck',
    'responsibles',
    'layouts',
    'paint',
    'serviceOrders',
    'quote',
    'airbrushings',
    'baseFiles',
    'projectFiles',
    'checkinFiles',
    'checkoutFiles',
    'observation',
    'sector',
    'meta',
  ],

  [SECTOR_PRIVILEGES.FINANCIAL]: [
    'identity',
    'orderNumber',
    'dates',
    // Neither 'entryDate' nor 'term': the financial desk creates a task purely to
    // hang a quote off it; both dates belong to other desks.
    'status',
    'truck',
    'responsibles',
    'layouts',
    'paint',
    'serviceOrders',
    'quote',
    'airbrushings',
    'financialDocs',
    'reimbursements',
    'baseFiles',
    'projectFiles',
    'checkinFiles',
    'checkoutFiles',
    'observation',
    'sector',
    'meta',
  ],

  [SECTOR_PRIVILEGES.LOGISTIC]: [
    'identity',
    'dates',
    'entryDate',
    // No 'term' — the deadline is PRODUCTION_MANAGER/ADMIN's to set.
    'status',
    'truck',
    'responsibles',
    'layouts',
    'paint',
    'serviceOrders',
    'baseFiles',
    'projectFiles',
    'checkinFiles',
    'checkoutFiles',
    'serviceOrderFiles',
    'observation',
    'sector',
    'meta',
  ],

  [SECTOR_PRIVILEGES.PRODUCTION_MANAGER]: [
    'identity',
    'dates',
    'entryDate',
    'term',
    'status',
    'truck',
    'responsibles',
    'layouts',
    'paint',
    'serviceOrders',
    'baseFiles',
    'projectFiles',
    'checkinFiles',
    'checkoutFiles',
    'serviceOrderFiles',
    'observation',
    'sector',
    'meta',
  ],
};

/** Portuguese labels for error messages */
const FIELD_DOMAIN_LABELS: Record<FieldDomain, string> = {
  identity: 'identidade (nome, cliente, veículo)',
  dates: 'datas (previsão)',
  entryDate: 'data de entrada',
  term: 'prazo de entrega',
  orderNumber: 'nº do pedido do cliente',
  status: 'status',
  observation: 'observação',
  bonification: 'bonificação',
  truck: 'caminhão',
  responsibles: 'responsáveis',
  layouts: 'layouts',
  layoutRemoval: 'exclusão de layout',
  paint: 'tintas',
  cuts: 'plano de corte',
  airbrushings: 'aerografias',
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
export function getAllowedTaskUpdateFields(
  privilege: SECTOR_PRIVILEGES,
  mode: 'update' | 'create' = 'update',
): string[] | null {
  if (privilege === SECTOR_PRIVILEGES.ADMIN) return null;

  const accessMap = mode === 'create' ? SECTOR_TASK_CREATE_ACCESS : SECTOR_TASK_UPDATE_ACCESS;
  const domains = accessMap[privilege];
  if (!domains) return [];

  return domains.flatMap(domain => [...TASK_FIELD_DOMAINS[domain]]);
}

/**
 * Validates that the sector only writes fields it has access to
 * (mode 'update' = PUT /tasks paths, mode 'create' = POST /tasks paths).
 * Throws BadRequestException with a clear Portuguese message on violation.
 */
export function validateSectorFieldAccess(
  userPrivilege: SECTOR_PRIVILEGES,
  data: Record<string, unknown>,
  mode: 'update' | 'create' = 'update',
): void {
  const allowedFields = getAllowedTaskUpdateFields(userPrivilege, mode);

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
    const accessMap = mode === 'create' ? SECTOR_TASK_CREATE_ACCESS : SECTOR_TASK_UPDATE_ACCESS;
    const domains = accessMap[userPrivilege] || [];
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
