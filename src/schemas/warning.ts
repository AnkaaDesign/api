// packages/schemas/src/warning.ts - CORRECTED VERSION

import { z } from 'zod';
import {
  createMapToFormDataHelper,
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createBooleanWhereSchema,
  createDateWhereSchema,
  createNullFilterTransform,
  mergeAndConditions,
  createDescriptionSchema,
} from './common';
import type { Warning } from '@types';
import { WARNING_CATEGORY, WARNING_SEVERITY } from '@constants';

// =====================
// Warning Include Schema Based on Prisma Schema (Second Level Only)
// =====================

export const warningIncludeSchema = z
  .object({
    // Direct Warning relations
    collaborator: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
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

    supervisor: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
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

    // CORRECTED: Changed from 'witnesses' to 'witness' to match Prisma model
    witness: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
              ppeSize: z.boolean().optional(),
              preference: z.boolean().optional(),
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

    // CORRECTED: Changed from 'files' to 'attachments' to match Prisma model
    attachments: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              author: z.boolean().optional(),
              task: z.boolean().optional(),
              service: z.boolean().optional(),
              paint: z.boolean().optional(),
              customer: z.boolean().optional(),
              warnings: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Warning Order By Schema
// =====================

export const warningOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      severity: orderByDirectionSchema.optional(),
      severityOrder: orderByDirectionSchema.optional(),
      category: orderByDirectionSchema.optional(),
      reason: orderByDirectionSchema.optional(),
      description: orderByDirectionSchema.optional(),
      isActive: orderByDirectionSchema.optional(),
      followUpDate: orderByDirectionSchema.optional(),
      hrNotes: orderByDirectionSchema.optional(),
      resolvedAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
      collaboratorId: orderByDirectionSchema.optional(),
      supervisorId: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        severity: orderByDirectionSchema.optional(),
        severityOrder: orderByDirectionSchema.optional(),
        category: orderByDirectionSchema.optional(),
        reason: orderByDirectionSchema.optional(),
        description: orderByDirectionSchema.optional(),
        isActive: orderByDirectionSchema.optional(),
        followUpDate: orderByDirectionSchema.optional(),
        hrNotes: orderByDirectionSchema.optional(),
        resolvedAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
        collaboratorId: orderByDirectionSchema.optional(),
        supervisorId: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

// =====================
// Warning Where Schema
// =====================

export const warningWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.array(warningWhereSchema).optional(),
      OR: z.array(warningWhereSchema).optional(),
      NOT: warningWhereSchema.optional(),

      // UUID fields
      id: createUuidWhereSchema().optional(),
      collaboratorId: createUuidWhereSchema().optional(),
      supervisorId: z.union([createUuidWhereSchema(), z.null()]).optional(),

      // String fields
      severity: createStringWhereSchema().optional(),
      category: createStringWhereSchema().optional(),
      reason: createStringWhereSchema().optional(),
      description: z.union([createStringWhereSchema(), z.null()]).optional(),
      hrNotes: z.union([createStringWhereSchema(), z.null()]).optional(),

      // Number fields
      severityOrder: z
        .union([
          z.number(),
          z.object({
            equals: z.number().optional(),
            in: z.array(z.number()).optional(),
            notIn: z.array(z.number()).optional(),
            lt: z.number().optional(),
            lte: z.number().optional(),
            gt: z.number().optional(),
            gte: z.number().optional(),
            not: z.number().optional(),
          }),
        ])
        .optional(),

      // Boolean fields
      isActive: createBooleanWhereSchema().optional(),

      // Relations
      collaborator: z
        .object({
          is: z.lazy(() => z.any()).optional(), // UserWhereInput
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      supervisor: z
        .object({
          is: z.lazy(() => z.any()).optional(), // UserWhereInput
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      // CORRECTED: Changed from 'witnesses' to 'witness'
      witness: z
        .object({
          some: z.lazy(() => z.any()).optional(), // UserWhereInput
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      // CORRECTED: Changed from 'files' to 'attachments'
      attachments: z
        .object({
          some: z.lazy(() => z.any()).optional(), // FileWhereInput
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      // Date fields
      followUpDate: createDateWhereSchema().optional(), // CORRECTED: Removed null union since it's required
      resolvedAt: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Warning Filters and Transform
// =====================

const warningFilters = {
  // Simple convenience filters
  searchingFor: z.string().optional(),
  hasFollowUp: z.boolean().optional(),
  hasHrNotes: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isResolved: z.boolean().optional(),
  severities: z
    .array(
      z.enum(Object.values(WARNING_SEVERITY) as [string, ...string[]], {
        errorMap: () => ({ message: 'severidade inválida' }),
      }),
    )
    .optional(),
  categories: z
    .array(
      z.enum(Object.values(WARNING_CATEGORY) as [string, ...string[]], {
        errorMap: () => ({ message: 'categoria inválida' }),
      }),
    )
    .optional(),
  collaboratorIds: z.array(z.string()).optional(),
  supervisorIds: z.array(z.string()).optional(),
  witnessIds: z.array(z.string()).optional(),
};

// Transform for convenience filters
const warningTransform = (data: any) => {
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

  // Handle searchingFor - search in multiple fields
  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { reason: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        { description: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        { hrNotes: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        {
          collaborator: {
            name: { contains: data.searchingFor.trim(), mode: 'insensitive' },
          },
        },
      ],
    });
    delete data.searchingFor;
  }

  // Handle hasFollowUp filter
  const followUpFilter = createNullFilterTransform(data.hasFollowUp, 'followUpDate');
  if (followUpFilter) {
    andConditions.push(followUpFilter);
    delete data.hasFollowUp;
  }

  // Handle hasHrNotes filter
  const hrNotesFilter = createNullFilterTransform(data.hasHrNotes, 'hrNotes');
  if (hrNotesFilter) {
    andConditions.push(hrNotesFilter);
    delete data.hasHrNotes;
  }

  // Handle isActive filter
  if (data.isActive !== undefined) {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  // Handle isResolved filter
  const resolvedFilter = createNullFilterTransform(!data.isResolved, 'resolvedAt');
  if (resolvedFilter && data.isResolved !== undefined) {
    andConditions.push(resolvedFilter);
    delete data.isResolved;
  }

  // Handle severities filter
  if (data.severities && Array.isArray(data.severities) && data.severities.length > 0) {
    andConditions.push({ severity: { in: data.severities } });
    delete data.severities;
  }

  // Handle categories filter
  if (data.categories && Array.isArray(data.categories) && data.categories.length > 0) {
    andConditions.push({ category: { in: data.categories } });
    delete data.categories;
  }

  // Handle collaboratorIds filter
  if (
    data.collaboratorIds &&
    Array.isArray(data.collaboratorIds) &&
    data.collaboratorIds.length > 0
  ) {
    andConditions.push({ collaboratorId: { in: data.collaboratorIds } });
    delete data.collaboratorIds;
  }

  // Handle supervisorIds filter
  if (data.supervisorIds && Array.isArray(data.supervisorIds) && data.supervisorIds.length > 0) {
    andConditions.push({ supervisorId: { in: data.supervisorIds } });
    delete data.supervisorIds;
  }

  // Handle witnessIds filter - CORRECTED: Use 'witness' instead of 'witnesses'
  if (data.witnessIds && Array.isArray(data.witnessIds) && data.witnessIds.length > 0) {
    andConditions.push({
      witness: {
        some: { id: { in: data.witnessIds } },
      },
    });
    delete data.witnessIds;
  }

  // Merge with existing where conditions
  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schema
// =====================

export const warningGetManySchema = z
  .object({
    // Pagination
    ...paginationSchema.shape,

    // Direct Prisma clauses with proper validation
    where: warningWhereSchema.optional(),
    orderBy: warningOrderBySchema.optional(),
    include: warningIncludeSchema.optional(),

    // Date filters (handled by where schema)
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

    // Convenience filters (will be transformed to where)
    ...warningFilters,
  })
  .transform(warningTransform);

// =====================
// Get By ID Schema
// =====================

export const warningGetByIdSchema = z.object({
  include: warningIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Advertência inválida' }),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const warningCreateSchema = z
  .object({
    severity: z.enum(Object.values(WARNING_SEVERITY) as [string, ...string[]], {
      errorMap: () => ({ message: 'severidade inválida' }),
    }),
    category: z.enum(Object.values(WARNING_CATEGORY) as [string, ...string[]], {
      errorMap: () => ({ message: 'categoria inválida' }),
    }),
    reason: createDescriptionSchema(10, 500, true),
    description: createDescriptionSchema(0, 1000).nullable().optional(),
    isActive: z.boolean().default(true),
    collaboratorId: z.string().uuid({ message: 'Colaborador inválido' }),
    supervisorId: z.string().uuid({ message: 'Supervisor inválido' }),
    witnessIds: z.array(z.string().uuid({ message: 'Testemunha inválida' })).optional(),
    attachmentIds: z.array(z.string().uuid({ message: 'Arquivo inválido' })).optional(),
    followUpDate: z.coerce.date(),
    hrNotes: createDescriptionSchema(0, 1000).nullable().optional(),
    resolvedAt: z.coerce.date().nullable().optional(),
  })
  .transform(toFormData);

export const warningUpdateSchema = z
  .object({
    severity: z
      .enum(Object.values(WARNING_SEVERITY) as [string, ...string[]], {
        errorMap: () => ({ message: 'severidade inválida' }),
      })
      .optional(),
    category: z
      .enum(Object.values(WARNING_CATEGORY) as [string, ...string[]], {
        errorMap: () => ({ message: 'categoria inválida' }),
      })
      .optional(),
    reason: createDescriptionSchema(10, 500).optional(),
    description: createDescriptionSchema(0, 1000).nullable().optional(),
    isActive: z.boolean().optional(),
    collaboratorId: z.string().uuid({ message: 'Colaborador inválido' }).optional(),
    supervisorId: z.string().uuid({ message: 'Supervisor inválido' }).optional(),
    witnessIds: z.array(z.string().uuid({ message: 'Testemunha inválida' })).optional(),
    attachmentIds: z.array(z.string().uuid({ message: 'Arquivo inválido' })).optional(),
    // CORRECTED: Keep as optional for updates, but removed nullable since Prisma field is required
    followUpDate: z.coerce.date().optional(),
    hrNotes: createDescriptionSchema(0, 1000).nullable().optional(),
    resolvedAt: z.coerce.date().nullable().optional(),
  })
  .transform(toFormData);

export const warningBatchCreateSchema = z.object({
  warnings: z.array(warningCreateSchema).min(1, 'Pelo menos uma advertência deve ser fornecida'),
});

export const warningBatchUpdateSchema = z.object({
  warnings: z
    .array(
      z.object({
        id: z.string().uuid('Advertência inválida'),
        data: warningUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma advertência deve ser fornecida'),
});

export const warningBatchDeleteSchema = z.object({
  warningIds: z
    .array(z.string().uuid({ message: 'Advertência inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const warningQuerySchema = z.object({
  include: warningIncludeSchema.optional(),
});

// Batch query schema for include parameter
export const warningBatchQuerySchema = z.object({
  include: warningIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type WarningGetManyFormData = z.infer<typeof warningGetManySchema>;
export type WarningGetByIdFormData = z.infer<typeof warningGetByIdSchema>;
export type WarningQueryFormData = z.infer<typeof warningQuerySchema>;
export type WarningBatchQueryFormData = z.infer<typeof warningBatchQuerySchema>;

export type WarningCreateFormData = z.infer<typeof warningCreateSchema>;
export type WarningUpdateFormData = z.infer<typeof warningUpdateSchema>;

export type WarningBatchCreateFormData = z.infer<typeof warningBatchCreateSchema>;
export type WarningBatchUpdateFormData = z.infer<typeof warningBatchUpdateSchema>;
export type WarningBatchDeleteFormData = z.infer<typeof warningBatchDeleteSchema>;

export type WarningInclude = z.infer<typeof warningIncludeSchema>;
export type WarningOrderBy = z.infer<typeof warningOrderBySchema>;
export type WarningWhere = z.infer<typeof warningWhereSchema>;

// =====================
// Mapping to Form Data (for API calls)
// =====================

export const mapToWarningFormData = createMapToFormDataHelper<Warning, WarningUpdateFormData>(
  warning => ({
    severity: warning.severity,
    category: warning.category,
    reason: warning.reason,
    description: warning.description,
    isActive: warning.isActive,
    collaboratorId: warning.collaboratorId,
    supervisorId: warning.supervisorId,
    followUpDate: warning.followUpDate,
    hrNotes: warning.hrNotes,
    resolvedAt: warning.resolvedAt,
  }),
);
