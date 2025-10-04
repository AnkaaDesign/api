import type { Order, OrderItem, OrderSchedule } from '@types';
import type { WeeklyScheduleConfig, MonthlyScheduleConfig, YearlyScheduleConfig } from '@types';
import { ORDER_STATUS, SCHEDULE_FREQUENCY, WEEK_DAY, MONTH, MONTH_OCCURRENCE } from '@constants';
import { ORDER_STATUS_LABELS, SCHEDULE_FREQUENCY_LABELS } from '@constants';
import { ORDER_STATUS_ORDER } from '@constants';
import { addDays, addMonths, addWeeks, addYears, dateUtils } from "./date";
import { numberUtils } from "./number";
import { startOfDay, getDay, setDate, setMonth } from "date-fns";
import type { OrderStatus } from "@prisma/client";

/**
 * Map ORDER_STATUS enum to Prisma OrderStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapOrderStatusToPrisma(status: ORDER_STATUS | string): OrderStatus {
  return status as OrderStatus;
}

/**
 * Get numeric order for status (for sorting and workflow)
 */
export function getStatusOrder(status: ORDER_STATUS): number {
  return ORDER_STATUS_ORDER[status] || 1;
}

/**
 * Check if status transition is valid
 */
export function isValidStatusTransition(fromStatus: ORDER_STATUS, toStatus: ORDER_STATUS): boolean {
  const validTransitions: Record<ORDER_STATUS, ORDER_STATUS[]> = {
    [ORDER_STATUS.CREATED]: [
      ORDER_STATUS.PARTIALLY_FULFILLED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.OVERDUE,
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.RECEIVED, // Allow direct transition (handled by service to go through FULFILLED)
    ],
    [ORDER_STATUS.PARTIALLY_FULFILLED]: [ORDER_STATUS.FULFILLED, ORDER_STATUS.OVERDUE, ORDER_STATUS.PARTIALLY_RECEIVED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.FULFILLED]: [ORDER_STATUS.PARTIALLY_RECEIVED, ORDER_STATUS.RECEIVED, ORDER_STATUS.OVERDUE],
    [ORDER_STATUS.OVERDUE]: [ORDER_STATUS.PARTIALLY_FULFILLED, ORDER_STATUS.FULFILLED, ORDER_STATUS.PARTIALLY_RECEIVED, ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.PARTIALLY_RECEIVED]: [ORDER_STATUS.RECEIVED],
    [ORDER_STATUS.RECEIVED]: [], // Final state
    [ORDER_STATUS.CANCELLED]: [], // Final state
  };

  return validTransitions[fromStatus]?.includes(toStatus) || false;
}

/**
 * Get order status label
 */
export function getOrderStatusLabel(status: ORDER_STATUS): string {
  return ORDER_STATUS_LABELS[status] || status;
}

/**
 * Get order status color
 */
export function getOrderStatusColor(status: ORDER_STATUS): string {
  const colors: Record<ORDER_STATUS, string> = {
    [ORDER_STATUS.CREATED]: "blue",
    [ORDER_STATUS.PARTIALLY_FULFILLED]: "yellow",
    [ORDER_STATUS.FULFILLED]: "green",
    [ORDER_STATUS.OVERDUE]: "red",
    [ORDER_STATUS.PARTIALLY_RECEIVED]: "orange",
    [ORDER_STATUS.RECEIVED]: "green",
    [ORDER_STATUS.CANCELLED]: "gray",
  };
  return colors[status] || "default";
}

/**
 * Check if order is active
 */
export function isOrderActive(order: Order): boolean {
  return ![ORDER_STATUS.RECEIVED, ORDER_STATUS.CANCELLED].includes(order.status);
}

/**
 * Check if order is overdue
 */
export function isOrderOverdue(order: Order): boolean {
  if (order.status === ORDER_STATUS.OVERDUE) return true;

  if (order.forecast && isOrderActive(order)) {
    return new Date() > new Date(order.forecast);
  }

  return false;
}

/**
 * Check if order is completed
 */
export function isOrderCompleted(order: Order): boolean {
  return order.status === ORDER_STATUS.RECEIVED;
}

/**
 * Calculate order item total with tax
 */
export function calculateOrderItemTotal(item: OrderItem): number {
  const subtotal = item.orderedQuantity * item.price;
  const taxAmount = subtotal * (item.tax / 100);
  return subtotal + taxAmount;
}

/**
 * Calculate order total value
 */
export function calculateOrderTotal(order: Order): number {
  if (!order.items || order.items.length === 0) return 0;

  return order.items.reduce((total, item) => {
    return total + calculateOrderItemTotal(item);
  }, 0);
}

/**
 * Calculate order subtotal (without tax)
 */
export function calculateOrderSubtotal(order: Order): number {
  if (!order.items || order.items.length === 0) return 0;

  return order.items.reduce((total, item) => {
    return total + item.orderedQuantity * item.price;
  }, 0);
}

/**
 * Calculate order tax amount
 */
export function calculateOrderTax(order: Order): number {
  if (!order.items || order.items.length === 0) return 0;

  return order.items.reduce((total, item) => {
    const subtotal = item.orderedQuantity * item.price;
    const taxAmount = subtotal * (item.tax / 100);
    return total + taxAmount;
  }, 0);
}

/**
 * Get order fulfillment percentage
 */
export function getOrderFulfillmentPercentage(order: Order): number {
  if (!order.items || order.items.length === 0) return 0;

  const totalQuantity = order.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
  const receivedQuantity = order.items.reduce((sum, item) => sum + item.receivedQuantity, 0);

  if (totalQuantity === 0) return 0;
  return Math.round((receivedQuantity / totalQuantity) * 100);
}

/**
 * Check if order item is fully received
 */
export function isOrderItemFullyReceived(item: OrderItem): boolean {
  return item.receivedQuantity >= item.orderedQuantity;
}

/**
 * Check if order item is partially received
 */
export function isOrderItemPartiallyReceived(item: OrderItem): boolean {
  return item.receivedQuantity > 0 && item.receivedQuantity < item.orderedQuantity;
}

/**
 * Get order item status
 */
export function getOrderItemStatus(item: OrderItem): "pending" | "partial" | "complete" {
  if (isOrderItemFullyReceived(item)) return "complete";
  if (isOrderItemPartiallyReceived(item)) return "partial";
  return "pending";
}

/**
 * Format order display
 */
export function formatOrderDisplay(order: Order): string {
  const supplierName = order.supplier?.fantasyName || "Fornecedor desconhecido";
  const status = getOrderStatusLabel(order.status);
  return `${supplierName} - ${status}`;
}

/**
 * Format order summary
 */
export function formatOrderSummary(order: Order): string {
  const description = order.description || "Sem descrição";
  const status = getOrderStatusLabel(order.status);
  const total = formatOrderTotal(order);

  return `${description} - ${status} - ${total}`;
}

/**
 * Format order total
 */
export function formatOrderTotal(order: Order): string {
  const total = calculateOrderTotal(order);
  return numberUtils.formatCurrency(total);
}

/**
 * Get days until forecast
 */
export function getDaysUntilForecast(order: Order): number | null {
  if (!order.forecast) return null;
  if (!isOrderActive(order)) return null;

  return dateUtils.getDaysBetween(new Date(), order.forecast);
}

/**
 * Group orders by status
 */
export function groupOrdersByStatus(orders: Order[]): Record<ORDER_STATUS, Order[]> {
  const groups = {} as Record<ORDER_STATUS, Order[]>;

  // Initialize all statuses
  Object.values(ORDER_STATUS).forEach((status) => {
    groups[status as ORDER_STATUS] = [];
  });

  // Group orders
  orders.forEach((order) => {
    groups[order.status].push(order);
  });

  return groups;
}

/**
 * Group orders by supplier
 */
export function groupOrdersBySupplier(orders: Order[]): Record<string, Order[]> {
  return orders.reduce(
    (groups, order) => {
      const supplierName = order.supplier?.fantasyName || "Sem fornecedor";
      if (!groups[supplierName]) {
        groups[supplierName] = [];
      }
      groups[supplierName].push(order);
      return groups;
    },
    {} as Record<string, Order[]>,
  );
}

/**
 * Sort orders by date
 */
export function sortOrdersByDate(orders: Order[], order: "asc" | "desc" = "desc"): Order[] {
  return [...orders].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return order === "asc" ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Sort orders by forecast date
 */
export function sortOrdersByForecast(orders: Order[], order: "asc" | "desc" = "asc"): Order[] {
  return [...orders].sort((a, b) => {
    if (!a.forecast && !b.forecast) return 0;
    if (!a.forecast) return 1;
    if (!b.forecast) return -1;

    const dateA = new Date(a.forecast).getTime();
    const dateB = new Date(b.forecast).getTime();
    return order === "asc" ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Filter orders by date range
 */
export function filterOrdersByDateRange(orders: Order[], startDate: Date, endDate: Date): Order[] {
  return orders.filter((order) => {
    const orderDate = new Date(order.createdAt);
    return orderDate >= startDate && orderDate <= endDate;
  });
}

/**
 * Filter overdue orders
 */
export function filterOverdueOrders(orders: Order[]): Order[] {
  return orders.filter(isOrderOverdue);
}

/**
 * Calculate order statistics
 */
export function calculateOrderStats(orders: Order[]) {
  const total = orders.length;
  const byStatus = groupOrdersByStatus(orders);

  const statusCounts = Object.entries(byStatus).reduce(
    (acc, [status, orderList]) => {
      acc[status as ORDER_STATUS] = orderList.length;
      return acc;
    },
    {} as Record<ORDER_STATUS, number>,
  );

  const active = orders.filter(isOrderActive).length;
  const overdue = orders.filter(isOrderOverdue).length;
  const completed = orders.filter(isOrderCompleted).length;

  const totalValue = orders.reduce((sum, order) => sum + calculateOrderTotal(order), 0);
  const totalItems = orders.reduce((sum, order) => sum + (order.items?.length || 0), 0);

  const averageFulfillment =
    orders.reduce((sum, order) => {
      return sum + getOrderFulfillmentPercentage(order);
    }, 0) / (total || 1);

  return {
    total,
    statusCounts,
    active,
    overdue,
    completed,
    totalValue,
    totalItems,
    averageFulfillment: Math.round(averageFulfillment),
  };
}

// =====================
// Order Schedule Functions
// =====================

/**
 * Get frequency label
 */
export function getFrequencyLabel(frequency: SCHEDULE_FREQUENCY): string {
  return SCHEDULE_FREQUENCY_LABELS[frequency] || frequency;
}

/**
 * Check if schedule is active
 */
export function isScheduleActive(schedule: OrderSchedule): boolean {
  return schedule.isActive === true;
}

/**
 * Check if schedule is due
 */
export function isScheduleDue(schedule: OrderSchedule): boolean {
  if (!schedule.isActive) return false;
  if (!schedule.nextRun) return true;

  return new Date() >= new Date(schedule.nextRun);
}

/**
 * Get days until next run
 */
export function getDaysUntilNextRun(schedule: OrderSchedule): number | null {
  if (!schedule.nextRun) return null;
  if (!schedule.isActive) return null;

  return dateUtils.getDaysBetween(new Date(), schedule.nextRun);
}

/**
 * Format schedule summary
 */
export function formatScheduleSummary(schedule: OrderSchedule): string {
  const frequency = getFrequencyLabel(schedule.frequency);
  const itemCount = schedule.items.length;
  const status = schedule.isActive ? "Ativo" : "Inativo";

  return `${frequency} - ${itemCount} itens - ${status}`;
}

/**
 * Calculate next run date for a schedule
 */
export function calculateNextRunDate(
  schedule: OrderSchedule & {
    weeklyConfig?: WeeklyScheduleConfig | null;
    monthlyConfig?: MonthlyScheduleConfig | null;
    yearlyConfig?: YearlyScheduleConfig | null;
  },
  fromDate: Date = new Date(),
): Date | null {
  if (!schedule.isActive) return null;

  const baseDate = startOfDay(fromDate);

  switch (schedule.frequency) {
    case SCHEDULE_FREQUENCY.ONCE:
      // One-time schedules don't have a next run after execution
      return schedule.lastRun ? null : baseDate;

    case SCHEDULE_FREQUENCY.DAILY:
      return calculateNextDailyRun(baseDate, schedule.frequencyCount);

    case SCHEDULE_FREQUENCY.WEEKLY:
      return calculateNextWeeklyRun(baseDate, schedule.weeklyConfig, schedule.frequencyCount);

    case SCHEDULE_FREQUENCY.MONTHLY:
      return calculateNextMonthlyRun(baseDate, schedule.monthlyConfig, schedule.frequencyCount);

    case SCHEDULE_FREQUENCY.ANNUAL:
      return calculateNextYearlyRun(baseDate, schedule.yearlyConfig, schedule.frequencyCount);

    default:
      return null;
  }
}

/**
 * Calculate next daily run
 */
function calculateNextDailyRun(fromDate: Date, frequencyCount: number = 1): Date | null {
  return addDays(fromDate, frequencyCount);
}

/**
 * Calculate next weekly run
 */
function calculateNextWeeklyRun(fromDate: Date, weeklyConfig?: WeeklyScheduleConfig | null, frequencyCount: number = 1): Date | null {
  if (!weeklyConfig) return null;

  const weekDays = [
    { day: 0, enabled: weeklyConfig.sunday },
    { day: 1, enabled: weeklyConfig.monday },
    { day: 2, enabled: weeklyConfig.tuesday },
    { day: 3, enabled: weeklyConfig.wednesday },
    { day: 4, enabled: weeklyConfig.thursday },
    { day: 5, enabled: weeklyConfig.friday },
    { day: 6, enabled: weeklyConfig.saturday },
  ];

  const enabledDays = weekDays.filter((d) => d.enabled).map((d) => d.day);
  if (enabledDays.length === 0) return null;

  let nextDate = new Date(fromDate);
  const currentDayOfWeek = getDay(nextDate);

  // Find next enabled day in current week
  for (const dayOfWeek of enabledDays) {
    if (dayOfWeek > currentDayOfWeek) {
      return addDays(nextDate, dayOfWeek - currentDayOfWeek);
    }
  }

  // If no enabled days left in current week, go to next week cycle
  nextDate = addWeeks(nextDate, frequencyCount);
  const firstEnabledDay = Math.min(...enabledDays);
  return addDays(nextDate, firstEnabledDay - getDay(nextDate));
}

/**
 * Calculate next monthly run
 */
function calculateNextMonthlyRun(fromDate: Date, monthlyConfig?: MonthlyScheduleConfig | null, frequencyCount: number = 1): Date | null {
  if (!monthlyConfig) return null;

  let nextDate = new Date(fromDate);

  if (monthlyConfig.dayOfMonth !== null && monthlyConfig.dayOfMonth !== undefined) {
    // Fixed day of month
    const targetDay = monthlyConfig.dayOfMonth;

    if (fromDate.getDate() < targetDay) {
      // Target day hasn't passed this month
      nextDate = setDate(nextDate, targetDay);
    } else {
      // Move to next month cycle
      nextDate = addMonths(nextDate, frequencyCount);
      nextDate = setDate(nextDate, targetDay);
    }

    // Handle months with fewer days
    while (nextDate.getDate() !== targetDay) {
      nextDate = setDate(nextDate, 0); // Last day of previous month
    }

    return nextDate;
  } else if (monthlyConfig.occurrence && monthlyConfig.dayOfWeek) {
    // Occurrence pattern (e.g., "first Monday")
    return calculateOccurrenceDate(nextDate, monthlyConfig.occurrence, monthlyConfig.dayOfWeek, frequencyCount);
  }

  return null;
}

/**
 * Calculate next yearly run
 */
function calculateNextYearlyRun(fromDate: Date, yearlyConfig?: YearlyScheduleConfig | null, frequencyCount: number = 1): Date | null {
  if (!yearlyConfig || !yearlyConfig.month) return null;

  let nextDate = new Date(fromDate);
  const targetMonth = getMonthNumber(yearlyConfig.month);

  // Set to target month
  nextDate = setMonth(nextDate, targetMonth);

  if (yearlyConfig.dayOfMonth !== null && yearlyConfig.dayOfMonth !== undefined) {
    // Fixed day of month
    nextDate = setDate(nextDate, yearlyConfig.dayOfMonth);

    // If date has passed this year, move to next year cycle
    if (nextDate <= fromDate) {
      nextDate = addYears(nextDate, frequencyCount);
    }
  } else if (yearlyConfig.occurrence && yearlyConfig.dayOfWeek) {
    // Occurrence pattern
    nextDate = calculateOccurrenceDate(nextDate, yearlyConfig.occurrence, yearlyConfig.dayOfWeek, 0);

    // If date has passed this year, move to next year cycle
    if (nextDate <= fromDate) {
      nextDate = addYears(nextDate, frequencyCount);
      nextDate = setMonth(nextDate, targetMonth);
      nextDate = calculateOccurrenceDate(nextDate, yearlyConfig.occurrence, yearlyConfig.dayOfWeek, 0);
    }
  }

  return nextDate;
}

/**
 * Calculate date for occurrence pattern (e.g., "first Monday of month")
 */
function calculateOccurrenceDate(baseDate: Date, occurrence: string, dayOfWeek: string, monthsToAdd: number = 0): Date {
  let targetDate = new Date(baseDate);

  if (monthsToAdd > 0) {
    targetDate = addMonths(targetDate, monthsToAdd);
  }

  // Start from first day of month
  targetDate = setDate(targetDate, 1);

  const targetDayNumber = getDayOfWeekNumber(dayOfWeek);
  const occurrenceNumber = getOccurrenceNumber(occurrence);

  // Find first occurrence of target day
  while (getDay(targetDate) !== targetDayNumber) {
    targetDate = addDays(targetDate, 1);
  }

  // Move to the nth occurrence
  if (occurrenceNumber === -1) {
    // Last occurrence - find all occurrences in month
    const occurrences: Date[] = [new Date(targetDate)];
    let nextOccurrence = addWeeks(targetDate, 1);

    while (nextOccurrence.getMonth() === targetDate.getMonth()) {
      occurrences.push(new Date(nextOccurrence));
      nextOccurrence = addWeeks(nextOccurrence, 1);
    }

    return occurrences[occurrences.length - 1];
  } else {
    // Specific occurrence (1st, 2nd, 3rd, 4th)
    return addWeeks(targetDate, occurrenceNumber - 1);
  }
}

/**
 * Get day of week number from enum
 */
function getDayOfWeekNumber(dayOfWeek: string): number {
  const dayMap: Record<string, number> = {
    [WEEK_DAY.SUNDAY]: 0,
    [WEEK_DAY.MONDAY]: 1,
    [WEEK_DAY.TUESDAY]: 2,
    [WEEK_DAY.WEDNESDAY]: 3,
    [WEEK_DAY.THURSDAY]: 4,
    [WEEK_DAY.FRIDAY]: 5,
    [WEEK_DAY.SATURDAY]: 6,
  };
  return dayMap[dayOfWeek] ?? 1;
}

/**
 * Get occurrence number from enum
 */
function getOccurrenceNumber(occurrence: string): number {
  const occurrenceMap: Record<string, number> = {
    [MONTH_OCCURRENCE.FIRST]: 1,
    [MONTH_OCCURRENCE.SECOND]: 2,
    [MONTH_OCCURRENCE.THIRD]: 3,
    [MONTH_OCCURRENCE.FOURTH]: 4,
    [MONTH_OCCURRENCE.LAST]: -1,
  };
  return occurrenceMap[occurrence] ?? 1;
}

/**
 * Get month number from enum
 */
function getMonthNumber(month: string): number {
  const monthMap: Record<string, number> = {
    [MONTH.JANUARY]: 0,
    [MONTH.FEBRUARY]: 1,
    [MONTH.MARCH]: 2,
    [MONTH.APRIL]: 3,
    [MONTH.MAY]: 4,
    [MONTH.JUNE]: 5,
    [MONTH.JULY]: 6,
    [MONTH.AUGUST]: 7,
    [MONTH.SEPTEMBER]: 8,
    [MONTH.OCTOBER]: 9,
    [MONTH.NOVEMBER]: 10,
    [MONTH.DECEMBER]: 11,
  };
  return monthMap[month] ?? 0;
}

/**
 * Check if schedule should run today
 */
export function shouldRunToday(schedule: OrderSchedule): boolean {
  if (!schedule.isActive) return false;
  if (!schedule.nextRun) return true;

  const today = startOfDay(new Date());
  const nextRun = startOfDay(new Date(schedule.nextRun));

  return nextRun <= today;
}

// formatScheduleDescription moved to schedule.ts to avoid duplicate exports
