import type { Borrow } from '@types';
import { BORROW_STATUS_LABELS } from '@constants';
import { BORROW_STATUS } from '@constants';
import { dateUtils } from './date';

/**
 * Get borrow status
 */
export function getBorrowStatus(borrow: Borrow): 'active' | 'returned' {
  return borrow.returnedAt ? 'returned' : 'active';
}

/**
 * Get display label for borrow status from enum
 */
export function getBorrowStatusLabel(status: BORROW_STATUS): string {
  return BORROW_STATUS_LABELS[status] || status;
}

/**
 * Get display label for borrow status (legacy)
 * @deprecated Use getBorrowStatusLabel with BORROW_STATUS enum instead
 */
export function getBorrowStatusLabelLegacy(status: 'active' | 'returned'): string {
  const labels = {
    active: 'Em Uso',
    returned: 'Devolvido',
  };
  return labels[status] || status;
}

/**
 * Get color for borrow status
 */
export function getBorrowStatusColor(status: 'active' | 'returned'): string {
  const colors = {
    active: 'blue',
    returned: 'green',
  };
  return colors[status] || 'gray';
}

/**
 * Calculate borrow duration in days
 */
export function getBorrowDuration(borrow: Borrow, endDate?: Date): number {
  const end = endDate || borrow.returnedAt || new Date();
  return dateUtils.getDaysBetween(borrow.createdAt, end);
}

/**
 * Get days since borrow started
 */
export function getBorrowDaysAgo(borrow: Borrow): number {
  return dateUtils.getDaysAgo(borrow.createdAt);
}

/**
 * Check if borrow is active
 */
export function isBorrowActive(borrow: Borrow): boolean {
  return borrow.returnedAt === null;
}

/**
 * Check if borrow is returned
 */
export function isBorrowReturned(borrow: Borrow): boolean {
  return borrow.returnedAt !== null;
}

/**
 * Format borrow details for display
 */
export function formatBorrowDetails(borrow: Borrow): string {
  const borrowDate = dateUtils.formatDate(borrow.createdAt, 'dd/MM/yyyy');
  const duration = getBorrowDaysAgo(borrow);
  return `Emprestado em ${borrowDate} (${duration} dias atrás)`;
}

/**
 * Get borrow summary text
 */
export function getBorrowSummary(borrow: Borrow): string {
  const itemName = borrow.item?.name || 'Item desconhecido';
  const userName = borrow.user?.name || 'Usuário desconhecido';
  const quantity = borrow.quantity;

  return `${quantity}x ${itemName} para ${userName}`;
}

/**
 * Calculate total borrowed value
 */
export function getBorrowValue(borrow: Borrow): number {
  if (!borrow.item?.prices || borrow.item.prices.length === 0) return 0;
  const latestPrice = borrow.item.prices[0].value;
  return borrow.quantity * latestPrice;
}

/**
 * Group borrows by status
 */
export function groupBorrowsByStatus(borrows: Borrow[]): Record<'active' | 'returned', Borrow[]> {
  const groups: Record<'active' | 'returned', Borrow[]> = {
    active: [],
    returned: [],
  };

  borrows.forEach(borrow => {
    const status = getBorrowStatus(borrow);
    groups[status].push(borrow);
  });

  return groups;
}

/**
 * Get active borrows
 */
export function getActiveBorrows(borrows: Borrow[]): Borrow[] {
  return borrows.filter(isBorrowActive);
}

/**
 * Get returned borrows
 */
export function getReturnedBorrows(borrows: Borrow[]): Borrow[] {
  return borrows.filter(isBorrowReturned);
}

/**
 * Sort borrows by date
 */
export function sortBorrowsByDate(borrows: Borrow[], order: 'asc' | 'desc' = 'desc'): Borrow[] {
  return [...borrows].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return order === 'asc' ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Calculate borrow statistics
 */
export function calculateBorrowStats(borrows: Borrow[]) {
  const total = borrows.length;
  const active = borrows.filter(isBorrowActive).length;
  const returned = borrows.filter(isBorrowReturned).length;

  const totalValue = borrows.reduce((sum, borrow) => sum + getBorrowValue(borrow), 0);
  const averageDuration =
    borrows.filter(isBorrowReturned).reduce((sum, borrow) => sum + getBorrowDuration(borrow), 0) /
    (returned || 1);

  return {
    total,
    active,
    returned,
    totalValue,
    averageDuration: Math.round(averageDuration),
  };
}
