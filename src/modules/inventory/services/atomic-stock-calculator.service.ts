// apps/api/src/modules/inventory/services/atomic-stock-calculator.service.ts

import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import {
  ACTIVITY_OPERATION,
  ACTIVITY_REASON,
  ORDER_STATUS,
  STOCK_LEVEL,
} from '../../../constants/enums';
import { PrismaTransaction } from '../activity/repositories/activity.repository';
import { determineStockLevel } from '../../../utils';

export interface StockUpdateOperation {
  itemId: string;
  quantity: number;
  operation: ACTIVITY_OPERATION;
  reason?: ACTIVITY_REASON | null;
  orderId?: string | null;
  orderItemId?: string | null;
  userId?: string | null;
  activityId?: string; // For updates, the ID of the activity being modified
}

export interface StockCalculationResult {
  itemId: string;
  itemName: string;
  currentQuantity: number;
  finalQuantity: number;
  quantityChange: number;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stockLevel: STOCK_LEVEL;
  hasActiveOrders: boolean;
  reorderPoint: number | null;
  maxQuantity: number | null;
  operations: StockUpdateOperation[];
}

export interface AtomicStockUpdatePlan {
  operations: StockUpdateOperation[];
  calculations: StockCalculationResult[];
  isValid: boolean;
  globalErrors: string[];
  canProceed: boolean;
  affectedItems: Set<string>;
  totalOperations: number;
  estimatedExecutionTime: number;
}

@Injectable()
export class AtomicStockCalculatorService {
  private readonly logger = new Logger(AtomicStockCalculatorService.name);

  /**
   * Pre-calculate all stock changes for a set of operations
   * This method calculates final quantities without making any database changes
   */
  async calculateStockUpdates(
    operations: StockUpdateOperation[],
    tx: PrismaTransaction,
  ): Promise<AtomicStockUpdatePlan> {
    const startTime = Date.now();

    const plan: AtomicStockUpdatePlan = {
      operations,
      calculations: [],
      isValid: true,
      globalErrors: [],
      canProceed: true,
      affectedItems: new Set(),
      totalOperations: operations.length,
      estimatedExecutionTime: 0,
    };

    if (operations.length === 0) {
      plan.globalErrors.push('Nenhuma operação foi fornecida para processamento');
      plan.isValid = false;
      plan.canProceed = false;
      return plan;
    }

    try {
      // Step 1: Validate operations structure
      this.validateOperationsStructure(operations, plan);
      if (!plan.isValid) {
        plan.canProceed = false;
        return plan;
      }

      // Step 2: Group operations by item to handle multiple operations on same item
      const operationsByItem = this.groupOperationsByItem(operations);

      // Step 3: Get current item states
      const itemIds = Array.from(operationsByItem.keys());
      const currentItems = await this.getCurrentItemStates(itemIds, tx);

      // Step 4: Check for missing items
      const missingItems = itemIds.filter(id => !currentItems.has(id));
      if (missingItems.length > 0) {
        plan.globalErrors.push(`Itens não encontrados: ${missingItems.join(', ')}`);
        plan.isValid = false;
        plan.canProceed = false;
        return plan;
      }

      // Step 5: Calculate final quantities for each item
      for (const [itemId, itemOperations] of operationsByItem) {
        const currentItem = currentItems.get(itemId)!;
        const calculation = await this.calculateItemFinalState(currentItem, itemOperations, tx);

        plan.calculations.push(calculation);
        plan.affectedItems.add(itemId);

        if (!calculation.isValid) {
          plan.isValid = false;
        }
      }

      // Step 6: Global validations (cross-item constraints)
      await this.performGlobalValidations(plan, tx);

      // Step 7: Determine if we can proceed
      plan.canProceed = plan.isValid && plan.globalErrors.length === 0;

      // Step 8: Calculate estimated execution time
      plan.estimatedExecutionTime = Date.now() - startTime;

      this.logger.debug(
        `Stock calculation completed: ${plan.calculations.length} items, ` +
          `${plan.globalErrors.length} global errors, ` +
          `valid: ${plan.isValid}, can proceed: ${plan.canProceed}`,
      );

      return plan;
    } catch (error) {
      this.logger.error('Error calculating stock updates:', error);
      plan.globalErrors.push(
        `Erro interno ao calcular atualizações de estoque: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
      plan.isValid = false;
      plan.canProceed = false;
      return plan;
    }
  }

  /**
   * Validate the structure and basic constraints of operations
   */
  private validateOperationsStructure(
    operations: StockUpdateOperation[],
    plan: AtomicStockUpdatePlan,
  ): void {
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const prefix = `Operação ${i + 1}:`;

      // Validate required fields
      if (!operation.itemId) {
        plan.globalErrors.push(`${prefix} ID do item é obrigatório`);
        plan.isValid = false;
      }

      if (!operation.quantity || operation.quantity <= 0) {
        plan.globalErrors.push(`${prefix} Quantidade deve ser maior que zero`);
        plan.isValid = false;
      }

      if (
        !operation.operation ||
        ![ACTIVITY_OPERATION.INBOUND, ACTIVITY_OPERATION.OUTBOUND].includes(operation.operation)
      ) {
        plan.globalErrors.push(`${prefix} Tipo de operação inválido`);
        plan.isValid = false;
      }

      // Validate quantity precision (max 2 decimal places)
      if (operation.quantity && operation.quantity !== Math.round(operation.quantity * 100) / 100) {
        plan.globalErrors.push(`${prefix} Quantidade deve ter no máximo 2 casas decimais`);
        plan.isValid = false;
      }

      // Validate quantity range
      if (operation.quantity && operation.quantity > 999999) {
        plan.globalErrors.push(`${prefix} Quantidade excede o limite máximo permitido (999,999)`);
        plan.isValid = false;
      }

      // Validate reason if provided
      if (operation.reason && !Object.values(ACTIVITY_REASON).includes(operation.reason)) {
        plan.globalErrors.push(`${prefix} Motivo inválido`);
        plan.isValid = false;
      }
    }
  }

  /**
   * Group operations by item ID to handle multiple operations on the same item
   */
  private groupOperationsByItem(
    operations: StockUpdateOperation[],
  ): Map<string, StockUpdateOperation[]> {
    const grouped = new Map<string, StockUpdateOperation[]>();

    for (const operation of operations) {
      const existing = grouped.get(operation.itemId) || [];
      existing.push(operation);
      grouped.set(operation.itemId, existing);
    }

    return grouped;
  }

  /**
   * Get current state of all affected items
   */
  private async getCurrentItemStates(itemIds: string[], tx: PrismaTransaction) {
    const items = await tx.item.findMany({
      where: { id: { in: itemIds } },
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true } },
        prices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const itemMap = new Map();
    for (const item of items) {
      itemMap.set(item.id, item);
    }

    return itemMap;
  }

  /**
   * Calculate final state for a single item considering all its operations
   */
  private async calculateItemFinalState(
    currentItem: any,
    operations: StockUpdateOperation[],
    tx: PrismaTransaction,
  ): Promise<StockCalculationResult> {
    const result: StockCalculationResult = {
      itemId: currentItem.id,
      itemName: currentItem.name,
      currentQuantity: currentItem.quantity,
      finalQuantity: currentItem.quantity,
      quantityChange: 0,
      isValid: true,
      errors: [],
      warnings: [],
      stockLevel: STOCK_LEVEL.OPTIMAL,
      hasActiveOrders: false,
      reorderPoint: currentItem.reorderPoint,
      maxQuantity: currentItem.maxQuantity,
      operations: operations,
    };

    try {
      // Calculate net change from all operations
      let netChange = 0;

      for (const operation of operations) {
        // Handle updates by first reversing the old operation
        if (operation.activityId) {
          const existingActivity = await tx.activity.findUnique({
            where: { id: operation.activityId },
            select: {
              id: true,
              quantity: true,
              operation: true,
              itemId: true,
            },
          });

          if (existingActivity) {
            // Only reverse if the activity is for this item
            if (existingActivity.itemId === currentItem.id) {
              const reverseChange =
                existingActivity.operation === ACTIVITY_OPERATION.INBOUND
                  ? -existingActivity.quantity
                  : existingActivity.quantity;
              netChange += reverseChange;
            }
          } else {
            result.errors.push(`Atividade ${operation.activityId} não encontrada para atualização`);
            result.isValid = false;
            continue;
          }
        }

        // Apply the new operation
        const change =
          operation.operation === ACTIVITY_OPERATION.INBOUND
            ? operation.quantity
            : -operation.quantity;
        netChange += change;
      }

      result.quantityChange = netChange;
      result.finalQuantity = currentItem.quantity + netChange;

      // Validate item constraints
      await this.validateItemConstraints(result, currentItem, tx);

      // Calculate stock level and warnings
      await this.calculateStockLevel(result, currentItem, tx);
    } catch (error) {
      this.logger.error(`Error calculating final state for item ${currentItem.id}:`, error);
      result.errors.push(
        `Erro ao calcular estado final: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate item-specific constraints
   */
  private async validateItemConstraints(
    result: StockCalculationResult,
    currentItem: any,
    tx: PrismaTransaction,
  ): Promise<void> {
    // Check if item is active
    if (!currentItem.isActive) {
      result.isValid = false;
      result.errors.push(`Item "${currentItem.name}" está inativo e não pode ser movimentado`);
      return;
    }

    // Validate final quantity constraints
    if (result.finalQuantity < 0) {
      result.isValid = false;
      result.errors.push(
        `Operação resultaria em estoque negativo. ` +
          `Atual: ${result.currentQuantity}, ` +
          `Mudança: ${result.quantityChange}, ` +
          `Final: ${result.finalQuantity}`,
      );
    }

    // Check maximum quantity constraint
    if (currentItem.maxQuantity && result.finalQuantity > currentItem.maxQuantity) {
      result.isValid = false;
      result.errors.push(
        `Operação excederia o limite máximo de estoque. ` +
          `Máximo: ${currentItem.maxQuantity}, ` +
          `Final: ${result.finalQuantity}`,
      );
    }

    // Validate operation-specific constraints
    for (const operation of result.operations) {
      await this.validateOperationConstraints(operation, result, currentItem, tx);
    }
  }

  /**
   * Validate operation-specific business rules
   */
  private async validateOperationConstraints(
    operation: StockUpdateOperation,
    result: StockCalculationResult,
    currentItem: any,
    tx: PrismaTransaction,
  ): Promise<void> {
    // Validate reason-specific constraints
    if (operation.reason) {
      switch (operation.reason) {
        case ACTIVITY_REASON.ORDER_RECEIVED:
          if (operation.operation !== ACTIVITY_OPERATION.INBOUND) {
            result.errors.push('Recebimento de pedido deve ser uma operação de entrada');
            result.isValid = false;
          }
          // Validate order constraints if orderId is provided
          if (operation.orderId) {
            await this.validateOrderConstraints(operation, result, tx);
          }
          break;

        case ACTIVITY_REASON.PRODUCTION_USAGE:
          if (operation.operation !== ACTIVITY_OPERATION.OUTBOUND) {
            result.errors.push('Uso em produção deve ser uma operação de saída');
            result.isValid = false;
          }
          break;

        case ACTIVITY_REASON.RETURN:
          if (operation.operation !== ACTIVITY_OPERATION.INBOUND) {
            result.errors.push('Retorno deve ser uma operação de entrada');
            result.isValid = false;
          }
          break;

        case ACTIVITY_REASON.BORROW:
          if (operation.operation !== ACTIVITY_OPERATION.OUTBOUND) {
            result.errors.push('Empréstimo deve ser uma operação de saída');
            result.isValid = false;
          }
          if (!operation.userId) {
            result.errors.push('Empréstimo deve ter um usuário associado');
            result.isValid = false;
          }
          break;
      }
    }

    // Validate user constraints
    if (operation.userId) {
      await this.validateUserConstraints(operation, result, tx);
    }
  }

  /**
   * Validate order-related constraints
   */
  private async validateOrderConstraints(
    operation: StockUpdateOperation,
    result: StockCalculationResult,
    tx: PrismaTransaction,
  ): Promise<void> {
    if (!operation.orderId) return;

    const order = await tx.order.findUnique({
      where: { id: operation.orderId },
      select: { id: true, status: true },
    });

    if (!order) {
      result.errors.push(`Pedido ${operation.orderId} não encontrado`);
      result.isValid = false;
      return;
    }

    // Check if order is in valid status for receiving
    const validStatuses = [
      ORDER_STATUS.CREATED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.PARTIALLY_RECEIVED,
    ];
    if (!validStatuses.includes(order.status as any)) {
      result.errors.push(
        `Pedido ${operation.orderId} está em status inválido para recebimento: ${order.status}`,
      );
      result.isValid = false;
      return;
    }

    // Validate order item constraints if orderItemId is provided
    if (operation.orderItemId) {
      const orderItem = await tx.orderItem.findUnique({
        where: { id: operation.orderItemId },
        select: {
          id: true,
          itemId: true,
          orderedQuantity: true,
          receivedQuantity: true,
          orderId: true,
        },
      });

      if (!orderItem) {
        result.errors.push(`Item do pedido ${operation.orderItemId} não encontrado`);
        result.isValid = false;
        return;
      }

      if (orderItem.orderId !== operation.orderId) {
        result.errors.push(
          `Item do pedido ${operation.orderItemId} não pertence ao pedido ${operation.orderId}`,
        );
        result.isValid = false;
        return;
      }

      if (orderItem.itemId !== operation.itemId) {
        result.errors.push(
          `Item do pedido ${operation.orderItemId} não corresponde ao item ${operation.itemId}`,
        );
        result.isValid = false;
        return;
      }

      // Check if received quantity would exceed ordered quantity
      if (operation.operation === ACTIVITY_OPERATION.INBOUND) {
        const newReceived = orderItem.receivedQuantity + operation.quantity;
        if (newReceived > orderItem.orderedQuantity) {
          result.errors.push(
            `Quantidade recebida excederia a quantidade pedida. ` +
              `Pedido: ${orderItem.orderedQuantity}, ` +
              `Já recebido: ${orderItem.receivedQuantity}, ` +
              `Tentando adicionar: ${operation.quantity}`,
          );
          result.isValid = false;
        }
      } else {
        // OUTBOUND operation - reducing received quantity
        const newReceived = orderItem.receivedQuantity - operation.quantity;
        if (newReceived < 0) {
          result.errors.push(
            `Operação resultaria em quantidade recebida negativa. ` +
              `Recebido: ${orderItem.receivedQuantity}, ` +
              `Tentando remover: ${operation.quantity}`,
          );
          result.isValid = false;
        }
      }
    }
  }

  /**
   * Validate user-related constraints
   */
  private async validateUserConstraints(
    operation: StockUpdateOperation,
    result: StockCalculationResult,
    tx: PrismaTransaction,
  ): Promise<void> {
    if (!operation.userId) return;

    const user = await tx.user.findUnique({
      where: { id: operation.userId },
      select: { id: true, status: true, name: true },
    });

    if (!user) {
      result.errors.push(`Usuário ${operation.userId} não encontrado`);
      result.isValid = false;
      return;
    }

    if (user.status === 'DISMISSED') {
      result.errors.push(`Usuário "${user.name}" não está ativo`);
      result.isValid = false;
    }
  }

  /**
   * Calculate stock level and add warnings
   */
  private async calculateStockLevel(
    result: StockCalculationResult,
    currentItem: any,
    tx: PrismaTransaction,
  ): Promise<void> {
    // Check for active orders
    const activeOrderStatuses = [
      ORDER_STATUS.PARTIALLY_FULFILLED,
      ORDER_STATUS.FULFILLED,
      ORDER_STATUS.PARTIALLY_RECEIVED,
    ];
    const hasActiveOrder = await tx.orderItem.findFirst({
      where: {
        itemId: currentItem.id,
        order: {
          status: { in: activeOrderStatuses },
        },
      },
    });

    result.hasActiveOrders = !!hasActiveOrder;

    // Determine stock level using the utility function
    result.stockLevel = determineStockLevel(
      result.finalQuantity,
      currentItem.reorderPoint,
      currentItem.maxQuantity,
      result.hasActiveOrders,
    );

    // Add warnings based on stock level
    if (result.stockLevel === STOCK_LEVEL.CRITICAL && result.isValid) {
      result.warnings.push(
        `Item ficará em nível crítico (${result.finalQuantity} unidades)` +
          (currentItem.reorderPoint ? `. Ponto de reposição: ${currentItem.reorderPoint}` : ''),
      );
    } else if (result.stockLevel === STOCK_LEVEL.LOW && result.isValid) {
      result.warnings.push(
        `Item ficará com estoque baixo (${result.finalQuantity} unidades), mas há pedidos ativos`,
      );
    } else if (result.stockLevel === STOCK_LEVEL.OVERSTOCKED && result.isValid) {
      result.warnings.push(`Item ficará com excesso de estoque (${result.finalQuantity} unidades)`);
    } else if (result.stockLevel === STOCK_LEVEL.NEGATIVE_STOCK) {
      // This should already be caught in validation, but add warning just in case
      result.warnings.push(`Item ficará com estoque negativo (${result.finalQuantity} unidades)`);
    }
  }

  /**
   * Perform global validations that span multiple items
   */
  private async performGlobalValidations(
    plan: AtomicStockUpdatePlan,
    tx: PrismaTransaction,
  ): Promise<void> {
    // Validate total operation count
    if (plan.totalOperations > 1000) {
      plan.globalErrors.push(
        `Número de operações excede o limite máximo (1000). Atual: ${plan.totalOperations}`,
      );
      return;
    }

    // Check for duplicate operations on the same activity
    const activityIds = plan.operations
      .map(op => op.activityId)
      .filter((id, index, arr) => id && arr.indexOf(id) === index);

    if (activityIds.length !== plan.operations.filter(op => op.activityId).length) {
      plan.globalErrors.push('Detectadas operações duplicadas na mesma atividade');
    }

    // Validate that all users mentioned in operations are active
    const userIds = [...new Set(plan.operations.map(op => op.userId).filter(Boolean))];
    if (userIds.length > 0) {
      const inactiveUsers = await tx.user.findMany({
        where: {
          id: { in: userIds as string[] },
          status: 'DISMISSED',
        },
        select: { id: true, name: true, status: true },
      });

      if (inactiveUsers.length > 0) {
        plan.globalErrors.push(
          `Usuários inativos detectados: ${inactiveUsers.map(u => `${u.name} (${u.status})`).join(', ')}`,
        );
      }
    }

    // Validate orders status
    const orderIds = [...new Set(plan.operations.map(op => op.orderId).filter(Boolean))];
    if (orderIds.length > 0) {
      const invalidOrders = await tx.order.findMany({
        where: {
          id: { in: orderIds as string[] },
          status: { in: [ORDER_STATUS.CANCELLED] },
        },
        select: { id: true, status: true, description: true },
      });

      if (invalidOrders.length > 0) {
        plan.globalErrors.push(
          `Pedidos cancelados detectados: ${invalidOrders.map(o => `${o.description || o.id} (${o.status})`).join(', ')}`,
        );
      }
    }

    // Check for potential deadlocks (operations on the same items in different orders)
    const itemGroups = new Map<string, Set<string>>();
    for (const operation of plan.operations) {
      if (!itemGroups.has(operation.itemId)) {
        itemGroups.set(operation.itemId, new Set());
      }
      if (operation.orderId) {
        itemGroups.get(operation.itemId)!.add(operation.orderId);
      }
    }

    // Warn about operations affecting the same item from multiple orders
    for (const [itemId, orderIds] of itemGroups) {
      if (orderIds.size > 1) {
        const calculation = plan.calculations.find(c => c.itemId === itemId);
        if (calculation) {
          calculation.warnings.push(
            `Item sendo afetado por múltiplos pedidos simultaneamente: ${Array.from(orderIds).join(', ')}`,
          );
        }
      }
    }
  }

  /**
   * Get a summary of the calculation plan for logging/debugging
   */
  getSummary(plan: AtomicStockUpdatePlan): string {
    const summary = [
      `=== ATOMIC STOCK UPDATE PLAN SUMMARY ===`,
      `Total Operations: ${plan.totalOperations}`,
      `Affected Items: ${plan.affectedItems.size}`,
      `Valid: ${plan.isValid}`,
      `Can Proceed: ${plan.canProceed}`,
      `Execution Time: ${plan.estimatedExecutionTime}ms`,
      ``,
    ];

    if (plan.globalErrors.length > 0) {
      summary.push(`Global Errors (${plan.globalErrors.length}):`);
      plan.globalErrors.forEach((error, i) => summary.push(`  ${i + 1}. ${error}`));
      summary.push('');
    }

    if (plan.calculations.length > 0) {
      summary.push(`Item Calculations:`);
      plan.calculations.forEach((calc, i) => {
        summary.push(`  ${i + 1}. ${calc.itemName} (${calc.itemId})`);
        summary.push(
          `     Current: ${calc.currentQuantity}, Change: ${calc.quantityChange}, Final: ${calc.finalQuantity}`,
        );
        summary.push(`     Stock Level: ${calc.stockLevel}, Valid: ${calc.isValid}`);

        if (calc.errors.length > 0) {
          summary.push(`     Errors: ${calc.errors.join('; ')}`);
        }

        if (calc.warnings.length > 0) {
          summary.push(`     Warnings: ${calc.warnings.join('; ')}`);
        }
        summary.push('');
      });
    }

    return summary.join('\n');
  }
}
