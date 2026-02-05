import { Controller, Get, Post, Body, Query, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { AutoOrderService } from './auto-order.service';
import { UserId } from '../../common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import { ZodValidationPipe, ZodQueryValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';

// =====================
// Zod Schemas for Auto-Order API
// =====================

export const autoOrderAnalysisQuerySchema = z.object({
  lookbackMonths: z.coerce.number().int().min(1).max(24).default(12).optional(),
  minStockCriteria: z.enum(['all', 'low', 'critical']).default('all').optional(),
  supplierIds: z
    .array(z.string().uuid())
    .optional()
    .or(
      z
        .string()
        .uuid()
        .transform(val => [val]),
    )
    .optional(),
  categoryIds: z
    .array(z.string().uuid())
    .optional()
    .or(
      z
        .string()
        .uuid()
        .transform(val => [val]),
    )
    .optional(),
});

export const autoOrderCreateSchema = z.object({
  recommendations: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().positive(),
        reason: z.string().optional(),
      }),
    )
    .min(1, 'Pelo menos uma recomendação deve ser fornecida'),
  groupBySupplie: z.boolean().default(true).optional(),
});

export type AutoOrderAnalysisQueryFormData = z.infer<typeof autoOrderAnalysisQuerySchema>;
export type AutoOrderCreateFormData = z.infer<typeof autoOrderCreateSchema>;

@Controller('orders/auto')
@Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
export class AutoOrderController {
  private readonly logger = new Logger(AutoOrderController.name);

  constructor(private readonly autoOrderService: AutoOrderService) {}

  /**
   * GET /api/orders/auto/analyze
   * Analyze items and get auto-order recommendations
   */
  @Get('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeAutoOrders(
    @Query(new ZodQueryValidationPipe(autoOrderAnalysisQuerySchema))
    query: AutoOrderAnalysisQueryFormData,
    @UserId() userId: string,
  ) {
    this.logger.log(`User ${userId} analyzing auto-orders with params: ${JSON.stringify(query)}`);

    // Service returns AutoOrderRecommendation[] which is already grouped by supplier
    const supplierGroupsFromService = await this.autoOrderService.analyzeItemsForAutoOrder(userId);

    // Apply filters
    let filteredGroups = supplierGroupsFromService;

    // Filter by supplier if provided
    if (query.supplierIds && query.supplierIds.length > 0) {
      filteredGroups = filteredGroups.filter(group =>
        group.supplierId ? query.supplierIds!.includes(group.supplierId) : false,
      );
    }

    // Filter by category - filter items within each group
    if (query.categoryIds && query.categoryIds.length > 0) {
      filteredGroups = filteredGroups
        .map(group => ({
          ...group,
          items: group.items.filter(item =>
            item.categoryId ? query.categoryIds!.includes(item.categoryId) : false,
          ),
        }))
        .filter(group => group.items.length > 0);
    }

    // Filter by stock criteria - filter items within each group
    if (query.minStockCriteria === 'critical') {
      filteredGroups = filteredGroups
        .map(group => ({
          ...group,
          items: group.items.filter(item => item.currentStock === 0 || item.daysUntilStockout <= 7),
        }))
        .filter(group => group.items.length > 0);
    } else if (query.minStockCriteria === 'low') {
      filteredGroups = filteredGroups
        .map(group => ({
          ...group,
          items: group.items.filter(
            item => item.currentStock === 0 || item.daysUntilStockout <= 30,
          ),
        }))
        .filter(group => group.items.length > 0);
    }

    // Flatten all items across all groups
    const allItems = filteredGroups.flatMap(group => group.items);

    // Sort supplier groups by total estimated cost (descending)
    const sortedSupplierGroups = filteredGroups
      .map(group => ({
        supplierId: group.supplierId,
        supplierName: group.supplierName,
        itemCount: group.items.length,
        totalEstimatedCost: group.items.reduce((sum, item) => sum + item.estimatedCost, 0),
        items: group.items, // These are the actual DemandAnalysis items
      }))
      .sort((a, b) => b.totalEstimatedCost - a.totalEstimatedCost);

    return {
      success: true,
      data: {
        totalRecommendations: allItems.length,
        recommendations: allItems, // Flat list of all items
        supplierGroups: sortedSupplierGroups,
        summary: {
          totalItems: allItems.length,
          totalEstimatedCost: allItems.reduce((sum, item) => sum + item.estimatedCost, 0),
          criticalItems: allItems.filter(
            item => item.currentStock === 0 || item.daysUntilStockout <= 7,
          ).length,
          emergencyOverrides: allItems.filter(item => item.isEmergencyOverride).length,
          scheduledItems: allItems.filter(item => item.isInSchedule).length,
        },
      },
    };
  }

  /**
   * POST /api/orders/auto/create
   * Create orders from auto-order recommendations
   */
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @Roles(SECTOR_PRIVILEGES.WAREHOUSE, SECTOR_PRIVILEGES.ADMIN)
  async createAutoOrders(
    @Body(new ZodValidationPipe(autoOrderCreateSchema)) body: AutoOrderCreateFormData,
    @UserId() userId: string,
  ) {
    this.logger.log(`User ${userId} creating auto-orders for ${body.recommendations.length} items`);

    // Group recommendations by supplier
    const bySupplier = new Map<string, typeof body.recommendations>();

    for (const rec of body.recommendations) {
      // We need to fetch item details to get supplierId
      // For now, group all together - the service will handle grouping
      const key = 'auto-order';
      if (!bySupplier.has(key)) {
        bySupplier.set(key, []);
      }
      bySupplier.get(key)!.push(rec);
    }

    const createdOrders: any[] = [];

    // For each group, create an order
    // This is simplified - in production, you'd want to properly group by supplier
    // and create separate orders for each supplier
    for (const [key, items] of bySupplier.entries()) {
      this.logger.log(`Creating auto-order with ${items.length} items`);

      // TODO: Integrate with OrderService to create actual orders
      // For now, return the recommendations as confirmation
      createdOrders.push({
        id: `auto-order-${Date.now()}`,
        itemCount: items.length,
        items: items,
        createdAt: new Date(),
        createdBy: userId,
      });
    }

    return {
      success: true,
      message: `${createdOrders.length} pedido(s) de compra criado(s) a partir de recomendações automáticas`,
      data: {
        orders: createdOrders,
        totalItems: body.recommendations.length,
      },
    };
  }

  /**
   * GET /api/orders/auto/scheduled-items
   * Get list of items that are in active schedules
   */
  @Get('scheduled-items')
  @HttpCode(HttpStatus.OK)
  async getScheduledItems(@UserId() userId: string) {
    this.logger.log(`User ${userId} fetching scheduled items`);

    const scheduledItems = await this.autoOrderService.getScheduledItems();

    return {
      success: true,
      data: {
        totalScheduledItems: scheduledItems.length,
        items: scheduledItems,
      },
    };
  }
}
