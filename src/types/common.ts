// packages/types/src/common.ts

import { EXPORT_FORMAT } from '@constants';

// =====================
// Base Entity Type (not interface)
// =====================

export type BaseEntity = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

// =====================
// Base Response Types
// =====================

export interface BaseGetUniqueResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface BaseGetManyResponse<T> {
  success: boolean;
  message: string;
  data?: T[];
  meta?: Meta;
  error?: string;
}

export interface BaseCreateResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface BaseUpdateResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface BaseDeleteResponse {
  success: boolean;
  message: string;
  error?: string;
}

export interface BaseMergeResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  conflicts?: MergeConflict[];
  error?: string;
}

export interface MergeConflict {
  field: string;
  sourceValues: any[];
  resolution?: 'use_target' | 'use_source' | 'manual';
  message: string;
}

export interface BaseSummaryResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

// Type aliases for API client compatibility
export type SuccessResponse<T> = BaseGetUniqueResponse<T>;
export type PaginatedResponse<T> = BaseGetManyResponse<T>;
export type DeleteResponse = BaseDeleteResponse; // Added alias for hooks compatibility
export type BatchCreateResponse<T, U = unknown> = BaseBatchResponse<T, U>;
export type BatchUpdateResponse<T, U = unknown> = BaseBatchResponse<T, U>;
export type BatchDeleteResponse = BaseDeleteResponse;

export interface ReportResponse {
  success: boolean;
  message: string;
  data?: BaseReport;
  error?: string;
}

export interface Meta {
  totalRecords: number;
  page: number;
  take: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface BaseReport {
  format: EXPORT_FORMAT;
  url: string;
  filename: string;
  size: number;
  generatedAt: Date;
}

// =====================
// Batch Operations
// =====================

export interface BatchOperationResult<T, U = unknown> {
  success: T[];
  failed: BatchOperationError<U>[];
  totalProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  processingTime?: number;
  partialSuccess?: boolean;
}

export interface BatchOperationError<T = unknown> {
  index: number;
  id?: string;
  error: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  data: T;
  occurredAt?: Date;
}

// Enhanced batch operation types with detailed item information
export interface DetailedBatchOperationResult<T, U = unknown> extends BatchOperationResult<T, U> {
  successDetails: BatchOperationSuccess<T>[];
  failedDetails: BatchOperationError<U>[];
}

export interface BatchOperationSuccess<T = unknown> {
  index: number;
  id?: string;
  data: T;
  itemName?: string;
  userName?: string;
  processingTime?: number;
}

export interface BaseBatchResponse<T, U = unknown> {
  success: boolean;
  message: string;
  data?: BatchOperationResult<T, U>;
  error?: string;
}

// =====================
// Common Operation Types
// =====================

export interface UpdateData<T> {
  id: string;
  data: T;
}

export interface FindManyOptions<OrderBy = any, Where = any, Include = any> {
  skip?: number;
  page?: number;
  take?: number;
  orderBy?: OrderBy;
  where?: Where;
  include?: Include;
}

export interface CreateOptions<Include = any> {
  include?: Include;
}

export interface UpdateOptions<Include = any> {
  include?: Include;
}

export interface CreateManyOptions<Include = any> {
  include?: Include;
}

export interface UpdateManyOptions<Include = any> {
  include?: Include;
}

export interface FindManyResult<T> {
  data: T[];
  meta: Meta;
}

// Repository-level batch operation types
export interface BatchCreateResult<T, U> {
  success: T[];
  failed: BatchError<U>[];
  totalCreated: number;
  totalFailed: number;
}

export interface BatchUpdateResult<T, U> {
  success: T[];
  failed: BatchError<U>[];
  totalUpdated: number;
  totalFailed: number;
}

export interface BatchDeleteResult {
  success: { id: string; deleted: boolean }[];
  failed: BatchError<{ id: string }>[];
  totalDeleted: number;
  totalFailed: number;
}

export interface BatchError<T> {
  index?: number;
  id?: string;
  error: string;
  errorCode?: string;
  data: T;
}

// =====================
// Missing Type Aliases and Types
// =====================

// Bulk operations
export interface BulkStatusChangeParams {
  ids: string[];
  status: string;
  userId?: string;
  include?: any;
}

// =====================
// Change Tracking Types
// =====================

export interface ChangeTracking<T> {
  entity: T;
  changes: Record<string, { oldValue: unknown; newValue: unknown }>;
  changeDescriptions: string[];
  hasChanges: boolean;
  changedFields: string[];
}

// =====================
// Version & Build Information Types
// =====================

export interface BuildInfo {
  version: string;
  gitCommitSha: string;
  gitCommitShort: string;
  gitBranch: string;
  buildTimestamp: string;
  buildNumber?: string;
  environment: string;
  nodeVersion: string;
}

export interface DeploymentInfo {
  deployedBy?: string;
  deployedAt?: string;
  deploymentId?: string;
  deploymentMethod?: 'ci-cd' | 'manual' | 'docker' | 'kubernetes';
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: BuildInfo;
  deployment?: DeploymentInfo;
  system?: SystemInfo;
  services?: ServiceHealthStatus[];
}

export interface SystemInfo {
  platform: string;
  nodeVersion: string;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpuUsage?: {
    user: number;
    system: number;
  };
}

export interface ServiceHealthStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  message?: string;
  lastChecked: string;
}

export interface VersionInfoResponse {
  success: boolean;
  message: string;
  data: BuildInfo & DeploymentInfo;
}

// =====================
// Utility Functions
// =====================

export function createSuccessResponse<T>(data: T, message: string): BaseGetUniqueResponse<T> {
  return {
    success: true,
    message,
    data,
  };
}

export function createPaginatedResponse<T>(data: T[], message: string, meta: Meta): BaseGetManyResponse<T> {
  return {
    success: true,
    message,
    data,
    meta,
  };
}
