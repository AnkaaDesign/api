// src/schemas/admission.ts
// Admissões (Departamento Pessoal)

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
} from './common';
import {
  ADMISSION_STATUS,
  ADMISSION_DOCUMENT_TYPE,
  ADMISSION_DOCUMENT_STATUS,
  CONTRACT_TYPE,
  EMPLOYEE_TYPE,
} from '@constants';
import { userCreateSchema } from './user';

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
// Admission Include Schema
// =====================

export const admissionIncludeSchema = z
  .object({
    user: relationIncludeSchema.optional(),
    contract: relationIncludeSchema.optional(),
    createdBy: relationIncludeSchema.optional(),
    documents: relationIncludeSchema.optional(),
  })
  .partial();

// =====================
// Admission Order By Schema
// =====================

const admissionOrderByFields = z.object({
  id: orderByDirectionSchema.optional(),
  status: orderByDirectionSchema.optional(),
  statusOrder: orderByDirectionSchema.optional(),
  hireDate: orderByDirectionSchema.optional(),
  notes: orderByDirectionSchema.optional(),
  userId: orderByDirectionSchema.optional(),
  createdById: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
  user: z.object({ name: orderByDirectionSchema.optional() }).optional(),
});

export const admissionOrderBySchema = z
  .union([admissionOrderByFields, z.array(admissionOrderByFields)])
  .optional();

// =====================
// Admission Where Schema
// =====================

const admissionStatusOrderWhereSchema = z
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
  .optional();

export const admissionWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(admissionWhereSchema).optional(),
      OR: z.array(admissionWhereSchema).optional(),
      NOT: admissionWhereSchema.optional(),

      id: createUuidWhereSchema().optional(),
      userId: createUuidWhereSchema().optional(),
      createdById: z.union([createUuidWhereSchema(), z.null()]).optional(),

      status: createStringWhereSchema().optional(),
      notes: z.union([createStringWhereSchema(), z.null()]).optional(),

      statusOrder: admissionStatusOrderWhereSchema,

      hireDate: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),

      user: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
      documents: z
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
// Admission Filters and Transform
// =====================

const admissionFilters = {
  searchingFor: z.string().optional(),
  statuses: z
    .array(
      z.enum(Object.values(ADMISSION_STATUS) as [string, ...string[]], {
        errorMap: () => ({ message: 'status inválido' }),
      }),
    )
    .optional(),
  userIds: z.array(z.string().uuid({ message: 'Colaborador inválido' })).optional(),
};

const admissionTransform = (data: any) => {
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
        { notes: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        { user: { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } } },
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

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const admissionGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: admissionWhereSchema.optional(),
    orderBy: admissionOrderBySchema.optional(),
    include: admissionIncludeSchema.optional(),
    ...admissionFilters,
  })
  .transform(admissionTransform);

export const admissionGetByIdSchema = z.object({
  include: admissionIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Admissão inválida' }),
});

export const admissionQuerySchema = z.object({
  include: admissionIncludeSchema.optional(),
});

export const admissionBatchQuerySchema = z.object({
  include: admissionIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

// Vínculo (EmploymentContract) criado pela admissão. Para uma NOVA pessoa, é o
// primeiro vínculo; para uma pessoa existente (recontratação), um novo vínculo.
const admissionContractSchema = z.object({
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
  admissionDate: z.coerce.date().nullable().optional(),
  positionId: z.string().uuid('Cargo inválido').nullable().optional(),
  sectorId: z.string().uuid('Setor inválido').nullable().optional(),
  payrollNumber: z.number().int().positive('Número da folha deve ser positivo').nullable().optional(),
  providerName: z.string().nullable().optional(),
  providerCnpj: z.string().nullable().optional(),
});

const admissionInlineDocumentSchema = z.object({
  type: z.enum(Object.values(ADMISSION_DOCUMENT_TYPE) as [string, ...string[]], {
    errorMap: () => ({ message: 'tipo de documento inválido' }),
  }),
  fileId: z.string().uuid({ message: 'Arquivo inválido' }),
});

export const admissionCreateSchema = z
  .object({
    // Pessoa NOVA (cria usuário + vínculo + admissão na MESMA transação) OU
    // pessoa EXISTENTE sendo re-engajada (recontratação): informe `user` OU
    // `userId`. O servidor também detecta o CPF: se `user.cpf` já existir,
    // anexa um NOVO vínculo à pessoa existente em vez de duplicá-la.
    userId: z.string().uuid({ message: 'Colaborador inválido' }).optional(),
    user: userCreateSchema.optional(),
    // Vínculo da admissão. Opcional; o serviço aplica defaults (CLT / experiência).
    contract: admissionContractSchema.optional(),
    // Documentos enviados inline (além do endpoint POST /admissions/:id/documents).
    documents: z.array(admissionInlineDocumentSchema).optional(),
    hireDate: z.coerce.date().nullable().optional(),
    notes: createDescriptionSchema(0, 2000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.userId && !data.user) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userId'],
        message: 'Selecione um colaborador existente ou informe os dados do novo colaborador.',
      });
    }
  })
  .transform(toFormData);

export const admissionUpdateSchema = z
  .object({
    hireDate: z.coerce.date().nullable().optional(),
    notes: createDescriptionSchema(0, 2000).nullable().optional(),
  })
  .transform(toFormData);

export const admissionBatchCreateSchema = z.object({
  admissions: z.array(admissionCreateSchema).min(1, 'Pelo menos uma admissão deve ser fornecida'),
});

export const admissionBatchUpdateSchema = z.object({
  admissions: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Admissão inválida' }),
        data: admissionUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma admissão deve ser fornecida'),
});

export const admissionBatchDeleteSchema = z.object({
  admissionIds: z
    .array(z.string().uuid({ message: 'Admissão inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Status Machine / Documents Schemas
// =====================

export const admissionAdvanceSchema = z.object({
  // Target status; when omitted, advances to the next status in the chain.
  status: z
    .enum(Object.values(ADMISSION_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status inválido' }),
    })
    .optional(),
});

export const admissionDocumentUploadSchema = z.object({
  type: z.enum(Object.values(ADMISSION_DOCUMENT_TYPE) as [string, ...string[]], {
    errorMap: () => ({ message: 'tipo de documento inválido' }),
  }),
  note: createDescriptionSchema(0, 1000).nullable().optional(),
});

export const admissionDocumentUpdateSchema = z.object({
  status: z
    .enum(Object.values(ADMISSION_DOCUMENT_STATUS) as [string, ...string[]], {
      errorMap: () => ({ message: 'status de documento inválido' }),
    })
    .optional(),
  note: createDescriptionSchema(0, 1000).nullable().optional(),
  required: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

// =====================
// In-app electronic signature (reuses the PPE delivery sign payload shape).
// Lei 14.063/2020 (assinatura eletrônica avançada) + LGPD: no raw biometric
// data is persisted — only the assertion result + a cryptographic evidence hash.
// =====================

export const admissionDocumentSignSchema = z.object({
  biometricMethod: z.enum(['FINGERPRINT', 'FACE_ID', 'IRIS', 'DEVICE_PIN', 'NONE'], {
    errorMap: () => ({ message: 'Método biométrico inválido' }),
  }),
  biometricSuccess: z.boolean(),

  // Device info
  deviceBrand: z.string().max(100).nullable().optional(),
  deviceModel: z.string().max(100).nullable().optional(),
  deviceOs: z.string().max(50).nullable().optional(),
  deviceOsVersion: z.string().max(50).nullable().optional(),
  appVersion: z.string().max(50).nullable().optional(),

  // Location (optional — signing works without it)
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationAccuracy: z.number().min(0).nullable().optional(),
  networkType: z.enum(['WIFI', 'CELLULAR', 'ETHERNET', 'UNKNOWN']).default('UNKNOWN'),

  // Client timestamp (ISO 8601)
  clientTimestamp: z.string().datetime({ message: 'Timestamp deve ser ISO 8601' }),

  // Evidence hash (SHA-256 hex = 64 chars)
  evidenceHash: z
    .string()
    .length(64, 'Hash SHA-256 deve ter 64 caracteres')
    .regex(/^[a-f0-9]{64}$/, 'Hash deve ser hexadecimal válido'),

  // LGPD consent (mandatory)
  consentGiven: z.boolean().refine(val => val === true, {
    message: 'Consentimento LGPD é obrigatório para assinatura eletrônica',
  }),
});

export type AdmissionDocumentSignFormData = z.infer<typeof admissionDocumentSignSchema>;

// =====================
// Inferred Types
// =====================

export type AdmissionGetManyFormData = z.infer<typeof admissionGetManySchema>;
export type AdmissionGetByIdFormData = z.infer<typeof admissionGetByIdSchema>;
export type AdmissionQueryFormData = z.infer<typeof admissionQuerySchema>;
export type AdmissionBatchQueryFormData = z.infer<typeof admissionBatchQuerySchema>;

export type AdmissionCreateFormData = z.infer<typeof admissionCreateSchema>;
export type AdmissionUpdateFormData = z.infer<typeof admissionUpdateSchema>;

export type AdmissionBatchCreateFormData = z.infer<typeof admissionBatchCreateSchema>;
export type AdmissionBatchUpdateFormData = z.infer<typeof admissionBatchUpdateSchema>;
export type AdmissionBatchDeleteFormData = z.infer<typeof admissionBatchDeleteSchema>;

export type AdmissionAdvanceFormData = z.infer<typeof admissionAdvanceSchema>;
export type AdmissionDocumentUploadFormData = z.infer<typeof admissionDocumentUploadSchema>;
export type AdmissionDocumentUpdateFormData = z.infer<typeof admissionDocumentUpdateSchema>;

export type AdmissionInclude = z.infer<typeof admissionIncludeSchema>;
export type AdmissionOrderBy = z.infer<typeof admissionOrderBySchema>;
export type AdmissionWhere = z.infer<typeof admissionWhereSchema>;
