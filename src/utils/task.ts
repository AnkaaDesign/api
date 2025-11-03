import { TASK_OBSERVATION_TYPE, TASK_STATUS } from '@constants';
import { TASK_OBSERVATION_TYPE_LABELS, TASK_STATUS_LABELS } from '@constants';
import type { Task } from '@types';
import { dateUtils } from "./date";
import { numberUtils } from "./number";
import type { TaskStatus } from "@prisma/client";

/**
 * Map TASK_STATUS enum to Prisma TaskStatus enum
 * This is needed because TypeScript doesn't recognize that the string values are compatible
 */
export function mapTaskStatusToPrisma(status: TASK_STATUS | string): TaskStatus {
  return status as TaskStatus;
}

/**
 * Check if task status transition is valid
 */
export function isValidTaskStatusTransition(fromStatus: TASK_STATUS, toStatus: TASK_STATUS): boolean {
  const validTransitions: Record<TASK_STATUS, TASK_STATUS[]> = {
    [TASK_STATUS.PENDING]: [TASK_STATUS.IN_PRODUCTION, TASK_STATUS.ON_HOLD, TASK_STATUS.CANCELLED],
    [TASK_STATUS.IN_PRODUCTION]: [TASK_STATUS.COMPLETED, TASK_STATUS.ON_HOLD, TASK_STATUS.CANCELLED],
    [TASK_STATUS.ON_HOLD]: [TASK_STATUS.IN_PRODUCTION, TASK_STATUS.PENDING, TASK_STATUS.CANCELLED],
    [TASK_STATUS.COMPLETED]: [TASK_STATUS.INVOICED], // Can transition to invoiced
    [TASK_STATUS.INVOICED]: [TASK_STATUS.SETTLED], // Can transition to settled
    [TASK_STATUS.SETTLED]: [], // Final state
    [TASK_STATUS.CANCELLED]: [], // Final state
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
    [TASK_STATUS.PENDING]: "pending",
    [TASK_STATUS.IN_PRODUCTION]: "inProgress",
    [TASK_STATUS.COMPLETED]: "completed",
    [TASK_STATUS.CANCELLED]: "cancelled",
    [TASK_STATUS.ON_HOLD]: "onHold",
    [TASK_STATUS.INVOICED]: "invoiced",
    [TASK_STATUS.SETTLED]: "settled",
  };
  return colors[status] || "default";
}

/**
 * Get task status variant for badges
 */
export function getTaskStatusVariant(status: TASK_STATUS): "default" | "secondary" | "destructive" | "outline" {
  const variants: Record<TASK_STATUS, "default" | "secondary" | "destructive" | "outline"> = {
    [TASK_STATUS.PENDING]: "outline",
    [TASK_STATUS.IN_PRODUCTION]: "default",
    [TASK_STATUS.COMPLETED]: "secondary",
    [TASK_STATUS.CANCELLED]: "destructive",
    [TASK_STATUS.ON_HOLD]: "outline",
    [TASK_STATUS.INVOICED]: "secondary",
    [TASK_STATUS.SETTLED]: "secondary",
  };
  return variants[status] || "default";
}

/**
 * Get task priority based on status
 */
export function getTaskPriority(status: TASK_STATUS): number {
  const priorities: Record<TASK_STATUS, number> = {
    [TASK_STATUS.IN_PRODUCTION]: 1,
    [TASK_STATUS.PENDING]: 2,
    [TASK_STATUS.ON_HOLD]: 3,
    [TASK_STATUS.COMPLETED]: 4,
    [TASK_STATUS.INVOICED]: 5,
    [TASK_STATUS.SETTLED]: 6,
    [TASK_STATUS.CANCELLED]: 7,
  };
  return priorities[status] || 999;
}

/**
 * Get task progress percentage
 */
export function getTaskProgress(status: TASK_STATUS): number {
  const statusProgress: Record<TASK_STATUS, number> = {
    [TASK_STATUS.PENDING]: 0,
    [TASK_STATUS.ON_HOLD]: 10,
    [TASK_STATUS.IN_PRODUCTION]: 50,
    [TASK_STATUS.COMPLETED]: 100,
    [TASK_STATUS.INVOICED]: 100,
    [TASK_STATUS.SETTLED]: 100,
    [TASK_STATUS.CANCELLED]: 0,
  };
  return statusProgress[status] || 0;
}

/**
 * Check if task is active
 */
export function isTaskActive(task: Task): boolean {
  return task.status === TASK_STATUS.IN_PRODUCTION || task.status === TASK_STATUS.PENDING;
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
 * Check if task is on hold
 */
export function isTaskOnHold(task: Task): boolean {
  return task.status === TASK_STATUS.ON_HOLD;
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
  if (task.plate) return task.plate;
  return `#${task.id.slice(-6).toUpperCase()}`;
}

/**
 * Format task summary
 */
export function formatTaskSummary(task: Task): string {
  const identifier = formatTaskIdentifier(task);
  const customerName = task.customer?.fantasyName || "Cliente desconhecido";
  const status = getTaskStatusLabel(task.status);
  return `${identifier} - ${customerName} - ${status}`;
}

/**
 * Calculate task price from budget items
 */
export function calculateTaskPrice(task: Task): number {
  if (!task.budget || task.budget.length === 0) return 0;
  return task.budget.reduce((sum, item) => sum + item.valor, 0);
}

/**
 * Format task price from budget items
 */
export function formatTaskPrice(task: Task): string {
  if (!task.budget || task.budget.length === 0) return "Sem valor";
  const totalValue = calculateTaskPrice(task);
  return numberUtils.formatCurrency(totalValue);
}


/**
 * Group tasks by status
 */
export function groupTasksByStatus(tasks: Task[]): Record<TASK_STATUS, Task[]> {
  const groups = {} as Record<TASK_STATUS, Task[]>;

  // Initialize all statuses
  Object.values(TASK_STATUS).forEach((status) => {
    groups[status as TASK_STATUS] = [];
  });

  // Group tasks
  tasks.forEach((task) => {
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
      const sectorName = task.sector?.name || "Sem setor";
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
      const customerName = task.customer?.fantasyName || "Sem cliente";
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
export function sortTasksByDeadline(tasks: Task[], order: "asc" | "desc" = "asc"): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.term && !b.term) return 0;
    if (!a.term) return 1;
    if (!b.term) return -1;

    const dateA = new Date(a.term).getTime();
    const dateB = new Date(b.term).getTime();
    return order === "asc" ? dateA - dateB : dateB - dateA;
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
  return tasks.filter((task) => {
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
  const onHold = tasks.filter(isTaskOnHold).length;
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
    onHold,
    overdue,
    completionRate: Math.round(completionRate),
    totalValue,
    averagePrice: Math.round(averagePrice),
  };
}

export function getTaskObservationTypeLabel(type: TASK_OBSERVATION_TYPE): string {
  return TASK_OBSERVATION_TYPE_LABELS[type] || type;
}
