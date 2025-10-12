/**
 * Orders Statistics Service Test Suite
 *
 * Comprehensive tests for order statistics calculations including:
 * - Overview metrics
 * - Fulfillment rates
 * - Supplier comparison
 * - Spending analysis
 * - Delivery performance
 * - Edge cases and data validation
 */

import { Test, TestingModule } from '@nestjs/testing';
import { OrdersStatisticsService } from '../orders-statistics.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';

describe('OrdersStatisticsService', () => {
  let service: OrdersStatisticsService;
  let prismaService: PrismaService;

  // Mock data
  const mockOrders = [
    {
      id: 'order-1',
      status: 'FULFILLED',
      createdAt: new Date('2024-01-15'),
      updatedAt: new Date('2024-01-20'),
      forecast: new Date('2024-01-22'),
      supplierId: 'supplier-1',
      supplier: {
        id: 'supplier-1',
        fantasyName: 'Supplier A',
      },
      items: [
        {
          id: 'item-1',
          itemId: 'product-1',
          price: 100,
          orderedQuantity: 10,
          receivedQuantity: 10,
          tax: 10,
          receivedAt: new Date('2024-01-20'),
          item: {
            name: 'Product 1',
            category: { id: 'cat-1', name: 'Category A' },
          },
        },
      ],
    },
    {
      id: 'order-2',
      status: 'PARTIALLY_FULFILLED',
      createdAt: new Date('2024-01-16'),
      updatedAt: new Date('2024-01-22'),
      forecast: new Date('2024-01-25'),
      supplierId: 'supplier-1',
      supplier: {
        id: 'supplier-1',
        fantasyName: 'Supplier A',
      },
      items: [
        {
          id: 'item-2',
          itemId: 'product-2',
          price: 50,
          orderedQuantity: 20,
          receivedQuantity: 10,
          tax: 5,
          receivedAt: new Date('2024-01-22'),
          item: {
            name: 'Product 2',
            category: { id: 'cat-2', name: 'Category B' },
          },
        },
      ],
    },
    {
      id: 'order-3',
      status: 'CREATED',
      createdAt: new Date('2024-01-17'),
      updatedAt: new Date('2024-01-17'),
      forecast: new Date('2024-01-27'),
      supplierId: 'supplier-2',
      supplier: {
        id: 'supplier-2',
        fantasyName: 'Supplier B',
      },
      items: [
        {
          id: 'item-3',
          itemId: 'product-3',
          price: 75,
          orderedQuantity: 15,
          receivedQuantity: 0,
          tax: 7.5,
          receivedAt: null,
          item: {
            name: 'Product 3',
            category: { id: 'cat-1', name: 'Category A' },
          },
        },
      ],
    },
    {
      id: 'order-4',
      status: 'CANCELLED',
      createdAt: new Date('2024-01-18'),
      updatedAt: new Date('2024-01-19'),
      forecast: new Date('2024-01-28'),
      supplierId: 'supplier-2',
      supplier: {
        id: 'supplier-2',
        fantasyName: 'Supplier B',
      },
      items: [
        {
          id: 'item-4',
          itemId: 'product-4',
          price: 200,
          orderedQuantity: 5,
          receivedQuantity: 0,
          tax: 20,
          receivedAt: null,
          item: {
            name: 'Product 4',
            category: { id: 'cat-3', name: 'Category C' },
          },
        },
      ],
    },
  ];

  const mockStatusGroups = [
    { status: 'FULFILLED', _count: { id: 1 } },
    { status: 'PARTIALLY_FULFILLED', _count: { id: 1 } },
    { status: 'CREATED', _count: { id: 1 } },
    { status: 'CANCELLED', _count: { id: 1 } },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersStatisticsService,
        {
          provide: PrismaService,
          useValue: {
            order: {
              findMany: jest.fn(),
              groupBy: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<OrdersStatisticsService>(OrdersStatisticsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrdersOverview', () => {
    it('should calculate overview metrics correctly', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(mockStatusGroups as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.totalOrders).toBe(4);
      expect(result.activeOrders).toBe(2); // CREATED + PARTIALLY_FULFILLED
      expect(result.fulfilledOrders).toBe(1); // FULFILLED
      expect(result.cancelledOrders).toBe(1); // CANCELLED

      // Total spent: (100*10 + 10) + (50*20 + 5) + (75*15 + 7.5) + (200*5 + 20) = 1010 + 1005 + 1132.5 + 1020 = 4167.5
      expect(result.totalSpent).toBe(4167.5);
      expect(result.averageOrderValue).toBeCloseTo(1041.88, 2);
    });

    it('should filter orders by supplier', async () => {
      const supplierOrders = mockOrders.filter(o => o.supplierId === 'supplier-1');
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(supplierOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(
        mockStatusGroups.slice(0, 2) as any
      );

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        supplierId: 'supplier-1',
      });

      expect(result.totalOrders).toBe(2);
      expect(result.bySupplier.length).toBe(1);
      expect(result.bySupplier[0].supplierName).toBe('Supplier A');
    });

    it('should filter orders by status', async () => {
      const activeOrders = mockOrders.filter(o =>
        ['CREATED', 'PARTIALLY_FULFILLED'].includes(o.status)
      );
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(activeOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(
        mockStatusGroups.slice(1, 3) as any
      );

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        statuses: ['CREATED', 'PARTIALLY_FULFILLED'],
      });

      expect(result.totalOrders).toBe(2);
      expect(result.activeOrders).toBe(2);
    });

    it('should calculate pending value correctly', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(mockStatusGroups as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      // Pending value: order-2 (50*10 + 5) + order-3 (75*15 + 7.5) = 505 + 1132.5 = 1637.5
      expect(result.pendingValue).toBe(1637.5);
    });

    it('should group orders by status correctly', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(mockStatusGroups as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.byStatus).toHaveLength(4);
      expect(result.byStatus[0].status).toBe('FULFILLED');
      expect(result.byStatus[0].count).toBe(1);
      expect(result.byStatus[0].percentage).toBe(25);
    });

    it('should handle empty orders list', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue([]);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue([]);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.totalOrders).toBe(0);
      expect(result.totalSpent).toBe(0);
      expect(result.averageOrderValue).toBe(0);
      expect(result.byStatus).toHaveLength(0);
      expect(result.bySupplier).toHaveLength(0);
    });

    it('should use default date range when not provided', async () => {
      const findManySpy = jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(mockStatusGroups as any);

      await service.getOrdersOverview({});

      const callArgs = findManySpy.mock.calls[0][0];
      expect(callArgs.where.createdAt.gte).toBeInstanceOf(Date);
      expect(callArgs.where.createdAt.lte).toBeInstanceOf(Date);
    });
  });

  describe('getFulfillmentRates', () => {
    it('should calculate fulfillment rates correctly', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getFulfillmentRates({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        period: 'month',
      });

      expect(result.totalOrders).toBe(4);
      expect(result.fullyFulfilled).toBe(1); // Only FULFILLED status
      expect(result.partiallyFulfilled).toBe(1);
      expect(result.notFulfilled).toBe(1);
      expect(result.fulfillmentRate).toBe(25); // 1/4 * 100
    });

    it('should calculate items fulfillment rate', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getFulfillmentRates({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      // Total items: 4, Fulfilled items: 2 (item-1 fully received, item-2 partially but not >= ordered)
      expect(result.itemsFulfillmentRate).toBeGreaterThanOrEqual(0);
      expect(result.itemsFulfillmentRate).toBeLessThanOrEqual(100);
    });

    it('should generate trends by period', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getFulfillmentRates({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        period: 'day',
      });

      expect(result.trends).toBeDefined();
      expect(Array.isArray(result.trends)).toBe(true);
      result.trends.forEach(trend => {
        expect(trend).toHaveProperty('date');
        expect(trend).toHaveProperty('ordered');
        expect(trend).toHaveProperty('fulfilled');
        expect(trend).toHaveProperty('rate');
      });
    });

    it('should filter by supplier', async () => {
      const supplierOrders = mockOrders.filter(o => o.supplierId === 'supplier-1');
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(supplierOrders as any);

      const result = await service.getFulfillmentRates({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        supplierId: 'supplier-1',
      });

      expect(result.totalOrders).toBe(2);
    });

    it('should handle zero orders', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue([]);

      const result = await service.getFulfillmentRates({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.fulfillmentRate).toBe(0);
      expect(result.itemsFulfillmentRate).toBe(0);
    });
  });

  describe('getSupplierComparison', () => {
    it('should compare suppliers correctly', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.suppliers.length).toBeGreaterThan(0);
      expect(result.suppliers[0]).toHaveProperty('supplierId');
      expect(result.suppliers[0]).toHaveProperty('supplierName');
      expect(result.suppliers[0]).toHaveProperty('orderCount');
      expect(result.suppliers[0]).toHaveProperty('fulfillmentRate');
      expect(result.suppliers[0]).toHaveProperty('averageDeliveryTime');
    });

    it('should filter suppliers by minimum orders', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        minOrders: 2,
      });

      // Only supplier-1 has 2 orders
      expect(result.suppliers.length).toBe(1);
      expect(result.suppliers[0].supplierName).toBe('Supplier A');
    });

    it('should calculate fulfillment rate per supplier', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const supplierA = result.suppliers.find(s => s.supplierName === 'Supplier A');
      expect(supplierA).toBeDefined();
      expect(supplierA!.fulfillmentRate).toBeGreaterThanOrEqual(0);
      expect(supplierA!.fulfillmentRate).toBeLessThanOrEqual(100);
    });

    it('should calculate average delivery time', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      result.suppliers.forEach(supplier => {
        expect(typeof supplier.averageDeliveryTime).toBe('number');
      });
    });

    it('should calculate on-time delivery rate', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      result.suppliers.forEach(supplier => {
        expect(supplier.onTimeRate).toBeGreaterThanOrEqual(0);
        expect(supplier.onTimeRate).toBeLessThanOrEqual(100);
      });
    });

    it('should rank suppliers by fulfillment rate', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      for (let i = 1; i < result.suppliers.length; i++) {
        expect(result.suppliers[i - 1].fulfillmentRate).toBeGreaterThanOrEqual(
          result.suppliers[i].fulfillmentRate
        );
      }
    });

    it('should provide metrics summary', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.metrics).toBeDefined();
      expect(result.metrics).toHaveProperty('bestFulfillmentRate');
      expect(result.metrics).toHaveProperty('bestDeliveryTime');
      expect(result.metrics).toHaveProperty('bestValue');
      expect(result.metrics).toHaveProperty('mostOrders');
    });

    it('should filter by specific suppliers', async () => {
      const filteredOrders = mockOrders.filter(o => o.supplierId === 'supplier-1');
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(filteredOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        supplierIds: ['supplier-1'],
      });

      expect(result.suppliers.length).toBe(1);
      expect(result.suppliers[0].supplierName).toBe('Supplier A');
    });
  });

  describe('getSpendingAnalysis', () => {
    it('should calculate total spending', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSpendingAnalysis({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.totalSpent).toBeGreaterThan(0);
      expect(result.periodSpent).toBe(result.totalSpent);
    });

    it('should break down spending by category', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSpendingAnalysis({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.byCategory).toBeDefined();
      expect(Array.isArray(result.byCategory)).toBe(true);
      expect(result.byCategory.length).toBeGreaterThan(0);

      result.byCategory.forEach(category => {
        expect(category).toHaveProperty('categoryId');
        expect(category).toHaveProperty('categoryName');
        expect(category).toHaveProperty('amount');
        expect(category).toHaveProperty('percentage');
      });
    });

    it('should break down spending by supplier', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSpendingAnalysis({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.bySupplier).toBeDefined();
      expect(Array.isArray(result.bySupplier)).toBe(true);

      result.bySupplier.forEach(supplier => {
        expect(supplier).toHaveProperty('supplierId');
        expect(supplier).toHaveProperty('supplierName');
        expect(supplier).toHaveProperty('amount');
        expect(supplier).toHaveProperty('percentage');
      });
    });

    it('should identify top spending items', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSpendingAnalysis({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        topN: 5,
      });

      expect(result.topItems).toBeDefined();
      expect(Array.isArray(result.topItems)).toBe(true);
      expect(result.topItems.length).toBeLessThanOrEqual(5);

      // Verify items are sorted by spending
      for (let i = 1; i < result.topItems.length; i++) {
        expect(result.topItems[i - 1].totalSpent).toBeGreaterThanOrEqual(
          result.topItems[i].totalSpent
        );
      }
    });

    it('should generate spending trends', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSpendingAnalysis({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.trends).toBeDefined();
      expect(Array.isArray(result.trends)).toBe(true);

      result.trends.forEach(trend => {
        expect(trend).toHaveProperty('period');
        expect(trend).toHaveProperty('amount');
        expect(trend).toHaveProperty('orderCount');
        expect(trend).toHaveProperty('averageOrderValue');
      });
    });

    it('should filter spending by supplier', async () => {
      const supplierOrders = mockOrders.filter(o => o.supplierId === 'supplier-1');
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(supplierOrders as any);

      const result = await service.getSpendingAnalysis({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        supplierId: 'supplier-1',
      });

      expect(result.bySupplier.length).toBe(1);
    });

    it('should handle uncategorized items', async () => {
      const ordersWithUncategorized = [
        {
          ...mockOrders[0],
          items: [
            {
              ...mockOrders[0].items[0],
              item: {
                name: 'Uncategorized Item',
                category: null,
              },
            },
          ],
        },
      ];
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(ordersWithUncategorized as any);

      const result = await service.getSpendingAnalysis({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const uncategorized = result.byCategory.find(c => c.categoryId === 'uncategorized');
      expect(uncategorized).toBeDefined();
      expect(uncategorized!.categoryName).toBe('Sem categoria');
    });
  });

  describe('getDeliveryPerformance', () => {
    it('should calculate average delivery time', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(typeof result.averageDeliveryTime).toBe('number');
    });

    it('should calculate on-time vs late deliveries', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.onTimeDeliveries).toBeGreaterThanOrEqual(0);
      expect(result.lateDeliveries).toBeGreaterThanOrEqual(0);
      expect(result.onTimeRate).toBeGreaterThanOrEqual(0);
      expect(result.onTimeRate).toBeLessThanOrEqual(100);
    });

    it('should break down performance by supplier', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.bySupplier).toBeDefined();
      expect(Array.isArray(result.bySupplier)).toBe(true);

      result.bySupplier.forEach(supplier => {
        expect(supplier).toHaveProperty('supplierId');
        expect(supplier).toHaveProperty('supplierName');
        expect(supplier).toHaveProperty('averageDeliveryTime');
        expect(supplier).toHaveProperty('onTimeRate');
        expect(supplier).toHaveProperty('deliveryCount');
      });
    });

    it('should generate performance trends', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.trends).toBeDefined();
      expect(Array.isArray(result.trends)).toBe(true);

      result.trends.forEach(trend => {
        expect(trend).toHaveProperty('period');
        expect(trend).toHaveProperty('averageTime');
        expect(trend).toHaveProperty('onTimeRate');
      });
    });

    it('should filter by minimum deliveries', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        minDeliveries: 2,
      });

      result.bySupplier.forEach(supplier => {
        expect(supplier.deliveryCount).toBeGreaterThanOrEqual(2);
      });
    });

    it('should only include orders with forecast dates', async () => {
      const findManySpy = jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const callArgs = findManySpy.mock.calls[0][0];
      expect(callArgs.where.forecast).toEqual({ not: null });
    });

    it('should handle orders without received dates', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      // Should not throw and return valid data
      expect(result).toBeDefined();
      expect(typeof result.averageDeliveryTime).toBe('number');
    });

    it('should calculate negative delivery time for early deliveries', async () => {
      const earlyOrders = [
        {
          ...mockOrders[0],
          forecast: new Date('2024-01-25'),
          items: [
            {
              ...mockOrders[0].items[0],
              receivedAt: new Date('2024-01-20'),
            },
          ],
        },
      ];
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(earlyOrders as any);

      const result = await service.getDeliveryPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      // Early deliveries should count as on-time
      expect(result.onTimeDeliveries).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle orders without items', async () => {
      const ordersNoItems = [
        {
          ...mockOrders[0],
          items: [],
        },
      ];
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(ordersNoItems as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue([
        { status: 'FULFILLED', _count: { id: 1 } },
      ] as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.totalSpent).toBe(0);
    });

    it('should handle orders without suppliers', async () => {
      const ordersNoSupplier = [
        {
          ...mockOrders[0],
          supplier: null,
          supplierId: null,
        },
      ];
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(ordersNoSupplier as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue([
        { status: 'FULFILLED', _count: { id: 1 } },
      ] as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.bySupplier.length).toBe(0);
    });

    it('should handle partial data in items', async () => {
      const ordersPartialData = [
        {
          ...mockOrders[0],
          items: [
            {
              ...mockOrders[0].items[0],
              tax: 0,
              receivedAt: null,
            },
          ],
        },
      ];
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(ordersPartialData as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue([
        { status: 'FULFILLED', _count: { id: 1 } },
      ] as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result).toBeDefined();
      expect(result.totalSpent).toBeGreaterThan(0);
    });

    it('should handle database connection errors', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        service.getOrdersOverview({
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        })
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle invalid date ranges', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue([]);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue([]);

      const result = await service.getOrdersOverview({
        startDate: '2024-12-31',
        endDate: '2024-01-01', // End before start
      });

      expect(result.totalOrders).toBe(0);
    });
  });

  describe('Data Validation', () => {
    it('should round monetary values to 2 decimal places', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(mockStatusGroups as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.totalSpent.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
      expect(result.averageOrderValue.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });

    it('should round percentages to 1 decimal place', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getFulfillmentRates({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(result.fulfillmentRate.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(1);
    });

    it('should ensure percentages sum to 100 in status breakdown', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);
      jest.spyOn(prismaService.order, 'groupBy').mockResolvedValue(mockStatusGroups as any);

      const result = await service.getOrdersOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const totalPercentage = result.byStatus.reduce((sum, item) => sum + item.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100, 1);
    });

    it('should ensure item variety count is accurate', async () => {
      jest.spyOn(prismaService.order, 'findMany').mockResolvedValue(mockOrders as any);

      const result = await service.getSupplierComparison({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      result.suppliers.forEach(supplier => {
        expect(supplier.itemVariety).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(supplier.itemVariety)).toBe(true);
      });
    });
  });
});
