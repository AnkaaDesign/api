// src/schemas/salary-adjustment.ts
// Reajustes salariais (Departamento Pessoal)

import { z } from 'zod';
import {
  paginationSchema,
  orderByDirectionSchema,
  normalizeOrderBy,
  createUuidWhereSchema,
  createStringWhereSchema,
  createDateWhereSchema,
  createNumberWhereSchema,
  createDescriptionSchema,
  mergeAndConditions,
} from './common';
import { SALARY_ADJUSTMENT_TYPE } from '@constants';

// =====================
// SalaryAdjustment Include Schema (Second Level Only)
// =====================

export const salaryAdjustmentIncludeSchema = z
  .object({
    appliedBy: z
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
      .optional(),
    items: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              salaryAdjustment: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// SalaryAdjustmentItem Include Schema
// =====================

export const salaryAdjustmentItemIncludeSchema = z
  .object({
    salaryAdjustment: z.boolean().optional(),
    position: z
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
      .optional(),
  })
  .partial();

// =====================
// SalaryAdjustment Order By Schema
// =====================

const salaryAdjustmentOrderByFields = z.object({
  id: orderByDirectionSchema.optional(),
  type: orderByDirectionSchema.optional(),
  percentage: orderByDirectionSchema.optional(),
  effectiveDate: orderByDirectionSchema.optional(),
  note: orderByDirectionSchema.optional(),
  appliedById: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
});

export const salaryAdjustmentOrderBySchema = z
  .union([salaryAdjustmentOrderByFields, z.array(salaryAdjustmentOrderByFields)])
  .optional();

// =====================
// SalaryAdjustment Where Schema
// =====================

export const salaryAdjustmentWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(salaryAdjustmentWhereSchema).optional(),
      OR: z.array(salaryAdjustmentWhereSchema).optional(),
      NOT: salaryAdjustmentWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      appliedById: z.union([createUuidWhereSchema(), z.null()]).optional(),

      type: createStringWhereSchema().optional(),
      note: z.union([createStringWhereSchema(), z.null()]).optional(),

      percentage: z.union([createNumberWhereSchema(), z.null()]).optional(),

      effectiveDate: createDateWhereSchema().optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),

      appliedBy: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      items: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Filters and Transform
// =====================

const salaryAdjustmentFilters = {
  searchingFor: z.string().optional(),
  types: z
    .array(
      z.enum(Object.values(SALARY_ADJUSTMENT_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de reajuste inválido' }),
      }),
    )
    .optional(),
  appliedByIds: z.array(z.string()).optional(),
  positionIds: z.array(z.string()).optional(),
  effectiveDateRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
};

const salaryAdjustmentTransform = (data: any) => {
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
          appliedBy: {
            name: { contains: data.searchingFor.trim(), mode: 'insensitive' },
          },
        },
        {
          items: {
            some: {
              position: {
                name: { contains: data.searchingFor.trim(), mode: 'insensitive' },
              },
            },
          },
        },
      ],
    });
    delete data.searchingFor;
  }

  if (data.types && Array.isArray(data.types) && data.types.length > 0) {
    andConditions.push({ type: { in: data.types } });
    delete data.types;
  }

  if (data.appliedByIds && Array.isArray(data.appliedByIds) && data.appliedByIds.length > 0) {
    andConditions.push({ appliedById: { in: data.appliedByIds } });
    delete data.appliedByIds;
  }

  if (data.positionIds && Array.isArray(data.positionIds) && data.positionIds.length > 0) {
    andConditions.push({
      items: { some: { positionId: { in: data.positionIds } } },
    });
    delete data.positionIds;
  }

  if (data.effectiveDateRange) {
    andConditions.push({ effectiveDate: data.effectiveDateRange });
    delete data.effectiveDateRange;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const salaryAdjustmentGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: salaryAdjustmentWhereSchema.optional(),
    orderBy: salaryAdjustmentOrderBySchema.optional(),
    include: salaryAdjustmentIncludeSchema.optional(),
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
    ...salaryAdjustmentFilters,
  })
  .transform(salaryAdjustmentTransform);

export const salaryAdjustmentGetByIdSchema = z.object({
  include: salaryAdjustmentIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Reajuste salarial inválido' }),
});

export const salaryAdjustmentQuerySchema = z.object({
  include: salaryAdjustmentIncludeSchema.optional(),
});

export const salaryAdjustmentBatchQuerySchema = z.object({
  include: salaryAdjustmentIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

const customValueSchema = z.object({
  positionId: z.string().uuid({ message: 'Cargo inválido' }),
  newValue: z
    .number({ invalid_type_error: 'Valor inválido' })
    .positive({ message: 'O novo valor deve ser maior que zero' }),
});

// Core apply schema — POST /salary-adjustments/apply
export const salaryAdjustmentApplySchema = z
  .object({
    type: z
      .enum(Object.values(SALARY_ADJUSTMENT_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de reajuste inválido' }),
      })
      .default(SALARY_ADJUSTMENT_TYPE.OTHER),
    percentage: z
      .number({ invalid_type_error: 'Percentual inválido' })
      .min(-100, { message: 'Percentual deve estar entre -100% e 1000%' })
      .max(1000, { message: 'Percentual deve estar entre -100% e 1000%' })
      .nullable()
      .optional(),
    customValues: z.array(customValueSchema).optional(),
    positionIds: z
      .array(z.string().uuid({ message: 'Cargo inválido' }))
      .min(1, 'Pelo menos um cargo deve ser selecionado'),
    effectiveDate: z.coerce.date().optional(),
    note: createDescriptionSchema(0, 1000).nullable().optional(),
    // Piso/salário-mínimo (Part F): por padrão o reajuste é BLOQUEADO quando o
    // novo valor fica abaixo do piso efetivo (max(salário-mínimo, piso da
    // categoria)). Quando o usuário confirma explicitamente, o front reenvia
    // com allowBelowFloor=true e o reajuste é aplicado mesmo abaixo do piso.
    allowBelowFloor: z.boolean().optional().default(false),
  })
  .refine(
    data =>
      (data.percentage !== null && data.percentage !== undefined) ||
      (Array.isArray(data.customValues) && data.customValues.length > 0),
    {
      message: 'Informe um percentual ou valores personalizados por cargo',
      path: ['percentage'],
    },
  )
  .transform(toFormData);

// Create mirrors apply (adjustments are only created through the apply flow)
export const salaryAdjustmentCreateSchema = salaryAdjustmentApplySchema;

// Update — note only (the monetary effects are immutable history)
export const salaryAdjustmentUpdateSchema = z
  .object({
    note: createDescriptionSchema(0, 1000).nullable().optional(),
  })
  .transform(toFormData);

export const salaryAdjustmentBatchUpdateSchema = z.object({
  salaryAdjustments: z
    .array(
      z.object({
        id: z.string().uuid('Reajuste salarial inválido'),
        data: salaryAdjustmentUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um reajuste deve ser fornecido'),
});

export const salaryAdjustmentBatchDeleteSchema = z.object({
  salaryAdjustmentIds: z
    .array(z.string().uuid({ message: 'Reajuste salarial inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Inferred Types
// =====================

export type SalaryAdjustmentGetManyFormData = z.infer<typeof salaryAdjustmentGetManySchema>;
export type SalaryAdjustmentGetByIdFormData = z.infer<typeof salaryAdjustmentGetByIdSchema>;
export type SalaryAdjustmentQueryFormData = z.infer<typeof salaryAdjustmentQuerySchema>;
export type SalaryAdjustmentBatchQueryFormData = z.infer<typeof salaryAdjustmentBatchQuerySchema>;

export type SalaryAdjustmentApplyFormData = z.infer<typeof salaryAdjustmentApplySchema>;
export type SalaryAdjustmentCreateFormData = z.infer<typeof salaryAdjustmentCreateSchema>;
export type SalaryAdjustmentUpdateFormData = z.infer<typeof salaryAdjustmentUpdateSchema>;

export type SalaryAdjustmentBatchUpdateFormData = z.infer<typeof salaryAdjustmentBatchUpdateSchema>;
export type SalaryAdjustmentBatchDeleteFormData = z.infer<typeof salaryAdjustmentBatchDeleteSchema>;

export type SalaryAdjustmentInclude = z.infer<typeof salaryAdjustmentIncludeSchema>;
export type SalaryAdjustmentItemInclude = z.infer<typeof salaryAdjustmentItemIncludeSchema>;
export type SalaryAdjustmentOrderBy = z.infer<typeof salaryAdjustmentOrderBySchema>;
export type SalaryAdjustmentWhere = z.infer<typeof salaryAdjustmentWhereSchema>;
