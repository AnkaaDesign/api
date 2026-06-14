// contract-stability.ts
// Estabilidade (job-stability) predicate shared between the Medicina do Trabalho
// flow (Part E — sets the window on return from a qualifying leave/event) and the
// rescisão flow (Part G — its termination guard imports isUnderStability to block
// dismissals inside an active window).
//
// A contract is "under stability" on a given date when stabilityType is set and the
// date falls within [stabilityStart, stabilityEnd]. stabilityEnd is inclusive: the
// employee is still protected on the last day of the window.

import { STABILITY_TYPE } from '@constants';

/**
 * Minimal shape of the stability fields on an EmploymentContract. Accepts the full
 * Prisma model or any object carrying these three fields (so callers don't need to
 * hydrate the whole contract).
 */
export interface StabilityFields {
  stabilityType?: string | null;
  stabilityStart?: Date | string | null;
  stabilityEnd?: Date | string | null;
}

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * True when `contract` carries an active estabilidade window covering `date`.
 *
 * - No stabilityType ⇒ never under stability.
 * - Missing stabilityStart is treated as "open start" (already begun).
 * - Missing stabilityEnd is treated as "open end" (indefinite — e.g. ongoing
 *   union/CIPA mandate without a recorded end).
 * - The window is inclusive on both ends.
 *
 * @param contract the contract's stability fields (or the full contract)
 * @param date the reference date (defaults to now)
 */
export function isUnderStability(
  contract: StabilityFields | null | undefined,
  date: Date = new Date(),
): boolean {
  if (!contract || !contract.stabilityType) return false;

  const ref = date.getTime();
  const start = toDate(contract.stabilityStart);
  const end = toDate(contract.stabilityEnd);

  if (start && ref < start.getTime()) return false;
  if (end && ref > end.getTime()) return false;

  return true;
}

/**
 * Resolve the estabilidade window for the acidentária case (art. 118 Lei 8.213/91):
 * 12 months counted from the day of return to work.
 *
 * @param returnDate the date the employee returned (afastamento end / first day back)
 * @returns { stabilityStart, stabilityEnd } where end = start + 12 months
 */
export function computeAccidentStabilityWindow(returnDate: Date): {
  stabilityType: string;
  stabilityStart: Date;
  stabilityEnd: Date;
} {
  const stabilityStart = new Date(returnDate);
  const stabilityEnd = new Date(returnDate);
  stabilityEnd.setMonth(stabilityEnd.getMonth() + 12);
  return {
    stabilityType: STABILITY_TYPE.ACCIDENT,
    stabilityStart,
    stabilityEnd,
  };
}
