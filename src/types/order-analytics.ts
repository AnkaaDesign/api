// api/src/types/order-analytics.ts

import type { BaseResponse } from './common';
import type { ORDER_STATUS } from '@constants';

// =====================
// Order Analytics Types
// =====================

/**
 * Order count by status
 */
export interface OrderStatusCount {
  status: ORDER_STATUS;
  statusLabel: string;
  count: number;
  totalValue: number;
  percentage: number;
}

/**
 * Order summary statistics
 */
export interface OrderSummary {
  totalOrders: number;
  totalValue: number;
  totalItems: number;
  averageOrderValue: number;
  averageFulfillmentRate: number;
  overdueCount: number;
  completedCount: number;
  activeCount: number;
}

/**
 * Top supplier by orders
 */
export interface TopSupplier {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalValue: number;
  averageOrderValue: number;
  percentage: number;
}

/**
 * Top ordered item
 */
export interface TopOrderedItem {
  itemId: string;
  itemName: string;
  itemUniCode: string | null;
  categoryName: string | null;
  brandName: string | null;
  totalOrdered: number;
  totalReceived: number;
  fulfillmentRate: number;
  totalValue: number;
  orderCount: number;
}

/**
 * Order trend data point
 */
export interface OrderTrendPoint {
  date: string;
  label: string;
  orderCount: number;
  totalValue: number;
  itemCount: number;
}

/**
 * Order analytics data
 */
export interface OrderAnalyticsData {
  summary: OrderSummary;
  statusBreakdown: OrderStatusCount[];
  topSuppliers: TopSupplier[];
  topItems: TopOrderedItem[];
  trends: OrderTrendPoint[];
}

/**
 * Order analytics response
 */
export interface OrderAnalyticsResponse extends BaseResponse {
  data: OrderAnalyticsData;
}
