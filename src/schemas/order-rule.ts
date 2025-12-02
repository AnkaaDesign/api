// packages/schemas/src/order-rule.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  createStringWhereSchema,
  createDateWhereSchema,
  createBooleanWhereSchema,
  createNumberWhereSchema,
  mergeAndConditions,
  createBatchCreateSchema,
  createBatchUpdateSchema,
  createBatchDeleteSchema,
  createBatchQuerySchema,
  optionalPositiveNumber,
} from './common';
import type { OrderRule } from '@types';

// =====================
// Include Schema
// =====================

export const orderRuleIncludeSchema = z
  .object({
    item: z.boolean().optional(),
    supplier: z.boolean().optional(),
    _count: z
      .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
      .optional(),
  })
  .optional();

// =====================
// OrderBy Schema
// =====================

export const orderRuleOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        itemId: orderByDirectionSchema.optional(),
        supplierId: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        priority: orderByDirectionSchema.optional(),
        triggerType: orderByDirectionSchema.optional(),
        consumptionDays: orderByDirectionSchema.optional(),
        safetyStockDays: orderByDirectionSchema.optional(),
        minOrderQuantity: orderByDirectionSchema.optional(),
        maxOrderQuantity: orderByDirectionSchema.optional(),
        orderMultiple: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          itemId: orderByDirectionSchema.optional(),
          supplierId: orderByDirectionSchema.optional(),
          isActive: orderByDirectionSchema.optional(),
          priority: orderByDirectionSchema.optional(),
          triggerType: orderByDirectionSchema.optional(),
          consumptionDays: orderByDirectionSchema.optional(),
          safetyStockDays: orderByDirectionSchema.optional(),
          minOrderQuantity: orderByDirectionSchema.optional(),
          maxOrderQuantity: orderByDirectionSchema.optional(),
          orderMultiple: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const orderRuleWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([orderRuleWhereSchema, z.array(orderRuleWhereSchema)]).optional(),
      OR: z.array(orderRuleWhereSchema).optional(),
      NOT: z.union([orderRuleWhereSchema, z.array(orderRuleWhereSchema)]).optional(),

      // Fields
      id: createStringWhereSchema().optional(),
      itemId: createStringWhereSchema().optional(),
      supplierId: z
        .union([
          z.string(),
          z.null(),
          z.object({
            equals: z.union([z.string(), z.null()]).optional(),
            not: z.union([z.string(), z.null()]).optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),
      isActive: createBooleanWhereSchema().optional(),
      priority: createNumberWhereSchema().optional(),
      triggerType: createStringWhereSchema().optional(),
      consumptionDays: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      safetyStockDays: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      minOrderQuantity: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      maxOrderQuantity: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      orderMultiple: z
        .union([
          z.number(),
          z.null(),
          z.object({
            equals: z.union([z.number(), z.null()]).optional(),
            not: z.union([z.number(), z.null()]).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),

      // Relations
      item: z.any().optional(),
      supplier: z.any().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const orderRuleFilters = {
  // Boolean filters
  isActive: z.boolean().optional(),
  hasSupplier: z.boolean().optional(),

  // Array filters
  orderRuleIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
  supplierIds: z.array(z.string()).optional(),
  triggerTypes: z.array(z.string()).optional(),

  // Range filters
  priorityRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  consumptionDaysRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
  safetyStockDaysRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),

  // Date filters
  createdAt: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
  updatedAt: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
};

// =====================
// Transform Functions
// =====================

const orderRuleTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  // Boolean filters
  if (typeof data.isActive === 'boolean') {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  if (data.hasSupplier === true) {
    andConditions.push({ supplierId: { not: null } });
    delete data.hasSupplier;
  } else if (data.hasSupplier === false) {
    andConditions.push({ supplierId: null });
    delete data.hasSupplier;
  }

  // Array filters
  if (data.orderRuleIds && Array.isArray(data.orderRuleIds) && data.orderRuleIds.length > 0) {
    andConditions.push({ id: { in: data.orderRuleIds } });
    delete data.orderRuleIds;
  }

  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  if (data.supplierIds && Array.isArray(data.supplierIds) && data.supplierIds.length > 0) {
    andConditions.push({ supplierId: { in: data.supplierIds } });
    delete data.supplierIds;
  }

  if (data.triggerTypes && Array.isArray(data.triggerTypes) && data.triggerTypes.length > 0) {
    andConditions.push({ triggerType: { in: data.triggerTypes } });
    delete data.triggerTypes;
  }

  // Range filters
  if (data.priorityRange && typeof data.priorityRange === 'object') {
    const condition: any = {};
    if (typeof data.priorityRange.min === 'number') condition.gte = data.priorityRange.min;
    if (typeof data.priorityRange.max === 'number') condition.lte = data.priorityRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ priority: condition });
    }
    delete data.priorityRange;
  }

  if (data.consumptionDaysRange && typeof data.consumptionDaysRange === 'object') {
    const condition: any = {};
    if (typeof data.consumptionDaysRange.min === 'number')
      condition.gte = data.consumptionDaysRange.min;
    if (typeof data.consumptionDaysRange.max === 'number')
      condition.lte = data.consumptionDaysRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ consumptionDays: condition });
    }
    delete data.consumptionDaysRange;
  }

  if (data.safetyStockDaysRange && typeof data.safetyStockDaysRange === 'object') {
    const condition: any = {};
    if (typeof data.safetyStockDaysRange.min === 'number')
      condition.gte = data.safetyStockDaysRange.min;
    if (typeof data.safetyStockDaysRange.max === 'number')
      condition.lte = data.safetyStockDaysRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ safetyStockDays: condition });
    }
    delete data.safetyStockDaysRange;
  }

  // Date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const orderRuleGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: orderRuleWhereSchema.optional(),
    orderBy: orderRuleOrderBySchema.optional(),
    include: orderRuleIncludeSchema.optional(),

    // Convenience filters
    ...orderRuleFilters,
  })
  .transform(orderRuleTransform);

export const orderRuleGetByIdSchema = z.object({
  include: orderRuleIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Regra de pedido inválida' }),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const orderRuleCreateSchema = z
  .object({
    itemId: z.string().uuid({ message: 'Item inválido' }),
    supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).nullable().optional(),
    isActive: z.boolean().default(true),
    priority: z.number().int().min(0, 'Prioridade deve ser maior ou igual a 0').default(0),
    triggerType: z.string().min(1, 'Tipo de gatilho é obrigatório'),
    consumptionDays: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Dias de consumo deve ser positivo',
    ),
    safetyStockDays: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Dias de estoque de segurança deve ser positivo',
    ),
    minOrderQuantity: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Quantidade mínima de pedido deve ser positiva',
    ),
    maxOrderQuantity: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Quantidade máxima de pedido deve ser positiva',
    ),
    orderMultiple: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Múltiplo de pedido deve ser positivo',
    ),
  })
  .transform(toFormData);

export const orderRuleUpdateSchema = z
  .object({
    supplierId: z.string().uuid({ message: 'Fornecedor inválido' }).nullable().optional(),
    isActive: z.boolean().optional(),
    priority: z.number().int().min(0, 'Prioridade deve ser maior ou igual a 0').optional(),
    triggerType: z.string().min(1).optional(),
    consumptionDays: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Dias de consumo deve ser positivo',
    ),
    safetyStockDays: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Dias de estoque de segurança deve ser positivo',
    ),
    minOrderQuantity: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Quantidade mínima de pedido deve ser positiva',
    ),
    maxOrderQuantity: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Quantidade máxima de pedido deve ser positiva',
    ),
    orderMultiple: optionalPositiveNumber.refine(
      val => val === null || val === undefined || val > 0,
      'Múltiplo de pedido deve ser positivo',
    ),
  })
  .transform(toFormData);

// =====================
// Batch Operations
// =====================

export const orderRuleBatchCreateSchema = createBatchCreateSchema(
  orderRuleCreateSchema,
  'regra de pedido',
);
export const orderRuleBatchUpdateSchema = createBatchUpdateSchema(
  orderRuleUpdateSchema,
  'regra de pedido',
);
export const orderRuleBatchDeleteSchema = createBatchDeleteSchema('regra de pedido');
export const orderRuleQuerySchema = createBatchQuerySchema(orderRuleIncludeSchema);

// =====================
// Type Inference
// =====================

// Query types
export type OrderRuleGetManyFormData = z.infer<typeof orderRuleGetManySchema>;
export type OrderRuleGetByIdFormData = z.infer<typeof orderRuleGetByIdSchema>;
export type OrderRuleQueryFormData = z.infer<typeof orderRuleQuerySchema>;

// CRUD types
export type OrderRuleCreateFormData = z.infer<typeof orderRuleCreateSchema>;
export type OrderRuleUpdateFormData = z.infer<typeof orderRuleUpdateSchema>;

// Batch types
export type OrderRuleBatchCreateFormData = z.infer<typeof orderRuleBatchCreateSchema>;
export type OrderRuleBatchUpdateFormData = z.infer<typeof orderRuleBatchUpdateSchema>;
export type OrderRuleBatchDeleteFormData = z.infer<typeof orderRuleBatchDeleteSchema>;

// Include/OrderBy/Where types
export type OrderRuleInclude = z.infer<typeof orderRuleIncludeSchema>;
export type OrderRuleOrderBy = z.infer<typeof orderRuleOrderBySchema>;
export type OrderRuleWhere = z.infer<typeof orderRuleWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapOrderRuleToFormData = createMapToFormDataHelper<OrderRule, OrderRuleUpdateFormData>(
  orderRule => ({
    supplierId: orderRule.supplierId,
    isActive: orderRule.isActive,
    priority: orderRule.priority,
    triggerType: orderRule.triggerType,
    consumptionDays: orderRule.consumptionDays,
    safetyStockDays: orderRule.safetyStockDays,
    minOrderQuantity: orderRule.minOrderQuantity,
    maxOrderQuantity: orderRule.maxOrderQuantity,
    orderMultiple: orderRule.orderMultiple,
  }),
);
