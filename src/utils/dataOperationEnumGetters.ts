// =====================
// Data Operation Enum Label Getters
// =====================

import { EXPORT_FORMAT_LABELS, BATCH_OPERATION_STATUS_LABELS, VALIDATION_SEVERITY_LABELS, MERGE_STRATEGY_LABELS } from '@constants';

import { EXPORT_FORMAT, BATCH_OPERATION_STATUS, VALIDATION_SEVERITY, MERGE_STRATEGY } from '@constants';

// Export and Import
export function getExportFormatLabel(format: EXPORT_FORMAT): string {
  return EXPORT_FORMAT_LABELS[format] || format;
}

// Batch Operations
export function getBatchOperationStatusLabel(status: BATCH_OPERATION_STATUS): string {
  return BATCH_OPERATION_STATUS_LABELS[status] || status;
}

// Validation
export function getValidationSeverityLabel(severity: VALIDATION_SEVERITY): string {
  return VALIDATION_SEVERITY_LABELS[severity] || severity;
}

// Data Merge Strategies
export function getMergeStrategyLabel(strategy: MERGE_STRATEGY): string {
  return MERGE_STRATEGY_LABELS[strategy] || strategy;
}
