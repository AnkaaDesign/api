import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, Query } from '@nestjs/common';
import {
  AutoOrderService,
  autoOrderCreateSchema,
  type AutoOrderCreateFormData,
} from './auto-order.service';
import { UserId } from '../../common/auth/decorators/user.decorator';
import { Roles } from '@modules/common/auth/decorators/roles.decorator';
import { SECTOR_PRIVILEGES } from '../../../constants/enums';
import {
  ZodQueryValidationPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';

// =====================
// Zod Schemas for Auto-Order API
// =====================
// GET  /orders/auto/analyze  → recommendations, grouped by supplier.
// POST /orders/auto/create   → turn selected recommendations into real orders.
//   The client resolves the grouping (combined / per-supplier / per-item /
//   per-category for the no-supplier bucket); the service derives unit price +
//   ICMS/IPI from each item and persists every group via
//   OrderService.batchCreate.

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

export type AutoOrderAnalysisQueryFormData = z.infer<typeof autoOrderAnalysisQuerySchema>;

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
   * POST /orders/auto/create
   * Create real orders from selected auto-order recommendations. The request
   * body carries pre-grouped orders (one per supplier, combined, per-item, or
   * per-category); the service derives price/taxes and persists each group.
   */
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  async createOrders(
    @Body(new ZodValidationPipe(autoOrderCreateSchema)) body: AutoOrderCreateFormData,
    @UserId() userId: string,
  ) {
    this.logger.log(
      `User ${userId} creating ${body.orders.length} order(s) from auto-order recommendations`,
    );
    return this.autoOrderService.createOrdersFromRecommendations(body, userId);
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
