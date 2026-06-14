// src/schemas/benefit.ts
// Benefícios e adesões (Departamento Pessoal)

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createBooleanWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
} from './common';
import { BENEFIT_KIND, BENEFIT_ENROLLMENT_STATUS } from '@constants';

// =====================
// Benefit Include Schema (Second Level Only)
// =====================

export const benefitIncludeSchema = z
  .object({
    enrollments: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              user: z.boolean().optional(),
              benefit: z.boolean().optional(),
              declarationFile: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              enrollments: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// UserBenefit Include Schema (Second Level Only)
// =====================

export const userBenefitIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              // remunerations = salário-base do cargo (necessário para a regra
              // percentual do Vale Transporte: % do salário, não do custo)
              position: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({
                        remunerations: z.boolean().optional(),
                      })
                      .optional(),
                  }),
                ])
                .optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    benefit: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              enrollments: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    declarationFile: z.boolean().optional(),
  })
  .partial();

// =====================
// OrderBy Schemas
// =====================

const benefitOrderByFields = {
  id: orderByDirectionSchema.optional(),
  kind: orderByDirectionSchema.optional(),
  name: orderByDirectionSchema.optional(),
  provider: orderByDirectionSchema.optional(),
  defaultValue: orderByDirectionSchema.optional(),
  defaultEmployeeDiscountPercent: orderByDirectionSchema.optional(),
  isActive: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const benefitOrderBySchema = z
  .union([z.object(benefitOrderByFields).partial(), z.array(z.object(benefitOrderByFields).partial())])
  .optional();

const userBenefitOrderByFields = {
  id: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  benefitId: orderByDirectionSchema.optional(),
  status: orderByDirectionSchema.optional(),
  statusOrder: orderByDirectionSchema.optional(),
  startDate: orderByDirectionSchema.optional(),
  endDate: orderByDirectionSchema.optional(),
  monthlyValue: orderByDirectionSchema.optional(),
  employeeDiscountValue: orderByDirectionSchema.optional(),
  employeeDiscountPercent: orderByDirectionSchema.optional(),
  dailyTickets: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const userBenefitOrderBySchema = z
  .union([
    z.object(userBenefitOrderByFields).partial(),
    z.array(z.object(userBenefitOrderByFields).partial()),
  ])
  .optional();

// =====================
// Where Schemas
// =====================

export const benefitWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(benefitWhereSchema).optional(),
      OR: z.array(benefitWhereSchema).optional(),
      NOT: benefitWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      kind: createStringWhereSchema().optional(),
      name: createStringWhereSchema().optional(),
      provider: z.union([createStringWhereSchema(), z.null()]).optional(),
      notes: z.union([createStringWhereSchema(), z.null()]).optional(),
      isActive: createBooleanWhereSchema().optional(),

      defaultValue: z
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

      enrollments: z
        .object({
          some: z.lazy(() => z.any()).optional(),
          every: z.lazy(() => z.any()).optional(),
          none: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

export const userBenefitWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(userBenefitWhereSchema).optional(),
      OR: z.array(userBenefitWhereSchema).optional(),
      NOT: userBenefitWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      benefitId: createUuidWhereSchema().optional(),
      declarationFileId: z.union([createUuidWhereSchema(), z.null()]).optional(),
      status: createStringWhereSchema().optional(),
      notes: z.union([createStringWhereSchema(), z.null()]).optional(),

      statusOrder: z
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

      monthlyValue: z
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

      user: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      benefit: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),

      startDate: createDateWhereSchema().optional(),
      endDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters + Transforms
// =====================

const benefitFilters = {
  searchingFor: z.string().optional(),
  kinds: z
    .array(
      z.enum(Object.values(BENEFIT_KIND) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de benefício inválido' }),
      }),
    )
    .optional(),
  isActive: z.boolean().optional(),
};

const benefitTransform = (data: any) => {
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
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { provider: { contains: searchTerm, mode: 'insensitive' } },
        { notes: { contains: searchTerm, mode: 'insensitive' } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.kinds && Array.isArray(data.kinds) && data.kinds.length > 0) {
    andConditions.push({ kind: { in: data.kinds } });
    delete data.kinds;
  }

  if (typeof data.isActive === 'boolean') {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }

  return mergeAndConditions(data, andConditions);
};

const userBenefitFilters = {
  searchingFor: z.string().optional(),
  statuses: z
    .array(
      z.enum(Object.values(BENEFIT_ENROLLMENT_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status de adesão inválido' }),
      }),
    )
    .optional(),
  userIds: z.array(z.string()).optional(),
  benefitIds: z.array(z.string()).optional(),
  kinds: z
    .array(
      z.enum(Object.values(BENEFIT_KIND) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de benefício inválido' }),
      }),
    )
    .optional(),
};

const userBenefitTransform = (data: any) => {
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
        { user: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { benefit: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { notes: { contains: searchTerm, mode: 'insensitive' } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.statuses && Array.isArray(data.statuses) && data.statuses.length > 0) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.benefitIds && Array.isArray(data.benefitIds) && data.benefitIds.length > 0) {
    andConditions.push({ benefitId: { in: data.benefitIds } });
    delete data.benefitIds;
  }

  if (data.kinds && Array.isArray(data.kinds) && data.kinds.length > 0) {
    andConditions.push({ benefit: { kind: { in: data.kinds } } });
    delete data.kinds;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// GetMany Schemas
// =====================

export const benefitGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: benefitWhereSchema.optional(),
    orderBy: benefitOrderBySchema.optional(),
    include: benefitIncludeSchema.optional(),
    ...benefitFilters,
  })
  .transform(benefitTransform);

export const userBenefitGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: userBenefitWhereSchema.optional(),
    orderBy: userBenefitOrderBySchema.optional(),
    include: userBenefitIncludeSchema.optional(),
    ...userBenefitFilters,
  })
  .transform(userBenefitTransform);

// =====================
// GetById Schemas
// =====================

export const benefitGetByIdSchema = z.object({
  include: benefitIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Benefício inválido' }),
});

export const userBenefitGetByIdSchema = z.object({
  include: userBenefitIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Adesão inválida' }),
});

// =====================
// CRUD Schemas — Benefit
// =====================

export const benefitCreateSchema = z.object({
  kind: z.enum(Object.values(BENEFIT_KIND) as [string, ...string[]], {
    errorMap: () => ({ message: 'tipo de benefício inválido' }),
  }),
  name: z
    .string({ required_error: 'O nome é obrigatório' })
    .min(1, 'O nome é obrigatório')
    .max(200, 'O nome deve ter no máximo 200 caracteres'),
  provider: z.string().max(200).nullable().optional(),
  defaultValue: z.number().min(0, 'O valor padrão não pode ser negativo').nullable().optional(),
  defaultEmployeeDiscountPercent: z
    .number()
    .min(0, 'O percentual de desconto não pode ser negativo')
    .max(100, 'O percentual de desconto não pode exceder 100%')
    .nullable()
    .optional(),
  isActive: z.boolean().default(true),
  notes: z.string().max(1000).nullable().optional(),
});

export const benefitUpdateSchema = z.object({
  kind: z
    .enum(Object.values(BENEFIT_KIND) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de benefício inválido' }),
    })
    .optional(),
  name: z
    .string()
    .min(1, 'O nome é obrigatório')
    .max(200, 'O nome deve ter no máximo 200 caracteres')
    .optional(),
  provider: z.string().max(200).nullable().optional(),
  defaultValue: z.number().min(0, 'O valor padrão não pode ser negativo').nullable().optional(),
  defaultEmployeeDiscountPercent: z
    .number()
    .min(0, 'O percentual de desconto não pode ser negativo')
    .max(100, 'O percentual de desconto não pode exceder 100%')
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const benefitBatchCreateSchema = z.object({
  benefits: z.array(benefitCreateSchema).min(1, 'Pelo menos um benefício deve ser fornecido'),
});

export const benefitBatchUpdateSchema = z.object({
  benefits: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Benefício inválido' }),
        data: benefitUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um benefício deve ser fornecido'),
});

export const benefitBatchDeleteSchema = z.object({
  benefitIds: z
    .array(z.string().uuid({ message: 'Benefício inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const benefitQuerySchema = z.object({
  include: benefitIncludeSchema.optional(),
});

export const benefitBatchQuerySchema = z.object({
  include: benefitIncludeSchema.optional(),
});

// =====================
// CRUD Schemas — UserBenefit
// =====================

export const userBenefitCreateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }),
  benefitId: z.string().uuid({ message: 'Benefício inválido' }),
  status: z
    .enum(Object.values(BENEFIT_ENROLLMENT_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de adesão inválido' }),
    })
    .default(BENEFIT_ENROLLMENT_STATUS.ACTIVE),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  monthlyValue: z
    .number({ required_error: 'O valor mensal é obrigatório' })
    .min(0, 'O valor mensal não pode ser negativo'),
  employeeDiscountValue: z
    .number()
    .min(0, 'O desconto do colaborador não pode ser negativo')
    .nullable()
    .optional(),
  employeeDiscountPercent: z
    .number()
    .min(0, 'O percentual de desconto não pode ser negativo')
    .max(100, 'O percentual de desconto não pode exceder 100%')
    .nullable()
    .optional(),
  dailyTickets: z
    .number()
    .int('A quantidade de passagens diárias deve ser um número inteiro')
    .min(0)
    .nullable()
    .optional(),
  // Parcelamento de convênio (espelha LOAN/ADVANCE): total de parcelas contratadas.
  totalInstallments: z
    .number()
    .int('O número de parcelas deve ser inteiro')
    .min(1, 'O número de parcelas deve ser ao menos 1')
    .nullable()
    .optional(),
  // Parcela corrente (1-based); avança a cada folha e encerra ao exceder totalInstallments.
  currentInstallment: z
    .number()
    .int('A parcela corrente deve ser inteira')
    .min(1, 'A parcela corrente deve ser ao menos 1')
    .nullable()
    .optional(),
  declarationFileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const userBenefitUpdateSchema = z.object({
  userId: z.string().uuid({ message: 'Colaborador inválido' }).optional(),
  benefitId: z.string().uuid({ message: 'Benefício inválido' }).optional(),
  status: z
    .enum(Object.values(BENEFIT_ENROLLMENT_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de adesão inválido' }),
    })
    .optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  monthlyValue: z.number().min(0, 'O valor mensal não pode ser negativo').optional(),
  employeeDiscountValue: z
    .number()
    .min(0, 'O desconto do colaborador não pode ser negativo')
    .nullable()
    .optional(),
  employeeDiscountPercent: z
    .number()
    .min(0, 'O percentual de desconto não pode ser negativo')
    .max(100, 'O percentual de desconto não pode exceder 100%')
    .nullable()
    .optional(),
  dailyTickets: z
    .number()
    .int('A quantidade de passagens diárias deve ser um número inteiro')
    .min(0)
    .nullable()
    .optional(),
  totalInstallments: z
    .number()
    .int('O número de parcelas deve ser inteiro')
    .min(1, 'O número de parcelas deve ser ao menos 1')
    .nullable()
    .optional(),
  currentInstallment: z
    .number()
    .int('A parcela corrente deve ser inteira')
    .min(1, 'A parcela corrente deve ser ao menos 1')
    .nullable()
    .optional(),
  declarationFileId: z.string().uuid({ message: 'Arquivo inválido' }).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const userBenefitTerminateSchema = z.object({
  endDate: z.coerce.date({ required_error: 'A data de encerramento é obrigatória' }),
});

export const userBenefitBatchCreateSchema = z.object({
  userBenefits: z.array(userBenefitCreateSchema).min(1, 'Pelo menos uma adesão deve ser fornecida'),
});

export const userBenefitBatchUpdateSchema = z.object({
  userBenefits: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Adesão inválida' }),
        data: userBenefitUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma adesão deve ser fornecida'),
});

export const userBenefitBatchDeleteSchema = z.object({
  userBenefitIds: z
    .array(z.string().uuid({ message: 'Adesão inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

export const userBenefitQuerySchema = z.object({
  include: userBenefitIncludeSchema.optional(),
});

export const userBenefitBatchQuerySchema = z.object({
  include: userBenefitIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

export type BenefitGetManyFormData = z.infer<typeof benefitGetManySchema>;
export type BenefitGetByIdFormData = z.infer<typeof benefitGetByIdSchema>;
export type BenefitQueryFormData = z.infer<typeof benefitQuerySchema>;
export type BenefitBatchQueryFormData = z.infer<typeof benefitBatchQuerySchema>;
export type BenefitCreateFormData = z.infer<typeof benefitCreateSchema>;
export type BenefitUpdateFormData = z.infer<typeof benefitUpdateSchema>;
export type BenefitBatchCreateFormData = z.infer<typeof benefitBatchCreateSchema>;
export type BenefitBatchUpdateFormData = z.infer<typeof benefitBatchUpdateSchema>;
export type BenefitBatchDeleteFormData = z.infer<typeof benefitBatchDeleteSchema>;
export type BenefitInclude = z.infer<typeof benefitIncludeSchema>;
export type BenefitOrderBy = z.infer<typeof benefitOrderBySchema>;
export type BenefitWhere = z.infer<typeof benefitWhereSchema>;

export type UserBenefitGetManyFormData = z.infer<typeof userBenefitGetManySchema>;
export type UserBenefitGetByIdFormData = z.infer<typeof userBenefitGetByIdSchema>;
export type UserBenefitQueryFormData = z.infer<typeof userBenefitQuerySchema>;
export type UserBenefitBatchQueryFormData = z.infer<typeof userBenefitBatchQuerySchema>;
export type UserBenefitCreateFormData = z.infer<typeof userBenefitCreateSchema>;
export type UserBenefitUpdateFormData = z.infer<typeof userBenefitUpdateSchema>;
export type UserBenefitTerminateFormData = z.infer<typeof userBenefitTerminateSchema>;
export type UserBenefitBatchCreateFormData = z.infer<typeof userBenefitBatchCreateSchema>;
export type UserBenefitBatchUpdateFormData = z.infer<typeof userBenefitBatchUpdateSchema>;
export type UserBenefitBatchDeleteFormData = z.infer<typeof userBenefitBatchDeleteSchema>;
export type UserBenefitInclude = z.infer<typeof userBenefitIncludeSchema>;
export type UserBenefitOrderBy = z.infer<typeof userBenefitOrderBySchema>;
export type UserBenefitWhere = z.infer<typeof userBenefitWhereSchema>;
