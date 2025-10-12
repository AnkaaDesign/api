import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import {
  RevenueTrends,
  CostAnalysis,
  ProfitabilityMetrics,
  BudgetTracking,
} from '../interfaces/statistics.interface';
import {
  RevenueTrendsQueryDto,
  CostAnalysisQueryDto,
  ProfitabilityQueryDto,
  BudgetTrackingQueryDto,
} from '../dto/query-statistics.dto';

@Injectable()
export class FinancialStatisticsService {
  private readonly logger = new Logger(FinancialStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRevenueTrends(query: RevenueTrendsQueryDto): Promise<RevenueTrends> {
    const { startDate, endDate, customerId, sectorId, includeProjections } = query;

    const where: any = {
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        lte: endDate ? new Date(endDate) : new Date(),
      },
      price: { not: null },
    };

    if (customerId) where.customerId = customerId;
    if (sectorId) where.sectorId = sectorId;

    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        price: true,
        status: true,
        createdAt: true,
      },
    });

    const totalRevenue = tasks.reduce((sum, t) => sum + Number(t.price || 0), 0);

    // Get period revenue (last 30 days)
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const periodRevenue = tasks
      .filter((t) => new Date(t.createdAt) >= periodStart)
      .reduce((sum, t) => sum + Number(t.price || 0), 0);

    // Calculate growth
    const previousPeriodStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const previousPeriodEnd = periodStart;
    const previousRevenue = tasks
      .filter((t) => {
        const date = new Date(t.createdAt);
        return date >= previousPeriodStart && date < previousPeriodEnd;
      })
      .reduce((sum, t) => sum + Number(t.price || 0), 0);

    const growth = previousRevenue > 0
      ? ((periodRevenue - previousRevenue) / previousRevenue) * 100
      : 0;

    // By source (status)
    const sourceMap = tasks.reduce((acc, task) => {
      if (!acc[task.status]) acc[task.status] = 0;
      acc[task.status] += Number(task.price || 0);
      return acc;
    }, {} as Record<string, number>);

    const bySource = Object.entries(sourceMap).map(([source, amount]) => ({
      source,
      amount: Math.round(amount * 100) / 100,
      percentage: (amount / totalRevenue) * 100,
    }));

    // Trends by month
    const trendsMap = tasks.reduce((acc, task) => {
      const period = this.getPeriodKey(task.createdAt, 'month');
      if (!acc[period]) {
        acc[period] = { revenue: 0, taskCount: 0 };
      }
      acc[period].revenue += Number(task.price || 0);
      acc[period].taskCount++;
      return acc;
    }, {} as Record<string, any>);

    const trends = Object.entries(trendsMap).map(([period, data]: [string, any]) => ({
      period,
      revenue: Math.round(data.revenue * 100) / 100,
      taskCount: data.taskCount,
      averageValue: Math.round((data.revenue / data.taskCount) * 100) / 100,
    }));

    // Simple projections (linear regression based on last 3 months)
    const projections = includeProjections === 'true'
      ? this.calculateProjections(trends.slice(-3))
      : [];

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      periodRevenue: Math.round(periodRevenue * 100) / 100,
      growth: Math.round(growth * 10) / 10,
      bySource,
      trends,
      projections,
    };
  }

  async getCostAnalysis(query: CostAnalysisQueryDto): Promise<CostAnalysis> {
    const { startDate, endDate, categories, costType = 'all' } = query;

    const dateRange = {
      gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lte: endDate ? new Date(endDate) : new Date(),
    };

    // Inventory costs (orders)
    const orders = await this.prisma.order.findMany({
      where: { createdAt: dateRange },
      include: { items: true },
    });

    const inventoryCosts = orders.reduce((sum, order) => {
      return sum + order.items.reduce((itemSum, item) => {
        return itemSum + (item.price * item.orderedQuantity) + item.tax;
      }, 0);
    }, 0);

    // Labor costs (bonuses + payroll)
    const [bonuses, payrolls] = await Promise.all([
      this.prisma.bonus.findMany({
        where: {
          createdAt: dateRange,
        },
      }),
      this.prisma.payroll.findMany({
        where: {
          createdAt: dateRange,
        },
      }),
    ]);

    const laborCosts =
      bonuses.reduce((sum, b) => sum + Number(b.baseBonus), 0) +
      payrolls.reduce((sum, p) => sum + Number(p.baseRemuneration), 0);

    // Materials costs (paint production)
    const paintProductions = await this.prisma.paintProduction.findMany({
      where: { createdAt: dateRange },
      include: { formula: true },
    });

    const materialsCosts = paintProductions.reduce((sum, p) => {
      return sum + p.volumeLiters * Number(p.formula.pricePerLiter || 0);
    }, 0);

    // Overhead (simplified - could include facilities, utilities, etc.)
    const overheadCosts = (inventoryCosts + laborCosts + materialsCosts) * 0.15; // 15% overhead estimate

    const totalCosts = inventoryCosts + laborCosts + materialsCosts + overheadCosts;

    const byCategory = [
      { category: 'Inventory', amount: inventoryCosts, percentage: (inventoryCosts / totalCosts) * 100 },
      { category: 'Labor', amount: laborCosts, percentage: (laborCosts / totalCosts) * 100 },
      { category: 'Materials', amount: materialsCosts, percentage: (materialsCosts / totalCosts) * 100 },
      { category: 'Overhead', amount: overheadCosts, percentage: (overheadCosts / totalCosts) * 100 },
    ].map((c) => ({
      ...c,
      amount: Math.round(c.amount * 100) / 100,
      percentage: Math.round(c.percentage * 10) / 10,
    }));

    // Trends by period
    const trendsMap = new Map<string, any>();

    orders.forEach((order) => {
      const period = this.getPeriodKey(order.createdAt, 'month');
      if (!trendsMap.has(period)) {
        trendsMap.set(period, { inventory: 0, labor: 0, materials: 0 });
      }
      const trend = trendsMap.get(period);
      trend.inventory += order.items.reduce((sum, item) => {
        return sum + (item.price * item.orderedQuantity) + item.tax;
      }, 0);
    });

    const trends = Array.from(trendsMap.entries()).map(([period, data]: [string, any]) => ({
      period,
      costs: data.inventory + data.labor + data.materials,
      breakdown: {
        inventory: Math.round(data.inventory * 100) / 100,
        labor: Math.round(data.labor * 100) / 100,
        materials: Math.round(data.materials * 100) / 100,
      },
    }));

    return {
      totalCosts: Math.round(totalCosts * 100) / 100,
      periodCosts: Math.round(totalCosts * 100) / 100,
      byCategory,
      operationalCosts: {
        inventory: Math.round(inventoryCosts * 100) / 100,
        labor: Math.round(laborCosts * 100) / 100,
        materials: Math.round(materialsCosts * 100) / 100,
        overhead: Math.round(overheadCosts * 100) / 100,
      },
      trends,
    };
  }

  async getProfitability(query: ProfitabilityQueryDto): Promise<ProfitabilityMetrics> {
    const { startDate, endDate, customerId, sectorId, topN = 10 } = query;

    const dateRange = {
      gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lte: endDate ? new Date(endDate) : new Date(),
    };

    const where: any = {
      createdAt: dateRange,
      price: { not: null },
    };

    if (customerId) where.customerId = customerId;
    if (sectorId) where.sectorId = sectorId;

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        customer: { select: { id: true, fantasyName: true } },
      },
    });

    const totalRevenue = tasks.reduce((sum, t) => sum + Number(t.price || 0), 0);

    // Get costs for this period
    const costsResult = await this.getCostAnalysis({
      startDate,
      endDate,
    });

    const totalCosts = costsResult.totalCosts;
    const grossProfit = totalRevenue - totalCosts;
    const netProfit = grossProfit * 0.85; // Simplified - assume 15% for taxes, etc.
    const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const returnOnInvestment = totalCosts > 0 ? (netProfit / totalCosts) * 100 : 0;

    // By task
    const estimatedCostPerTask = totalCosts / tasks.length;
    const byTask = tasks
      .map((task) => {
        const revenue = Number(task.price || 0);
        const costs = estimatedCostPerTask;
        const profit = revenue - costs;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        return {
          taskId: task.id,
          taskName: task.name,
          revenue: Math.round(revenue * 100) / 100,
          costs: Math.round(costs * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          margin: Math.round(margin * 10) / 10,
        };
      })
      .sort((a, b) => b.profit - a.profit)
      .slice(0, topN);

    // By customer
    const customerMap = new Map<string, any>();
    tasks.forEach((task) => {
      if (!task.customer) return;
      const customerId = task.customer.id;
      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, {
          customerId,
          customerName: task.customer.fantasyName,
          revenue: 0,
          taskCount: 0,
        });
      }
      const customer = customerMap.get(customerId);
      customer.revenue += Number(task.price || 0);
      customer.taskCount++;
    });

    const byCustomer = Array.from(customerMap.values())
      .map((c) => {
        const estimatedCosts = estimatedCostPerTask * c.taskCount;
        const profit = c.revenue - estimatedCosts;
        return {
          customerId: c.customerId,
          customerName: c.customerName,
          revenue: Math.round(c.revenue * 100) / 100,
          taskCount: c.taskCount,
          averageProfit: Math.round((profit / c.taskCount) * 100) / 100,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, topN);

    return {
      grossProfit: Math.round(grossProfit * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      profitMargin: Math.round(profitMargin * 10) / 10,
      returnOnInvestment: Math.round(returnOnInvestment * 10) / 10,
      byTask,
      byCustomer,
    };
  }

  async getBudgetTracking(query: BudgetTrackingQueryDto): Promise<BudgetTracking> {
    // Simplified budget tracking - would need actual budget data in production
    const totalBudget = 1000000; // Example budget

    const costsResult = await this.getCostAnalysis(query);
    const spent = costsResult.totalCosts;
    const remaining = totalBudget - spent;
    const utilizationRate = (spent / totalBudget) * 100;

    const byCategory = costsResult.byCategory.map((cat) => {
      const categoryBudget = (cat.amount / spent) * totalBudget; // Proportional budget
      const categorySpent = cat.amount;
      const categoryRemaining = categoryBudget - categorySpent;
      const categoryUtilization = (categorySpent / categoryBudget) * 100;

      let status: 'under' | 'on-track' | 'over' = 'on-track';
      if (categoryUtilization > 100) status = 'over';
      else if (categoryUtilization < 70) status = 'under';

      return {
        category: cat.category,
        budget: Math.round(categoryBudget * 100) / 100,
        spent: Math.round(categorySpent * 100) / 100,
        remaining: Math.round(categoryRemaining * 100) / 100,
        utilizationRate: Math.round(categoryUtilization * 10) / 10,
        status,
      };
    });

    const trends = []; // TODO: Implement historical budget tracking

    const alerts = byCategory
      .filter((c) => c.status === 'over' || c.utilizationRate > 90)
      .map((c) => ({
        category: c.category,
        message: c.status === 'over'
          ? `${c.category} budget exceeded by ${Math.round((c.spent - c.budget) * 100) / 100}`
          : `${c.category} budget utilization at ${c.utilizationRate}%`,
        severity: (c.status === 'over' ? 'critical' : 'warning') as any,
      }));

    return {
      totalBudget,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      utilizationRate: Math.round(utilizationRate * 10) / 10,
      byCategory,
      trends,
      alerts,
    };
  }

  private calculateProjections(trends: any[]): any[] {
    if (trends.length < 2) return [];

    const lastTrend = trends[trends.length - 1];
    const avgGrowth = trends.reduce((sum, t, i) => {
      if (i === 0) return 0;
      return sum + ((t.revenue - trends[i - 1].revenue) / trends[i - 1].revenue);
    }, 0) / (trends.length - 1);

    const projections = [];
    let lastValue = lastTrend.revenue;

    for (let i = 1; i <= 3; i++) {
      lastValue = lastValue * (1 + avgGrowth);
      const date = new Date(lastTrend.period);
      date.setMonth(date.getMonth() + i);
      projections.push({
        period: this.getPeriodKey(date, 'month'),
        projected: Math.round(lastValue * 100) / 100,
        confidence: Math.max(50, 90 - i * 10), // Decreasing confidence
      });
    }

    return projections;
  }

  private getPeriodKey(date: Date, period: string): string {
    const d = new Date(date);
    switch (period) {
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      default:
        return d.toISOString().split('T')[0];
    }
  }
}
