/**
 * Task and Service Order Bidirectional Synchronization Utilities
 *
 * This module provides comprehensive synchronization logic between Task status
 * and Production Service Order statuses. The sync is bidirectional:
 *
 * 1. Service Order → Task (Forward sync):
 *    - When SO goes to IN_PROGRESS → Task auto-starts (WAITING_PRODUCTION → IN_PRODUCTION)
 *    - When all ARTWORK SOs complete → Task transitions (PREPARATION → WAITING_PRODUCTION)
 *    - When all PRODUCTION SOs complete → Task auto-completes (IN_PRODUCTION → COMPLETED)
 *
 * 2. Task → Service Order (Reverse sync):
 *    - When Task goes to IN_PRODUCTION → First PENDING production SO starts (PENDING → IN_PROGRESS)
 *    - When Task goes to COMPLETED → All production SOs complete (ANY → COMPLETED)
 *
 * 3. Rollback sync:
 *    - When SO goes back to PENDING → Task may rollback (IN_PRODUCTION → WAITING_PRODUCTION)
 *    - When SO goes back to IN_PROGRESS from COMPLETED → Task may rollback (COMPLETED → IN_PRODUCTION)
 *    - When Task goes back to WAITING_PRODUCTION → All production SOs reset to PENDING
 *    - When Task goes back to IN_PRODUCTION → Completed SOs reset to IN_PROGRESS
 */

import { TASK_STATUS, SERVICE_ORDER_STATUS, SERVICE_ORDER_TYPE } from '../constants/enums';
import { SERVICE_ORDER_STATUS_ORDER, TASK_STATUS_ORDER } from '../constants/sortOrders';

/**
 * Mapping between Task status and expected Service Order status
 */
export const TASK_TO_SERVICE_ORDER_STATUS_MAP: Record<TASK_STATUS, SERVICE_ORDER_STATUS | null> = {
  [TASK_STATUS.PREPARATION]: SERVICE_ORDER_STATUS.PENDING,
  [TASK_STATUS.WAITING_PRODUCTION]: SERVICE_ORDER_STATUS.PENDING,
  [TASK_STATUS.IN_PRODUCTION]: SERVICE_ORDER_STATUS.IN_PROGRESS,
  [TASK_STATUS.COMPLETED]: SERVICE_ORDER_STATUS.COMPLETED,
  [TASK_STATUS.CANCELLED]: SERVICE_ORDER_STATUS.CANCELLED,
};

/**
 * Determines the expected Task status based on all production service orders
 *
 * IMPORTANT: CANCELLED service orders are excluded from status calculation.
 * A task can be completed even if some production service orders are cancelled,
 * as long as all remaining (non-cancelled) production service orders are completed.
 */
export function determineTaskStatusFromServiceOrders(
  serviceOrders: Array<{ status: SERVICE_ORDER_STATUS; type: SERVICE_ORDER_TYPE }>,
  currentTaskStatus: TASK_STATUS,
): TASK_STATUS | null {
  // Filter only PRODUCTION type service orders (they drive task status)
  const productionOrders = serviceOrders.filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION);

  if (productionOrders.length === 0) {
    return null; // No production orders, can't determine status
  }

  // Filter out CANCELLED orders - they don't affect task completion status
  // A task can be completed if all NON-CANCELLED production orders are completed
  const activeProductionOrders = productionOrders.filter(
    so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
  );

  // If all production orders are cancelled, don't change task status
  if (activeProductionOrders.length === 0) {
    return null;
  }

  const allCompleted = activeProductionOrders.every(
    so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
  );
  const allPending = activeProductionOrders.every(so => so.status === SERVICE_ORDER_STATUS.PENDING);
  const anyInProgress = activeProductionOrders.some(
    so => so.status === SERVICE_ORDER_STATUS.IN_PROGRESS,
  );
  const anyCompleted = activeProductionOrders.some(
    so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
  );

  // All active orders completed → Task should be COMPLETED
  if (allCompleted) {
    return TASK_STATUS.COMPLETED;
  }

  // Any in progress or any completed (but not all) → Task should be IN_PRODUCTION
  if (anyInProgress || anyCompleted) {
    return TASK_STATUS.IN_PRODUCTION;
  }

  // All pending → Task should be WAITING_PRODUCTION (if not in PREPARATION)
  if (allPending) {
    // Don't regress from PREPARATION - that's handled by ARTWORK service orders
    if (currentTaskStatus === TASK_STATUS.PREPARATION) {
      return null;
    }
    return TASK_STATUS.WAITING_PRODUCTION;
  }

  return null;
}

/**
 * Determines which service orders should be updated when task status changes
 */
export function getServiceOrderUpdatesForTaskStatusChange(
  serviceOrders: Array<{
    id: string;
    status: SERVICE_ORDER_STATUS;
    type: SERVICE_ORDER_TYPE;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>,
  oldTaskStatus: TASK_STATUS,
  newTaskStatus: TASK_STATUS,
): Array<{
  serviceOrderId: string;
  newStatus: SERVICE_ORDER_STATUS;
  setStartedAt: boolean;
  setFinishedAt: boolean;
  clearStartedAt: boolean;
  clearFinishedAt: boolean;
  reason: string;
}> {
  const updates: Array<{
    serviceOrderId: string;
    newStatus: SERVICE_ORDER_STATUS;
    setStartedAt: boolean;
    setFinishedAt: boolean;
    clearStartedAt: boolean;
    clearFinishedAt: boolean;
    reason: string;
  }> = [];

  // Filter only PRODUCTION type service orders
  const productionOrders = serviceOrders.filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION);

  if (productionOrders.length === 0) {
    return updates;
  }

  // ===== FORWARD TRANSITIONS (Progress) =====

  // Task: WAITING_PRODUCTION → IN_PRODUCTION
  // Action: Start the first PENDING production service order
  if (
    oldTaskStatus === TASK_STATUS.WAITING_PRODUCTION &&
    newTaskStatus === TASK_STATUS.IN_PRODUCTION
  ) {
    // Find the first PENDING production service order
    const firstPending = productionOrders.find(so => so.status === SERVICE_ORDER_STATUS.PENDING);
    if (firstPending) {
      updates.push({
        serviceOrderId: firstPending.id,
        newStatus: SERVICE_ORDER_STATUS.IN_PROGRESS,
        setStartedAt: !firstPending.startedAt,
        setFinishedAt: false,
        clearStartedAt: false,
        clearFinishedAt: false,
        reason: 'Ordem de serviço iniciada automaticamente quando tarefa foi iniciada',
      });
    }
  }

  // Task: IN_PRODUCTION → COMPLETED
  // Action: Complete all production service orders that are not already completed
  if (
    (oldTaskStatus === TASK_STATUS.IN_PRODUCTION || oldTaskStatus === TASK_STATUS.WAITING_PRODUCTION) &&
    newTaskStatus === TASK_STATUS.COMPLETED
  ) {
    for (const so of productionOrders) {
      if (so.status !== SERVICE_ORDER_STATUS.COMPLETED && so.status !== SERVICE_ORDER_STATUS.CANCELLED) {
        updates.push({
          serviceOrderId: so.id,
          newStatus: SERVICE_ORDER_STATUS.COMPLETED,
          setStartedAt: !so.startedAt,
          setFinishedAt: !so.finishedAt,
          clearStartedAt: false,
          clearFinishedAt: false,
          reason: 'Ordem de serviço concluída automaticamente quando tarefa foi concluída',
        });
      }
    }
  }

  // ===== BACKWARD TRANSITIONS (Rollback) =====

  // Task: IN_PRODUCTION → WAITING_PRODUCTION (rollback)
  // Action: Reset all IN_PROGRESS production service orders to PENDING
  if (
    oldTaskStatus === TASK_STATUS.IN_PRODUCTION &&
    newTaskStatus === TASK_STATUS.WAITING_PRODUCTION
  ) {
    for (const so of productionOrders) {
      if (so.status === SERVICE_ORDER_STATUS.IN_PROGRESS) {
        updates.push({
          serviceOrderId: so.id,
          newStatus: SERVICE_ORDER_STATUS.PENDING,
          setStartedAt: false,
          setFinishedAt: false,
          clearStartedAt: true,
          clearFinishedAt: false,
          reason: 'Ordem de serviço retornada para pendente quando tarefa retornou para aguardando produção',
        });
      }
    }
  }

  // Task: COMPLETED → IN_PRODUCTION (rollback)
  // Action: Reset the most recently completed production service order to IN_PROGRESS
  if (
    oldTaskStatus === TASK_STATUS.COMPLETED &&
    newTaskStatus === TASK_STATUS.IN_PRODUCTION
  ) {
    // Find completed service orders and reset them to IN_PROGRESS
    const completedOrders = productionOrders.filter(so => so.status === SERVICE_ORDER_STATUS.COMPLETED);
    for (const so of completedOrders) {
      updates.push({
        serviceOrderId: so.id,
        newStatus: SERVICE_ORDER_STATUS.IN_PROGRESS,
        setStartedAt: false,
        setFinishedAt: false,
        clearStartedAt: false,
        clearFinishedAt: true, // Clear finish date since it's being reopened
        reason: 'Ordem de serviço reaberta quando tarefa retornou para em produção',
      });
    }
  }

  // Task: COMPLETED → WAITING_PRODUCTION (full rollback)
  // Action: Reset all non-pending production service orders to PENDING
  if (
    oldTaskStatus === TASK_STATUS.COMPLETED &&
    newTaskStatus === TASK_STATUS.WAITING_PRODUCTION
  ) {
    for (const so of productionOrders) {
      if (so.status !== SERVICE_ORDER_STATUS.PENDING && so.status !== SERVICE_ORDER_STATUS.CANCELLED) {
        updates.push({
          serviceOrderId: so.id,
          newStatus: SERVICE_ORDER_STATUS.PENDING,
          setStartedAt: false,
          setFinishedAt: false,
          clearStartedAt: true,
          clearFinishedAt: true,
          reason: 'Ordem de serviço retornada para pendente quando tarefa retornou para aguardando produção',
        });
      }
    }
  }

  // Task: ANY → CANCELLED
  // Action: Cancel all non-cancelled production service orders
  if (newTaskStatus === TASK_STATUS.CANCELLED && oldTaskStatus !== TASK_STATUS.CANCELLED) {
    for (const so of productionOrders) {
      if (so.status !== SERVICE_ORDER_STATUS.CANCELLED) {
        updates.push({
          serviceOrderId: so.id,
          newStatus: SERVICE_ORDER_STATUS.CANCELLED,
          setStartedAt: false,
          setFinishedAt: false,
          clearStartedAt: false,
          clearFinishedAt: false,
          reason: 'Ordem de serviço cancelada automaticamente quando tarefa foi cancelada',
        });
      }
    }
  }

  return updates;
}

/**
 * Determines if task status should be updated based on service order status change
 */
export function getTaskUpdateForServiceOrderStatusChange(
  allServiceOrders: Array<{
    id: string;
    status: SERVICE_ORDER_STATUS;
    type: SERVICE_ORDER_TYPE;
  }>,
  changedServiceOrderId: string,
  oldServiceOrderStatus: SERVICE_ORDER_STATUS,
  newServiceOrderStatus: SERVICE_ORDER_STATUS,
  currentTaskStatus: TASK_STATUS,
): {
  shouldUpdate: boolean;
  newTaskStatus: TASK_STATUS | null;
  setStartedAt: boolean;
  setFinishedAt: boolean;
  clearStartedAt: boolean;
  clearFinishedAt: boolean;
  reason: string;
} | null {
  // Get the changed service order
  const changedOrder = allServiceOrders.find(so => so.id === changedServiceOrderId);
  if (!changedOrder) {
    return null;
  }

  // Only PRODUCTION type service orders affect task status directly
  if (changedOrder.type !== SERVICE_ORDER_TYPE.PRODUCTION) {
    return null;
  }

  // Update the array to reflect the new status for calculation
  const updatedServiceOrders = allServiceOrders.map(so =>
    so.id === changedServiceOrderId ? { ...so, status: newServiceOrderStatus } : so,
  );

  const productionOrders = updatedServiceOrders.filter(so => so.type === SERVICE_ORDER_TYPE.PRODUCTION);

  // ===== FORWARD TRANSITIONS =====

  // SO: ANY → IN_PROGRESS (when task is WAITING_PRODUCTION)
  // Task should auto-start
  if (
    newServiceOrderStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
    oldServiceOrderStatus !== SERVICE_ORDER_STATUS.IN_PROGRESS &&
    currentTaskStatus === TASK_STATUS.WAITING_PRODUCTION
  ) {
    return {
      shouldUpdate: true,
      newTaskStatus: TASK_STATUS.IN_PRODUCTION,
      setStartedAt: true,
      setFinishedAt: false,
      clearStartedAt: false,
      clearFinishedAt: false,
      reason: `Tarefa iniciada automaticamente quando ordem de serviço foi iniciada`,
    };
  }

  // SO: ANY → COMPLETED (check if all active production SOs are now complete)
  if (
    newServiceOrderStatus === SERVICE_ORDER_STATUS.COMPLETED &&
    oldServiceOrderStatus !== SERVICE_ORDER_STATUS.COMPLETED
  ) {
    // Filter out CANCELLED orders - they don't affect task completion
    const activeProductionOrders = productionOrders.filter(
      so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
    );

    // Only check completion if there are active orders
    if (activeProductionOrders.length > 0) {
      const allCompleted = activeProductionOrders.every(
        so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
      );

      if (
        allCompleted &&
        (currentTaskStatus === TASK_STATUS.IN_PRODUCTION ||
          currentTaskStatus === TASK_STATUS.WAITING_PRODUCTION)
      ) {
        return {
          shouldUpdate: true,
          newTaskStatus: TASK_STATUS.COMPLETED,
          setStartedAt: true, // Ensure startedAt is set
          setFinishedAt: true,
          clearStartedAt: false,
          clearFinishedAt: false,
          reason: `Tarefa concluída automaticamente quando todas as ${activeProductionOrders.length} ordens de serviço de produção ativas foram finalizadas`,
        };
      }
    }
  }

  // SO: ANY → CANCELLED (check if all remaining active production SOs are complete)
  // When a service order is cancelled, check if all remaining active orders are completed
  if (
    newServiceOrderStatus === SERVICE_ORDER_STATUS.CANCELLED &&
    oldServiceOrderStatus !== SERVICE_ORDER_STATUS.CANCELLED
  ) {
    // Filter out CANCELLED orders - they don't affect task completion
    const activeProductionOrders = productionOrders.filter(
      so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
    );

    // Only check completion if there are active orders remaining
    if (activeProductionOrders.length > 0) {
      const allCompleted = activeProductionOrders.every(
        so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
      );

      if (
        allCompleted &&
        (currentTaskStatus === TASK_STATUS.IN_PRODUCTION ||
          currentTaskStatus === TASK_STATUS.WAITING_PRODUCTION)
      ) {
        return {
          shouldUpdate: true,
          newTaskStatus: TASK_STATUS.COMPLETED,
          setStartedAt: true, // Ensure startedAt is set
          setFinishedAt: true,
          clearStartedAt: false,
          clearFinishedAt: false,
          reason: `Tarefa concluída automaticamente quando ordem de serviço foi cancelada e todas as ${activeProductionOrders.length} ordens de serviço de produção restantes estão finalizadas`,
        };
      }
    }
  }

  // ===== BACKWARD TRANSITIONS (Rollback) =====

  // SO: IN_PROGRESS → PENDING (rollback)
  // Check if task should also rollback
  if (
    oldServiceOrderStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
    newServiceOrderStatus === SERVICE_ORDER_STATUS.PENDING
  ) {
    // Filter out CANCELLED orders when checking for rollback
    const activeProductionOrders = productionOrders.filter(
      so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
    );

    const allPending = activeProductionOrders.every(
      so => so.status === SERVICE_ORDER_STATUS.PENDING,
    );

    if (allPending && currentTaskStatus === TASK_STATUS.IN_PRODUCTION) {
      return {
        shouldUpdate: true,
        newTaskStatus: TASK_STATUS.WAITING_PRODUCTION,
        setStartedAt: false,
        setFinishedAt: false,
        clearStartedAt: true, // Clear start date on rollback
        clearFinishedAt: false,
        reason: `Tarefa retornada para aguardando produção quando todas as ordens de serviço de produção ativas retornaram para pendente`,
      };
    }
  }

  // SO: COMPLETED → IN_PROGRESS (rejection/rollback)
  // Task should rollback from COMPLETED to IN_PRODUCTION
  if (
    oldServiceOrderStatus === SERVICE_ORDER_STATUS.COMPLETED &&
    newServiceOrderStatus === SERVICE_ORDER_STATUS.IN_PROGRESS &&
    currentTaskStatus === TASK_STATUS.COMPLETED
  ) {
    return {
      shouldUpdate: true,
      newTaskStatus: TASK_STATUS.IN_PRODUCTION,
      setStartedAt: false,
      setFinishedAt: false,
      clearStartedAt: false,
      clearFinishedAt: true, // Clear finish date since task is being reopened
      reason: `Tarefa reaberta automaticamente quando ordem de serviço foi retornada para em andamento`,
    };
  }

  // SO: COMPLETED → PENDING (full rollback)
  // Task should rollback appropriately
  if (
    oldServiceOrderStatus === SERVICE_ORDER_STATUS.COMPLETED &&
    newServiceOrderStatus === SERVICE_ORDER_STATUS.PENDING
  ) {
    // Filter out CANCELLED orders when checking for rollback
    const activeProductionOrders = productionOrders.filter(
      so => so.status !== SERVICE_ORDER_STATUS.CANCELLED,
    );

    const allPending = activeProductionOrders.every(
      so => so.status === SERVICE_ORDER_STATUS.PENDING,
    );
    const anyInProgress = activeProductionOrders.some(
      so => so.status === SERVICE_ORDER_STATUS.IN_PROGRESS,
    );

    if (currentTaskStatus === TASK_STATUS.COMPLETED) {
      if (allPending) {
        return {
          shouldUpdate: true,
          newTaskStatus: TASK_STATUS.WAITING_PRODUCTION,
          setStartedAt: false,
          setFinishedAt: false,
          clearStartedAt: true,
          clearFinishedAt: true,
          reason: `Tarefa retornada para aguardando produção quando todas as ordens de serviço de produção ativas foram retornadas para pendente`,
        };
      } else if (!anyInProgress) {
        return {
          shouldUpdate: true,
          newTaskStatus: TASK_STATUS.IN_PRODUCTION,
          setStartedAt: false,
          setFinishedAt: false,
          clearStartedAt: false,
          clearFinishedAt: true,
          reason: `Tarefa reaberta automaticamente quando ordem de serviço foi retornada para pendente`,
        };
      }
    }
  }

  return null;
}

/**
 * Get the status order value for a service order status
 * (Internal helper - use getServiceOrderStatusOrder from sortOrder.ts for general use)
 */
function getServiceOrderStatusOrderInternal(status: SERVICE_ORDER_STATUS): number {
  return SERVICE_ORDER_STATUS_ORDER[status] || 1;
}

/**
 * Get the status order value for a task status
 * (Internal helper - use getTaskStatusOrder from sortOrder.ts for general use)
 */
function getTaskStatusOrderInternal(status: TASK_STATUS): number {
  return TASK_STATUS_ORDER[status] || 1;
}

/**
 * Check if this is a status rollback (going backwards in workflow)
 */
export function isStatusRollback(
  oldStatus: SERVICE_ORDER_STATUS,
  newStatus: SERVICE_ORDER_STATUS,
): boolean {
  const oldOrder = getServiceOrderStatusOrderInternal(oldStatus);
  const newOrder = getServiceOrderStatusOrderInternal(newStatus);
  return newOrder < oldOrder;
}

/**
 * Check if this is a task status rollback
 */
export function isTaskStatusRollback(oldStatus: TASK_STATUS, newStatus: TASK_STATUS): boolean {
  const oldOrder = getTaskStatusOrderInternal(oldStatus);
  const newOrder = getTaskStatusOrderInternal(newStatus);
  return newOrder < oldOrder;
}

/**
 * Determines if task status should be updated based on ARTWORK service order status change.
 *
 * This handles the PREPARATION → WAITING_PRODUCTION transition and its rollback:
 * - When at least ONE artwork SO becomes COMPLETED → Task transitions to WAITING_PRODUCTION
 * - When ALL artwork SOs are rolled back (none remain COMPLETED) → Task rolls back to PREPARATION
 *
 * @param allServiceOrders - All service orders for the task (with their current/updated statuses)
 * @param changedServiceOrderId - The ID of the service order that changed
 * @param oldServiceOrderStatus - The previous status of the changed service order
 * @param newServiceOrderStatus - The new status of the changed service order
 * @param serviceOrderType - The type of the changed service order
 * @param currentTaskStatus - The current status of the task
 * @returns Update info if task should be updated, null otherwise
 */
export function getTaskUpdateForArtworkServiceOrderStatusChange(
  allServiceOrders: Array<{
    id: string;
    status: SERVICE_ORDER_STATUS;
    type: SERVICE_ORDER_TYPE;
  }>,
  changedServiceOrderId: string,
  oldServiceOrderStatus: SERVICE_ORDER_STATUS,
  newServiceOrderStatus: SERVICE_ORDER_STATUS,
  serviceOrderType: SERVICE_ORDER_TYPE,
  currentTaskStatus: TASK_STATUS,
): {
  shouldUpdate: boolean;
  newTaskStatus: TASK_STATUS;
  reason: string;
} | null {
  // Only handle ARTWORK type service orders
  if (serviceOrderType !== SERVICE_ORDER_TYPE.ARTWORK) {
    return null;
  }

  // Update the array to reflect the new status for calculation
  const updatedServiceOrders = allServiceOrders.map(so =>
    so.id === changedServiceOrderId ? { ...so, status: newServiceOrderStatus } : so,
  );

  const artworkOrders = updatedServiceOrders.filter(so => so.type === SERVICE_ORDER_TYPE.ARTWORK);

  // ===== FORWARD TRANSITION: PREPARATION → WAITING_PRODUCTION =====
  // When an artwork SO becomes COMPLETED and task is in PREPARATION
  if (
    newServiceOrderStatus === SERVICE_ORDER_STATUS.COMPLETED &&
    oldServiceOrderStatus !== SERVICE_ORDER_STATUS.COMPLETED &&
    currentTaskStatus === TASK_STATUS.PREPARATION
  ) {
    // One artwork becoming COMPLETED is enough to transition
    return {
      shouldUpdate: true,
      newTaskStatus: TASK_STATUS.WAITING_PRODUCTION,
      reason: `Tarefa liberada automaticamente para produção quando ordem de serviço de arte foi concluída`,
    };
  }

  // ===== BACKWARD TRANSITION: WAITING_PRODUCTION → PREPARATION =====
  // When an artwork SO is rolled back from COMPLETED, check if task should rollback
  if (
    oldServiceOrderStatus === SERVICE_ORDER_STATUS.COMPLETED &&
    newServiceOrderStatus !== SERVICE_ORDER_STATUS.COMPLETED &&
    currentTaskStatus === TASK_STATUS.WAITING_PRODUCTION
  ) {
    // Only rollback task if NO artwork SOs remain completed
    const anyArtworkCompleted = artworkOrders.some(
      so => so.status === SERVICE_ORDER_STATUS.COMPLETED,
    );

    if (!anyArtworkCompleted) {
      return {
        shouldUpdate: true,
        newTaskStatus: TASK_STATUS.PREPARATION,
        reason: `Tarefa retornada para preparação pois nenhuma ordem de serviço de arte permanece concluída`,
      };
    }
  }

  return null;
}
