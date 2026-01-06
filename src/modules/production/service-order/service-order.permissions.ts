import { ForbiddenException } from '@nestjs/common';
import { SERVICE_ORDER_STATUS, SERVICE_ORDER_TYPE, SECTOR_PRIVILEGES } from '@constants';
import type { ServiceOrder } from '@types';

/**
 * Permission rules for Service Orders:
 *
 * PRODUCTION Service Orders:
 * - Only LEADER and ADMIN can update status
 * - LEADER cannot set status to CANCELLED
 * - If assigned: Only ADMIN + assigned user can update
 * - Only ADMIN can set to CANCELLED
 *
 * FINANCIAL Service Orders:
 * - Only FINANCIAL and ADMIN can update status
 * - Only ADMIN can set to CANCELLED
 * - If assigned: Only ADMIN + assigned user can update
 *
 * NEGOTIATION Service Orders:
 * - Only PRODUCTION and ADMIN can update status
 * - Only ADMIN can set to CANCELLED
 * - If assigned: Only ADMIN + assigned user can update
 *
 * ARTWORK Service Orders:
 * - Only DESIGNER and ADMIN can update status
 * - Only ADMIN can set to CANCELLED
 * - If assigned: Only ADMIN + assigned user can update
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
): ServiceOrderUpdatePermissionCheck {
  const isAdmin = userPrivilege === SECTOR_PRIVILEGES.ADMIN;
  const isAssignedUser = serviceOrder.assignedToId === userId;

  // ADMIN can always update
  if (isAdmin) {
    return { canUpdate: true };
  }

  // Check if user is trying to set CANCELLED status (only ADMIN allowed)
  if (newStatus === SERVICE_ORDER_STATUS.CANCELLED) {
    return {
      canUpdate: false,
      reason: 'Apenas administradores podem cancelar ordens de serviço',
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

  // Check permissions based on service order type
  switch (serviceOrder.type) {
    case SERVICE_ORDER_TYPE.PRODUCTION:
      // LEADER can update (but not cancel, already checked above)
      if (userPrivilege === SECTOR_PRIVILEGES.PRODUCTION) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas líderes de produção ou administradores podem atualizar ordens de serviço de produção',
      };

    case SERVICE_ORDER_TYPE.FINANCIAL:
      if (userPrivilege === SECTOR_PRIVILEGES.FINANCIAL) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas usuários financeiros ou administradores podem atualizar ordens de serviço financeiras',
      };

    case SERVICE_ORDER_TYPE.NEGOTIATION:
      if (userPrivilege === SECTOR_PRIVILEGES.PRODUCTION) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas usuários de produção ou administradores podem atualizar ordens de serviço de negociação',
      };

    case SERVICE_ORDER_TYPE.ARTWORK:
      if (userPrivilege === SECTOR_PRIVILEGES.DESIGNER) {
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
): void {
  const check = checkServiceOrderUpdatePermission(serviceOrder, userId, userPrivilege, newStatus);

  if (!check.canUpdate) {
    throw new ForbiddenException(
      check.reason || 'Você não tem permissão para atualizar esta ordem de serviço',
    );
  }
}
