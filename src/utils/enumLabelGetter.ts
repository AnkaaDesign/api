// =====================
// Label Getter Functions
// =====================
//
// Note: Domain-specific enum label getters have been moved to their respective modules:
//
// Paint module:
// - getPaintTypeLabel, getPaintBrandLabel, getPaintFinishLabel, getColorPaletteLabel -> packages/utils/src/paint.ts
//
// Work module:
// - getTaskStatusLabel -> apps/api/src/modules/work/task/utils.ts
// - getServiceOrderStatusLabel -> apps/api/src/modules/work/service-order/utils.ts
// - getAirbrushingStatusLabel -> apps/api/src/modules/work/airbrushing/utils.ts
// - getTaskObservationTypeLabel -> apps/api/src/modules/work/task-observation/utils.ts
// - getWorkloadLevelLabel -> apps/api/src/modules/work/utils.ts
// - getTruckManufacturerLabel -> packages/utils/src/truck.ts
//
// Common module:
// - getNotificationTypeLabel, getNotificationImportanceLabel, getNotificationChannelLabel -> apps/api/src/modules/common/notification/notification.utils.ts
// - getAuditActionLabel, getEntityTypeLabel, getChangeActionLabel -> apps/api/src/modules/common/changelog/changelog.utils.ts
// - getFileEntityTypeLabel, getFileFormatLabel -> apps/api/src/modules/common/file/file.utils.ts
// - getColorSchemaLabel -> apps/api/src/modules/common/auth/auth.utils.ts
//
// People module:
// - getWarningSeverityLabel, getWarningCategoryLabel -> packages/utils/src/warning.ts
// - getHolidayTypeLabel -> apps/api/src/modules/people/holiday/utils.ts
// - getSectorPrivilegesLabel -> apps/api/src/modules/people/sector/utils.ts
//
// Stock module:
// - getMeasureUnitLabel, getStockLevelLabel, getItemIssueTypeLabel -> packages/utils/src/item.ts
// - getMaintenanceStatusLabel, getMaintenanceFrequencyLabel -> packages/utils/src/maintenance.ts

// Note: These are already exported from their respective modules via index.ts

import {
  PPE_DELIVERY_STATUS_LABELS,
  PPE_TYPE_LABELS,
  PPE_SIZE_LABELS,
  WEEK_DAY_LABELS,
  MONTH_LABELS,
  MONTH_OCCURRENCE_LABELS,
  SCHEDULE_FREQUENCY_LABELS,
  SLEEVES_SIZE_LABELS,
  MASK_SIZE_LABELS,
  ACTIVITY_OPERATION_LABELS,
  ORDER_TRIGGER_TYPE_LABELS,
  ACTIVITY_REASON_LABELS,
  ACTIVITY_LEVEL_LABELS,
  USER_STATUS_LABELS,
  VACATION_STATUS_LABELS,
  VACATION_TYPE_LABELS,
  CHANGE_LOG_ENTITY_TYPE_LABELS,
  CHANGE_LOG_ACTION_LABELS,
  NOTIFICATION_ACTION_TYPE_LABELS,
} from '@constants';
import {
  PPE_DELIVERY_STATUS,
  PPE_TYPE,
  PPE_SIZE,
  WEEK_DAY,
  MONTH,
  MONTH_OCCURRENCE,
  SCHEDULE_FREQUENCY,
  SLEEVES_SIZE,
  MASK_SIZE,
  ACTIVITY_OPERATION,
  ORDER_TRIGGER_TYPE,
  ACTIVITY_REASON,
  ACTIVITY_LEVEL,
  USER_STATUS,
  VACATION_STATUS,
  VACATION_TYPE,
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_LOG_ACTION,
  NOTIFICATION_ACTION_TYPE,
} from '@constants';

export function getDayOfWeekLabel(day: WEEK_DAY): string {
  return WEEK_DAY_LABELS[day] || day;
}

export function getMonthLabel(month: MONTH): string {
  return MONTH_LABELS[month] || month;
}

export function getOccurrenceLabel(occurrence: MONTH_OCCURRENCE): string {
  return MONTH_OCCURRENCE_LABELS[occurrence] || occurrence;
}

export function getOrderFrequencyLabel(frequency: SCHEDULE_FREQUENCY): string {
  return SCHEDULE_FREQUENCY_LABELS[frequency] || frequency;
}

export function getActivityOperationLabel(operation: ACTIVITY_OPERATION): string {
  return ACTIVITY_OPERATION_LABELS[operation] || operation.toString();
}

export function getOrderTriggerTypeLabel(type: ORDER_TRIGGER_TYPE): string {
  return ORDER_TRIGGER_TYPE_LABELS[type] || type;
}

export function getActivityReasonLabel(reason: ACTIVITY_REASON): string {
  return ACTIVITY_REASON_LABELS[reason] || reason;
}

export function getActivityLevelLabel(level: ACTIVITY_LEVEL): string {
  return ACTIVITY_LEVEL_LABELS[level] || level;
}

/**
 * Get the display label for a user status
 * @param status - The user status enum value
 * @returns The localized label for the status
 */
export function getUserStatusLabel(status: USER_STATUS): string {
  return USER_STATUS_LABELS[status] || status;
}

/**
 * Get the display label for a vacation status
 * @param status - The vacation status enum value
 * @returns The localized label for the status
 */
export function getVacationStatusLabel(status: VACATION_STATUS): string {
  return VACATION_STATUS_LABELS[status] || status;
}

/**
 * Get the display label for a vacation type
 * @param type - The vacation type enum value
 * @returns The localized label for the type
 */
export function getVacationTypeLabel(type: VACATION_TYPE): string {
  return VACATION_TYPE_LABELS[type] || type;
}

/**
 * Get the display label for a change log entity type
 * @param entityType - The change log entity type enum value
 * @returns The localized label for the entity type
 */
export function getChangeLogEntityTypeLabel(entityType: CHANGE_LOG_ENTITY_TYPE): string {
  return CHANGE_LOG_ENTITY_TYPE_LABELS[entityType] || entityType;
}

/**
 * Get the display label for a change log action
 * @param action - The change log action enum value
 * @returns The localized label for the action
 */
export function getChangeLogActionLabel(action: CHANGE_LOG_ACTION): string {
  return CHANGE_LOG_ACTION_LABELS[action] || action;
}

/**
 * Get the display label for a notification action type
 * @param actionType - The notification action type enum value
 * @returns The localized label for the action type
 */
export function getNotificationActionTypeLabel(actionType: NOTIFICATION_ACTION_TYPE): string {
  return NOTIFICATION_ACTION_TYPE_LABELS[actionType] || actionType;
}

/**
 * Get the display label for a PPE delivery status
 * @param status - The PPE delivery status enum value
 * @returns The localized label for the status
 */
export function getPpeDeliveryStatusEnumLabel(status: PPE_DELIVERY_STATUS): string {
  return PPE_DELIVERY_STATUS_LABELS[status] || status;
}

/**
 * Get the display label for a PPE type
 * @param type - The PPE type enum value
 * @returns The localized label for the type
 */
export function getPpeTypeEnumLabel(type: PPE_TYPE): string {
  return PPE_TYPE_LABELS[type] || type;
}

/**
 * Get the display label for a PPE size
 * @param size - The PPE size enum value
 * @returns The localized label for the size
 */
export function getPpeSizeEnumLabel(size: PPE_SIZE): string {
  return PPE_SIZE_LABELS[size] || size;
}

/**
 * Get the display label for a sleeves size
 * @param size - The sleeves size enum value
 * @returns The localized label for the size
 */
export function getSleevesSizeLabel(size: SLEEVES_SIZE): string {
  return SLEEVES_SIZE_LABELS[size] || size;
}

/**
 * Get the display label for a mask size
 * @param size - The mask size enum value
 * @returns The localized label for the size
 */
export function getMaskSizeLabel(size: MASK_SIZE): string {
  return MASK_SIZE_LABELS[size] || size;
}
