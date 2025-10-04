// apps/api/src/modules/inventory/services/atomic-stock-update.service.ts

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaTransaction } from '../activity/repositories/activity.repository';
import {
  AtomicStockCalculatorService,
  AtomicStockUpdatePlan,
  StockCalculationResult,
} from './atomic-stock-calculator.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import {
  ENTITY_TYPE,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  ACTIVITY_OPERATION,
  ORDER_STATUS,
} from '../../../constants/enums';

export interface StockUpdateResult {
  success: boolean;
  message: string;
  affectedItems: string[];
  appliedOperations: number;
  errors: string[];
  warnings: string[];
  calculations: StockCalculationResult[];
  executionTime: number;
  itemUpdates: Array<{
    itemId: string;
    itemName: string;
    oldQuantity: number;
    newQuantity: number;
    change: number;
  }>;
  orderUpdates: Array<{
    orderId: string;
    orderItemId: string;
    oldReceived: number;
    newReceived: number;
    change: number;
  }>;
}

@Injectable()
export class AtomicStockUpdateService {
  private readonly logger = new Logger(AtomicStockUpdateService.name);

  constructor(
    private readonly calculator: AtomicStockCalculatorService,
    private readonly changeLogService: ChangeLogService,
  ) {}

  /**
   * Execute atomic stock update with pre-validation
   */
  async executeAtomicUpdate(
    plan: AtomicStockUpdatePlan,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<StockUpdateResult> {
    const startTime = Date.now();

    if (!plan.canProceed) {
      const allErrors = [...plan.globalErrors, ...plan.calculations.flatMap(c => c.errors)];
      throw new BadRequestException(
        `Não é possível executar as operações de estoque:\n` +
          allErrors.map((error, i) => `${i + 1}. ${error}`).join('\n'),
      );
    }

    try {
      const result: StockUpdateResult = {
        success: false,
        message: '',
        affectedItems: Array.from(plan.affectedItems),
        appliedOperations: 0,
        errors: [],
        warnings: plan.calculations.flatMap(c => c.warnings),
        calculations: plan.calculations,
        executionTime: 0,
        itemUpdates: [],
        orderUpdates: [],
      };

      this.logger.debug(
        `Starting atomic stock update execution for ${plan.calculations.length} items`,
      );

      // Step 1: Apply all stock quantity updates atomically
      await this.updateItemQuantities(plan, result, tx, userId);

      // Step 2: Update order items if applicable
      await this.updateOrderItems(plan, result, tx, userId);

      // Step 3: Update order statuses
      await this.updateOrderStatuses(plan, result, tx, userId);

      // Step 4: Create stock level notifications if needed
      await this.createStockNotifications(plan, result, tx);

      result.success = true;
      result.executionTime = Date.now() - startTime;
      result.message = this.formatSuccessMessage(result);

      this.logger.log(
        `Atomic stock update completed successfully: ${result.appliedOperations} operations, ` +
          `${result.itemUpdates.length} items updated, ` +
          `${result.orderUpdates.length} order items updated, ` +
          `${result.warnings.length} warnings, ` +
          `execution time: ${result.executionTime}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error('Error executing atomic stock update:', error);

      // Provide detailed error information
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      throw new BadRequestException(
        `Falha na execução da atualização atômica de estoque:\n` +
          `Erro: ${errorMessage}\n` +
          `Itens afetados: ${Array.from(plan.affectedItems).join(', ')}\n` +
          `Operações planejadas: ${plan.totalOperations}`,
      );
    }
  }

  /**
   * Update item quantities for all affected items
   */
  private async updateItemQuantities(
    plan: AtomicStockUpdatePlan,
    result: StockUpdateResult,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    for (const calculation of plan.calculations) {
      if (Math.abs(calculation.quantityChange) < 0.001) {
        // Skip items with no meaningful quantity change
        continue;
      }

      try {
        // Update the item quantity
        await tx.item.update({
          where: { id: calculation.itemId },
          data: { quantity: calculation.finalQuantity },
        });

        // Record the item update
        result.itemUpdates.push({
          itemId: calculation.itemId,
          itemName: calculation.itemName,
          oldQuantity: calculation.currentQuantity,
          newQuantity: calculation.finalQuantity,
          change: calculation.quantityChange,
        });

        // Log the quantity change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ITEM,
          entityId: calculation.itemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'quantity',
          oldValue: calculation.currentQuantity,
          newValue: calculation.finalQuantity,
          reason: this.buildQuantityChangeReason(calculation),
          triggeredBy: CHANGE_TRIGGERED_BY.INVENTORY_ADJUSTMENT,
          triggeredById: calculation.itemId,
          userId: userId || '',
          transaction: tx,
        });

        result.appliedOperations++;

        this.logger.debug(
          `Updated item ${calculation.itemId} (${calculation.itemName}): ` +
            `${calculation.currentQuantity} → ${calculation.finalQuantity} ` +
            `(${calculation.quantityChange > 0 ? '+' : ''}${calculation.quantityChange})`,
        );
      } catch (error) {
        const errorMsg = `Erro ao atualizar quantidade do item ${calculation.itemName}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
        result.errors.push(errorMsg);
        this.logger.error(errorMsg, error);
        throw new BadRequestException(errorMsg);
      }
    }
  }

  /**
   * Update order items based on stock operations
   */
  private async updateOrderItems(
    plan: AtomicStockUpdatePlan,
    result: StockUpdateResult,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    const orderOperations = plan.operations.filter(op => op.orderId && op.orderItemId);

    if (orderOperations.length === 0) {
      return;
    }

    this.logger.debug(`Updating ${orderOperations.length} order items`);

    for (const operation of orderOperations) {
      if (!operation.orderId || !operation.orderItemId) continue;

      try {
        const orderItem = await tx.orderItem.findUnique({
          where: { id: operation.orderItemId },
          include: {
            order: { select: { id: true, description: true } },
            item: { select: { name: true } },
          },
        });

        if (!orderItem) {
          const errorMsg = `Item do pedido ${operation.orderItemId} não encontrado`;
          result.errors.push(errorMsg);
          this.logger.warn(errorMsg);
          continue;
        }

        const currentReceived = orderItem.receivedQuantity;
        const quantityChange =
          operation.operation === ACTIVITY_OPERATION.INBOUND
            ? operation.quantity
            : -operation.quantity;
        const newReceived = currentReceived + quantityChange;

        // Final validation (should have been caught in planning phase)
        if (newReceived > orderItem.orderedQuantity || newReceived < 0) {
          const errorMsg = `Quantidade recebida inválida para item do pedido ${operation.orderItemId}: ${newReceived}`;
          result.errors.push(errorMsg);
          throw new BadRequestException(errorMsg);
        }

        // Update order item
        await tx.orderItem.update({
          where: { id: operation.orderItemId },
          data: {
            receivedQuantity: newReceived,
            receivedAt:
              operation.operation === ACTIVITY_OPERATION.INBOUND && newReceived > 0
                ? new Date()
                : null,
          },
        });

        // Record the order update
        result.orderUpdates.push({
          orderId: operation.orderId,
          orderItemId: operation.orderItemId,
          oldReceived: currentReceived,
          newReceived: newReceived,
          change: quantityChange,
        });

        // Log the change
        await this.changeLogService.logChange({
          entityType: ENTITY_TYPE.ORDER_ITEM,
          entityId: operation.orderItemId,
          action: CHANGE_ACTION.UPDATE,
          field: 'receivedQuantity',
          oldValue: currentReceived,
          newValue: newReceived,
          reason: `Quantidade recebida atualizada por operação atômica: ${operation.operation} ${Math.abs(quantityChange)} unidades do item ${orderItem.item.name}`,
          triggeredBy: CHANGE_TRIGGERED_BY.ORDER_ITEM_SYNC,
          triggeredById: operation.orderItemId,
          userId: userId || '',
          transaction: tx,
        });

        this.logger.debug(
          `Updated order item ${operation.orderItemId} for order ${operation.orderId}: ` +
            `received ${currentReceived} → ${newReceived} (${quantityChange > 0 ? '+' : ''}${quantityChange})`,
        );
      } catch (error) {
        const errorMsg = `Erro ao atualizar item do pedido ${operation.orderItemId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
        result.errors.push(errorMsg);
        this.logger.error(errorMsg, error);
        throw new BadRequestException(errorMsg);
      }
    }
  }

  /**
   * Update order statuses based on received quantities
   */
  private async updateOrderStatuses(
    plan: AtomicStockUpdatePlan,
    result: StockUpdateResult,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    const orderIds = [...new Set(plan.operations.map(op => op.orderId).filter(Boolean))];

    if (orderIds.length === 0) {
      return;
    }

    this.logger.debug(`Checking status for ${orderIds.length} orders`);

    for (const orderId of orderIds) {
      try {
        await this.updateSingleOrderStatus(orderId as string, tx, userId);
      } catch (error) {
        const errorMsg = `Erro ao atualizar status do pedido ${orderId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
        result.errors.push(errorMsg);
        this.logger.error(errorMsg, error);
        // Don't throw here, as order status update is not critical for stock consistency
      }
    }
  }

  /**
   * Update status for a single order based on received quantities
   */
  private async updateSingleOrderStatus(
    orderId: string,
    tx: PrismaTransaction,
    userId?: string,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          select: {
            id: true,
            orderedQuantity: true,
            receivedQuantity: true,
          },
        },
      },
    });

    if (!order) {
      this.logger.warn(`Order ${orderId} not found for status update`);
      return;
    }

    // Calculate order status based on received quantities
    const allReceived = order.items.every(item => item.receivedQuantity >= item.orderedQuantity);
    const someReceived = order.items.some(item => item.receivedQuantity > 0);
    const noneReceived = order.items.every(item => item.receivedQuantity === 0);

    let newStatus = order.status;

    if (allReceived && order.items.length > 0) {
      newStatus = ORDER_STATUS.RECEIVED;
    } else if (someReceived) {
      newStatus = ORDER_STATUS.PARTIALLY_RECEIVED;
    } else if (noneReceived && order.status === ORDER_STATUS.RECEIVED) {
      // If was fully received and now has nothing received, go back to fulfilled
      newStatus = ORDER_STATUS.FULFILLED;
    }

    // Update order status if it changed
    if (newStatus !== order.status) {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          // Order completion is now tracked at the item level via fulfilledAt
        },
      });

      // Log the status change
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.ORDER,
        entityId: orderId,
        action: CHANGE_ACTION.UPDATE,
        field: 'status',
        oldValue: order.status,
        newValue: newStatus,
        reason: `Status atualizado automaticamente por operações atômicas de estoque`,
        triggeredBy: CHANGE_TRIGGERED_BY.ACTIVITY_SYNC,
        triggeredById: orderId,
        userId: userId || '',
        transaction: tx,
      });

      this.logger.debug(`Updated order ${orderId} status: ${order.status} → ${newStatus}`);
    }
  }

  /**
   * Create stock level notifications for items that need attention
   */
  private async createStockNotifications(
    plan: AtomicStockUpdatePlan,
    result: StockUpdateResult,
    tx: PrismaTransaction,
  ): Promise<void> {
    // This would integrate with a notification service when available
    const criticalItems = plan.calculations.filter(
      calc => calc.stockLevel === 'CRITICAL' || calc.stockLevel === 'LOW',
    );

    for (const item of criticalItems) {
      const levelText = item.stockLevel === 'CRITICAL' ? 'crítico' : 'baixo';
      const reorderInfo = item.reorderPoint ? `, Ponto de reposição: ${item.reorderPoint}` : '';

      this.logger.warn(
        `Alerta de estoque ${levelText}: ${item.itemName} (${item.itemId}) ` +
          `ficou com ${item.finalQuantity} unidades${reorderInfo}`,
      );

      // TODO: Integrate with notification service when available
      // await this.notificationService.createStockAlert({
      //   itemId: item.itemId,
      //   itemName: item.itemName,
      //   currentQuantity: item.finalQuantity,
      //   stockLevel: item.stockLevel,
      //   reorderPoint: item.reorderPoint
      // });
    }
  }

  /**
   * Build a descriptive reason for quantity changes
   */
  private buildQuantityChangeReason(calculation: StockCalculationResult): string {
    const operations = calculation.operations;

    if (operations.length === 1) {
      const op = operations[0];
      const direction = op.operation === ACTIVITY_OPERATION.INBOUND ? 'entrada' : 'saída';
      const reason = op.reason ? ` (${op.reason})` : '';
      return `Atualização atômica: ${direction} de ${op.quantity} unidades${reason}`;
    } else {
      const inbound = operations.filter(op => op.operation === ACTIVITY_OPERATION.INBOUND);
      const outbound = operations.filter(op => op.operation === ACTIVITY_OPERATION.OUTBOUND);

      let description = 'Atualização atômica múltipla:';

      if (inbound.length > 0) {
        const totalIn = inbound.reduce((sum, op) => sum + op.quantity, 0);
        description += ` +${totalIn} entrada`;
      }

      if (outbound.length > 0) {
        const totalOut = outbound.reduce((sum, op) => sum + op.quantity, 0);
        description += ` -${totalOut} saída`;
      }

      return description;
    }
  }

  /**
   * Format success message based on results
   */
  private formatSuccessMessage(result: StockUpdateResult): string {
    const parts: string[] = [];

    if (result.itemUpdates.length === 1) {
      parts.push('1 item atualizado');
    } else if (result.itemUpdates.length > 1) {
      parts.push(`${result.itemUpdates.length} itens atualizados`);
    }

    if (result.orderUpdates.length === 1) {
      parts.push('1 item de pedido atualizado');
    } else if (result.orderUpdates.length > 1) {
      parts.push(`${result.orderUpdates.length} itens de pedido atualizados`);
    }

    if (result.warnings.length > 0) {
      parts.push(`${result.warnings.length} aviso(s)`);
    }

    const message =
      parts.length > 0
        ? `Atualização atômica concluída: ${parts.join(', ')}`
        : 'Atualização atômica concluída sem alterações';

    return `${message}. Tempo de execução: ${result.executionTime}ms`;
  }

  /**
   * Get detailed execution summary for logging
   */
  getExecutionSummary(result: StockUpdateResult): string {
    const summary = [
      `=== ATOMIC STOCK UPDATE EXECUTION SUMMARY ===`,
      `Success: ${result.success}`,
      `Execution Time: ${result.executionTime}ms`,
      `Applied Operations: ${result.appliedOperations}`,
      `Affected Items: ${result.affectedItems.length}`,
      ``,
    ];

    if (result.itemUpdates.length > 0) {
      summary.push(`Item Updates (${result.itemUpdates.length}):`);
      result.itemUpdates.forEach((update, i) => {
        summary.push(`  ${i + 1}. ${update.itemName} (${update.itemId})`);
        summary.push(
          `     ${update.oldQuantity} → ${update.newQuantity} (${update.change > 0 ? '+' : ''}${update.change})`,
        );
      });
      summary.push('');
    }

    if (result.orderUpdates.length > 0) {
      summary.push(`Order Item Updates (${result.orderUpdates.length}):`);
      result.orderUpdates.forEach((update, i) => {
        summary.push(`  ${i + 1}. Order ${update.orderId}, Item ${update.orderItemId}`);
        summary.push(
          `     Received: ${update.oldReceived} → ${update.newReceived} (${update.change > 0 ? '+' : ''}${update.change})`,
        );
      });
      summary.push('');
    }

    if (result.warnings.length > 0) {
      summary.push(`Warnings (${result.warnings.length}):`);
      result.warnings.forEach((warning, i) => summary.push(`  ${i + 1}. ${warning}`));
      summary.push('');
    }

    if (result.errors.length > 0) {
      summary.push(`Errors (${result.errors.length}):`);
      result.errors.forEach((error, i) => summary.push(`  ${i + 1}. ${error}`));
      summary.push('');
    }

    return summary.join('\n');
  }
}
