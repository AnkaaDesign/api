// =====================
// UI State & Level Enum Label Getters
// =====================

import {
  PRIORITY_TYPE_LABELS,
  RISK_LEVEL_LABELS,
  HEALTH_STATUS_LABELS,
  PERFORMANCE_LEVEL_LABELS,
  URGENCY_LEVEL_LABELS,
  EFFORT_LEVEL_LABELS,
  CONFIDENCE_LEVEL_LABELS,
  PERCENTAGE_ADJUST_TYPE_LABELS,
  ALERT_TYPE_LABELS,
} from '@constants';

import {
  PRIORITY_TYPE,
  RISK_LEVEL,
  HEALTH_STATUS,
  PERFORMANCE_LEVEL,
  URGENCY_LEVEL,
  EFFORT_LEVEL,
  CONFIDENCE_LEVEL,
  PERCENTAGE_ADJUST_TYPE,
  ALERT_TYPE,
} from '@constants';

// Priority and Risk
export function getPriorityTypeLabel(type: PRIORITY_TYPE): string {
  return PRIORITY_TYPE_LABELS[type] || type;
}

export function getRiskLevelLabel(level: RISK_LEVEL): string {
  return RISK_LEVEL_LABELS[level] || level;
}

// Status and Performance
export function getHealthStatusLabel(status: HEALTH_STATUS): string {
  return HEALTH_STATUS_LABELS[status] || status;
}

export function getPerformanceLevelLabel(level: PERFORMANCE_LEVEL): string {
  return PERFORMANCE_LEVEL_LABELS[level] || level;
}

// Urgency and Effort
export function getUrgencyLevelLabel(level: URGENCY_LEVEL): string {
  return URGENCY_LEVEL_LABELS[level] || level;
}

export function getEffortLevelLabel(level: EFFORT_LEVEL): string {
  return EFFORT_LEVEL_LABELS[level] || level;
}

// Confidence and Adjustments
export function getConfidenceLevelLabel(level: CONFIDENCE_LEVEL): string {
  return CONFIDENCE_LEVEL_LABELS[level] || level;
}

export function getPercentageAdjustTypeLabel(type: PERCENTAGE_ADJUST_TYPE): string {
  return PERCENTAGE_ADJUST_TYPE_LABELS[type] || type;
}

// Alert Types
export function getAlertTypeLabel(type: ALERT_TYPE): string {
  return ALERT_TYPE_LABELS[type] || type;
}
