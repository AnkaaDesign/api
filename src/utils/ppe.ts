import type { PpeSize, PpeDelivery, PpeDeliverySchedule, Item } from '@types';
import { dateUtils } from "./date";
import {
  SCHEDULE_FREQUENCY,
  PPE_DELIVERY_MODE,
  PPE_REQUEST_STATUS,
  PANTS_SIZE,
  SHIRT_SIZE,
  BOOT_SIZE,
  PPE_TYPE,
  PPE_SIZE,
  PPE_DELIVERY_STATUS,
} from '@constants';
import {
  PPE_REQUEST_STATUS_LABELS,
  DELIVERY_MODE_LABELS,
  PANTS_SIZE_LABELS,
  SHIRT_SIZE_LABELS,
  BOOT_SIZE_LABELS,
  PPE_DELIVERY_STATUS_LABELS,
  PPE_TYPE_LABELS,
  PPE_SIZE_LABELS,
} from '@constants';

// Clothing sizes (P to XG) - used for shirts, sleeves, and masks
const CLOTHING_SIZES: PPE_SIZE[] = [PPE_SIZE.P, PPE_SIZE.M, PPE_SIZE.G, PPE_SIZE.GG, PPE_SIZE.XG];

// Numeric sizes (36 to 48) - used for pants and boots
const NUMERIC_SIZES: PPE_SIZE[] = [PPE_SIZE.SIZE_36, PPE_SIZE.SIZE_38, PPE_SIZE.SIZE_40, PPE_SIZE.SIZE_42, PPE_SIZE.SIZE_44, PPE_SIZE.SIZE_46, PPE_SIZE.SIZE_48];

/**
 * Validates if a given size is valid for a specific PPE type.
 *
 * @param size - The PPE size to validate
 * @param ppeType - The type of PPE equipment
 * @returns true if the size is valid for the PPE type, false otherwise
 *
 * @example
 * isValidSizeForPpeType(PPE_SIZE.P, PPE_TYPE.SHIRT) // returns true
 * isValidSizeForPpeType(PPE_SIZE.SIZE_36, PPE_TYPE.SHIRT) // returns false
 * isValidSizeForPpeType(PPE_SIZE.SIZE_36, PPE_TYPE.PANTS) // returns true
 */
export function isValidSizeForPpeType(size: PPE_SIZE, ppeType: PPE_TYPE): boolean {
  switch (ppeType) {
    case PPE_TYPE.SHIRT:
    case PPE_TYPE.SLEEVES:
    case PPE_TYPE.MASK:
      return CLOTHING_SIZES.includes(size);

    case PPE_TYPE.GLOVES:
      // Gloves only use P, M, G sizes
      return [PPE_SIZE.P, PPE_SIZE.M, PPE_SIZE.G].includes(size);

    case PPE_TYPE.PANTS:
    case PPE_TYPE.BOOTS:
      return NUMERIC_SIZES.includes(size);

    case PPE_TYPE.RAIN_BOOTS:
      // Galocha uses 36-46 sizes (not 48)
      return [PPE_SIZE.SIZE_36, PPE_SIZE.SIZE_38, PPE_SIZE.SIZE_40, PPE_SIZE.SIZE_42, PPE_SIZE.SIZE_44, PPE_SIZE.SIZE_46].includes(size);

    case PPE_TYPE.OTHERS:
      // OTHERS type doesn't require specific sizes - size is optional
      return true;

    default:
      return false;
  }
}

/**
 * Gets all valid sizes for a specific PPE type.
 *
 * @param ppeType - The type of PPE equipment
 * @returns Array of valid PPE_SIZE values for the given type
 *
 * @example
 * getValidSizesForPpeType(PPE_TYPE.SHIRT) // returns [PPE_SIZE.P, PPE_SIZE.M, PPE_SIZE.G, PPE_SIZE.GG, PPE_SIZE.XG]
 * getValidSizesForPpeType(PPE_TYPE.PANTS) // returns [PPE_SIZE.SIZE_36, ..., PPE_SIZE.SIZE_48]
 */
export function getValidSizesForPpeType(ppeType: PPE_TYPE): PPE_SIZE[] {
  switch (ppeType) {
    case PPE_TYPE.SHIRT:
    case PPE_TYPE.SLEEVES:
    case PPE_TYPE.MASK:
      return [...CLOTHING_SIZES];

    case PPE_TYPE.GLOVES:
      // Gloves only use P, M, G sizes
      return [PPE_SIZE.P, PPE_SIZE.M, PPE_SIZE.G];

    case PPE_TYPE.PANTS:
    case PPE_TYPE.BOOTS:
      return [...NUMERIC_SIZES];

    case PPE_TYPE.RAIN_BOOTS:
      // Galocha uses 36-46 sizes (not 48)
      return [PPE_SIZE.SIZE_36, PPE_SIZE.SIZE_38, PPE_SIZE.SIZE_40, PPE_SIZE.SIZE_42, PPE_SIZE.SIZE_44, PPE_SIZE.SIZE_46];

    case PPE_TYPE.OTHERS:
      // OTHERS type doesn't require specific sizes - size is optional
      return [];

    default:
      return [];
  }
}

/**
 * Get PPE request status label
 * @deprecated Use getPpeDeliveryStatusLabel instead
 */
export function getPpeRequestStatusLabel(status: PPE_REQUEST_STATUS): string {
  return PPE_REQUEST_STATUS_LABELS[status] || status;
}

/**
 * Get PPE delivery status label
 */
export function getPpeDeliveryStatusLabel(status: PPE_DELIVERY_STATUS): string {
  return PPE_DELIVERY_STATUS_LABELS[status] || status;
}

/**
 * Get PPE delivery mode label
 */
export function getPpeDeliveryModeLabel(mode: PPE_DELIVERY_MODE): string {
  return DELIVERY_MODE_LABELS[mode] || mode;
}

/**
 * Get PPE type label
 */
export function getPpeTypeLabel(type: PPE_TYPE): string {
  return PPE_TYPE_LABELS[type] || type;
}

/**
 * Get PPE size label
 */
export function getPpeSizeLabel(size: PPE_SIZE): string {
  return PPE_SIZE_LABELS[size] || size;
}

/**
 * Get pants size label
 */
export function getPantsSizeLabel(size: PANTS_SIZE): string {
  return PANTS_SIZE_LABELS[size] || size;
}

/**
 * Get shirt size label
 */
export function getShirtSizeLabel(size: SHIRT_SIZE): string {
  return SHIRT_SIZE_LABELS[size] || size;
}

/**
 * Get boot size label
 */
export function getBootSizeLabel(size: BOOT_SIZE): string {
  return BOOT_SIZE_LABELS[size] || size;
}

/**
 * Format PPE size display
 */
export function formatPpeSizeDisplay(size: PpeSize): string {
  const parts: string[] = [];

  if (size.shirts) parts.push(`Camisa: ${size.shirts}`);
  if (size.pants) parts.push(`Calça: ${size.pants}`);
  if (size.boots) parts.push(`Bota: ${size.boots}`);
  if (size.sleeves) parts.push(`Manga: ${size.sleeves}`);

  return parts.join(", ") || "Tamanhos não definidos";
}

/**
 * Check if PPE delivery is scheduled
 */
export function isDeliveryScheduled(delivery: PpeDelivery): boolean {
  return delivery.scheduledDate !== null;
}

/**
 * Check if PPE delivery is overdue
 */
export function isDeliveryOverdue(delivery: PpeDelivery): boolean {
  if (!delivery.scheduledDate) return false;
  if (delivery.actualDeliveryDate) return false;

  return new Date() > new Date(delivery.scheduledDate);
}

/**
 * Check if PPE delivery is completed
 */
export function isDeliveryCompleted(delivery: PpeDelivery): boolean {
  return delivery.actualDeliveryDate !== null;
}

/**
 * Check if PPE delivery is pending
 */
export function isDeliveryPending(delivery: PpeDelivery): boolean {
  return delivery.status === PPE_DELIVERY_STATUS.PENDING;
}

/**
 * Check if PPE delivery is approved
 */
export function isDeliveryApproved(delivery: PpeDelivery): boolean {
  return delivery.status === PPE_DELIVERY_STATUS.APPROVED;
}

/**
 * Check if PPE delivery is delivered
 */
export function isDeliveryDelivered(delivery: PpeDelivery): boolean {
  return delivery.status === PPE_DELIVERY_STATUS.DELIVERED;
}

/**
 * Check if PPE delivery is cancelled
 */
export function isDeliveryCancelled(delivery: PpeDelivery): boolean {
  return delivery.status === PPE_DELIVERY_STATUS.REPROVED;
}

/**
 * Get delivery status
 * @deprecated Use delivery.status directly with PPE_DELIVERY_STATUS enum
 */
export function getDeliveryStatus(delivery: PpeDelivery): "scheduled" | "overdue" | "completed" | "unscheduled" {
  if (isDeliveryCompleted(delivery)) return "completed";
  if (isDeliveryOverdue(delivery)) return "overdue";
  if (isDeliveryScheduled(delivery)) return "scheduled";
  return "unscheduled";
}

/**
 * Get delivery status label
 * @deprecated Use getPpeDeliveryStatusLabel instead
 */
export function getDeliveryStatusLabel(status: "scheduled" | "overdue" | "completed" | "unscheduled"): string {
  const labels = {
    scheduled: "Agendado",
    overdue: "Atrasado",
    completed: "Entregue",
    unscheduled: "Não agendado",
  };
  return labels[status];
}

/**
 * Get delivery status color
 * @deprecated Use getPpeDeliveryStatusColor instead
 */
export function getDeliveryStatusColor(status: "scheduled" | "overdue" | "completed" | "unscheduled"): string {
  const colors = {
    scheduled: "blue",
    overdue: "red",
    completed: "green",
    unscheduled: "gray",
  };
  return colors[status];
}

/**
 * Get PPE delivery status color
 */
export function getPpeDeliveryStatusColor(status: PPE_DELIVERY_STATUS): string {
  const colors: Record<PPE_DELIVERY_STATUS, string> = {
    [PPE_DELIVERY_STATUS.PENDING]: "yellow",
    [PPE_DELIVERY_STATUS.APPROVED]: "blue",
    [PPE_DELIVERY_STATUS.DELIVERED]: "green",
    [PPE_DELIVERY_STATUS.REPROVED]: "red",
    [PPE_DELIVERY_STATUS.CANCELLED]: "gray",
  };
  return colors[status] || "gray";
}

/**
 * Format delivery summary
 */
export function formatDeliverySummary(delivery: PpeDelivery): string {
  const userName = delivery.user?.name || "Usuário desconhecido";
  const status = getPpeDeliveryStatusLabel(delivery.status);

  // Use direct quantity and item from delivery
  const quantity = delivery.quantity || 0;
  const itemName = delivery.item?.name || "Item desconhecido";
  const itemsDescription = `${quantity}x ${itemName}`;

  return `${itemsDescription} para ${userName} - ${status}`;
}

/**
 * Get days until scheduled delivery
 */
export function getDaysUntilDelivery(delivery: PpeDelivery): number | null {
  if (!delivery.scheduledDate) return null;
  if (delivery.actualDeliveryDate) return null;

  return dateUtils.getDaysBetween(new Date(), delivery.scheduledDate);
}

/**
 * Get delivery mode label (legacy - using hardcoded labels)
 * @deprecated Use getPpeDeliveryModeLabel instead
 */
export function getDeliveryModeLabel(mode: PPE_DELIVERY_MODE): string {
  const labels: Record<PPE_DELIVERY_MODE, string> = {
    [PPE_DELIVERY_MODE.SCHEDULED]: "Programada",
    [PPE_DELIVERY_MODE.ON_DEMAND]: "Sob Demanda",
    [PPE_DELIVERY_MODE.BOTH]: "Ambos",
  };
  return labels[mode] || mode;
}

/**
 * Check if PPE schedule is active
 */
export function isPpeScheduleActive(schedule: PpeDeliverySchedule): boolean {
  return schedule.isActive === true;
}

/**
 * Check if PPE schedule is due
 */
export function isPpeScheduleDue(schedule: PpeDeliverySchedule): boolean {
  if (!schedule.isActive) return false;
  if (!schedule.nextRun) return true;

  return new Date() >= new Date(schedule.nextRun);
}

/**
 * Get PPE frequency label
 */
export function getPpeFrequencyLabel(frequency: SCHEDULE_FREQUENCY): string {
  const labels: Record<SCHEDULE_FREQUENCY, string> = {
    [SCHEDULE_FREQUENCY.ONCE]: "Uma Vez",
    [SCHEDULE_FREQUENCY.DAILY]: "Diário",
    [SCHEDULE_FREQUENCY.WEEKLY]: "Semanal",
    [SCHEDULE_FREQUENCY.BIWEEKLY]: "Quinzenal",
    [SCHEDULE_FREQUENCY.MONTHLY]: "Mensal",
    [SCHEDULE_FREQUENCY.BIMONTHLY]: "Bimestral",
    [SCHEDULE_FREQUENCY.QUARTERLY]: "Trimestral",
    [SCHEDULE_FREQUENCY.TRIANNUAL]: "Triânuo",
    [SCHEDULE_FREQUENCY.QUADRIMESTRAL]: "Quadrimestral",
    [SCHEDULE_FREQUENCY.SEMI_ANNUAL]: "Semestral",
    [SCHEDULE_FREQUENCY.ANNUAL]: "Anual",
    [SCHEDULE_FREQUENCY.CUSTOM]: "Personalizado",
  };
  return labels[frequency] || frequency;
}

/**
 * Format PPE schedule summary
 */
export function formatPpeScheduleSummary(schedule: PpeDeliverySchedule): string {
  const frequency = getPpeFrequencyLabel(schedule.frequency);
  const status = schedule.isActive ? "Ativo" : "Inativo";
  const ppeTypes = schedule.ppeItems?.map((item) => `${item.ppeType} (${item.quantity}x)`).join(", ") || "Não especificado";

  const assignmentTypeLabels = {
    ALL: "Todos os usuários",
    ALL_EXCEPT: "Todos exceto alguns",
    SPECIFIC: "Usuários específicos",
  };

  const assignmentLabel = assignmentTypeLabels[schedule.assignmentType] || schedule.assignmentType;

  return `${frequency} - ${ppeTypes} (${assignmentLabel}) - ${status}`;
}

/**
 * Group deliveries by status
 */
export function groupDeliveriesByStatus(deliveries: PpeDelivery[]): Record<PPE_DELIVERY_STATUS, PpeDelivery[]> {
  const groups: Record<PPE_DELIVERY_STATUS, PpeDelivery[]> = {
    [PPE_DELIVERY_STATUS.PENDING]: [],
    [PPE_DELIVERY_STATUS.APPROVED]: [],
    [PPE_DELIVERY_STATUS.DELIVERED]: [],
    [PPE_DELIVERY_STATUS.REPROVED]: [],
    [PPE_DELIVERY_STATUS.CANCELLED]: [],
  };

  deliveries.forEach((delivery) => {
    groups[delivery.status].push(delivery);
  });

  return groups;
}

/**
 * Filter deliveries by user
 */
export function filterDeliveriesByUser(deliveries: PpeDelivery[], userId: string): PpeDelivery[] {
  return deliveries.filter((delivery) => delivery.userId === userId);
}

/**
 * Filter deliveries by item
 */
export function filterDeliveriesByItem(deliveries: PpeDelivery[], itemId: string): PpeDelivery[] {
  return deliveries.filter((delivery) => delivery.itemId === itemId);
}

/**
 * Calculate delivery statistics
 */
export function calculateDeliveryStats(deliveries: PpeDelivery[]) {
  const total = deliveries.length;
  const pending = deliveries.filter(isDeliveryPending).length;
  const approved = deliveries.filter(isDeliveryApproved).length;
  const delivered = deliveries.filter(isDeliveryDelivered).length;
  const cancelled = deliveries.filter(isDeliveryCancelled).length;
  const overdue = deliveries.filter(isDeliveryOverdue).length;

  const totalQuantity = deliveries.reduce((sum, delivery) => sum + (delivery.quantity || 0), 0);
  const completionRate = total > 0 ? (delivered / total) * 100 : 0;

  return {
    total,
    pending,
    approved,
    delivered,
    cancelled,
    overdue,
    totalQuantity,
    completionRate: Math.round(completionRate),
  };
}

/**
 * Sort deliveries by scheduled date
 */
export function sortDeliveriesByScheduledDate(deliveries: PpeDelivery[], order: "asc" | "desc" = "asc"): PpeDelivery[] {
  return [...deliveries].sort((a, b) => {
    if (!a.scheduledDate && !b.scheduledDate) return 0;
    if (!a.scheduledDate) return 1;
    if (!b.scheduledDate) return -1;

    const dateA = new Date(a.scheduledDate).getTime();
    const dateB = new Date(b.scheduledDate).getTime();
    return order === "asc" ? dateA - dateB : dateB - dateA;
  });
}

// COMMENTED OUT: PPE config now in Item model
/*
export function calculatePpeConfigStats(configs: PpeConfig[]) {
  const total = configs.length;

  const byDeliveryMode = configs.reduce(
    (acc, config) => {
      acc[config.deliveryMode] = (acc[config.deliveryMode] || 0) + 1;
      return acc;
    },
    {} as Record<PPE_DELIVERY_MODE, number>,
  );

  const averageStandardQuantity = configs.reduce((sum, config) => sum + config.standardQuantity, 0) / (total || 1);

  const averageAutoOrderMonths = configs.reduce((sum, config) => sum + config.autoOrderMonths, 0) / (total || 1);

  return {
    total,
    byDeliveryMode,
    averageStandardQuantity: Math.round(averageStandardQuantity),
    averageAutoOrderMonths: Math.round(averageAutoOrderMonths),
  };
}
*/

/**
 * Interface for PPE order suggestion
 */
export interface PpeOrderSuggestion {
  itemId: string;
  itemName: string;
  ppeType: PPE_TYPE;
  size: string;
  currentStock: number;
  requiredQuantity: number;
  suggestedOrderQuantity: number;
  usersNeedingSize: string[];
}

/**
 * Interface for PPE size requirement
 */
export interface PpeSizeRequirement {
  ppeType: PPE_TYPE;
  size: string;
  userCount: number;
  users: Array<{ id: string; name: string }>;
}

/**
 * Interface for PPE availability by size
 */
export interface PpeAvailabilityBySize {
  ppeType: PPE_TYPE;
  size: string;
  availableQuantity: number;
  requiredQuantity: number;
  isAvailable: boolean;
  shortage: number;
}

/**
 * Interface for PPE size distribution
 */
export interface PpeSizeDistribution {
  ppeType: PPE_TYPE;
  sizeDistribution: Record<
    string,
    {
      count: number;
      percentage: number;
      users: string[];
    }
  >;
  totalUsers: number;
}

/**
 * Get PPE size value based on type
 */
export function getPpeSizeByType(ppeSize: PpeSize, ppeType: PPE_TYPE): string | null {
  switch (ppeType) {
    case PPE_TYPE.SHIRT:
      return ppeSize.shirts;
    case PPE_TYPE.PANTS:
      return ppeSize.pants;
    case PPE_TYPE.BOOTS:
      return ppeSize.boots;
    case PPE_TYPE.SLEEVES:
      return ppeSize.sleeves;
    case PPE_TYPE.MASK:
      return ppeSize.mask;
    case PPE_TYPE.GLOVES:
      return ppeSize.gloves;
    case PPE_TYPE.RAIN_BOOTS:
      return ppeSize.rainBoots;
    case PPE_TYPE.OTHERS:
      // OTHERS type doesn't have specific size mapping
      return null;
    default:
      return null;
  }
}

/**
 * Check if an item is a PPE
 */
export function isItemPpe(item: Item): boolean {
  return item.ppeType !== null;
}

/**
 * Format PPE item display name with size (size from measures)
 */
export function formatPpeItemName(item: Item): string {
  if (!isItemPpe(item)) return item.name;

  const ppeType = item.ppeType ? getPpeTypeLabel(item.ppeType) : "";

  // Get size from measures
  let ppeSize = "";
  if (item.measures && item.measures.length > 0) {
    const sizeMeasure = item.measures.find(m => m.measureType === "SIZE");
    if (sizeMeasure && sizeMeasure.unit) {
      ppeSize = getPpeSizeLabel(sizeMeasure.unit as any);
    }
  }

  if (ppeType && ppeSize) {
    return `${item.name} - ${ppeType} ${ppeSize}`;
  }

  return item.name;
}

/**
 * Get PPE standard quantity from item
 */
export function getPpeStandardQuantity(item: Item): number {
  return item.ppeStandardQuantity || 1;
}

/**
 * Calculate PPE auto order lead time in days based on item's estimated lead time
 * Default to 180 days (6 months) if no lead time is specified
 */
export function getPpeAutoOrderLeadTime(item: Item): number {
  // Use estimatedLeadTime if available, otherwise default to 180 days (6 months)
  const leadTimeDays = item.estimatedLeadTime || 180;
  return leadTimeDays;
}

/**
 * Check if PPE item has CA (Certificate of Approval)
 */
export function ppeHasCA(item: Item): boolean {
  return item.ppeCA !== null && item.ppeCA !== "";
}

/**
 * Get PPE delivery mode from item
 */
export function getPpeDeliveryMode(item: Item): PPE_DELIVERY_MODE | null {
  return item.ppeDeliveryMode;
}

/**
 * Check if PPE item allows scheduled delivery
 */
export function allowsScheduledDelivery(item: Item): boolean {
  const mode = getPpeDeliveryMode(item);
  return mode === PPE_DELIVERY_MODE.SCHEDULED || mode === PPE_DELIVERY_MODE.BOTH;
}

/**
 * Check if PPE item allows on-demand delivery
 */
export function allowsOnDemandDelivery(item: Item): boolean {
  const mode = getPpeDeliveryMode(item);
  return mode === PPE_DELIVERY_MODE.ON_DEMAND || mode === PPE_DELIVERY_MODE.BOTH;
}

// COMMENTED OUT: Functions that use PpeConfig - PPE config now in Item model
// The following functions have been removed because they depend on PpeConfig:
// - calculateRequiredQuantitiesBySize
// - generateOrderSuggestionsBySize
// - validatePpeAvailabilityBySize
// - createSizeDistributionReport
// - getPpeSizeLabel
// - formatPpeOrderSuggestion
// - groupOrderSuggestionsByType
// - calculateTotalOrderValue
// - analyzePpeConsumption
// - optimizePpeOrder
// - getPpeReorderRecommendations
// - generatePpeDeliverySchedule
// - createPpeOrderReport
