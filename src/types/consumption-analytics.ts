// packages/types/src/consumption-analytics.ts

import type { BaseResponse } from './common';
import type { ACTIVITY_OPERATION } from '@constants';

// =====================
// Consumption Analytics Types
// =====================

/**
 * Comparison mode for consumption analysis
 * - items: Simple view showing items only
 * - sectors: Sector vs sector comparison
 * - users: User vs user comparison
 * - periods: Period vs period comparison (e.g., month-over-month)
 */
export type ConsumptionComparisonMode = 'items' | 'sectors' | 'users' | 'periods';

/**
 * Period definition for period comparison mode
 */
export interface ConsumptionPeriod {
  id: string; // e.g., "2024-01"
  label: string; // e.g., "Janeiro 2024"
  startDate: Date;
  endDate: Date;
}

/**
 * Entity comparison data (for sector or user comparisons)
 */
export interface ConsumptionEntityComparison {
  entityId: string; // sectorId or userId
  entityName: string; // sector name or user name
  quantity: number; // Consumed quantity by this entity
  value: number; // Monetary value consumed
  percentage: number; // Percentage of total consumption
  movementCount: number; // Number of activities
}

/**
 * Consumption item (simple mode - no comparison)
 */
export interface ConsumptionItemSimple {
  itemId: string;
  itemName: string;
  itemUniCode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;

  // Aggregated data
  totalQuantity: number; // Total units consumed
  totalValue: number; // Total monetary value
  movementCount: number; // Number of activities

  // Additional info
  currentStock: number;
  averagePrice: number;
}

/**
 * Consumption item (comparison mode)
 */
export interface ConsumptionItemComparison extends Omit<
  ConsumptionItemSimple,
  'totalQuantity' | 'totalValue' | 'movementCount'
> {
  // Total across all entities
  totalQuantity: number;
  totalValue: number;

  // Comparison data by entity
  comparisons: ConsumptionEntityComparison[];

  // Additional info
  currentStock: number;
  averagePrice: number;
}

/**
 * Union type for consumption items
 */
export type ConsumptionItem = ConsumptionItemSimple | ConsumptionItemComparison;

/**
 * Summary statistics for consumption analysis
 */
export interface ConsumptionSummary {
  totalQuantity: number; // Total quantity consumed across all items
  totalValue: number; // Total monetary value consumed
  itemCount: number; // Number of distinct items
  entityCount?: number; // Number of sectors/users in comparison (only in comparison mode)
  averageConsumptionPerItem: number; // Average consumption per item
  averageValuePerItem: number; // Average value per item
}

/**
 * Pagination metadata for consumption analytics
 */
export interface ConsumptionPagination {
  hasMore: boolean; // Whether there are more items to load
  offset: number; // Current offset
  limit: number; // Items per page
  total: number; // Total number of items available
}

/**
 * Consumption analytics data (response body)
 */
export interface ConsumptionAnalyticsData {
  mode: ConsumptionComparisonMode;
  items: ConsumptionItem[];
  summary: ConsumptionSummary;
  pagination: ConsumptionPagination;
}

/**
 * Consumption analytics response
 */
export interface ConsumptionAnalyticsResponse extends BaseResponse<ConsumptionAnalyticsData> {}

/**
 * Time series data point for area charts
 */
export interface ConsumptionTimeSeriesPoint {
  date: string; // ISO date string
  label: string; // Formatted date label (e.g., "Jan 15")
  [entityId: string]: number | string; // Dynamic keys for entity IDs with quantities
}

/**
 * Time series response for consumption over time
 */
export interface ConsumptionTimeSeriesData {
  mode: ConsumptionComparisonMode;
  dataPoints: ConsumptionTimeSeriesPoint[];
  entities: {
    id: string;
    name: string;
    totalQuantity: number;
  }[];
}

export interface ConsumptionTimeSeriesResponse extends BaseResponse<ConsumptionTimeSeriesData> {}
