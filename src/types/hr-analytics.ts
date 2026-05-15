export interface PayrollTrendItem {
  period: string;
  label: string;
  grossSalary: number;
  netSalary: number;
  totalDiscounts: number;
  inssAmount: number;
  irrfAmount: number;
  fgtsAmount: number;
  overtime50Amount: number;
  overtime100Amount: number;
  nightDifferentialAmount: number;
  bonusTotal: number;
  headcount: number;
}

export interface PayrollTrendsSummary {
  totalGrossSalary: number;
  avgGrossSalary: number;
  taxBurdenPercent: number;
  totalBonuses: number;
  monthOverMonthGrowth: number;
}

export interface PayrollTrendsResult {
  items: PayrollTrendItem[];
  summary: PayrollTrendsSummary;
  comparison?: PayrollSectorComparison[];
}

export interface PayrollSectorComparison {
  sectorId: string;
  sectorName: string;
  totalGrossSalary: number;
  totalNetSalary: number;
  totalDiscounts: number;
  totalBonuses: number;
  headcount: number;
  avgGrossSalary: number;
}

export interface TeamPerformanceItem {
  period: string;
  label: string;
  headcount: number;
  newHires: number;
  dismissals: number;
  turnoverRate: number;
  performanceDistribution: Record<number, number>;
  warningsByCategory: Record<string, number>;
  totalWarnings: number;
}

export interface TeamPerformanceSummary {
  currentHeadcount: number;
  avgPerformanceLevel: number;
  totalWarnings: number;
  turnoverRate: number;
}

export interface TeamPerformanceResult {
  items: TeamPerformanceItem[];
  summary: TeamPerformanceSummary;
  comparison?: TeamSectorComparison[];
}

export interface TeamSectorComparison {
  sectorId: string;
  sectorName: string;
  headcount: number;
  avgPerformanceLevel: number;
  totalWarnings: number;
}

// ---------------------------------------------------------------------------
// Headcount (Equipe) Analytics
// ---------------------------------------------------------------------------

export interface HeadcountSummary {
  totalActive: number;
  totalInactive: number;
  totalEmployees: number;
  totalSectors: number;
  averageBySector: number;
  largestSector: { id: string; name: string; count: number } | null;
  smallestSector: { id: string; name: string; count: number } | null;
  unassignedSector: number;
  newHiresInPeriod: number;
  dismissalsInPeriod: number;
  netChange: number;
  inExperiencePeriod: number;
  effected: number;
}

export interface HeadcountPositionBreakdown {
  positionId: string;
  positionName: string;
  count: number;
  active: number;
  inactive: number;
}

export interface HeadcountSectorBreakdown {
  sectorId: string | null;
  sectorName: string;
  count: number;
  active: number;
  inactive: number;
  newHires: number;
  dismissals: number;
  percentOfTotal: number;
  positions: HeadcountPositionBreakdown[];
}

export interface HeadcountTimeseriesItem {
  period: string;
  label: string;
  headcount: number;
  active: number;
  inExperience: number;
  newHires: number;
  dismissals: number;
  netChange: number;
  sectorBreakdown?: Array<{ sectorId: string; sectorName: string; count: number }>;
}

export interface HeadcountResult {
  summary: HeadcountSummary;
  sectorBreakdown: HeadcountSectorBreakdown[];
  positionBreakdown: HeadcountPositionBreakdown[];
  timeseries: HeadcountTimeseriesItem[];
  snapshotDate: Date;
}

// ---------------------------------------------------------------------------
// Rotatividade (Turnover) Analytics
// ---------------------------------------------------------------------------

export interface TurnoverItem {
  period: string;
  label: string;
  newHires: number;
  dismissals: number;
  netChange: number;
  headcountStart: number;
  headcountEnd: number;
  averageHeadcount: number;
  turnoverRate: number;
  voluntaryRate: number;
  comparisons?: Array<{
    sectorId: string;
    sectorName: string;
    newHires: number;
    dismissals: number;
    avgHeadcount: number;
    turnoverRate: number;
  }>;
}

export interface TurnoverSectorBreakdown {
  sectorId: string;
  sectorName: string;
  newHires: number;
  dismissals: number;
  avgHeadcount: number;
  turnoverRate: number;
  netChange: number;
}

export interface TurnoverSummary {
  totalAdmissions: number;
  totalDismissals: number;
  netChange: number;
  averageHeadcount: number;
  turnoverRate: number;
  averageTenureDays: number;
  shortestTenureDays: number | null;
  longestTenureDays: number | null;
  experienceFailureRate: number;
}

export interface TurnoverResult {
  summary: TurnoverSummary;
  items: TurnoverItem[];
  sectorBreakdown: TurnoverSectorBreakdown[];
}

// ---------------------------------------------------------------------------
// Absenteísmo (Absenteeism, Secullum) Analytics
// ---------------------------------------------------------------------------

export interface AbsenteeismItem {
  period: string;
  label: string;
  absenceHours: number;
  scheduledHours: number;
  rate: number;
  faltasJustified: number;
  faltasUnjustified: number;
  atestados: number;
  atrasosMinutes: number;
  affectedUsers: number;
}

export interface AbsenteeismSectorBreakdown {
  sectorId: string;
  sectorName: string;
  absenceHours: number;
  scheduledHours: number;
  rate: number;
  faltasJustified: number;
  faltasUnjustified: number;
  atestados: number;
  atrasosMinutes: number;
  affectedUsers: number;
  headcount: number;
}

export interface AbsenteeismUserBreakdown {
  userId: string;
  userName: string;
  sectorName: string | null;
  absenceHours: number;
  scheduledHours: number;
  rate: number;
  faltasJustified: number;
  faltasUnjustified: number;
  atestados: number;
  atrasosMinutes: number;
}

export interface AbsenteeismSummary {
  absenceHours: number;
  scheduledHours: number;
  rate: number;
  faltasJustified: number;
  faltasUnjustified: number;
  atestados: number;
  atrasosMinutes: number;
  affectedUsers: number;
  totalUsersTracked: number;
  unmappedUsers: number;
}

export interface AbsenteeismResult {
  summary: AbsenteeismSummary;
  items: AbsenteeismItem[];
  sectorBreakdown: AbsenteeismSectorBreakdown[];
  topAbsentees: AbsenteeismUserBreakdown[];
}
