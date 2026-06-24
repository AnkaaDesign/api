// src/schemas/employment-contract.ts
// Vínculos empregatícios (EmploymentContract) — fonte da verdade do relacionamento
// de trabalho. Um colaborador (User/CPF) possui muitos vínculos, exatamente um
// atual (isCurrent=true).

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
  createDescriptionSchema,
  normalizeSearchTerm,
} from './common';
import {
  CONTRACT_TYPE,
  CONTRACT_STATUS,
  EMPLOYEE_TYPE,
  TERMINATION_TYPE,
  INSALUBRITY_DEGREE,
  STABILITY_TYPE,
} from '@constants';

// =====================
// Generic relation include (Prisma passthrough)
// =====================

const relationIncludeSchema = z.union([
  z.boolean(),
  z.object({
    include: z.any().optional(),
    select: z.any().optional(),
    where: z.any().optional(),
    orderBy: z.any().optional(),
  }),
]);

// =====================
// Include Schema
// =====================

export const employmentContractIncludeSchema = z
  .object({
    user: relationIncludeSchema.optional(),
    position: relationIncludeSchema.optional(),
    sector: relationIncludeSchema.optional(),
    admission: relationIncludeSchema.optional(),
    terminations: relationIncludeSchema.optional(),
    payrolls: relationIncludeSchema.optional(),
    vacations: relationIncludeSchema.optional(),
    thirteenths: relationIncludeSchema.optional(),
    phaseHistory: relationIncludeSchema.optional(),
  })
  .partial();

// =====================
// Order By Schema
// =====================

const employmentContractOrderByFields = z.object({
  id: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  sequence: orderByDirectionSchema.optional(),
  matricula: orderByDirectionSchema.optional(),
  payrollNumber: orderByDirectionSchema.optional(),
  employeeType: orderByDirectionSchema.optional(),
  contractType: orderByDirectionSchema.optional(),
  status: orderByDirectionSchema.optional(),
  statusOrder: orderByDirectionSchema.optional(),
  admissionDate: orderByDirectionSchema.optional(),
  effectedAt: orderByDirectionSchema.optional(),
  terminationDate: orderByDirectionSchema.optional(),
  isCurrent: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
  user: z.object({ name: orderByDirectionSchema.optional() }).optional(),
});

export const employmentContractOrderBySchema = z
  .union([employmentContractOrderByFields, z.array(employmentContractOrderByFields)])
  .optional();

// =====================
// Where Schema
// =====================

export const employmentContractWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(employmentContractWhereSchema).optional(),
      OR: z.array(employmentContractWhereSchema).optional(),
      NOT: employmentContractWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      positionId: z.union([createUuidWhereSchema(), z.null()]).optional(),
      sectorId: z.union([createUuidWhereSchema(), z.null()]).optional(),

      employeeType: createStringWhereSchema().optional(),
      contractType: z.union([createStringWhereSchema(), z.null()]).optional(),
      status: createStringWhereSchema().optional(),
      isCurrent: z.boolean().optional(),

      sequence: z
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

      admissionDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      effectedAt: z.union([createDateWhereSchema(), z.null()]).optional(),
      terminationDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),

      user: z
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

const employmentContractFilters = {
  searchingFor: z.string().optional(),
  userIds: z.array(z.string().uuid({ message: 'Colaborador inválido' })).optional(),
  contractTypes: z.array(z.nativeEnum(CONTRACT_TYPE)).optional(),
  statuses: z.array(z.nativeEnum(CONTRACT_STATUS)).optional(),
  employeeTypes: z.array(z.nativeEnum(EMPLOYEE_TYPE)).optional(),
  isCurrent: z.boolean().optional(),
};

const employmentContractTransform = (data: any) => {
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
        { providerNameNormalized: { contains: normalizeSearchTerm(data.searchingFor.trim()) } },
        { user: { nameNormalized: { contains: normalizeSearchTerm(data.searchingFor.trim()) } } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.userIds && Array.isArray(data.userIds) && data.userIds.length > 0) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.contractTypes && Array.isArray(data.contractTypes) && data.contractTypes.length > 0) {
    andConditions.push({ contractType: { in: data.contractTypes } });
    delete data.contractTypes;
  }

  if (data.statuses && Array.isArray(data.statuses) && data.statuses.length > 0) {
    andConditions.push({ status: { in: data.statuses } });
    delete data.statuses;
  }

  if (data.employeeTypes && Array.isArray(data.employeeTypes) && data.employeeTypes.length > 0) {
    andConditions.push({ employeeType: { in: data.employeeTypes } });
    delete data.employeeTypes;
  }

  if (typeof data.isCurrent === 'boolean') {
    andConditions.push({ isCurrent: data.isCurrent });
    delete data.isCurrent;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const employmentContractGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: employmentContractWhereSchema.optional(),
    orderBy: employmentContractOrderBySchema.optional(),
    include: employmentContractIncludeSchema.optional(),
    ...employmentContractFilters,
  })
  .transform(employmentContractTransform);

export const employmentContractGetByIdSchema = z.object({
  include: employmentContractIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Vínculo inválido' }),
});

export const employmentContractQuerySchema = z.object({
  include: employmentContractIncludeSchema.optional(),
});

export const employmentContractBatchQuerySchema = z.object({
  include: employmentContractIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

const nullableDate = z.coerce.date().nullable().optional();

export const employmentContractCreateSchema = z
  .object({
    // Owner of the vínculo. A new contract for an existing person is the
    // rehire / re-engagement path (sequence = max+1, prior isCurrent flipped).
    userId: z.string().uuid({ message: 'Colaborador inválido' }),
    employeeType: z
      .enum(Object.values(EMPLOYEE_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'categoria de colaborador inválida' }),
      })
      .default(EMPLOYEE_TYPE.CLT),
    contractType: z
      .enum(Object.values(CONTRACT_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de contrato inválido' }),
      })
      .nullable()
      .optional(),
    payrollNumber: z.number().int().positive('Número da folha deve ser positivo').nullable().optional(),
    matricula: z.number().int().nullable().optional(),
    positionId: z.string().uuid('Cargo inválido').nullable().optional(),
    sectorId: z.string().uuid('Setor inválido').nullable().optional(),
    admissionDate: nullableDate,
    exp1StartAt: nullableDate,
    exp1EndAt: nullableDate,
    exp2StartAt: nullableDate,
    exp2EndAt: nullableDate,
    effectedAt: nullableDate,
    // Art. 481 CLT — cláusula assecuratória do direito recíproco de rescisão.
    hasArt481Clause: z.boolean().optional(),
    // Overrides per-vínculo da insalubridade/periculosidade do cargo.
    // NULL = herda do Position; mutuamente exclusivos quando definidos (service).
    insalubrityDegreeOverride: z.nativeEnum(INSALUBRITY_DEGREE).nullable().optional(),
    hazardPayOverride: z.boolean().nullable().optional(),
    // Estabilidade (job-stability) — janela que bloqueia o desligamento.
    stabilityType: z.nativeEnum(STABILITY_TYPE).nullable().optional(),
    stabilityStart: nullableDate,
    stabilityEnd: nullableDate,
    providerName: z.string().nullable().optional(),
    providerCnpj: z.string().nullable().optional(),
    notes: createDescriptionSchema(0, 2000).nullable().optional(),
  })
  .transform(toFormData);

export const employmentContractUpdateSchema = z
  .object({
    employeeType: z
      .enum(Object.values(EMPLOYEE_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'categoria de colaborador inválida' }),
      })
      .optional(),
    contractType: z
      .enum(Object.values(CONTRACT_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de contrato inválido' }),
      })
      .nullable()
      .optional(),
    status: z
      .enum(Object.values(CONTRACT_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'situação do contrato inválida' }),
      })
      .optional(),
    payrollNumber: z.number().int().positive('Número da folha deve ser positivo').nullable().optional(),
    matricula: z.number().int().nullable().optional(),
    positionId: z.string().uuid('Cargo inválido').nullable().optional(),
    sectorId: z.string().uuid('Setor inválido').nullable().optional(),
    admissionDate: nullableDate,
    exp1StartAt: nullableDate,
    exp1EndAt: nullableDate,
    exp2StartAt: nullableDate,
    exp2EndAt: nullableDate,
    effectedAt: nullableDate,
    hasArt481Clause: z.boolean().optional(),
    insalubrityDegreeOverride: z.nativeEnum(INSALUBRITY_DEGREE).nullable().optional(),
    hazardPayOverride: z.boolean().nullable().optional(),
    stabilityType: z.nativeEnum(STABILITY_TYPE).nullable().optional(),
    stabilityStart: nullableDate,
    stabilityEnd: nullableDate,
    terminationDate: nullableDate,
    terminationType: z
      .enum(Object.values(TERMINATION_TYPE) as [string, ...string[]])
      .nullable()
      .optional(),
    providerName: z.string().nullable().optional(),
    providerCnpj: z.string().nullable().optional(),
    notes: createDescriptionSchema(0, 2000).nullable().optional(),
  })
  .transform(toFormData);

export const employmentContractBatchCreateSchema = z.object({
  employmentContracts: z
    .array(employmentContractCreateSchema)
    .min(1, 'Pelo menos um vínculo deve ser fornecido'),
});

export const employmentContractBatchUpdateSchema = z.object({
  employmentContracts: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Vínculo inválido' }),
        data: employmentContractUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um vínculo deve ser fornecido'),
});

export const employmentContractBatchDeleteSchema = z.object({
  employmentContractIds: z
    .array(z.string().uuid({ message: 'Vínculo inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Inferred Types
// =====================

export type EmploymentContractGetManyFormData = z.infer<typeof employmentContractGetManySchema>;
export type EmploymentContractGetByIdFormData = z.infer<typeof employmentContractGetByIdSchema>;
export type EmploymentContractQueryFormData = z.infer<typeof employmentContractQuerySchema>;
export type EmploymentContractBatchQueryFormData = z.infer<
  typeof employmentContractBatchQuerySchema
>;

export type EmploymentContractCreateFormData = z.infer<typeof employmentContractCreateSchema>;
export type EmploymentContractUpdateFormData = z.infer<typeof employmentContractUpdateSchema>;

export type EmploymentContractBatchCreateFormData = z.infer<
  typeof employmentContractBatchCreateSchema
>;
export type EmploymentContractBatchUpdateFormData = z.infer<
  typeof employmentContractBatchUpdateSchema
>;
export type EmploymentContractBatchDeleteFormData = z.infer<
  typeof employmentContractBatchDeleteSchema
>;

export type EmploymentContractInclude = z.infer<typeof employmentContractIncludeSchema>;
export type EmploymentContractOrderBy = z.infer<typeof employmentContractOrderBySchema>;
export type EmploymentContractWhere = z.infer<typeof employmentContractWhereSchema>;
