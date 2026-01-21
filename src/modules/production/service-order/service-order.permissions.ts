import { ForbiddenException } from '@nestjs/common';
import { SERVICE_ORDER_STATUS, SERVICE_ORDER_TYPE, SECTOR_PRIVILEGES } from '@constants';
import type { ServiceOrder } from '@types';

/**
 * Permission rules for Service Orders:
 *
 * GENERAL RULES:
 * - ADMIN can always update ANY service order
 * - Only ADMIN can set status to CANCELLED
 * - If assigned (assignedToId is set): Only the assigned user OR ADMIN can update
 *
 * WHEN NOT ASSIGNED (by service order type):
 *
 * PRODUCTION Service Orders:
 * - LEADER can update
 * - LOGISTIC can update
 * - ADMIN can update
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
 * - LOGISTIC can update
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

  // WAITING_APPROVE is ONLY valid for ARTWORK service orders (designer approval workflow)
  if (
    newStatus === SERVICE_ORDER_STATUS.WAITING_APPROVE &&
    serviceOrder.type !== SERVICE_ORDER_TYPE.ARTWORK
  ) {
    return {
      canUpdate: false,
      reason:
        'O status "Aguardando Aprovação" é exclusivo para ordens de serviço de arte',
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

  // Check permissions based on service order type (when NOT assigned)
  switch (serviceOrder.type) {
    case SERVICE_ORDER_TYPE.PRODUCTION:
      // PRODUCTION and LOGISTIC can update PRODUCTION service orders
      if (
        userPrivilege === SECTOR_PRIVILEGES.PRODUCTION ||
        userPrivilege === SECTOR_PRIVILEGES.LOGISTIC
      ) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas líderes de setor, logística ou administradores podem atualizar ordens de serviço de produção',
      };

    case SERVICE_ORDER_TYPE.FINANCIAL:
      // FINANCIAL can update FINANCIAL service orders
      if (userPrivilege === SECTOR_PRIVILEGES.FINANCIAL) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas usuários financeiros ou administradores podem atualizar ordens de serviço financeiras',
      };

    case SERVICE_ORDER_TYPE.COMMERCIAL:
      // COMMERCIAL and FINANCIAL can update COMMERCIAL service orders
      if (userPrivilege === SECTOR_PRIVILEGES.COMMERCIAL || userPrivilege === SECTOR_PRIVILEGES.FINANCIAL) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas usuários comerciais, financeiros ou administradores podem atualizar ordens de serviço comerciais',
      };

    case SERVICE_ORDER_TYPE.LOGISTIC:
      // LOGISTIC can update LOGISTIC service orders
      if (userPrivilege === SECTOR_PRIVILEGES.LOGISTIC) {
        return { canUpdate: true };
      }
      return {
        canUpdate: false,
        reason:
          'Apenas usuários de logística ou administradores podem atualizar ordens de serviço de logística',
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
): void {
  const check = checkServiceOrderUpdatePermission(serviceOrder, userId, userPrivilege, newStatus);

  if (!check.canUpdate) {
    throw new ForbiddenException(
      check.reason || 'Você não tem permissão para atualizar esta ordem de serviço',
    );
  }
}
