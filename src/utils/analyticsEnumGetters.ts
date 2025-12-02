// =====================
// Analytics & Chart Enum Label Getters
// =====================

import {
  TREND_DIRECTION_LABELS,
  TREND_TYPE_LABELS,
  PERIOD_TYPE_LABELS,
  CHART_TYPE_LABELS,
  GROUP_BY_LABELS,
  TIME_RANGE_LABELS,
} from '@constants';

import {
  TREND_DIRECTION,
  TREND_TYPE,
  PERIOD_TYPE,
  CHART_TYPE,
  GROUP_BY,
  TIME_RANGE,
} from '@constants';

// Trend and Analytics
export function getTrendDirectionLabel(direction: TREND_DIRECTION): string {
  return TREND_DIRECTION_LABELS[direction] || direction;
}

export function getTrendTypeLabel(type: TREND_TYPE): string {
  return TREND_TYPE_LABELS[type] || type;
}

export function getPeriodTypeLabel(type: PERIOD_TYPE): string {
  return PERIOD_TYPE_LABELS[type] || type;
}

// Charts and Visualization
export function getChartTypeLabel(type: CHART_TYPE): string {
  return CHART_TYPE_LABELS[type] || type;
}

export function getGroupByLabel(groupBy: GROUP_BY): string {
  return GROUP_BY_LABELS[groupBy] || groupBy;
}

export function getTimeRangeLabel(range: TIME_RANGE): string {
  return TIME_RANGE_LABELS[range] || range;
}
