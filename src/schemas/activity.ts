// packages/schemas/src/activity.ts

import { z } from "zod";
import { createMapToFormDataHelper, orderByDirectionSchema, normalizeOrderBy, quantitySchema, toFormData } from "./common";
import type { Activity } from '@types';
import { ACTIVITY_OPERATION, ACTIVITY_REASON } from '@constants';

// =====================
// Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const activityIncludeSchema = z
  .object({
    // Direct Activity relations
    item: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              prices: z
                .union([
                  z.boolean(),
                  z.object({
                    orderBy: z.any().optional(),
                    take: z.coerce.number().optional(),
                    skip: z.coerce.number().optional(),
                    where: z.any().optional(),
                  }),
                ])
                .optional(),
              supplier: z.boolean().optional(),
              category: z.boolean().optional(),
              brand: z.boolean().optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              formulaComponents: z.boolean().optional(),
              orderItems: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        order: z.boolean().optional(),
                      })
                      .optional(),
                    where: z.any().optional(),
                  }),
                ])
                .optional(),
              ppeDeliveries: z.boolean().optional(),
              orderRules: z.boolean().optional(),
              externalWithdrawalItems: z.boolean().optional(),
              relatedItems: z.boolean().optional(),
              relatedTo: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
              activities: z.boolean().optional(),
              borrows: z.boolean().optional(),
              notifications: z.boolean().optional(),
              tasks: z.boolean().optional(),
              vacations: z.boolean().optional(),
              commissions: z.boolean().optional(),
              warningsCollaborator: z.boolean().optional(),
              warningsSupervisor: z.boolean().optional(),
              warningsWitness: z.boolean().optional(),
              ppeDeliveries: z.boolean().optional(),
              ppeDeliveredBy: z.boolean().optional(),
              ppeSchedules: z.boolean().optional(),
              changeLogs: z.boolean().optional(),
              seenNotification: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    order: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              budget: z.boolean().optional(),
              nfe: z.boolean().optional(),
              receipt: z.boolean().optional(),
              supplier: z.boolean().optional(),
              orderSchedule: z.boolean().optional(),
              epiSchedule: z.boolean().optional(),
              items: z.boolean().optional(),
              activities: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    orderItem: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              item: z.boolean().optional(),
              order: z.boolean().optional(),
              activities: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .partial();

// =====================
// OrderBy Schema Based on Prisma Schema Fields
// =====================

export const activityOrderBySchema = z.union([
  // Single ordering object
  z
    .object({
      // Activity direct fields
      id: orderByDirectionSchema.optional(),
      quantity: orderByDirectionSchema.optional(),
      operation: orderByDirectionSchema.optional(),
      userId: orderByDirectionSchema.optional(),
      itemId: orderByDirectionSchema.optional(),
      orderId: orderByDirectionSchema.optional(),
      orderItemId: orderByDirectionSchema.optional(),
      reason: orderByDirectionSchema.optional(),
      reasonOrder: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),

      // Nested relation ordering - Item
      item: z
        .object({
          id: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          uniCode: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .optional(),

      // Nested relation ordering - User
      user: z
        .object({
          id: orderByDirectionSchema.optional(),
          email: orderByDirectionSchema.optional(),
          name: orderByDirectionSchema.optional(),
          status: orderByDirectionSchema.optional(),
          phone: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .optional(),
    })
    .partial(),

  // Array of ordering objects for multiple field ordering
  z.array(
    z
      .object({
        id: orderByDirectionSchema.optional(),
        quantity: orderByDirectionSchema.optional(),
        operation: orderByDirectionSchema.optional(),
        userId: orderByDirectionSchema.optional(),
        itemId: orderByDirectionSchema.optional(),
        orderId: orderByDirectionSchema.optional(),
        orderItemId: orderByDirectionSchema.optional(),
        reason: orderByDirectionSchema.optional(),
        reasonOrder: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
  ),
]);

// =====================
// Where Schema Based on Prisma Schema Fields
// =====================

export const activityWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Logical operators
      AND: z.union([activityWhereSchema, z.array(activityWhereSchema)]).optional(),
      OR: z.array(activityWhereSchema).optional(),
      NOT: z.union([activityWhereSchema, z.array(activityWhereSchema)]).optional(),

      // Activity fields
      id: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      itemId: z
        .union([
          z.string(),
          z.object({
            equals: z.string().optional(),
            not: z.string().optional(),
            in: z.array(z.string()).optional(),
            notIn: z.array(z.string()).optional(),
          }),
        ])
        .optional(),

      userId: z
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

      orderId: z
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

      orderItemId: z
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

      quantity: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            not: z.number().optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
          }),
        ])
        .optional(),

      operation: z
        .union([
          z.nativeEnum(ACTIVITY_OPERATION),
          z.object({
            equals: z.nativeEnum(ACTIVITY_OPERATION).optional(),
            not: z.nativeEnum(ACTIVITY_OPERATION).optional(),
            in: z.array(z.nativeEnum(ACTIVITY_OPERATION)).optional(),
            notIn: z.array(z.nativeEnum(ACTIVITY_OPERATION)).optional(),
          }),
        ])
        .optional(),

      reason: z
        .union([
          z.nativeEnum(ACTIVITY_REASON),
          z.null(),
          z.object({
            equals: z.union([z.nativeEnum(ACTIVITY_REASON), z.null()]).optional(),
            not: z.union([z.nativeEnum(ACTIVITY_REASON), z.null()]).optional(),
            in: z.array(z.nativeEnum(ACTIVITY_REASON)).optional(),
            notIn: z.array(z.nativeEnum(ACTIVITY_REASON)).optional(),
          }),
        ])
        .optional(),

      reasonOrder: z
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

      createdAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      updatedAt: z
        .union([
          z.date(),
          z.object({
            equals: z.date().optional(),
            not: z.date().optional(),
            gte: z.coerce.date().optional(),
            gt: z.coerce.date().optional(),
            lte: z.coerce.date().optional(),
            lt: z.coerce.date().optional(),
          }),
        ])
        .optional(),

      // Relation filters
      item: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      user: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      order: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),

      orderItem: z
        .object({
          is: z.any().optional(),
          isNot: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const activityFilters = {
  searchingFor: z.string().optional(),
  hasUser: z.boolean().optional(),
  hasDiscrepancies: z.boolean().optional(),
  operations: z.array(z.nativeEnum(ACTIVITY_OPERATION)).optional(),
  itemIds: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  reasons: z.array(z.nativeEnum(ACTIVITY_REASON)).optional(),
  // Item-related filters
  brandIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  supplierIds: z.array(z.string()).optional(),
  quantityRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
};

// =====================
// Transform Function
// =====================

const activityTransform = (data: any) => {
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

  // Handle searchingFor - comprehensive search across all related entities
  if (data.searchingFor && typeof data.searchingFor === "string" && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();

    andConditions.push({
      OR: [
        // User name search
        { user: { name: { contains: searchTerm, mode: "insensitive" } } },

        // Direct item fields
        { item: { name: { contains: searchTerm, mode: "insensitive" } } },
        { item: { uniCode: { contains: searchTerm, mode: "insensitive" } } },

        // Item brand name (nested relation)
        { item: { brand: { name: { contains: searchTerm, mode: "insensitive" } } } },

        // Item category name (nested relation)
        { item: { category: { name: { contains: searchTerm, mode: "insensitive" } } } },

        // Item supplier fields (nested relation)
        { item: { supplier: { fantasyName: { contains: searchTerm, mode: "insensitive" } } } },
        { item: { supplier: { corporateName: { contains: searchTerm, mode: "insensitive" } } } },
      ],
    });
    delete data.searchingFor;
  }

  // Handle hasUser filter
  if (typeof data.hasUser === "boolean") {
    if (data.hasUser) {
      andConditions.push({ userId: { not: null } });
    } else {
      andConditions.push({ userId: null });
    }
    delete data.hasUser;
  }

  // Handle hasDiscrepancies filter
  // Activities with discrepancies are those where quantity is 0 or negative for OUTBOUND operations
  if (data.hasDiscrepancies === true) {
    andConditions.push({
      OR: [
        { quantity: { lte: 0 } },
        {
          AND: [{ operation: ACTIVITY_OPERATION.OUTBOUND }, { quantity: { lte: 0 } }],
        },
      ],
    });
    delete data.hasDiscrepancies;
  } else if (data.hasDiscrepancies === false) {
    andConditions.push({
      quantity: { gt: 0 },
    });
    delete data.hasDiscrepancies;
  }

  // Handle operations filter
  if (data.operations && Array.isArray(data.operations) && data.operations.length > 0) {
    andConditions.push({ operation: { in: data.operations } });
    delete data.operations;
  }

  // Handle itemIds filter
  if (data.itemIds && Array.isArray(data.itemIds) && data.itemIds.length > 0) {
    andConditions.push({ itemId: { in: data.itemIds } });
    delete data.itemIds;
  }

  // Handle userIds filter
  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  // Handle reasons filter
  if (data.reasons && Array.isArray(data.reasons) && data.reasons.length > 0) {
    andConditions.push({ reason: { in: data.reasons } });
    delete data.reasons;
  }

  // Handle brandIds filter - filter activities by item brand
  if (data.brandIds && Array.isArray(data.brandIds) && data.brandIds.length > 0) {
    andConditions.push({ item: { brandId: { in: data.brandIds } } });
    delete data.brandIds;
  }

  // Handle categoryIds filter - filter activities by item category
  if (data.categoryIds && Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
    andConditions.push({ item: { categoryId: { in: data.categoryIds } } });
    delete data.categoryIds;
  }

  // Handle supplierIds filter - filter activities by item supplier
  if (data.supplierIds && Array.isArray(data.supplierIds) && data.supplierIds.length > 0) {
    andConditions.push({ item: { supplierId: { in: data.supplierIds } } });
    delete data.supplierIds;
  }

  // Handle quantityRange filter
  if (data.quantityRange && typeof data.quantityRange === "object") {
    const condition: any = {};
    if (typeof data.quantityRange.min === "number") condition.gte = data.quantityRange.min;
    if (typeof data.quantityRange.max === "number") condition.lte = data.quantityRange.max;
    if (Object.keys(condition).length > 0) {
      andConditions.push({ quantity: condition });
    }
    delete data.quantityRange;
  }

  // Handle date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  // Merge with existing where conditions
  if (andConditions.length > 0) {
    if (data.where) {
      if (data.where.AND && Array.isArray(data.where.AND)) {
        data.where.AND = [...data.where.AND, ...andConditions];
      } else {
        data.where = { AND: [data.where, ...andConditions] };
      }
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schema
// =====================

export const activityGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: activityWhereSchema.optional(),
    orderBy: activityOrderBySchema.optional(),
    include: activityIncludeSchema.optional(),

    // Convenience filters
    ...activityFilters,

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
  })
  .transform(activityTransform);

// =====================
// CRUD Schemas
// =====================

export const activityCreateSchema = z
  .object({
    quantity: quantitySchema,
    operation: z.union([z.literal(ACTIVITY_OPERATION.INBOUND), z.literal(ACTIVITY_OPERATION.OUTBOUND)], {
      errorMap: () => ({ message: "operação inválida" }),
    }),
    userId: z.string().uuid({ message: "Usuário inválido" }).nullable().optional(),
    itemId: z.string().uuid({ message: "Item inválido" }),
    orderId: z.string().uuid({ message: "Pedido inválido" }).nullable().optional(),
    orderItemId: z.string().uuid({ message: "Item do pedido inválido" }).nullable().optional(),
    reason: z
      .enum(Object.values(ACTIVITY_REASON) as [string, ...string[]], {
        errorMap: () => ({ message: "motivo inválido" }),
      })
      .nullable()
      .optional(),
  })
  .transform(toFormData);

export const activityUpdateSchema = z
  .object({
    quantity: quantitySchema.optional(),
    operation: z
      .union([z.literal(ACTIVITY_OPERATION.INBOUND), z.literal(ACTIVITY_OPERATION.OUTBOUND)], {
        errorMap: () => ({ message: "operação inválida" }),
      })
      .optional(),
    userId: z.string().uuid({ message: "Usuário inválido" }).nullable().optional(),
    itemId: z.string().uuid({ message: "Item inválido" }).optional(),
    reason: z
      .enum(Object.values(ACTIVITY_REASON) as [string, ...string[]], {
        errorMap: () => ({ message: "motivo inválido" }),
      })
      .nullable()
      .optional(),
    reasonOrder: z.number().optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const activityBatchCreateSchema = z.object({
  activities: z.array(activityCreateSchema),
});

export const activityBatchUpdateSchema = z.object({
  activities: z
    .array(
      z.object({
        id: z.string().uuid({ message: "Atividade inválida" }),
        data: activityUpdateSchema,
      }),
    )
    .min(1, "Pelo menos uma atividade é necessária"),
});

export const activityBatchDeleteSchema = z.object({
  activityIds: z.array(z.string().uuid({ message: "Atividade inválida" })).min(1, "Pelo menos um ID deve ser fornecido"),
});

// Query schema for include parameter
export const activityQuerySchema = z.object({
  include: activityIncludeSchema.optional(),
});

// Batch query schema
export const activityBatchQuerySchema = z.object({
  include: activityIncludeSchema.optional(),
});

// =====================
// GetById Schema
// =====================

export const activityGetByIdSchema = z.object({
  include: activityIncludeSchema.optional(),
});

// =====================
// Type Inference (FormData types)
// =====================

export type ActivityGetManyFormData = z.infer<typeof activityGetManySchema>;
export type ActivityGetByIdFormData = z.infer<typeof activityGetByIdSchema>;
export type ActivityQueryFormData = z.infer<typeof activityQuerySchema>;

export type ActivityCreateFormData = z.infer<typeof activityCreateSchema>;
export type ActivityUpdateFormData = z.infer<typeof activityUpdateSchema>;

export type ActivityBatchCreateFormData = z.infer<typeof activityBatchCreateSchema>;
export type ActivityBatchUpdateFormData = z.infer<typeof activityBatchUpdateSchema>;
export type ActivityBatchDeleteFormData = z.infer<typeof activityBatchDeleteSchema>;
export type ActivityBatchQueryFormData = z.infer<typeof activityBatchQuerySchema>;

export type ActivityInclude = z.infer<typeof activityIncludeSchema>;
export type ActivityOrderBy = z.infer<typeof activityOrderBySchema>;
export type ActivityWhere = z.infer<typeof activityWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapActivityToFormData = createMapToFormDataHelper<Activity, ActivityUpdateFormData>((activity) => ({
  quantity: activity.quantity,
  operation: activity.operation,
  itemId: activity.itemId,
  reason: activity.reason,
}));
