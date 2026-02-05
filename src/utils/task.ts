import { TASK_OBSERVATION_TYPE, TASK_STATUS } from '@constants';
import { TASK_OBSERVATION_TYPE_LABELS, TASK_STATUS_LABELS } from '@constants';
import type { Task } from '@types';
import { dateUtils } from './date';
import { numberUtils } from './number';
import type { TaskStatus } from '@prisma/client';

/**
 * Map TASK_STATUS enum to Prisma TaskStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapTaskStatusToPrisma(status: TASK_STATUS | string): TaskStatus {
  return status as TaskStatus;
}

/**
 * Check if task status transition is valid
 * Note: Some transitions may require additional validation (e.g., artwork completion)
 * which should be checked in the service layer
 */
export function isValidTaskStatusTransition(
  fromStatus: TASK_STATUS,
  toStatus: TASK_STATUS,
): boolean {
  const validTransitions: Record<TASK_STATUS, TASK_STATUS[]> = {
    [TASK_STATUS.PREPARATION]: [
      TASK_STATUS.WAITING_PRODUCTION,
      TASK_STATUS.IN_PRODUCTION, // Allow direct jump to production (service layer will validate artwork completion)
      TASK_STATUS.CANCELLED,
    ],
    [TASK_STATUS.WAITING_PRODUCTION]: [
      TASK_STATUS.IN_PRODUCTION,
      TASK_STATUS.PREPARATION,
      TASK_STATUS.CANCELLED,
    ],
    [TASK_STATUS.IN_PRODUCTION]: [
      TASK_STATUS.COMPLETED,
      TASK_STATUS.WAITING_PRODUCTION,
      TASK_STATUS.CANCELLED,
    ],
    [TASK_STATUS.COMPLETED]: [
      TASK_STATUS.IN_PRODUCTION,
      TASK_STATUS.WAITING_PRODUCTION,
      TASK_STATUS.PREPARATION,
      TASK_STATUS.CANCELLED,
    ],
    [TASK_STATUS.CANCELLED]: [
      TASK_STATUS.PREPARATION,
      TASK_STATUS.WAITING_PRODUCTION,
      TASK_STATUS.IN_PRODUCTION,
    ],
  };

  return validTransitions[fromStatus]?.includes(toStatus) || false;
}

/**
 * Get task status label
 */
export function getTaskStatusLabel(status: TASK_STATUS): string {
  return TASK_STATUS_LABELS[status] || status;
}

/**
 * Get task status color
 */
export function getTaskStatusColor(status: TASK_STATUS): string {
  const colors: Record<TASK_STATUS, string> = {
    [TASK_STATUS.PREPARATION]: 'preparation',
    [TASK_STATUS.WAITING_PRODUCTION]: 'pending',
    [TASK_STATUS.IN_PRODUCTION]: 'inProgress',
    [TASK_STATUS.COMPLETED]: 'completed',
    [TASK_STATUS.CANCELLED]: 'cancelled',
  };
  return colors[status] || 'default';
}

/**
 * Get task status variant for badges
 */
export function getTaskStatusVariant(
  status: TASK_STATUS,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const variants: Record<TASK_STATUS, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    [TASK_STATUS.PREPARATION]: 'outline',
    [TASK_STATUS.WAITING_PRODUCTION]: 'outline',
    [TASK_STATUS.IN_PRODUCTION]: 'default',
    [TASK_STATUS.COMPLETED]: 'secondary',
    [TASK_STATUS.CANCELLED]: 'destructive',
  };
  return variants[status] || 'default';
}

/**
 * Get task priority based on status
 */
export function getTaskPriority(status: TASK_STATUS): number {
  const priorities: Record<TASK_STATUS, number> = {
    [TASK_STATUS.IN_PRODUCTION]: 1,
    [TASK_STATUS.WAITING_PRODUCTION]: 2,
    [TASK_STATUS.PREPARATION]: 3,
    [TASK_STATUS.COMPLETED]: 4,
    [TASK_STATUS.CANCELLED]: 5,
  };
  return priorities[status] || 999;
}

/**
 * Get task progress percentage
 */
export function getTaskProgress(status: TASK_STATUS): number {
  const statusProgress: Record<TASK_STATUS, number> = {
    [TASK_STATUS.PREPARATION]: 0,
    [TASK_STATUS.WAITING_PRODUCTION]: 25,
    [TASK_STATUS.IN_PRODUCTION]: 50,
    [TASK_STATUS.COMPLETED]: 100,
    [TASK_STATUS.CANCELLED]: 0,
  };
  return statusProgress[status] || 0;
}

/**
 * Check if task is active
 */
export function isTaskActive(task: Task): boolean {
  return (
    task.status === TASK_STATUS.IN_PRODUCTION || task.status === TASK_STATUS.WAITING_PRODUCTION
  );
}

/**
 * Check if task is completed
 */
export function isTaskCompleted(task: Task): boolean {
  return task.status === TASK_STATUS.COMPLETED;
}

/**
 * Check if task is cancelled
 */
export function isTaskCancelled(task: Task): boolean {
  return task.status === TASK_STATUS.CANCELLED;
}

/**
 * Check if task is in preparation
 */
export function isTaskInPreparation(task: Task): boolean {
  return task.status === TASK_STATUS.PREPARATION;
}

/**
 * Check if task is overdue
 */
export function isTaskOverdue(task: Task): boolean {
  if (isTaskCompleted(task) || isTaskCancelled(task)) return false;
  if (!task.term) return false;

  return new Date() > new Date(task.term);
}

/**
 * Get task age in days
 */
export function getTaskAge(task: Task): number {
  const startDate = task.entryDate || task.createdAt;
  return dateUtils.getDaysAgo(startDate);
}

/**
 * Get task duration
 */
export function getTaskDuration(task: Task): number | null {
  if (!task.finishedAt) return null;
  const startDate = task.startedAt || task.entryDate || task.createdAt;
  return dateUtils.getDaysBetween(startDate, task.finishedAt);
}

/**
 * Get days until deadline (term)
 */
export function getDaysUntilDeadline(task: Task): number | null {
  if (!task.term) return null;
  if (isTaskCompleted(task) || isTaskCancelled(task)) return null;

  return dateUtils.getDaysBetween(new Date(), task.term);
}

/**
 * Format task identifier
 */
export function formatTaskIdentifier(task: Task): string {
  if (task.serialNumber) return task.serialNumber;
  if ((task as any).truck?.plate) return (task as any).truck.plate;
  return `#${task.id.slice(-6).toUpperCase()}`;
}

/**
 * Format task summary
 */
export function formatTaskSummary(task: Task): string {
  const identifier = formatTaskIdentifier(task);
  const customerName = task.customer?.fantasyName || 'Cliente desconhecido';
  const status = getTaskStatusLabel(task.status);
  return `${identifier} - ${customerName} - ${status}`;
}

/**
 * Calculate task price from pricing
 */
export function calculateTaskPrice(task: Task): number {
  if (!task.pricing) return 0;
  return Number(task.pricing.total) || 0;
}

/**
 * Format task price from pricing total
 */
export function formatTaskPrice(task: Task): string {
  if (!task.pricing || !task.pricing.total) return 'Sem valor';
  const totalValue = calculateTaskPrice(task);
  return numberUtils.formatCurrency(totalValue);
}

/**
 * Group tasks by status
 */
export function groupTasksByStatus(tasks: Task[]): Record<TASK_STATUS, Task[]> {
  const groups = {} as Record<TASK_STATUS, Task[]>;

  // Initialize all statuses
  Object.values(TASK_STATUS).forEach(status => {
    groups[status as TASK_STATUS] = [];
  });

  // Group tasks
  tasks.forEach(task => {
    groups[task.status].push(task);
  });

  return groups;
}

/**
 * Group tasks by sector
 */
export function groupTasksBySector(tasks: Task[]): Record<string, Task[]> {
  return tasks.reduce(
    (groups, task) => {
      const sectorName = task.sector?.name || 'Sem setor';
      if (!groups[sectorName]) {
        groups[sectorName] = [];
      }
      groups[sectorName].push(task);
      return groups;
    },
    {} as Record<string, Task[]>,
  );
}

/**
 * Group tasks by customer
 */
export function groupTasksByCustomer(tasks: Task[]): Record<string, Task[]> {
  return tasks.reduce(
    (groups, task) => {
      const customerName = task.customer?.fantasyName || 'Sem cliente';
      if (!groups[customerName]) {
        groups[customerName] = [];
      }
      groups[customerName].push(task);
      return groups;
    },
    {} as Record<string, Task[]>,
  );
}

/**
 * Sort tasks by priority
 */
export function sortTasksByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const priorityA = getTaskPriority(a.status);
    const priorityB = getTaskPriority(b.status);
    return priorityA - priorityB;
  });
}

/**
 * Sort tasks by deadline
 */
export function sortTasksByDeadline(tasks: Task[], order: 'asc' | 'desc' = 'asc'): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.term && !b.term) return 0;
    if (!a.term) return 1;
    if (!b.term) return -1;

    const dateA = new Date(a.term).getTime();
    const dateB = new Date(b.term).getTime();
    return order === 'asc' ? dateA - dateB : dateB - dateA;
  });
}

/**
 * Filter overdue tasks
 */
export function filterOverdueTasks(tasks: Task[]): Task[] {
  return tasks.filter(isTaskOverdue);
}

/**
 * Filter tasks by date range
 */
export function filterTasksByDateRange(tasks: Task[], startDate: Date, endDate: Date): Task[] {
  return tasks.filter(task => {
    const taskDate = task.entryDate || task.createdAt;
    return new Date(taskDate) >= startDate && new Date(taskDate) <= endDate;
  });
}

/**
 * Calculate task statistics
 */
export function calculateTaskStats(tasks: Task[]) {
  const total = tasks.length;
  const byStatus = groupTasksByStatus(tasks);

  const statusCounts = Object.entries(byStatus).reduce(
    (acc, [status, taskList]) => {
      acc[status as TASK_STATUS] = taskList.length;
      return acc;
    },
    {} as Record<TASK_STATUS, number>,
  );

  const active = tasks.filter(isTaskActive).length;
  const completed = tasks.filter(isTaskCompleted).length;
  const cancelled = tasks.filter(isTaskCancelled).length;
  const inPreparation = tasks.filter(isTaskInPreparation).length;
  const overdue = tasks.filter(isTaskOverdue).length;

  const completionRate = total > 0 ? (completed / total) * 100 : 0;

  // Note: Price is no longer stored directly on tasks
  const totalValue = 0;
  const averagePrice = 0;

  return {
    total,
    statusCounts,
    active,
    completed,
    cancelled,
    inPreparation,
    overdue,
    completionRate: Math.round(completionRate),
    totalValue,
    averagePrice: Math.round(averagePrice),
  };
}

export function getTaskObservationTypeLabel(type: TASK_OBSERVATION_TYPE): string {
  return TASK_OBSERVATION_TYPE_LABELS[type] || type;
}

/**
 * Get task dimensions (width x height) from truck layout.
 * Takes either left or right side layout (both sides have the same dimensions).
 *
 * @param task - The task object with truck and layout data
 * @returns Object with width and height in meters, or null if no layout data exists
 */
export function getTaskDimensions(task: any): { width: number; height: number } | null {
  if (!task?.truck) return null;

  const { truck } = task;

  // Try left side layout first, then right side (both have the same dimensions)
  const layout = truck.leftSideLayout || truck.rightSideLayout;

  if (!layout?.layoutSections || layout.layoutSections.length === 0) {
    return null;
  }

  // Calculate total width by summing all section widths
  const totalWidth = layout.layoutSections.reduce(
    (sum: number, section: any) => sum + (section.width || 0),
    0,
  );

  return {
    width: totalWidth,
    height: layout.height,
  };
}

/**
 * Formats the measures for display as "WxH" in centimeters.
 * This format matches the task measure table column display.
 *
 * @param task - The task object with truck and layout data
 * @returns Formatted string (e.g., "850x244") or empty string if no layout data
 */
export function formatTaskMeasures(task: any): string {
  const dimensions = getTaskDimensions(task);

  if (!dimensions) return '';

  const widthCm = Math.round(dimensions.width * 100);
  const heightCm = Math.round(dimensions.height * 100);

  return `${widthCm}x${heightCm}`;
}

/**
 * Generate a filename for base files using task name and measures.
 * Format: "{TaskName} {measures}.{extension}" or "{TaskName}.{extension}" if no measures
 *
 * @param taskName - The task name
 * @param task - The task object with truck and layout data (for measures)
 * @param originalFilename - The original filename to extract extension from
 * @param fileIndex - Optional index for multiple files (1-based)
 * @returns Sanitized filename with task name and measures
 */
export function generateBaseFileName(
  taskName: string,
  task: any,
  originalFilename: string,
  fileIndex?: number,
): string {
  // Extract file extension from original filename
  const extensionMatch = originalFilename.match(/\.([^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';

  // Sanitize task name (remove invalid characters for filenames)
  const sanitizedName =
    taskName
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\.+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/-+/g, '-')
      .trim() || 'Tarefa';

  // Get measures if available
  const measures = formatTaskMeasures(task);

  // Build filename parts
  const parts: string[] = [sanitizedName];

  if (measures) {
    parts.push(measures);
  }

  if (fileIndex && fileIndex > 1) {
    parts.push(`(${fileIndex})`);
  }

  // Combine parts and add extension
  const baseName = parts.join(' ');
  return extension ? `${baseName}.${extension}` : baseName;
}
