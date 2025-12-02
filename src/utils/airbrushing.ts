import { AIRBRUSHING_STATUS_LABELS } from '@constants';
import { AIRBRUSHING_STATUS } from '@constants';
import type { AirbrushingStatus } from '@prisma/client';

/**
 * Map AIRBRUSHING_STATUS enum to Prisma AirbrushingStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapAirbrushingStatusToPrisma(
  status: AIRBRUSHING_STATUS | string,
): AirbrushingStatus {
  return status as AirbrushingStatus;
}

export function getAirbrushingStatusLabel(status: AIRBRUSHING_STATUS): string {
  return AIRBRUSHING_STATUS_LABELS[status] || status;
}
