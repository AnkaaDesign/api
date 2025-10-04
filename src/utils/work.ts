import { WORKLOAD_LEVEL_LABELS } from '@constants';
import { WORKLOAD_LEVEL } from '@constants';

// Common work module utilities

export function getWorkloadLevelLabel(level: WORKLOAD_LEVEL): string {
  return WORKLOAD_LEVEL_LABELS[level] || level;
}
