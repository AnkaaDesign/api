import { format, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

// Types for raw data from API
export interface RawActivityData {
  id: string;
  type: string;
  itemId: string;
  itemName: string;
  quantity: number;
  userId: string;
  userName: string;
  sectorId: string;
  sectorName: string;
  createdAt: string;
  reason?: string;
}

export interface RawStockData {
  itemId: string;
  itemName: string;
  categoryId: string;
  categoryName: string;
  brandId: string;
  brandName: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  value: number;
  lastMovement: string;
}

export interface RawOrderData {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  totalValue: number;
  createdAt: string;
  expectedDelivery?: string;
  actualDelivery?: string;
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

// Types for transformed chart data
export interface ChartDataPoint {
  label: string;
  value: number;
  date?: string;
  category?: string;
  [key: string]: any;
}

export interface TimeSeriesData {
  date: string;
  [metric: string]: number | string;
}

export interface CategoryData {
  category: string;
  value: number;
  count: number;
  percentage: number;
  color?: string;
}

// Time series transformations
export const transformToTimeSeries = (
  data: RawActivityData[],
  dateField: keyof RawActivityData,
  aggregationType: 'day' | 'week' | 'month' = 'day',
  metrics: string[] = ['count']
): TimeSeriesData[] => {
  const groupedData = new Map<string, any>();

  data.forEach(item => {
    const date = new Date(item[dateField] as string);
    let key: string;

    switch (aggregationType) {
      case 'week':
        // Start of week (Monday)
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        key = format(startOfWeek, 'yyyy-MM-dd');
        break;
      case 'month':
        key = format(startOfMonth(date), 'yyyy-MM-dd');
        break;
      default:
        key = format(startOfDay(date), 'yyyy-MM-dd');
    }

    if (!groupedData.has(key)) {
      const initialData: any = { date: key };
      metrics.forEach(metric => {
        initialData[metric] = 0;
      });
      groupedData.set(key, initialData);
    }

    const group = groupedData.get(key)!;

    // Count activities
    if (metrics.includes('count')) {
      group.count = (group.count || 0) + 1;
    }

    // Sum quantities
    if (metrics.includes('quantity')) {
      group.quantity = (group.quantity || 0) + (item.quantity || 0);
    }

    // Group by activity type
    if (metrics.includes('byType')) {
      const typeKey = `${item.type.toLowerCase()}Count`;
      group[typeKey] = (group[typeKey] || 0) + 1;
    }

    // Group by user
    if (metrics.includes('byUser')) {
      if (!group.users) group.users = new Set();
      group.users.add(item.userId);
      group.uniqueUsers = group.users.size;
    }
  });

  // Convert to array and sort by date
  return Array.from(groupedData.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(item => {
      // Convert Set to count for serialization
      if (item.users) {
        delete item.users;
      }
      return item;
    });
};

// Category breakdown transformations
export const transformToCategoryBreakdown = (
  data: RawStockData[],
  groupByField: keyof RawStockData,
  valueField: keyof RawStockData = 'value',
  colors?: string[]
): CategoryData[] => {
  const grouped = new Map<string, { value: number; count: number }>();

  data.forEach(item => {
    const category = String(item[groupByField]);
    const value = Number(item[valueField]) || 0;

    if (!grouped.has(category)) {
      grouped.set(category, { value: 0, count: 0 });
    }

    const group = grouped.get(category)!;
    group.value += value;
    group.count += 1;
  });

  const total = Array.from(grouped.values()).reduce((sum, group) => sum + group.value, 0);

  return Array.from(grouped.entries())
    .map(([category, { value, count }], index) => ({
      category,
      value,
      count,
      percentage: total > 0 ? (value / total) * 100 : 0,
      color: colors?.[index % colors.length],
    }))
    .sort((a, b) => b.value - a.value);
};

// Stock level analysis
export const transformToStockAnalysis = (data: RawStockData[]) => {
  const analysis = {
    total: data.length,
    normal: 0,
    low: 0,
    critical: 0,
    overstock: 0,
    categories: new Map<string, any>(),
  };

  data.forEach(item => {
    // Categorize stock level
    const stockRatio = item.currentStock / item.maxStock;
    // const minRatio = item.minStock / item.maxStock; // Reserved for future use

    if (item.currentStock <= item.minStock * 0.5) {
      analysis.critical++;
    } else if (item.currentStock <= item.minStock) {
      analysis.low++;
    } else if (stockRatio > 1.2) {
      analysis.overstock++;
    } else {
      analysis.normal++;
    }

    // Category analysis
    if (!analysis.categories.has(item.categoryName)) {
      analysis.categories.set(item.categoryName, {
        total: 0,
        totalValue: 0,
        avgStock: 0,
        items: [],
      });
    }

    const category = analysis.categories.get(item.categoryName)!;
    category.total++;
    category.totalValue += item.value;
    category.items.push(item);
  });

  // Calculate averages
  analysis.categories.forEach((category) => {
    category.avgStock = category.items.reduce((sum: number, item: RawStockData) =>
      sum + (item.currentStock / item.maxStock), 0) / category.total;
  });

  return {
    distribution: [
      { status: 'Normal', count: analysis.normal, percentage: (analysis.normal / analysis.total) * 100 },
      { status: 'Baixo', count: analysis.low, percentage: (analysis.low / analysis.total) * 100 },
      { status: 'Crítico', count: analysis.critical, percentage: (analysis.critical / analysis.total) * 100 },
      { status: 'Excesso', count: analysis.overstock, percentage: (analysis.overstock / analysis.total) * 100 },
    ],
    categories: Array.from(analysis.categories.entries()).map(([name, data]) => ({
      name,
      ...data,
      items: undefined, // Remove items to reduce payload
    })),
  };
};

// User performance analysis
export const transformToUserPerformance = (
  data: RawActivityData[],
  dateRange: { from: Date; to: Date }
): Array<{
  userId: string;
  userName: string;
  sectorName: string;
  activityCount: number;
  dailyAverage: number;
  efficiency: number;
  activityTypes: Record<string, number>;
}> => {
  const users = new Map<string, any>();
  const totalDays = Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24));

  data.forEach(activity => {
    if (!users.has(activity.userId)) {
      users.set(activity.userId, {
        userId: activity.userId,
        userName: activity.userName,
        sectorName: activity.sectorName,
        activityCount: 0,
        activityTypes: {},
        totalQuantity: 0,
      });
    }

    const user = users.get(activity.userId)!;
    user.activityCount++;
    user.totalQuantity += activity.quantity;

    // Count by type
    if (!user.activityTypes[activity.type]) {
      user.activityTypes[activity.type] = 0;
    }
    user.activityTypes[activity.type]++;
  });

  return Array.from(users.values())
    .map(user => ({
      ...user,
      dailyAverage: user.activityCount / totalDays,
      efficiency: Math.min(100, (user.totalQuantity / user.activityCount) * 10), // Simplified efficiency metric
    }))
    .sort((a, b) => b.activityCount - a.activityCount);
};

// Order fulfillment analysis
export const transformToOrderFulfillment = (data: RawOrderData[]) => {
  const analysis = {
    byStatus: new Map<string, number>(),
    bySupplier: new Map<string, any>(),
    timeline: [] as any[],
    avgFulfillmentTime: 0,
  };

  let totalFulfillmentTime = 0;
  let fulfilledOrders = 0;

  data.forEach(order => {
    // Status distribution
    analysis.byStatus.set(order.status, (analysis.byStatus.get(order.status) || 0) + 1);

    // Supplier analysis
    if (!analysis.bySupplier.has(order.supplierId)) {
      analysis.bySupplier.set(order.supplierId, {
        name: order.supplierName,
        orderCount: 0,
        totalValue: 0,
        avgValue: 0,
        onTimeDeliveries: 0,
        lateDeliveries: 0,
      });
    }

    const supplier = analysis.bySupplier.get(order.supplierId)!;
    supplier.orderCount++;
    supplier.totalValue += order.totalValue;

    // Delivery performance
    if (order.expectedDelivery && order.actualDelivery) {
      const expected = new Date(order.expectedDelivery);
      const actual = new Date(order.actualDelivery);

      if (actual <= expected) {
        supplier.onTimeDeliveries++;
      } else {
        supplier.lateDeliveries++;
      }

      const fulfillmentDays = Math.ceil((actual.getTime() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      totalFulfillmentTime += fulfillmentDays;
      fulfilledOrders++;
    }

    // Timeline data
    analysis.timeline.push({
      date: format(new Date(order.createdAt), 'yyyy-MM-dd'),
      orderId: order.id,
      status: order.status,
      value: order.totalValue,
      supplier: order.supplierName,
    });
  });

  // Calculate averages
  analysis.bySupplier.forEach(supplier => {
    supplier.avgValue = supplier.totalValue / supplier.orderCount;
    supplier.onTimeRate = supplier.onTimeDeliveries / (supplier.onTimeDeliveries + supplier.lateDeliveries) * 100;
  });

  analysis.avgFulfillmentTime = fulfilledOrders > 0 ? totalFulfillmentTime / fulfilledOrders : 0;

  return {
    statusDistribution: Array.from(analysis.byStatus.entries()).map(([status, count]) => ({
      status,
      count,
      percentage: (count / data.length) * 100,
    })),
    supplierPerformance: Array.from(analysis.bySupplier.values()),
    timeline: analysis.timeline.sort((a, b) => a.date.localeCompare(b.date)),
    avgFulfillmentTime: analysis.avgFulfillmentTime,
  };
};

// Trend calculation utilities
export const calculateTrend = (data: number[], periods: number = 7): {
  direction: 'up' | 'down' | 'stable';
  percentage: number;
  confidence: number;
} => {
  if (data.length < periods) {
    return { direction: 'stable', percentage: 0, confidence: 0 };
  }

  const recent = data.slice(-periods);
  const previous = data.slice(-periods * 2, -periods);

  if (previous.length === 0) {
    return { direction: 'stable', percentage: 0, confidence: 0 };
  }

  const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
  const previousAvg = previous.reduce((sum, val) => sum + val, 0) / previous.length;

  const change = ((recentAvg - previousAvg) / previousAvg) * 100;
  const absChange = Math.abs(change);

  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (absChange > 5) { // 5% threshold
    direction = change > 0 ? 'up' : 'down';
  }

  // Calculate confidence based on data consistency
  const recentVariance = calculateStatisticalVariance(recent);
  const previousVariance = calculateStatisticalVariance(previous);
  const avgVariance = (recentVariance + previousVariance) / 2;
  const confidence = Math.max(0, Math.min(100, 100 - (avgVariance / recentAvg * 100)));

  return {
    direction,
    percentage: Math.abs(change),
    confidence,
  };
};

// Statistical helpers
export const calculateStatisticalVariance = (data: number[]): number => {
  const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
  const squaredDiffs = data.map(val => Math.pow(val - mean, 2));
  return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / data.length;
};

export const calculateMovingAverage = (data: number[], window: number): number[] => {
  const result: number[] = [];

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const windowData = data.slice(start, i + 1);
    const average = windowData.reduce((sum, val) => sum + val, 0) / windowData.length;
    result.push(average);
  }

  return result;
};

// Outlier detection
export const detectOutliers = (data: number[], threshold: number = 2): {
  outliers: number[];
  indices: number[];
  cleanData: number[];
} => {
  const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
  const variance = calculateStatisticalVariance(data);
  const stdDev = Math.sqrt(variance);

  const outliers: number[] = [];
  const indices: number[] = [];
  const cleanData: number[] = [];

  data.forEach((value, index) => {
    const zScore = Math.abs((value - mean) / stdDev);

    if (zScore > threshold) {
      outliers.push(value);
      indices.push(index);
    } else {
      cleanData.push(value);
    }
  });

  return { outliers, indices, cleanData };
};

// Seasonal pattern detection
export const detectSeasonalPatterns = (
  data: TimeSeriesData[],
  valueField: string
): {
  hasSeasonality: boolean;
  pattern: 'weekly' | 'monthly' | 'none';
  strength: number;
  peaks: string[];
} => {
  if (data.length < 14) {
    return { hasSeasonality: false, pattern: 'none', strength: 0, peaks: [] };
  }

  // Group by day of week for weekly patterns
  const weeklyData = new Map<number, number[]>();
  const monthlyData = new Map<number, number[]>();

  data.forEach(item => {
    const date = new Date(item.date);
    const dayOfWeek = date.getDay();
    const month = date.getMonth();
    const value = Number(item[valueField]) || 0;

    if (!weeklyData.has(dayOfWeek)) weeklyData.set(dayOfWeek, []);
    if (!monthlyData.has(month)) monthlyData.set(month, []);

    weeklyData.get(dayOfWeek)!.push(value);
    monthlyData.get(month)!.push(value);
  });

  // Calculate weekly pattern strength
  const weeklyAverages = Array.from(weeklyData.entries()).map(([day, values]) => ({
    day,
    average: values.reduce((sum, val) => sum + val, 0) / values.length,
  }));

  const weeklyVariance = calculateStatisticalVariance(weeklyAverages.map(item => item.average));
  const overallAverage = data.reduce((sum, item) => sum + (Number(item[valueField]) || 0), 0) / data.length;
  const weeklyStrength = weeklyVariance / (overallAverage * overallAverage);

  // Calculate monthly pattern strength (if enough data)
  let monthlyStrength = 0;
  if (monthlyData.size >= 6) {
    const monthlyAverages = Array.from(monthlyData.entries()).map(([month, values]) => ({
      month,
      average: values.reduce((sum, val) => sum + val, 0) / values.length,
    }));

    const monthlyVariance = calculateStatisticalVariance(monthlyAverages.map(item => item.average));
    monthlyStrength = monthlyVariance / (overallAverage * overallAverage);
  }

  // Determine strongest pattern
  let pattern: 'weekly' | 'monthly' | 'none' = 'none';
  let strength = 0;

  if (weeklyStrength > 0.1 || monthlyStrength > 0.1) {
    if (weeklyStrength > monthlyStrength) {
      pattern = 'weekly';
      strength = weeklyStrength;
    } else {
      pattern = 'monthly';
      strength = monthlyStrength;
    }
  }

  // Find peaks
  const peaks: string[] = [];
  if (pattern === 'weekly') {
    const topDays = weeklyAverages
      .sort((a, b) => b.average - a.average)
      .slice(0, 2);
    peaks.push(...topDays.map(item => {
      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      return dayNames[item.day];
    }));
  }

  return {
    hasSeasonality: strength > 0.1,
    pattern,
    strength,
    peaks,
  };
};

// Export-specific utilities
export interface ExportTransformConfig {
  title?: string;
  subtitle?: string;
  includeMetadata?: boolean;
  fieldMappings?: Record<string, string>;
  excludeFields?: string[];
  formatters?: Record<string, (value: any) => string>;
  maxRecords?: number;
}

/**
 * Transform statistics data for export
 */
export const transformForExport = (
  data: any[],
  config: ExportTransformConfig = {}
): { data: any[], metadata: Record<string, any> } => {
  const {
    fieldMappings = {},
    excludeFields = [],
    formatters = {},
    maxRecords = 10000,
  } = config;

  let transformedData = [...data];

  // Limit data size for performance
  if (transformedData.length > maxRecords) {
    transformedData = transformedData.slice(0, maxRecords);
  }

  // Transform each record
  const processedData = transformedData.map(record => {
    const transformed: any = {};

    Object.entries(record).forEach(([key, value]) => {
      // Skip excluded fields
      if (excludeFields.includes(key)) return;

      // Apply field mapping
      const exportKey = fieldMappings[key] || key;

      // Apply custom formatter
      if (formatters[key]) {
        transformed[exportKey] = formatters[key](value);
      } else {
        // Apply default formatting based on value type
        transformed[exportKey] = formatValueForExport(value, key);
      }
    });

    return transformed;
  });

  // Generate metadata
  const metadata: Record<string, any> = {
    'Total de Registros': data.length,
    'Registros Exportados': processedData.length,
    'Data de Geração': format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
  };

  if (data.length > maxRecords) {
    metadata['Observação'] = `Dados limitados a ${maxRecords} registros para otimização. Use filtros para dados específicos.`;
  }

  return { data: processedData, metadata };
};

/**
 * Format values for export based on type and field name
 */
const formatValueForExport = (value: any, fieldName: string): any => {
  if (value === null || value === undefined) return '';

  // Date formatting
  if (value instanceof Date) {
    return format(value, 'dd/MM/yyyy HH:mm', { locale: ptBR });
  }

  // String date formatting
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    try {
      const date = new Date(value);
      return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
    } catch {
      return value;
    }
  }

  // Boolean formatting
  if (typeof value === 'boolean') {
    return value ? 'Sim' : 'Não';
  }

  // Number formatting
  if (typeof value === 'number') {
    const fieldLower = fieldName.toLowerCase();

    // Currency fields
    if (fieldLower.includes('valor') || fieldLower.includes('preco') || fieldLower.includes('custo')) {
      return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    // Percentage fields
    if (fieldLower.includes('percentual') || fieldLower.includes('taxa') || fieldLower.includes('percent')) {
      return `${value.toFixed(1)}%`;
    }

    // Trend fields
    if (fieldLower.includes('tendencia') || fieldLower.includes('trend')) {
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    }

    // Regular numbers
    return value.toLocaleString('pt-BR');
  }

  // Return as string
  return String(value);
};

/**
 * Create chart export data from raw statistics
 */
export const createChartExportData = (
  chartTitle: string,
  data: any[],
  config: ExportTransformConfig = {}
): { chartTitle: string; data: any[]; metadata: Record<string, any> } => {
  const { data: transformedData, metadata } = transformForExport(data, config);

  return {
    chartTitle,
    data: transformedData,
    metadata: {
      ...metadata,
      'Título do Gráfico': chartTitle,
      'Tipo de Dados': config.subtitle || 'Dados Estatísticos',
    },
  };
};

/**
 * Transform inventory statistics for comprehensive export
 */
export const transformInventoryStatisticsForExport = (statistics: any) => {
  const exportData: any[] = [];

  if (!statistics) return exportData;

  // Overview metrics
  if (statistics.totalItems !== undefined) {
    exportData.push(
      createChartExportData(
        'Métricas Principais do Estoque',
        [
          { metrica: 'Total de Itens', valor: statistics.totalItems, categoria: 'Inventário' },
          { metrica: 'Valor Total', valor: statistics.totalValue, categoria: 'Financeiro' },
          { metrica: 'Itens em Baixo Estoque', valor: statistics.lowStockItems, categoria: 'Alerta' },
          { metrica: 'Taxa de Giro', valor: statistics.turnoverRate, categoria: 'Performance' },
          { metrica: 'Atividades do Mês', valor: statistics.monthlyActivities, categoria: 'Movimentação' },
          { metrica: 'Usuários Ativos', valor: statistics.activeUsers, categoria: 'Colaboradores' },
        ],
        {
          subtitle: 'Indicadores principais do sistema de estoque',
          formatters: {
            valor: (value) => formatValueForExport(value, 'valor'),
          },
        }
      )
    );
  }

  // Recent activity
  if (statistics.recentActivity) {
    exportData.push(
      createChartExportData(
        'Atividade Recente (24h)',
        [
          { atividade: 'Produtos Adicionados', quantidade: statistics.recentActivity.productsAdded },
          { atividade: 'Movimentações', quantidade: statistics.recentActivity.movements },
          { atividade: 'Pedidos Criados', quantidade: statistics.recentActivity.ordersCreated },
          { atividade: 'Atualizações de Preço', quantidade: statistics.recentActivity.priceUpdates },
        ],
        {
          subtitle: 'Resumo das principais atividades nas últimas 24 horas',
        }
      )
    );
  }

  return exportData;
};

/**
 * Create summary statistics for export
 */
export const createExportSummary = (
  data: any[],
  numericalFields: string[] = []
): Record<string, any> => {
  const summary: Record<string, any> = {
    'Total de Registros': data.length,
    'Campos Disponíveis': data.length > 0 ? Object.keys(data[0]).length : 0,
    'Data de Análise': format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR }),
  };

  // Calculate statistics for numerical fields
  numericalFields.forEach(field => {
    const values = data
      .map(item => item[field])
      .filter(value => typeof value === 'number' && !isNaN(value));

    if (values.length > 0) {
      const total = values.reduce((sum, value) => sum + value, 0);
      const avg = total / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);

      summary[`${field}_total`] = total.toLocaleString('pt-BR');
      summary[`${field}_media`] = avg.toLocaleString('pt-BR');
      summary[`${field}_minimo`] = min.toLocaleString('pt-BR');
      summary[`${field}_maximo`] = max.toLocaleString('pt-BR');
    }
  });

  return summary;
};