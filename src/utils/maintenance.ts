import { MAINTENANCE_STATUS_LABELS, SCHEDULE_FREQUENCY_LABELS } from '@constants';
import { MAINTENANCE_STATUS, SCHEDULE_FREQUENCY } from '@constants';
import type { MaintenanceStatus, ScheduleFrequency } from '@prisma/client';

// Re-export removed - function not needed

/**
 * Map MAINTENANCE_STATUS enum to Prisma MaintenanceStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapMaintenanceStatusToPrisma(
  status: MAINTENANCE_STATUS | string,
): MaintenanceStatus {
  return status as MaintenanceStatus;
}

/**
 * Map SCHEDULE_FREQUENCY enum to Prisma ScheduleFrequency enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapScheduleFrequencyToPrisma(
  frequency: SCHEDULE_FREQUENCY | string,
): ScheduleFrequency {
  return frequency as ScheduleFrequency;
}

export function getMaintenanceStatusLabel(status: MAINTENANCE_STATUS): string {
  return MAINTENANCE_STATUS_LABELS[status] || status;
}

export function getMaintenanceFrequencyLabel(frequency: SCHEDULE_FREQUENCY): string {
  return SCHEDULE_FREQUENCY_LABELS[frequency] || frequency;
}

/**
 * Get a dynamic frequency label with count (e.g., "A cada 2 semanas", "Mensal")
 * @param frequency - The frequency type
 * @param frequencyCount - The count for the frequency (e.g., 2 for "every 2 weeks")
 * @returns Formatted frequency label
 */
export function getDynamicFrequencyLabel(
  frequency: SCHEDULE_FREQUENCY,
  frequencyCount?: number | null,
): string {
  const baseLabel = SCHEDULE_FREQUENCY_LABELS[frequency] || frequency;

  if (!frequencyCount || frequencyCount <= 1) {
    return baseLabel;
  }

  // Add count prefix for certain frequencies
  switch (frequency) {
    case SCHEDULE_FREQUENCY.DAILY:
      return `A cada ${frequencyCount} dias`;
    case SCHEDULE_FREQUENCY.WEEKLY:
      return `A cada ${frequencyCount} semanas`;
    case SCHEDULE_FREQUENCY.MONTHLY:
      return `A cada ${frequencyCount} meses`;
    case SCHEDULE_FREQUENCY.ANNUAL:
      return `A cada ${frequencyCount} anos`;
    default:
      return baseLabel;
  }
}

/**
 * Format maintenance duration from minutes to a human-readable format
 * @param minutes - Duration in minutes
 * @returns Formatted string like "2h 30min" or "45min" or "-" if null/undefined
 */
export function formatMaintenanceDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '-';

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}min`;
  } else if (mins === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${mins}min`;
  }
}
