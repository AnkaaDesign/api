import { Test, TestingModule } from '@nestjs/testing';
import { ProductionStatisticsService } from '../production-statistics.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  ProductionTasksOverviewQueryDto,
  CompletionRatesQueryDto,
  CycleTimeAnalysisQueryDto,
  BottleneckAnalysisQueryDto,
  SectorPerformanceQueryDto,
  PaintUsageQueryDto,
} from '../../dto/query-statistics.dto';

describe('ProductionStatisticsService', () => {
  let service: ProductionStatisticsService;
  let prismaService: PrismaService;

  // Mock data
  const mockTasks = [
    {
      id: 'task-1',
      status: 'IN_PRODUCTION',
      price: 1000,
      startedAt: new Date('2024-01-01'),
      finishedAt: null,
      createdAt: new Date('2024-01-01'),
      sectorId: 'sector-1',
      customerId: 'customer-1',
      term: new Date('2024-01-15'),
    },
    {
      id: 'task-2',
      status: 'COMPLETED',
      price: 2000,
      startedAt: new Date('2024-01-01'),
      finishedAt: new Date('2024-01-10'),
      createdAt: new Date('2024-01-01'),
      sectorId: 'sector-1',
      customerId: 'customer-1',
      term: new Date('2024-01-15'),
    },
    {
      id: 'task-3',
      status: 'COMPLETED',
      price: 1500,
      startedAt: new Date('2024-01-05'),
      finishedAt: new Date('2024-01-12'),
      createdAt: new Date('2024-01-05'),
      sectorId: 'sector-2',
      customerId: 'customer-2',
      term: new Date('2024-01-10'),
    },
    {
      id: 'task-4',
      status: 'CANCELLED',
      price: 800,
      startedAt: new Date('2024-01-03'),
      finishedAt: null,
      createdAt: new Date('2024-01-03'),
      sectorId: 'sector-1',
      customerId: 'customer-1',
      term: new Date('2024-01-20'),
    },
    {
      id: 'task-5',
      status: 'ON_HOLD',
      price: 1200,
      startedAt: new Date('2024-01-02'),
      finishedAt: null,
      createdAt: new Date('2024-01-02'),
      sectorId: 'sector-2',
      customerId: 'customer-2',
      term: new Date('2024-01-25'),
    },
  ];

  const mockSectors = [
    {
      id: 'sector-1',
      name: 'Pintura',
      _count: { tasks: 2 },
      users: [{ id: 'user-1' }, { id: 'user-2' }],
    },
    {
      id: 'sector-2',
      name: 'Montagem',
      _count: { tasks: 1 },
      users: [{ id: 'user-3' }],
    },
  ];

  const mockPaintProductions = [
    {
      id: 'prod-1',
      volumeLiters: 10,
      createdAt: new Date('2024-01-05'),
      formula: {
        id: 'formula-1',
        pricePerLiter: 50,
        paint: {
          id: 'paint-1',
          name: 'Branco',
          hex: '#FFFFFF',
          paintType: { id: 'type-1', name: 'Acrílica' },
          paintBrand: { id: 'brand-1', name: 'Marca A' },
        },
      },
    },
    {
      id: 'prod-2',
      volumeLiters: 15,
      createdAt: new Date('2024-01-10'),
      formula: {
        id: 'formula-2',
        pricePerLiter: 60,
        paint: {
          id: 'paint-2',
          name: 'Preto',
          hex: '#000000',
          paintType: { id: 'type-1', name: 'Acrílica' },
          paintBrand: { id: 'brand-2', name: 'Marca B' },
        },
      },
    },
    {
      id: 'prod-3',
      volumeLiters: 8,
      createdAt: new Date('2024-01-15'),
      formula: {
        id: 'formula-1',
        pricePerLiter: 50,
        paint: {
          id: 'paint-1',
          name: 'Branco',
          hex: '#FFFFFF',
          paintType: { id: 'type-1', name: 'Acrílica' },
          paintBrand: { id: 'brand-1', name: 'Marca A' },
        },
      },
    },
  ];

  const mockPrismaService = {
    task: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    sector: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    paintProduction: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionStatisticsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ProductionStatisticsService>(ProductionStatisticsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTasksOverview', () => {
    it('should return tasks overview with all status counts', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([
          { status: 'IN_PRODUCTION', _count: { id: 1 } },
          { status: 'COMPLETED', _count: { id: 2 } },
          { status: 'CANCELLED', _count: { id: 1 } },
          { status: 'ON_HOLD', _count: { id: 1 } },
        ])
        .mockResolvedValueOnce([
          { sectorId: 'sector-1', _count: { id: 3 } },
          { sectorId: 'sector-2', _count: { id: 2 } },
        ]);

      mockPrismaService.sector.findUnique
        .mockResolvedValueOnce({ name: 'Pintura' })
        .mockResolvedValueOnce({ name: 'Montagem' });

      const result = await service.getTasksOverview(query);

      expect(result.totalTasks).toBe(5);
      expect(result.activeTasks).toBe(1);
      expect(result.completedTasks).toBe(2);
      expect(result.cancelledTasks).toBe(1);
      expect(result.onHoldTasks).toBe(1);
      expect(result.byStatus).toHaveLength(4);
      expect(result.bySector).toHaveLength(2);
    });

    it('should filter tasks by status', async () => {
      const query: ProductionTasksOverviewQueryDto = {
        statuses: ['COMPLETED'],
      };

      const completedTasks = mockTasks.filter((t) => t.status === 'COMPLETED');

      mockPrismaService.task.findMany.mockResolvedValue(completedTasks);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([{ status: 'COMPLETED', _count: { id: 2 } }])
        .mockResolvedValueOnce([
          { sectorId: 'sector-1', _count: { id: 1 } },
          { sectorId: 'sector-2', _count: { id: 1 } },
        ]);

      mockPrismaService.sector.findUnique
        .mockResolvedValueOnce({ name: 'Pintura' })
        .mockResolvedValueOnce({ name: 'Montagem' });

      const result = await service.getTasksOverview(query);

      expect(result.totalTasks).toBe(2);
      expect(result.completedTasks).toBe(2);
    });

    it('should calculate average completion time correctly', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([{ status: 'COMPLETED', _count: { id: 2 } }])
        .mockResolvedValueOnce([{ sectorId: 'sector-1', _count: { id: 2 } }]);

      mockPrismaService.sector.findUnique.mockResolvedValue({ name: 'Pintura' });

      const result = await service.getTasksOverview(query);

      // Task 2: 9 days, Task 3: 7 days = average 8 days
      expect(result.averageCompletionTime).toBeGreaterThan(0);
    });

    it('should calculate total revenue correctly', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([{ status: 'COMPLETED', _count: { id: 2 } }])
        .mockResolvedValueOnce([{ sectorId: 'sector-1', _count: { id: 3 } }]);

      mockPrismaService.sector.findUnique.mockResolvedValue({ name: 'Pintura' });

      const result = await service.getTasksOverview(query);

      // 1000 + 2000 + 1500 + 800 + 1200 = 6500
      expect(result.totalRevenue).toBe(6500);
    });

    it('should filter by sector', async () => {
      const query: ProductionTasksOverviewQueryDto = {
        sectorId: 'sector-1',
      };

      const sector1Tasks = mockTasks.filter((t) => t.sectorId === 'sector-1');

      mockPrismaService.task.findMany.mockResolvedValue(sector1Tasks);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([{ status: 'IN_PRODUCTION', _count: { id: 1 } }])
        .mockResolvedValueOnce([{ sectorId: 'sector-1', _count: { id: 3 } }]);

      mockPrismaService.sector.findUnique.mockResolvedValue({ name: 'Pintura' });

      const result = await service.getTasksOverview(query);

      expect(result.totalTasks).toBe(3);
      expect(result.bySector).toHaveLength(1);
      expect(result.bySector[0].sectorName).toBe('Pintura');
    });
  });

  describe('getCompletionRates', () => {
    it('should calculate completion rates correctly', async () => {
      const query: CompletionRatesQueryDto = {
        period: 'month',
      };

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);

      const result = await service.getCompletionRates(query);

      expect(result.totalStarted).toBe(4); // Tasks with startedAt
      expect(result.totalCompleted).toBe(2);
      expect(result.completionRate).toBeGreaterThan(0);
      expect(result.completionRate).toBeLessThanOrEqual(100);
    });

    it('should calculate on-time completion rate', async () => {
      const query: CompletionRatesQueryDto = {
        period: 'month',
      };

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);

      const result = await service.getCompletionRates(query);

      expect(result.onTimeCompletions).toBe(1); // Task 2 was on time
      expect(result.lateCompletions).toBe(1); // Task 3 was late
      expect(result.onTimeRate).toBe(50);
    });

    it('should return trends grouped by period', async () => {
      const query: CompletionRatesQueryDto = {
        period: 'month',
      };

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);

      const result = await service.getCompletionRates(query);

      expect(result.trends).toBeDefined();
      expect(Array.isArray(result.trends)).toBe(true);
      expect(result.trends.length).toBeGreaterThan(0);
    });

    it('should filter by sector', async () => {
      const query: CompletionRatesQueryDto = {
        sectorId: 'sector-1',
        period: 'month',
      };

      const sector1Tasks = mockTasks.filter((t) => t.sectorId === 'sector-1');
      mockPrismaService.task.findMany.mockResolvedValue(sector1Tasks);

      const result = await service.getCompletionRates(query);

      expect(result.totalStarted).toBe(3);
    });
  });

  describe('getCycleTimeAnalysis', () => {
    it('should calculate cycle time statistics', async () => {
      const query: CycleTimeAnalysisQueryDto = {};

      const completedTasks = mockTasks.filter((t) => t.status === 'COMPLETED');
      mockPrismaService.task.findMany.mockResolvedValue(
        completedTasks.map((t) => ({
          ...t,
          sector: { name: 'Pintura' },
        }))
      );

      const result = await service.getCycleTimeAnalysis(query);

      expect(result.averageCycleTime).toBeGreaterThan(0);
      expect(result.medianCycleTime).toBeGreaterThan(0);
      expect(result.minCycleTime).toBeGreaterThan(0);
      expect(result.maxCycleTime).toBeGreaterThan(0);
    });

    it('should group cycle times by sector', async () => {
      const query: CycleTimeAnalysisQueryDto = {};

      const completedTasks = mockTasks.filter((t) => t.status === 'COMPLETED');
      mockPrismaService.task.findMany.mockResolvedValue([
        { ...completedTasks[0], sector: { name: 'Pintura' } },
        { ...completedTasks[1], sector: { name: 'Montagem' } },
      ]);

      const result = await service.getCycleTimeAnalysis(query);

      expect(result.bySector).toBeDefined();
      expect(result.bySector.length).toBeGreaterThan(0);
    });

    it('should calculate distribution ranges', async () => {
      const query: CycleTimeAnalysisQueryDto = {};

      const completedTasks = mockTasks.filter((t) => t.status === 'COMPLETED');
      mockPrismaService.task.findMany.mockResolvedValue(
        completedTasks.map((t) => ({
          ...t,
          sector: { name: 'Pintura' },
        }))
      );

      const result = await service.getCycleTimeAnalysis(query);

      expect(result.distribution).toBeDefined();
      expect(result.distribution).toHaveLength(5);
      expect(result.distribution[0].range).toBe('0-7 days');
    });

    it('should filter by customer', async () => {
      const query: CycleTimeAnalysisQueryDto = {
        customerId: 'customer-1',
      };

      const customerTasks = mockTasks.filter(
        (t) => t.status === 'COMPLETED' && t.customerId === 'customer-1'
      );
      mockPrismaService.task.findMany.mockResolvedValue(
        customerTasks.map((t) => ({
          ...t,
          sector: { name: 'Pintura' },
        }))
      );

      const result = await service.getCycleTimeAnalysis(query);

      expect(result.averageCycleTime).toBeGreaterThan(0);
    });
  });

  describe('getBottlenecks', () => {
    it('should identify bottlenecks based on utilization', async () => {
      const query: BottleneckAnalysisQueryDto = {};

      mockPrismaService.sector.findMany.mockResolvedValue(mockSectors);

      const result = await service.getBottlenecks(query);

      expect(result.identifiedBottlenecks).toBeDefined();
      expect(result.workloadDistribution).toBeDefined();
      expect(result.workloadDistribution.length).toBe(2);
    });

    it('should calculate utilization rates correctly', async () => {
      const query: BottleneckAnalysisQueryDto = {};

      mockPrismaService.sector.findMany.mockResolvedValue(mockSectors);

      const result = await service.getBottlenecks(query);

      result.workloadDistribution.forEach((sector) => {
        expect(sector.utilizationRate).toBeGreaterThanOrEqual(0);
        expect(sector.capacity).toBeGreaterThan(0);
      });
    });

    it('should identify high utilization sectors as bottlenecks', async () => {
      const query: BottleneckAnalysisQueryDto = {};

      const highUtilizationSector = {
        id: 'sector-3',
        name: 'High Load',
        _count: { tasks: 50 },
        users: [{ id: 'user-1' }],
      };

      mockPrismaService.sector.findMany.mockResolvedValue([
        ...mockSectors,
        highUtilizationSector,
      ]);

      const result = await service.getBottlenecks(query);

      expect(result.identifiedBottlenecks.length).toBeGreaterThan(0);
      expect(
        result.identifiedBottlenecks.some((b) => b.utilizationRate > 80)
      ).toBe(true);
    });

    it('should provide recommendations for bottlenecks', async () => {
      const query: BottleneckAnalysisQueryDto = {};

      const highUtilizationSector = {
        id: 'sector-3',
        name: 'High Load',
        _count: { tasks: 50 },
        users: [{ id: 'user-1' }],
      };

      mockPrismaService.sector.findMany.mockResolvedValue([highUtilizationSector]);

      const result = await service.getBottlenecks(query);

      if (result.identifiedBottlenecks.length > 0) {
        expect(result.identifiedBottlenecks[0].recommendations).toBeDefined();
        expect(result.identifiedBottlenecks[0].recommendations.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getSectorPerformance', () => {
    it('should return performance metrics for all sectors', async () => {
      const query: SectorPerformanceQueryDto = {};

      mockPrismaService.sector.findMany.mockResolvedValue(
        mockSectors.map((s) => ({
          ...s,
          tasks: mockTasks.filter((t) => t.sectorId === s.id),
        }))
      );

      const result = await service.getSectorPerformance(query);

      expect(result).toHaveLength(2);
      expect(result[0].sectorName).toBeDefined();
      expect(result[0].totalTasks).toBeGreaterThanOrEqual(0);
      expect(result[0].completionRate).toBeGreaterThanOrEqual(0);
    });

    it('should calculate completion rate correctly', async () => {
      const query: SectorPerformanceQueryDto = {};

      mockPrismaService.sector.findMany.mockResolvedValue([
        {
          ...mockSectors[0],
          tasks: mockTasks.filter((t) => t.sectorId === 'sector-1'),
        },
      ]);

      const result = await service.getSectorPerformance(query);

      expect(result[0].completionRate).toBeGreaterThan(0);
      expect(result[0].completionRate).toBeLessThanOrEqual(100);
    });

    it('should calculate revenue per sector', async () => {
      const query: SectorPerformanceQueryDto = {};

      mockPrismaService.sector.findMany.mockResolvedValue(
        mockSectors.map((s) => ({
          ...s,
          tasks: mockTasks.filter((t) => t.sectorId === s.id),
        }))
      );

      const result = await service.getSectorPerformance(query);

      result.forEach((sector) => {
        expect(sector.revenue).toBeGreaterThanOrEqual(0);
      });
    });

    it('should calculate tasks per employee', async () => {
      const query: SectorPerformanceQueryDto = {};

      mockPrismaService.sector.findMany.mockResolvedValue(
        mockSectors.map((s) => ({
          ...s,
          tasks: mockTasks.filter((t) => t.sectorId === s.id),
        }))
      );

      const result = await service.getSectorPerformance(query);

      result.forEach((sector) => {
        expect(sector.employeeCount).toBeGreaterThan(0);
        expect(sector.tasksPerEmployee).toBeGreaterThanOrEqual(0);
      });
    });

    it('should filter by specific sector', async () => {
      const query: SectorPerformanceQueryDto = {
        sectorId: 'sector-1',
      };

      mockPrismaService.sector.findMany.mockResolvedValue([
        {
          ...mockSectors[0],
          tasks: mockTasks.filter((t) => t.sectorId === 'sector-1'),
        },
      ]);

      const result = await service.getSectorPerformance(query);

      expect(result).toHaveLength(1);
      expect(result[0].sectorId).toBe('sector-1');
    });
  });

  describe('getPaintUsage', () => {
    it('should return paint usage statistics', async () => {
      const query: PaintUsageQueryDto = {};

      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);

      const result = await service.getPaintUsage(query);

      expect(result.totalLitersProduced).toBeGreaterThan(0);
      expect(result.totalCost).toBeGreaterThan(0);
      expect(result.formulaCount).toBe(3);
    });

    it('should calculate total liters correctly', async () => {
      const query: PaintUsageQueryDto = {};

      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);

      const result = await service.getPaintUsage(query);

      // 10 + 15 + 8 = 33 liters
      expect(result.totalLitersProduced).toBe(33);
    });

    it('should group by paint type', async () => {
      const query: PaintUsageQueryDto = {};

      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);

      const result = await service.getPaintUsage(query);

      expect(result.byType).toBeDefined();
      expect(result.byType.length).toBeGreaterThan(0);
      expect(result.byType[0].paintType).toBe('Acrílica');
    });

    it('should group by paint brand', async () => {
      const query: PaintUsageQueryDto = {};

      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);

      const result = await service.getPaintUsage(query);

      expect(result.byBrand).toBeDefined();
      expect(result.byBrand.length).toBe(2); // Marca A and Marca B
    });

    it('should return top N colors', async () => {
      const query: PaintUsageQueryDto = {
        topN: 5,
      };

      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);

      const result = await service.getPaintUsage(query);

      expect(result.topColors).toBeDefined();
      expect(result.topColors.length).toBeLessThanOrEqual(5);
      expect(result.topColors[0].litersProduced).toBeGreaterThanOrEqual(
        result.topColors[result.topColors.length - 1]?.litersProduced || 0
      );
    });

    it('should calculate cost correctly', async () => {
      const query: PaintUsageQueryDto = {};

      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);

      const result = await service.getPaintUsage(query);

      // (10 * 50) + (15 * 60) + (8 * 50) = 500 + 900 + 400 = 1800
      expect(result.totalCost).toBe(1800);
    });

    it('should provide trends over time', async () => {
      const query: PaintUsageQueryDto = {};

      mockPrismaService.paintProduction.findMany.mockResolvedValue(mockPaintProductions);

      const result = await service.getPaintUsage(query);

      expect(result.trends).toBeDefined();
      expect(Array.isArray(result.trends)).toBe(true);
    });

    it('should filter by date range', async () => {
      const query: PaintUsageQueryDto = {
        startDate: '2024-01-08',
        endDate: '2024-01-15',
      };

      const filteredProductions = mockPaintProductions.filter(
        (p) =>
          p.createdAt >= new Date('2024-01-08') &&
          p.createdAt <= new Date('2024-01-15')
      );

      mockPrismaService.paintProduction.findMany.mockResolvedValue(filteredProductions);

      const result = await service.getPaintUsage(query);

      expect(result.formulaCount).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty task list', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      mockPrismaService.task.findMany.mockResolvedValue([]);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getTasksOverview(query);

      expect(result.totalTasks).toBe(0);
      expect(result.averageCompletionTime).toBe(0);
      expect(result.totalRevenue).toBe(0);
    });

    it('should handle tasks without dates', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      const tasksWithoutDates = [
        {
          ...mockTasks[0],
          startedAt: null,
          finishedAt: null,
        },
      ];

      mockPrismaService.task.findMany.mockResolvedValue(tasksWithoutDates);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([{ status: 'IN_PRODUCTION', _count: { id: 1 } }])
        .mockResolvedValueOnce([]);

      const result = await service.getTasksOverview(query);

      expect(result.averageCompletionTime).toBe(0);
    });

    it('should handle sectors with no users', async () => {
      const query: BottleneckAnalysisQueryDto = {};

      const sectorsWithNoUsers = [
        {
          id: 'sector-empty',
          name: 'Empty Sector',
          _count: { tasks: 5 },
          users: [],
        },
      ];

      mockPrismaService.sector.findMany.mockResolvedValue(sectorsWithNoUsers);

      const result = await service.getBottlenecks(query);

      expect(result.workloadDistribution[0].utilizationRate).toBe(0);
    });

    it('should handle zero paint productions', async () => {
      const query: PaintUsageQueryDto = {};

      mockPrismaService.paintProduction.findMany.mockResolvedValue([]);

      const result = await service.getPaintUsage(query);

      expect(result.totalLitersProduced).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.formulaCount).toBe(0);
      expect(result.topColors).toHaveLength(0);
    });
  });

  describe('data validation', () => {
    it('should round decimal values appropriately', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([{ status: 'COMPLETED', _count: { id: 2 } }])
        .mockResolvedValueOnce([{ sectorId: 'sector-1', _count: { id: 2 } }]);

      mockPrismaService.sector.findUnique.mockResolvedValue({ name: 'Pintura' });

      const result = await service.getTasksOverview(query);

      // Check that values are rounded to 1 decimal place
      expect(result.averageCompletionTime.toString()).toMatch(/^\d+\.\d{1}$/);
    });

    it('should handle null/undefined prices', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      const tasksWithNullPrices = [
        {
          ...mockTasks[0],
          price: null,
        },
      ];

      mockPrismaService.task.findMany.mockResolvedValue(tasksWithNullPrices);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([{ status: 'IN_PRODUCTION', _count: { id: 1 } }])
        .mockResolvedValueOnce([]);

      const result = await service.getTasksOverview(query);

      expect(result.totalRevenue).toBe(0);
    });

    it('should calculate percentages correctly', async () => {
      const query: ProductionTasksOverviewQueryDto = {};

      mockPrismaService.task.findMany.mockResolvedValue(mockTasks);
      mockPrismaService.task.groupBy
        .mockResolvedValueOnce([
          { status: 'IN_PRODUCTION', _count: { id: 1 } },
          { status: 'COMPLETED', _count: { id: 2 } },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getTasksOverview(query);

      const totalPercentage = result.byStatus.reduce((sum, s) => sum + s.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100, 0);
    });
  });
});
