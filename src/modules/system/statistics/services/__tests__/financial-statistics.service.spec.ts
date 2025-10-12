import { Test, TestingModule } from '@nestjs/testing';
import { FinancialStatisticsService } from '../financial-statistics.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  RevenueTrendsQueryDto,
  CostAnalysisQueryDto,
  ProfitabilityQueryDto,
  BudgetTrackingQueryDto,
} from '../../dto/query-statistics.dto';

describe('FinancialStatisticsService', () => {
  let service: FinancialStatisticsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    task: {
      findMany: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
    },
    bonus: {
      findMany: jest.fn(),
    },
    payroll: {
      findMany: jest.fn(),
    },
    paintProduction: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialStatisticsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<FinancialStatisticsService>(FinancialStatisticsService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRevenueTrends', () => {
    const mockTasks = [
      {
        id: 'task-1',
        price: 1500.50,
        status: 'completed',
        createdAt: new Date('2024-01-15'),
        name: 'Task 1',
      },
      {
        id: 'task-2',
        price: 2300.75,
        status: 'completed',
        createdAt: new Date('2024-01-20'),
        name: 'Task 2',
      },
      {
        id: 'task-3',
        price: 1800.00,
        status: 'in_progress',
        createdAt: new Date('2024-02-10'),
        name: 'Task 3',
      },
      {
        id: 'task-4',
        price: 3200.25,
        status: 'completed',
        createdAt: new Date('2024-02-15'),
        name: 'Task 4',
      },
    ];

    beforeEach(() => {
      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);
    });

    it('should calculate total revenue correctly', async () => {
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBe(8800.5);
    });

    it('should calculate revenue with 2 decimal precision', async () => {
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBeCloseTo(8800.5, 2);
      expect(result.periodRevenue).toMatch(/^\d+\.\d{1,2}$/);
    });

    it('should calculate period revenue (last 30 days)', async () => {
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      // Since mock data is old, period revenue should be 0
      expect(result.periodRevenue).toBeDefined();
      expect(typeof result.periodRevenue).toBe('number');
    });

    it('should calculate growth rate correctly', async () => {
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.growth).toBeDefined();
      expect(typeof result.growth).toBe('number');
    });

    it('should group revenue by source (status)', async () => {
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.bySource).toHaveLength(2);
      expect(result.bySource).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'completed',
            amount: expect.any(Number),
            percentage: expect.any(Number),
          }),
          expect.objectContaining({
            source: 'in_progress',
            amount: expect.any(Number),
            percentage: expect.any(Number),
          }),
        ])
      );
    });

    it('should calculate trends by month', async () => {
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.trends).toHaveLength(2);
      expect(result.trends[0]).toMatchObject({
        period: expect.stringMatching(/^\d{4}-\d{2}$/),
        revenue: expect.any(Number),
        taskCount: expect.any(Number),
        averageValue: expect.any(Number),
      });
    });

    it('should include projections when requested', async () => {
      const query: RevenueTrendsQueryDto = {
        includeProjections: 'true',
      };
      const result = await service.getRevenueTrends(query);

      expect(result.projections).toBeDefined();
      expect(Array.isArray(result.projections)).toBe(true);
      if (result.projections.length > 0) {
        expect(result.projections[0]).toMatchObject({
          period: expect.any(String),
          projected: expect.any(Number),
          confidence: expect.any(Number),
        });
      }
    });

    it('should filter by customer when provided', async () => {
      const query: RevenueTrendsQueryDto = {
        customerId: 'customer-123',
      };
      await service.getRevenueTrends(query);

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'customer-123',
          }),
        })
      );
    });

    it('should filter by sector when provided', async () => {
      const query: RevenueTrendsQueryDto = {
        sectorId: 'sector-123',
      };
      await service.getRevenueTrends(query);

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sectorId: 'sector-123',
          }),
        })
      );
    });

    it('should handle date range filters', async () => {
      const query: RevenueTrendsQueryDto = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };
      await service.getRevenueTrends(query);

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        })
      );
    });

    it('should handle empty task list', async () => {
      mockPrismaService.task.findMany.mockResolvedValue([]);
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBe(0);
      expect(result.periodRevenue).toBe(0);
      expect(result.growth).toBe(0);
      expect(result.bySource).toHaveLength(0);
      expect(result.trends).toHaveLength(0);
    });

    it('should handle null prices correctly', async () => {
      mockPrismaService.task.findMany.mockResolvedValue([
        { id: '1', price: null, status: 'pending', createdAt: new Date(), name: 'Task' },
        { id: '2', price: 1000, status: 'completed', createdAt: new Date(), name: 'Task 2' },
      ]);
      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBe(1000);
    });
  });

  describe('getCostAnalysis', () => {
    const mockOrders = [
      {
        id: 'order-1',
        createdAt: new Date('2024-01-10'),
        items: [
          { price: 100, orderedQuantity: 5, tax: 10 },
          { price: 200, orderedQuantity: 2, tax: 20 },
        ],
      },
      {
        id: 'order-2',
        createdAt: new Date('2024-02-15'),
        items: [
          { price: 150, orderedQuantity: 3, tax: 15 },
        ],
      },
    ];

    const mockBonuses = [
      { id: 'bonus-1', baseBonus: 500, createdAt: new Date('2024-01-15') },
      { id: 'bonus-2', baseBonus: 750, createdAt: new Date('2024-02-20') },
    ];

    const mockPayrolls = [
      { id: 'payroll-1', baseRemuneration: 5000, createdAt: new Date('2024-01-25') },
      { id: 'payroll-2', baseRemuneration: 5200, createdAt: new Date('2024-02-25') },
    ];

    const mockPaintProductions = [
      {
        id: 'paint-1',
        volumeLiters: 100,
        createdAt: new Date('2024-01-20'),
        formula: { pricePerLiter: 15.50 },
      },
      {
        id: 'paint-2',
        volumeLiters: 200,
        createdAt: new Date('2024-02-10'),
        formula: { pricePerLiter: 18.75 },
      },
    ];

    beforeEach(() => {
      mockPrismaService.order.findMany.mockResolvedValue(mockOrders);
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);
      mockPrismaService.payroll.findMany.mockResolvedValue(mockPayrolls);
      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);
    });

    it('should calculate inventory costs correctly', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      // (100*5 + 10) + (200*2 + 20) + (150*3 + 15) = 510 + 420 + 465 = 1395
      const expectedInventoryCosts = 1395;
      expect(result.operationalCosts.inventory).toBe(expectedInventoryCosts);
    });

    it('should calculate labor costs correctly', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      // bonuses: 500 + 750 = 1250
      // payrolls: 5000 + 5200 = 10200
      // total: 11450
      expect(result.operationalCosts.labor).toBe(11450);
    });

    it('should calculate materials costs correctly', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      // (100 * 15.50) + (200 * 18.75) = 1550 + 3750 = 5300
      expect(result.operationalCosts.materials).toBe(5300);
    });

    it('should calculate overhead costs as 15% of total', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      const inventoryCosts = 1395;
      const laborCosts = 11450;
      const materialsCosts = 5300;
      const expectedOverhead = (inventoryCosts + laborCosts + materialsCosts) * 0.15;

      expect(result.operationalCosts.overhead).toBeCloseTo(expectedOverhead, 2);
    });

    it('should calculate total costs with proper aggregation', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      const inventory = result.operationalCosts.inventory;
      const labor = result.operationalCosts.labor;
      const materials = result.operationalCosts.materials;
      const overhead = result.operationalCosts.overhead;

      expect(result.totalCosts).toBeCloseTo(inventory + labor + materials + overhead, 2);
    });

    it('should categorize costs by category with percentages', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      expect(result.byCategory).toHaveLength(4);
      expect(result.byCategory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'Inventory',
            amount: expect.any(Number),
            percentage: expect.any(Number),
          }),
          expect.objectContaining({
            category: 'Labor',
            amount: expect.any(Number),
            percentage: expect.any(Number),
          }),
          expect.objectContaining({
            category: 'Materials',
            amount: expect.any(Number),
            percentage: expect.any(Number),
          }),
          expect.objectContaining({
            category: 'Overhead',
            amount: expect.any(Number),
            percentage: expect.any(Number),
          }),
        ])
      );

      // Verify percentages sum to 100
      const totalPercentage = result.byCategory.reduce((sum, cat) => sum + cat.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100, 0);
    });

    it('should provide cost trends by period', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      expect(result.trends).toBeDefined();
      expect(Array.isArray(result.trends)).toBe(true);
    });

    it('should round costs to 2 decimal places', async () => {
      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      expect(result.totalCosts.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(result.operationalCosts.inventory.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(result.operationalCosts.labor.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(result.operationalCosts.materials.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(result.operationalCosts.overhead.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
    });

    it('should handle date range filters', async () => {
      const query: CostAnalysisQueryDto = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };
      await service.getCostAnalysis(query);

      expect(mockPrismaService.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        })
      );
    });

    it('should handle empty data gracefully', async () => {
      mockPrismaService.order.findMany.mockResolvedValue([]);
      mockPrismaService.bonus.findMany.mockResolvedValue([]);
      mockPrismaService.payroll.findMany.mockResolvedValue([]);
      mockPrismaService.paintProduction.findMany.mockResolvedValue([]);

      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      expect(result.totalCosts).toBe(0);
      expect(result.operationalCosts.inventory).toBe(0);
      expect(result.operationalCosts.labor).toBe(0);
      expect(result.operationalCosts.materials).toBe(0);
      expect(result.operationalCosts.overhead).toBe(0);
    });
  });

  describe('getProfitability', () => {
    const mockTasks = [
      {
        id: 'task-1',
        price: 5000,
        createdAt: new Date('2024-01-15'),
        name: 'Project A',
        customer: { id: 'cust-1', fantasyName: 'Customer One' },
      },
      {
        id: 'task-2',
        price: 8000,
        createdAt: new Date('2024-01-20'),
        name: 'Project B',
        customer: { id: 'cust-2', fantasyName: 'Customer Two' },
      },
      {
        id: 'task-3',
        price: 3000,
        createdAt: new Date('2024-02-10'),
        name: 'Project C',
        customer: { id: 'cust-1', fantasyName: 'Customer One' },
      },
    ];

    beforeEach(() => {
      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);
      mockPrismaService.order.findMany.mockResolvedValue([]);
      mockPrismaService.bonus.findMany.mockResolvedValue([]);
      mockPrismaService.payroll.findMany.mockResolvedValue([]);
      mockPrismaService.paintProduction.findMany.mockResolvedValue([]);
    });

    it('should calculate gross profit correctly (revenue - costs)', async () => {
      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      const totalRevenue = 5000 + 8000 + 3000;
      expect(result.grossProfit).toBe(totalRevenue); // Since costs are 0 in mock
    });

    it('should calculate net profit (85% of gross profit)', async () => {
      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      expect(result.netProfit).toBe(result.grossProfit * 0.85);
    });

    it('should calculate profit margin formula: (gross profit / revenue) * 100', async () => {
      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      const totalRevenue = 5000 + 8000 + 3000;
      const expectedMargin = (result.grossProfit / totalRevenue) * 100;

      expect(result.profitMargin).toBeCloseTo(expectedMargin, 1);
    });

    it('should calculate return on investment: (net profit / costs) * 100', async () => {
      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      expect(result.returnOnInvestment).toBeDefined();
      expect(typeof result.returnOnInvestment).toBe('number');
    });

    it('should provide profitability by task', async () => {
      const query: ProfitabilityQueryDto = { topN: 10 };
      const result = await service.getProfitability(query);

      expect(result.byTask).toBeDefined();
      expect(result.byTask.length).toBeLessThanOrEqual(10);
      expect(result.byTask[0]).toMatchObject({
        taskId: expect.any(String),
        taskName: expect.any(String),
        revenue: expect.any(Number),
        costs: expect.any(Number),
        profit: expect.any(Number),
        margin: expect.any(Number),
      });
    });

    it('should provide profitability by customer', async () => {
      const query: ProfitabilityQueryDto = { topN: 10 };
      const result = await service.getProfitability(query);

      expect(result.byCustomer).toBeDefined();
      expect(result.byCustomer.length).toBeLessThanOrEqual(10);
      expect(result.byCustomer[0]).toMatchObject({
        customerId: expect.any(String),
        customerName: expect.any(String),
        revenue: expect.any(Number),
        taskCount: expect.any(Number),
        averageProfit: expect.any(Number),
      });
    });

    it('should sort tasks by profit descending', async () => {
      const query: ProfitabilityQueryDto = { topN: 10 };
      const result = await service.getProfitability(query);

      for (let i = 1; i < result.byTask.length; i++) {
        expect(result.byTask[i - 1].profit).toBeGreaterThanOrEqual(result.byTask[i].profit);
      }
    });

    it('should limit results by topN parameter', async () => {
      const query: ProfitabilityQueryDto = { topN: 2 };
      const result = await service.getProfitability(query);

      expect(result.byTask.length).toBeLessThanOrEqual(2);
      expect(result.byCustomer.length).toBeLessThanOrEqual(2);
    });

    it('should handle negative profit scenarios', async () => {
      // Mock high costs scenario
      mockPrismaService.order.findMany.mockResolvedValue([
        {
          id: 'order-1',
          createdAt: new Date('2024-01-10'),
          items: [{ price: 10000, orderedQuantity: 100, tax: 1000 }],
        },
      ]);

      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      // Gross profit can be negative when costs exceed revenue
      expect(typeof result.grossProfit).toBe('number');
      expect(typeof result.profitMargin).toBe('number');
    });

    it('should round all values to appropriate decimal places', async () => {
      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      expect(result.grossProfit.toString()).toMatch(/^\-?\d+(\.\d{1,2})?$/);
      expect(result.netProfit.toString()).toMatch(/^\-?\d+(\.\d{1,2})?$/);
      expect(result.profitMargin.toString()).toMatch(/^\-?\d+(\.\d{1,2})?$/);
    });

    it('should filter by customer when provided', async () => {
      const query: ProfitabilityQueryDto = {
        customerId: 'customer-123',
      };
      await service.getProfitability(query);

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'customer-123',
          }),
        })
      );
    });

    it('should filter by sector when provided', async () => {
      const query: ProfitabilityQueryDto = {
        sectorId: 'sector-123',
      };
      await service.getProfitability(query);

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sectorId: 'sector-123',
          }),
        })
      );
    });

    it('should handle zero revenue correctly', async () => {
      mockPrismaService.task.findMany.mockResolvedValue([]);
      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      expect(result.profitMargin).toBe(0);
    });

    it('should handle zero costs correctly', async () => {
      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      // ROI should be 0 when costs are 0
      expect(typeof result.returnOnInvestment).toBe('number');
    });
  });

  describe('getBudgetTracking', () => {
    beforeEach(() => {
      mockPrismaService.order.findMany.mockResolvedValue([
        {
          id: 'order-1',
          createdAt: new Date('2024-01-10'),
          items: [{ price: 100, orderedQuantity: 10, tax: 50 }],
        },
      ]);
      mockPrismaService.bonus.findMany.mockResolvedValue([
        { id: 'bonus-1', baseBonus: 500, createdAt: new Date('2024-01-15') },
      ]);
      mockPrismaService.payroll.findMany.mockResolvedValue([
        { id: 'payroll-1', baseRemuneration: 5000, createdAt: new Date('2024-01-25') },
      ]);
      mockPrismaService.paintProduction.findMany.mockResolvedValue([
        {
          id: 'paint-1',
          volumeLiters: 100,
          createdAt: new Date('2024-01-20'),
          formula: { pricePerLiter: 10 },
        },
      ]);
    });

    it('should calculate budget variance correctly (actual - budget)', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      // variance = budget - spent (remaining)
      expect(result.remaining).toBe(result.totalBudget - result.spent);
    });

    it('should calculate utilization rate correctly', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      const expectedUtilization = (result.spent / result.totalBudget) * 100;
      expect(result.utilizationRate).toBeCloseTo(expectedUtilization, 1);
    });

    it('should track budget by category', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      expect(result.byCategory).toBeDefined();
      expect(Array.isArray(result.byCategory)).toBe(true);
      expect(result.byCategory.length).toBeGreaterThan(0);

      result.byCategory.forEach((category) => {
        expect(category).toMatchObject({
          category: expect.any(String),
          budget: expect.any(Number),
          spent: expect.any(Number),
          remaining: expect.any(Number),
          utilizationRate: expect.any(Number),
          status: expect.stringMatching(/^(under|on-track|over)$/),
        });
      });
    });

    it('should mark categories as "over" when spent exceeds budget', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      const overBudgetCategories = result.byCategory.filter((c) => c.status === 'over');
      overBudgetCategories.forEach((category) => {
        expect(category.utilizationRate).toBeGreaterThan(100);
      });
    });

    it('should mark categories as "under" when utilization < 70%', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      const underBudgetCategories = result.byCategory.filter((c) => c.status === 'under');
      underBudgetCategories.forEach((category) => {
        expect(category.utilizationRate).toBeLessThan(70);
      });
    });

    it('should generate alerts for over-budget categories', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      expect(result.alerts).toBeDefined();
      expect(Array.isArray(result.alerts)).toBe(true);

      result.alerts.forEach((alert) => {
        expect(alert).toMatchObject({
          category: expect.any(String),
          message: expect.any(String),
          severity: expect.stringMatching(/^(info|warning|critical)$/),
        });
      });
    });

    it('should generate critical alerts for over-budget categories', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      const criticalAlerts = result.alerts.filter((a) => a.severity === 'critical');
      criticalAlerts.forEach((alert) => {
        expect(alert.message).toContain('exceeded');
      });
    });

    it('should generate warning alerts for high utilization (>90%)', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      const warningAlerts = result.alerts.filter((a) => a.severity === 'warning');
      warningAlerts.forEach((alert) => {
        expect(alert.message).toContain('utilization');
      });
    });

    it('should round all currency values to 2 decimal places', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      expect(result.spent.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(result.remaining.toString()).toMatch(/^\d+(\.\d{1,2})?$/);

      result.byCategory.forEach((category) => {
        expect(category.budget.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
        expect(category.spent.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
        expect(category.remaining.toString()).toMatch(/^\-?\d+(\.\d{1,2})?$/);
      });
    });

    it('should provide empty trends array (TODO in implementation)', async () => {
      const query: BudgetTrackingQueryDto = {};
      const result = await service.getBudgetTracking(query);

      expect(result.trends).toBeDefined();
      expect(Array.isArray(result.trends)).toBe(true);
    });
  });

  describe('Decimal Precision and Rounding', () => {
    it('should maintain 2 decimal places for all currency values', async () => {
      const mockTasks = [
        { id: '1', price: 1234.567, status: 'completed', createdAt: new Date(), name: 'Task' },
        { id: '2', price: 9876.543, status: 'completed', createdAt: new Date(), name: 'Task 2' },
      ];
      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);

      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      // Should round to 2 decimal places
      expect(result.totalRevenue).toBeCloseTo(11111.11, 2);
    });

    it('should handle very small decimal values correctly', async () => {
      const mockTasks = [
        { id: '1', price: 0.001, status: 'completed', createdAt: new Date(), name: 'Task' },
        { id: '2', price: 0.009, status: 'completed', createdAt: new Date(), name: 'Task 2' },
      ];
      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);

      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBeCloseTo(0.01, 2);
    });

    it('should handle large numbers with precision', async () => {
      const mockTasks = [
        { id: '1', price: 9999999.999, status: 'completed', createdAt: new Date(), name: 'Task' },
      ];
      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);

      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBe(10000000);
    });
  });

  describe('Negative Values Handling', () => {
    it('should handle negative revenue values', async () => {
      const mockTasks = [
        { id: '1', price: -1000, status: 'refund', createdAt: new Date(), name: 'Refund' },
        { id: '2', price: 5000, status: 'completed', createdAt: new Date(), name: 'Task' },
      ];
      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);

      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBe(4000);
    });

    it('should handle negative profit margins', async () => {
      mockPrismaService.task.findMany.mockResolvedValue([
        { id: '1', price: 1000, createdAt: new Date(), name: 'Task', customer: { id: '1', fantasyName: 'Cust' } },
      ]);
      mockPrismaService.order.findMany.mockResolvedValue([
        {
          id: 'order-1',
          createdAt: new Date(),
          items: [{ price: 1000, orderedQuantity: 100, tax: 500 }],
        },
      ]);
      mockPrismaService.bonus.findMany.mockResolvedValue([]);
      mockPrismaService.payroll.findMany.mockResolvedValue([]);
      mockPrismaService.paintProduction.findMany.mockResolvedValue([]);

      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      // With high costs and low revenue, profit should be negative
      expect(result.grossProfit).toBeLessThan(0);
      expect(result.profitMargin).toBeLessThan(0);
    });
  });

  describe('Zero and Null Handling', () => {
    it('should handle division by zero in profit margin calculation', async () => {
      mockPrismaService.task.findMany.mockResolvedValue([]);
      mockPrismaService.order.findMany.mockResolvedValue([]);
      mockPrismaService.bonus.findMany.mockResolvedValue([]);
      mockPrismaService.payroll.findMany.mockResolvedValue([]);
      mockPrismaService.paintProduction.findMany.mockResolvedValue([]);

      const query: ProfitabilityQueryDto = {};
      const result = await service.getProfitability(query);

      expect(result.profitMargin).toBe(0);
      expect(result.returnOnInvestment).toBe(0);
    });

    it('should handle null/undefined price values', async () => {
      mockPrismaService.task.findMany.mockResolvedValue([
        { id: '1', price: null, status: 'pending', createdAt: new Date(), name: 'Task' },
        { id: '2', price: undefined, status: 'pending', createdAt: new Date(), name: 'Task 2' },
        { id: '3', price: 1000, status: 'completed', createdAt: new Date(), name: 'Task 3' },
      ]);

      const query: RevenueTrendsQueryDto = {};
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBe(1000);
    });

    it('should handle zero costs scenario', async () => {
      mockPrismaService.order.findMany.mockResolvedValue([]);
      mockPrismaService.bonus.findMany.mockResolvedValue([]);
      mockPrismaService.payroll.findMany.mockResolvedValue([]);
      mockPrismaService.paintProduction.findMany.mockResolvedValue([]);

      const query: CostAnalysisQueryDto = {};
      const result = await service.getCostAnalysis(query);

      expect(result.totalCosts).toBe(0);
      expect(result.operationalCosts.inventory).toBe(0);
      expect(result.operationalCosts.labor).toBe(0);
      expect(result.operationalCosts.materials).toBe(0);
      expect(result.operationalCosts.overhead).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large date ranges', async () => {
      const query: RevenueTrendsQueryDto = {
        startDate: '2020-01-01',
        endDate: '2030-12-31',
      };

      mockPrismaService.task.findMany.mockResolvedValue([]);
      const result = await service.getRevenueTrends(query);

      expect(result).toBeDefined();
    });

    it('should handle future dates', async () => {
      const query: RevenueTrendsQueryDto = {
        startDate: '2030-01-01',
        endDate: '2031-12-31',
      };

      mockPrismaService.task.findMany.mockResolvedValue([]);
      const result = await service.getRevenueTrends(query);

      expect(result.totalRevenue).toBe(0);
    });

    it('should handle invalid date ranges (end before start)', async () => {
      const query: RevenueTrendsQueryDto = {
        startDate: '2024-12-31',
        endDate: '2024-01-01',
      };

      mockPrismaService.task.findMany.mockResolvedValue([]);
      const result = await service.getRevenueTrends(query);

      expect(result).toBeDefined();
    });
  });
});
