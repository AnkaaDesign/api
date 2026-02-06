import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { NotificationDispatchService } from '@modules/common/notification/notification-dispatch.service';
import { DeepLinkService } from '@modules/common/notification/deep-link.service';
import {
  ItemLowStockEvent,
  ItemOutOfStockEvent,
  ItemReorderRequiredEvent,
  ItemOverstockEvent,
} from './item.events';

/**
 * ItemListener handles stock-related events and dispatches notifications
 * using configuration-based dispatch for role-based targeting and multi-channel delivery.
 *
 * All item stock events are system-triggered (no actor user).
 *
 * Config keys (from all-notifications.seed.ts):
 * - item.low_stock
 * - item.out_of_stock
 * - item.reorder_required
 * - item.overstock
 */
@Injectable()
export class ItemListener {
  private readonly logger = new Logger(ItemListener.name);

  constructor(
    @Inject('EventEmitter') private readonly eventEmitter: EventEmitter,
    private readonly prisma: PrismaService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly deepLinkService: DeepLinkService,
  ) {
    this.registerEventListeners();
  }

  /**
   * Register all event listeners
   */
  private registerEventListeners(): void {
    this.eventEmitter.on('item.low-stock', this.handleLowStock.bind(this));
    this.eventEmitter.on('item.out-of-stock', this.handleOutOfStock.bind(this));
    this.eventEmitter.on('item.reorder-required', this.handleReorderRequired.bind(this));
    this.eventEmitter.on('item.overstock', this.handleOverstock.bind(this));

    this.logger.log('Item stock event listeners registered successfully');
  }

  /**
   * Format item details for notification body
   */
  private formatItemDetails(item: any): string {
    const details = [];

    if (item.uniCode) {
      details.push(`Codigo: ${item.uniCode}`);
    }

    if (item.brand?.name) {
      details.push(`Marca: ${item.brand.name}`);
    }

    if (item.category?.name) {
      details.push(`Categoria: ${item.category.name}`);
    }

    return details.length > 0 ? `\n${details.join(' | ')}` : '';
  }

  /**
   * Handle low stock event
   * Config key: item.low_stock
   */
  async handleLowStock(event: ItemLowStockEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling low stock event for item ${event.item.id}: ${event.currentQuantity}/${event.reorderPoint}`,
      );

      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const deepLinks = this.deepLinkService.generateItemLinks(item.id);

      const title = 'Estoque Baixo';
      const body = `O item "${item.name}" esta com estoque baixo.${itemDetails}\n\nEstoque atual: ${event.currentQuantity} unidades\nPonto de recompra: ${event.reorderPoint} unidades\n\nRecomenda-se verificar e realizar pedido de reposicao.`;

      await this.dispatchService.dispatchByConfiguration(
        'item.low_stock',
        'system',
        {
          entityType: 'Item',
          entityId: item.id,
          action: 'low_stock',
          data: {
            itemName: item.name,
            itemCode: item.uniCode,
            currentQuantity: event.currentQuantity,
            minimumQuantity: event.reorderPoint,
            category: item.category?.name || '',
          },
          metadata: { itemId: item.id },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/produtos/detalhes/${item.id}`,
            relatedEntityType: 'ITEM',
            title,
            body,
          },
        },
      );

      this.logger.log('Low stock notification dispatched via configuration');
    } catch (error) {
      this.logger.error('Error handling low stock event:', error);
    }
  }

  /**
   * Handle out of stock event
   * Config key: item.out_of_stock
   */
  async handleOutOfStock(event: ItemOutOfStockEvent): Promise<void> {
    try {
      this.logger.log(`Handling out of stock event for item ${event.item.id}`);

      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const deepLinks = this.deepLinkService.generateItemLinks(item.id);

      const supplierInfo = item.supplier
        ? `\nFornecedor: ${item.supplier.fantasyName || item.supplier.corporateName}`
        : '';

      const title = 'Estoque Esgotado';
      const body = `O item "${item.name}" esta ESGOTADO.${itemDetails}${supplierInfo}\n\nEstoque atual: 0 unidades\n\nAcao urgente necessaria para repor o item.`;

      await this.dispatchService.dispatchByConfiguration(
        'item.out_of_stock',
        'system',
        {
          entityType: 'Item',
          entityId: item.id,
          action: 'out_of_stock',
          data: {
            itemName: item.name,
            itemCode: item.uniCode,
            category: item.category?.name || '',
          },
          metadata: { itemId: item.id },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/produtos/detalhes/${item.id}`,
            relatedEntityType: 'ITEM',
            title,
            body,
          },
        },
      );

      this.logger.log('Out of stock notification dispatched via configuration');
    } catch (error) {
      this.logger.error('Error handling out of stock event:', error);
    }
  }

  /**
   * Handle reorder required event
   * Config key: item.reorder_required
   */
  async handleReorderRequired(event: ItemReorderRequiredEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling reorder required event for item ${event.item.id}: ${event.currentQuantity} (reorder qty: ${event.reorderQuantity})`,
      );

      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
          supplier: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const deepLinks = this.deepLinkService.generateItemLinks(item.id);

      const supplierInfo = item.supplier
        ? `\nFornecedor sugerido: ${item.supplier.fantasyName || item.supplier.corporateName}`
        : '';
      const leadTimeInfo = item.estimatedLeadTime
        ? `\nPrazo estimado de entrega: ${item.estimatedLeadTime} dias`
        : '';

      const title = 'Recompra Necessaria';
      const body = `O item "${item.name}" requer recompra.${itemDetails}${supplierInfo}${leadTimeInfo}\n\nEstoque atual: ${event.currentQuantity} unidades\nQuantidade sugerida para pedido: ${event.reorderQuantity} unidades\n\nRealize o pedido de compra.`;

      const preferredSupplier = item.supplier
        ? item.supplier.fantasyName || item.supplier.corporateName
        : '';

      await this.dispatchService.dispatchByConfiguration(
        'item.reorder_required',
        'system',
        {
          entityType: 'Item',
          entityId: item.id,
          action: 'reorder_required',
          data: {
            itemName: item.name,
            itemCode: item.uniCode,
            currentQuantity: event.currentQuantity,
            reorderPoint: event.currentQuantity,
            suggestedOrderQuantity: event.reorderQuantity,
            preferredSupplier,
            category: item.category?.name || '',
          },
          metadata: { itemId: item.id },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/produtos/detalhes/${item.id}`,
            relatedEntityType: 'ITEM',
            title,
            body,
          },
        },
      );

      this.logger.log('Reorder required notification dispatched via configuration');
    } catch (error) {
      this.logger.error('Error handling reorder required event:', error);
    }
  }

  /**
   * Handle overstock event
   * Config key: item.overstock
   */
  async handleOverstock(event: ItemOverstockEvent): Promise<void> {
    try {
      this.logger.log(
        `Handling overstock event for item ${event.item.id}: ${event.currentQuantity}/${event.maxQuantity}`,
      );

      const item = await this.prisma.item.findUnique({
        where: { id: event.item.id },
        include: {
          brand: true,
          category: true,
        },
      });

      if (!item) {
        this.logger.error(`Item ${event.item.id} not found`);
        return;
      }

      const itemDetails = this.formatItemDetails(item);
      const deepLinks = this.deepLinkService.generateItemLinks(item.id);
      const excess = event.currentQuantity - event.maxQuantity;

      const title = 'Excesso de Estoque';
      const body = `O item "${item.name}" esta com excesso de estoque.${itemDetails}\n\nEstoque atual: ${event.currentQuantity} unidades\nEstoque maximo: ${event.maxQuantity} unidades\nExcesso: ${excess} unidades\n\nVerifique possiveis desperdicios ou ajuste o estoque maximo.`;

      await this.dispatchService.dispatchByConfiguration(
        'item.overstock',
        'system',
        {
          entityType: 'Item',
          entityId: item.id,
          action: 'overstock',
          data: {
            itemName: item.name,
            itemCode: item.uniCode,
            currentQuantity: event.currentQuantity,
            maximumQuantity: event.maxQuantity,
            excessQuantity: excess,
            category: item.category?.name || '',
          },
          metadata: { itemId: item.id },
          overrides: {
            actionUrl: JSON.stringify(deepLinks),
            webUrl: `/estoque/produtos/detalhes/${item.id}`,
            relatedEntityType: 'ITEM',
            title,
            body,
          },
        },
      );

      this.logger.log('Overstock notification dispatched via configuration');
    } catch (error) {
      this.logger.error('Error handling overstock event:', error);
    }
  }
}
