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
  vacationCount: number;
}

export interface TeamPerformanceSummary {
  currentHeadcount: number;
  avgPerformanceLevel: number;
  totalWarnings: number;
  onVacationCount: number;
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
  onVacationCount: number;
}
