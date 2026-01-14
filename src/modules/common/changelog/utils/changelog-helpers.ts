import {
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  CHANGE_LOG_ENTITY_TYPE,
  ENTITY_TYPE,
} from '../../../../constants';
import { ChangeLogService } from '../changelog.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import { hasValueChanged } from './serialize-changelog-value';

export interface TrackAndLogFieldChangesParams {
  changeLogService: ChangeLogService;
  entityType: ENTITY_TYPE;
  entityId: string;
  oldEntity: any;
  newEntity: any;
  fieldsToTrack: string[];
  userId: string | null;
  triggeredBy?: CHANGE_TRIGGERED_BY;
  transaction?: PrismaTransaction;
}

/**
 * Extract relationship name from entity if the field is a foreign key
 * For example, if field is "sectorId", this will look for entity.sector.name
 * IMPORTANT: Always returns the ID value, not the relationship name, to maintain referential integrity
 */
function extractRelationshipName(entity: any, field: string): any {
  // Always return the actual field value (the ID) for foreign key fields
  // This ensures changelog entries store UUIDs, not names, maintaining referential integrity
  return entity?.[field];
}

/**
 * Track individual field changes between old and new entity states and log them
 * Only logs changes where values actually differ
 * This is the async version that directly logs to changelog
 */
export async function trackAndLogFieldChanges({
  changeLogService,
  entityType,
  entityId,
  oldEntity,
  newEntity,
  fieldsToTrack,
  userId,
  triggeredBy = CHANGE_TRIGGERED_BY.USER_ACTION,
  transaction,
}: TrackAndLogFieldChangesParams): Promise<void> {
  for (const field of fieldsToTrack) {
    const oldValue = oldEntity[field];
    const newValue = newEntity[field];

    // Only log if the value actually changed
    if (hasValueChanged(oldValue, newValue)) {
      const fieldNamePt = translateFieldName(field);

      // Extract relationship names for foreign key fields
      const oldValueForLog = extractRelationshipName(oldEntity, field);
      const newValueForLog = extractRelationshipName(newEntity, field);

      await changeLogService.logChange({
        entityType: entityType,
        entityId,
        action: CHANGE_ACTION.UPDATE,
        field,
        oldValue: oldValueForLog,
        newValue: newValueForLog,
        reason: `Campo ${fieldNamePt} atualizado`,
        triggeredBy,
        triggeredById: entityId,
        userId,
        transaction,
      });
    }
  }
}

export interface LogEntityChangeParams {
  changeLogService: ChangeLogService;
  entityType: ENTITY_TYPE;
  entityId: string;
  action: CHANGE_ACTION;
  entity?: any;
  oldEntity?: any;
  oldData?: any; // Alias for oldEntity
  newData?: any; // Alias for entity
  changes?: Record<string, { from: any; to: any }>;
  reason?: string;
  userId: string | null;
  triggeredBy?: CHANGE_TRIGGERED_BY;
  transaction?: PrismaTransaction;
  // Optional field-level change tracking
  field?: string;
  oldValue?: any;
  newValue?: any;
}

/**
 * Log entity-level changes (CREATE, DELETE, UPDATE)
 * For UPDATE with field-level tracking, consider using trackFieldChanges instead for better granularity
 */
export async function logEntityChange({
  changeLogService,
  entityType,
  entityId,
  action,
  entity,
  oldEntity,
  oldData,
  newData,
  changes,
  reason,
  userId,
  triggeredBy = CHANGE_TRIGGERED_BY.USER_ACTION,
  transaction,
}: LogEntityChangeParams): Promise<void> {
  // Support both old naming (entity/oldEntity) and new naming (newData/oldData)
  const actualOldData = oldData || oldEntity;
  const actualNewData = newData || entity;

  // For CREATE: newValue = entity, oldValue = null
  // For DELETE: newValue = null, oldValue = entity
  // For UPDATE: newValue = updated entity, oldValue = old entity or changes object

  let oldValue: any;
  let newValue: any;

  if (action === CHANGE_ACTION.CREATE) {
    oldValue = null;
    newValue = actualNewData;
  } else if (action === CHANGE_ACTION.DELETE) {
    oldValue = actualOldData;
    newValue = null;
  } else if (action === CHANGE_ACTION.UPDATE) {
    // For updates, if changes object is provided, use it; otherwise use full entities
    oldValue = changes || actualOldData;
    newValue = changes || actualNewData;
  } else {
    oldValue = actualOldData;
    newValue = actualNewData;
  }

  // Generate reason if not provided
  const finalReason = reason || generateDefaultReason(action);

  await changeLogService.logChange({
    entityType: entityType,
    entityId,
    action,
    field: null,
    oldValue,
    newValue,
    reason: finalReason,
    triggeredBy,
    triggeredById: entityId,
    userId,
    transaction,
  });
}

/**
 * Generate default reason based on action
 */
function generateDefaultReason(action: CHANGE_ACTION): string {
  switch (action) {
    case CHANGE_ACTION.CREATE:
      return 'Registro criado';
    case CHANGE_ACTION.UPDATE:
      return 'Registro atualizado';
    case CHANGE_ACTION.DELETE:
      return 'Registro removido';
    default:
      return `Ação: ${action}`;
  }
}

/**
 * Synchronous version of trackFieldChanges that returns changes object
 * Useful for building changes before logging
 * @param oldEntity Original entity state
 * @param newEntity Updated entity state
 * @param fieldsToTrack Optional array of fields to track (if not provided, tracks all changed fields)
 * @returns Object with changes in format { field: { from: oldValue, to: newValue } }
 */
export function trackFieldChanges(
  oldEntity: any,
  newEntity: any,
  fieldsToTrack?: string[],
): Record<string, { from: any; to: any }> {
  const changes: Record<string, { from: any; to: any }> = {};

  // If no fields specified, track all fields in newEntity
  const fields = fieldsToTrack || Object.keys(newEntity);

  for (const field of fields) {
    const oldValue = oldEntity?.[field];
    const newValue = newEntity?.[field];

    // Only track if the value actually changed
    if (hasValueChanged(oldValue, newValue)) {
      changes[field] = {
        from: oldValue,
        to: newValue,
      };
    }
  }

  return changes;
}

/**
 * Extract only essential fields from an entity for changelog storage
 * This helps reduce the size of changelog entries
 */
export function extractEssentialFields<T extends Record<string, any>>(
  entity: T,
  fields: (keyof T)[],
): Partial<T> {
  const result: Partial<T> = {};

  for (const field of fields) {
    if (field in entity) {
      result[field] = entity[field];
    }
  }

  return result;
}

/**
 * Field name translations to Portuguese
 */
export const FIELD_TRANSLATIONS: Record<string, string> = {
  // Common fields
  id: 'ID',
  name: 'nome',
  status: 'status',
  createdAt: 'criado em',
  updatedAt: 'atualizado em',

  // Service fields
  price: 'preço',
  description: 'descrição',

  // Paint fields
  hex: 'cor hexadecimal',
  finish: 'acabamento',
  brand: 'marca',
  manufacturer: 'fabricante',
  tags: 'tags',
  paintTypeId: 'tipo de tinta',
  groundIds: 'tintas de fundo',
  groundPaints: 'tintas de fundo',
  groundPaintFor: 'tinta de fundo para',

  // Paint Formula fields
  // description: "descrição", // Duplicate - already defined in Service fields
  paintId: 'tinta',
  density: 'densidade',
  pricePerLiter: 'preço por litro',
  viscosity: 'viscosidade',
  isActive: 'ativo',
  formulas: 'fórmulas',
  productions: 'produções',

  // Paint Formula Component fields
  ratio: 'proporção',
  itemId: 'item',
  formulaPaintId: 'fórmula',
  weightInGrams: 'peso em gramas',
  componentImpact: 'impacto do componente',
  components: 'componentes',
  formulaComponents: 'componentes da fórmula',

  // Paint Production fields
  volumeLiters: 'volume em litros',
  formulaId: 'fórmula',
  weight: 'peso',
  batchCode: 'código do lote',
  productionDate: 'data de produção',

  // Paint Type fields
  // type: "tipo", // Duplicate - already defined in Cut fields
  needGround: 'necessita fundo',
  paints: 'tintas',
  componentItems: 'itens componentes',

  // Paint Ground fields
  groundPaintId: 'tinta de fundo',

  // Item fields (for inventory tracking)
  quantity: 'quantidade',
  minQuantity: 'quantidade mínima',
  maxQuantity: 'quantidade máxima',
  barcode: 'código de barras',
  categoryId: 'categoria',
  brandId: 'marca',
  supplierId: 'fornecedor',

  // Supplier fields (fornecedor)
  fantasyName: 'nome fantasia',
  corporateName: 'razão social',
  cnpj: 'CNPJ',
  email: 'email',
  phones: 'telefones',
  site: 'site',
  representativeName: 'nome do representante',
  address: 'endereço',
  number: 'número',
  complement: 'complemento',
  neighborhood: 'bairro',
  city: 'cidade',
  state: 'estado',
  zipCode: 'CEP',
  country: 'país',
  observations: 'observações',

  // External Withdrawal fields
  withdrawerName: 'nome do retirador',
  nfeId: 'NFe',
  receiptId: 'recibo',
  budgetId: 'orçamento',
  type: 'tipo',
  notes: 'observações',
  withdrawalDate: 'data da retirada',
  actualReturnDate: 'data real de devolução',
  totalValue: 'valor total',
  isPaid: 'está pago',
  paymentDate: 'data do pagamento',
  withdrawalType: 'tipo da retirada',
  status_transition: 'transição de status',

  // External Withdrawal Item fields
  withdrawedQuantity: 'quantidade retirada',
  returnedQuantity: 'quantidade devolvida',
  // price: "preço", // Duplicate - already defined in Service fields
  unitPrice: 'preço unitário',
  totalPrice: 'preço total',
  icms: 'ICMS',
  ipi: 'IPI',
  discount: 'desconto',
  condition: 'condição',
  serialNumber: 'número de série',
  batchNumber: 'número do lote',
  expirationDate: 'data de validade',
  location: 'localização',
  isDefective: 'está defeituoso',
  defectDescription: 'descrição do defeito',
  batch_summary: 'resumo da operação em lote',

  // Cut fields
  fileId: 'arquivo',
  origin: 'origem',
  reason: 'motivo',
  parentCutId: 'corte pai',
  cuts: 'recortes',
  taskId: 'tarefa',

  // Truck fields
  plate: 'placa',
  chassisNumber: 'chassi',
  category: 'categoria do caminhão',
  implementType: 'tipo de implemento',
  spot: 'vaga',
  'truck.plate': 'placa do caminhão',
  'truck.chassisNumber': 'chassi do caminhão',
  'truck.category': 'categoria do caminhão',
  'truck.implementType': 'tipo de implemento do caminhão',
  'truck.spot': 'vaga do caminhão',
  'truck.leftSideLayoutId': 'layout do lado esquerdo',
  'truck.rightSideLayoutId': 'layout do lado direito',
  'truck.backSideLayoutId': 'layout da traseira',
  width: 'largura',
  height: 'altura',
  length: 'comprimento',
  xPosition: 'posição X',
  yPosition: 'posição Y',
  garageId: 'garagem',
  startedAt: 'iniciado em',
  completedAt: 'concluído em',

  // Notification fields
  title: 'título',
  message: 'mensagem',
  body: 'conteúdo',
  // type: "tipo", // Duplicate - already defined
  importance: 'importância',
  channel: 'canais',
  channels: 'canais',
  actionUrl: 'URL de ação',
  actionType: 'tipo de ação',
  sentAt: 'enviado em',
  scheduledAt: 'agendado para',
  userId: 'usuário',
  readStatus: 'status de leitura',

  // Notification Preference fields
  notificationType: 'tipo de notificação',
  enabled: 'habilitado',
  preferencesId: 'preferências',

  // Seen Notification fields
  notificationId: 'notificação',
  seenAt: 'visto em',

  // File fields
  filename: 'nome do arquivo',
  size: 'tamanho',
  mimetype: 'tipo',
  mimeType: 'tipo',
  entityType: 'entidade relacionada',
  originalName: 'nome original',
  path: 'caminho',
  thumbnailUrl: 'URL da miniatura',

  // Holiday fields
  date: 'data',
  // type: "tipo", // Duplicate - already defined
  // description: "descrição", // Duplicate - already defined in Service fields
  isRecurring: 'é recorrente',
  isNational: 'é nacional',
  isOptional: 'é opcional',

  // Position fields
  level: 'nível',
  sectorId: 'setor',
  privileges: 'privilégios',
  commissionEligible: 'elegível para comissão',
  maxAllowedVacationDays: 'dias máximos de férias',
  remuneration: 'remuneração',

  // Sector fields
  // privileges: "privilégios", // Duplicate - already defined in Position fields
};

/**
 * Get Portuguese translation for field name
 */
export function translateFieldName(fieldName: string): string {
  return FIELD_TRANSLATIONS[fieldName] || fieldName;
}

/**
 * Common essential fields for most entities
 */
export const COMMON_ESSENTIAL_FIELDS = ['id', 'name', 'status', 'createdAt', 'updatedAt'];

/**
 * Entity-specific essential fields
 */
export const ENTITY_ESSENTIAL_FIELDS: Partial<Record<ENTITY_TYPE, string[]>> = {
  [ENTITY_TYPE.ITEM]: [
    'id',
    'name',
    'barcode',
    'quantity',
    'minQuantity',
    'maxQuantity',
    'categoryId',
    'brandId',
    'supplierId',
  ],
  [ENTITY_TYPE.USER]: ['id', 'name', 'email', 'cpf', 'status', 'positionId', 'sectorId'],
  [ENTITY_TYPE.TASK]: [
    'id',
    'name',
    'status',
    'customerId',
    'sectorId',
    'paintId',
    'price',
    'startedAt',
    'finishedAt',
    'commission',
    'serialNumber',
    'plate',
  ],
  [ENTITY_TYPE.ORDER]: ['id', 'status', 'supplierId', 'totalPrice', 'scheduledFor'],
  [ENTITY_TYPE.ORDER_ITEM]: [
    'id',
    'orderId',
    'itemId',
    'orderedQuantity',
    'receivedQuantity',
    'price',
    'icms',
    'ipi',
  ],
  [ENTITY_TYPE.ORDER_SCHEDULE]: [
    'id',
    'supplierId',
    'categoryId',
    'frequency',
    'isActive',
    'nextRun',
    'lastRun',
  ],
  [ENTITY_TYPE.ACTIVITY]: ['id', 'itemId', 'quantity', 'operation', 'reason', 'orderId'],
  [ENTITY_TYPE.CUSTOMER]: ['id', 'fantasyName', 'corporateName', 'cnpj', 'cpf', 'email'],
  [ENTITY_TYPE.SUPPLIER]: [
    'id',
    'fantasyName',
    'corporateName',
    'cnpj',
    'email',
    'phones',
    'site',
    'representativeName',
    'address',
    'number',
    'complement',
    'neighborhood',
    'city',
    'state',
    'zipCode',
    'country',
    'status',
    'observations',
    'logoId',
  ],
  [ENTITY_TYPE.COMMISSION]: ['id', 'taskId', 'userId', 'value', 'status'],
  [ENTITY_TYPE.POSITION]: [
    'id',
    'name',
    'level',
    'sectorId',
    'privileges',
    'commissionEligible',
    'maxAllowedVacationDays',
    'remuneration',
  ],
  [ENTITY_TYPE.SECTOR]: ['id', 'name', 'privileges'],
  [ENTITY_TYPE.HOLIDAY]: [
    'id',
    'name',
    'date',
    'type',
    'description',
    'isRecurring',
    'isNational',
    'isOptional',
  ],
  [ENTITY_TYPE.PPE_DELIVERY]: [
    'id',
    'userId',
    'itemId',
    'quantity',
    'reviewedBy',
    'actualDeliveryDate',
    'scheduledDate',
    'ppeScheduleId',
  ],
  [ENTITY_TYPE.PPE_DELIVERY_SCHEDULE]: [
    'id',
    'userId',
    'itemId',
    'quantity',
    'frequency',
    'isActive',
    'nextRun',
    'lastRun',
  ],
  [ENTITY_TYPE.MAINTENANCE]: [
    'id',
    'name',
    'description',
    'status',
    'itemId',
    'startedAt',
    'finishedAt',
  ],
  [ENTITY_TYPE.MAINTENANCE_ITEM]: ['id', 'maintenanceId', 'itemId', 'quantity'],
  [ENTITY_TYPE.MAINTENANCE_SCHEDULE]: [
    'id',
    'name',
    'description',
    'itemId',
    'frequency',
    'isActive',
    'nextRun',
    'lastRun',
  ],
  [ENTITY_TYPE.PRICE]: ['id', 'value', 'icms', 'ipi', 'itemId', 'createdAt'],
  [ENTITY_TYPE.PAINT_TYPE]: ['id', 'name', 'type', 'needGround', 'createdAt', 'updatedAt'],
  [ENTITY_TYPE.PAINT]: [
    'id',
    'name',
    'hex',
    'finish',
    'brand',
    'manufacturer',
    'tags',
    'paintTypeId',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.PAINT_FORMULA]: [
    'id',
    'description',
    'paintId',
    'density',
    'pricePerLiter',
    'viscosity',
    'isActive',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.PAINT_FORMULA_COMPONENT]: [
    'id',
    'ratio',
    'itemId',
    'formulaPaintId',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.PAINT_PRODUCTION]: ['id', 'volumeLiters', 'formulaId', 'createdAt', 'updatedAt'],
  [ENTITY_TYPE.PAINT_GROUND]: ['id', 'paintId', 'groundPaintId', 'createdAt', 'updatedAt'],
  [ENTITY_TYPE.EXTERNAL_WITHDRAWAL]: [
    'id',
    'withdrawerName',
    'status',
    'nfeId',
    'receiptId',
    'budgetId',
    'type',
    'notes',
    'withdrawalDate',
    'actualReturnDate',
    'totalValue',
    'isPaid',
    'paymentDate',
    'withdrawalType',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM]: [
    'id',
    'externalWithdrawalId',
    'itemId',
    'withdrawedQuantity',
    'returnedQuantity',
    'price',
    'unitPrice',
    'totalPrice',
    'icms',
    'ipi',
    'discount',
    'notes',
    'condition',
    'serialNumber',
    'batchNumber',
    'expirationDate',
    'location',
    'isDefective',
    'defectDescription',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.CUT]: [
    'id',
    'fileId',
    'type',
    'status',
    'origin',
    'reason',
    'parentCutId',
    'taskId',
    'startedAt',
    'completedAt',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.NOTIFICATION]: [
    'id',
    'title',
    'body',
    'type',
    'importance',
    'channel',
    'actionUrl',
    'actionType',
    'sentAt',
    'scheduledAt',
    'userId',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.NOTIFICATION_PREFERENCE]: [
    'id',
    'notificationType',
    'enabled',
    'channels',
    'importance',
    'preferencesId',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.SEEN_NOTIFICATION]: [
    'id',
    'notificationId',
    'userId',
    'seenAt',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.TRUCK]: [
    'id',
    'width',
    'height',
    'length',
    'xPosition',
    'yPosition',
    'taskId',
    'garageId',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.FILE]: [
    'id',
    'filename',
    'originalName',
    'size',
    'mimetype',
    'path',
    'thumbnailUrl',
    'createdAt',
    'updatedAt',
  ],
  [ENTITY_TYPE.SERVICE]: ['id', 'name', 'price', 'description', 'status', 'createdAt', 'updatedAt'],
  // Add more entities as needed
};

/**
 * Get essential fields for a specific entity type
 */
export function getEssentialFields(entityType: ENTITY_TYPE): string[] {
  return ENTITY_ESSENTIAL_FIELDS[entityType] || COMMON_ESSENTIAL_FIELDS;
}

// Re-export hasValueChanged for external use
export { hasValueChanged } from './serialize-changelog-value';
