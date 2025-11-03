import { Prisma } from '@prisma/client';

// Base type for entities with optional includes
export type DatabaseEntityWithIncludes<T> = T & {
  _count?: Record<string, number>;
  [key: string]: any;
};

// Customer database entity with includes
export type CustomerDatabaseEntity = DatabaseEntityWithIncludes<
  Prisma.CustomerGetPayload<{
    include: {
      phones?: boolean;
      tags?: boolean;
      tasks?: boolean;
      serviceOrders?: boolean;
      [key: string]: any;
    };
  }>
>;

// User database entity with includes
export type UserDatabaseEntity = DatabaseEntityWithIncludes<
  Prisma.UserGetPayload<{
    include: {
      position?: boolean;
      sector?: boolean;
      tasks?: boolean;
      [key: string]: any;
    };
  }>
>;

// Item database entity with includes
export type ItemDatabaseEntity = DatabaseEntityWithIncludes<
  Prisma.ItemGetPayload<{
    include: {
      category?: boolean;
      brand?: boolean;
      supplier?: boolean;
      measures?: boolean;
      prices?: boolean;
      [key: string]: any;
    };
  }>
>;

// Order database entity with includes
export type OrderDatabaseEntity = DatabaseEntityWithIncludes<
  Prisma.OrderGetPayload<{
    include: {
      supplier?: boolean;
      items?: boolean;
      user?: boolean;
      [key: string]: any;
    };
  }>
>;

// Task database entity with includes
export type TaskDatabaseEntity = DatabaseEntityWithIncludes<
  Prisma.TaskGetPayload<{
    include: {
      customer?: boolean;
      user?: boolean;
      services?: boolean;
      sector?: boolean;
      [key: string]: any;
    };
  }>
>;

// Generic type for Prisma include objects
export type PrismaIncludeType = Record<
  string,
  boolean | { include?: any; where?: any; orderBy?: any }
>;

// Generic type for database query options
export interface DatabaseQueryOptions {
  include?: PrismaIncludeType;
  where?: Record<string, any>;
  orderBy?: Record<string, any>;
  skip?: number;
  take?: number;
  limit?: number; // For compatibility with existing code
}

// Type for processed entities (after handling array properties)
export interface ProcessedEntity {
  [key: string]: any;
  _count?: Record<string, number>;
}

// Type for array properties mapping
export type ArrayPropertiesMapping = string[];

// Query result type with pagination
export interface QueryResult<T> {
  data: T[];
  meta?: {
    totalRecords: number;
    page: number;
    hasNextPage: boolean;
  };
}

// Batch operation result type
export interface BatchOperationResult<T> {
  totalSuccess: number;
  totalFailed: number;
  successData: T[];
  failures: Array<{
    data: any;
    error: string;
  }>;
}

// Type for entity creation/update data with array properties
export interface EntityDataWithArrays {
  [key: string]: any;
  phones?: string[];
  tags?: string[];
  items?: any[];
  measures?: MeasureData[];
}

// Type for measure data
export interface MeasureData {
  value?: number | null;
  unit?: string | null;
  measureType: string;
}

// Type for item data with measures
// Note: Size information is stored in measures with MeasureType.SIZE, not as a separate field
export interface ItemDataWithMeasures extends EntityDataWithArrays {
  measures?: MeasureData[];
  ppeType?: string;
  ppeDeliveryMode?: string;
}

// Type for stock level parameters
export interface StockLevelQuery {
  stockLevels?: string[];
  criticalStock?: boolean;
  lowStock?: boolean;
  normalStock?: boolean;
  outOfStock?: boolean;
  overStock?: boolean;
  negativeStock?: boolean;
}
