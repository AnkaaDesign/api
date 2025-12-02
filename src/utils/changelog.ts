import {
  AUDIT_ACTION,
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_LOG_ACTION,
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_TRIGGERED_BY,
} from '@constants';

import { AUDIT_ACTION_LABELS, ENTITY_TYPE_LABELS, CHANGE_ACTION_LABELS } from '@constants';
import type {
  ChangeLogAction,
  ChangeLogEntityType,
  ChangeLogTriggeredByType,
} from '@prisma/client';

/**
 * Map CHANGE_LOG_ACTION enum to Prisma ChangeLogAction enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapChangeLogActionToPrisma(action: CHANGE_LOG_ACTION | string): ChangeLogAction {
  return action as ChangeLogAction;
}

/**
 * Map CHANGE_LOG_ENTITY_TYPE enum to Prisma ChangeLogEntityType enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapChangeLogEntityTypeToPrisma(
  entityType: CHANGE_LOG_ENTITY_TYPE | string,
): ChangeLogEntityType {
  return entityType as ChangeLogEntityType;
}

/**
 * Map CHANGE_TRIGGERED_BY enum to Prisma ChangeTriggeredBy enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapChangeLogTriggeredByTypeToPrisma(
  triggeredBy: CHANGE_TRIGGERED_BY | string,
): ChangeLogTriggeredByType {
  return triggeredBy as ChangeLogTriggeredByType;
}

export function getAuditActionLabel(action: AUDIT_ACTION): string {
  return AUDIT_ACTION_LABELS[action] || action;
}

export function getEntityTypeLabel(type: ENTITY_TYPE): string {
  return ENTITY_TYPE_LABELS[type] || type;
}

export function getChangeActionLabel(action: CHANGE_ACTION): string {
  return CHANGE_ACTION_LABELS[action] || action;
}

export const validateEntityType = (entityType: string): boolean => {
  const validEntityTypes = [
    'Activity',
    'Order',
    'OrderItem',
    'Item',
    'User',
    'Task',
    'Supplier',
    'Customer',
    'Commission',
    'Vacation',
    'PpeRequest',
    'ServiceOrder',
    'Borrow',
    'Warning',
    'ChangeLog',
    'Holiday',
    'Position',
    'Sector',
    'ItemBrand',
    'ItemCategory',
    'Paint',
  ];
  return validEntityTypes.includes(entityType);
};

export const validateAction = (action: string): boolean => {
  const validActions = [
    'CREATE',
    'UPDATE',
    'DELETE',
    'STATUS_CHANGE',
    'QUANTITY_CHANGE',
    'RECEIVE',
    'APPROVE',
    'REJECT',
    'ASSIGN',
    'UNASSIGN',
    'ACTIVATE',
    'DEACTIVATE',
    'LOGIN',
    'LOGOUT',
    'PASSWORD_CHANGE',
    'PERMISSION_CHANGE',
  ];
  return validActions.includes(action);
};
