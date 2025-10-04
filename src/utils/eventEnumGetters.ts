// =====================
// Event Enum Label Getters
// =====================

import { EVENT_TYPE_LABELS, TIMELINE_EVENT_TYPE_LABELS } from '@constants';

import { EVENT_TYPE, TIMELINE_EVENT_TYPE } from '@constants';

// Event Types
export function getEventTypeLabel(type: EVENT_TYPE): string {
  return EVENT_TYPE_LABELS[type] || type;
}

export function getTimelineEventTypeLabel(type: TIMELINE_EVENT_TYPE): string {
  return TIMELINE_EVENT_TYPE_LABELS[type] || type;
}
