import { ForbiddenException } from '@nestjs/common';
import { SERVICE_ORDER_STATUS, SERVICE_ORDER_TYPE, SECTOR_PRIVILEGES } from '@constants';
import type { ServiceOrder } from '@types';

/**
 * Permission rules for Service Orders:
 *
 * GENERAL RULES:
 * - ADMIN can always update ANY service order
 * - Only ADMIN can cancel non-COMMERCIAL service orders
 * - COMMERCIAL and FINANCIAL can cancel COMMERCIAL service orders (triggers task/cascade cancellation)
 * - If assigned (assignedToId is set): Only the assigned user OR ADMIN can update
 *
 * WHEN NOT ASSIGNED (by service order type):
 *
 * PRODUCTION Service Orders:
 * - LEADER can update
 * - PRODUCTION_MANAGER can update
 * - ADMIN can update
 * Note: LOGISTIC can only update PRODUCTION orders when explicitly assigned to them
 *
 * FINANCIAL Service Orders:
 * - FINANCIAL can update
 * - ADMIN can update
 *
 * COMMERCIAL Service Orders:
 * - COMMERCIAL can update
 * - ADMIN can update
 *
 * LOGISTIC Service Orders:
 * - LOGISTIC can update any unassigned LOGISTIC order, or ones assigned to them
 * - LOGISTIC cannot update LOGISTIC orders assigned to another user
 * - PRODUCTION_MANAGER can update
 * - ADMIN can update
 *
 * ARTWORK Service Orders:
 * - DESIGNER can update (but can only set status to WAITING_APPROVE, not COMPLETED)
 * - ADMIN can update (can set to COMPLETED)
 * - Workflow: Designer → WAITING_APPROVE → Admin → COMPLETED
 */

export interface ServiceOrderUpdatePermissionCheck {
  canUpdate: boolean;
  reason?: string;
}

export function checkServiceOrderUpdatePermission(
  serviceOrder: ServiceOrder,
  userId: string,
  userPrivilege: string,
  newStatus?: SERVICE_ORDER_STATUS,
  isStatusChange?: boolean,
  isTeamLeader?: boolean,
): ServiceOrderUpdatePermissionCheck {
  const isAdmin = userPrivilege === SECTOR_PRIVILEGES.ADMIN;
  const isAssignedUser = serviceOrder.assignedToId === userId;
  const isProductionManager = userPrivilege === SECTOR_PRIVILEGES.PRODUCTION_MANAGER;
  const isProductionSectorLeader = userPrivilege === SECTOR_PRIVILEGES.PRODUCTION && isTeamLeader;

  // ADMIN can always update
  if (isAdmin) {
    return { canUpdate: true };
  }

  // PRODUCTION sector team leaders cannot pause service orders —
  // they must ask a production manager or admin to pause.
  if (newStatus === SERVICE_ORDER_STATUS.PAUSED && isProductionSectorLeader) {
    return {
      canUpdate: false,
      reason:
        'Líderes de setor não podem pausar ordens de serviço. Solicite ao gerente de produção ou administrador.',
    };
  }

  // Cancel permissions:
  // - ADMIN: can cancel any SO (handled above)
  // - PRODUCTION_MANAGER: can cancel PRODUCTION and LOGISTIC SOs
  // - COMMERCIAL / FINANCIAL: can cancel COMMERCIAL SOs (triggers task cascade cancellation)
  // - All others: cannot cancel
  if (newStatus === SERVICE_ORDER_STATUS.CANCELLED) {
    const canCancelProductionOrLogistic =
      isProductionManager &&
      (serviceOrder.type === SERVICE_ORDER_TYPE.PRODUCTION ||
        serviceOrder.type === SERVICE_ORDER_TYPE.LOGISTIC);

    const canCancelCommercial =
      serviceOrder.type === SERVICE_ORDER_TYPE.COMMERCIAL &&
      (userPrivilege === SECTOR_PRIVILEGES.COMMERCIAL ||
        userPrivilege === SECTOR_PRIVILEGES.FINANCIAL);

    if (!canCancelProductionOrLogistic && !canCancelCommercial) {
      return {
        canUpdate: false,
        reason: 'Apenas administradores ou gerentes de produção podem cancelar ordens de serviço',
      };
    }
    // Fall through to assignment and type-based checks
  }

  // WAITING_APPROVE is ONLY valid for ARTWORK service orders (designer approval workflow)
  if (
    newStatus === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
    serviceOrder.type !== SERVICE_ORDER_TYPE.ARTWORK
  ) {
    return {
      canUpdate: false,
      reason: 'O status "Aguardando Aprovação" é exclusivo para ordens de serviço de arte',
    };
  }

  // If service order is assigned, only assigned user (or ADMIN) can update
  if (serviceOrder.assignedToId && !isAssignedUser) {
    return {
      canUpdate: false,
      reason:
        'Apenas o usuário responsável ou administradores podem atualizar esta ordem de serviço',
    };
  }

  // LOGISTIC users cannot update PRODUCTION orders unless explicitly assigned to them.
  // For LOGISTIC orders, they can update any unassigned order — blocked earlier if assigned to someone else.
  if (
    userPrivilege === SECTOR_PRIVILEGES.LOGISTIC &&
    !isAssignedUser &&
    serviceOrder.type !== SERVICE_ORDER_TYPE.LOGISTIC
  ) {
    return {
      canUpdate: false,
      reason: 'Usuários de logística só podem editar ordens de serviço atribuídas a eles',
    };
  }

  // COMMERCIAL users can edit non-status fields (description, responsible, observation) on ALL service order types
  // But they can only change status on COMMERCIAL service orders
  if (
    userPrivilege === SECTOR_PRIVILEGES.COMMERCIAL &&
    serviceOrder.type !== SERVICE_ORDER_TYPE.COMMERCIAL
  ) {
    if (isStatusChange) {
      return {
        canUpdate: false,
        reason:
          'Usuários comerciais não podem alterar o status de ordens de serviço de outros setores',
      };
    }
    return { canUpdate: true };
  }

  // Check permissions based on service order type (when NOT assigned)
  switch (serviceOrder.type) {
    case SERVICE_ORDER_TYPE.PRODUCTION:
      // PRODUCTION and PRODUCTION_MANAGER can update PRODUCTION service orders when unassigned.
      // LOGISTIC can also update but only when they are the assigned user (enforced above).
      if (
        userPrivilege === SECTOR_PRIVILEGES.PRODUCTION ||
        userPrivilege === SECTOR_PRIVILEGES.LOGISTIC ||
        userPrivilege === SECTOR_PRIVILEGES.PRODUCTION_MANAGER
      ) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas líderes de setor, gerente de produção ou administradores podem atualizar ordens de serviço de produção',
      };

    case SERVICE_ORDER_TYPE.COMMERCIAL:
      // COMMERCIAL and FINANCIAL can update COMMERCIAL service orders
      if (
        userPrivilege === SECTOR_PRIVILEGES.COMMERCIAL ||
        userPrivilege === SECTOR_PRIVILEGES.FINANCIAL
      ) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas usuários comerciais, financeiros ou administradores podem atualizar ordens de serviço comerciais',
      };

    case SERVICE_ORDER_TYPE.LOGISTIC:
      // LOGISTIC and PRODUCTION_MANAGER can update LOGISTIC service orders
      if (
        userPrivilege === SECTOR_PRIVILEGES.LOGISTIC ||
        userPrivilege === SECTOR_PRIVILEGES.PRODUCTION_MANAGER
      ) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas usuários de logística, gerente de produção ou administradores podem atualizar ordens de serviço de logística',
      };

    case SERVICE_ORDER_TYPE.ARTWORK:
      // DESIGNER can update ARTWORK service orders
      if (userPrivilege === SECTOR_PRIVILEGES.DESIGNER) {
        // DESIGNER can only set status to WAITING_APPROVE, not COMPLETED
        if (newStatus === SERVICE_ORDER_STATUS.COMPLETED) {
          return {
            canUpdate: false,
            reason:
              'Designers não podem marcar ordens de serviço de arte como concluídas. Use "Aguardando Aprovação" para enviar para aprovação do administrador.',
          };
        }
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason: 'Apenas designers ou administradores podem atualizar ordens de serviço de arte',
      };

    default:
      return {
        canUpdate: false,
        reason: 'Tipo de ordem de serviço inválido',
      };
  }
}

/**
 * Throws ForbiddenException if user doesn't have permission to update the service order
 */
export function assertCanUpdateServiceOrder(
  serviceOrder: ServiceOrder,
  userId: string,
  userPrivilege: string,
  newStatus?: SERVICE_ORDER_STATUS,
  isStatusChange?: boolean,
  isTeamLeader?: boolean,
): void {
  const check = checkServiceOrderUpdatePermission(
    serviceOrder,
    userId,
    userPrivilege,
    newStatus,
    isStatusChange,
    isTeamLeader,
  );

  if (!check.canUpdate) {
    throw new ForbiddenException(
      check.reason || 'Você não tem permissão para atualizar esta ordem de serviço',
    );
  }
}
