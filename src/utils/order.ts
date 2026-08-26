import type { Order, OrderItem, OrderSchedule } from '@types';
import { ORDER_STATUS, SCHEDULE_FREQUENCY } from '@constants';
import { ORDER_STATUS_LABELS, SCHEDULE_FREQUENCY_LABELS } from '@constants';
import { ORDER_STATUS_ORDER } from '@constants';
import { dateUtils } from './date';
import { numberUtils } from './number';
import { startOfDay } from 'date-fns';
import type { OrderStatus } from '@prisma/client';

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
      // No direct CREATED → RECEIVED: a draft must be marked as done (fulfilled) before it
      // can be received. The service used to fake the intermediate fulfillment; it no longer does.
    ],
    [ORDER_STATUS.PARTIALLY_FULFILLED]: [
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.OVERDUE,
      ORDER_STATUS.PARTIALLY_RECEIVED,
      ORDER_STATUS.CANCELLED,
    ],
    [ORDER_STATUS.FULFILLED]: [
      ORDER_STATUS.PARTIALLY_RECEIVED,
      ORDER_STATUS.RECEIVED,
      ORDER_STATUS.OVERDUE,
      // A fulfilled-but-not-received order can still be cancelled (e.g. supplier backs
      // out). Safe: stock is only added on RECEIVED, so nothing to reverse here.
      ORDER_STATUS.CANCELLED,
    ],
    [ORDER_STATUS.OVERDUE]: [
      ORDER_STATUS.PARTIALLY_FULFILLED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.PARTIALLY_RECEIVED,
      ORDER_STATUS.RECEIVED,
      ORDER_STATUS.CANCELLED,
    ],
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
    [ORDER_STATUS.CREATED]: 'blue',
    [ORDER_STATUS.PARTIALLY_FULFILLED]: 'yellow',
    [ORDER_STATUS.FULFILLED]: 'green',
    [ORDER_STATUS.OVERDUE]: 'red',
    [ORDER_STATUS.PARTIALLY_RECEIVED]: 'orange',
    [ORDER_STATUS.RECEIVED]: 'green',
    [ORDER_STATUS.CANCELLED]: 'gray',
  };
  return colors[status] || 'default';
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
 * Calculate order item total with icms and ipi
 */
export function calculateOrderItemTotal(item: OrderItem): number {
  const subtotal = item.orderedQuantity * item.price;
  const icmsAmount = subtotal * (item.icms / 100);
  const ipiAmount = subtotal * (item.ipi / 100);
  return subtotal + icmsAmount + ipiAmount;
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
 * Calculate order subtotal (without ICMS/IPI)
 */
export function calculateOrderSubtotal(order: Order): number {
  if (!order.items || order.items.length === 0) return 0;

  return order.items.reduce((total, item) => {
    return total + item.orderedQuantity * item.price;
  }, 0);
}

/**
 * Calculate order total ICMS and IPI amount
 */
export function calculateOrderTax(order: Order): number {
  if (!order.items || order.items.length === 0) return 0;

  return order.items.reduce((total, item) => {
    const subtotal = item.orderedQuantity * item.price;
    const icmsAmount = subtotal * (item.icms / 100);
    const ipiAmount = subtotal * (item.ipi / 100);
    return total + icmsAmount + ipiAmount;
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
export function getOrderItemStatus(item: OrderItem): 'pending' | 'partial' | 'complete' {
  if (isOrderItemFullyReceived(item)) return 'complete';
  if (isOrderItemPartiallyReceived(item)) return 'partial';
  return 'pending';
}

/**
 * Format order display
 */
export function formatOrderDisplay(order: Order): string {
  const supplierName = order.supplier?.fantasyName || 'Fornecedor desconhecido';
  const status = getOrderStatusLabel(order.status);
  return `${supplierName} - ${status}`;
}

/**
 * Format order summary
 */
export function formatOrderSummary(order: Order): string {
  const description = order.description || 'Sem descrição';
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
  Object.values(ORDER_STATUS).forEach(status => {
    groups[status as ORDER_STATUS] = [];
  });

  // Group orders
  orders.forEach(order => {
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
      const supplierName = order.supplier?.fantasyName || 'Sem fornecedor';
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
export function sortOrdersByDate(orders: Order[], order: 'asc' | 'desc' = 'desc'): Order[] {
  return [...orders].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return order === 'asc' ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Sort orders by forecast date
 */
export function sortOrdersByForecast(orders: Order[], order: 'asc' | 'desc' = 'asc'): Order[] {
  return [...orders].sort((a, b) => {
    if (!a.forecast && !b.forecast) return 0;
    if (!a.forecast) return 1;
    if (!b.forecast) return -1;

    const dateA = new Date(a.forecast).getTime();
    const dateB = new Date(b.forecast).getTime();
    return order === 'asc' ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Filter orders by date range
 */
export function filterOrdersByDateRange(orders: Order[], startDate: Date, endDate: Date): Order[] {
  return orders.filter(order => {
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
  const status = schedule.isActive ? 'Ativo' : 'Inativo';

  return `${frequency} - ${itemCount} itens - ${status}`;
}

/**
 * Cálculo da próxima execução de um agendamento.
 *
 * O motor saiu daqui para `utils/schedule-recurrence.ts` quando as mensagens
 * recorrentes passaram a precisar da mesma matemática ("toda segunda", "primeira
 * segunda do mês", "todo dia 5"). O código foi MOVIDO, não reescrito: o
 * comportamento dos agendamentos de pedido é o mesmo de antes, e este reexport
 * mantém `calculateNextRunDate` importável de `@utils/order` como sempre foi.
 */
export { calculateNextRunDate } from './schedule-recurrence';

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
