/**
 * Type definitions for notification templates
 *
 * This file provides type-safe data structures for all notification templates.
 */

import {
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_ACTION_TYPE,
  NOTIFICATION_CHANNEL,
  TASK_STATUS,
  ORDER_STATUS,
  COMMISSION_STATUS,
} from '../../../../constants/enums';

// =====================
// Base Template Types
// =====================

export interface NotificationTemplate {
  title: (data: any) => string;
  body: (data: any) => string;
  importance: NOTIFICATION_IMPORTANCE;
  actionType: NOTIFICATION_ACTION_TYPE;
  channels?: NOTIFICATION_CHANNEL[];
}

export interface WhatsAppTemplate {
  (data: any): string;
}

export interface EmailTemplate {
  subject: (data: any) => string;
  body: (data: any) => string;
  html?: (data: any) => string;
}

export interface RenderedNotification {
  title: string;
  body: string;
  importance: NOTIFICATION_IMPORTANCE;
  actionType: NOTIFICATION_ACTION_TYPE;
  channels?: NOTIFICATION_CHANNEL[];
}

export interface RenderedEmail {
  subject: string;
  body: string;
  html?: string;
}

// =====================
// Template Data Types
// =====================

// Task Template Data Types
export interface TaskCreatedData {
  taskName: string;
  sectorName: string;
  serialNumber?: string;
  createdBy?: string;
  url?: string;
}

export interface TaskStatusData {
  taskName: string;
  oldStatus: string;
  newStatus: string;
  changedBy?: string;
  serialNumber?: string;
  url?: string;
}

export interface TaskDeadlineData {
  taskName: string;
  daysRemaining: number;
  serialNumber?: string;
  url?: string;
}

export interface TaskOverdueData {
  taskName: string;
  daysOverdue: number;
  serialNumber?: string;
  url?: string;
}

export interface TaskFieldUpdateData {
  taskName: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  changedBy?: string;
  url?: string;
}

export interface TaskSectorData {
  taskName: string;
  oldSector: string;
  newSector: string;
  changedBy?: string;
  url?: string;
}

export interface TaskArtworkData {
  taskName: string;
  fileCount?: number;
  changedBy?: string;
  url?: string;
}

export interface TaskBudgetData {
  taskName: string;
  budgetValue?: string;
  changedBy?: string;
  approvedBy?: string;
  url?: string;
}

export interface TaskInvoiceData {
  taskName: string;
  invoiceNumber?: string;
  changedBy?: string;
  url?: string;
}

export interface TaskReceiptData {
  taskName: string;
  receiptValue?: string;
  url?: string;
}

export interface TaskNegotiationData {
  taskName: string;
  newContact: string;
  changedBy?: string;
  url?: string;
}

export interface TaskCommissionData {
  taskName: string;
  oldStatus: string;
  newStatus: string;
  url?: string;
}

export interface TaskPriorityData {
  taskName: string;
  oldPriority: string;
  newPriority: string;
  changedBy?: string;
  url?: string;
}

export interface TaskCompletedData {
  taskName: string;
  completedBy?: string;
  url?: string;
}

export interface TaskCancelledData {
  taskName: string;
  cancelledBy?: string;
  reason?: string;
  url?: string;
}

export interface TaskCommentData {
  taskName: string;
  userName: string;
  commentPreview: string;
  url?: string;
}

// Order Template Data Types
export interface OrderCreatedData {
  orderNumber: string;
  supplierName: string;
  totalValue?: string;
  createdBy?: string;
  url?: string;
}

export interface OrderStatusData {
  orderNumber: string;
  oldStatus: string;
  newStatus: string;
  changedBy?: string;
  url?: string;
}

export interface OrderOverdueData {
  orderNumber: string;
  supplierName: string;
  daysOverdue: number;
  url?: string;
}

export interface OrderReceivedData {
  orderNumber: string;
  receivedBy?: string;
  percentage?: string;
  url?: string;
}

export interface OrderItemReceivedData {
  orderNumber: string;
  itemName: string;
  quantity?: number;
  receivedBy?: string;
  url?: string;
}

export interface OrderCancelledData {
  orderNumber: string;
  cancelledBy?: string;
  reason?: string;
  url?: string;
}

export interface OrderDeadlineData {
  orderNumber: string;
  daysRemaining: number;
  url?: string;
}

// Stock Template Data Types
export interface StockLevelData {
  itemName: string;
  currentQuantity: number;
  reorderPoint?: number;
  maxQuantity?: number;
  url?: string;
}

export interface StockMovementData {
  itemName: string;
  operation: string;
  quantity: number;
  userName?: string;
  url?: string;
}

// PPE Template Data Types
export interface PPERequestCreatedData {
  userName: string;
  itemCount?: number;
  url?: string;
}

export interface PPERequestStatusData {
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  url?: string;
}

export interface PPEDeliveryData {
  userName?: string;
  location?: string;
  deliveredBy?: string;
  url?: string;
}

export interface PPEExpirationData {
  itemName: string;
  daysRemaining?: number;
  url?: string;
}

// Vacation Template Data Types
export interface VacationRequestCreatedData {
  userName: string;
  startDate: string;
  endDate: string;
  days: number;
  url?: string;
}

export interface VacationRequestStatusData {
  startDate: string;
  endDate: string;
  days?: number;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  url?: string;
}

export interface VacationReminderData {
  daysRemaining: number;
  startDate?: string;
  endDate?: string;
  url?: string;
}

// System Template Data Types
export interface SystemMaintenanceData {
  startDate: string;
  startTime: string;
  duration: string;
  minutesRemaining?: number;
}

export interface SystemAlertData {
  message: string;
  errorMessage?: string;
}

export interface SystemAnnouncementData {
  title: string;
  message: string;
}

export interface SystemUpdateData {
  version: string;
  description?: string;
}

// User Template Data Types
export interface UserBirthdayData {
  userName: string;
}

export interface UserAnniversaryData {
  userName: string;
  years: number;
}

export interface UserProfileData {
  // No specific data needed
}

export interface UserPasswordData {
  // No specific data needed
}

export interface UserRoleData {
  oldRole: string;
  newRole: string;
  changedBy?: string;
  url?: string;
}

// Report Template Data Types
export interface ReportGeneratedData {
  reportName: string;
  url?: string;
}

export interface ReportFailedData {
  reportName: string;
  url?: string;
}

// =====================
// Template Key Types
// =====================

export type TaskTemplateKey =
  | 'task.created'
  | 'task.status'
  | 'task.deadline'
  | 'task.deadline.critical'
  | 'task.overdue'
  | 'task.term'
  | 'task.forecastDate'
  | 'task.sector'
  | 'task.artwork.added'
  | 'task.artwork.updated'
  | 'task.artwork.removed'
  | 'task.budget.added'
  | 'task.budget.updated'
  | 'task.budget.approved'
  | 'task.invoice.added'
  | 'task.invoice.updated'
  | 'task.receipt.added'
  | 'task.negotiatingWith'
  | 'task.commission.updated'
  | 'task.priority.changed'
  | 'task.completed'
  | 'task.cancelled'
  | 'task.comment.added';

export type OrderTemplateKey =
  | 'order.created'
  | 'order.status'
  | 'order.overdue'
  | 'order.received'
  | 'order.partially_received'
  | 'order.item.received'
  | 'order.cancelled'
  | 'order.deadline.approaching';

export type StockTemplateKey =
  | 'stock.low'
  | 'stock.critical'
  | 'stock.out'
  | 'stock.negative'
  | 'stock.reorder'
  | 'stock.overstocked'
  | 'stock.movement.large';

export type PPETemplateKey =
  | 'ppe.request.created'
  | 'ppe.request.approved'
  | 'ppe.request.rejected'
  | 'ppe.delivery.ready'
  | 'ppe.delivery.completed'
  | 'ppe.expiring.soon'
  | 'ppe.expired';

export type VacationTemplateKey =
  | 'vacation.request.created'
  | 'vacation.request.approved'
  | 'vacation.request.rejected'
  | 'vacation.starting.soon'
  | 'vacation.started'
  | 'vacation.ending.soon';

export type SystemTemplateKey =
  | 'system.maintenance.scheduled'
  | 'system.maintenance.starting'
  | 'system.maintenance.completed'
  | 'system.warning'
  | 'system.error'
  | 'system.announcement'
  | 'system.update.available';

export type UserTemplateKey =
  | 'user.birthday'
  | 'user.anniversary'
  | 'user.profile.updated'
  | 'user.password.changed'
  | 'user.role.changed';

export type ReportTemplateKey = 'report.generated' | 'report.failed';

export type TemplateKey =
  | TaskTemplateKey
  | OrderTemplateKey
  | StockTemplateKey
  | PPETemplateKey
  | VacationTemplateKey
  | SystemTemplateKey
  | UserTemplateKey
  | ReportTemplateKey;

// =====================
// Template Data Union Types
// =====================

export type TemplateData =
  | TaskCreatedData
  | TaskStatusData
  | TaskDeadlineData
  | TaskOverdueData
  | TaskFieldUpdateData
  | TaskSectorData
  | TaskArtworkData
  | TaskBudgetData
  | TaskInvoiceData
  | TaskReceiptData
  | TaskNegotiationData
  | TaskCommissionData
  | TaskPriorityData
  | TaskCompletedData
  | TaskCancelledData
  | TaskCommentData
  | OrderCreatedData
  | OrderStatusData
  | OrderOverdueData
  | OrderReceivedData
  | OrderItemReceivedData
  | OrderCancelledData
  | OrderDeadlineData
  | StockLevelData
  | StockMovementData
  | PPERequestCreatedData
  | PPERequestStatusData
  | PPEDeliveryData
  | PPEExpirationData
  | VacationRequestCreatedData
  | VacationRequestStatusData
  | VacationReminderData
  | SystemMaintenanceData
  | SystemAlertData
  | SystemAnnouncementData
  | SystemUpdateData
  | UserBirthdayData
  | UserAnniversaryData
  | UserProfileData
  | UserPasswordData
  | UserRoleData
  | ReportGeneratedData
  | ReportFailedData;

// =====================
// Template Metadata
// =====================

export interface TemplateMetadata {
  importance: NOTIFICATION_IMPORTANCE;
  actionType: NOTIFICATION_ACTION_TYPE;
  channels?: NOTIFICATION_CHANNEL[];
}

// =====================
// Type Guards
// =====================

export function isTaskTemplate(key: string): key is TaskTemplateKey {
  return key.startsWith('task.');
}

export function isOrderTemplate(key: string): key is OrderTemplateKey {
  return key.startsWith('order.');
}

export function isStockTemplate(key: string): key is StockTemplateKey {
  return key.startsWith('stock.');
}

export function isPPETemplate(key: string): key is PPETemplateKey {
  return key.startsWith('ppe.');
}

export function isVacationTemplate(key: string): key is VacationTemplateKey {
  return key.startsWith('vacation.');
}

export function isSystemTemplate(key: string): key is SystemTemplateKey {
  return key.startsWith('system.');
}

export function isUserTemplate(key: string): key is UserTemplateKey {
  return key.startsWith('user.');
}

export function isReportTemplate(key: string): key is ReportTemplateKey {
  return key.startsWith('report.');
}

// =====================
// Helper Types
// =====================

/**
 * Extract data type for a specific template key
 */
export type TemplateDataFor<K extends TemplateKey> = K extends 'task.created'
  ? TaskCreatedData
  : K extends 'task.status'
    ? TaskStatusData
    : K extends 'task.deadline' | 'task.deadline.critical'
      ? TaskDeadlineData
      : K extends 'task.overdue'
        ? TaskOverdueData
        : K extends 'order.created'
          ? OrderCreatedData
          : K extends 'stock.low' | 'stock.critical' | 'stock.out'
            ? StockLevelData
            : TemplateData; // Fallback to union type

/**
 * Common optional fields for URLs
 */
export interface WithURL {
  url?: string;
}

/**
 * Common optional fields for user attribution
 */
export interface WithUserAttribution {
  changedBy?: string;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Common optional fields for date/time
 */
export interface WithDateTime {
  date?: string;
  time?: string;
  timestamp?: Date;
}
