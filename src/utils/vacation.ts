// =====================
// Validation Helpers
// =====================

import { VACATION_STATUS, VACATION_TYPE } from '@constants';
import type { Vacation } from '@types';
import type { VacationStatus, VacationType } from '@prisma/client';

/**
 * Map VACATION_STATUS enum to Prisma VacationStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapVacationStatusToPrisma(status: VACATION_STATUS | string): VacationStatus {
  return status as VacationStatus;
}

/**
 * Map VACATION_TYPE enum to Prisma VacationType enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapVacationTypeToPrisma(type: VACATION_TYPE | string): VacationType {
  return type as VacationType;
}

/**
 * Check if vacation status transition is valid
 */
export function isValidVacationStatusTransition(
  fromStatus: VACATION_STATUS,
  toStatus: VACATION_STATUS,
): boolean {
  const validTransitions: Record<VACATION_STATUS, VACATION_STATUS[]> = {
    [VACATION_STATUS.PENDING]: [
      VACATION_STATUS.APPROVED,
      VACATION_STATUS.REJECTED,
      VACATION_STATUS.CANCELLED,
    ],
    [VACATION_STATUS.APPROVED]: [VACATION_STATUS.IN_PROGRESS, VACATION_STATUS.CANCELLED],
    [VACATION_STATUS.IN_PROGRESS]: [VACATION_STATUS.COMPLETED],
    [VACATION_STATUS.COMPLETED]: [], // Final state
    [VACATION_STATUS.REJECTED]: [], // Final state
    [VACATION_STATUS.CANCELLED]: [], // Final state
  };

  return validTransitions[fromStatus]?.includes(toStatus) || false;
}

export const getVacationDuration = (vacation: Pick<Vacation, 'startAt' | 'endAt'>): number => {
  const diffTime = Math.abs(vacation.endAt.getTime() - vacation.startAt.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const isVacationActive = (
  vacation: Pick<Vacation, 'startAt' | 'endAt' | 'status'>,
): boolean => {
  const now = new Date();
  return (
    vacation.status === VACATION_STATUS.IN_PROGRESS &&
    vacation.startAt <= now &&
    vacation.endAt >= now
  );
};

export const isVacationOverdue = (vacation: Pick<Vacation, 'endAt' | 'status'>): boolean => {
  const now = new Date();
  return vacation.endAt < now && vacation.status === VACATION_STATUS.IN_PROGRESS;
};

export const canCancelVacation = (vacation: Pick<Vacation, 'status' | 'startAt'>): boolean => {
  const cancellableStatuses = [VACATION_STATUS.PENDING, VACATION_STATUS.APPROVED];
  const now = new Date();
  return cancellableStatuses.includes(vacation.status) && vacation.startAt > now;
};

export const canApproveVacation = (vacation: Pick<Vacation, 'status'>): boolean => {
  return vacation.status === VACATION_STATUS.PENDING;
};

export const canRejectVacation = (vacation: Pick<Vacation, 'status'>): boolean => {
  return vacation.status === VACATION_STATUS.PENDING;
};

export const validateVacationDates = (
  startAt: Date,
  endAt: Date,
  existingVacations: Pick<Vacation, 'startAt' | 'endAt' | 'id'>[] = [],
  excludeId?: string,
): string[] => {
  const errors: string[] = [];

  // Basic date validation
  if (endAt <= startAt) {
    errors.push('Data de término deve ser posterior à data de início');
  }

  // Duration validation
  const duration = getVacationDuration({ startAt, endAt });
  if (duration > 365) {
    errors.push('Férias não podem durar mais de 365 dias');
  }

  // Past date validation
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (startAt < today) {
    errors.push('Data de início não pode ser no passado');
  }

  // Overlap validation
  const filtered = existingVacations.filter(v => v.id !== excludeId);
  const hasOverlap = filtered.some(existing => {
    return (
      (startAt >= existing.startAt && startAt <= existing.endAt) ||
      (endAt >= existing.startAt && endAt <= existing.endAt) ||
      (startAt <= existing.startAt && endAt >= existing.endAt)
    );
  });

  if (hasOverlap) {
    errors.push('Já existe férias agendadas neste período');
  }

  return errors;
};

export const calculateVacationBalance = (
  userVacations: Pick<Vacation, 'startAt' | 'endAt' | 'status' | 'type'>[],
  year: number,
): {
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  pendingDays: number;
} => {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  const yearVacations = userVacations.filter(v => {
    return (
      (v.startAt >= yearStart && v.startAt <= yearEnd) ||
      (v.endAt >= yearStart && v.endAt <= yearEnd) ||
      (v.startAt <= yearStart && v.endAt >= yearEnd)
    );
  });

  const usedDays = yearVacations
    .filter(v => v.status === VACATION_STATUS.IN_PROGRESS || v.status === VACATION_STATUS.COMPLETED)
    .reduce((total, v) => total + getVacationDuration(v), 0);

  const pendingDays = yearVacations
    .filter(v => v.status === VACATION_STATUS.PENDING || v.status === VACATION_STATUS.APPROVED)
    .reduce((total, v) => total + getVacationDuration(v), 0);

  const totalDays = 30; // Standard vacation days per year
  const remainingDays = Math.max(totalDays - usedDays - pendingDays, 0);

  return {
    totalDays,
    usedDays,
    remainingDays,
    pendingDays,
  };
};
