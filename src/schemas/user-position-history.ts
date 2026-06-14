// src/schemas/user-position-history.ts
// Histórico de cargos (Departamento Pessoal)

import { z } from 'zod';
import {
  paginationSchema,
  orderByDirectionSchema,
  normalizeOrderBy,
  createUuidWhereSchema,
  createStringWhereSchema,
  createDateWhereSchema,
  createDescriptionSchema,
  mergeAndConditions,
} from './common';
import { POSITION_CHANGE_REASON } from '@constants';

// =====================
// UserPositionHistory Include Schema (Second Level Only)
// =====================

const userIncludeUnion = z
  .union([
    z.boolean(),
    z.object({
      include: z
        .object({
          position: z.boolean().optional(),
          sector: z.boolean().optional(),
        })
        .optional(),
    }),
  ])
  .optional();

const positionIncludeUnion = z
  .union([
    z.boolean(),
    z.object({
      include: z
        .object({
          sector: z.boolean().optional(),
          remunerations: z.boolean().optional(),
        })
        .optional(),
    }),
  ])
  .optional();

export const userPositionHistoryIncludeSchema = z
  .object({
    user: userIncludeUnion,
    position: positionIncludeUnion,
    previousPosition: positionIncludeUnion,
    changedBy: userIncludeUnion,
  })
  .partial();

// =====================
// UserPositionHistory Order By Schema
// =====================

const userPositionHistoryOrderByFields = z.object({
  id: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  positionId: orderByDirectionSchema.optional(),
  previousPositionId: orderByDirectionSchema.optional(),
  reason: orderByDirectionSchema.optional(),
  startedAt: orderByDirectionSchema.optional(),
  endedAt: orderByDirectionSchema.optional(),
  note: orderByDirectionSchema.optional(),
  changedById: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
});

export const userPositionHistoryOrderBySchema = z
  .union([userPositionHistoryOrderByFields, z.array(userPositionHistoryOrderByFields)])
  .optional();

// =====================
// UserPositionHistory Where Schema
// =====================

export const userPositionHistoryWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(userPositionHistoryWhereSchema).optional(),
      OR: z.array(userPositionHistoryWhereSchema).optional(),
      NOT: userPositionHistoryWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      positionId: z.union([createUuidWhereSchema(), z.null()]).optional(),
      previousPositionId: z.union([createUuidWhereSchema(), z.null()]).optional(),
      changedById: z.union([createUuidWhereSchema(), z.null()]).optional(),

      reason: createStringWhereSchema().optional(),
      note: z.union([createStringWhereSchema(), z.null()]).optional(),

      startedAt: createDateWhereSchema().optional(),
      endedAt: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),

      user: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
      position: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
      previousPosition: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
      changedBy: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Filters and Transform
// =====================

const userPositionHistoryFilters = {
  searchingFor: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  positionIds: z.array(z.string()).optional(),
  reasons: z
    .array(
      z.enum(Object.values(POSITION_CHANGE_REASON) as [string, ...string[]], {
        errorMap: () => ({ message: 'motivo inválido' }),
      }),
    )
    .optional(),
  isCurrent: z.boolean().optional(),
  // Período (data de início da vigência do cargo)
  startedAtRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
};

const userPositionHistoryTransform = (data: any) => {
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { note: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        {
          user: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        },
        {
          position: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        },
        {
          previousPosition: {
            name: { contains: data.searchingFor.trim(), mode: 'insensitive' },
          },
        },
      ],
    });
    delete data.searchingFor;
  }

  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.positionIds && Array.isArray(data.positionIds) && data.positionIds.length > 0) {
    andConditions.push({ positionId: { in: data.positionIds } });
    delete data.positionIds;
  }

  if (data.reasons && Array.isArray(data.reasons) && data.reasons.length > 0) {
    andConditions.push({ reason: { in: data.reasons } });
    delete data.reasons;
  }

  // isCurrent => open row (endedAt is null)
  if (data.isCurrent !== undefined) {
    andConditions.push(data.isCurrent ? { endedAt: null } : { endedAt: { not: null } });
    delete data.isCurrent;
  }

  // startedAtRange => período da data de início
  if (data.startedAtRange && (data.startedAtRange.gte || data.startedAtRange.lte)) {
    andConditions.push({
      startedAt: {
        ...(data.startedAtRange.gte && { gte: data.startedAtRange.gte }),
        ...(data.startedAtRange.lte && { lte: data.startedAtRange.lte }),
      },
    });
  }
  delete data.startedAtRange;

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const userPositionHistoryGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: userPositionHistoryWhereSchema.optional(),
    orderBy: userPositionHistoryOrderBySchema.optional(),
    include: userPositionHistoryIncludeSchema.optional(),
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
    ...userPositionHistoryFilters,
  })
  .transform(userPositionHistoryTransform);

export const userPositionHistoryGetByIdSchema = z.object({
  include: userPositionHistoryIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Histórico de cargo inválido' }),
});

export const userPositionHistoryQuerySchema = z.object({
  include: userPositionHistoryIncludeSchema.optional(),
});

// =====================
// Promote Schema — POST /user-position-history/promote
// =====================

const toFormData = <T>(data: T) => data;

export const userPositionHistoryPromoteSchema = z
  .object({
    userId: z.string().uuid({ message: 'Colaborador inválido' }),
    toPositionId: z.string().uuid({ message: 'Cargo inválido' }),
    // Motivos lícitos de mudança de cargo (CLT). "Rebaixamento" não é ofertado —
    // é ilegal (CF art.7º VI + CLT art.468). DEMOTION=Reversão (art.468 §único),
    // ADJUSTMENT=Readaptação (art.461 §4º), CORRECTION=Reenquadramento.
    reason: z.enum(
      [
        POSITION_CHANGE_REASON.PROMOTION,
        POSITION_CHANGE_REASON.TRANSFER,
        POSITION_CHANGE_REASON.DEMOTION,
        POSITION_CHANGE_REASON.ADJUSTMENT,
        POSITION_CHANGE_REASON.CORRECTION,
      ] as [string, ...string[]],
      {
        errorMap: () => ({ message: 'motivo inválido' }),
      },
    ),
    note: createDescriptionSchema(0, 1000).nullable().optional(),
  })
  .transform(toFormData);

// =====================
// Inferred Types
// =====================

export type UserPositionHistoryGetManyFormData = z.infer<typeof userPositionHistoryGetManySchema>;
export type UserPositionHistoryGetByIdFormData = z.infer<typeof userPositionHistoryGetByIdSchema>;
export type UserPositionHistoryQueryFormData = z.infer<typeof userPositionHistoryQuerySchema>;
export type UserPositionHistoryPromoteFormData = z.infer<typeof userPositionHistoryPromoteSchema>;

export type UserPositionHistoryInclude = z.infer<typeof userPositionHistoryIncludeSchema>;
export type UserPositionHistoryOrderBy = z.infer<typeof userPositionHistoryOrderBySchema>;
export type UserPositionHistoryWhere = z.infer<typeof userPositionHistoryWhereSchema>;
