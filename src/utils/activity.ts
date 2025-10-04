import type { Activity } from '@types';
import { ACTIVITY_OPERATION } from '@constants';
import { dateUtils } from "./date";
import { getActivityOperationLabel, getActivityReasonLabel, getActivityLevelLabel } from "./enumLabelGetter";

// Re-export the enum label getters for convenience
export { getActivityOperationLabel, getActivityReasonLabel, getActivityLevelLabel };

/**
 * Get color for activity operation
 */
export function getActivityOperationColor(operation: ACTIVITY_OPERATION): string {
  const colors: Record<ACTIVITY_OPERATION, string> = {
    [ACTIVITY_OPERATION.INBOUND]: "green",
    [ACTIVITY_OPERATION.OUTBOUND]: "red",
  };
  return colors[operation] || "gray";
}

/**
 * Calculate the total value of an activity
 */
export function getActivityValue(activity: Activity): number {
  if (!activity.item?.prices || activity.item.prices.length === 0) return 0;
  const latestPrice = activity.item.prices[0].value;
  return activity.quantity * latestPrice;
}

/**
 * Format activity for display
 */
export function formatActivityDescription(activity: Activity): string {
  const operation = getActivityOperationLabel(activity.operation);
  const quantity = activity.quantity;
  const itemName = activity.item?.name || "Item desconhecido";
  const userName = activity.user?.name || "Usuário desconhecido";

  return `${operation}: ${quantity}x ${itemName} por ${userName}`;
}

/**
 * Get formatted date for activity
 */
export function getActivityDate(activity: Activity, format: string = "dd/MM/yyyy HH:mm"): string {
  return dateUtils.formatDate(activity.createdAt, format);
}

/**
 * Check if activity is recent (within last 24 hours)
 */
export function isRecentActivity(activity: Activity): boolean {
  const hoursAgo = dateUtils.getHoursAgo(activity.createdAt);
  return hoursAgo <= 24;
}

/**
 * Check if activity is inbound
 */
export function isInboundActivity(activity: Activity): boolean {
  return activity.operation === ACTIVITY_OPERATION.INBOUND;
}

/**
 * Check if activity is outbound
 */
export function isOutboundActivity(activity: Activity): boolean {
  return activity.operation === ACTIVITY_OPERATION.OUTBOUND;
}

/**
 * Get activity impact on inventory
 */
export function getActivityImpact(activity: Activity): number {
  const multiplier = activity.operation === ACTIVITY_OPERATION.INBOUND ? 1 : -1;
  return activity.quantity * multiplier;
}

/**
 * Group activities by date
 */
export function groupActivitiesByDate(activities: Activity[]): Record<string, Activity[]> {
  return activities.reduce(
    (groups, activity) => {
      const date = dateUtils.formatDate(activity.createdAt, "yyyy-MM-dd");
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(activity);
      return groups;
    },
    {} as Record<string, Activity[]>,
  );
}

/**
 * Calculate net quantity change from activities
 */
export function calculateNetQuantityChange(activities: Activity[]): number {
  return activities.reduce((total, activity) => {
    return total + getActivityImpact(activity);
  }, 0);
}

/**
 * Filter activities by date range
 */
export function filterActivitiesByDateRange(activities: Activity[], startDate: Date, endDate: Date): Activity[] {
  return activities.filter((activity) => {
    const activityDate = new Date(activity.createdAt);
    return activityDate >= startDate && activityDate <= endDate;
  });
}

/**
 * Sort activities by date
 */
export function sortActivitiesByDate(activities: Activity[], order: "asc" | "desc" = "desc"): Activity[] {
  return [...activities].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return order === "asc" ? dateA - dateB : dateB - dateA;
  });
}
