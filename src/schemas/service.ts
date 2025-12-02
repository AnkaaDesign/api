// packages/schemas/src/service.ts

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  createDescriptionSchema,
  createStringWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
  createSearchTransform,
} from './common';
import type { Service } from '@types';

// =====================
// Include Schema
// =====================

export const serviceIncludeSchema = z
  .object({
    _count: z
      .union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })])
      .optional(),
  })
  .optional();

// =====================
// OrderBy Schema
// =====================

export const serviceOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          description: orderByDirectionSchema.optional(),
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

export const serviceWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([serviceWhereSchema, z.array(serviceWhereSchema)]).optional(),
      OR: z.array(serviceWhereSchema).optional(),
      NOT: z.union([serviceWhereSchema, z.array(serviceWhereSchema)]).optional(),

      // Fields
      id: createStringWhereSchema().optional(),
      description: createStringWhereSchema().optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const serviceFilters = {
  // Search filter
  searchingFor: z.string().optional(),

  // Array filters
  serviceIds: z.array(z.string()).optional(),
  descriptions: z.array(z.string()).optional(),

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

const serviceTransform = (data: any) => {
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

  // Search filter
  if (data.searchingFor) {
    const searchConditions = createSearchTransform(data.searchingFor, ['description']);
    if (searchConditions) andConditions.push(searchConditions);
    delete data.searchingFor;
  }

  // Array filters
  if (data.serviceIds && Array.isArray(data.serviceIds) && data.serviceIds.length > 0) {
    andConditions.push({ id: { in: data.serviceIds } });
    delete data.serviceIds;
  }

  if (data.descriptions && Array.isArray(data.descriptions) && data.descriptions.length > 0) {
    andConditions.push({ description: { in: data.descriptions } });
    delete data.descriptions;
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

export const serviceGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: serviceWhereSchema.optional(),
    orderBy: serviceOrderBySchema.optional(),
    include: serviceIncludeSchema.optional(),

    // Convenience filters
    ...serviceFilters,
  })
  .transform(serviceTransform);

export const serviceGetByIdSchema = z.object({
  include: serviceIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Serviço inválido' }),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;
export const serviceCreateSchema = z
  .object({
    description: createDescriptionSchema(1, 500),
  })
  .transform(toFormData);
export const serviceUpdateSchema = z
  .object({
    description: createDescriptionSchema(1, 500).optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations
// =====================

export const serviceBatchCreateSchema = z.object({
  services: z
    .array(serviceCreateSchema)
    .min(1, 'Pelo menos uma ordem de serviço deve ser fornecida'),
});

export const serviceBatchUpdateSchema = z.object({
  services: z
    .array(
      z.object({
        id: z.string().uuid('Serviço inválido'),
        data: serviceUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um serviço deve ser fornecida'),
});

export const serviceBatchDeleteSchema = z.object({
  serviceIds: z
    .array(z.string().uuid('Serviço inválido'))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const serviceQuerySchema = z.object({
  include: serviceIncludeSchema.optional(),
});

// =====================
// Type Inference
// =====================

// Query types
export type ServiceGetManyFormData = z.infer<typeof serviceGetManySchema>;
export type ServiceGetByIdFormData = z.infer<typeof serviceGetByIdSchema>;
export type ServiceQueryFormData = z.infer<typeof serviceQuerySchema>;

// CRUD types
export type ServiceCreateFormData = z.infer<typeof serviceCreateSchema>;
export type ServiceUpdateFormData = z.infer<typeof serviceUpdateSchema>;

// Batch types
export type ServiceBatchCreateFormData = z.infer<typeof serviceBatchCreateSchema>;
export type ServiceBatchUpdateFormData = z.infer<typeof serviceBatchUpdateSchema>;
export type ServiceBatchDeleteFormData = z.infer<typeof serviceBatchDeleteSchema>;

// Include/OrderBy/Where types
export type ServiceInclude = z.infer<typeof serviceIncludeSchema>;
export type ServiceOrderBy = z.infer<typeof serviceOrderBySchema>;
export type ServiceWhere = z.infer<typeof serviceWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapServiceToFormData = createMapToFormDataHelper<Service, ServiceUpdateFormData>(
  service => ({
    description: service.description,
  }),
);
