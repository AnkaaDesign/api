// Bulk-adjustment distributor (spec §2.2). 28% of all outbound volume is
// INVENTORY_COUNT; without redistribution the daily-consumption derivative
// is dominated by single-day spikes.

import { ACTIVITY_OPERATION, ACTIVITY_REASON } from '@/constants/enums';
import { BULK_DISTRIBUTION_REASONS } from '@/constants/inventory-config';
import { differenceInCalendarDays } from 'date-fns';

export interface ActivityLike {
  operation: ACTIVITY_OPERATION | string;
  reason: ACTIVITY_REASON | string;
  quantity: number;
  createdAt: Date | string;
}

export interface DistributedActivity {
  reason: ACTIVITY_REASON | string;
  quantity: number;
  createdAt: Date;
  /** True when the row was synthesized by the distributor; false for the
   *  pass-through OUTBOUND activities (PRODUCTION_USAGE etc.). */
  synthetic: boolean;
}

/** Spreads INVENTORY_COUNT / MANUAL_ADJUSTMENT OUTBOUND quantities uniformly
 *  across the window from the previous bulk event (or the item's createdAt)
 *  up to the bulk event's date. Non-bulk OUTBOUND activities pass through
 *  unchanged. INBOUND and excluded reasons are dropped. */
export function distributeBulkAdjustments(
  activities: ReadonlyArray<ActivityLike>,
  itemCreatedAt: Date,
): DistributedActivity[] {
  const outbound = activities
    .filter(a => a.operation === ACTIVITY_OPERATION.OUTBOUND)
    .map(a => ({ ...a, createdAt: new Date(a.createdAt) }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const bulks = outbound.filter(a =>
    BULK_DISTRIBUTION_REASONS.includes(a.reason as ACTIVITY_REASON),
  );
  const nonBulk = outbound.filter(
    a => !BULK_DISTRIBUTION_REASONS.includes(a.reason as ACTIVITY_REASON),
  );

  const synthetic: DistributedActivity[] = [];
  let prev = itemCreatedAt;
  for (const event of bulks) {
    const windowStart = prev > itemCreatedAt ? prev : itemCreatedAt;
    const windowEnd = event.createdAt;
    const days = Math.max(1, differenceInCalendarDays(windowEnd, windowStart));
    const perDay = event.quantity / days;
    for (let d = 0; d < days; d++) {
      const day = new Date(windowStart);
      day.setDate(day.getDate() + d);
      synthetic.push({
        reason: event.reason,
        quantity: perDay,
        createdAt: day,
        synthetic: true,
      });
    }
    prev = event.createdAt;
  }

  return [
    ...nonBulk.map(a => ({
      reason: a.reason,
      quantity: a.quantity,
      createdAt: a.createdAt,
      synthetic: false,
    })),
    ...synthetic,
  ];
}
