// src/schemas/dependent.ts
// Dependentes do colaborador (dedução IRRF / salário-família)

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
  normalizeSearchTerm,
} from './common';
import { DEPENDENT_RELATIONSHIP } from '@constants';

// =====================
// Dependent Include Schema (Second Level Only)
// =====================

export const dependentIncludeSchema = z
  .object({
    user: z
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
    healthPlanBenefit: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              benefit: z.boolean().optional(),
              user: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// Dependent OrderBy Schema
// =====================

const dependentOrderByFields = {
  id: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  name: orderByDirectionSchema.optional(),
  cpf: orderByDirectionSchema.optional(),
  birthDate: orderByDirectionSchema.optional(),
  relationship: orderByDirectionSchema.optional(),
  irrfDeduction: orderByDirectionSchema.optional(),
  salarioFamilia: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const dependentOrderBySchema = z
  .union([
    z.object(dependentOrderByFields).partial(),
    z.array(z.object(dependentOrderByFields).partial()),
  ])
  .optional();

// =====================
// Dependent Where Schema
// =====================

export const dependentWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(dependentWhereSchema).optional(),
      OR: z.array(dependentWhereSchema).optional(),
      NOT: dependentWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      healthPlanBenefitId: z.union([createUuidWhereSchema(), z.null()]).optional(),

      name: createStringWhereSchema().optional(),
      cpf: z.union([createStringWhereSchema(), z.null()]).optional(),
      relationship: createStringWhereSchema().optional(),
      notes: z.union([createStringWhereSchema(), z.null()]).optional(),

      irrfDeduction: z.boolean().optional(),
      salarioFamilia: z.boolean().optional(),

      user: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      birthDate: createDateWhereSchema().optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters + Transform
// =====================

const dependentFilters = {
  searchingFor: z.string().optional(),
  relationships: z
    .array(
      z.enum(Object.values(DEPENDENT_RELATIONSHIP) as [string, ...string[]], {
        errorMap: () => ({ message: 'parentesco inválido' }),
      }),
    )
    .optional(),
  userIds: z.array(z.string()).optional(),
  healthPlanBenefitIds: z.array(z.string()).optional(),
  irrfDeduction: z.coerce.boolean().optional(),
  salarioFamilia: z.coerce.boolean().optional(),
};

const dependentTransform = (data: any) => {
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    andConditions.push({
      OR: [
        { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { cpfNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { user: { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.relationships && Array.isArray(data.relationships) && data.relationships.length > 0) {
    andConditions.push({ relationship: { in: data.relationships } });
    delete data.relationships;
  }

  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (
    data.healthPlanBenefitIds &&
    Array.isArray(data.healthPlanBenefitIds) &&
    data.healthPlanBenefitIds.length > 0
  ) {
    andConditions.push({ healthPlanBenefitId: { in: data.healthPlanBenefitIds } });
    delete data.healthPlanBenefitIds;
  }

  if (typeof data.irrfDeduction === 'boolean') {
    andConditions.push({ irrfDeduction: data.irrfDeduction });
    delete data.irrfDeduction;
  }

  if (typeof data.salarioFamilia === 'boolean') {
    andConditions.push({ salarioFamilia: data.salarioFamilia });
    delete data.salarioFamilia;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const dependentGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: dependentWhereSchema.optional(),
    orderBy: dependentOrderBySchema.optional(),
    include: dependentIncludeSchema.optional(),
    ...dependentFilters,
  })
  .transform(dependentTransform);

export const dependentGetByIdSchema = z.object({
  include: dependentIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Dependente inválido' }),
});

// =====================
// CRUD Schemas
// =====================

const cpfSchema = z
  .string()
  .regex(/^\d{11}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/, {
    message: 'CPF inválido (use 11 dígitos ou o formato 000.000.000-00)',
  })
  .transform(value => value.replace(/\D/g, ''));

export const dependentCreateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }),
  name: z
    .string({ required_error: 'O nome do dependente é obrigatório' })
    .min(1, 'O nome do dependente é obrigatório')
    .max(200, 'O nome deve ter no máximo 200 caracteres'),
  cpf: cpfSchema.nullable().optional(),
  birthDate: z.coerce.date({ required_error: 'A data de nascimento é obrigatória' }),
  relationship: z.enum(Object.values(DEPENDENT_RELATIONSHIP) as [string, ...string[]], {
    errorMap: () => ({ message: 'parentesco inválido' }),
  }),
  irrfDeduction: z.boolean().default(true),
  salarioFamilia: z.boolean().default(false),
  // Plano de saúde/odontológico (UserBenefit) ao qual o dependente está vinculado.
  // O custo do plano escala por dependente inscrito (Part H). NULL = não inscrito.
  healthPlanBenefitId: z.string().uuid({ message: 'Plano inválido' }).nullable().optional(),
  // Valor mensal atribuído a este dependente no plano (titular+dependentes deduzem IRRF).
  healthPlanValue: z
    .number({ invalid_type_error: 'Valor inválido' })
    .min(0, 'O valor do plano não pode ser negativo')
    .nullable()
    .optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const dependentUpdateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }).optional(),
  name: z
    .string()
    .min(1, 'O nome do dependente é obrigatório')
    .max(200, 'O nome deve ter no máximo 200 caracteres')
    .optional(),
  cpf: cpfSchema.nullable().optional(),
  birthDate: z.coerce.date().optional(),
  relationship: z
    .enum(Object.values(DEPENDENT_RELATIONSHIP) as [string, ...string[]], {
      errorMap: () => ({ message: 'parentesco inválido' }),
    })
    .optional(),
  irrfDeduction: z.boolean().optional(),
  salarioFamilia: z.boolean().optional(),
  healthPlanBenefitId: z.string().uuid({ message: 'Plano inválido' }).nullable().optional(),
  healthPlanValue: z
    .number({ invalid_type_error: 'Valor inválido' })
    .min(0, 'O valor do plano não pode ser negativo')
    .nullable()
    .optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const dependentBatchCreateSchema = z.object({
  dependents: z
    .array(dependentCreateSchema)
    .min(1, 'Pelo menos um dependente deve ser fornecido'),
});

export const dependentBatchUpdateSchema = z.object({
  dependents: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Dependente inválido' }),
        data: dependentUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um dependente deve ser fornecido'),
});

export const dependentBatchDeleteSchema = z.object({
  dependentIds: z
    .array(z.string().uuid({ message: 'Dependente inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const dependentQuerySchema = z.object({
  include: dependentIncludeSchema.optional(),
});

export const dependentBatchQuerySchema = z.object({
  include: dependentIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type DependentGetManyFormData = z.infer<typeof dependentGetManySchema>;
export type DependentGetByIdFormData = z.infer<typeof dependentGetByIdSchema>;
export type DependentQueryFormData = z.infer<typeof dependentQuerySchema>;
export type DependentBatchQueryFormData = z.infer<typeof dependentBatchQuerySchema>;
export type DependentCreateFormData = z.infer<typeof dependentCreateSchema>;
export type DependentUpdateFormData = z.infer<typeof dependentUpdateSchema>;
export type DependentBatchCreateFormData = z.infer<typeof dependentBatchCreateSchema>;
export type DependentBatchUpdateFormData = z.infer<typeof dependentBatchUpdateSchema>;
export type DependentBatchDeleteFormData = z.infer<typeof dependentBatchDeleteSchema>;
export type DependentInclude = z.infer<typeof dependentIncludeSchema>;
export type DependentOrderBy = z.infer<typeof dependentOrderBySchema>;
export type DependentWhere = z.infer<typeof dependentWhereSchema>;
