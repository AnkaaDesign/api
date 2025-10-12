import { Test, TestingModule } from '@nestjs/testing';
import { HrStatisticsService } from '../hr-statistics.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';

describe('HrStatisticsService', () => {
  let service: HrStatisticsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    user: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    bonus: {
      findMany: jest.fn(),
    },
    warning: {
      findMany: jest.fn(),
    },
    sector: {
      findUnique: jest.fn(),
    },
    position: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrStatisticsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<HrStatisticsService>(HrStatisticsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEmployeeOverview', () => {
    const mockUsers = [
      {
        id: 'user-1',
        status: 'CONTRACTED',
        birth: new Date('1990-01-01'),
        admissional: new Date('2020-01-01'),
        dismissal: null,
        performanceLevel: 4,
        sectorId: 'sector-1',
        positionId: 'position-1',
      },
      {
        id: 'user-2',
        status: 'EXPERIENCE_PERIOD_1',
        birth: new Date('1995-03-15'),
        admissional: new Date('2023-06-01'),
        dismissal: null,
        performanceLevel: 3,
        sectorId: 'sector-1',
        positionId: 'position-2',
      },
      {
        id: 'user-3',
        status: 'DISMISSED',
        birth: new Date('1988-07-20'),
        admissional: new Date('2018-03-01'),
        dismissal: new Date('2024-01-15'),
        performanceLevel: 2,
        sectorId: 'sector-2',
        positionId: 'position-1',
      },
    ];

    it('should return employee overview with correct counts', async () => {
      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);
      mockPrismaService.user.groupBy
        .mockResolvedValueOnce([
          { sectorId: 'sector-1', _avg: { performanceLevel: 3.5 }, _count: { id: 2 } },
          { sectorId: 'sector-2', _avg: { performanceLevel: 2.0 }, _count: { id: 1 } },
        ])
        .mockResolvedValueOnce([
          { positionId: 'position-1', _count: { id: 2 } },
          { positionId: 'position-2', _count: { id: 1 } },
        ]);

      mockPrismaService.sector.findUnique
        .mockResolvedValueOnce({ name: 'Engineering' })
        .mockResolvedValueOnce({ name: 'Sales' });

      mockPrismaService.position.findUnique
        .mockResolvedValueOnce({ name: 'Developer' })
        .mockResolvedValueOnce({ name: 'Manager' });

      const result = await service.getEmployeeOverview({});

      expect(result.totalEmployees).toBe(3);
      expect(result.activeEmployees).toBe(2);
      expect(result.onExperiencePeriod).toBe(1);
      expect(result.contracted).toBe(1);
      expect(result.dismissed).toBe(1);
    });

    it('should filter employees by sector', async () => {
      const sectorUsers = mockUsers.filter(u => u.sectorId === 'sector-1');
      mockPrismaService.user.findMany.mockResolvedValue(sectorUsers);
      mockPrismaService.user.groupBy
        .mockResolvedValueOnce([
          { sectorId: 'sector-1', _avg: { performanceLevel: 3.5 }, _count: { id: 2 } },
        ])
        .mockResolvedValueOnce([
          { positionId: 'position-1', _count: { id: 1 } },
          { positionId: 'position-2', _count: { id: 1 } },
        ]);

      mockPrismaService.sector.findUnique.mockResolvedValue({ name: 'Engineering' });
      mockPrismaService.position.findUnique
        .mockResolvedValueOnce({ name: 'Developer' })
        .mockResolvedValueOnce({ name: 'Manager' });

      const result = await service.getEmployeeOverview({ sectorId: 'sector-1' });

      expect(result.totalEmployees).toBe(2);
      expect(result.bySector).toHaveLength(1);
      expect(result.bySector[0].sectorId).toBe('sector-1');
    });

    it('should calculate demographics correctly', async () => {
      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);
      mockPrismaService.user.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getEmployeeOverview({});

      expect(result.demographics.averageAge).toBeGreaterThan(0);
      expect(result.demographics.averageTenure).toBeGreaterThan(0);
      expect(result.demographics.turnoverRate).toBeGreaterThanOrEqual(0);
    });

    it('should filter by employee status', async () => {
      const activeUsers = mockUsers.filter(u =>
        ['CONTRACTED', 'EXPERIENCE_PERIOD_1', 'EXPERIENCE_PERIOD_2'].includes(u.status)
      );
      mockPrismaService.user.findMany.mockResolvedValue(activeUsers);
      mockPrismaService.user.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getEmployeeOverview({
        statuses: ['CONTRACTED', 'EXPERIENCE_PERIOD_1']
      });

      expect(result.totalEmployees).toBe(2);
      expect(result.dismissed).toBe(0);
    });

    it('should handle empty employee list', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);
      mockPrismaService.user.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getEmployeeOverview({});

      expect(result.totalEmployees).toBe(0);
      expect(result.activeEmployees).toBe(0);
      expect(result.bySector).toEqual([]);
      expect(result.demographics.averageAge).toBe(0);
    });
  });

  describe('getPerformanceMetrics', () => {
    const mockUsersWithPerformance = [
      {
        id: 'user-1',
        name: 'John Doe',
        performanceLevel: 5,
        sectorId: 'sector-1',
        positionId: 'position-1',
        position: { name: 'Senior Developer' },
        sector: { name: 'Engineering' },
        createdTasks: [{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }],
      },
      {
        id: 'user-2',
        name: 'Jane Smith',
        performanceLevel: 4,
        sectorId: 'sector-1',
        positionId: 'position-2',
        position: { name: 'Developer' },
        sector: { name: 'Engineering' },
        createdTasks: [{ id: 'task-4' }, { id: 'task-5' }],
      },
      {
        id: 'user-3',
        name: 'Bob Johnson',
        performanceLevel: 3,
        sectorId: 'sector-2',
        positionId: 'position-3',
        position: { name: 'Sales Rep' },
        sector: { name: 'Sales' },
        createdTasks: [{ id: 'task-6' }],
      },
    ];

    it('should calculate average performance level', async () => {
      mockPrismaService.user.findMany.mockResolvedValue(mockUsersWithPerformance);

      const result = await service.getPerformanceMetrics({});

      expect(result.averagePerformanceLevel).toBe(4);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { performanceLevel: { gt: 0 } },
        })
      );
    });

    it('should return top N performers', async () => {
      mockPrismaService.user.findMany.mockResolvedValue(mockUsersWithPerformance);

      const result = await service.getPerformanceMetrics({ topN: 2 });

      expect(result.topPerformers).toHaveLength(2);
      expect(result.topPerformers[0].userId).toBe('user-1');
      expect(result.topPerformers[0].performanceLevel).toBe(5);
      expect(result.topPerformers[0].tasksCompleted).toBe(3);
    });

    it('should group performance by sector', async () => {
      mockPrismaService.user.findMany.mockResolvedValue(mockUsersWithPerformance);

      const result = await service.getPerformanceMetrics({});

      expect(result.bySector).toHaveLength(2);
      const engineeringSector = result.bySector.find(s => s.sectorId === 'sector-1');
      expect(engineeringSector?.averagePerformance).toBe(4.5);
      expect(engineeringSector?.employeeCount).toBe(2);
    });

    it('should calculate performance distribution', async () => {
      mockPrismaService.user.findMany.mockResolvedValue(mockUsersWithPerformance);

      const result = await service.getPerformanceMetrics({});

      expect(result.distribution).toHaveLength(6); // Levels 0-5
      const level5 = result.distribution.find(d => d.level === 5);
      expect(level5?.count).toBe(1);
      expect(level5?.percentage).toBeCloseTo(33.33, 1);
    });

    it('should filter by sector', async () => {
      const engineeringUsers = mockUsersWithPerformance.filter(u => u.sectorId === 'sector-1');
      mockPrismaService.user.findMany.mockResolvedValue(engineeringUsers);

      const result = await service.getPerformanceMetrics({ sectorId: 'sector-1' });

      expect(result.topPerformers).toHaveLength(2);
      expect(result.bySector).toHaveLength(1);
    });

    it('should handle users with no performance data', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getPerformanceMetrics({});

      expect(result.averagePerformanceLevel).toBe(0);
      expect(result.topPerformers).toEqual([]);
      expect(result.bySector).toEqual([]);
    });
  });

  describe('getBonusDistribution', () => {
    const mockBonuses = [
      {
        id: 'bonus-1',
        userId: 'user-1',
        year: 2024,
        month: 1,
        baseBonus: 1000,
        user: {
          name: 'John Doe',
          sectorId: 'sector-1',
          sector: { name: 'Engineering' },
        },
      },
      {
        id: 'bonus-2',
        userId: 'user-1',
        year: 2024,
        month: 2,
        baseBonus: 1500,
        user: {
          name: 'John Doe',
          sectorId: 'sector-1',
          sector: { name: 'Engineering' },
        },
      },
      {
        id: 'bonus-3',
        userId: 'user-2',
        year: 2024,
        month: 1,
        baseBonus: 800,
        user: {
          name: 'Jane Smith',
          sectorId: 'sector-2',
          sector: { name: 'Sales' },
        },
      },
    ];

    it('should calculate total bonuses paid', async () => {
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getBonusDistribution({});

      expect(result.totalBonusesPaid).toBe(3300);
      expect(result.employeesReceivingBonus).toBe(2);
      expect(result.averageBonusValue).toBe(1650);
    });

    it('should group bonuses by period', async () => {
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getBonusDistribution({});

      expect(result.byPeriod).toHaveLength(2);
      const jan2024 = result.byPeriod.find(p => p.year === 2024 && p.month === 1);
      expect(jan2024?.totalPaid).toBe(1800);
      expect(jan2024?.employeeCount).toBe(2);
    });

    it('should group bonuses by sector', async () => {
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getBonusDistribution({});

      expect(result.bySector).toHaveLength(2);
      const engineeringSector = result.bySector.find(s => s.sectorId === 'sector-1');
      expect(engineeringSector?.totalPaid).toBe(2500);
      expect(engineeringSector?.employeeCount).toBe(1);
    });

    it('should return top bonus recipients', async () => {
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getBonusDistribution({ topN: 5 });

      expect(result.topRecipients).toHaveLength(2);
      expect(result.topRecipients[0].userId).toBe('user-1');
      expect(result.topRecipients[0].totalReceived).toBe(2500);
      expect(result.topRecipients[0].bonusCount).toBe(2);
    });

    it('should filter by year and month', async () => {
      const jan2024Bonuses = mockBonuses.filter(b => b.year === 2024 && b.month === 1);
      mockPrismaService.bonus.findMany.mockResolvedValue(jan2024Bonuses);

      const result = await service.getBonusDistribution({ year: 2024, month: 1 });

      expect(result.totalBonusesPaid).toBe(1800);
      expect(mockPrismaService.bonus.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { year: 2024, month: 1 },
        })
      );
    });

    it('should filter by sector', async () => {
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getBonusDistribution({ sectorId: 'sector-1' });

      const sectorBonuses = result.bySector.filter(s => s.sectorId === 'sector-1');
      expect(sectorBonuses).toHaveLength(1);
    });

    it('should handle no bonuses', async () => {
      mockPrismaService.bonus.findMany.mockResolvedValue([]);

      const result = await service.getBonusDistribution({});

      expect(result.totalBonusesPaid).toBe(0);
      expect(result.averageBonusValue).toBe(0);
      expect(result.employeesReceivingBonus).toBe(0);
    });
  });

  describe('getWarningAnalytics', () => {
    const mockWarnings = [
      {
        id: 'warn-1',
        collaboratorId: 'user-1',
        severity: 'LOW',
        category: 'ATTENDANCE',
        isActive: true,
        resolvedAt: null,
        createdAt: new Date('2024-01-15'),
        collaborator: {
          name: 'John Doe',
          sector: { name: 'Engineering' },
        },
      },
      {
        id: 'warn-2',
        collaboratorId: 'user-1',
        severity: 'MEDIUM',
        category: 'PERFORMANCE',
        isActive: false,
        resolvedAt: new Date('2024-02-01'),
        createdAt: new Date('2024-01-20'),
        collaborator: {
          name: 'John Doe',
          sector: { name: 'Engineering' },
        },
      },
      {
        id: 'warn-3',
        collaboratorId: 'user-2',
        severity: 'HIGH',
        category: 'CONDUCT',
        isActive: true,
        resolvedAt: null,
        createdAt: new Date('2024-02-10'),
        collaborator: {
          name: 'Jane Smith',
          sector: { name: 'Sales' },
        },
      },
    ];

    it('should calculate warning counts', async () => {
      mockPrismaService.warning.findMany.mockResolvedValue(mockWarnings);

      const result = await service.getWarningAnalytics({});

      expect(result.totalWarnings).toBe(3);
      expect(result.activeWarnings).toBe(2);
      expect(result.resolvedWarnings).toBe(1);
    });

    it('should group warnings by severity', async () => {
      mockPrismaService.warning.findMany.mockResolvedValue(mockWarnings);

      const result = await service.getWarningAnalytics({});

      expect(result.bySeverity).toHaveLength(3);
      const highSeverity = result.bySeverity.find(s => s.severity === 'HIGH');
      expect(highSeverity?.count).toBe(1);
      expect(highSeverity?.percentage).toBeCloseTo(33.33, 1);
    });

    it('should group warnings by category', async () => {
      mockPrismaService.warning.findMany.mockResolvedValue(mockWarnings);

      const result = await service.getWarningAnalytics({});

      expect(result.byCategory).toHaveLength(3);
      const attendanceCategory = result.byCategory.find(c => c.category === 'ATTENDANCE');
      expect(attendanceCategory?.count).toBe(1);
    });

    it('should identify repeat offenders', async () => {
      mockPrismaService.warning.findMany.mockResolvedValue(mockWarnings);

      const result = await service.getWarningAnalytics({ topN: 10 });

      expect(result.repeatOffenders).toHaveLength(1); // Only user-1 has multiple warnings
      expect(result.repeatOffenders[0].userId).toBe('user-1');
      expect(result.repeatOffenders[0].warningCount).toBe(2);
    });

    it('should filter by date range', async () => {
      mockPrismaService.warning.findMany.mockResolvedValue(mockWarnings);

      await service.getWarningAnalytics({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(mockPrismaService.warning.findMany).toHaveBeenCalledWith(
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

    it('should filter by severity levels', async () => {
      const highWarnings = mockWarnings.filter(w => w.severity === 'HIGH');
      mockPrismaService.warning.findMany.mockResolvedValue(highWarnings);

      const result = await service.getWarningAnalytics({ severities: ['HIGH'] });

      expect(mockPrismaService.warning.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            severity: { in: ['HIGH'] },
          }),
        })
      );
    });

    it('should filter by categories', async () => {
      const attendanceWarnings = mockWarnings.filter(w => w.category === 'ATTENDANCE');
      mockPrismaService.warning.findMany.mockResolvedValue(attendanceWarnings);

      await service.getWarningAnalytics({ categories: ['ATTENDANCE'] });

      expect(mockPrismaService.warning.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: { in: ['ATTENDANCE'] },
          }),
        })
      );
    });

    it('should generate warning trends', async () => {
      mockPrismaService.warning.findMany.mockResolvedValue(mockWarnings);

      const result = await service.getWarningAnalytics({});

      expect(result.trends.length).toBeGreaterThan(0);
      expect(result.trends[0]).toHaveProperty('period');
      expect(result.trends[0]).toHaveProperty('issued');
      expect(result.trends[0]).toHaveProperty('resolved');
    });
  });

  describe('getAttendanceTrends', () => {
    it('should return placeholder data', async () => {
      const result = await service.getAttendanceTrends({});

      expect(result.totalAttendanceRecords).toBe(0);
      expect(result.averageAttendanceRate).toBe(95.5);
      expect(result.absenceRate).toBe(4.5);
      expect(result.byPeriod).toEqual([]);
      expect(result.bySector).toEqual([]);
    });

    it('should accept query parameters', async () => {
      const result = await service.getAttendanceTrends({
        sectorId: 'sector-1',
        userId: 'user-1',
      });

      expect(result).toBeDefined();
    });
  });

  describe('Security and Privacy', () => {
    it('should not expose sensitive employee data in aggregated results', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          name: 'John Doe',
          performanceLevel: 5,
          sectorId: 'sector-1',
          positionId: 'position-1',
          position: { name: 'Developer' },
          sector: { name: 'Engineering' },
          createdTasks: [],
        },
      ];
      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getPerformanceMetrics({});

      // Check that sensitive fields are not exposed
      result.topPerformers.forEach(performer => {
        expect(performer).not.toHaveProperty('salary');
        expect(performer).not.toHaveProperty('email');
        expect(performer).not.toHaveProperty('phone');
        expect(performer).not.toHaveProperty('cpf');
      });
    });

    it('should only return aggregated bonus data', async () => {
      const mockBonuses = [
        {
          id: 'bonus-1',
          userId: 'user-1',
          year: 2024,
          month: 1,
          baseBonus: 1000,
          user: {
            name: 'John Doe',
            sectorId: 'sector-1',
            sector: { name: 'Engineering' },
          },
        },
      ];
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getBonusDistribution({});

      // Ensure individual bonus details are aggregated
      expect(result.topRecipients[0]).toHaveProperty('totalReceived');
      expect(result.topRecipients[0]).toHaveProperty('bonusCount');
      expect(result.topRecipients[0]).toHaveProperty('averageValue');
    });

    it('should apply date range filters for warnings', async () => {
      mockPrismaService.warning.findMany.mockResolvedValue([]);

      await service.getWarningAnalytics({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });

      const callArgs = mockPrismaService.warning.findMany.mock.calls[0][0];
      expect(callArgs.where.createdAt).toBeDefined();
      expect(callArgs.where.createdAt.gte).toBeInstanceOf(Date);
      expect(callArgs.where.createdAt.lte).toBeInstanceOf(Date);
    });
  });

  describe('Data Validation', () => {
    it('should handle null/undefined sector gracefully', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          status: 'CONTRACTED',
          birth: new Date('1990-01-01'),
          admissional: new Date('2020-01-01'),
          dismissal: null,
          performanceLevel: 4,
          sectorId: null,
          positionId: 'position-1',
        },
      ];
      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);
      mockPrismaService.user.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { positionId: 'position-1', _count: { id: 1 } },
        ]);
      mockPrismaService.position.findUnique.mockResolvedValue({ name: 'Developer' });

      const result = await service.getEmployeeOverview({});

      expect(result.totalEmployees).toBe(1);
      expect(result.bySector).toEqual([]);
    });

    it('should round numeric values correctly', async () => {
      const mockBonuses = [
        {
          id: 'bonus-1',
          userId: 'user-1',
          year: 2024,
          month: 1,
          baseBonus: 1234.5678,
          user: {
            name: 'John Doe',
            sectorId: 'sector-1',
            sector: { name: 'Engineering' },
          },
        },
      ];
      mockPrismaService.bonus.findMany.mockResolvedValue(mockBonuses);

      const result = await service.getBonusDistribution({});

      expect(result.totalBonusesPaid).toBe(1234.57);
      expect(result.averageBonusValue).toBe(1234.57);
    });

    it('should handle edge case: topN = 0', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getPerformanceMetrics({ topN: 0 });

      expect(result.topPerformers).toEqual([]);
    });
  });
});
