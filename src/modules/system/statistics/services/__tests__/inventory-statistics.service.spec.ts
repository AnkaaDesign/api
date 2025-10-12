import { Test, TestingModule } from '@nestjs/testing';
import { InventoryStatisticsService } from '../inventory-statistics.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  InventoryOverviewQueryDto,
  StockLevelsQueryDto,
  ConsumptionTrendsQueryDto,
  AbcXyzAnalysisQueryDto,
  ReorderPointsQueryDto,
  SupplierPerformanceQueryDto,
} from '../../dto/query-statistics.dto';

describe('InventoryStatisticsService', () => {
  let service: InventoryStatisticsService;
  let prismaService: PrismaService;

  // Mock data
  const mockItems = [
    {
      id: 'item-1',
      name: 'Item A',
      quantity: 50,
      totalPrice: 5000,
      reorderPoint: 20,
      maxQuantity: 100,
      monthlyConsumption: 30,
      abcCategory: 'A',
      xyzCategory: 'X',
      categoryId: 'cat-1',
      brandId: 'brand-1',
      supplierId: 'supplier-1',
      isActive: true,
      category: { name: 'Category 1' },
      supplier: { fantasyName: 'Supplier 1' },
      reorderQuantity: 50,
      estimatedLeadTime: 15,
    },
    {
      id: 'item-2',
      name: 'Item B',
      quantity: 15,
      totalPrice: 1500,
      reorderPoint: 30,
      maxQuantity: 80,
      monthlyConsumption: 45,
      abcCategory: 'B',
      xyzCategory: 'Y',
      categoryId: 'cat-1',
      brandId: 'brand-2',
      supplierId: 'supplier-2',
      isActive: true,
      category: { name: 'Category 1' },
      supplier: { fantasyName: 'Supplier 2' },
      reorderQuantity: 40,
      estimatedLeadTime: 20,
    },
    {
      id: 'item-3',
      name: 'Item C',
      quantity: 0,
      totalPrice: 0,
      reorderPoint: 10,
      maxQuantity: 50,
      monthlyConsumption: 20,
      abcCategory: 'C',
      xyzCategory: 'Z',
      categoryId: 'cat-2',
      brandId: 'brand-1',
      supplierId: 'supplier-1',
      isActive: true,
      category: { name: 'Category 2' },
      supplier: { fantasyName: 'Supplier 1' },
      reorderQuantity: 30,
      estimatedLeadTime: 10,
    },
  ];

  const mockActivities = [
    {
      id: 'activity-1',
      quantity: 10,
      reason: 'PRODUCTION_USAGE',
      operation: 'OUTBOUND',
      createdAt: new Date('2024-01-15'),
      itemId: 'item-1',
      item: {
        id: 'item-1',
        name: 'Item A',
        category: { name: 'Category 1' },
      },
    },
    {
      id: 'activity-2',
      quantity: 20,
      reason: 'PRODUCTION_USAGE',
      operation: 'OUTBOUND',
      createdAt: new Date('2024-01-20'),
      itemId: 'item-2',
      item: {
        id: 'item-2',
        name: 'Item B',
        category: { name: 'Category 1' },
      },
    },
  ];

  const mockOrders = [
    {
      id: 'order-1',
      status: 'FULFILLED',
      createdAt: new Date('2024-01-10'),
      updatedAt: new Date('2024-01-15'),
      forecast: new Date('2024-01-14'),
      supplierId: 'supplier-1',
      supplier: {
        id: 'supplier-1',
        fantasyName: 'Supplier 1',
      },
      items: [
        {
          price: 100,
          tax: 10,
          orderedQuantity: 50,
          receivedQuantity: 50,
          receivedAt: new Date('2024-01-15'),
        },
      ],
    },
    {
      id: 'order-2',
      status: 'PARTIALLY_FULFILLED',
      createdAt: new Date('2024-01-12'),
      updatedAt: new Date('2024-01-18'),
      forecast: new Date('2024-01-16'),
      supplierId: 'supplier-2',
      supplier: {
        id: 'supplier-2',
        fantasyName: 'Supplier 2',
      },
      items: [
        {
          price: 200,
          tax: 20,
          orderedQuantity: 100,
          receivedQuantity: 80,
          receivedAt: new Date('2024-01-18'),
        },
      ],
    },
  ];

  // Mock Prisma Service
  const mockPrismaService = {
    item: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
      fields: { reorderPoint: null },
    },
    itemCategory: {
      findMany: jest.fn(),
    },
    itemBrand: {
      findMany: jest.fn(),
    },
    activity: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryStatisticsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<InventoryStatisticsService>(InventoryStatisticsService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all required methods', () => {
      expect(service.getInventoryOverview).toBeDefined();
      expect(service.getStockLevels).toBeDefined();
      expect(service.getConsumptionTrends).toBeDefined();
      expect(service.getAbcXyzAnalysis).toBeDefined();
      expect(service.getReorderPoints).toBeDefined();
      expect(service.getSupplierPerformance).toBeDefined();
    });
  });

  describe('getInventoryOverview', () => {
    it('should return overview with all metrics', async () => {
      const query: InventoryOverviewQueryDto = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      // Setup mocks
      mockPrismaService.item.count
        .mockResolvedValueOnce(3) // Total items
        .mockResolvedValueOnce(1) // Low stock items
        .mockResolvedValueOnce(0) // Critical items
        .mockResolvedValueOnce(1); // Out of stock items

      mockPrismaService.item.aggregate
        .mockResolvedValueOnce({
          _sum: { quantity: 65, totalPrice: 6500 },
        })
        .mockResolvedValueOnce({
          _avg: { quantity: 21.67 },
        });

      mockPrismaService.itemCategory.findMany.mockResolvedValue([{ id: 'cat-1' }, { id: 'cat-2' }]);
      mockPrismaService.itemBrand.findMany.mockResolvedValue([{ id: 'brand-1' }]);
      mockPrismaService.activity.count.mockResolvedValue(50);

      const result = await service.getInventoryOverview(query);

      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.totalValue).toBe(6500);
      expect(result.totalQuantity).toBe(65);
      expect(result.lowStockItems).toBe(1);
      expect(result.criticalItems).toBe(0);
      expect(result.outOfStockItems).toBe(1);
      expect(result.averageStockLevel).toBe(21.67);
      expect(result.stockTurnoverRate).toBeGreaterThanOrEqual(0);
      expect(result.categories.total).toBe(2);
      expect(result.brands.total).toBe(1);
    });

    it('should apply category filter correctly', async () => {
      const query: InventoryOverviewQueryDto = {
        categoryId: 'cat-1',
      };

      mockPrismaService.item.count.mockResolvedValue(2);
      mockPrismaService.item.aggregate.mockResolvedValue({
        _sum: { quantity: 65, totalPrice: 6500 },
      });
      mockPrismaService.itemCategory.findMany.mockResolvedValue([{ id: 'cat-1' }]);
      mockPrismaService.itemBrand.findMany.mockResolvedValue([]);
      mockPrismaService.activity.count.mockResolvedValue(30);

      await service.getInventoryOverview(query);

      expect(mockPrismaService.item.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categoryId: 'cat-1',
          }),
        })
      );
    });

    it('should apply brand and supplier filters', async () => {
      const query: InventoryOverviewQueryDto = {
        brandId: 'brand-1',
        supplierId: 'supplier-1',
      };

      mockPrismaService.item.count.mockResolvedValue(1);
      mockPrismaService.item.aggregate.mockResolvedValue({
        _sum: { quantity: 50, totalPrice: 5000 },
      });
      mockPrismaService.itemCategory.findMany.mockResolvedValue([]);
      mockPrismaService.itemBrand.findMany.mockResolvedValue([{ id: 'brand-1' }]);
      mockPrismaService.activity.count.mockResolvedValue(20);

      await service.getInventoryOverview(query);

      expect(mockPrismaService.item.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            brandId: 'brand-1',
            supplierId: 'supplier-1',
          }),
        })
      );
    });

    it('should handle empty results gracefully', async () => {
      const query: InventoryOverviewQueryDto = {};

      mockPrismaService.item.count.mockResolvedValue(0);
      mockPrismaService.item.aggregate.mockResolvedValue({
        _sum: { quantity: null, totalPrice: null },
        _avg: { quantity: null },
      });
      mockPrismaService.itemCategory.findMany.mockResolvedValue([]);
      mockPrismaService.itemBrand.findMany.mockResolvedValue([]);
      mockPrismaService.activity.count.mockResolvedValue(0);

      const result = await service.getInventoryOverview(query);

      expect(result.totalItems).toBe(0);
      expect(result.totalValue).toBe(0);
      expect(result.totalQuantity).toBe(0);
      expect(result.averageStockLevel).toBe(0);
    });
  });

  describe('getStockLevels', () => {
    it('should return stock levels with correct status calculation', async () => {
      const query: StockLevelsQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue(mockItems);

      const result = await service.getStockLevels(query);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Check status calculation
      const item = result[0];
      expect(item).toHaveProperty('itemId');
      expect(item).toHaveProperty('itemName');
      expect(item).toHaveProperty('status');
      expect(['critical', 'low', 'adequate', 'overstocked']).toContain(item.status);
    });

    it('should filter by status correctly', async () => {
      const query: StockLevelsQueryDto = {
        status: 'low',
      };

      mockPrismaService.item.findMany.mockResolvedValue([mockItems[1]]);

      const result = await service.getStockLevels(query);

      expect(result).toBeDefined();
      result.forEach((item) => {
        expect(item.status).toBe('low');
      });
    });

    it('should calculate days until stockout correctly', async () => {
      const query: StockLevelsQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue([mockItems[0]]);

      const result = await service.getStockLevels(query);

      expect(result[0].daysUntilStockout).toBeDefined();
      expect(typeof result[0].daysUntilStockout).toBe('number');
      // Item A: quantity=50, monthlyConsumption=30, daily=1, days=50
      expect(result[0].daysUntilStockout).toBe(50);
    });

    it('should handle null monthly consumption', async () => {
      const itemWithNullConsumption = {
        ...mockItems[0],
        monthlyConsumption: null,
      };

      mockPrismaService.item.findMany.mockResolvedValue([itemWithNullConsumption]);

      const result = await service.getStockLevels({});

      expect(result[0].daysUntilStockout).toBeNull();
    });

    it('should apply pagination correctly', async () => {
      const query: StockLevelsQueryDto = {
        limit: 10,
        offset: 5,
      };

      mockPrismaService.item.findMany.mockResolvedValue(mockItems.slice(0, 2));

      await service.getStockLevels(query);

      expect(mockPrismaService.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 5,
        })
      );
    });
  });

  describe('getConsumptionTrends', () => {
    it('should return consumption trends grouped by date', async () => {
      const query: ConsumptionTrendsQueryDto = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        groupBy: 'date',
      };

      mockPrismaService.activity.findMany.mockResolvedValue(mockActivities);

      const result = await service.getConsumptionTrends(query);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      const trend = result[0];
      expect(trend).toHaveProperty('period');
      expect(trend).toHaveProperty('totalConsumption');
      expect(trend).toHaveProperty('itemCount');
      expect(trend).toHaveProperty('topItems');
      expect(trend).toHaveProperty('byReason');
    });

    it('should filter by item IDs', async () => {
      const query: ConsumptionTrendsQueryDto = {
        itemIds: ['item-1', 'item-2'],
      };

      mockPrismaService.activity.findMany.mockResolvedValue(mockActivities);

      await service.getConsumptionTrends(query);

      expect(mockPrismaService.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            itemId: { in: ['item-1', 'item-2'] },
          }),
        })
      );
    });

    it('should filter by categories', async () => {
      const query: ConsumptionTrendsQueryDto = {
        categoryIds: ['cat-1'],
      };

      mockPrismaService.activity.findMany.mockResolvedValue(mockActivities);

      await service.getConsumptionTrends(query);

      expect(mockPrismaService.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            item: { categoryId: { in: ['cat-1'] } },
          }),
        })
      );
    });

    it('should filter by reasons', async () => {
      const query: ConsumptionTrendsQueryDto = {
        reasons: ['PRODUCTION_USAGE'],
      };

      mockPrismaService.activity.findMany.mockResolvedValue(mockActivities);

      await service.getConsumptionTrends(query);

      expect(mockPrismaService.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reason: { in: ['PRODUCTION_USAGE'] },
          }),
        })
      );
    });

    it('should limit top items correctly', async () => {
      const query: ConsumptionTrendsQueryDto = {
        topN: 5,
      };

      mockPrismaService.activity.findMany.mockResolvedValue(mockActivities);

      const result = await service.getConsumptionTrends(query);

      result.forEach((trend) => {
        expect(trend.topItems.length).toBeLessThanOrEqual(5);
      });
    });

    it('should calculate percentages correctly', async () => {
      const query: ConsumptionTrendsQueryDto = {};

      mockPrismaService.activity.findMany.mockResolvedValue(mockActivities);

      const result = await service.getConsumptionTrends(query);

      result.forEach((trend) => {
        trend.topItems.forEach((item) => {
          expect(item.percentage).toBeGreaterThanOrEqual(0);
          expect(item.percentage).toBeLessThanOrEqual(100);
        });
      });
    });
  });

  describe('getAbcXyzAnalysis', () => {
    it('should return ABC/XYZ analysis with correct structure', async () => {
      const query: AbcXyzAnalysisQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue(mockItems);

      const result = await service.getAbcXyzAnalysis(query);

      expect(result).toBeDefined();
      expect(result.abcCategories).toBeDefined();
      expect(result.xyzCategories).toBeDefined();
      expect(result.matrix).toBeDefined();

      expect(result.abcCategories.length).toBe(3);
      expect(result.xyzCategories.length).toBe(3);
      expect(result.matrix.length).toBe(9);
    });

    it('should classify ABC categories by value correctly', async () => {
      const query: AbcXyzAnalysisQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue(mockItems);

      const result = await service.getAbcXyzAnalysis(query);

      const categoryA = result.abcCategories.find((cat) => cat.category === 'A');
      const categoryB = result.abcCategories.find((cat) => cat.category === 'B');
      const categoryC = result.abcCategories.find((cat) => cat.category === 'C');

      expect(categoryA).toBeDefined();
      expect(categoryB).toBeDefined();
      expect(categoryC).toBeDefined();

      // Category A should have highest value items
      expect(categoryA!.totalValue).toBeGreaterThanOrEqual(categoryB!.totalValue);
      expect(categoryB!.totalValue).toBeGreaterThanOrEqual(categoryC!.totalValue);
    });

    it('should include top items in each category', async () => {
      const query: AbcXyzAnalysisQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue(mockItems);

      const result = await service.getAbcXyzAnalysis(query);

      result.abcCategories.forEach((category) => {
        expect(Array.isArray(category.items)).toBe(true);
        expect(category.items.length).toBeLessThanOrEqual(10);
        category.items.forEach((item) => {
          expect(item).toHaveProperty('itemId');
          expect(item).toHaveProperty('itemName');
          expect(item).toHaveProperty('value');
          expect(item).toHaveProperty('consumption');
        });
      });
    });

    it('should calculate percentages correctly', async () => {
      const query: AbcXyzAnalysisQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue(mockItems);

      const result = await service.getAbcXyzAnalysis(query);

      const totalPercentage = result.abcCategories.reduce((sum, cat) => sum + cat.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100, 1);
    });

    it('should create correct matrix combinations', async () => {
      const query: AbcXyzAnalysisQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue(mockItems);

      const result = await service.getAbcXyzAnalysis(query);

      const expectedCombinations = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];
      const actualCombinations = result.matrix.map((m) => m.combination);

      expectedCombinations.forEach((combo) => {
        expect(actualCombinations).toContain(combo);
      });
    });
  });

  describe('getReorderPoints', () => {
    it('should return reorder point analysis with all items', async () => {
      const query: ReorderPointsQueryDto = {
        filter: 'all',
      };

      mockPrismaService.item.findMany.mockResolvedValue(mockItems);

      const result = await service.getReorderPoints(query);

      expect(result).toBeDefined();
      expect(result.needsReorder).toBeDefined();
      expect(result.adequateStock).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('should filter items needing reorder', async () => {
      const query: ReorderPointsQueryDto = {
        filter: 'needs-reorder',
      };

      const itemsNeedingReorder = mockItems.filter(
        (item) => item.reorderPoint && item.quantity <= item.reorderPoint
      );

      mockPrismaService.item.findMany.mockResolvedValue(itemsNeedingReorder);

      const result = await service.getReorderPoints(query);

      expect(result.needsReorder).toBe(itemsNeedingReorder.length);
    });

    it('should calculate daily consumption correctly', async () => {
      const query: ReorderPointsQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue([mockItems[0]]);

      const result = await service.getReorderPoints(query);

      // Monthly consumption 30 / 30 days = 1 per day
      expect(result.items[0].dailyConsumption).toBe(1);
    });

    it('should calculate days of stock correctly', async () => {
      const query: ReorderPointsQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue([mockItems[0]]);

      const result = await service.getReorderPoints(query);

      // quantity 50 / daily consumption 1 = 50 days
      expect(result.items[0].daysOfStock).toBe(50);
    });

    it('should calculate suggested order quantity with safety stock', async () => {
      const query: ReorderPointsQueryDto = {};

      mockPrismaService.item.findMany.mockResolvedValue([mockItems[0]]);

      const result = await service.getReorderPoints(query);

      expect(result.items[0].suggestedOrderQuantity).toBeGreaterThanOrEqual(
        result.items[0].reorderQuantity
      );
    });

    it('should apply category filter', async () => {
      const query: ReorderPointsQueryDto = {
        categoryId: 'cat-1',
      };

      mockPrismaService.item.findMany.mockResolvedValue(mockItems.slice(0, 2));

      await service.getReorderPoints(query);

      expect(mockPrismaService.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categoryId: 'cat-1',
          }),
        })
      );
    });
  });

  describe('getSupplierPerformance', () => {
    it('should return supplier performance metrics', async () => {
      const query: SupplierPerformanceQueryDto = {};

      mockPrismaService.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getSupplierPerformance(query);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      const supplier = result[0];
      expect(supplier).toHaveProperty('supplierId');
      expect(supplier).toHaveProperty('supplierName');
      expect(supplier).toHaveProperty('totalOrders');
      expect(supplier).toHaveProperty('fulfilledOrders');
      expect(supplier).toHaveProperty('fulfillmentRate');
      expect(supplier).toHaveProperty('averageDeliveryTime');
      expect(supplier).toHaveProperty('totalSpent');
    });

    it('should calculate fulfillment rate correctly', async () => {
      const query: SupplierPerformanceQueryDto = {};

      mockPrismaService.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getSupplierPerformance(query);

      result.forEach((supplier) => {
        expect(supplier.fulfillmentRate).toBeGreaterThanOrEqual(0);
        expect(supplier.fulfillmentRate).toBeLessThanOrEqual(100);

        const expectedRate = (supplier.fulfilledOrders / supplier.totalOrders) * 100;
        expect(supplier.fulfillmentRate).toBe(expectedRate);
      });
    });

    it('should calculate total spent correctly', async () => {
      const query: SupplierPerformanceQueryDto = {};

      mockPrismaService.order.findMany.mockResolvedValue([mockOrders[0]]);

      const result = await service.getSupplierPerformance(query);

      // Order 1: price 100 * quantity 50 + tax 10 = 5010
      expect(result[0].totalSpent).toBe(5010);
    });

    it('should calculate average delivery time', async () => {
      const query: SupplierPerformanceQueryDto = {};

      mockPrismaService.order.findMany.mockResolvedValue([mockOrders[0]]);

      const result = await service.getSupplierPerformance(query);

      // Forecast: 2024-01-14, Received: 2024-01-15 = 1 day
      expect(result[0].averageDeliveryTime).toBe(1);
    });

    it('should filter by supplier ID', async () => {
      const query: SupplierPerformanceQueryDto = {
        supplierId: 'supplier-1',
      };

      mockPrismaService.order.findMany.mockResolvedValue([mockOrders[0]]);

      await service.getSupplierPerformance(query);

      expect(mockPrismaService.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            supplierId: 'supplier-1',
          }),
        })
      );
    });

    it('should filter by minimum orders', async () => {
      const query: SupplierPerformanceQueryDto = {
        minOrders: 2,
      };

      mockPrismaService.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getSupplierPerformance(query);

      result.forEach((supplier) => {
        expect(supplier.totalOrders).toBeGreaterThanOrEqual(2);
      });
    });

    it('should calculate on-time delivery rate', async () => {
      const query: SupplierPerformanceQueryDto = {};

      mockPrismaService.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getSupplierPerformance(query);

      result.forEach((supplier) => {
        expect(supplier.onTimeDeliveryRate).toBeGreaterThanOrEqual(0);
        expect(supplier.onTimeDeliveryRate).toBeLessThanOrEqual(100);
      });
    });

    it('should sort suppliers by total orders descending', async () => {
      const query: SupplierPerformanceQueryDto = {};

      mockPrismaService.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getSupplierPerformance(query);

      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].totalOrders).toBeGreaterThanOrEqual(result[i].totalOrders);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockPrismaService.item.count.mockRejectedValue(new Error('Database error'));

      await expect(service.getInventoryOverview({})).rejects.toThrow('Database error');
    });

    it('should handle empty date ranges', async () => {
      const query: ConsumptionTrendsQueryDto = {
        startDate: undefined,
        endDate: undefined,
      };

      mockPrismaService.activity.findMany.mockResolvedValue([]);

      const result = await service.getConsumptionTrends(query);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle null supplier in orders', async () => {
      const orderWithoutSupplier = {
        ...mockOrders[0],
        supplier: null,
      };

      mockPrismaService.order.findMany.mockResolvedValue([orderWithoutSupplier]);

      const result = await service.getSupplierPerformance({});

      expect(result).toBeDefined();
      expect(result.length).toBe(0);
    });
  });

  describe('Data Validation', () => {
    it('should validate InventoryOverviewQueryDto', () => {
      const query: InventoryOverviewQueryDto = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        categoryId: 'cat-1',
        brandId: 'brand-1',
        supplierId: 'supplier-1',
      };

      expect(query.startDate).toBeDefined();
      expect(query.endDate).toBeDefined();
      expect(query.categoryId).toBe('cat-1');
    });

    it('should validate StockLevelsQueryDto', () => {
      const query: StockLevelsQueryDto = {
        status: 'low',
        categoryId: 'cat-1',
        limit: 50,
        offset: 0,
      };

      expect(['critical', 'low', 'adequate', 'overstocked', 'all']).toContain(query.status);
      expect(query.limit).toBeGreaterThan(0);
      expect(query.offset).toBeGreaterThanOrEqual(0);
    });

    it('should validate ConsumptionTrendsQueryDto', () => {
      const query: ConsumptionTrendsQueryDto = {
        itemIds: ['item-1'],
        categoryIds: ['cat-1'],
        reasons: ['PRODUCTION_USAGE'],
        groupBy: 'date',
        topN: 10,
      };

      expect(Array.isArray(query.itemIds)).toBe(true);
      expect(Array.isArray(query.categoryIds)).toBe(true);
      expect(Array.isArray(query.reasons)).toBe(true);
      expect(query.topN).toBeGreaterThan(0);
    });
  });
});
